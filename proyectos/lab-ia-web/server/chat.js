import { createTurnStore, isTurnId, TURN_ERROR } from './turn-store.js';
import { generateChatReply } from './chat-ollama.js';
import { readBoundedJson } from './security-http.js';

export function createChatHandler({ database, loadAgent, json, generate = generateChatReply, turns = createTurnStore() }) {
  const generating = new Set();
  const fail = (response, status, error) => json(response, status, { error });
  async function respond(request, response, rawId, parsedBody) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return fail(response, 405, 'Método no permitido.');
    }
    if (!/^[1-9][0-9]*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))
      || request.url.includes('?')) return fail(response, 400, 'Solicitud no válida.');
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return fail(response, 415, 'Se requiere application/json.');
    }
    if (request.headers.origin) {
      let origin;
      try { origin = new URL(request.headers.origin); } catch { /* Rejected below. */ }
      if (!origin || !['http:', 'https:'].includes(origin.protocol) || origin.host !== request.headers.host) {
        return fail(response, 403, 'Origen no permitido.');
      }
    }
    const id = Number(rawId);
    if (generating.has(id) || turns.findActive(id)) return fail(response, 409, 'Ya se está generando una respuesta.');
    generating.add(id);
    let turn;
    try {
      const body = parsedBody === undefined
        ? await readBoundedJson(request).catch(() => null) : parsedBody;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
        return fail(response, 400, 'La solicitud debe contener únicamente {}.');
      }
      const conversation = database.prepare('SELECT agente_id FROM conversaciones WHERE id = ?').get(id);
      if (!conversation) return fail(response, 404, 'Conversación no encontrada.');
      const history = database.prepare('SELECT id, rol, contenido FROM mensajes WHERE conversacion_id = ? ORDER BY id ASC').all(id);
      const last = history.at(-1);
      if (!last || last.rol !== 'user') return fail(response, 409, 'No hay un mensaje de usuario pendiente de respuesta.');
      if (!history.every((message) => ['user', 'assistant'].includes(message.rol)
        && typeof message.contenido === 'string' && message.contenido.trim())) throw new Error();
      const existing = turns.findForMessage(id, last.id);
      if (existing && existing.state !== 'failed') return fail(response, 409, 'Este mensaje ya tiene un turno.');
      // Terminal attempts are immutable; a retry requires a new persisted user message.
      if (existing) return fail(response, 409, 'Envía un nuevo mensaje para volver a intentarlo.');
      try { turn = turns.create({ conversationId: id, agentId: conversation.agente_id, userMessageId: last.id }); }
      catch { return fail(response, 503, 'No se pudo iniciar el turno.'); }
      const instructions = await loadAgent(conversation.agente_id);
      if (typeof instructions !== 'string' || !instructions.trim()) throw new Error();
      if (turns.get(turn.turnId)?.state !== 'processing') throw new Error();
      const content = await generate({ messages: [{ role: 'system', content: instructions },
        ...history.map(({ rol, contenido }) => ({ role: rol, content: contenido }))] });
      if (typeof content !== 'string' || !content.trim()) throw new Error();
      turns.completeWithPersistence(turn.turnId, () => {
        let messageId;
        database.exec('BEGIN');
        try {
          const current = database.prepare('SELECT id FROM mensajes WHERE conversacion_id = ? ORDER BY id DESC LIMIT 1').get(id);
          if (current?.id !== last.id) throw new Error();
          const timestamp = new Date().toISOString();
          const inserted = database.prepare('INSERT INTO mensajes (conversacion_id, rol, contenido, creado_en) VALUES (?, ?, ?, ?)')
            .run(id, 'assistant', content, timestamp);
          messageId = Number(inserted.lastInsertRowid);
          if (!Number.isSafeInteger(messageId) || messageId <= 0) throw new Error();
          database.prepare('UPDATE conversaciones SET actualizada_en = ? WHERE id = ?').run(timestamp, id);
          database.exec('COMMIT');
        } catch (error) { database.exec('ROLLBACK'); throw error; }
        return messageId;
      });
      return json(response, 200, { turnId: turn.turnId, state: 'completed', message: { role: 'assistant', content } });
    } catch {
      if (turn) {
        if (turns.get(turn.turnId)?.state === 'processing') turns.transition(turn.turnId, 'failed');
        return json(response, 502, { turnId: turn.turnId, state: turns.get(turn.turnId)?.state ?? 'expired', error: TURN_ERROR });
      }
      return fail(response, 502, TURN_ERROR.message);
    } finally {
      generating.delete(id);
    }
  }
  function getTurn(request, response, rawId, turnId) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return fail(response, 405, 'Método no permitido.');
    }
    if (!/^[1-9][0-9]*$/.test(rawId) || !Number.isSafeInteger(Number(rawId))
      || !isTurnId(turnId) || request.url.includes('?')) return fail(response, 400, 'Solicitud no válida.');
    const id = Number(rawId);
    try {
      if (!database.prepare('SELECT agente_id FROM conversaciones WHERE id = ?').get(id)) {
        return fail(response, 404, 'Turno no encontrado.');
      }
      const turn = turns.get(turnId);
      if (!turn || turn.conversationId !== id) return fail(response, 404, 'Turno no encontrado.');
      const body = { turnId, state: turn.state };
      if (turn.state === 'completed') {
        const message = database.prepare('SELECT id, rol, contenido FROM mensajes WHERE conversacion_id = ? ORDER BY id ASC')
          .all(id).find(message => message.id === turn.result.messageId && message.rol === 'assistant');
        if (!message) return fail(response, 404, 'Turno no encontrado.');
        body.message = { role: 'assistant', content: message.contenido };
      }
      if (turn.state === 'failed') body.error = turn.error;
      return json(response, 200, body);
    } catch { return fail(response, 500, 'No se pudo consultar el turno.'); }
  }
  return { respond, getTurn, isGenerating: (id) => generating.has(id) || Boolean(turns.findActive(id)) };
}

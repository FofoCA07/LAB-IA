import { generateChatReply } from './chat-ollama.js';

export function createChatHandler({ database, loadAgent, json, generate = generateChatReply }) {
  const generating = new Set();
  const fail = (response, status, error) => json(response, status, { error });
  async function respond(request, response, rawId) {
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
    if (generating.has(id)) return fail(response, 409, 'Ya se está generando una respuesta.');
    generating.add(id);
    let timer;
    try {
      const body = await Promise.race([(async () => {
        const chunks = []; let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 1024) throw new Error();
          chunks.push(chunk);
        }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      })(), new Promise((_, reject) => {
        timer = setTimeout(() => { request.destroy(); reject(new Error()); }, 5000);
      })]).catch(() => null);
      clearTimeout(timer);
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
      const instructions = await loadAgent(conversation.agente_id);
      if (typeof instructions !== 'string' || !instructions.trim()) throw new Error();
      const content = await generate({ messages: [{ role: 'system', content: instructions },
        ...history.map(({ rol, contenido }) => ({ role: rol, content: contenido }))] });
      if (typeof content !== 'string' || !content.trim()) throw new Error();
      database.exec('BEGIN');
      try {
        const current = database.prepare('SELECT id FROM mensajes WHERE conversacion_id = ? ORDER BY id DESC LIMIT 1').get(id);
        if (current?.id !== last.id) throw new Error();
        const timestamp = new Date().toISOString();
        database.prepare('INSERT INTO mensajes (conversacion_id, rol, contenido, creado_en) VALUES (?, ?, ?, ?)')
          .run(id, 'assistant', content, timestamp);
        database.prepare('UPDATE conversaciones SET actualizada_en = ? WHERE id = ?').run(timestamp, id);
        database.exec('COMMIT');
      } catch (error) { database.exec('ROLLBACK'); throw error; }
      return json(response, 200, { message: { role: 'assistant', content } });
    } catch {
      return fail(response, 502, 'No se pudo generar o guardar la respuesta. Intenta de nuevo más tarde.');
    } finally {
      clearTimeout(timer);
      generating.delete(id);
    }
  }
  return { respond, isGenerating: (id) => generating.has(id) };
}

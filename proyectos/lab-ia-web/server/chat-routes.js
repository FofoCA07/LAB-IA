import { createSessionGuard, readBoundedJson, AuthRequestError } from './security-http.js';

export const chatBodyLimits = Object.freeze({ conversation: 16 * 1024, message: 64 * 1024, respond: 1024 });

// This factory owns the complete HTTP boundary, with the same store as auth.
export function createPrivateChatRoutes({ store, database, chat, addUserMessage, json,
  checkAgents, listAgents, loadAgent }) {
  const guard = createSessionGuard(store);
  const validId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  async function conversations(request, response, path, body) {
    const isList = path === '/api/conversations';
    const match = /^\/api\/conversations\/([^/]+)(\/messages)?$/.exec(path);
    if (!isList && !match) {
      json(response, 404, { error: 'Endpoint no encontrado.' });
      return;
    }

    const isMessages = Boolean(match?.[2]);
    const allowed = isList ? ['GET', 'POST'] : isMessages ? ['POST'] : ['GET'];
    if (!allowed.includes(request.method)) {
      response.setHeader('Allow', allowed.join(', '));
      json(response, 405, { error: 'Método no permitido.' });
      return;
    }

    const id = isList ? null : Number(match[1]);
    if (!isList && (!/^[1-9][0-9]*$/.test(match[1]) || !Number.isSafeInteger(id))) {
      json(response, 400, { error: 'Identificador de conversación no válido.' });
      return;
    }

    try {
      if (isList && request.method === 'GET') {
        json(response, 200, database.prepare(`
          SELECT id, titulo, agente_id, modelo, workspace, creada_en, actualizada_en
          FROM conversaciones ORDER BY actualizada_en DESC
        `).all());
        return;
      }

      const conversation = isList ? null : database.prepare(`
        SELECT id, titulo, agente_id, modelo, workspace, creada_en, actualizada_en
        FROM conversaciones WHERE id = ?
      `).get(id);
      if (!isList && !conversation) {
        json(response, 404, { error: 'Conversación no encontrada.' });
        return;
      }
      if (request.method === 'GET') {
        const messages = database.prepare(`
          SELECT id, conversacion_id, rol, contenido, creado_en
          FROM mensajes WHERE conversacion_id = ? ORDER BY id ASC
        `).all(id);
        json(response, 200, { conversation, messages });
        return;
      }

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        json(response, 400, { error: 'Datos no válidos.' });
        return;
      }

      if (isList) {
        const fields = ['titulo', 'agente_id', 'modelo', 'workspace'];
        if (fields.some((field) => typeof body[field] !== 'string' || !body[field].trim())
          || !validId.test(body.agente_id)) {
          json(response, 400, { error: 'Datos de conversación no válidos.' });
          return;
        }
        const timestamp = new Date().toISOString();
        const created = database.prepare(`
          INSERT INTO conversaciones (titulo, agente_id, modelo, workspace, creada_en, actualizada_en)
          VALUES (?, ?, ?, ?, ?, ?)
          RETURNING id, titulo, agente_id, modelo, workspace, creada_en, actualizada_en
        `).get(...fields.map((field) => body[field].trim()), timestamp, timestamp);
        json(response, 201, created);
        return;
      }

      addUserMessage(body, response, id);
    } catch {
      if (!response.headersSent) {
        json(response, 500, { error: 'No se pudo procesar la conversación.' });
      }
    }
  }

  async function agents(request, response, path) {
    const isList = path === '/api/agents';
    const isDetail = path.startsWith('/api/agents/');

    if (!isList && !isDetail) {
      json(response, 404, { error: 'Endpoint no encontrado.' });
      return;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      json(response, 405, { error: 'Método no permitido.' });
      return;
    }

    const id = isDetail ? path.slice('/api/agents/'.length) : null;
    if (isDetail && !validId.test(id)) {
      json(response, 400, { error: 'Identificador de agente no válido.' });
      return;
    }

    try {
      await checkAgents();
      if (isList) {
        const agents = await listAgents();
        json(response, 200, agents);
        return;
      }

      const filename = `${id}.md`;
      try {
        const content = await loadAgent(id);
        json(response, 200, { id, filename, content });
      } catch (error) {
        if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) {
          json(response, 404, { error: 'Agente no encontrado.' });
        } else {
          throw error;
        }
      }
    } catch {
      if (!response.headersSent) {
        json(response, 500, { error: 'No se pudieron consultar los agentes.' });
      }
    }
  }

  return async function privateChat(request, response) {
    const path = (request.url ?? '').split('?')[0];
    if (!(path === '/api/agents' || path.startsWith('/api/agents/')
      || path === '/api/conversations' || path.startsWith('/api/conversations/'))) return false;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      guard(request);
      const turn = /^\/api\/conversations\/([^/]+)\/turns\/([^/]+)$/.exec(path);
      const respond = /^\/api\/conversations\/([^/]+)\/respond$/.exec(path);
      let body;
      if (request.method === 'POST' && (path === '/api/conversations'
        || /^\/api\/conversations\/[^/]+\/messages$/.test(path) || respond)) {
        const maxBytes = respond ? chatBodyLimits.respond : path === '/api/conversations'
          ? chatBodyLimits.conversation : chatBodyLimits.message;
        body = await readBoundedJson(request, { maxBytes });
        guard(request); // Expiry/revocation can happen while the body is streaming.
      }
      if (turn) chat.getTurn(request, response, turn[1], turn[2]);
      else if (respond) await chat.respond(request, response, respond[1], body);
      else if (path.startsWith('/api/agents')) await agents(request, response, path);
      else await conversations(request, response, path, body);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        response.setHeader('Connection', 'close');
        response.once?.('finish', () => request.destroy());
        json(response, error instanceof AuthRequestError ? error.status : 500,
          { error: 'No se pudo autorizar o procesar la solicitud del chat.' });
      }
    }
    return true;
  };
}

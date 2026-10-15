import { Buffer } from 'node:buffer';

// HTTP surface deliberately exposes neither creation nor private-result consumption.
export function createActionHandlers({ store, json }) {
  function list(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return json(response, 405, { code: 'METHOD', error: 'Método no permitido.' });
    }
    return json(response, 200, store.listActions());
  }
  async function decision(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const invalid = () => json(response, 400, { code: 'INVALID_REQUEST', error: 'Solicitud no válida.' });
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return json(response, 405, { code: 'METHOD', error: 'Método no permitido.' });
    }
    if (request.url.includes('?')) return invalid();
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return json(response, 415, { code: 'CONTENT_TYPE', error: 'Se requiere application/json.' });
    }
    if (request.headers.origin) {
      let origin;
      try { origin = new URL(request.headers.origin); } catch { /* Rejected below. */ }
      if (!origin || !['http:', 'https:'].includes(origin.protocol) || origin.host !== request.headers.host) {
        return json(response, 403, { code: 'ORIGIN', error: 'Origen no permitido.' });
      }
    }
    let body; let timer;
    try {
      body = await Promise.race([(async () => {
        const chunks = []; let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 1024) throw new Error();
          chunks.push(chunk);
        }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      })(), new Promise((_, reject) => {
        timer = setTimeout(() => { request.destroy(); reject(new Error()); }, 5000);
      })]);
    } catch { return invalid(); }
    finally { clearTimeout(timer); }
    const result = await store.decide(body);
    return json(response, result.status, result.body);
  }
  return Object.freeze({ list, decision });
}

import { createSessionGuard, readBoundedJson, AuthRequestError } from './security-http.js';

export const actionDecisionBodyLimit = 1024;

// HTTP exposes neither action creation nor private-result consumption.
export function createActionHandlers({ store, securityStore, json }) {
  const guard = createSessionGuard(securityStore);
  function reject(request, response, error) {
    if (response.headersSent || response.destroyed) return;
    response.setHeader('Connection', 'close');
    response.once?.('finish', () => request.destroy());
    return json(response, error instanceof AuthRequestError ? error.status : 500,
      { error: 'No se pudo autorizar o procesar la solicitud de acciones.' });
  }
  function list(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return json(response, 405, { code: 'METHOD', error: 'Método no permitido.' });
    }
    try {
      guard(request);
      return json(response, 200, store.listActions());
    } catch (error) { return reject(request, response, error); }
  }
  async function decision(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return json(response, 405, { code: 'METHOD', error: 'Método no permitido.' });
    }
    try {
      guard(request);
      if (request.url.includes('?')) throw new AuthRequestError(400);
      const body = await readBoundedJson(request, { maxBytes: actionDecisionBodyLimit });
      guard(request); // Expiry/logout during body streaming must not claim an action.
      const result = await store.decide(body);
      return json(response, result.status, result.body);
    } catch (error) { return reject(request, response, error); }
  }
  return Object.freeze({ list, decision });
}

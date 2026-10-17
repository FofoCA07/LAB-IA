import { getSession } from './auth';

// Authority belongs to the mounted private view; no storage and no automatic retries.
export function createLabApi(csrfToken, onSessionExpired) {
  let expired = false;
  function invalidate() {
    if (!expired) {
      expired = true;
      onSessionExpired();
    }
  }
  async function request(path, method, body, { signal } = {}) {
    if (expired) throw new Error('La sesión terminó. Empareja el dispositivo de nuevo.');
    const isChat = /^\/api\/lab\/api\/(?:agents(?:\/[^/?]+)?|conversations(?:\/[^/?]+(?:\/messages|\/respond|\/turns\/[^/?]+)?)?)$/.test(path);
    const isActions = (method === 'GET' && path === '/api/lab/api/actions')
      || (method === 'POST' && path === '/api/lab/api/actions/decision');
    if (!isChat && !isActions) {
      throw new Error('Solicitud privada no válida.');
    }
    let response;
    try {
      response = await fetch(path, {
        method, signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: method === 'GET' ? { 'X-Lab-Request': '1' }
          : { 'Content-Type': 'application/json', 'X-Lab-CSRF': csrfToken },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error('No se pudo conectar con LAB-IA.');
    }
    if (response.status === 401) {
      invalidate();
      throw new Error('La sesión terminó. Empareja el dispositivo de nuevo.');
    }
    if (response.status === 403) {
      // Check authority without repeating the operation that was rejected.
      try {
        const session = await getSession();
        if (!session.authenticated) invalidate();
      } catch { /* A network error alone does not prove session expiry. */ }
      throw new Error('No se pudo autorizar la solicitud. Comprueba tu sesión.');
    }
    return response;
  }
  return {
    privateGet: (path, options) => request(path, 'GET', undefined, options),
    privatePost: (path, body, options) => request(path, 'POST', body, options),
  };
}

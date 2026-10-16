import { securityDefaults, isSecurityToken } from './security-store.js';
import { createRequestValidator, readBoundedJson, AuthRequestError,
  readSessionCookie, sessionCookie, requireCsrf } from './security-http.js';

const routes = Object.freeze({ '/api/auth/pair': 'POST', '/api/auth/session': 'GET', '/api/auth/logout': 'POST' });
export function createAuthHandler({ store, json, validateRequest = createRequestValidator() }) {
  return async function auth(request, response) {
    const path = (request.url ?? '').split('?')[0];
    if (!Object.hasOwn(routes, path)) return false;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const error = status => {
      if (!response.headersSent && !response.destroyed) {
        response.setHeader('Connection', 'close');
        response.once?.('finish', () => request.destroy());
        json(response, status, { error: 'Solicitud de autenticación no válida.' });
      }
    };
    try {
      if (request.method !== routes[path]) {
        response.setHeader('Allow', routes[path]); error(405); return true;
      }
      if (!validateRequest(request)) { error(403); return true; }
      if (request.url.includes('?')) { error(400); return true; }
      const sessionId = readSessionCookie(request);
      if (path === '/api/auth/session') {
        if (request.headers['transfer-encoding'] !== undefined
          || (request.headers['content-length'] !== undefined && request.headers['content-length'] !== '0')) {
          error(400); return true;
        }
        const session = store.getSession(sessionId);
        json(response, 200, session ? { authenticated: true, csrfToken: session.csrfToken } : { authenticated: false });
        return true;
      }
      if (path === '/api/auth/logout') {
        if (!store.getSession(sessionId, { touch: false })) { error(401); return true; }
        if (!requireCsrf(store, request)) { error(403); return true; }
      }
      const body = await readBoundedJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)) { error(400); return true; }
      if (path === '/api/auth/pair') {
        if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'code') || !isSecurityToken(body.code)) {
          error(400); return true;
        }
        const result = store.pair(body.code);
        if (result.status === 'limited') {
          response.setHeader('Retry-After', String(result.retryAfterSeconds)); error(429); return true;
        }
        if (result.status !== 'paired') { error(result.status === 'unavailable' ? 503 : 401); return true; }
        response.setHeader('Set-Cookie', sessionCookie(result.sessionId, securityDefaults.absoluteTimeoutMs / 1000));
        json(response, 200, { authenticated: true });
      } else {
        if (Object.keys(body).length !== 0) { error(400); return true; }
        // Recheck after async body parsing: expiry or another logout may have intervened.
        if (!store.getSession(sessionId, { touch: false })) { error(401); return true; }
        if (!requireCsrf(store, request)) { error(403); return true; }
        store.revokeSession(sessionId);
        response.setHeader('Set-Cookie', sessionCookie('', 0));
        json(response, 200, { authenticated: false });
      }
    } catch (cause) { error(cause instanceof AuthRequestError ? cause.status : 500); }
    return true;
  };
}

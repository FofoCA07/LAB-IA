// The Vite proxy preserves the browser's Host (changeOrigin is not enabled).
// Fixed development origins only; no request/forwarded header creates trust.
export const authOrigins = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

export function createRequestValidator(origins = authOrigins) {
  const allowed = new Map(origins.map(origin => {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)
      || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Invalid auth origin.');
    return [url.host, origin];
  }));
  return request => {
    const expected = allowed.get(request.headers.host);
    if (!expected) return false;
    const origin = request.headers.origin;
    // GET fetches commonly omit Origin; require explicit application intent.
    // This header is not authentication: the session still grants authority.
    if (request.method === 'GET') {
      return (origin === undefined || origin === expected)
        && request.headers['x-lab-request'] === '1'
        && (request.headers['sec-fetch-site'] === undefined || request.headers['sec-fetch-site'] === 'same-origin');
    }
    return origin === expected
      && (request.headers['sec-fetch-site'] === undefined || request.headers['sec-fetch-site'] === 'same-origin');
  };
}

export class AuthRequestError extends Error {
  constructor(status) { super('Invalid auth request.'); this.status = status; }
}

export async function readBoundedJson(request, { maxBytes = 1024, timeoutMs = 5000 } = {}) {
  if (typeof request.headers['content-type'] !== 'string'
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'])) {
    throw new AuthRequestError(415);
  }
  const length = request.headers['content-length'];
  if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length))) {
    throw new AuthRequestError(400);
  }
  if (length !== undefined && Number(length) > maxBytes) throw new AuthRequestError(413);
  let timer;
  try {
    return await Promise.race([(async () => {
      const chunks = []; let size = 0;
      // Keep the socket until the caller can send its fixed error response.
      // On rejection consumption stops; auth closes the connection after flush.
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > maxBytes) throw new AuthRequestError(413);
        chunks.push(bytes);
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    })(), new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new AuthRequestError(408));
        request.pause();
      }, timeoutMs);
    })]);
  } catch (error) {
    request.pause();
    throw error instanceof AuthRequestError ? error : new AuthRequestError(400);
  } finally { clearTimeout(timer); }
}

export const SESSION_COOKIE = 'lab_session';
export function readSessionCookie(request) {
  const header = request.headers.cookie;
  if (typeof header !== 'string' || header.length > 8192) return undefined;
  const values = header.split(';').map(part => part.trim())
    .filter(part => part.split('=', 1)[0] === SESSION_COOKIE);
  if (values.length !== 1) return undefined; // Never choose among ambiguous cookies.
  return values[0].slice(SESSION_COOKIE.length + 1);
}

export function sessionCookie(sessionId, maxAge) {
  // Local HTTP development only. HTTPS deployment must add Secure.
  return `${SESSION_COOKIE}=${sessionId}; Path=/api/lab; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
}

export function requireCsrf(store, request) {
  return store.validateCsrf(readSessionCookie(request), request.headers['x-lab-csrf']);
}

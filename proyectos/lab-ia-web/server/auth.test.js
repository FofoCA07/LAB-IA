import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createSecurityStore } from './security-store.js';
import { createAuthHandler } from './auth.js';
import { createRequestValidator, readBoundedJson, requireCsrf } from './security-http.js';

const host = 'localhost:5173';
const origin = 'http://localhost:5173';
function fixture() {
  let time = 0;
  const store = createSecurityStore({ now: () => time, wallNow: () => time });
  const handler = createAuthHandler({ store, json(response, status, body) { response.status = status; response.body = body; } });
  async function request(path, { method = path === '/api/auth/session' ? 'GET' : 'POST', body = {},
    raw, chunks, headers = {} } = {}) {
    const req = Readable.from(chunks ?? [Buffer.from(raw ?? JSON.stringify(body))]);
    Object.assign(req, { url: path, method, headers: { host, origin, 'content-type': 'application/json',
      'x-lab-request': '1', ...headers } });
    const response = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; } };
    response.handled = await handler(req, response);
    return response;
  }
  async function pair() {
    const code = store.createPairing();
    const response = await request('/api/auth/pair', { body: { code } });
    assert.equal(response.status, 200);
    const cookie = response.headers['set-cookie'].split(';')[0];
    return { code, cookie, id: cookie.slice('lab_session='.length), response };
  }
  return { store, request, pair, setTime(value) { time = value; } };
}

test('pair creates only opaque HttpOnly cookie, no credentials or timestamps in JSON', async () => {
  const f = fixture(); const p = await f.pair();
  assert.deepEqual(p.response.body, { authenticated: true });
  assert.match(p.response.headers['set-cookie'], /^lab_session=[A-Za-z0-9_-]{43}; Path=\/api\/lab; HttpOnly; SameSite=Strict; Max-Age=28800$/);
  assert.doesNotMatch(p.response.headers['set-cookie'], /Domain=|Secure|csrf/i);
  assert.equal(p.response.headers['cache-control'], 'no-store');
  assert.equal(p.response.headers['x-content-type-options'], 'nosniff');
  assert.equal(p.response.headers['referrer-policy'], 'no-referrer');
  assert.equal(JSON.stringify(p.response.body).includes(p.id), false);
  assert.equal(JSON.stringify(p.response).includes(p.code), false);
});

test('invalid, expired, reused and absent pairing have identical safe failure', async () => {
  const f = fixture(); const code = f.store.createPairing();
  const wrong = await f.request('/api/auth/pair', { body: { code: 'A'.repeat(43) } });
  f.setTime(120_000);
  const expired = await f.request('/api/auth/pair', { body: { code } });
  assert.equal(expired.status, 401); assert.deepEqual(wrong.body, expired.body);
  const p = await f.pair();
  const reused = await f.request('/api/auth/pair', { body: { code: p.code } });
  assert.equal(reused.status, 401); assert.deepEqual(reused.body, wrong.body);
  assert.equal(reused.headers['set-cookie'], undefined);
});

test('concurrent HTTP exchanges mint exactly one cookie', async () => {
  const f = fixture(); const code = f.store.createPairing();
  const results = await Promise.all([1, 2].map(() => f.request('/api/auth/pair', { body: { code } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 401]);
  assert.equal(results.filter(r => r.headers['set-cookie']).length, 1);
});

test('HTTP pairing rate limit has bounded retry hint and cannot be bypassed with forwarded IP', async () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) {
    assert.equal((await f.request('/api/auth/pair', { body: { code: 'A'.repeat(43) },
      headers: { 'x-forwarded-for': `10.0.0.${i}` } })).status, 401);
  }
  const code = f.store.createPairing();
  const limited = await f.request('/api/auth/pair', { body: { code } });
  assert.equal(limited.status, 429); assert.equal(limited.headers['retry-after'], '60');
  assert.equal(limited.headers['set-cookie'], undefined);
  f.setTime(60_000); assert.equal((await f.request('/api/auth/pair', { body: { code } })).status, 200);
});

for (const [name, options, status] of [
  ['extra field', { body: { code: 'A'.repeat(43), role: 'owner' } }, 400],
  ['missing code', { body: {} }, 400],
  ['array', { body: [] }, 400],
  ['null', { raw: 'null' }, 400],
  ['unbounded code', { body: { code: 'A'.repeat(300) } }, 400],
  ['wrong type', { body: { code: 123 } }, 400],
  ['invalid JSON', { raw: '{bad' }, 400],
  ['invalid UTF-8', { chunks: [Buffer.from([0xff])] }, 400],
  ['wrong content type', { headers: { 'content-type': 'text/plain' } }, 415],
  ['missing content type', { headers: { 'content-type': undefined } }, 415],
  ['declared oversized body', { headers: { 'content-length': '1025' } }, 413],
  ['streamed oversized body', { chunks: [Buffer.alloc(800), Buffer.alloc(225)] }, 413],
  ['query parameters', { query: '?code=PRIVATE' }, 400],
]) {
  test(`pair rejects ${name} without issuing authority`, async () => {
    const f = fixture(); const code = f.store.createPairing();
    const response = await f.request('/api/auth/pair' + (options.query ?? ''), options);
    assert.equal(response.status, status); assert.equal(response.headers['set-cookie'], undefined);
    assert.deepEqual(response.body, { error: 'Solicitud de autenticación no válida.' });
    assert.equal(JSON.stringify(response).includes(code), false);
    assert.equal(f.store.pair(code).status, 'paired');
  });
}

test('session GET never reveals IDs and returns CSRF only for valid sessions', async () => {
  const f = fixture();
  for (const cookie of [undefined, '', 'lab_session=bad', 'lab_session=' + 'A'.repeat(43)]) {
    const response = await f.request('/api/auth/session', { headers: { cookie } });
    assert.equal(response.status, 200); assert.deepEqual(response.body, { authenticated: false });
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  const p = await f.pair();
  const response = await f.request('/api/auth/session', { headers: { cookie: p.cookie, origin: undefined } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { authenticated: true, csrfToken: f.store.getSession(p.id).csrfToken });
  assert.equal(JSON.stringify(response).includes(p.id), false);
  assert.equal(JSON.stringify(response).includes(p.code), false);
});

test('duplicate session cookies fail closed', async () => {
  const f = fixture(); const p = await f.pair();
  const response = await f.request('/api/auth/session', { headers: { cookie: `${p.cookie}; ${p.cookie}` } });
  assert.deepEqual(response.body, { authenticated: false });
});

for (const [name, csrf] of [['missing', undefined], ['incorrect', 'A'.repeat(43)]]) {
  test(`logout rejects ${name} CSRF and preserves session`, async () => {
    const f = fixture(); const p = await f.pair();
    const response = await f.request('/api/auth/logout', { headers: { cookie: p.cookie, 'x-lab-csrf': csrf } });
    assert.equal(response.status, 403); assert.ok(f.store.getSession(p.id));
    assert.equal(response.headers['set-cookie'], undefined);
  });
}

test('logout rejects CSRF from a different session', async () => {
  const f = fixture(); const a = await f.pair(); const b = await f.pair();
  const csrf = f.store.getSession(b.id).csrfToken;
  const response = await f.request('/api/auth/logout', { headers: { cookie: a.cookie, 'x-lab-csrf': csrf } });
  assert.equal(response.status, 403); assert.ok(f.store.getSession(a.id));
});

test('logout revokes session, immediately expires cookie, and stale cookie cannot authenticate', async () => {
  const f = fixture(); const p = await f.pair(); const csrf = f.store.getSession(p.id).csrfToken;
  const headers = { cookie: p.cookie, 'x-lab-csrf': csrf };
  assert.equal(requireCsrf(f.store, { headers }), true);
  const response = await f.request('/api/auth/logout', { headers });
  assert.equal(response.status, 200); assert.deepEqual(response.body, { authenticated: false });
  assert.equal(response.headers['set-cookie'], 'lab_session=; Path=/api/lab; HttpOnly; SameSite=Strict; Max-Age=0');
  assert.deepEqual((await f.request('/api/auth/session', { headers })).body, { authenticated: false });
  assert.equal((await f.request('/api/auth/logout', { headers })).status, 401);
});

test('logout requires session and exact empty JSON object', async () => {
  const f = fixture(); assert.equal((await f.request('/api/auth/logout')).status, 401);
  const p = await f.pair(); const csrf = f.store.getSession(p.id).csrfToken;
  const response = await f.request('/api/auth/logout', { body: { extra: true }, headers: { cookie: p.cookie, 'x-lab-csrf': csrf } });
  assert.equal(response.status, 400); assert.ok(f.store.getSession(p.id));
});

for (const route of ['/api/auth/pair', '/api/auth/session', '/api/auth/logout']) {
  test(`${route}: Host, Origin and forwarded headers never create trust`, async () => {
    const f = fixture();
    for (const headers of [
      { host: 'evil.test:5173' }, { host: '127.0.0.1:3001' }, { host: undefined },
      { origin: 'http://evil.test' }, { origin: 'null' }, { origin: 'https://localhost:5173' },
      { origin: 'http://localhost:5174' }, { origin: 'http://localhost:5173/' },
      { host: 'evil.test', 'x-forwarded-host': host, 'x-forwarded-proto': 'http', 'x-forwarded-for': '127.0.0.1' },
      { origin: 'http://127.0.0.1:5173' }, { 'sec-fetch-site': 'cross-site' },
    ]) {
      const response = await f.request(route, { headers });
      assert.equal(response.status, 403); assert.equal(response.headers['set-cookie'], undefined);
      assert.deepEqual(response.body, { error: 'Solicitud de autenticación no válida.' });
    }
    assert.equal((await f.request(route, { method: 'DELETE' })).status, 405);
  });
}

test('POST requires Origin; GET requires explicit app header when Origin is absent', async () => {
  const f = fixture();
  assert.equal((await f.request('/api/auth/pair', { headers: { origin: undefined } })).status, 403);
  assert.equal((await f.request('/api/auth/logout', { headers: { origin: undefined } })).status, 403);
  assert.equal((await f.request('/api/auth/session', { headers: { origin: undefined, 'x-lab-request': undefined } })).status, 403);
  assert.deepEqual((await f.request('/api/auth/session', { headers: { origin: undefined } })).body, { authenticated: false });
});

test('explicit IPv4 Vite origin is supported; forwarded headers do not override real origin', async () => {
  const f = fixture(); const code = f.store.createPairing();
  const response = await f.request('/api/auth/pair', { body: { code }, headers: {
    host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'x-forwarded-host': 'evil.test',
  } });
  assert.equal(response.status, 200);
});

test('auth handler leaves existing API untouched and owns no generator/diagnostic endpoint', async () => {
  const f = fixture();
  for (const route of ['/api/conversations', '/api/workspaces', '/api/actions', '/api/auth/create-pairing', '/api/auth/debug']) {
    const response = await f.request(route); assert.equal(response.handled, false);
    assert.deepEqual(response.headers, {}); assert.equal(response.body, undefined);
  }
});

test('refresh and two tabs share cookie/CSRF until idle expiry; restart invalidates cookie', async () => {
  const f = fixture(); const p = await f.pair(); const headers = { cookie: p.cookie };
  const a = await f.request('/api/auth/session', { headers });
  const b = await f.request('/api/auth/session', { headers });
  assert.deepEqual(a.body, b.body);
  f.setTime(1_800_000);
  assert.deepEqual((await f.request('/api/auth/session', { headers })).body, { authenticated: false });
  const restarted = fixture();
  assert.deepEqual((await restarted.request('/api/auth/session', { headers })).body, { authenticated: false });
});

test('bounded parser accepts UTF-8 JSON and stops consuming a stalled stream on timeout', async () => {
  const req = Readable.from([Buffer.from('{"code":"hola"}')]);
  req.headers = { 'content-type': 'application/json; charset=utf-8' };
  assert.deepEqual(await readBoundedJson(req), { code: 'hola' });
  const stalled = new Readable({ read() {} }); stalled.headers = { 'content-type': 'application/json' };
  await assert.rejects(readBoundedJson(stalled, { timeoutMs: 10 }), error => error.status === 408);
  assert.equal(stalled.isPaused(), true);
  stalled.destroy(); // The HTTP handler closes after flushing its safe error.
});

test('unexpected internal failures return fixed errors without credentials or diagnostics', async () => {
  const secret = 'PRIVATE_KEY_COOKIE_SQL_STACK';
  const handler = createAuthHandler({ store: { pair() { throw new Error(secret); } },
    json(response, status, body) { response.status = status; response.body = body; } });
  const request = Readable.from([JSON.stringify({ code: 'A'.repeat(43) })]);
  Object.assign(request, { method: 'POST', url: '/api/auth/pair',
    headers: { host, origin, 'content-type': 'application/json' } });
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
  assert.equal(await handler(request, response), true);
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: 'Solicitud de autenticación no válida.' });
  assert.equal(JSON.stringify(response).includes(secret), false);
});

test('request validator rejects invalid server-side origin configuration', () => {
  for (const origin of ['http://evil.test:5173', 'http://localhost:5173/path', 'ftp://localhost:5173']) {
    assert.throws(() => createRequestValidator([origin]));
  }
});

test('real HTTP auth transport preserves cookies, bounded errors and logout without external services', async t => {
  const store = createSecurityStore();
  const handler = createAuthHandler({ store, json(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  } });
  const server = createServer(async (request, response) => {
    if (!await handler(request, response)) { response.writeHead(404); response.end(); }
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const send = (path, { method = 'POST', body = '{}', headers = {}, chunked = false } = {}) =>
    new Promise((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path, method,
        agent: false, headers: { host, origin, 'x-lab-request': '1', 'content-type': 'application/json',
          ...(chunked ? { 'transfer-encoding': 'chunked' } : { 'content-length': Buffer.byteLength(body) }), ...headers } }, response => {
        let text = '';
        response.setEncoding('utf8'); response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(text) }));
      });
      request.on('error', reject); request.setTimeout(2000, () => request.destroy(new Error('Auth test timeout.')));
      request.end(body);
    });
  const code = store.createPairing();
  const paired = await send('/api/auth/pair', { body: JSON.stringify({ code }) });
  assert.equal(paired.status, 200); assert.deepEqual(paired.body, { authenticated: true });
  const cookie = paired.headers['set-cookie'][0].split(';')[0];
  const session = await send('/api/auth/session', { method: 'GET', body: '', headers: { cookie } });
  assert.equal(session.status, 200); assert.equal(session.body.authenticated, true);
  for (const options of [{ body: ' '.repeat(1025) }, { body: ' '.repeat(1025), chunked: true }]) {
    const oversized = await send('/api/auth/pair', options);
    assert.equal(oversized.status, 413);
    assert.deepEqual(oversized.body, { error: 'Solicitud de autenticación no válida.' });
  }
  const logout = await send('/api/auth/logout', { headers: { cookie, 'x-lab-csrf': session.body.csrfToken } });
  assert.equal(logout.status, 200); assert.deepEqual(logout.body, { authenticated: false });
  const stale = await send('/api/auth/session', { method: 'GET', body: '', headers: { cookie } });
  assert.deepEqual(stale.body, { authenticated: false });
});

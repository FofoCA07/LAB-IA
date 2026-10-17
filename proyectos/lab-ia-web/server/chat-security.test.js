import test from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createSecurityStore } from './security-store.js';
import { createAuthHandler } from './auth.js';
import { createChatHandler } from './chat.js';
import { createTurnStore } from './turn-store.js';
import { createPublicMessageHandler } from './conversation-messages.js';
import { createPrivateChatRoutes, chatBodyLimits } from './chat-routes.js';

const host = 'localhost:5173';
const origin = `http://${host}`;
const secret = 'PRIVATE_PROMPT_AND_HISTORY';
const creation = { titulo: 'Title', agente_id: 'senior-developer', modelo: 'qwen3:8b', workspace: '/workspace' };
function fixture(t) {
  let time = 0;
  const store = createSecurityStore({ now: () => time, wallNow: () => time });
  const database = new DatabaseSync(':memory:');
  t.after(() => database.close());
  database.exec(`CREATE TABLE conversaciones (id INTEGER PRIMARY KEY, titulo TEXT, agente_id TEXT, modelo TEXT,
    workspace TEXT, creada_en TEXT, actualizada_en TEXT);
    CREATE TABLE mensajes (id INTEGER PRIMARY KEY, conversacion_id INTEGER, rol TEXT, contenido TEXT, creado_en TEXT);
    INSERT INTO conversaciones VALUES (1,'Private title','senior-developer','qwen3:8b','/private','before','before');
    INSERT INTO mensajes VALUES (1,1,'user','${secret}','before');`);
  const json = (response, status, body) => {
    if (response.end) {
      response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body));
    } else { response.status = status; response.body = body; }
  };
  const loaded = []; const generated = [];
  const loadAgent = async id => { loaded.push(id); return secret; };
  const turns = createTurnStore();
  const chat = createChatHandler({ database, turns, json, loadAgent,
    generate: async input => { generated.push(input); return 'Mock assistant'; } });
  const addUserMessage = createPublicMessageHandler({ database, chat, json });
  const routes = createPrivateChatRoutes({ store, database, chat, addUserMessage, json, loadAgent,
    checkAgents: async () => {}, listAgents: async () => [{ id: 'senior-developer', filename: 'senior-developer.md' }] });
  const auth = createAuthHandler({ store, json });
  const session = store.pair(store.createPairing());
  const cookie = `lab_session=${session.sessionId}`;
  const csrf = store.getSession(session.sessionId).csrfToken;
  const snapshot = () => JSON.stringify({ conversations: database.prepare('SELECT * FROM conversaciones').all(),
    messages: database.prepare('SELECT * FROM mensajes').all() });
  async function request(path, { method = 'GET', body = {}, headers = {}, raw, chunks } = {}) {
    const req = Readable.from(chunks ?? [Buffer.from(raw ?? JSON.stringify(body))]);
    Object.assign(req, { method, url: path, headers: { host, origin, cookie,
      'x-lab-request': '1', 'x-lab-csrf': csrf, 'content-type': 'application/json', ...headers } });
    const response = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } };
    response.handled = await routes(req, response);
    return response;
  }
  return { routes, auth, store, database, generated, loaded, turns, request, cookie, csrf, session, snapshot,
    setTime(value) { time = value; } };
}

const getPaths = ['/api/agents', '/api/agents/senior-developer', '/api/conversations', '/api/conversations/1',
  '/api/conversations/1/turns/00000000-0000-4000-8000-000000000001'];
for (const path of getPaths) test(`private GET boundary: ${path}`, async t => {
  const f = fixture(t);
  const denied = await f.request(path, { headers: { cookie: undefined } });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers['cache-control'], 'no-store');
  assert.deepEqual(denied.body, { error: 'No se pudo autorizar o procesar la solicitud del chat.' });
  assert.deepEqual(f.loaded, []);
  assert.equal((await f.request(path, { headers: { 'x-lab-request': undefined } })).status, 403);
  for (const headers of [{ host: 'evil.test' }, { origin: 'http://evil.test' }, { 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await f.request(path, { headers })).status, 403);
  }
  const turn = f.turns.create({ conversationId: 1, agentId: 'senior-developer', userMessageId: 1 });
  const actual = path.includes('/turns/') ? `/api/conversations/1/turns/${turn.turnId}` : path;
  const allowed = await f.request(actual, { headers: { 'x-lab-csrf': undefined, origin: undefined } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers['cache-control'], 'no-store');
});

for (const [path, body, success] of [
  ['/api/conversations', creation, 201],
  ['/api/conversations/1/messages', { content: 'new user' }, 201],
  ['/api/conversations/1/respond', {}, 200],
]) test(`private POST boundary and zero unauthorized side effects: ${path}`, async t => {
  const f = fixture(t);
  const initial = f.snapshot();
  for (const [headers, status] of [
    [{ cookie: undefined }, 401], [{ 'x-lab-csrf': undefined }, 403], [{ 'x-lab-csrf': 'wrong' }, 403],
    [{ origin: 'http://evil.test' }, 403], [{ origin: undefined }, 403], [{ host: 'evil.test' }, 403],
    [{ 'sec-fetch-site': 'cross-site' }, 403], [{ 'content-type': 'text/plain' }, 415],
  ]) {
    const response = await f.request(path, { method: 'POST', body, headers });
    assert.equal(response.status, status);
    const serialized = JSON.stringify(response);
    for (const value of [secret, f.csrf, f.session.sessionId]) assert.ok(!serialized.includes(value));
    assert.equal(f.snapshot(), initial);
    assert.deepEqual(f.loaded, []); assert.deepEqual(f.generated, []);
    assert.equal(f.turns.findActive(1), null);
    assert.equal(f.turns.findForMessage(1, 1), null);
  }
  assert.equal((await f.request(path, { method: 'POST', body })).status, success);
});

test('authenticated create/user/respond/turn cycle preserves server-owned authority', async t => {
  const f = fixture(t);
  const created = await f.request('/api/conversations', { method: 'POST', body: creation });
  const id = created.body.id;
  const forged = await f.request(`/api/conversations/${id}/messages`, { method: 'POST', body: { content: 'x', role: 'assistant' } });
  assert.equal(forged.status, 400);
  const message = await f.request(`/api/conversations/${id}/messages`, { method: 'POST', body: { content: 'Only user' } });
  assert.equal(message.body.rol, 'user');
  const response = await f.request(`/api/conversations/${id}/respond`, { method: 'POST', body: {} });
  assert.equal(response.status, 200);
  assert.equal(response.body.state, 'completed');
  assert.deepEqual(f.generated, [{ messages: [{ role: 'system', content: secret }, { role: 'user', content: 'Only user' }] }]);
  assert.deepEqual(f.loaded, ['senior-developer']);
  assert.equal((await f.request(`/api/conversations/${id}/turns/${response.body.turnId}`)).body.message.role, 'assistant');
  assert.equal((await f.request(`/api/conversations/${id}/respond`, { method: 'POST' })).status, 409);
});

test('body limits apply to declared and streaming sizes; respond accepts only {}', async t => {
  const f = fixture(t);
  const initial = f.snapshot();
  for (const [path, limit] of [
    ['/api/conversations', chatBodyLimits.conversation], ['/api/conversations/1/messages', chatBodyLimits.message],
    ['/api/conversations/1/respond', chatBodyLimits.respond],
  ]) {
    assert.equal((await f.request(path, { method: 'POST', headers: { 'content-length': String(limit + 1) } })).status, 413);
    assert.equal((await f.request(path, { method: 'POST', chunks: [Buffer.alloc(limit, 32), Buffer.from('{}')] })).status, 413);
    assert.equal((await f.request(path, { method: 'POST', raw: '{bad' })).status, 400);
    assert.equal((await f.request(path, { method: 'POST', chunks: [Buffer.from([0xff])] })).status, 400);
  }
  for (const body of [null, [], { content: 'x' }, { csrf: f.csrf }]) {
    assert.equal((await f.request('/api/conversations/1/respond', { method: 'POST', body })).status, 400);
  }
  assert.equal(f.snapshot(), initial); assert.deepEqual(f.generated, []);
});

test('expiry, logout and backend restart invalidate the same cookie on every private route', async t => {
  const f = fixture(t);
  f.setTime(1_800_000);
  for (const path of getPaths) assert.equal((await f.request(path)).status, 401);
  for (const path of ['/api/conversations', '/api/conversations/1/messages', '/api/conversations/1/respond']) {
    assert.equal((await f.request(path, { method: 'POST' })).status, 401);
  }
  const other = fixture(t);
  const request = Readable.from([Buffer.from('{}')]);
  Object.assign(request, { method: 'POST', url: '/api/auth/logout',
    headers: { host, origin, cookie: other.cookie, 'x-lab-csrf': other.csrf, 'content-type': 'application/json' } });
  const response = { setHeader() {} };
  await other.auth(request, response);
  assert.equal(response.status, 200);
  for (const path of getPaths) assert.equal((await other.request(path)).status, 401);
  const restarted = fixture(t);
  assert.equal((await restarted.request('/api/conversations', { headers: { cookie: other.cookie } })).status, 401);
});

test('revocation during body streaming rejects before writes, turn creation or generation', async t => {
  const f = fixture(t);
  const initial = f.snapshot();
  const chunks = (async function* () {
    yield Buffer.from('{');
    f.store.revokeSession(f.session.sessionId);
    yield Buffer.from('}');
  })();
  assert.equal((await f.request('/api/conversations/1/respond', { method: 'POST', chunks })).status, 401);
  assert.equal(f.snapshot(), initial); assert.deepEqual(f.generated, []);
  assert.equal(f.turns.findForMessage(1, 1), null);
});

test('authorized activity touches session but rejected CSRF does not extend it', async t => {
  const f = fixture(t);
  f.setTime(1_799_999);
  assert.equal((await f.request('/api/conversations')).status, 200);
  f.setTime(1_800_001);
  assert.equal((await f.request('/api/conversations')).status, 200);
  const denied = fixture(t);
  denied.setTime(1_799_999);
  assert.equal((await denied.request('/api/conversations', { method: 'POST', headers: { 'x-lab-csrf': undefined } })).status, 403);
  denied.setTime(1_800_000);
  assert.equal((await denied.request('/api/conversations')).status, 401);
});

test('Actions, Workspaces and OpenCode are outside this boundary', async t => {
  const f = fixture(t);
  for (const path of ['/api/actions', '/api/actions/decision', '/api/workspaces', '/api/workspaces/active',
    '/api/workspaces/activate', '/api/opencode/status', '/api/opencode/workspace-summary',
    '/api/opencode/change-proposal', '/api/opencode/apply-change-proposal']) {
    for (const method of ['GET', 'POST']) {
      const result = await f.request(path, { method, headers: { cookie: undefined } });
      assert.equal(result.handled, false); assert.equal(result.status, undefined);
    }
  }
});

test('direct backend HTTP with :3001 Host has no loopback bypass, even with Vite Host spoofing', async t => {
  const f = fixture(t);
  const server = createServer(async (req, res) => {
    if (await f.auth(req, res)) return;
    if (!await f.routes(req, res)) { res.writeHead(404); res.end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function send(headers) {
    const req = httpRequest(`http://127.0.0.1:${server.address().port}/api/conversations`,
      { headers: { host: '127.0.0.1:3001', ...headers }, agent: false });
    req.end();
    const [res] = await once(req, 'response');
    let data = ''; for await (const chunk of res) data += chunk;
    return { status: res.statusCode, data };
  }
  for (const headers of [{}, { 'x-lab-request': '1' }, { host, 'x-lab-request': '1' }]) {
    const result = await send(headers);
    assert.equal(result.status, 401); assert.ok(!result.data.includes('Private title'));
  }
  assert.equal((await send({ host: 'evil.test', 'x-lab-request': '1' })).status, 403);
  assert.equal((await send({ cookie: f.cookie, 'x-lab-request': '1' })).status, 200);
});


test('real Vite proxy preserves HttpOnly cookie/session/CSRF contract without injected secrets', async t => {
  const f = fixture(t);
  const backend = createServer(async (req, res) => {
    if (await f.auth(req, res)) return;
    if (!await f.routes(req, res)) { res.writeHead(404); res.end(); }
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  t.after(() => new Promise(resolve => backend.close(resolve)));
  const { createServer: createVite } = await import('vite');
  const { default: config } = await import('../vite.config.js');
  const vite = await createVite({ configFile: false, logLevel: 'silent',
    cacheDir: '/tmp/lab-chat-security-vite-cache', optimizeDeps: { noDiscovery: true, entries: [] },
    server: { middlewareMode: true, hmr: false, proxy: { '/api/lab': {
      ...config.server.proxy['/api/lab'], target: `http://127.0.0.1:${backend.address().port}`,
    } } },
  });
  t.after(() => vite.close());
  const frontend = createServer(vite.middlewares);
  frontend.listen(0, '127.0.0.1');
  await once(frontend, 'listening');
  t.after(() => new Promise(resolve => frontend.close(resolve)));
  async function send(path, { method = 'GET', body, headers = {} } = {}) {
    const request = httpRequest(`http://127.0.0.1:${frontend.address().port}/api/lab${path}`, {
      method, agent: false, headers: { host, origin, 'x-lab-request': '1', ...headers },
    });
    request.end(body === undefined ? undefined : JSON.stringify(body));
    const [response] = await once(request, 'response');
    let data = ''; for await (const chunk of response) data += chunk;
    return { status: response.statusCode, headers: response.headers, body: JSON.parse(data) };
  }
  assert.equal((await send('/api/conversations')).status, 401);
  const paired = await send('/api/auth/pair', { method: 'POST', body: { code: f.store.createPairing() },
    headers: { 'content-type': 'application/json' } });
  assert.equal(paired.status, 200);
  assert.deepEqual(paired.body, { authenticated: true });
  assert.match(paired.headers['set-cookie'][0], /Path=\/api\/lab; HttpOnly; SameSite=Strict/);
  const cookie = paired.headers['set-cookie'][0].split(';')[0];
  const session = await send('/api/auth/session', { headers: { cookie } });
  assert.equal(session.body.authenticated, true);
  assert.equal((await send('/api/conversations', { headers: { cookie } })).status, 200);
  assert.equal((await send('/api/conversations', { method: 'POST', body: creation,
    headers: { cookie, 'content-type': 'application/json', 'x-lab-csrf': session.body.csrfToken } })).status, 201);
  assert.equal((await send('/api/conversations', { method: 'POST', body: creation,
    headers: { cookie, 'content-type': 'application/json' } })).status, 403);
});

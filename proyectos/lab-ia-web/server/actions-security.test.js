import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createActionStore } from './action-store.js';
import { createActionHandlers, actionDecisionBodyLimit } from './actions.js';
import { createSecurityStore } from './security-store.js';
import { createAuthHandler } from './auth.js';

const host = 'localhost:5173';
const origin = `http://${host}`;
const marker = 'PRIVATE_READ_CONTENT_DO_NOT_EXPOSE';
async function fixture(t, options = {}) {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'actions-auth-')));
  await mkdir(join(workspace, '.git'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  let actionTime = 0; let sessionTime = 0;
  const counts = { reads: 0, decisions: 0, lists: 0 };
  const store = createActionStore({ now: () => actionTime,
    getWorkspaceStatus: async () => ({ available: true, running: true, workspace }),
    git: async (cwd, args) => {
      assert.equal(cwd, workspace);
      if (args[0] !== 'rev-parse') throw Error('Unexpected Git operation');
      return args[1] === '--show-toplevel' ? workspace : join(workspace, '.git');
    },
    readFiles: async () => { counts.reads++; await options.readGate?.(); return [{ path: 'file.txt', content: marker }]; },
  });
  const action = await store.createReadAction({ agentId: 'senior-developer', agentName: 'Senior Developer', workspace,
    projectName: 'Test project', reason: 'Revisar archivo.', paths: ['file.txt'] });
  const securityStore = createSecurityStore({ now: () => sessionTime });
  const paired = securityStore.pair(securityStore.createPairing());
  const cookie = `lab_session=${paired.sessionId}`;
  const csrf = securityStore.getSession(paired.sessionId).csrfToken;
  const json = (response, status, body) => {
    if (response.end) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); }
    else Object.assign(response, { status, body });
  };
  const handlers = createActionHandlers({ securityStore, json, store: {
    listActions() { counts.lists++; return store.listActions(); },
    decide(body) { counts.decisions++; return store.decide(body); },
  } });
  const auth = createAuthHandler({ store: securityStore, json });
  async function request({ method = 'POST', decision = 'approve_once', body, headers = {}, chunks, raw } = {}) {
    const req = Readable.from(chunks ?? [Buffer.from(raw ?? JSON.stringify(body ?? { actionId: action.actionId, decision }))]);
    Object.assign(req, { method, url: method === 'GET' ? '/api/actions' : '/api/actions/decision',
      headers: { host, origin, cookie, 'x-lab-request': '1', 'x-lab-csrf': csrf,
        'content-type': 'application/json', ...headers } });
    const response = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } };
    if (method === 'GET') handlers.list(req, response); else await handlers.decision(req, response);
    return response;
  }
  return { workspace, store, action, securityStore, paired, cookie, csrf, handlers, auth, counts, request,
    setActionTime(time) { actionTime = time; }, setSessionTime(time) { sessionTime = time; } };
}
function safe(response, fixture) {
  const text = JSON.stringify(response.body);
  for (const value of [marker, fixture.workspace, fixture.paired.sessionId, fixture.csrf]) assert.ok(!text.includes(value));
  assert.doesNotMatch(text, /fingerprint|identity|repoRoot|gitDir|content|result/);
}

test('GET Actions requires session, intent and permitted Host, without accessing action metadata on rejection', async t => {
  const f = await fixture(t);
  for (const [headers, status] of [
    [{ cookie: undefined }, 401], [{ 'x-lab-request': undefined }, 403], [{ host: 'evil.test' }, 403],
    [{ origin: 'http://evil.test' }, 403], [{ 'sec-fetch-site': 'cross-site' }, 403],
  ]) {
    const result = await f.request({ method: 'GET', headers });
    assert.equal(result.status, status); assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(f.counts.lists, 0); safe(result, f);
    assert.ok(!JSON.stringify(result.body).includes(f.action.actionId));
  }
  const result = await f.request({ method: 'GET', headers: { 'x-lab-csrf': undefined, origin: undefined } });
  assert.equal(result.status, 200); assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal(result.body.actions[0].actionId, f.action.actionId); safe(result, f);
});

for (const decision of ['approve_once', 'deny']) test(`${decision}: unauthorized requests never call decide/read or consume actionId`, async t => {
  const f = await fixture(t);
  const original = f.store.listActions();
  const other = f.securityStore.pair(f.securityStore.createPairing());
  const wrongCsrf = f.securityStore.getSession(other.sessionId).csrfToken;
  for (const [headers, status] of [
    [{ cookie: undefined }, 401], [{ 'x-lab-csrf': undefined }, 403], [{ 'x-lab-csrf': 'wrong' }, 403],
    [{ 'x-lab-csrf': wrongCsrf }, 403], [{ origin: 'http://evil.test' }, 403], [{ origin: undefined }, 403],
    [{ host: 'evil.test' }, 403], [{ 'sec-fetch-site': 'cross-site' }, 403],
  ]) {
    let readBody = false;
    const chunks = (async function* () { readBody = true; yield Buffer.from('{}'); })();
    const result = await f.request({ decision, headers, chunks });
    assert.equal(result.status, status); assert.equal(readBody, false);
    assert.equal(f.counts.decisions, 0); assert.equal(f.counts.reads, 0);
    assert.deepEqual(f.store.listActions(), original); safe(result, f);
  }
  const allowed = await f.request({ decision });
  assert.equal(allowed.status, 200); safe(allowed, f);
  assert.equal(allowed.body.state, decision === 'deny' ? 'denied' : 'completed');
  assert.equal(f.counts.reads, decision === 'deny' ? 0 : 1);
  assert.equal((await f.request({ decision })).status, 409);
});

test('decision enforces exact schema, JSON and bounded declared/streamed bodies before state changes', async t => {
  const f = await fixture(t);
  const original = f.store.listActions();
  for (const extra of ['workspace', 'resources', 'reason', 'csrf', 'sessionId']) {
    const response = await f.request({ body: { actionId: f.action.actionId, decision: 'approve_once', [extra]: marker } });
    assert.equal(response.status, 400); safe(response, f);
  }
  for (const options of [
    { headers: { 'content-type': 'text/plain' }, status: 415 },
    { headers: { 'content-length': String(actionDecisionBodyLimit + 1) }, status: 413 },
    { chunks: [Buffer.alloc(actionDecisionBodyLimit, 32), Buffer.from('{}')], status: 413 },
    { raw: '{bad', status: 400 }, { chunks: [Buffer.from([0xff])], status: 400 },
  ]) assert.equal((await f.request(options)).status, options.status);
  assert.deepEqual(f.store.listActions(), original); assert.equal(f.counts.reads, 0);
  assert.equal((await f.request({ decision: 'deny' })).status, 200);
});

for (const decision of ['approve_once', 'deny']) test(`concurrent authorized ${decision} executes exactly once`, async t => {
  let release; let started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { readGate: async () => { started(); await gate; } });
  const first = f.request({ decision });
  if (decision === 'approve_once') await entered;
  const second = f.request({ decision });
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.counts.reads, decision === 'approve_once' ? 1 : 0);
  results.forEach(result => safe(result, f));
});

test('private read result remains internal and single-use; list, decision, errors and logs do not expose it', async t => {
  const f = await fixture(t);
  const logs = [];
  for (const method of ['log', 'warn', 'error', 'info', 'debug']) t.mock.method(console, method, (...args) => logs.push(args));
  const decision = await f.request();
  assert.deepEqual(decision.body, { state: 'completed', files: ['file.txt'] }); safe(decision, f);
  safe(await f.request({ method: 'GET' }), f);
  safe(await f.request(), f);
  const result = f.store.consumeCompletedReadResult(f.action.actionId);
  assert.deepEqual(result, [{ path: 'file.txt', content: marker }]);
  assert.equal(f.store.consumeCompletedReadResult(f.action.actionId), undefined);
  assert.equal(logs.length, 0);
});

for (const decision of ['approve_once', 'deny']) test(`expired action rejects ${decision} without reading`, async t => {
  const f = await fixture(t);
  f.setActionTime(600_000);
  assert.equal((await f.request({ method: 'GET' })).body.actions[0].state, 'expired');
  assert.equal((await f.request({ decision })).status, 409);
  assert.equal(f.counts.reads, 0);
  assert.equal(f.store.listActions().actions[0].state, 'expired');
});

for (const mode of ['expired', 'revoked']) test(`${mode} session cannot consume either decision`, async t => {
  const f = await fixture(t);
  if (mode === 'expired') f.setSessionTime(1_800_000);
  else f.securityStore.revokeSession(f.paired.sessionId);
  for (const decision of ['approve_once', 'deny']) assert.equal((await f.request({ decision })).status, 401);
  assert.equal((await f.request({ method: 'GET' })).status, 401);
  assert.equal(f.counts.decisions, 0); assert.equal(f.counts.reads, 0);
  assert.equal(f.store.listActions().actions[0].state, 'pending');
});

test('logout during body streaming is rechecked before decide', async t => {
  const f = await fixture(t);
  const chunks = (async function* () {
    yield Buffer.from('{'); f.securityStore.revokeSession(f.paired.sessionId);
    yield Buffer.from(`"actionId":"${f.action.actionId}","decision":"approve_once"}`);
  })();
  assert.equal((await f.request({ chunks })).status, 401);
  assert.equal(f.counts.decisions, 0); assert.equal(f.counts.reads, 0);
  assert.equal(f.store.listActions().actions[0].state, 'pending');
});

test('direct backend HTTP has no loopback or forwarded-Host bypass and shares logout authority', async t => {
  const f = await fixture(t);
  const server = createServer(async (req, res) => {
    if (await f.auth(req, res)) return;
    if (req.url === '/api/actions') f.handlers.list(req, res);
    else if (req.url === '/api/actions/decision') await f.handlers.decision(req, res);
    else { res.writeHead(404); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function send(path, method = 'GET', headers = {}) {
    const request = httpRequest(`http://127.0.0.1:${server.address().port}${path}`, {
      method, agent: false, headers: { host: '127.0.0.1:3001', 'x-lab-request': '1',
        origin: 'http://127.0.0.1:3001', 'content-type': 'application/json', ...headers },
    });
    request.end(method === 'POST' ? JSON.stringify(path === '/api/auth/logout' ? {}
      : { actionId: f.action.actionId, decision: 'deny' }) : undefined);
    const [response] = await once(request, 'response');
    let text = ''; for await (const chunk of response) text += chunk;
    return { status: response.statusCode, body: JSON.parse(text) };
  }
  assert.equal((await send('/api/actions')).status, 401);
  assert.equal((await send('/api/actions/decision', 'POST')).status, 401);
  assert.equal((await send('/api/actions', 'GET', { host: 'evil.test', 'x-forwarded-host': host })).status, 403);
  assert.equal(f.counts.decisions, 0); assert.equal(f.counts.lists, 0);
  assert.equal((await send('/api/actions', 'GET', { cookie: f.cookie })).status, 200);
  const logout = await send('/api/auth/logout', 'POST', { host, origin, cookie: f.cookie, 'x-lab-csrf': f.csrf });
  assert.equal(logout.status, 200);
  assert.equal((await send('/api/actions/decision', 'POST', { cookie: f.cookie, 'x-lab-csrf': f.csrf })).status, 401);
  assert.equal(f.store.listActions().actions[0].state, 'pending');
});

test('production wiring shares securityStore; public handlers cannot create or consume read actions', async () => {
  const index = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  assert.match(index, /createActionHandlers\(\{ store: actionStore, securityStore, json \}\)/);
  assert.match(index, /createAuthHandler\(\{ store: securityStore, json \}\)/);
  assert.match(index, /createChatReadPermission\(\{ actionStore, locks: proposalLocks/);
  for (const file of ['./chat.js', './chat-routes.js', '../src/Actions.jsx']) {
    assert.doesNotMatch(await readFile(new URL(file, import.meta.url), 'utf8'), /createReadAction|consumeCompletedReadResult/);
  }
});

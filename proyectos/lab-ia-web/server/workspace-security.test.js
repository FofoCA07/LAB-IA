import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createSecurityStore } from './security-store.js';
import { createWorkspaceLocks } from './proposal-store.js';
import { createPrivateWorkspaceRoutes, workspaceBodyLimits } from './workspace-routes.js';

const host = 'localhost:5173';
const origin = `http://${host}`;
const workspace = '/private/test-project';
const marker = 'PRIVATE_PROMPT_RAW_OUTPUT';
const summary = { tipo: 'Test', elementos: ['package.json'], proposito: 'Simulado', limitaciones: 'Sin ejecutar procesos' };
const reviewer = () => ({ name: 'reviewer', mode: 'primary', tools: { edit: false, write: false, task: false, bash: false },
  permission: [{ permission: '*', pattern: '*', action: 'deny' }] });
function fixture(overrides = {}) {
  let time = 0; let active = '/private/previous';
  const securityStore = createSecurityStore({ now: () => time });
  const session = securityStore.pair(securityStore.createPairing());
  const cookie = `lab_session=${session.sessionId}`;
  const csrf = securityStore.getSession(session.sessionId).csrfToken;
  const counts = { history: 0, stat: 0, inspect: 0, status: 0, query: 0, snapshot: 0, summary: 0, launch: 0, lock: 0 };
  const locks = createWorkspaceLocks();
  const config = {
    securityStore,
    json(response, status, body) {
      if (response.end) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); }
      else Object.assign(response, { status, body });
    },
    readRecentWorkspaces: async () => { counts.history++; return `${workspace}\n${workspace}\nrelative\n`; },
    stat: async path => { counts.stat++; assert.equal(path, workspace); return { isDirectory: () => true }; },
    inspectOpenCode: async () => { counts.inspect++; return { active: true, running: true, workspace: active }; },
    getOpenCodeStatus: async () => { counts.status++; return { available: true, running: true, cliAvailable: true, version: '1.2.3', workspace: active }; },
    queryOpenCode: async () => { counts.query++; return JSON.stringify(reviewer()); },
    workspaceSummaryConfig: 'SIMULATED_CONFIG',
    inspectWorkspaceSnapshot: async path => { counts.snapshot++; assert.equal(path, active); return { entries: [], files: [] }; },
    runWorkspaceSummary: async () => { counts.summary++; return summary; },
    runLabOpen: async path => { counts.launch++; active = path; },
    acquireActivationLock: () => { counts.lock++; return locks.acquireExclusive(); },
    ...overrides,
  };
  const handler = createPrivateWorkspaceRoutes(config);
  async function request(path, { method = path.endsWith('/activate') || path.endsWith('/workspace-summary') ? 'POST' : 'GET',
    headers = {}, body = path.endsWith('/activate') ? { path: workspace } : {}, raw, chunks } = {}) {
    const req = Readable.from(chunks ?? [Buffer.from(raw ?? JSON.stringify(body))]);
    Object.assign(req, { url: path, method, headers: { host, origin, cookie, 'x-lab-csrf': csrf,
      'x-lab-request': '1', 'content-type': 'application/json', ...headers } });
    const response = { headers: {}, setHeader(key, value) { this.headers[key.toLowerCase()] = value; } };
    response.handled = await handler(req, response);
    return response;
  }
  return { handler, request, counts, config, locks, securityStore, session, cookie, csrf,
    getActive: () => active, setTime(value) { time = value; } };
}
const gets = ['/api/workspaces', '/api/workspaces/active', '/api/opencode/status'];
const posts = ['/api/workspaces/activate', '/api/opencode/workspace-summary'];
const noWork = f => assert.ok(Object.values(f.counts).every(value => value === 0));
const safe = (response, f) => {
  const text = JSON.stringify(response.body);
  for (const value of [workspace, '/private/previous', marker, f.csrf, f.session.sessionId, '1.2.3']) assert.ok(!text.includes(value));
};
for (const path of gets) test(`private GET ${path}: no session/intent/Host reveals nothing or invokes dependencies`, async () => {
  const f = fixture();
  for (const [headers, status] of [[{ cookie: undefined }, 401], [{ 'x-lab-request': undefined }, 403],
    [{ host: 'evil.test' }, 403], [{ origin: 'http://evil.test' }, 403], [{ 'sec-fetch-site': 'cross-site' }, 403]]) {
    const response = await f.request(path, { headers });
    assert.equal(response.status, status); assert.equal(response.headers['cache-control'], 'no-store');
    safe(response, f); noWork(f);
  }
  const allowed = await f.request(path, { headers: { 'x-lab-csrf': undefined, origin: undefined } });
  assert.equal(allowed.status, 200); assert.equal(allowed.headers['cache-control'], 'no-store');
  if (path === '/api/workspaces') assert.deepEqual(allowed.body, [{ path: workspace, type: 'wsl', exists: true }]);
  else assert.equal(allowed.body.workspace, f.getActive());
});
for (const path of posts) test(`private POST ${path}: reject before locks, launcher, state, queries or snapshot reads`, async () => {
  const f = fixture();
  const prior = f.getActive();
  const other = f.securityStore.pair(f.securityStore.createPairing());
  for (const [headers, status] of [[{ cookie: undefined }, 401], [{ 'x-lab-csrf': undefined }, 403],
    [{ 'x-lab-csrf': 'wrong' }, 403], [{ 'x-lab-csrf': f.securityStore.getSession(other.sessionId).csrfToken }, 403],
    [{ origin: 'http://evil.test' }, 403], [{ origin: undefined }, 403], [{ host: 'evil.test' }, 403],
    [{ 'sec-fetch-site': 'cross-site' }, 403]]) {
    let consumed = false;
    const chunks = (async function* () { consumed = true; yield Buffer.from('{}'); })();
    const response = await f.request(path, { headers, chunks });
    assert.equal(response.status, status); assert.equal(consumed, false);
    assert.equal(response.headers['cache-control'], 'no-store');
    safe(response, f); noWork(f); assert.equal(f.getActive(), prior);
  }
  const allowed = await f.request(path);
  assert.equal(allowed.status, 200); assert.equal(allowed.body.success, true);
  if (path.endsWith('/activate')) { assert.equal(f.counts.launch, 1); assert.equal(f.getActive(), workspace); }
  else { assert.equal(f.counts.snapshot, 1); assert.equal(f.counts.summary, 1); assert.deepEqual(allowed.body.summary, summary); }
});
for (const path of posts) test(`bounded JSON, exact schema and revocation while streaming: ${path}`, async () => {
  const f = fixture();
  const maxBytes = path.endsWith('/activate') ? workspaceBodyLimits.activate : workspaceBodyLimits.summary;
  for (const options of [
    { headers: { 'content-type': 'text/plain' }, expected: 415 },
    { headers: { 'content-length': String(maxBytes + 1) }, expected: 413 },
    { chunks: [Buffer.alloc(maxBytes, 32), Buffer.from('{}')], expected: 413 },
    { raw: '{bad', expected: 400 }, { chunks: [Buffer.from([0xff])], expected: 400 },
    { body: { path: workspace, extra: true }, expected: 400 },
    { body: [], expected: 400 }, { body: null, expected: 400 },
  ]) {
    assert.equal((await f.request(path, options)).status, options.expected); noWork(f);
  }
  const json = JSON.stringify(path.endsWith('/activate') ? { path: workspace } : {});
  const chunks = (async function* () { yield Buffer.from(json.slice(0, 1));
    f.securityStore.revokeSession(f.session.sessionId); yield Buffer.from(json.slice(1)); })();
  assert.equal((await f.request(path, { chunks })).status, 401); noWork(f);
});

test('activation preserves path validation, history allowlist, directory checks and exclusive locks', async () => {
  const f = fixture();
  for (const path of ['relative', '/private/../escape', '/private/\0bad']) {
    assert.equal((await f.request(posts[0], { body: { path } })).status, 400);
    assert.equal(f.counts.lock, 0);
  }
  assert.equal((await f.request(posts[0], { body: { path: '/not-in-history' } })).status, 403);
  assert.equal(f.counts.launch, 0);
  const release = f.locks.acquire('/held-by-action-or-proposal');
  assert.equal((await f.request(posts[0])).status, 409); assert.equal(f.counts.launch, 0);
  release();
  assert.equal((await f.request(posts[0])).status, 200);
  assert.equal(f.counts.launch, 1);
  const missing = fixture({ stat: async () => { throw Object.assign(Error(marker), { code: 'ENOENT' }); } });
  assert.equal((await missing.request(posts[0])).status, 400); assert.equal(missing.counts.launch, 0);
  const notDirectory = fixture({ stat: async () => ({ isDirectory: () => false }) });
  assert.equal((await notDirectory.request(posts[0])).status, 400); assert.equal(notDirectory.counts.launch, 0);
});

for (const path of posts) test(`concurrent authorized requests retain exclusion: ${path}`, async () => {
  let entered; let release;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let runs = 0;
  const f = fixture(path.endsWith('/activate') ? { runLabOpen: async () => { runs++; entered(); await gate; } }
    : { runWorkspaceSummary: async () => { runs++; entered(); await gate; return summary; } });
  const first = f.request(path); await started;
  assert.equal((await f.request(path)).status, 409); assert.equal(runs, 1);
  release(); assert.equal((await first).status, 200);
  assert.equal((await f.request(path)).status, 200);
});

test('summary retains Reviewer fail-closed policy before reading snapshot or generating', async () => {
  for (const mutate of [agent => { agent.tools.bash = true; }, agent => { agent.permission = []; },
    agent => { agent.permission.push({ permission: 'edit', pattern: '*', action: 'allow' }); }]) {
    const agent = reviewer(); mutate(agent);
    const f = fixture({ queryOpenCode: async () => JSON.stringify(agent) });
    assert.equal((await f.request(posts[1])).status, 503);
    assert.equal(f.counts.snapshot, 0); assert.equal(f.counts.summary, 0);
  }
});

test('dependency failures never reveal paths, prompts or raw process output and release locks', async () => {
  for (const [dependency, path, status] of [
    ['readRecentWorkspaces', gets[0], 500], ['inspectOpenCode', gets[1], 500], ['getOpenCodeStatus', gets[2], 500],
    ['runLabOpen', posts[0], 500], ['queryOpenCode', posts[1], 502], ['inspectWorkspaceSnapshot', posts[1], 502],
    ['runWorkspaceSummary', posts[1], 502],
  ]) {
    let fail = true;
    const f = fixture();
    const original = f.config[dependency];
    const configured = fixture({ [dependency]: async (...args) => { if (fail) throw Error(`${marker} ${workspace}`); return original(...args); } });
    const failed = await configured.request(path); assert.equal(failed.status, status); safe(failed, configured);
    fail = false;
    assert.equal((await configured.request(path)).status, 200);
  }
});

for (const mode of ['expired', 'revoked']) test(`${mode} sessions cannot access any workspace/OpenCode resource`, async () => {
  const f = fixture();
  if (mode === 'expired') f.setTime(1_800_000); else f.securityStore.revokeSession(f.session.sessionId);
  for (const path of [...gets, ...posts]) { const response = await f.request(path); assert.equal(response.status, 401); safe(response, f); }
  noWork(f);
});

test('Proposal/Apply remain outside the boundary; production shares store and existing exclusive lock', async () => {
  const f = fixture();
  for (const path of ['/api/opencode/change-proposal', '/api/opencode/apply-change-proposal']) {
    const response = await f.request(path, { method: 'POST', headers: { cookie: undefined } });
    assert.equal(response.handled, false); assert.equal(response.status, undefined);
  }
  noWork(f);
  const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  assert.match(source, /createPrivateWorkspaceRoutes\(\{ securityStore, json/);
  assert.match(source, /acquireActivationLock: \(\) => proposalLocks\.acquireExclusive\(\)/);
  assert.match(source, /if \(await privateWorkspaces\(request, response\)\) return/);
});

test('direct backend HTTP has no bypass without Vite or with forwarded headers', async t => {
  const f = fixture();
  const server = createServer(async (req, res) => { if (!await f.handler(req, res)) { res.writeHead(404); res.end(); } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const path of [...gets, ...posts]) {
    const isPost = posts.includes(path);
    const req = httpRequest(`http://127.0.0.1:${server.address().port}${path}`, { method: isPost ? 'POST' : 'GET', agent: false,
      headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001', 'x-lab-request': '1',
        'x-forwarded-host': host, 'content-type': 'application/json' } });
    req.end(isPost ? '{}' : undefined);
    const [res] = await once(req, 'response'); let data = ''; for await (const chunk of res) data += chunk;
    assert.equal(res.statusCode, 401); safe({ body: JSON.parse(data) }, f);
  }
  noWork(f);
});

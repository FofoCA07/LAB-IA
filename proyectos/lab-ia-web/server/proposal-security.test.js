import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createSecurityStore } from './security-store.js';
import { createProposalStore, createWorkspaceLocks } from './proposal-store.js';
import { createChangeProposalHandler, runProposalGit } from './change-proposal.js';
import { createApplyChangeProposalHandler, runApplyGit } from './apply-change-proposal.js';
import { generateDeterministicDiff } from './deterministic-diff.js';
import { createPrivateProposalHandlers, proposalBodyLimits } from './proposal-security.js';

const host = 'localhost:5173'; const origin = `http://${host}`;
const original = 'Original content\n'; const proposed = 'Reviewed content\n';
const marker = 'PRIVATE_PROMPT_RAW_GIT_MODEL_OUTPUT';
const changePath = '/api/opencode/change-proposal'; const applyPath = '/api/opencode/apply-change-proposal';
const denied = [
  ['session', { cookie: undefined }, 401], ['missing CSRF', { 'x-lab-csrf': undefined }, 403],
  ['wrong CSRF', { 'x-lab-csrf': 'wrong' }, 403], ['Origin', { origin: 'http://evil.test' }, 403],
  ['missing Origin', { origin: undefined }, 403], ['Host', { host: 'evil.test' }, 403],
  ['content type', { 'content-type': 'text/plain' }, 415],
];
async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'proposal-auth-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const gitFixture = (args, input) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: workspace, encoding: 'utf8', input, env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
      GIT_OPTIONAL_LOCKS: '0', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' },
  });
  // Temporary fixtures use commit-tree plumbing for HEAD; never git commit/push.
  gitFixture(['init', '-q']); await writeFile(join(workspace, 'file.txt'), original);
  gitFixture(['add', '--', 'file.txt']);
  const tree = gitFixture(['write-tree']).trim();
  const head = gitFixture(['commit-tree', tree], 'Fixture baseline\n').trim();
  gitFixture(['update-ref', 'HEAD', head]);
  const index = await readFile(join(workspace, '.git/index'));
  let time = 0;
  const securityStore = createSecurityStore({ now: () => time });
  const session = securityStore.pair(securityStore.createPairing());
  const cookie = `lab_session=${session.sessionId}`;
  const csrf = securityStore.getSession(session.sessionId).csrfToken;
  let proposalTime = 0;
  const store = createProposalStore({ now: () => proposalTime }); const locks = createWorkspaceLocks();
  const counts = { change: 0, apply: 0, status: 0, warmup: 0, selection: 0, model: 0, diff: 0,
    lock: 0, get: 0, claim: 0, register: 0, finish: 0 };
  const gitCalls = [];
  const facade = Object.fromEntries(['get', 'claim', 'register', 'finish'].map(method => [method, (...args) => {
    counts[method]++; return store[method](...args);
  }]));
  const json = (res, status, body) => {
    if (res.end) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
    else Object.assign(res, { status, body });
  };
  const getWorkspaceStatus = async () => { counts.status++; return { available: true, running: true, workspace }; };
  const trackedLocks = { acquire(path) { counts.lock++; return locks.acquire(path); } };
  let failModel = false;
  const changeProposal = createChangeProposalHandler({ store: facade, locks: trackedLocks, json, getWorkspaceStatus,
    waitForWarmup: async () => { counts.warmup++; },
    git: async (cwd, args, options) => { gitCalls.push(args); return runProposalGit(cwd, args, options); },
    selectFiles: async () => { counts.selection++; return { files: ['file.txt'] }; },
    generateProposal: async ({ files }) => {
      counts.model++; if (failModel) throw Error(`${marker} ${workspace}`);
      assert.equal(files[0].content, original);
      return { summary: 'Review text', files: [{ path: 'file.txt', content: proposed }] };
    },
    generateDiff: async (input, dependencies) => { counts.diff++; return generateDeterministicDiff(input, dependencies); },
  });
  const applyChangeProposal = createApplyChangeProposalHandler({ store: facade, locks: trackedLocks, json, getWorkspaceStatus,
    git: async (cwd, args, options) => { gitCalls.push(args); return runApplyGit(cwd, args, options); } });
  const handlers = createPrivateProposalHandlers({ securityStore, json,
    changeProposal: (...args) => { counts.change++; return changeProposal(...args); },
    applyChangeProposal: (...args) => { counts.apply++; return applyChangeProposal(...args); },
  });
  async function request(path, { body = { request: 'Actualizar texto' }, headers = {}, chunks, raw, method = 'POST' } = {}) {
    const req = Readable.from(chunks ?? [Buffer.from(raw ?? JSON.stringify(body))]);
    Object.assign(req, { method, url: path, headers: { host, origin, cookie, 'content-type': 'application/json', 'x-lab-csrf': csrf, ...headers } });
    const res = { headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; } };
    await handlers[path === changePath ? 'changeProposal' : 'applyChangeProposal'](req, res);
    return res;
  }
  const reset = () => { Object.keys(counts).forEach(k => { counts[k] = 0; }); gitCalls.length = 0; };
  return { workspace, store, counts, gitCalls, handlers, request, reset, index, head, gitFixture, securityStore, session, csrf,
    setTime(value) { time = value; }, setProposalTime(value) { proposalTime = value; }, failModel() { failModel = true; } };
}
const noWork = f => { assert.ok(Object.values(f.counts).every(n => n === 0)); assert.deepEqual(f.gitCalls, []); };
const safe = (response, f) => {
  const text = JSON.stringify(response.body);
  for (const value of [marker, original, f.workspace, f.csrf, f.session.sessionId]) assert.ok(!text.includes(value));
};
async function intact(f) {
  assert.deepEqual(await readFile(join(f.workspace, '.git/index')), f.index);
  assert.equal(await readFile(join(f.workspace, 'file.txt'), 'utf8'), original);
}
async function create(f) {
  const response = await f.request(changePath);
  assert.equal(response.status, 200); assert.equal(response.body.success, true);
  return response.body.proposalId;
}
async function successfulApply(f, id) {
  const response = await f.request(applyPath, { body: { proposalId: id } });
  assert.equal(response.status, 200); assert.deepEqual(response.body, { applied: true, files: ['file.txt'] });
  assert.equal(f.store.get(id).state, 'applied');
  assert.equal(await readFile(join(f.workspace, 'file.txt'), 'utf8'), proposed);
  assert.deepEqual(await readFile(join(f.workspace, '.git/index')), f.index);
  assert.equal(f.gitFixture(['rev-parse', 'HEAD']).trim(), f.head);
  assert.equal(f.gitFixture(['diff', '--cached']), '');
}

test('unauthorized change never enters pipeline, touches store, reads catalog/content, generates diff or calls model', async t => {
  const f = await fixture(t);
  for (const [name, headers, status] of denied) {
    const response = await f.request(changePath, { headers });
    assert.equal(response.status, status, name); safe(response, f); noWork(f); await intact(f);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  const id = await create(f);
  assert.equal(f.store.get(id).state, 'ready'); assert.equal(f.counts.register, 1);
  assert.equal(f.counts.selection, 1); assert.equal(f.counts.model, 1); assert.equal(f.counts.diff, 1);
  await intact(f);
});
for (const [name, headers, status] of denied) test(`apply rejection for ${name} does not consume ID; same ID then applies normally`, async t => {
  const f = await fixture(t); const id = await create(f); const before = f.store.get(id); f.reset();
  const deniedResponse = await f.request(applyPath, { headers, body: { proposalId: id } });
  assert.equal(deniedResponse.status, status); safe(deniedResponse, f); noWork(f); await intact(f);
  assert.deepEqual(f.store.get(id), before);
  await successfulApply(f, id);
  assert.equal(f.counts.claim, 1);
  assert.equal(f.gitCalls.filter(args => args[0] === 'apply' && !args.includes('--check')).length, 1);
});
for (const path of [changePath, applyPath]) test(`bounded exact JSON and session expiry during streaming: ${path}`, async t => {
  const f = await fixture(t); const id = await create(f); f.reset();
  const limit = path === changePath ? proposalBodyLimits.change : proposalBodyLimits.apply;
  for (const options of [
    { headers: { 'content-length': String(limit + 1) }, expected: 413 },
    { chunks: [Buffer.alloc(limit, 32), Buffer.from('{}')], expected: 413 },
    { raw: '{bad', expected: 400 }, { chunks: [Buffer.from([0xff])], expected: 400 },
    { body: { proposalId: id, patch: marker }, expected: 400 }, { body: { request: 'x', workspace: f.workspace }, expected: 400 },
    { body: { proposalId: 'invalid' }, expected: 400 }, { body: null, expected: 400 },
  ]) {
    const response = await f.request(path, options); assert.equal(response.status, options.expected); safe(response, f); noWork(f);
  }
  const body = JSON.stringify(path === changePath ? { request: 'x' } : { proposalId: id });
  const chunks = (async function* () { yield Buffer.from(body.slice(0, 1));
    f.securityStore.revokeSession(f.session.sessionId); yield Buffer.from(body.slice(1)); })();
  assert.equal((await f.request(path, { chunks })).status, 401); noWork(f); await intact(f);
  assert.equal(f.store.get(id).state, 'ready');
});

test('double authorized apply retains atomic single-use and writes only once', async t => {
  const f = await fixture(t); const id = await create(f); f.reset();
  const results = await Promise.all([1, 2].map(() => f.request(applyPath, { body: { proposalId: id } })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.counts.claim, 1);
  assert.equal(f.gitCalls.filter(args => args[0] === 'apply' && !args.includes('--check')).length, 1);
  assert.deepEqual(await readFile(join(f.workspace, '.git/index')), f.index);
});

test('expired session rejects both pipelines; valid auth still preserves proposal TTL', async t => {
  const f = await fixture(t); const id = await create(f); f.reset(); f.setTime(1_800_000);
  for (const path of [changePath, applyPath]) assert.equal((await f.request(path, { body: { proposalId: id } })).status, 401);
  noWork(f); await intact(f); assert.equal(f.store.get(id).state, 'ready');
  const expired = await fixture(t); const expiredId = await create(expired); expired.reset(); expired.setProposalTime(600_000);
  assert.equal((await expired.request(applyPath, { body: { proposalId: expiredId } })).status, 409);
  assert.equal(expired.store.get(expiredId).state, 'expired');
  assert.equal(expired.counts.claim, 0); assert.deepEqual(expired.gitCalls, []); await intact(expired);
});

test('authorized proposal returns only review contract; model failures never expose raw output', async t => {
  const f = await fixture(t); const response = await f.request(changePath);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ['success', 'workspace', 'engine', 'baseHead', 'proposal', 'proposalId', 'expiresAt'].sort());
  assert.deepEqual(Object.keys(response.body.proposal).sort(), ['summary', 'files', 'patch'].sort());
  assert.doesNotMatch(JSON.stringify(response.body), /originalFingerprints|proposedFingerprints|repoIdentity|permissions|sizes|temporaryIndex/);
  const failure = await fixture(t); failure.failModel();
  const result = await failure.request(changePath); assert.notEqual(result.status, 200); safe(result, failure);
  assert.equal(failure.counts.register, 0);
});

test('direct backend HTTP has no loopback/forwarded-Host bypass for either proposal route', async t => {
  const f = await fixture(t);
  const server = createServer(async (req, res) => {
    await f.handlers[req.url === changePath ? 'changeProposal' : 'applyChangeProposal'](req, res);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const path of [changePath, applyPath]) {
    const request = httpRequest(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', agent: false,
      headers: { host: '127.0.0.1:3001', origin: 'http://127.0.0.1:3001', 'x-forwarded-host': host, 'content-type': 'application/json' } });
    request.end('{}'); const [response] = await once(request, 'response');
    let text = ''; for await (const chunk of response) text += chunk;
    assert.equal(response.statusCode, 401); safe({ body: JSON.parse(text) }, f);
  }
  noWork(f); await intact(f);
});

test('production routes both sensitive handlers through the same auth store', async () => {
  const index = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  assert.match(index, /createPrivateProposalHandlers\(\{ securityStore, json, changeProposal, applyChangeProposal \}\)/);
  assert.match(index, /await privateProposals\.changeProposal\(request, response\)/);
  assert.match(index, /await privateProposals\.applyChangeProposal\(request, response\)/);
  assert.doesNotMatch(index, /await (?:changeProposal|applyChangeProposal)\(request, response\)/);
});

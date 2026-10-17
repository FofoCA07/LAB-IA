import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, rm, symlink, open, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createChatHandler } from './chat.js';
import { createChatReadPermission } from './chat-read-permission.js';
import { planChatRead } from './chat-read-planner.js';
import { createActionStore } from './action-store.js';
import { createTurnStore } from './turn-store.js';
import { createWorkspaceLocks } from './proposal-store.js';
import { buildAuthorizedCatalog } from './change-proposal.js';
import { createPrivateChatRoutes } from './chat-routes.js';
import { createSecurityStore } from './security-store.js';

const marker = 'PRIVATE_FILE_BYTES_NEVER_IN_PLANNER';
const read = { kind: 'read', paths: ['src/app.js'], reason: 'Revisar implementación' };
async function fixture(t, options = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'chat-read-'));
  await mkdir(join(workspace, '.git')); await mkdir(join(workspace, 'src'));
  await writeFile(join(workspace, 'src/app.js'), marker); await writeFile(join(workspace, '.env'), marker);
  await writeFile(join(workspace, 'untracked.txt'), marker); await symlink('src/app.js', join(workspace, 'alias'));
  const entries = ['100644 aa 0\tsrc/app.js', '100755 bb 0\tbin.sh', '100644 cc 0\t.env',
    '120000 dd 0\talias', '160000 ee 0\tmodule'];
  await writeFile(join(workspace, 'bin.sh'), marker);
  const git = async (cwd, args) => {
    assert.equal(cwd, workspace);
    if (args[0] === 'ls-files') return entries.join('\0') + '\0';
    assert.equal(args[0], 'rev-parse');
    return args[1] === '--show-toplevel' ? workspace : join(workspace, '.git');
  };
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE conversaciones (id INTEGER PRIMARY KEY, agente_id TEXT, actualizada_en TEXT);
    CREATE TABLE mensajes (id INTEGER PRIMARY KEY, conversacion_id INTEGER, rol TEXT, contenido TEXT, creado_en TEXT);
    INSERT INTO conversaciones VALUES (1,'${options.agentId ?? 'senior-developer'}','before');
    INSERT INTO mensajes VALUES (1,1,'user','Revisa src/app.js','before');`);
  t.after(async () => { database.close(); await rm(workspace, { recursive: true, force: true }); });
  const counts = { planner: 0, chat: 0, reads: 0, create: 0, catalog: 0 };
  let statusCalls = 0; let time = 0;
  const getWorkspaceStatus = async () => {
    statusCalls++;
    return options.noWorkspace ? { available: false, running: false, workspace: null }
      : { available: true, running: true, workspace: options.invalidWorkspace ? join(workspace, 'missing') : options.changeWorkspace && statusCalls > 1 ? '/changed' : workspace };
  };
  const locks = createWorkspaceLocks();
  const actionStore = createActionStore({ locks, git, getWorkspaceStatus,
    readFiles: async () => { counts.reads++; return [{ path: 'src/app.js', content: marker }]; } });
  const actions = { createReadAction: async (...args) => {
    counts.create++;
    if (options.swapRepoDuringCreate) {
      await rename(join(workspace, '.git'), join(workspace, '.old-git')); await mkdir(join(workspace, '.git'));
    }
    if (options.createFails) throw Error(marker); return actionStore.createReadAction(...args);
  } };
  const turns = createTurnStore({ now: () => time, ttlMs: 1000 });
  if (options.attachFails) turns.attachAction = () => { throw Error(marker); };
  let plannerInput;
  const coordinator = createChatReadPermission({ actionStore: actions, locks, getWorkspaceStatus, git,
    catalogFor: async (...args) => { counts.catalog++; return buildAuthorizedCatalog(...args); },
    plan: async input => {
      counts.planner++; plannerInput = structuredClone(input);
      if (options.expireDuringPlanning) time = 1000;
      if (options.planHook) await options.planHook();
      return planChatRead(input, { generate: async () => typeof options.decision === 'string' ? options.decision : JSON.stringify(options.decision ?? read) });
    },
  });
  const json = (response, status, body) => Object.assign(response, { status, body });
  const chat = createChatHandler({ database, turns, json, requestReadPermission: coordinator,
    loadAgent: async () => 'PRIVATE_AGENT_INSTRUCTIONS', generate: async () => { counts.chat++; return 'Normal reply'; } });
  const securityStore = createSecurityStore(); const session = securityStore.pair(securityStore.createPairing());
  const routes = createPrivateChatRoutes({ store: securityStore, database, chat, json,
    addUserMessage: () => assert.fail('not used'), checkAgents: async () => {}, listAgents: async () => [], loadAgent: async () => '' });
  async function request(headers = {}) {
    const req = Readable.from([Buffer.from('{}')]);
    Object.assign(req, { method: 'POST', url: '/api/conversations/1/respond', headers: { host: 'localhost:5173',
      origin: 'http://localhost:5173', cookie: `lab_session=${session.sessionId}`,
      'x-lab-csrf': securityStore.getSession(session.sessionId)?.csrfToken, 'content-type': 'application/json', ...headers } });
    const response = { setHeader() {} }; await routes(req, response); return response;
  }
  return { workspace, counts, turns, actionStore, locks, request, entries, git, database,
    get plannerInput() { return plannerInput; } };
}

test('Senior Developer respond follows normal Chat; no action created', async t => {
  const f = await fixture(t, { decision: { kind: 'respond' } });
  const response = await f.request(); assert.equal(response.status, 200); assert.equal(response.body.state, 'completed');
  assert.equal(f.counts.planner, 1); assert.equal(f.counts.chat, 1); assert.equal(f.counts.create, 0);
  assert.equal(f.database.prepare('SELECT count(*) n FROM mensajes').get().n, 2);
});

test('read creates pending action bound to awaiting turn, no file reads/final chat/assistant; only minimal HTTP metadata', async t => {
  const f = await fixture(t);
  const probe = await open(join(f.workspace, 'src/app.js'), 'r'); const prototype = Object.getPrototypeOf(probe); await probe.close();
  let reads = 0;
  t.mock.method(prototype, 'read', () => { reads++; assert.fail('planning cannot read bytes'); });
  t.mock.method(prototype, 'readFile', () => { reads++; assert.fail('planning cannot read bytes'); });
  const response = await f.request(); assert.equal(response.status, 200);
  const action = f.actionStore.listActions().actions[0]; const turn = f.turns.get(response.body.turnId);
  assert.equal(turn.state, 'awaiting_permission'); assert.equal(turn.actionId, action.actionId); assert.equal(action.state, 'pending');
  assert.deepEqual(response.body, { turnId: turn.turnId, state: 'awaiting_permission',
    action: { actionId: action.actionId, type: 'read', resources: ['src/app.js'] } });
  assert.equal(f.counts.chat, 0); assert.equal(f.counts.reads, 0); assert.equal(reads, 0);
  assert.equal(f.database.prepare('SELECT count(*) n FROM mensajes').get().n, 1);
  for (const payload of [response.body, action, f.plannerInput]) {
    assert.ok(!JSON.stringify(payload).includes(marker)); assert.ok(!JSON.stringify(payload).includes(f.workspace));
  }
  assert.deepEqual(Object.keys(f.plannerInput).sort(), ['agentId', 'agentName', 'catalog', 'lastUserMessage']);
  assert.deepEqual(f.plannerInput.catalog, ['bin.sh', 'src/app.js']);
  assert.equal(action.projectName, f.workspace.split('/').at(-1));
  assert.equal((await f.request()).status, 409);
});

test('other agents bypass planning and retain ordinary Chat', async t => {
  const f = await fixture(t, { agentId: 'reviewer' }); assert.equal((await f.request()).body.state, 'completed');
  assert.equal(f.counts.planner, 0); assert.equal(f.counts.catalog, 0); assert.equal(f.counts.create, 0);
});
for (const [name, decision] of [['invented', { ...read, paths: ['invented'] }], ['untracked', { ...read, paths: ['untracked.txt'] }],
  ['sensitive', { ...read, paths: ['.env'] }], ['symlink', { ...read, paths: ['alias'] }], ['submodule', { ...read, paths: ['module'] }],
  ['traversal', { ...read, paths: ['src/../src/app.js'] }], ['duplicates', { ...read, paths: ['src/app.js', 'src/app.js'] }],
  ['too many', { ...read, paths: Array(21).fill('src/app.js') }], ['reason', { ...read, reason: 'x'.repeat(501) }],
  ['invalid JSON', '{PRIVATE_MODEL_OUTPUT']]) test(`invalid read ${name}: safe failure without action or final chat`, async t => {
  const f = await fixture(t, { decision }); const response = await f.request();
  assert.equal(response.status, 502); assert.equal(response.body.state, 'failed');
  assert.equal(f.counts.create, 0); assert.equal(f.counts.chat, 0); assert.equal(f.counts.reads, 0);
  assert.deepEqual(f.actionStore.listActions(), { actions: [] });
  assert.doesNotMatch(JSON.stringify(response.body), /PRIVATE|\.env|workspace|fingerprint/);
});

test('absent active workspace cannot create read, but respond without files still works', async t => {
  const f = await fixture(t, { noWorkspace: true }); assert.equal((await f.request()).status, 502); assert.equal(f.counts.create, 0);
  const invalid = await fixture(t, { invalidWorkspace: true });
  assert.equal((await invalid.request()).status, 502); assert.equal(invalid.counts.create, 0);
  const normal = await fixture(t, { noWorkspace: true, decision: { kind: 'respond' } });
  assert.equal((await normal.request()).body.state, 'completed'); assert.deepEqual(normal.plannerInput.catalog, []);
});

test('workspace change during planning or expiry rejects before action publication', async t => {
  for (const options of [{ changeWorkspace: true }, { expireDuringPlanning: true }]) {
    const f = await fixture(t, options); assert.equal((await f.request()).status, 502);
    assert.equal(f.counts.create, 0); assert.deepEqual(f.actionStore.listActions(), { actions: [] });
  }
});

test('failed creation/attachment leaves no published orphan action or misleading awaiting state', async t => {
  for (const options of [{ createFails: true }, { attachFails: true }, { swapRepoDuringCreate: true }]) {
    const f = await fixture(t, options); const response = await f.request();
    assert.equal(response.status, 502); assert.ok(['failed', 'expired'].includes(response.body.state));
    assert.deepEqual(f.actionStore.listActions(), { actions: [] });
    assert.equal(f.counts.chat, 0); assert.equal(f.counts.reads, 0);
  }
});

test('no auth/CSRF/origin cannot call planner or create/attach any action', async t => {
  const f = await fixture(t);
  for (const [headers, status] of [[{ cookie: undefined }, 401], [{ 'x-lab-csrf': 'bad' }, 403], [{ origin: 'http://evil.test' }, 403]]) {
    assert.equal((await f.request(headers)).status, status); assert.equal(f.counts.planner, 0); assert.equal(f.counts.create, 0);
    assert.equal(f.turns.stats().count, 0); assert.deepEqual(f.actionStore.listActions(), { actions: [] });
  }
});

test('approve may read via existing store but never resumes Chat or persists assistant', async t => {
  const f = await fixture(t); const response = await f.request();
  const decision = await f.actionStore.decide({ actionId: response.body.action.actionId, decision: 'approve_once' });
  assert.equal(decision.status, 200); assert.equal(f.counts.reads, 1); assert.equal(f.counts.chat, 0);
  assert.equal(f.turns.get(response.body.turnId).state, 'awaiting_permission');
  assert.equal(f.database.prepare('SELECT count(*) n FROM mensajes').get().n, 1);
  assert.equal((await f.request()).status, 409);
});

test('catalog rejects conflicts, changed symlinks and >1000 candidates, without reading bytes', async t => {
  const f = await fixture(t);
  f.entries.push('100644 ff 1\tconflict', '100644 11 2\tconflict');
  await assert.rejects(buildAuthorizedCatalog(f.workspace, Date.now() + 1000, f.git));
  const g = await fixture(t); g.entries.length = 0;
  for (let i = 0; i < 1001; i++) g.entries.push(`100644 aa 0\tfile${i}`);
  await assert.rejects(buildAuthorizedCatalog(g.workspace, Date.now() + 1000, g.git));
  const h = await fixture(t); await rm(join(h.workspace, 'src/app.js')); await symlink('../bin.sh', join(h.workspace, 'src/app.js'));
  await assert.rejects(buildAuthorizedCatalog(h.workspace, Date.now() + 1000, h.git));
});

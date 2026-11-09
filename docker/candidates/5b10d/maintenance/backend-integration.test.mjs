import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import cp from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import { fixture, gate, summary, memoryStore } from './integration-fixture.mjs';
import { createBackendHooks } from './backend-hooks.mjs';
import { createBarrier } from './barrier.mjs';
import { openPrivateStore } from './private-store.mjs';

// Intercept accidental fallback defaults in the TEST process, before staged imports.
const originalSpawn = cp.spawn; const originalExecFile = cp.execFile; const originalFetch = globalThis.fetch;
let deniedDocker = 0; let deniedFetch = 0;
cp.execFile = () => { deniedDocker++; throw Error('EXTERNAL_PROCESS_DENIED'); };
cp.spawn = (file, args, options) => {
  if (file !== process.execPath || args[0] !== '-e' || !args[1]?.startsWith('/* LABIA SYNTHETIC */')) {
    deniedDocker++; throw Error('EXTERNAL_PROCESS_DENIED');
  }
  return originalSpawn(file, args, options);
};
globalThis.fetch = async () => { deniedFetch++; throw Error('REAL_FETCH_DENIED'); };
syncBuiltinESMExports();
test.after(() => {
  cp.spawn = originalSpawn; cp.execFile = originalExecFile; globalThis.fetch = originalFetch; syncBuiltinESMExports();
  assert.equal(deniedDocker, 0, 'Unexpected process fallback in integration suite');
  assert.equal(deniedFetch, 0, 'Unexpected global fetch fallback in integration suite');
});
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let n = 0; n < 1000; n++) { if (predicate()) return; await tick(); } throw Error('TEST_CONDITION_NOT_REACHED'); }
function controlRequest(socketPath, payload) {
  assert.ok(socketPath.startsWith('/tmp/labia-5b10n-'));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); let bytes = '';
    socket.setTimeout(2000, () => socket.destroy(Error('TEST_TIMEOUT')));
    socket.once('connect', () => socket.write(JSON.stringify(payload) + '\n'));
    socket.on('data', part => { bytes += part; }); socket.once('error', reject);
    socket.once('end', () => { try { resolve(JSON.parse(bytes)); } catch (error) { reject(error); } });
  });
}
function child(f, source) {
  const result = cp.spawn(process.execPath, ['-e', '/* LABIA SYNTHETIC */' + source], { env: { LANG: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
  f.processes.push(result); return result;
}

test('I01 real workspace request in NORMAL preserves its result', async t => {
  const f = await fixture(t); const r = await f.invoke('/api/opencode/workspace-summary');
  assert.equal(r.status, 200); assert.deepEqual(r.body.summary, summary); assert.equal(f.barrier.status().active, 0);
});
test('I02 real workspace request in DRAINING is rejected before effects; auth still runs', async t => {
  const f = await fixture(t); f.barrier.drain();
  assert.equal((await f.invoke('/api/opencode/workspace-summary')).status, 503); assert.equal(f.counts.probe, 0);
  assert.equal((await f.invoke('/api/opencode/workspace-summary', { extraHeaders: { cookie: undefined } })).status, 401);
});
test('I03 real workspace request in MAINTENANCE is rejected', async t => {
  const f = await fixture(t); f.barrier.drain(); f.barrier.confirm();
  assert.equal((await f.invoke('/api/workspaces/activate', { body: { path: f.workspace } })).status, 503);
  assert.equal(f.counts.activation, 0);
});
test('I04 safe real queries work; status avoids CLI in maintenance', async t => {
  const f = await fixture(t); f.barrier.drain(); f.barrier.confirm();
  for (const url of ['/api/workspaces', '/api/workspaces/active', '/api/opencode/status', '/api/agents', '/api/actions']) assert.equal((await f.invoke(url)).status, 200);
  assert.equal(f.counts.probe, 0); assert.equal(f.barrier.status().active, 0);
});
test('I05 two real requests remain independently registered', async t => {
  const a = gate(); const b = gate(); let f;
  f = await fixture(t, { workspace: { runWorkspaceSummary: () => f.hooks.track(() => a.promise.then(() => summary)) }, generate: () => b.promise.then(() => 'Sintético') });
  f.releases.push(a.release, b.release);
  const first = f.invoke('/api/opencode/workspace-summary');
  const second = f.invoke('/api/conversations/1/respond', { method: 'POST' });
  await until(() => f.barrier.status().active === 2); f.barrier.drain();
  a.release(); await first; assert.equal(f.barrier.status().active, 1); b.release(); await second;
  await f.barrier.waitForDrain();
});
test('I06 request admitted before drain can finish', async t => {
  const work = gate(); let f;
  f = await fixture(t, { workspace: { runWorkspaceSummary: () => f.hooks.track(() => work.promise.then(() => summary)) } }); f.releases.push(work.release);
  const running = f.invoke('/api/opencode/workspace-summary'); await until(() => f.barrier.status().jobs.some(j => j.resources.length));
  f.barrier.drain(); assert.throws(() => f.barrier.confirm(), { code: 'NOT_DRAINED' });
  work.release(); assert.equal((await running).status, 200); f.barrier.confirm();
});
test('I07 drain during real body parsing prevents later admission', async t => {
  const work = gate(); const f = await fixture(t); f.releases.push(work.release);
  async function* body() { yield Buffer.from('{'); await work.promise; yield Buffer.from('}'); }
  const pending = f.invoke('/api/opencode/workspace-summary', { chunks: body() });
  await tick(); f.barrier.drain(); work.release(); assert.equal((await pending).status, 503); assert.equal(f.counts.summary, 0);
});
test('I08 HTTP close event does not release an admitted real handler', async t => {
  const work = gate(); let f;
  f = await fixture(t, { workspace: { runWorkspaceSummary: () => f.hooks.track(() => work.promise.then(() => summary)) } }); f.releases.push(work.release);
  const request = Readable.from([Buffer.from('{}')]); Object.assign(request, { method: 'POST', url: '/api/opencode/workspace-summary', headers: f.headers });
  const response = f.responseMock(); const pending = f.handler(request, response);
  await until(() => f.barrier.status().jobs.some(j => j.resources.length)); response.emit('close'); f.barrier.drain();
  assert.equal(f.barrier.status().active, 1); work.release(); await pending; await f.barrier.waitForDrain();
});
test('I09 real synthetic child exit is observed before close; registration precedes spawn', async t => {
  const f = await fixture(t); const events = []; let atExit;
  const pending = f.hooks.run('probe', async () => {
    const tracked = f.hooks.child(() => { assert.equal(f.barrier.status().active, 1); return child(f, 'setTimeout(()=>{},20)'); }, { events: event => { events.push(event); if (event === 'exit') atExit = f.barrier.status().active; } });
    await tracked.done;
  });
  await pending; assert.deepEqual(events, ['start', 'exit', 'close']); assert.equal(atExit, 1); assert.equal(f.barrier.status().active, 0);
});
test('I10 timeout of real synthetic client retains unverified remote execution', async t => {
  const f = await fixture(t); const events = []; let tracked;
  await f.hooks.run('activation', async () => {
    tracked = f.hooks.child(() => child(f, 'setTimeout(()=>{},5000)'), { remote: true, events: type => events.push(type) });
    tracked.timeout(); await tracked.done;
  });
  await tick(); assert.ok(events.includes('timeout')); assert.equal(f.barrier.status().active, 1);
  assert.ok(f.barrier.status().jobs[0].resources.includes('remote')); assert.throws(() => f.barrier.confirm(), { code: 'NOT_DRAINED' });
});
test('I11 real deferred continuation outlives decision HTTP and tracks later work', async t => {
  const f = await fixture(t); const work = gate(); f.releases.push(work.release); let scheduled;
  const actionId = '00000000-0000-4000-8000-000000000001';
  const turn = f.turns.create({ conversationId: 2, agentId: 'senior-developer', userMessageId: 5 });
  f.turns.transition(turn.turnId, 'awaiting_permission'); f.turns.attachAction(turn.turnId, actionId);
  const continuation = f.modules['chat-read-continuation'].createChatReadContinuation({ maintenance: f.hooks, turnStore: f.turns,
    actionStore: { getAction: () => ({ actionId, state: 'completed', type: 'read', agentId: 'senior-developer', resources: ['README.md'] }), consumeCompletedReadResult: () => [{ path: 'README.md', content: 'Sintético' }] },
    loadContext: async () => ({ agentId: 'senior-developer', history: [{ id: 5, rol: 'user', contenido: 'Sintético' }] }), loadAgent: async () => 'Sintético',
    generate: () => f.hooks.track(() => work.promise.then(() => 'Sintético')), persistAssistant: () => 6, schedule: callback => { scheduled = callback; } });
  const actions = f.modules.actions.createActionHandlers({ securityStore: f.security, json: f.json, maintenance: f.hooks,
    store: { decide: async () => ({ status: 200, body: { state: 'completed' } }) }, onDecision: continuation.notifyDecision });
  const req = Readable.from([Buffer.from(JSON.stringify({ actionId, decision: 'approve_once' }))]); Object.assign(req, { method: 'POST', url: '/api/actions/decision', headers: f.headers });
  const res = f.responseMock(); await actions.decision(req, res); assert.equal(res.status, 200);
  assert.equal(f.barrier.status().active, 1); assert.equal(f.barrier.status().jobs[0].rootDone, true);
  res.emit('close'); f.barrier.drain(); scheduled(); await tick();
  assert.equal(f.barrier.status().active, 1); assert.equal((await f.invoke('/api/opencode/workspace-summary')).status, 503);
  work.release(); await f.barrier.waitForDrain(); assert.equal(f.turns.get(turn.turnId).state, 'completed');
});
test('I12 real summary and activation are both tracked without changing NORMAL concurrency', async t => {
  const a = gate(); const b = gate(); const f = await fixture(t, { workspace: { runWorkspaceSummary: () => a.promise.then(() => summary), runLabOpen: () => b.promise } });
  f.releases.push(a.release, b.release);
  const one = f.invoke('/api/opencode/workspace-summary'); const two = f.invoke('/api/workspaces/activate', { body: { path: f.workspace } });
  await until(() => f.barrier.status().active === 2); f.barrier.drain(); a.release(); b.release();
  assert.equal((await one).status, 200); assert.equal((await two).status, 200); await f.barrier.waitForDrain();
});
test('I13 persistence failure causes controlled HTTP rejection before effects', async t => {
  let broken = false; const store = memoryStore(); const f = await fixture(t, { store: { load: store.load, save(value) { if (broken) throw Error('PRIVATE'); store.save(value); } } });
  broken = true; const r = await f.invoke('/api/opencode/workspace-summary'); assert.equal(r.status, 503); assert.equal(f.counts.probe, 0); assert.equal(f.barrier.status().fault, 'PERSISTENCE_FAILED');
});
test('I14 real factories after persisted maintenance restart remain closed', async t => {
  const f = await fixture(t); f.barrier.drain(); f.barrier.confirm(); f.barrier.close();
  const restarted = createBarrier({ store: openPrivateStore(f.stateDirectory) });
  try {
    const hooks = createBackendHooks(restarted, f.json);
    const route = f.modules['workspace-routes'].createPrivateWorkspaceRoutes({ ...f.workspaceConfig, maintenance: hooks });
    const req = Readable.from([Buffer.from('{}')]); Object.assign(req, { url: '/api/opencode/workspace-summary', method: 'POST', headers: f.headers });
    const res = f.responseMock(); await route(req, res); assert.equal(res.status, 503);
    await assert.rejects(restarted.recover(), { code: 'RECOVERY_REQUIRED' }); assert.equal(f.counts.summary, 0);
  } finally { restarted.close(); }
});
test('I15 real warmup factory cannot schedule fetch on closed startup', async t => {
  const f = await fixture(t, { normal: false }); assert.throws(() => f.warmup.start(), { code: 'ADMISSION_CLOSED' });
  assert.equal(f.counts.warmup, 0); assert.equal(f.warmup.state, 'idle');
});
test('I16 temporary local administration denies unknown and unauthorized commands', async t => {
  const f = await fixture(t); const control = await f.openControl();
  assert.equal(fs.statSync(control.socketPath).mode & 0o777, 0o600);
  assert.equal((await controlRequest(control.socketPath, { command: 'drain' })).code, 'UNAUTHORIZED');
  assert.equal((await controlRequest(control.socketPath, { command: 'shell' })).code, 'INVALID_COMMAND'); assert.equal(f.barrier.status().state, 'NORMAL');
});
test('I17 authorized local reopen requires completed drain and confirmation', async t => {
  const f = await fixture(t); const control = await f.openControl(() => true);
  assert.equal((await controlRequest(control.socketPath, { command: 'drain' })).ok, true);
  assert.equal((await controlRequest(control.socketPath, { command: 'reopen' })).code, 'BAD_STATE');
  assert.equal((await controlRequest(control.socketPath, { command: 'confirm' })).ok, true);
  assert.equal((await controlRequest(control.socketPath, { command: 'reopen' })).ok, true);
  assert.equal((await f.invoke('/api/opencode/workspace-summary')).status, 200);
});
test('I18 NORMAL workspace HTTP result matches unmodified real factory', async t => {
  const f = await fixture(t);
  const { createPrivateWorkspaceRoutes } = await import('../../../../proyectos/lab-ia-web/server/workspace-routes.js');
  const original = createPrivateWorkspaceRoutes(f.workspaceConfig);
  const req = Readable.from([Buffer.from('{}')]); Object.assign(req, { url: '/api/opencode/workspace-summary', method: 'POST', headers: f.headers });
  const res = f.responseMock(); await original(req, res); const candidate = await f.invoke(req.url);
  assert.equal(candidate.status, res.status); assert.deepEqual(candidate.body, res.body); assert.deepEqual(candidate.headers, res.headers);
});
test('I19 no real Docker command was launched by any integration handler', () => { assert.equal(deniedDocker, 0); });
test('I20 no handler used global fetch or real Ollama', () => { assert.equal(deniedFetch, 0); });
test('I21 all protected real HTTP boundaries reject work in maintenance', async t => {
  const f = await fixture(t); f.barrier.drain(); f.barrier.confirm();
  const requests = [
    ['/api/conversations', { titulo: 'Sintético', agente_id: 'reviewer', modelo: 'qwen3:8b', workspace: f.workspace }],
    ['/api/conversations/1/messages', { content: 'Sintético' }], ['/api/conversations/1/respond', {}],
    ['/api/actions/decision', { actionId: '00000000-0000-4000-8000-000000000001', decision: 'deny' }],
    ['/api/opencode/change-proposal', { request: 'Cambio sintético' }],
    ['/api/opencode/apply-change-proposal', { proposalId: '00000000-0000-4000-8000-000000000001' }],
  ];
  for (const [url, body] of requests) assert.equal((await f.invoke(url, { method: 'POST', body })).status, 503, url);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM conversaciones').get().n, 1);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM mensajes').get().n, 1);
});
test('I22 real NORMAL chat writes and generation preserve HTTP contracts and SQLite state', async t => {
  const f = await fixture(t);
  const reply = await f.invoke('/api/conversations/1/respond', { method: 'POST' });
  assert.equal(reply.status, 200); assert.equal(reply.body.state, 'completed'); assert.equal(f.counts.chat, 1);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM mensajes').get().n, 2);
  const message = await f.invoke('/api/conversations/1/messages', { method: 'POST', body: { content: 'Otra entrada sintética' } });
  assert.equal(message.status, 201); assert.equal(message.body.rol, 'user');
  const created = await f.invoke('/api/conversations', { method: 'POST', body: { titulo: 'Nuevo', agente_id: 'reviewer', modelo: 'qwen3:8b', workspace: f.workspace } });
  assert.equal(created.status, 201); assert.equal(f.barrier.status().active, 0);
});
test('I23 real proposal/apply handlers keep safe NORMAL preflight failures', async t => {
  const f = await fixture(t);
  assert.equal((await f.invoke('/api/opencode/change-proposal', { method: 'POST', body: { request: 'Cambio sintético' } })).status, 503);
  assert.equal((await f.invoke('/api/opencode/apply-change-proposal', { method: 'POST', body: { proposalId: '00000000-0000-4000-8000-000000000001' } })).status, 409);
  assert.equal(f.barrier.status().active, 0);
});
test('I24 previously blocked real warmup can start only after recovery and explicit reopening', async t => {
  const f = await fixture(t, { normal: false }); assert.throws(() => f.warmup.start(), { code: 'ADMISSION_CLOSED' });
  await f.barrier.recover(); f.barrier.confirm(); f.barrier.reopen(); await f.warmup.start();
  assert.equal(f.warmup.state, 'ready'); assert.equal(f.counts.warmup, 1); assert.equal(f.barrier.status().active, 0);
});
test('I25 real synthetic child cancellation remains uncertain until independent local close proof', async t => {
  let closed = false; const events = []; const f = await fixture(t, { verifyUncertain: async () => closed });
  await f.hooks.run('probe', async () => {
    const operation = f.hooks.child(() => child(f, 'setTimeout(()=>{},5000)'), { events: event => { events.push(event); if (event === 'close') closed = true; } });
    operation.cancel(); await operation.done;
  });
  assert.ok(events.includes('cancel')); assert.equal(f.barrier.status().active, 1);
  await f.barrier.reconcileJob(f.barrier.status().jobs[0].id); f.barrier.confirm();
});
test('I26 cancellation of a fetch reader never counts as normal EOF', async t => {
  const f = await fixture(t);
  await f.hooks.run('warmup', async () => {
    const fetch = f.hooks.trackedFetch(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } })));
    const response = await fetch('mock-only'); const reader = response.body.getReader(); await reader.read(); await reader.cancel();
  });
  assert.equal(f.barrier.status().active, 1); assert.equal(f.barrier.status().jobs[0].uncertain, true);
});
test('I27 real warmup timeout keeps the underlying fetch registered until it actually settles', async t => {
  const f = await fixture(t); let rejectFetch;
  const warmup = f.modules['ollama-warmup'].createOllamaWarmup({ maintenance: f.hooks, timeoutMs: 10,
    fetchImpl: f.hooks.trackedFetch(() => new Promise((_, reject) => { rejectFetch = reject; })) });
  await assert.rejects(warmup.start(), error => error.code === 'OLLAMA_UNAVAILABLE');
  assert.equal(f.barrier.status().active, 1); assert.ok(f.barrier.status().jobs[0].resources.includes('remote'));
  assert.equal(f.barrier.status().jobs[0].uncertain, true);
  rejectFetch(Error('synthetic transport settled')); await tick();
  assert.equal(f.barrier.status().jobs[0].resources.length, 0); assert.equal(f.barrier.status().active, 1);
});
test('I28 authorized read-only administrative check uses real handler without opening normal admission', async t => {
  const f = await fixture(t); f.barrier.drain(); f.barrier.confirm();
  const control = await f.openControl(() => true, { 'admin-health': async () => {
    const check = await f.invoke('/api/workspaces/active'); assert.equal(check.status, 200);
    assert.equal((await f.invoke('/api/opencode/workspace-summary')).status, 503);
    return check.body;
  } });
  const result = await controlRequest(control.socketPath, { command: 'diagnostic', kind: 'admin-health' });
  assert.equal(result.ok, true); assert.equal(result.status.state, 'DRAINING'); assert.ok(!JSON.stringify(result).includes(f.workspace));
  assert.equal((await controlRequest(control.socketPath, { command: 'confirm' })).ok, true);
});

test('E01 isolated HTTP plus Unix control: NORMAL to MAINTENANCE to NORMAL', async t => {
  const work = gate(); const entered = gate(); const f = await fixture(t, { workspace: { runWorkspaceSummary: async () => { entered.release(); await work.promise; return summary; } } });
  f.releases.push(work.release); const api = await f.listen(); const control = await f.openControl(() => true);
  const pending = api.request('/api/opencode/workspace-summary'); await entered.promise;
  assert.equal((await controlRequest(control.socketPath, { command: 'drain' })).ok, true);
  assert.equal((await api.request('/api/opencode/workspace-summary')).status, 503);
  assert.equal((await controlRequest(control.socketPath, { command: 'confirm' })).code, 'NOT_DRAINED');
  work.release(); assert.equal((await pending).status, 200); await f.barrier.waitForDrain();
  assert.equal((await controlRequest(control.socketPath, { command: 'confirm' })).status.state, 'MAINTENANCE');
  assert.equal((await api.request('/api/opencode/workspace-summary')).status, 503);
  assert.equal((await controlRequest(control.socketPath, { command: 'reopen' })).ok, true);
  assert.equal((await api.request('/api/opencode/workspace-summary')).status, 200);
});
test('E02 isolated backend restart uses disk checkpoint and explicit reconciliation', async t => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'labia-5b10n-persist-')); fs.chmodSync(state, 0o700);
  let first; let second;
  try {
    first = await fixture(t, { store: openPrivateStore(state) }); const api = await first.listen();
    assert.equal((await api.request('/api/opencode/workspace-summary')).status, 200);
    first.barrier.drain(); first.barrier.confirm(); await first.shutdown();
    second = await fixture(t, { store: openPrivateStore(state), normal: false }); const restarted = await second.listen(); const control = await second.openControl(() => true);
    assert.equal(second.barrier.status().recoveryRequired, true); assert.equal((await restarted.request('/api/opencode/workspace-summary')).status, 503);
    assert.throws(() => second.warmup.start(), { code: 'ADMISSION_CLOSED' }); assert.equal(second.counts.warmup, 0);
    assert.equal((await controlRequest(control.socketPath, { command: 'reopen' })).code, 'NOT_DRAINED');
    assert.equal((await controlRequest(control.socketPath, { command: 'recover' })).ok, true);
    assert.equal((await controlRequest(control.socketPath, { command: 'confirm' })).ok, true);
    assert.equal((await controlRequest(control.socketPath, { command: 'reopen' })).ok, true);
    assert.equal((await restarted.request('/api/opencode/workspace-summary')).status, 200);
  } finally { await second?.shutdown(); await first?.shutdown(); fs.rmSync(state, { recursive: true, force: true }); }
});
test('E03 actual loopback client disconnect leaves server-side work registered', async t => {
  const work = gate(); const entered = gate(); const f = await fixture(t, { workspace: { runWorkspaceSummary: async () => { entered.release(); await work.promise; return summary; } } });
  f.releases.push(work.release); const api = await f.listen();
  const request = http.request({ hostname: '127.0.0.1', port: api.port, path: '/api/opencode/workspace-summary', method: 'POST', headers: f.headers });
  request.on('error', () => {}); request.end('{}'); await entered.promise;
  await new Promise(resolve => { request.once('close', resolve); request.destroy(); });
  f.barrier.drain(); assert.equal(f.barrier.status().active, 1); assert.throws(() => f.barrier.confirm(), { code: 'NOT_DRAINED' });
  work.release(); await f.barrier.waitForDrain();
});

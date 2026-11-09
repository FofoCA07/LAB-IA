import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { assembleIsolated } from './isolated-assembly.mjs';
import { verifyRemoteTermination } from './remote-termination.mjs';
import { createBarrier } from './barrier.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
const job = Object.freeze({ containerID: 'a'.repeat(64), containerStartedAt: '2026-01-01T00:00:00Z', execID: 'b'.repeat(64), pid: 123, processStart: '456' });
function ended() {
  return { container: { id: job.containerID, startedAt: job.containerStartedAt, running: true },
    execution: { id: job.execID, pid: job.pid, processStart: job.processStart, running: false, exitCode: 0 },
    process: null, inventory: { complete: true, scope: 'tracked-exec-and-descendants', unknown: 0, descendants: [] } };
}
test('R01 legacy Docker CLI result cannot identify a remote execution', async () => {
  const result = await verifyRemoteTermination({ containerID: job.containerID, pid: job.pid }, () => assert.fail('must not query without identity'));
  assert.equal(result.terminated, false); assert.equal(result.reason, 'IDENTITY_INSUFFICIENT');
});
test('R02 one bound execution can be proven ended, without claiming global quiescence', async () => {
  const result = await verifyRemoteTermination(job, async expected => { assert.deepEqual(expected, job); return ended(); });
  assert.deepEqual(result, { terminated: true, reason: 'TRACKED_EXECUTION_ENDED', globalQuiescence: false });
});
test('R03 running, reused, restarted or unknown targets cannot pass', async () => {
  const variants = [
    value => { value.execution.running = true; },
    value => { value.execution.id = 'c'.repeat(64); },
    value => { value.process = { pid: job.pid, start: '999', alive: false }; },
    value => { value.process = { pid: job.pid, start: job.processStart, alive: true }; },
    value => { value.container.startedAt = '2026-01-02T00:00:00Z'; },
    value => { value.container.running = false; },
    value => { value.inventory.unknown = 1; },
    value => { value.inventory.complete = false; },
    value => { value.inventory.descendants = [{ pid: 124, start: '789', alive: true }]; },
  ];
  for (const change of variants) { const observation = ended(); change(observation); assert.equal((await verifyRemoteTermination(job, async () => observation)).terminated, false); }
});
test('R04 failed, slow or absent remote inspection is uncertainty', async () => {
  assert.equal((await verifyRemoteTermination(job, async () => { throw Error('PRIVATE'); })).reason, 'OBSERVATION_FAILED_OR_TIMEOUT');
  const pending = gate(); const proof = await verifyRemoteTermination(job, () => pending.promise, { timeoutMs: 5 });
  pending.release(ended()); await tick(); assert.equal(proof.terminated, false);
  assert.equal((await verifyRemoteTermination(job, async () => null)).terminated, false);
});
test('R05 exit, close and independent remote proof are separate barrier events', async t => {
  let observation = ended(); observation.execution.running = true;
  const verify = async () => (await verifyRemoteTermination(job, async () => observation)).terminated;
  let stored = null;
  const barrier = createBarrier({ store: { load: () => stored, save: value => { stored = structuredClone(value); } }, verifyRecovery: async () => true, verifyUncertain: verify });
  t.after(() => barrier.close()); await barrier.recover(); barrier.confirm(); barrier.reopen();
  const ticket = barrier.admit('summary'); const child = new EventEmitter(); const remote = ticket.trackChild(child, { remote: true, verifyRemote: verify });
  ticket.finish(); barrier.drain(); child.emit('exit', 0); assert.equal(barrier.status().active, 1);
  child.emit('close', 0); await tick(); assert.equal(barrier.status().active, 1); assert.throws(() => barrier.confirm(), { code: 'NOT_DRAINED' });
  observation = ended(); await remote.verifyRemoteCompletion(); await barrier.reconcileJob(ticket.id);
  assert.equal(barrier.confirm().state, 'MAINTENANCE');
});
test('R06 timeout or cancellation does not become remote completion', async t => {
  for (const code of ['TIMEOUT', 'UNCERTAIN']) {
    let stored = null;
    const barrier = createBarrier({ store: { load: () => stored, save: x => { stored = x; } }, verifyRecovery: async () => true }); t.after(() => barrier.close());
    await barrier.recover(); barrier.confirm(); barrier.reopen();
    const ticket = barrier.admit('activation'); const child = new EventEmitter(); ticket.trackChild(child, { remote: true });
    ticket.mark(code); ticket.finish(); child.emit('close', 137); await tick();
    assert.equal(barrier.status().state, 'DRAINING'); assert.equal(barrier.status().active, 1); assert.throws(() => barrier.confirm(), { code: 'NOT_DRAINED' });
  }
});

test('A01 copied index assembles real auth/schema/router but closed startup performs no warmup', async t => {
  const f = await assembleIsolated(t, { normal: false });
  assert.ok(f.loadedModules.includes('index.js')); assert.ok(f.loadedModules.includes('auth.js'));
  assert.equal(f.counts.mockFetch, 0); assert.equal(f.namespace.ollamaWarmup.state, 'idle');
  assert.equal((await f.request('/api/auth/session')).status, 200);
  assert.equal((await f.request('/api/opencode/workspace-summary', { method: 'POST', body: {}, authenticated: false })).status, 401);
  assert.equal((await f.request('/api/opencode/workspace-summary', { method: 'POST', body: {} })).status, 503);
  assert.equal(f.counts.denied, 0);
});
test('A02 NORMAL copied index exercises actual snapshot, exec wrapper and summary parser with fake Docker', async t => {
  const f = await assembleIsolated(t);
  const result = await f.request('/api/opencode/workspace-summary', { method: 'POST', body: {} });
  assert.equal(result.status, 200); assert.deepEqual(result.body.summary.elementos, ['README.md', 'notas.txt']);
  await tick(); assert.equal(f.barrier.status().active, 0); assert.ok(f.counts.mockDocker > 0);
  assert.equal((await f.request('/api/opencode/status')).body.version, '1.17.18'); assert.equal(f.counts.denied, 0);
});
test('A03 assembled index retains admitted work while refusing new requests until explicit reopening', async t => {
  const blocked = gate(); const f = await assembleIsolated(t, { blockSummary: blocked });
  const pending = f.request('/api/opencode/workspace-summary', { method: 'POST', body: {} });
  while (!f.pendingClients.size || !f.barrier.status().jobs.some(j => j.kind === 'summary' && j.resources.length)) await tick();
  f.barrier.drain(); assert.equal((await f.request('/api/workspaces/activate', { method: 'POST', body: { path: f.workspace } })).status, 503);
  assert.equal((await f.request('/api/workspaces/active')).status, 200);
  assert.throws(() => f.barrier.confirm(), { code: 'NOT_DRAINED' }); blocked.release();
  assert.equal((await pending).status, 200); await f.barrier.waitForDrain(); f.barrier.confirm();
  assert.equal((await f.request('/api/opencode/workspace-summary', { method: 'POST', body: {} })).status, 503);
  f.barrier.reopen(); assert.equal((await f.request('/api/opencode/workspace-summary', { method: 'POST', body: {} })).status, 200);
});
test('A04 actual index Promise completion does not override missing client close or remote evidence', async t => {
  const f = await assembleIsolated(t, { clientCloses: false, remoteProof: false });
  assert.equal((await f.request('/api/opencode/workspace-summary', { method: 'POST', body: {} })).status, 200);
  f.barrier.drain(); assert.equal(f.barrier.status().active, 1);
  for (const child of [...f.pendingClients]) child.closeClient(); await tick();
  assert.equal(f.barrier.status().active, 1); assert.throws(() => f.barrier.confirm(), { code: 'NOT_DRAINED' });
});
test('A05 actual router and SQLite chat contracts remain authenticated with synthetic fetch only', async t => {
  const f = await assembleIsolated(t);
  const conversation = await f.request('/api/conversations', { method: 'POST', body: { titulo: 'Sintético', agente_id: 'reviewer', modelo: 'qwen3:8b', workspace: f.workspace } });
  assert.equal(conversation.status, 201);
  const id = conversation.body.id;
  assert.equal((await f.request(`/api/conversations/${id}/messages`, { method: 'POST', body: { content: 'Sintético' } })).status, 201);
  assert.equal((await f.request(`/api/conversations/${id}/respond`, { method: 'POST', body: {} })).status, 200);
  assert.ok(f.counts.mockFetch > 0); f.barrier.drain(); await f.barrier.waitForDrain(); f.barrier.confirm();
  assert.equal((await f.request(`/api/conversations/${id}/messages`, { method: 'POST', body: { content: 'Bloqueado' } })).status, 503);
  assert.equal(f.counts.denied, 0);
});
test('A06 actual lab-open wrapper resolves at exit but barrier still waits for client close', async t => {
  const f = await assembleIsolated(t, { clientCloses: false });
  const response = await f.request('/api/workspaces/activate', { method: 'POST', body: { path: f.workspace } });
  assert.equal(response.status, 200); assert.equal(f.counts.mockLabOpen, 1);
  f.barrier.drain(); assert.equal(f.barrier.status().active, 1);
  for (const child of [...f.pendingClients]) child.closeClient();
  await f.barrier.waitForDrain(); assert.equal(f.barrier.confirm().state, 'MAINTENANCE');
});

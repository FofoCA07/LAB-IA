import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { once } from 'node:events';
import { createRemoteRun } from './remote-run.mjs';

const containerId = 'a'.repeat(64), executionId = 'b'.repeat(64);
const containerStartedAt = '2026-11-08T00:00:00Z';
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(check) {
  const end = Date.now() + 2000;
  while (!check()) { if (Date.now() >= end) throw Error('FIXTURE_TIMEOUT'); await pause(); }
}
function birth(pid) {
  try { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return s.slice(s.lastIndexOf(')') + 2).split(' ')[19]; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function fakeObservation() {
  return { container: { id: containerId, startedAt: containerStartedAt, running: true },
    execution: { id: executionId, pid: 123, processStart: '456', running: false, exitCode: 0 },
    process: null, inventory: { complete: true, scope: 'tracked-exec-and-descendants', unknown: 0, descendants: [] } };
}
function mocked(observe = async () => fakeObservation()) {
  const r = createRemoteRun({ containerId, containerStartedAt, observe, verificationTimeoutMs: 20 });
  r.creationAttempted(); r.bindExecution(executionId); r.started({ pid: 123, processStart: '456' }); return r;
}

// All execution/container observations are synthetic. Descendant completeness is
// guaranteed ONLY by this controlled fixture's source, never claimed for Docker.
async function fixture(t, { descendant = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labia-5b10r-')); fs.chmodSync(root, 0o700);
  const workerFile = path.join(root, 'worker.mjs'), parentFile = path.join(root, 'parent.mjs');
  fs.writeFileSync(workerFile, 'setInterval(() => {}, 1000);\n', { mode: 0o600 });
  fs.writeFileSync(parentFile, `import { spawn } from 'node:child_process';
const worker = process.argv[2] ? spawn(process.execPath, [process.argv[2]], {
  detached: true, stdio: 'ignore', env: { LANG: 'C' } }) : null;
process.send({ worker: worker?.pid ?? null });
process.on('message', message => { if(message === 'finish') process.exit(0); });
`, { mode: 0o600 });
  let workerIdentity;
  const child = cp.spawn(process.execPath, [parentFile, ...(descendant ? [workerFile] : [])],
    { cwd: root, env: { LANG: 'C' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const closed = once(child, 'close'); let closeSeen = false;
  child.once('close', () => { closeSeen = true; });
  t.after(async () => {
    if (!closeSeen) child.kill('SIGTERM');
    await closed;
    if (workerIdentity && birth(workerIdentity.pid) === workerIdentity.start) {
      process.kill(workerIdentity.pid, 'SIGTERM');
      await until(() => birth(workerIdentity.pid) === null);
    }
    fs.rmSync(root, { recursive: true, force: true });
    assert.equal(fs.existsSync(root), false);
  });
  const [ready] = await once(child, 'message');
  if (ready.worker) workerIdentity = { pid: ready.worker, start: birth(ready.worker) };
  const start = birth(child.pid); assert.ok(start);
  let mutate = value => value;
  const observe = async () => {
    const descendantState = workerIdentity ? [{ pid: workerIdentity.pid, start: workerIdentity.start,
      alive: birth(workerIdentity.pid) !== null }] : [];
    return mutate({ container: { id: containerId, startedAt: containerStartedAt, running: true },
      execution: { id: executionId, pid: child.pid, processStart: start,
        running: child.exitCode === null && child.signalCode === null, exitCode: child.exitCode },
      process: birth(child.pid) === null ? null : { pid: child.pid, start: birth(child.pid), alive: true },
      inventory: { complete: true, scope: 'tracked-exec-and-descendants', unknown: 0, descendants: descendantState } });
  };
  const run = createRemoteRun({ containerId, containerStartedAt, observe });
  run.creationAttempted(); run.bindExecution(executionId); run.started({ pid: child.pid, processStart: start });
  child.on('exit', () => run.clientEvent('exit')); child.on('close', () => run.clientEvent('close'));
  return { run, child, root, observe, mutate: fn => { mutate = fn; },
    async finish() { child.send('finish'); await closed; },
    async finishDescendant() {
      assert.equal(birth(workerIdentity.pid), workerIdentity.start);
      process.kill(workerIdentity.pid, 'SIGTERM'); await until(() => birth(workerIdentity.pid) === null);
    } };
}

test('R01 normal synthetic process needs independent final observation', async t => {
  const f = await fixture(t); assert.equal(f.run.snapshot().state, 'RUNNING');
  await f.finish(); assert.equal(f.run.snapshot().state, 'UNCERTAIN');
  const result = await f.run.verify(); assert.equal(result.state, 'FINISHED_VERIFIED');
  assert.equal(result.result.exitCode, 0); assert.equal(result.blocksDrain, false);
  assert.equal(result.remoteEndedAt, null); assert.ok(result.verifiedAt);
});
test('R02 exit before close never proves termination of the client resource', async () => {
  const r = mocked(); r.clientEvent('exit'); assert.equal((await r.verify()).reason, 'CLIENT_CLOSE_REQUIRED');
  r.clientEvent('close'); assert.equal((await r.verify()).state, 'FINISHED_VERIFIED');
});
test('R03 timeout keeps real synthetic work active and blocks drain', async t => {
  const f = await fixture(t); f.run.clientEvent('timeout');
  assert.equal((await f.run.verify()).blocksDrain, true); assert.equal(f.child.exitCode, null);
});
test('R04 HTTP disconnection never kills or proves completion of work', async t => {
  const f = await fixture(t); f.run.clientEvent('disconnect');
  assert.equal((await f.run.verify()).state, 'UNCERTAIN'); assert.equal(f.child.exitCode, null);
});
test('R05 escaped synthetic descendant remains active after parent close', async t => {
  const f = await fixture(t, { descendant: true }); await f.finish();
  assert.equal((await f.run.verify()).reason, 'DESCENDANTS_OR_INVENTORY_UNKNOWN');
});
test('R06 known synthetic descendant ending permits a new independent verification', async t => {
  const f = await fixture(t, { descendant: true }); await f.finish();
  assert.equal((await f.run.verify()).blocksDrain, true); await f.finishDescendant();
  assert.equal((await f.run.verify()).state, 'FINISHED_VERIFIED');
});
for (const [name, change, reason] of [
  ['R07 PID reused', x => { x.process = { pid: 123, start: '999', alive: false }; }, 'PID_REUSED_OR_UNKNOWN'],
  ['R08 container restarted', x => { x.container.startedAt = '2026-11-09T00:00:00Z'; }, 'CONTAINER_CHANGED'],
  ['R09 wrong exec identity', x => { x.execution.id = 'c'.repeat(64); }, 'EXECUTION_CHANGED'],
  ['R11 incomplete inventory', x => { x.inventory.complete = false; }, 'DESCENDANTS_OR_INVENTORY_UNKNOWN'],
  ['R12 unknown external execution', x => { x.inventory.unknown = 1; }, 'DESCENDANTS_OR_INVENTORY_UNKNOWN'],
]) test(name + ' blocks drain', async () => {
  const r = mocked(async () => { const x = fakeObservation(); change(x); return x; }); r.clientEvent('close');
  const result = await r.verify(); assert.equal(result.state, 'UNCERTAIN');
  assert.equal(result.reason, reason); assert.equal(result.blocksDrain, true);
});
test('R10 failed or timed-out query never supplies evidence', async () => {
  for (const observe of [async () => { throw Error('PRIVATE_DETAIL'); }, () => new Promise(() => {})]) {
    const r = mocked(observe); r.clientEvent('close'); const result = await r.verify();
    assert.equal(result.reason, 'OBSERVATION_FAILED_OR_TIMEOUT');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_DETAIL/);
  }
});
test('R13 create rejection differs from lost response; run identities are unique', async () => {
  const options = { containerId, containerStartedAt, observe: async () => fakeObservation() };
  const a = createRemoteRun(options), b = createRemoteRun(options);
  assert.notEqual(a.snapshot().runId, b.snapshot().runId);
  assert.equal(a.rejectedBeforeCreation().state, 'FAILED');
  b.creationAttempted(); assert.throws(() => b.rejectedBeforeCreation(), { code: 'CREATION_MAY_HAVE_OCCURRED' });
  b.clientEvent('error'); assert.equal((await b.verify()).blocksDrain, true);
});
test('R14 late evidence cannot override concurrent cancellation; recheck detects changed state', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const r = mocked(() => pending); r.clientEvent('close'); const verification = r.verify();
  r.clientEvent('cancel'); release(fakeObservation()); assert.equal((await verification).reason, 'OBSERVATION_RACED_WITH_EVENT');
  assert.equal((await r.verify()).state, 'FINISHED_VERIFIED');
  r.clientEvent('error'); assert.equal(r.snapshot().blocksDrain, true);
});
test('R15 overlapping verification cannot accept late evidence over newer uncertainty', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; }); let queries = 0;
  const r = mocked(() => { queries++; return pending; }); r.clientEvent('close');
  const first = r.verify();
  assert.equal((await r.verify()).reason, 'VERIFICATION_IN_PROGRESS');
  release(fakeObservation()); assert.equal((await first).state, 'UNCERTAIN');
  assert.equal(queries, 1); assert.equal(r.snapshot().blocksDrain, true);
});

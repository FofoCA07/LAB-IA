import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createBarrier } from './barrier.mjs';
import { openPrivateStore } from './private-store.mjs';
import { openLocalControl } from './local-control.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
function memory() {
  let data = null;
  return { load: () => structuredClone(data), save: value => { data = structuredClone(value); } };
}
async function normal(t, options = {}) {
  const barrier = createBarrier({ store: memory(), verifyRecovery: async () => true, ...options });
  t.after(() => barrier.close());
  await barrier.recover(); barrier.confirm(); barrier.reopen(); return barrier;
}
function directory(t) {
  const result = fs.mkdtempSync(path.join(here, '.test-'));
  fs.chmodSync(result, 0o700);
  t.after(() => fs.rmSync(result, { recursive: true, force: true }));
  return result;
}
function request(socketPath, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); let data = '';
    socket.setTimeout(3000, () => socket.destroy(new Error('TEST_TIMEOUT')));
    socket.on('connect', () => socket.write(JSON.stringify(payload) + '\n'));
    socket.on('data', part => { data += part; }); socket.on('error', reject);
    socket.on('end', () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
  });
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('T01 NORMAL admits and registers before work starts', async t => {
  const g = await normal(t); const j = g.admit('summary');
  assert.equal(g.status().active, 1); assert.equal(g.status().jobs[0].id, j.id); j.finish();
});
test('T02 DRAINING rejects new work', async t => {
  const g = await normal(t); g.drain(); assert.throws(() => g.admit('chat'), { code: 'ADMISSION_CLOSED' });
});
test('T03 admitted work completes after admission closes', async t => {
  const g = await normal(t); const j = g.admit('summary'); g.drain(); j.finish();
  assert.equal((await g.waitForDrain()).active, 0); assert.equal(g.status().state, 'DRAINING');
});
test('T04 maintenance requires zero work and positive recovery evidence', async t => {
  const closed = createBarrier({ store: memory() }); t.after(() => closed.close());
  await assert.rejects(closed.recover(), { code: 'RECOVERY_REQUIRED' });
  assert.throws(() => closed.confirm(), { code: 'NOT_DRAINED' });
  const g = await normal(t); const j = g.admit('activation'); g.drain();
  assert.throws(() => g.confirm(), { code: 'NOT_DRAINED' }); j.finish();
  assert.equal(g.confirm().state, 'MAINTENANCE');
});
test('T05 simultaneous jobs are independently counted', async t => {
  const g = await normal(t); const a = g.admit('chat'); const b = g.admit('proposal');
  assert.equal(g.status().active, 2); a.finish(); assert.equal(g.status().active, 1); b.finish();
});
test('T06 duplicate finish cannot release another job', async t => {
  const g = await normal(t); const a = g.admit('summary'); const b = g.admit('chat');
  assert.equal(a.finish(), true); assert.equal(a.finish(), false); assert.equal(g.status().active, 1); b.finish();
});
test('T07 HTTP disconnect and process exit do not replace process close', async t => {
  const g = await normal(t); const j = g.admit('summary'); const child = new EventEmitter();
  j.trackChild(child); const http = new EventEmitter(); http.emit('close'); j.finish(); g.drain();
  child.emit('exit', 0); assert.equal(g.status().active, 1);
  child.emit('close', 0); assert.equal((await g.waitForDrain()).active, 0);
});
test('T08 timeout retains uncertain work even after process close', async t => {
  const g = await normal(t); const j = g.admit('activation'); const child = new EventEmitter();
  j.trackChild(child); j.mark('TIMEOUT'); j.finish(); child.emit('close', 0);
  assert.equal(g.status().active, 1); assert.equal(g.status().jobs[0].uncertain, true);
  await assert.rejects(g.waitForDrain({ timeoutMs: 10 }), { code: 'WAIT_TIMEOUT' });
});
test('T09 deferred operation registered before scheduling survives HTTP completion', async t => {
  const g = await normal(t); const j = g.admit('action'); const deferred = j.hold('deferred');
  j.finish(); g.drain(); assert.equal(g.status().active, 1);
  await tick(); deferred.finish(); assert.equal((await g.waitForDrain()).active, 0);
});
test('T10 microtask admission/drain race has one linearization order', async t => {
  for (const first of ['admit', 'drain']) {
    const g = await normal(t); let job; let denied = false;
    const admit = () => { try { job = g.admit('summary'); } catch (error) { assert.equal(error.code, 'ADMISSION_CLOSED'); denied = true; } };
    await Promise.all(first === 'admit'
      ? [Promise.resolve().then(admit), Promise.resolve().then(() => g.drain())]
      : [Promise.resolve().then(() => g.drain()), Promise.resolve().then(admit)]);
    assert.equal(Boolean(job), first === 'admit'); assert.equal(denied, first === 'drain');
    if (job) { const child = job.hold('process'); job.finish(); assert.equal(g.status().active, 1); child.finish(); }
    assert.throws(() => g.admit('chat'), { code: 'ADMISSION_CLOSED' });
  }
});
test('T11 reopening is explicit and restores normal admission', async t => {
  const g = await normal(t); g.drain(); assert.throws(() => g.reopen(), { code: 'BAD_STATE' });
  g.confirm(); g.reopen(); g.admit('summary').finish();
});
test('T12 unauthorized control is rejected over a private Unix socket', async t => {
  const dir = directory(t); const g = await normal(t);
  const control = await openLocalControl({ directory: dir, barrier: g });
  try {
    assert.equal(fs.statSync(control.socketPath).mode & 0o777, 0o600);
    assert.deepEqual(await request(control.socketPath, { command: 'drain' }), { ok: false, code: 'UNAUTHORIZED' });
    assert.equal(g.status().state, 'NORMAL');
  } finally { await control.close(); }
});
test('T13 persistent maintenance and restart never silently reopen', async t => {
  const dir = directory(t); const store = openPrivateStore(dir);
  let g = createBarrier({ store, verifyRecovery: async () => true });
  await g.recover(); g.confirm();
  // Simulate process loss: release only the test store lock, preserving checkpoint.
  store.close();
  g = createBarrier({ store: openPrivateStore(dir) });
  try {
    assert.equal(g.status().state, 'DRAINING'); assert.equal(g.status().recoveryRequired, true);
    assert.throws(() => g.admit('summary'), { code: 'ADMISSION_CLOSED' });
    await assert.rejects(g.recover(), { code: 'RECOVERY_REQUIRED' });
  } finally { g.close(); }
});
test('T14 persistence failure is observable and cannot reopen', async t => {
  let broken = false; const s = memory();
  const g = await normal(t, { store: { load: s.load, save(value) { if (broken) throw Error('PRIVATE_DETAIL'); s.save(value); } } });
  broken = true; assert.throws(() => g.admit('summary'), { code: 'PERSISTENCE_FAILED' });
  assert.equal(g.status().fault, 'PERSISTENCE_FAILED'); assert.equal(g.status().state, 'DRAINING');
  assert.throws(() => g.reopen(), { code: 'PERSISTENCE_FAILED' });
});
test('T15 metadata excludes caller text, prompts and credentials', async t => {
  const store = memory(); const g = await normal(t, { store });
  assert.throws(() => g.admit('PRIVATE_TOKEN'), { code: 'INVALID_KIND' });
  const j = g.admit('chat'); assert.throws(() => j.mark('PRIVATE_PROMPT'), { code: 'INVALID_CODE' });
  j.finish(); assert.doesNotMatch(JSON.stringify([g.status(), store.load()]), /PRIVATE_TOKEN|PRIVATE_PROMPT/);
});
test('T16 candidate runtime has no Docker, process execution or HTTP transport dependency', () => {
  const allowed = new Set(['node:events', 'node:fs', 'node:path', 'node:crypto', 'node:net', './barrier.mjs', './private-store.mjs']);
  for (const name of ['barrier.mjs', 'private-store.mjs', 'local-control.mjs']) {
    const source = fs.readFileSync(path.join(here, name), 'utf8');
    for (const match of source.matchAll(/from '([^']+)'/g)) assert.ok(allowed.has(match[1]));
    assert.doesNotMatch(source, /\b(?:fetch|execFile|spawn|execSync|createConnection)\s*\(/);
  }
});
test('T17 Docker client close alone leaves remote work registered', async t => {
  const g = await normal(t); const j = g.admit('summary'); const child = new EventEmitter();
  j.trackChild(child, { remote: true }); j.finish(); g.drain(); child.emit('close', 0); await tick();
  assert.equal(g.status().active, 1); assert.ok(g.status().jobs[0].resources.includes('remote'));
  assert.throws(() => g.confirm(), { code: 'NOT_DRAINED' });
});
test('T18 positive remote evidence releases client plus remote holds', async t => {
  const g = await normal(t); const j = g.admit('summary'); const child = new EventEmitter();
  j.trackChild(child, { remote: true, verifyRemote: async () => true }); j.finish(); g.drain();
  child.emit('close', 0); await tick(); assert.equal((await g.waitForDrain()).active, 0);
});
test('T19 aborted wait does not cancel or release real work', async t => {
  const g = await normal(t); const j = g.admit('chat'); g.drain(); const c = new AbortController();
  const pending = g.waitForDrain({ signal: c.signal }); c.abort();
  await assert.rejects(pending, { code: 'WAIT_ABORTED' }); assert.equal(g.status().active, 1); j.finish();
});
test('T20 diagnostics are scoped and ordinary admission remains closed', async t => {
  const g = await normal(t); g.drain(); g.confirm(); let remote;
  await g.runAdministrative('admin-health', async job => {
    remote = job.hold('remote'); assert.equal(g.status().state, 'DRAINING');
    assert.throws(() => g.admit('summary'), { code: 'ADMISSION_CLOSED' });
  });
  assert.throws(() => g.confirm(), { code: 'NOT_DRAINED' }); remote.finish(); g.confirm();
  assert.equal(g.status().state, 'MAINTENANCE');
});
test('T21 recovered jobs require trusted verification, not a timer', async t => {
  const dir = directory(t); const store = openPrivateStore(dir);
  store.save({ version: 1, state: 'NORMAL', sequence: 1, jobs: [{ id: 'j1', kind: 'summary' }] }); store.close();
  let proven = false; const g = createBarrier({ store: openPrivateStore(dir), verifyRecovery: async () => proven });
  try {
    await assert.rejects(g.recover(), { code: 'RECOVERY_REQUIRED' }); assert.equal(g.status().active, 1);
    proven = true; await g.recover(); g.confirm(); g.reopen();
  } finally { g.close(); }
});
test('T22 uncertain completion requires a separate positive verifier', async t => {
  let verified = false; const g = await normal(t, { verifyUncertain: async () => verified });
  const j = g.admit('activation'); j.mark('TIMEOUT'); j.finish();
  await assert.rejects(g.reconcileJob(j.id), { code: 'UNCERTAIN' });
  verified = true; await g.reconcileJob(j.id); g.confirm();
});
test('T23 private state rejects symlinks, unsafe permissions and second owner', t => {
  const dir = directory(t); const store = openPrivateStore(dir);
  assert.throws(() => openPrivateStore(dir), { code: 'EEXIST' }); store.close();
  fs.writeFileSync(path.join(dir, 'target'), '{}', { mode: 0o600 });
  fs.symlinkSync('target', path.join(dir, 'state.json'));
  const unsafe = openPrivateStore(dir);
  try { assert.throws(() => unsafe.load(), { code: 'UNSAFE_STATE' }); } finally { unsafe.close(); }
  fs.chmodSync(dir, 0o755); assert.throws(() => openPrivateStore(dir), { code: 'UNSAFE_DIRECTORY' });
});
test('T24 corruption cannot silently reset persisted maintenance', t => {
  const dir = directory(t); fs.writeFileSync(path.join(dir, 'state.json'), '{', { mode: 0o600 });
  const store = openPrivateStore(dir);
  try { assert.throws(() => createBarrier({ store }), SyntaxError); } finally { store.close(); }
});
test('T25 control accepts fixed commands and never returns callback content', async t => {
  const dir = directory(t); const g = await normal(t); g.drain(); g.confirm();
  const control = await openLocalControl({ directory: dir, barrier: g, authorize: () => true,
    diagnostics: { 'admin-health': async () => 'PRIVATE_RESPONSE' } });
  try {
    const result = await request(control.socketPath, { command: 'diagnostic', kind: 'admin-health' });
    assert.equal(result.ok, true); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_RESPONSE/);
    assert.equal((await request(control.socketPath, { command: 'confirm' })).ok, true);
    assert.equal((await request(control.socketPath, { command: 'reopen' })).ok, true);
    assert.equal((await request(control.socketPath, { command: 'status', token: 'PRIVATE' })).code, 'INVALID_COMMAND');
    assert.equal((await request(control.socketPath, { command: 'exec' })).code, 'INVALID_COMMAND');
  } finally { await control.close(); }
});
test('T26 shutdown records closed admission with outstanding work', async t => {
  const store = memory(); const g = await normal(t, { store }); g.admit('continuation'); g.close();
  assert.equal(store.load().state, 'DRAINING'); assert.equal(store.load().jobs.length, 1);
  assert.throws(() => g.admit('summary'), { code: 'DISPOSED' });
});
test('T27 root completion forbids untracked late resource scheduling', async t => {
  const g = await normal(t); const j = g.admit('action'); j.finish();
  assert.throws(() => j.hold('deferred'), { code: 'INVALID_RESOURCE' });
});
test('T28 diagnostic failures remain observable with admission closed', async t => {
  const g = await normal(t); g.drain(); g.confirm();
  await assert.rejects(g.runAdministrative('admin-health', async () => { throw Error('PRIVATE'); }), { code: 'DIAGNOSTIC_FAILED' });
  assert.equal(g.status().state, 'DRAINING'); assert.equal(g.status().lastError, 'OPERATION_FAILED');
});
test('T29 remote uncertainty can recover only after both trusted proofs', async t => {
  let proven = false; const g = await normal(t, { verifyUncertain: async () => proven });
  const j = g.admit('summary'); const child = new EventEmitter();
  const tracking = j.trackChild(child, { remote: true, verifyRemote: async () => proven });
  await assert.rejects(tracking.verifyRemoteCompletion(), { code: 'REMOTE_NOT_CLOSED' });
  j.finish(); child.emit('close', 0); await tick();
  assert.throws(() => g.confirm(), { code: 'NOT_DRAINED' });
  proven = true; await tracking.verifyRemoteCompletion();
  assert.equal(g.status().active, 1); await g.reconcileJob(j.id); g.confirm();
});
test('T30 control loss closes normal admission', async t => {
  const dir = directory(t); const g = await normal(t);
  const control = await openLocalControl({ directory: dir, barrier: g, authorize: () => true });
  await control.close(); assert.equal(g.status().state, 'DRAINING');
});
test('T31 an administrative client disconnect does not finish its diagnostic', async t => {
  const dir = directory(t); const g = await normal(t); g.drain(); g.confirm();
  let release; let started;
  const entered = new Promise(resolve => { started = resolve; });
  const done = new Promise(resolve => { release = resolve; });
  const control = await openLocalControl({ directory: dir, barrier: g, authorize: () => true,
    diagnostics: { 'admin-health': async () => { started(); await done; } } });
  const socket = net.createConnection(control.socketPath); socket.on('error', () => {});
  try {
    await new Promise(resolve => socket.once('connect', resolve));
    socket.write(JSON.stringify({ command: 'diagnostic', kind: 'admin-health' }) + '\n');
    await entered; socket.destroy(); await tick();
    assert.equal(g.status().active, 1); assert.throws(() => g.confirm(), { code: 'NOT_DRAINED' });
    release(); await tick(); assert.equal((await g.waitForDrain()).active, 0);
  } finally { release(); socket.destroy(); await control.close(); }
});
test('T32 local recovery calls only the installed verifier, never caller evidence', async t => {
  const dir = directory(t); let proven = false;
  const g = createBarrier({ store: memory(), verifyRecovery: async () => proven }); t.after(() => g.close());
  const control = await openLocalControl({ directory: dir, barrier: g, authorize: () => true });
  try {
    assert.equal((await request(control.socketPath, { command: 'recover' })).code, 'RECOVERY_REQUIRED');
    assert.equal((await request(control.socketPath, { command: 'recover', proof: true })).code, 'INVALID_COMMAND');
    proven = true; assert.equal((await request(control.socketPath, { command: 'recover' })).ok, true);
    assert.equal(g.status().state, 'DRAINING'); assert.equal(g.status().recoveryRequired, false);
  } finally { await control.close(); }
});
test('T33 failed control startup closes admission and preserves preexisting files', async t => {
  const dir = directory(t); const g = await normal(t); const file = path.join(dir, 'control.sock');
  fs.writeFileSync(file, 'existing', { mode: 0o600 });
  await assert.rejects(openLocalControl({ directory: dir, barrier: g }), { code: 'UNSAFE_SOCKET' });
  assert.equal(g.status().state, 'DRAINING'); assert.equal(fs.readFileSync(file, 'utf8'), 'existing');
});

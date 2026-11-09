import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { operationalFixture } from './window-b-fixture.mjs';

async function until(check) {
  const deadline = Date.now() + 1000;
  while (!check()) { if (Date.now() >= deadline) throw Error('FIXTURE_CONDITION_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 2)); }
}
test('T01 technical synthetic gate rejects new requests, including direct backend access', async t => {
  const f = await operationalFixture(t); const existing = f.request();
  await until(() => f.jobs.length === 1); const window = f.createWindow(); const preparation = window.prepare();
  await until(() => window.status().state === 'DRAINING'); assert.equal((await f.request()).status, 503);
  f.finish(1); assert.equal((await existing).status, 200); await preparation;
});
test('T02 work admitted before the gate closes can finish normally', async t => {
  const f = await operationalFixture(t); const existing = f.request(); await until(() => f.jobs.length === 1);
  const window = f.createWindow(); const preparation = window.prepare(); await until(() => f.getClosed());
  assert.equal(f.counts.stops, 0); f.finish(1); await existing;
  assert.equal((await preparation).state, 'STOPPED'); assert.equal(f.jobs[0].active, false);
});
test('T03 persistent synthetic remote worker prevents stopping backend', async t => {
  const f = await operationalFixture(t); const worker = await f.remoteWorker(); const window = f.createWindow({ deadlineMs: 40 });
  await assert.rejects(window.prepare(), { code: 'DEADLINE' }); assert.equal(f.counts.stops, 0);
  assert.equal(worker.record.active, true); assert.equal(worker.child.exitCode, null);
});
test('T04 unknown process fails closed without signalling it', async t => {
  const f = await operationalFixture(t); const worker = await f.remoteWorker('unknown'); const window = f.createWindow();
  await assert.rejects(window.prepare(), { code: 'WORK_UNKNOWN' }); assert.equal(f.counts.stops, 0); assert.equal(worker.child.exitCode, null);
  const incomplete = await operationalFixture(t); incomplete.adapter.inventory = async () => ({ complete: false, jobs: [] });
  await assert.rejects(incomplete.createWindow().prepare(), { code: 'INVENTORY_INCOMPLETE' }); assert.equal(incomplete.counts.stops, 0);
});
test('T05 client timeout never clears server work or permits closure', async t => {
  const f = await operationalFixture(t); const request = f.request(); request.catch(() => {});
  await until(() => f.jobs.length === 1); request.client().setTimeout(5, () => request.client().destroy(Error('synthetic timeout')));
  await assert.rejects(request); assert.equal(f.jobs[0].active, true);
  await assert.rejects(f.createWindow({ deadlineMs: 40 }).prepare(), { code: 'DEADLINE' }); assert.equal(f.counts.stops, 0);
});
test('T06 disconnected HTTP client does not terminate a separate remote worker', async t => {
  const f = await operationalFixture(t); const remote = await f.remoteWorker(); const request = f.request(); request.catch(() => {});
  await until(() => f.jobs.some(job => job.id === 1)); request.client().destroy(Error('synthetic disconnect')); await assert.rejects(request);
  assert.equal(remote.child.exitCode, null); assert.equal(f.jobs.find(job => job.id === 1).active, true);
  f.finish(1); await assert.rejects(f.createWindow({ deadlineMs: 40 }).prepare(), { code: 'DEADLINE' });
  assert.equal(remote.record.active, true);
});
test('T07 unexpected supervised restart is detected and prevents window acceptance', async t => {
  const f = await operationalFixture(t, { restartUnexpectedly: true }); const window = f.createWindow();
  await assert.rejects(window.prepare(), { code: 'BACKEND_REAPPEARED' }); assert.equal(f.counts.starts, 2); assert.equal(window.status().state, 'NO_GO');
  const duringAcceptance = await operationalFixture(t); const later = duringAcceptance.createWindow(); await later.prepare(); await later.startAcceptance();
  const status = duringAcceptance.adapter.backendStatus;
  duringAcceptance.adapter.backendStatus = async () => { const value = await status(); return { ...value, identity: { ...value.identity, start: '0' } }; };
  await assert.rejects(later.accept(), { code: 'BACKEND_REAPPEARED' }); assert.equal(duringAcceptance.counts.releaseAdmission, 0);
});
test('T08 stopped synthetic backend remains unable to admit HTTP requests', async t => {
  const f = await operationalFixture(t); const window = f.createWindow(); await window.prepare();
  await assert.rejects(f.request('/health'), error => ['ECONNREFUSED', 'ECONNRESET'].includes(error.code));
  assert.equal(window.status().state, 'STOPPED'); assert.equal(f.counts.starts, 1); assert.equal(f.getClosed(), true);
});
test('T09 failed preflight performs no admission or stop operation', async t => {
  const f = await operationalFixture(t, { preflightPass: false }); const before = f.state();
  await assert.rejects(f.createWindow().prepare(), { code: 'PREFLIGHT' });
  assert.equal(f.getClosed(), false); assert.equal(f.counts.stops, 0); assert.deepEqual(f.state(), before);
});
test('T10 startup and reopening require explicit authorization and acceptance', async t => {
  const denied = await operationalFixture(t); const first = denied.createWindow(); await first.prepare(); denied.setAuthorized(false);
  await assert.rejects(first.startAcceptance(), { code: 'UNAUTHORIZED' }); assert.equal(denied.counts.starts, 1); assert.equal(denied.counts.releaseAdmission, 0);
  const allowed = await operationalFixture(t); const second = allowed.createWindow(); await second.prepare();
  await second.startAcceptance(); assert.equal((await allowed.request()).status, 503);
  await second.accept(); allowed.setAuthorized(false);
  await assert.rejects(second.reopen(), { code: 'UNAUTHORIZED' }); assert.equal(allowed.counts.releaseAdmission, 0); assert.equal(allowed.getClosed(), true);
});
test('T11 rollback restores configuration while preserving workspace and message state', async t => {
  const f = await operationalFixture(t); const original = f.state(); const window = f.createWindow(); await window.prepare();
  f.stageConfiguration(); assert.equal(f.state().configuration, 'candidate'); await window.rollback(); assert.deepEqual(f.state(), original);
  await window.startAcceptance(); await window.accept(); await window.reopen(); assert.deepEqual(f.state(), original);
});
test('T12 candidate has no production adapter and fixture launch/network destinations are constrained', () => {
  const candidate = fs.readFileSync(new URL('./window-b.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(candidate, /node:(?:child_process|http|net)|fetch\(|execFile\(|spawn\(/);
  const fixture = fs.readFileSync(new URL('./window-b-fixture.mjs', import.meta.url), 'utf8');
  assert.match(fixture, /cp\.spawn\(process\.execPath, \[file\]/); assert.match(fixture, /\[backendFile, workerFile\]\.includes\(file\)/);
  assert.match(fixture, /hostname: '127\.0\.0\.1', port/); assert.match(fixture, /\[3001, 11434\]\.includes\(port\)/);
  assert.doesNotMatch(fixture, /docker\.sock|execFile\(|http:\/\/127\.0\.0\.1:11434/);
});

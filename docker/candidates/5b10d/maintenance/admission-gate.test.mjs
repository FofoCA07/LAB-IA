import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { fixture, gate, summary, memoryStore } from './integration-fixture.mjs';
import { createAdmissionGate } from './admission-gate.mjs';

// Deny accidental production fallbacks before importing any staged factory.
const saved = { fetch: globalThis.fetch, execFile: cp.execFile, spawn: cp.spawn };
let fallbacks = 0;
const deny = () => { fallbacks++; throw Error('EXTERNAL_SERVICE_DENIED'); };
globalThis.fetch = deny; cp.execFile = deny; cp.spawn = deny; syncBuiltinESMExports();
test.after(() => {
  globalThis.fetch = saved.fetch; cp.execFile = saved.execFile; cp.spawn = saved.spawn; syncBuiltinESMExports();
  assert.equal(fallbacks, 0);
});
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(check) {
  const deadline = Date.now() + 2000;
  while (!check()) { if (Date.now() >= deadline) throw Error('FIXTURE_TIMEOUT'); await tick(); }
}
function command(socketPath, command) {
  assert.ok(socketPath.startsWith('/tmp/labia-5b10n-'));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); let result = '';
    socket.setTimeout(2000, () => socket.destroy(Error('CONTROL_TIMEOUT')));
    socket.on('connect', () => socket.write(JSON.stringify({ command }) + '\n'));
    socket.on('data', value => { result += value; }); socket.on('error', reject);
    socket.on('end', () => { try { resolve(JSON.parse(result)); } catch (error) { reject(error); } });
  });
}
async function candidate(t, options = {}) {
  const f = await fixture(t, options);
  const adapter = createAdmissionGate({ barrier: f.barrier, json: f.json });
  let control; let server;
  const route = f.modules['workspace-routes'].createPrivateWorkspaceRoutes({ ...f.workspaceConfig, maintenance: adapter.hooks });
  t.after(async () => {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (control) await control.close();
    await f.shutdown(); assert.equal(fs.existsSync(f.directory), false);
  });
  async function invoke(url = '/api/opencode/workspace-summary', { method = 'POST', body = {}, extraHeaders = {}, chunks } = {}) {
    const request = Readable.from(chunks ?? [Buffer.from(JSON.stringify(body))]);
    Object.assign(request, { url, method, headers: { ...f.headers, ...extraHeaders } });
    const response = f.responseMock(); await route(request, response); return response;
  }
  return { ...f, adapter, invoke,
    async control(authorize) {
      control = await adapter.openControl({ directory: f.stateDirectory, authorize });
      return name => command(control.socketPath, name);
    },
    async listen() {
      server = http.createServer((req, res) => { void route(req, res).catch(() => {
        if (!res.headersSent && !res.destroyed) f.json(res, 500, { error: 'SYNTHETIC_FAILURE' });
      }); });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const port = server.address().port; assert.ok(![3001, 11434].includes(port));
      return () => new Promise((resolve, reject) => {
        const request = http.request({ hostname: '127.0.0.1', port, path: '/api/opencode/workspace-summary', method: 'POST', headers: f.headers }, response => {
          response.resume(); response.on('end', () => resolve(response.statusCode));
        });
        request.setTimeout(2000, () => request.destroy(Error('HTTP_TIMEOUT'))); request.on('error', reject); request.end('{}');
      });
    },
  };
}

test('G01 NORMAL preserves the real workspace factory result', async t => {
  const f = await candidate(t); const response = await f.invoke();
  assert.equal(response.status, 200); assert.deepEqual(response.body.summary, summary);
  assert.equal(f.adapter.status().active, 0);
});
test('G02 local close rejects new work while safe real queries remain available', async t => {
  const f = await candidate(t); const admin = await f.control(() => true);
  assert.equal((await admin('drain')).ok, true); assert.equal((await f.invoke()).status, 503);
  assert.equal(f.counts.summary, 0);
  for (const url of ['/api/workspaces', '/api/workspaces/active', '/api/opencode/status']) {
    assert.equal((await f.invoke(url, { method: 'GET' })).status, 200);
  }
  assert.equal(f.counts.probe, 0);
});
test('G03 direct loopback HTTP is gated without relying on a frontend proxy', async t => {
  const f = await candidate(t); const request = await f.listen();
  assert.equal(await request(), 200); const admin = await f.control(() => true); await admin('drain');
  assert.equal(await request(), 503); assert.equal(f.counts.summary, 1);
});
test('G04 an admitted real handler stays tracked until its promise settles', async t => {
  const work = gate(); const f = await candidate(t, { workspace: { runWorkspaceSummary: () => work.promise.then(() => summary) } });
  f.releases.push(work.release); const pending = f.invoke(); await until(() => f.adapter.status().active === 1);
  const admin = await f.control(() => true); await admin('drain'); assert.equal((await admin('confirm')).code, 'NOT_DRAINED');
  work.release(); assert.equal((await pending).status, 200); assert.equal((await admin('confirm')).ok, true);
});
test('G05 reused deferred reservation survives root completion and closure', async t => {
  const f = await candidate(t); let scheduled; const work = gate(); f.releases.push(work.release);
  await f.adapter.hooks.run('action', async () => f.adapter.hooks.defer(() => work.promise, callback => { scheduled = callback; }));
  assert.equal(f.adapter.status().jobs[0].rootDone, true);
  const admin = await f.control(() => true); await admin('drain'); scheduled(); await tick();
  assert.equal((await admin('confirm')).code, 'NOT_DRAINED'); work.release();
  await until(() => f.adapter.status().active === 0); assert.equal((await admin('confirm')).ok, true);
});
test('G06 child timeout and close retain unverified remote work', async t => {
  const f = await candidate(t); const child = new EventEmitter(); child.kill = () => true;
  await f.adapter.hooks.run('summary', async () => {
    const tracked = f.adapter.hooks.child(() => child, { remote: true });
    tracked.timeout(); child.emit('exit', 137); child.emit('close', 137); await tracked.done;
  });
  await tick(); const admin = await f.control(() => true);
  assert.equal(f.adapter.status().jobs[0].uncertain, true);
  assert.ok(f.adapter.status().jobs[0].resources.includes('remote'));
  assert.equal((await admin('confirm')).code, 'NOT_DRAINED');
});
test('G07 real warmup factory cannot start during closure', async t => {
  const f = await candidate(t); let calls = 0;
  const warmup = f.modules['ollama-warmup'].createOllamaWarmup({ maintenance: f.adapter.hooks,
    fetchImpl: async () => { calls++; throw Error('SHOULD_NOT_RUN'); } });
  const admin = await f.control(() => true); await admin('drain');
  assert.throws(() => warmup.start(), { code: 'ADMISSION_CLOSED' }); assert.equal(calls, 0); assert.equal(warmup.state, 'idle');
});
test('G08 closure during real body parsing wins before protected admission', async t => {
  const f = await candidate(t); const body = gate(); f.releases.push(body.release);
  async function* chunks() { yield Buffer.from('{'); await body.promise; yield Buffer.from('}'); }
  const pending = f.invoke(undefined, { chunks: chunks() }); await tick();
  const admin = await f.control(() => true); await admin('drain'); body.release();
  assert.equal((await pending).status, 503); assert.equal(f.counts.summary, 0);
});
test('G09 original auth and body validation remain before maintenance rejection', async t => {
  const f = await candidate(t); const admin = await f.control(() => true); await admin('drain');
  assert.equal((await f.invoke(undefined, { extraHeaders: { cookie: undefined } })).status, 401);
  assert.equal((await f.invoke(undefined, { body: { unexpected: true } })).status, 400);
  assert.equal((await f.invoke()).status, 503); assert.equal(f.counts.summary, 0);
});
test('G10 persistence failure rejects before effects and cannot reopen', async t => {
  let broken = false; const store = memoryStore();
  const f = await candidate(t, { store: { load: store.load, save(x) { if (broken) throw Error('PRIVATE'); store.save(x); } } });
  const admin = await f.control(() => true); broken = true;
  assert.equal((await f.invoke()).status, 503); assert.equal(f.counts.summary, 0);
  assert.equal(f.adapter.status().fault, 'PERSISTENCE_FAILED'); assert.equal((await admin('reopen')).ok, false);
});
test('G11 private control denies by default and requires explicit authorized reopening', async t => {
  const denied = await candidate(t); const no = await denied.control();
  assert.equal((await no('reopen')).code, 'UNAUTHORIZED');
  const f = await candidate(t); let authorized = true; const admin = await f.control(() => authorized);
  await admin('drain'); await admin('confirm'); authorized = false;
  assert.equal((await admin('reopen')).code, 'UNAUTHORIZED'); assert.equal((await f.invoke()).status, 503);
  authorized = true; assert.equal((await admin('reopen')).ok, true); assert.equal((await f.invoke()).status, 200);
});
test('G12 no external process/fetch fallback, TCP admin or remote exclusivity claim', async t => {
  const f = await candidate(t); assert.equal(fallbacks, 0);
  assert.equal(f.adapter.status().remoteExclusivity, 'NOT_VERIFIED');
  assert.equal(typeof f.adapter.reopen, 'undefined');
  const admin = await f.control(() => true); const status = await admin('status'); assert.equal(status.ok, true);
  assert.equal(fs.statSync(f.stateDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(f.stateDirectory + '/control.sock').mode & 0o777, 0o600);
});

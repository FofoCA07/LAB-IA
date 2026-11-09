import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { stagePatch } from './patch-fixture.mjs';

function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labia-5b10t-state-')); fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root;
}
const json = (response, status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
function command(socketPath, command) {
  assert.ok(socketPath.startsWith('/tmp/labia-5b10'));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); let data = '';
    socket.setTimeout(2000, () => socket.destroy(Error('CONTROL_TIMEOUT')));
    socket.on('connect', () => socket.write(JSON.stringify({ command }) + '\n'));
    socket.on('data', part => { data += part; }); socket.on('error', reject);
    socket.on('end', () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
  });
}
async function normal(runtime) {
  for (const name of ['recover', 'confirm', 'reopen']) assert.equal((await command(runtime.control.socketPath, name)).ok, true);
}
test('P01 applied artifact hashes and syntax match all thirteen proposed files', async t => {
  const f = await stagePatch(t);
  const manifest = JSON.parse(fs.readFileSync(new URL('./GATE_PATCH_MANIFEST.json', import.meta.url)));
  assert.equal(Object.keys(manifest.sources).length, 13);
  for (const name of Object.keys(manifest.sources)) execFileSync(process.execPath, ['--check', path.join(f.root, name)]);
});
test('P02 clean bootstrap remains closed and Unix authorization defaults to deny', async t => {
  const f = await stagePatch(t); const d = directory(t); const runtime = await f.openAdmissionRuntime({ directory: d, json });
  try {
    assert.equal(runtime.status().state, 'DRAINING'); assert.equal(runtime.status().recoveryRequired, true);
    assert.equal((await command(runtime.control.socketPath, 'reopen')).code, 'UNAUTHORIZED');
    assert.equal(fs.statSync(runtime.control.socketPath).mode & 0o777, 0o600);
    assert.equal((await command(runtime.control.socketPath, 'shell')).code, 'INVALID_COMMAND');
  } finally { await runtime.close(); }
});
test('P03 persisted DRAINING and MAINTENANCE need explicit local recovery and reopening', async t => {
  const f = await stagePatch(t);
  for (const state of ['DRAINING', 'MAINTENANCE']) {
    const d = directory(t); fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify({ version: 1, sequence: 0, jobs: [], state }), { mode: 0o600 });
    let runtime = await f.openAdmissionRuntime({ directory: d, json, operatorEnabled: true });
    try { assert.equal(runtime.status().state, 'DRAINING'); await normal(runtime); assert.equal(runtime.status().state, 'NORMAL'); }
    finally { await runtime.close(); }
    runtime = await f.openAdmissionRuntime({ directory: d, json, operatorEnabled: true });
    try { assert.equal(runtime.status().state, 'DRAINING'); assert.equal(runtime.status().recoveryRequired, true); }
    finally { await runtime.close(); }
  }
});
test('P04 incomplete or corrupt persistent work cannot be cleared by recovery', async t => {
  const f = await stagePatch(t); const d = directory(t);
  fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify({ version: 1, sequence: 1, state: 'NORMAL', jobs: [{ id: 'j1', kind: 'summary' }] }), { mode: 0o600 });
  const runtime = await f.openAdmissionRuntime({ directory: d, json, operatorEnabled: true });
  try { assert.equal((await command(runtime.control.socketPath, 'recover')).code, 'RECOVERY_REQUIRED'); assert.equal(runtime.status().active, 1); }
  finally { await runtime.close(); }
  const broken = directory(t); const file = path.join(broken, 'state.json'); fs.writeFileSync(file, '{', { mode: 0o600 });
  await assert.rejects(f.openAdmissionRuntime({ directory: broken, json }), { code: 'MAINTENANCE_STARTUP_FAILED' });
  assert.equal(fs.readFileSync(file, 'utf8'), '{');
});
test('P05 occupied socket and unsafe private directory fail startup without deleting evidence', async t => {
  const f = await stagePatch(t); const d = directory(t); const socket = path.join(d, 'control.sock');
  fs.writeFileSync(socket, 'existing-marker', { mode: 0o600 });
  await assert.rejects(f.openAdmissionRuntime({ directory: d, json }), { code: 'MAINTENANCE_STARTUP_FAILED' });
  assert.equal(fs.readFileSync(socket, 'utf8'), 'existing-marker');
  const unsafe = directory(t); fs.chmodSync(unsafe, 0o755);
  await assert.rejects(f.openAdmissionRuntime({ directory: unsafe, json }), { code: 'MAINTENANCE_STARTUP_FAILED' });
});
test('P06 control loss closes admission and a broken store cannot reopen', async t => {
  const f = await stagePatch(t); const d = directory(t); const runtime = await f.openAdmissionRuntime({ directory: d, json, operatorEnabled: true });
  try {
    await normal(runtime); await runtime.control.close(); assert.equal(runtime.status().state, 'DRAINING');
    fs.chmodSync(d, 0o755); assert.throws(() => runtime.barrier.reopen());
  } finally { fs.chmodSync(d, 0o700); await runtime.close().catch(error => assert.equal(error.code, 'ERR_SERVER_NOT_RUNNING')); }
});
test('P07 applied index assembles with real auth/router but startup cannot warm up', async t => {
  const staged = await stagePatch(t); const f = await staged.assemble(t, { normal: false });
  assert.equal(f.counts.mockFetch, 0); assert.equal(f.namespace.ollamaWarmup.state, 'idle');
  assert.equal((await f.request('/api/auth/session')).status, 200);
  assert.equal((await f.request('/api/opencode/workspace-summary', { method: 'POST', body: {}, authenticated: false })).status, 401);
  assert.equal((await f.request('/api/opencode/workspace-summary', { method: 'POST', body: {} })).status, 503);
  assert.equal(f.counts.denied, 0);
});
test('P08 acceptance diagnostic: successful CLI work closes future admission without remote proof (NO-GO)', async t => {
  const staged = await stagePatch(t); const f = await staged.assemble(t, { normal: true });
  const first = await f.request('/api/opencode/workspace-summary', { method: 'POST', body: {} });
  assert.equal(first.status, 200); assert.deepEqual(first.body.summary.elementos, ['README.md', 'notas.txt']);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.barrier.status().state, 'DRAINING'); assert.ok(f.barrier.status().active > 0);
  assert.equal((await f.request('/api/opencode/workspace-summary', { method: 'POST', body: {} })).status, 503);
  assert.equal((await command(f.control.socketPath, 'confirm')).code, 'NOT_DRAINED');
  assert.equal(f.counts.denied, 0);
});

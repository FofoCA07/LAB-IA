// Diagnostic counterfactual ONLY. Never changes candidate modules or the rejected
// patch. Executable variants live solely in /tmp and are not promotion artifacts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
async function counterfactual(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labia-5b10u-')); fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let helper = fs.readFileSync(path.join(here, 'patch-fixture.mjs'), 'utf8');
  const hereAnchor = '\nconst here = path.dirname(fileURLToPath(import.meta.url));';
  assert.equal(helper.split(hereAnchor).length, 2);
  helper = helper.replace(hereAnchor, '\nconst here = ' + JSON.stringify(here) + ';');
  const anchor = "  const runtimeFile = path.join(server, 'maintenance/runtime.mjs');";
  assert.equal(helper.split(anchor).length, 2);
  // Inject AFTER checking original patch hashes, BEFORE importing its runtime.
  // Preserve uncertainty, holds, persistence and all other transitions/checks.
  const before = "if (code !== 'OPERATION_FAILED') { j.uncertain = true; state = 'DRAINING'; }";
  const after = "if (code !== 'OPERATION_FAILED') { j.uncertain = true; if (code !== 'UNCERTAIN') state = 'DRAINING'; }";
  helper = helper.replace(anchor, `  const variant = path.join(server, 'maintenance/barrier.mjs');
  const original = fs.readFileSync(variant, 'utf8');
  if (original.split(${JSON.stringify(before)}).length !== 2) throw Error('COUNTERFACTUAL_ANCHOR_CHANGED');
  fs.writeFileSync(variant, original.replace(${JSON.stringify(before)}, ${JSON.stringify(after)}));
${anchor}`);
  const file = path.join(root, 'counterfactual-fixture.mjs'); fs.writeFileSync(file, helper, { mode: 0o600 });
  const { stagePatch } = await import(pathToFileURL(file));
  return stagePatch(t);
}
function command(socketPath, command) {
  assert.ok(socketPath.startsWith('/tmp/labia-5b10o-'));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); let data = '';
    socket.setTimeout(2000, () => socket.destroy(Error('CONTROL_TIMEOUT')));
    socket.on('connect', () => socket.write(JSON.stringify({ command }) + '\n'));
    socket.on('data', part => { data += part; }); socket.on('error', reject);
    socket.on('end', () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
  });
}
test('U-DIAGNOSTIC sequential 200/200 can coexist with uncertainty, but does not prove safe admission', async t => {
  const staged = await counterfactual(t); const f = await staged.assemble(t, { normal: true });
  const url = '/api/opencode/workspace-summary', options = { method: 'POST', body: {} };
  assert.equal((await f.request(url, options)).status, 200);
  await new Promise(resolve => setImmediate(resolve));
  const first = f.barrier.status(); assert.equal(first.state, 'NORMAL');
  assert.ok(first.jobs.some(j => j.uncertain && j.resources.includes('remote')));
  assert.equal((await f.request(url, options)).status, 200);
  await new Promise(resolve => setImmediate(resolve));
  const second = f.barrier.status();
  for (const prior of first.jobs) assert.ok(second.jobs.some(j => j.id === prior.id && j.uncertain));
  assert.equal((await command(f.control.socketPath, 'drain')).ok, true);
  assert.equal((await f.request(url, options)).status, 503);
  assert.equal((await command(f.control.socketPath, 'confirm')).code, 'NOT_DRAINED');
  assert.equal(f.counts.denied, 0);
});
test('U-SAFETY conflicting activation MUST be rejected while a synthetic remote execution stays active', async t => {
  const staged = await counterfactual(t);
  const { createBarrier } = await import(pathToFileURL(path.join(staged.server, 'maintenance/barrier.mjs')));
  let saved = null; let remoteActive = true;
  const barrier = createBarrier({ store: { load: () => saved, save: value => { saved = structuredClone(value); } },
    verifyRecovery: async () => true });
  t.after(() => barrier.close());
  await barrier.recover(); barrier.confirm(); barrier.reopen();
  const job = barrier.admit('summary'); const client = new EventEmitter();
  job.trackChild(client, { remote: true, verifyRemote: async () => !remoteActive });
  job.finish(); client.emit('close', 0); await new Promise(resolve => setImmediate(resolve));
  assert.equal(remoteActive, true); assert.equal(barrier.status().jobs[0].uncertain, true);
  assert.equal(barrier.status().state, 'NORMAL');
  // This MUST fail for the naive decoupling. Do not replace with assert.doesNotThrow
  // or pass a fictional verifier just to obtain a green acceptance result.
  assert.throws(() => barrier.admit('activation'), 'Unsafe admission: activation can overlap the remote job');
});

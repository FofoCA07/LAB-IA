// Candidate JSON-lines control; no TCP listener, shell, Docker or public HTTP API.
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { assertPrivateDirectory } from './private-store.mjs';
import { failure } from './barrier.mjs';

export async function openLocalControl({ directory, barrier, authorize = () => false,
  diagnostics = {} }) {
  const socketPath = path.join(directory, 'control.sock');
  const closeAdmission = () => { try { barrier.drain(); } catch { /* Already fail-closed. */ } };
  try {
    assertPrivateDirectory(directory);
    if (Buffer.byteLength(socketPath) > 100) throw failure('UNSAFE_SOCKET');
    try { fs.lstatSync(socketPath); throw failure('UNSAFE_SOCKET'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  } catch (error) { closeAdmission(); throw error; }
  const sockets = new Set();
  const server = net.createServer(socket => {
    if (sockets.size >= 4) { socket.destroy(); return; }
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(2000, () => socket.destroy());
    socket.on('error', () => {});
    let data = Buffer.alloc(0); let used = false;
    socket.on('data', chunk => {
      if (used) { socket.destroy(); return; }
      data = Buffer.concat([data, chunk]);
      if (data.length > 1024) { socket.destroy(); return; }
      const newline = data.indexOf(10);
      if (newline < 0) return;
      used = true;
      void (async () => {
        try {
          const request = JSON.parse(data.toString('utf8'));
          if (!request || Array.isArray(request) || Object.keys(request).some(k => !['command', 'kind'].includes(k))
            || !['status', 'drain', 'confirm', 'reopen', 'recover', 'diagnostic'].includes(request.command)
            || (request.command !== 'diagnostic' && 'kind' in request)) throw failure('INVALID_COMMAND');
          if (await authorize(request.command) !== true) throw failure('UNAUTHORIZED');
          let result;
          if (request.command === 'diagnostic') {
            if (!['admin-health', 'admin-reviewer', 'admin-summary', 'admin-workspace'].includes(request.kind)
              || !Object.hasOwn(diagnostics, request.kind) || typeof diagnostics[request.kind] !== 'function') throw failure('DIAGNOSTIC_UNAVAILABLE');
            result = await barrier.runAdministrative(request.kind, diagnostics[request.kind]);
          } else result = await barrier[request.command]();
          socket.end(JSON.stringify({ ok: true, status: result }) + '\n');
        } catch (error) {
          const allowed = ['UNAUTHORIZED', 'INVALID_COMMAND', 'ADMISSION_CLOSED', 'NOT_DRAINED',
            'BAD_STATE', 'RECOVERY_REQUIRED', 'DIAGNOSTIC_UNAVAILABLE', 'DIAGNOSTIC_FAILED', 'PERSISTENCE_FAILED'];
          socket.end(JSON.stringify({ ok: false, code: allowed.includes(error.code) ? error.code : 'CONTROL_FAILED' }) + '\n');
        }
      })();
    });
  });
  // Private 0700 directory already restricts access during the bind/chmod interval.
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(socketPath, resolve);
    });
    fs.chmodSync(socketPath, 0o600);
  } catch (error) {
    closeAdmission();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    throw error;
  }
  const identity = fs.lstatSync(socketPath);
  server.on('error', () => { try { barrier.drain(); } catch { /* Already fail-closed. */ } });
  server.once('close', () => { try { barrier.drain(); } catch { /* Already fail-closed. */ } });
  return Object.freeze({ socketPath, async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    // Node may remove its own socket on close. Never delete a substituted resource.
    try {
      const current = fs.lstatSync(socketPath);
      if (current.ino === identity.ino && current.dev === identity.dev && current.isSocket()) fs.unlinkSync(socketPath);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  } });
}

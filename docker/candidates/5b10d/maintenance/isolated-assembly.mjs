// Test-only VM assembly of reviewed index source. Never imports production index.
// No real child processes or upstream network transports are exposed to the VM.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createBarrier } from './barrier.mjs';
import { openPrivateStore } from './private-store.mjs';
import { openLocalControl } from './local-control.mjs';
import { createBackendHooks } from './backend-hooks.mjs';
import { transform } from './stage-backend.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(here, '../../../../proyectos/lab-ia-web/server');
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw Error('ASSEMBLY_SOURCE_CHANGED');
  return text.replace(before, after);
}
export async function assembleIsolated(t, { normal = true, blockSummary = null,
  clientCloses = true, remoteProof = true } = {}) {
  if (typeof vm.SourceTextModule !== 'function') throw Error('EXPERIMENTAL_VM_MODULES_REQUIRED');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labia-5b10o-')); fs.chmodSync(root, 0o700);
  const serverDir = path.join(root, 'repo/proyectos/lab-ia-web/server');
  const runtime = path.join(root, 'runtime'); const workspace = path.join(root, 'workspace');
  const agents = path.join(root, 'repo/agentes/agents'); const controlDir = path.join(root, 'control');
  for (const directory of [serverDir, runtime, workspace, agents, controlDir]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(workspace, 'README.md'), 'Proyecto sintético\n', { mode: 0o600 });
  fs.writeFileSync(path.join(workspace, 'notas.txt'), 'Sintético\n', { mode: 0o600 });
  fs.writeFileSync(path.join(agents, 'reviewer.md'), 'Instrucciones ficticias', { mode: 0o600 });
  fs.writeFileSync(path.join(runtime, 'recent-workspaces'), workspace + '\n', { mode: 0o600 });
  const databasePath = path.join(runtime, 'lab-ia.db');
  const initial = new DatabaseSync(databasePath); initial.exec('CREATE TABLE fixture_seed (id INTEGER)'); initial.close();
  const timers = new Set(); const pendingClients = new Set(); const databases = [];
  const counts = { mockDocker: 0, mockLabOpen: 0, mockFetch: 0, denied: 0, logs: 0 };
  let server; let control; let namespace; let closed = false;
  const barrier = createBarrier({ store: openPrivateStore(controlDir), verifyRecovery: async () => pendingClients.size === 0 });
  if (normal) { await barrier.recover(); barrier.confirm(); barrier.reopen(); }
  const hooks = createBackendHooks(barrier, (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); });
  const shutdown = async () => {
    if (closed) return; closed = true;
    blockSummary?.release?.();
    for (const client of [...pendingClients]) client.complete();
    await new Promise(resolve => setImmediate(resolve));
    if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (control) await control.close();
    for (const timer of timers) { clearTimeout(timer); clearInterval(timer); clearImmediate(timer); }
    barrier.close(); for (const database of databases) database.close();
    fs.rmSync(root, { recursive: true, force: true });
  };
  t.after(shutdown);
  function denied() { counts.denied++; throw Error('ASSEMBLY_EFFECT_DENIED'); }
  function allowed(p) {
    const resolved = path.resolve(p); if (resolved !== root && !resolved.startsWith(root + path.sep)) denied();
    return resolved;
  }
  async function resolvedAllowed(p, directoryAncestor = false) {
    const real = await fsp.realpath(p);
    if (directoryAncestor && (workspace === real || workspace.startsWith(real.endsWith('/') ? real : real + '/'))) return real;
    return allowed(real);
  }
  const safeFS = {
    realpath: async p => resolvedAllowed(p),
    stat: async p => { allowed(p); await resolvedAllowed(p); return fsp.stat(p); },
    lstat: async p => { allowed(p); return fsp.lstat(p); },
    mkdtemp: async prefix => { allowed(prefix); return fsp.mkdtemp(prefix); },
    writeFile: async (p, ...args) => { allowed(p); await resolvedAllowed(path.dirname(p)); if (fs.existsSync(p)) await resolvedAllowed(p); return fsp.writeFile(p, ...args); },
    rm: async (p, ...args) => { allowed(p); if (fs.existsSync(p)) await resolvedAllowed(p); return fsp.rm(p, ...args); },
    readFile: async (p, ...args) => { await resolvedAllowed(p); return fsp.readFile(p, ...args); },
    readdir: async (p, ...args) => { await resolvedAllowed(p); return fsp.readdir(p, ...args); },
    opendir: async (...args) => { await resolvedAllowed(args[0]); return fsp.opendir(...args); },
    open: async (p, flags, ...args) => {
      // Snapshot traversal may open ancestors only as read-only directories.
      if ((flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) !== 0) allowed(p);
      else await resolvedAllowed(p, Boolean(flags & fs.constants.O_DIRECTORY));
      return fsp.open(p, flags, ...args);
    },
  };
  let listeningResolve; let listeningReject;
  const listening = new Promise((resolve, reject) => { listeningResolve = resolve; listeningReject = reject; });
  function createServer(listener) {
    if (server) return denied();
    server = http.createServer(listener); const listen = server.listen.bind(server);
    server.listen = (port, host, callback) => {
      if (port !== 3001 || host !== '127.0.0.1') return denied();
      return listen(0, host, () => {
        try {
          if ([3001, 11434].includes(server.address().port)) throw Error('PRODUCTION_PORT_REJECTED');
          callback(); listeningResolve();
        } catch (error) { listeningReject(error); }
      });
    };
    return server;
  }
  const fakeProcess = Object.freeze({ env: Object.freeze({ HOME: root, LAB_RUNTIME_DIR: runtime, LC_ALL: 'C' }),
    stdin: { isTTY: false }, stdout: { isTTY: false }, exit: () => denied() });
  const reviewer = { name: 'reviewer', mode: 'primary', tools: { edit: false, write: false, bash: false, task: false }, permission: [{ permission: '*', pattern: '*', action: 'deny' }] };
  const summary = { tipo: 'Sintético', elementos: ['README.md', 'notas.txt'], proposito: 'Mock', limitaciones: 'Sin inferencia' };
  function client(callback, output, waitForInput = false, summaryClient = false) {
    const child = new EventEmitter(); child.pid = null;
    let ended = false;
    child.complete = () => {
      if (ended) return; ended = true;
      callback?.(null, output, ''); child.emit('exit', 0, null);
      if (clientCloses || !summaryClient) { child.emit('close', 0, null); pendingClients.delete(child); }
    };
    child.closeClient = () => { child.emit('close', 0, null); pendingClients.delete(child); };
    child.kill = () => true; // No completion is fabricated by signal delivery.
    child.stdin = new Writable({ write(_chunk, _encoding, done) { done(); }, final(done) {
      done(); void (async () => { if (summaryClient && blockSummary) await blockSummary.promise; child.complete(); })();
    } });
    pendingClients.add(child);
    if (!waitForInput) queueMicrotask(child.complete);
    return child;
  }
  function execFile(file, args, options, callback) {
    if (file === 'realpath') {
      const target = args.at(-1); allowed(target); return client(callback, target + '\n');
    }
    if (file !== 'docker') return denied();
    counts.mockDocker++;
    const isExec = args[0] === 'exec'; const isSummary = isExec && args.includes('run');
    let output;
    if (args[0] === 'inspect' && args.includes('--format')) output = 'true\n' + JSON.stringify([{ Destination: '/workspace', Source: workspace, RW: false }]);
    else if (args[0] === 'inspect') output = JSON.stringify([{ State: { Running: true }, Mounts: [{ Destination: '/workspace', Source: workspace, RW: false }] }]);
    else if (isExec && args.includes('--version')) output = '1.17.18';
    else if (isExec && args.includes('debug')) output = JSON.stringify(reviewer);
    else if (isSummary) output = JSON.stringify({ type: 'text', part: { type: 'text', messageID: 'synthetic-message', id: 'synthetic-part', text: JSON.stringify(summary) } });
    else return denied();
    if (isExec) return hooks.child(() => client(callback, output, isSummary, isSummary), { remote: true, verifyRemote: async () => remoteProof }).process;
    return client(callback, output);
  }
  execFile[promisify.custom] = (file, args, options) => new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
  });
  function spawn(file, args) {
    if (file !== path.join(root, 'repo/scripts/lab-open') || args.length !== 1 || args[0] !== workspace) return denied();
    counts.mockLabOpen++;
    return hooks.child(() => client(null, '', false, true), { remote: true, verifyRemote: async () => remoteProof }).process;
  }
  const fakeFetch = hooks.trackedFetch(async (url, options) => {
    if (url !== 'http://127.0.0.1:11434/api/chat' || options.method !== 'POST') return denied();
    counts.mockFetch++;
    return new Response(JSON.stringify({ model: 'qwen3:8b', done: true, message: { role: 'assistant', content: 'Respuesta sintética' } }), { headers: { 'content-type': 'application/json' } });
  });
  const context = vm.createContext({ Buffer, URL, TextDecoder, AbortController, structuredClone,
    console: { log() { counts.logs++; }, error() { counts.logs++; } }, fetch: fakeFetch,
    setTimeout: (...args) => { const h = setTimeout(...args); timers.add(h); return h; }, clearTimeout,
    setInterval: (...args) => { const h = setInterval(...args); timers.add(h); return h; }, clearInterval,
    setImmediate: (...args) => { const h = setImmediate(...args); timers.add(h); return h; }, clearImmediate,
    process: fakeProcess, __maintenance: hooks, __barrier: barrier });
  const inventory = JSON.parse(fs.readFileSync(path.join(here, 'ASSEMBLY_SOURCES.json'), 'utf8'));
  const modules = new Map(); const builtins = new Map();
  const builtinAllowlist = new Set(['node:buffer', 'node:crypto', 'node:path', 'node:perf_hooks', 'node:readline', 'node:timers', 'node:url', 'node:util']);
  async function builtin(name) {
    if (builtins.has(name)) return builtins.get(name);
    let exports;
    if (name === 'node:fs/promises') exports = safeFS;
    else if (name === 'node:fs') exports = { constants: fs.constants };
    else if (name === 'node:process') exports = { default: fakeProcess };
    else if (name === 'node:http') exports = { createServer };
    else if (name === 'node:child_process') exports = { execFile, spawn };
    else if (name === 'node:sqlite') exports = { DatabaseSync: function(file) {
      if (file !== databasePath) return denied(); const db = new DatabaseSync(file); databases.push(db); return db;
    } };
    else if (builtinAllowlist.has(name)) exports = await import(name);
    else return denied();
    const module = new vm.SyntheticModule(Object.keys(exports), function() { for (const key of Object.keys(exports)) this.setExport(key, exports[key]); }, { context });
    builtins.set(name, module); return module;
  }
  function code(name) {
    if (modules.has(name)) return modules.get(name);
    if (!Object.hasOwn(inventory, name)) return denied();
    let text = fs.readFileSync(path.join(sourceRoot, name), 'utf8');
    if (createHash('sha256').update(text).digest('hex') !== inventory[name]) throw Error('ASSEMBLY_HASH_CHANGED');
    fs.writeFileSync(path.join(serverDir, name), text, { mode: 0o600 });
    if (name === 'index.js') {
      text = replaceOnce(text, 'const ollamaWarmup =', 'const maintenance = __maintenance;\nconst ollamaWarmup =');
      for (const factory of ['createOllamaWarmup', 'createChatReadContinuation', 'createActionHandlers', 'createPrivateProposalHandlers', 'createPrivateChatRoutes', 'createPrivateWorkspaceRoutes']) {
        text = replaceOnce(text, factory + '({', factory + '({ maintenance,');
      }
      text = replaceOnce(text, 'void ollamaWarmup.start();', "if (__barrier.status().state === 'NORMAL' && !__barrier.status().recoveryRequired) void ollamaWarmup.start();");
      text += '\nexport { server, securityStore, database, ollamaWarmup };\n';
    } else text = transform(name, text);
    const module = new vm.SourceTextModule(text, { context, identifier: pathToFileURL(path.join(serverDir, name)).href,
      initializeImportMeta(meta, module) { meta.url = module.identifier; },
      importModuleDynamically: async spec => { const m = await builtin(spec); if (m.status === 'unlinked') await m.link(() => denied()); if (m.status === 'linked') await m.evaluate(); return m; } });
    modules.set(name, module); return module;
  }
  const entry = code('index.js');
  await entry.link(async spec => spec.startsWith('./') ? code(spec.slice(2)) : builtin(spec));
  await entry.evaluate(); await listening; namespace = entry.namespace;
  const session = namespace.securityStore.pair(namespace.securityStore.createPairing());
  const headers = { host: 'localhost:5173', origin: 'http://localhost:5173', cookie: `lab_session=${session.sessionId}`, 'x-lab-csrf': namespace.securityStore.getSession(session.sessionId).csrfToken, 'x-lab-request': '1', 'content-type': 'application/json' };
  control = await openLocalControl({ directory: controlDir, barrier, authorize: command => ['status', 'drain', 'confirm', 'recover', 'reopen'].includes(command) });
  return { barrier, counts, namespace, workspace, control, pendingClients, shutdown,
    loadedModules: [...modules.keys()], request(url, { method = 'GET', body, authenticated = true } = {}) {
      return new Promise((resolve, reject) => {
        const q = http.request({ hostname: '127.0.0.1', port: server.address().port, path: url, method,
          headers: authenticated ? headers : { ...headers, cookie: '' } }, r => {
          let data = ''; r.on('data', part => { data += part; }); r.once('end', () => resolve({ status: r.statusCode, body: JSON.parse(data) }));
        });
        q.setTimeout(3000, () => q.destroy(Error('ASSEMBLY_TEST_TIMEOUT'))); q.once('error', reject); q.end(body === undefined ? undefined : JSON.stringify(body));
      });
    } };
}

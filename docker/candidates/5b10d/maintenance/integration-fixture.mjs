// Test-only assembly. Deliberately does not import or execute production index.js.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createBarrier } from './barrier.mjs';
import { openPrivateStore } from './private-store.mjs';
import { openLocalControl } from './local-control.mjs';
import { createBackendHooks } from './backend-hooks.mjs';
import { stageBackend } from './stage-backend.mjs';

export const summary = Object.freeze({ tipo: 'Sintético', elementos: ['README.md', 'notas.txt'], proposito: 'Mock', limitaciones: 'Sin inferencia' });
export const reviewer = { name: 'reviewer', mode: 'primary', tools: { edit: false, write: false, task: false, bash: false }, permission: [{ permission: '*', pattern: '*', action: 'deny' }] };
export function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
export function memoryStore() { let value = null; return { load: () => structuredClone(value), save: x => { value = structuredClone(x); } }; }
export async function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'labia-5b10n-')); fs.chmodSync(directory, 0o700);
  let database; let barrier; let control; let server; const releases = []; const processes = [];
  let closed = false;
  async function shutdown() {
    if (closed) return; closed = true;
    for (const release of releases) release();
    for (const child of processes) { if (child.exitCode === null) child.kill('SIGTERM'); }
    for (const child of processes) if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('close', resolve));
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (control) await control.close();
    barrier?.close(); database?.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
  t.after(shutdown);
  const staged = stageBackend(directory);
  const load = name => import(pathToFileURL(path.join(staged.directory, name)).href);
  const modules = {};
  for (const name of ['workspace-routes', 'chat-routes', 'chat', 'conversation-messages', 'actions', 'proposal-security', 'chat-read-continuation', 'ollama-warmup', 'security-store', 'proposal-store', 'turn-store']) modules[name] = await load(name + '.js');
  const stateDirectory = path.join(directory, 'state'); fs.mkdirSync(stateDirectory, { mode: 0o700 });
  const workspace = path.join(directory, 'workspace'); fs.mkdirSync(workspace, { mode: 0o700 });
  fs.writeFileSync(path.join(workspace, 'README.md'), 'Proyecto sintético\n'); fs.writeFileSync(path.join(workspace, 'notas.txt'), 'Mock\n');
  barrier = createBarrier({ store: options.store ?? openPrivateStore(stateDirectory), verifyRecovery: options.verifyRecovery ?? (async () => true), verifyUncertain: options.verifyUncertain });
  if (options.normal !== false) { await barrier.recover(); barrier.confirm(); barrier.reopen(); }
  function json(response, status, body) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); }
  const hooks = createBackendHooks(barrier, json);
  const security = modules['security-store'].createSecurityStore(); const session = security.pair(security.createPairing());
  const headers = { host: 'localhost:5173', origin: 'http://localhost:5173', cookie: `lab_session=${session.sessionId}`, 'x-lab-csrf': security.getSession(session.sessionId).csrfToken, 'x-lab-request': '1', 'content-type': 'application/json' };
  const counts = { summary: 0, activation: 0, probe: 0, inspect: 0, chat: 0, warmup: 0 };
  const locks = modules['proposal-store'].createWorkspaceLocks();
  const workspaceConfig = { securityStore: security, json, maintenance: hooks,
    readRecentWorkspaces: async () => workspace + '\n', stat: async target => ({ isDirectory: () => target === workspace }),
    inspectOpenCode: async () => { counts.inspect++; return { active: true, running: true, workspace }; },
    getOpenCodeStatus: async ({ checkCLI = true } = {}) => { if (checkCLI) counts.probe++; return { available: true, running: true, cliAvailable: checkCLI, version: checkCLI ? '1.17.18' : null, workspace }; },
    queryOpenCode: async () => JSON.stringify(reviewer), workspaceSummaryConfig: 'OPENCODE_CONFIG_CONTENT={}',
    inspectWorkspaceSnapshot: async () => ({ entries: ['README.md', 'notas.txt'], files: [], entriesTruncated: false }),
    runWorkspaceSummary: async () => { counts.summary++; return summary; },
    runLabOpen: async () => { counts.activation++; }, acquireActivationLock: () => locks.acquireExclusive(),
    ...options.workspace,
  };
  const workspaces = modules['workspace-routes'].createPrivateWorkspaceRoutes(workspaceConfig);
  database = new DatabaseSync(path.join(directory, 'fixture.db'));
  database.exec('CREATE TABLE conversaciones (id INTEGER PRIMARY KEY,titulo TEXT,agente_id TEXT,modelo TEXT,workspace TEXT,creada_en TEXT,actualizada_en TEXT); CREATE TABLE mensajes (id INTEGER PRIMARY KEY,conversacion_id INTEGER,rol TEXT,contenido TEXT,creado_en TEXT);');
  database.prepare('INSERT INTO conversaciones VALUES (1,?,?,?,?,?,?)').run('Ficticio', 'reviewer', 'qwen3:8b', workspace, 'T', 'T');
  database.exec("INSERT INTO mensajes VALUES (1,1,'user','Sintético','T');");
  const turns = modules['turn-store'].createTurnStore();
  const chat = modules.chat.createChatHandler({ database, json, turns, loadAgent: async () => 'Instrucción sintética', generate: async (...args) => { counts.chat++; return options.generate ? options.generate(...args) : 'Respuesta sintética'; } });
  const messages = modules['conversation-messages'].createPublicMessageHandler({ database, chat, json });
  const chatRoutes = modules['chat-routes'].createPrivateChatRoutes({ store: security, database, chat, addUserMessage: messages, json, maintenance: hooks, checkAgents: async () => {}, listAgents: async () => [], loadAgent: async () => 'Sintético' });
  const actions = modules.actions.createActionHandlers({ store: options.actions ?? { listActions: () => ({ actions: [] }), decide: async () => ({ status: 200, body: { state: 'denied' } }) }, securityStore: security, json, maintenance: hooks, onDecision: options.onDecision });
  // Real proposal boundary + real handlers, stopped safely at unavailable workspace/store.
  const proposalModule = await load('change-proposal.js'); const applyModule = await load('apply-change-proposal.js');
  const proposals = modules['proposal-security'].createPrivateProposalHandlers({ securityStore: security, json, maintenance: hooks,
    changeProposal: proposalModule.createChangeProposalHandler({ getWorkspaceStatus: async () => ({ available: false }), json, waitForWarmup: async () => {} }),
    applyChangeProposal: applyModule.createApplyChangeProposalHandler({ getWorkspaceStatus: async () => ({ available: false }), json, locks, store: { get: () => null } }) });
  const warmup = modules['ollama-warmup'].createOllamaWarmup({ maintenance: hooks,
    fetchImpl: hooks.trackedFetch(async () => { counts.warmup++; return new Response(JSON.stringify({ model: 'qwen3:8b', done: true }), { headers: { 'Content-Type': 'application/json' } }); }) });
  async function handler(request, response) {
    if (await workspaces(request, response)) return;
    if (await chatRoutes(request, response)) return;
    const route = request.url?.split('?')[0];
    if (route === '/api/actions') return actions.list(request, response);
    if (route === '/api/actions/decision') return actions.decision(request, response);
    if (route === '/api/opencode/change-proposal') return proposals.changeProposal(request, response);
    if (route === '/api/opencode/apply-change-proposal') return proposals.applyChangeProposal(request, response);
    json(response, 404, { error: 'Endpoint no encontrado.' });
  }
  function responseMock() {
    const response = new EventEmitter(); Object.assign(response, { headers: {}, headersSent: false, destroyed: false,
      setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
      writeHead(status, extra) { this.status = status; this.headersSent = true; for (const [k, v] of Object.entries(extra)) this.setHeader(k, v); },
      end(blob) { this.body = JSON.parse(blob); this.emit('finish'); } }); return response;
  }
  async function invoke(url, { method = url.includes('summary') || url.endsWith('/activate') ? 'POST' : 'GET', body = {}, extraHeaders = {}, chunks } = {}) {
    const request = Readable.from(chunks ?? [Buffer.from(JSON.stringify(body))]);
    Object.assign(request, { url, method, headers: { ...headers, ...extraHeaders } }); const response = responseMock();
    await handler(request, response); return response;
  }
  async function listen() {
    server = http.createServer((req, res) => { void handler(req, res).catch(() => { if (!res.destroyed && !res.headersSent) json(res, 500, { error: 'Fallo sintético' }); }); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port; if (port === 3001 || port === 11434) throw Error('PRODUCTION_PORT_REJECTED');
    return Object.freeze({ port, request(url, { method = 'POST', body = {} } = {}) {
      return new Promise((resolve, reject) => {
        const q = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, r => { let bytes = ''; r.on('data', part => { bytes += part; }); r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(bytes) })); });
        q.setTimeout(3000, () => q.destroy(Error('TEST_TIMEOUT'))); q.once('error', reject); q.end(JSON.stringify(body));
      });
    } });
  }
  return { directory, workspace, stateDirectory, load, modules, barrier, hooks, counts, workspaceConfig,
    json, headers, security, database, turns, handler, invoke, responseMock, warmup, releases, processes,
    listen, shutdown, async openControl(authorize = () => false, diagnostics = {}) { control = await openLocalControl({ directory: stateDirectory, barrier, authorize, diagnostics }); return control; } };
}

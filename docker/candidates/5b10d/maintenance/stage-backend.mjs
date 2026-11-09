// Copies reviewed CODE only into an explicitly named temporary directory.
// Never imports index.js, creates runtime databases or starts a service.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../../../proyectos/lab-ia-web/server');
function once(text, before, after) {
  if (text.split(before).length !== 2) throw Error('SOURCE_ANCHOR_CHANGED');
  return text.replace(before, after);
}
export function transform(name, input) {
  let text = input;
  if (name === 'workspace-routes.js') {
    text = once(text, 'runWorkspaceSummary, runLabOpen, acquireActivationLock })', 'runWorkspaceSummary, runLabOpen, acquireActivationLock, maintenance })');
    text = once(text, 'await route.handle(request, response, body);', "if (route.method === 'POST') await maintenance.dispatch(path.endsWith('/activate') ? 'activation' : 'summary', request, response, () => route.handle(request, response, body));\n      else await route.handle(request, response, body);");
    text = once(text, 'json(response, 200, await getOpenCodeStatus());', 'json(response, 200, await maintenance.statusProbe(() => getOpenCodeStatus(), () => getOpenCodeStatus({ checkCLI: false })));');
  }
  if (name === 'chat-routes.js') {
    text = once(text, 'checkAgents, listAgents, loadAgent })', 'checkAgents, listAgents, loadAgent, maintenance })');
    const block = "if (turn) chat.getTurn(request, response, turn[1], turn[2]);\n      else if (respond) await chat.respond(request, response, respond[1], body);\n      else if (path.startsWith('/api/agents')) await agents(request, response, path);\n      else await conversations(request, response, path, body);";
    text = once(text, block, "const handle = async () => {\n      " + block + "\n      };\n      const protectedPost = request.method === 'POST' && (path === '/api/conversations' || /^\\/api\\/conversations\\/[^/]+\\/messages$/.test(path) || respond);\n      if (protectedPost) await maintenance.dispatch(respond ? 'chat' : 'write', request, response, handle);\n      else await handle();");
  }
  if (name === 'actions.js') {
    text = once(text, 'onDecision = () => {} })', 'onDecision = () => {}, maintenance })');
    const start = 'const result = await store.decide(body);';
    text = once(text, start, "await maintenance.dispatch('action', request, response, async () => {\n      " + start);
    text = once(text, 'return json(response, result.status, result.body);', 'return json(response, result.status, result.body);\n      });');
  }
  if (name === 'proposal-security.js') {
    text = once(text, 'changeProposal, applyChangeProposal })', 'changeProposal, applyChangeProposal, maintenance })');
    text = once(text, 'function protect(handle, maxBytes, validate)', 'function protect(handle, maxBytes, validate, kind)');
    text = once(text, 'await handle(request, response, body);', 'await maintenance.dispatch(kind, request, response, () => handle(request, response, body));');
    text = once(text, 'proposalBodyLimits.change, validateChangeRequest)', "proposalBodyLimits.change, validateChangeRequest, 'proposal')");
    text = once(text, 'proposalBodyLimits.apply, validateApplyRequest)', "proposalBodyLimits.apply, validateApplyRequest, 'apply')");
  }
  if (name === 'chat-read-continuation.js') {
    text = once(text, 'schedule = setImmediate })', 'schedule = setImmediate, maintenance })');
    text = once(text, 'schedule(() => { void continueTurn(turn, action, work); });', 'maintenance.defer(() => continueTurn(turn, action, work), schedule);');
  }
  if (name === 'ollama-warmup.js') {
    text = once(text, 'now = Date.now } = {})', 'now = Date.now, maintenance } = {})');
    text = once(text, "transition('loading');", "const lease = maintenance.admitWarmup();\n    transition('loading');");
    text = once(text, 'pending = Promise.resolve().then(async () => {', 'pending = lease.run(async () => {');
    text = once(text, 'if (!started) { started = true; return ensureReady(); }', 'if (!started) { const operation = ensureReady(); started = true; return operation; }');
  }
  return text;
}
export function stageBackend(directory) {
  if (!path.isAbsolute(directory) || fs.realpathSync(directory) !== directory
    || !directory.startsWith(path.join(os.tmpdir(), 'labia-5b10n-'))
    || fs.readdirSync(directory).length) throw Error('TEMPORARY_EMPTY_DIRECTORY_REQUIRED');
  const inventory = JSON.parse(fs.readFileSync(path.join(here, 'INTEGRATION_SOURCES.json'), 'utf8'));
  const copied = [];
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}\n', { mode: 0o600 });
  const destination = path.join(directory, 'server'); fs.mkdirSync(destination, { mode: 0o700 });
  for (const [name, hash] of Object.entries(inventory)) {
    if (!/^[a-z0-9-]+\.js$/.test(name) || name === 'index.js') throw Error('SOURCE_REJECTED');
    const original = fs.readFileSync(path.join(source, name), 'utf8');
    if (createHash('sha256').update(original).digest('hex') !== hash) throw Error('SOURCE_HASH_CHANGED');
    fs.writeFileSync(path.join(destination, name), transform(name, original), { mode: 0o600 }); copied.push(name);
  }
  return { directory: destination, copied };
}

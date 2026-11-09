// Candidate artifact builder: reads HEAD, writes only new artifacts beside itself.
// Never applies the patch or executes backend/admin procedures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { transform } from './stage-backend.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const base = '04e50657a20481440a32a5ea2e6490c80c6b1a84';
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== base) throw Error('HEAD_CHANGED');
const prefix = 'proyectos/lab-ia-web/server/';
function once(s, a, b) { if (s.split(a).length !== 2) throw Error('ANCHOR_CHANGED'); return s.replace(a, b); }
const changed = new Map();
for (const name of ['workspace-routes.js', 'chat-routes.js', 'actions.js', 'proposal-security.js', 'chat-read-continuation.js', 'ollama-warmup.js', 'index.js']) {
  const old = execFileSync('git', ['show', base + ':' + prefix + name], { cwd: root, encoding: 'utf8' });
  let text = name === 'index.js' ? old : transform(name, old);
  if (name === 'index.js') {
    text = "import { openAdmissionRuntime } from './maintenance/runtime.mjs';\nimport { generateChatReply } from './chat-ollama.js';\n" + text;
    const warmup = "const ollamaWarmup = createOllamaWarmup({\n  onState: (state) => console.log(`LAB-IA: Ollama warmup ${state}`),\n});\n\n";
    text = once(text, warmup, '');
    text = once(text, 'const recentWorkspacesFile =', `const maintenanceRuntime = await openAdmissionRuntime({
  directory: resolve(runtimePaths.runtimeDir, 'maintenance-control'), json,
  operatorEnabled: process.env.LAB_MAINTENANCE_OPERATOR === '1',
});
const maintenance = maintenanceRuntime.hooks;
${warmup.replace('createOllamaWarmup({', 'createOllamaWarmup({ maintenance, fetchImpl: maintenance.trackedFetch(globalThis.fetch),')}
const generateChat = args => generateChatReply(args, { fetchImpl: maintenance.trackedFetch(globalThis.fetch) });
const recentWorkspacesFile =`);
    for (const factory of ['createChatReadContinuation', 'createActionHandlers', 'createPrivateProposalHandlers', 'createPrivateChatRoutes', 'createPrivateWorkspaceRoutes']) {
      text = once(text, factory + '({', factory + '({ maintenance,');
    }
    text = once(text, '...createChatPersistence(database), loadAgent:', '...createChatPersistence(database), generate: generateChat, loadAgent:');
    text = once(text, 'const chat = createChatHandler({', 'const chat = createChatHandler({ generate: generateChat,');
    // Query inspect stays available without starting a protected CLI execution.
    text = once(text, "execFile('docker', args, {", "const start = () => execFile('docker', args, {");
    text = once(text, 'else resolveResult(stdout.trim());\n    });', "else resolveResult(stdout.trim());\n    });\n    if (args[0] === 'exec') maintenance.child(start, { remote: true });\n    else start();");
    text = once(text, "const child = execFile('docker', ['exec'", "const child = maintenance.child(() => execFile('docker', ['exec'");
    text = once(text, "invalidSummary: true })); }\n    });", "invalidSummary: true })); }\n    }), { remote: true }).process;");
    text = once(text, 'const child = spawn(labOpenPath, [workspacePath], {', 'const child = maintenance.child(() => spawn(labOpenPath, [workspacePath], {');
    text = once(text, "cwd: labRoot, shell: false, stdio: 'ignore',\n    });", "cwd: labRoot, shell: false, stdio: 'ignore',\n    }), { remote: true }).process;");
    text = once(text, "server.once('close', () => pairingTerminal?.close());", "server.once('close', () => {\n  pairingTerminal?.close();\n  void maintenanceRuntime.close().catch(() => console.error('LAB-IA: MAINTENANCE_CLOSE_FAILED'));\n});");
    text = once(text, 'void ollamaWarmup.start();', "if (maintenanceRuntime.status().state === 'NORMAL') void ollamaWarmup.start();");
  }
  changed.set(prefix + name, { old, text });
}
for (const name of ['admission-gate.mjs', 'backend-hooks.mjs', 'barrier.mjs', 'private-store.mjs', 'local-control.mjs']) {
  changed.set(prefix + 'maintenance/' + name, { old: null, text: fs.readFileSync(path.join(here, name), 'utf8') });
}
const runtime = `// Candidate bootstrap. Closed on every boot; no auto-recover/reopen.
import { createBarrier } from './barrier.mjs';
import { openPrivateStore } from './private-store.mjs';
import { createAdmissionGate } from './admission-gate.mjs';
export async function openAdmissionRuntime({ directory, json, operatorEnabled = false }) {
  let store; let barrier; let control; let closing;
  try {
    store = openPrivateStore(directory); // Must already exist privately; never create/overwrite.
    barrier = createBarrier({ store,
      verifyRecovery: async status => status.jobs.length === 0 });
    const gate = createAdmissionGate({ barrier, json });
    control = await gate.openControl({ directory,
      authorize: command => operatorEnabled === true && ['status', 'drain', 'confirm', 'recover', 'reopen'].includes(command) });
    return Object.freeze({ hooks: gate.hooks, status: gate.status, barrier, control,
      close() {
        return closing ??= (async () => {
          try { await control.close(); } finally { barrier.close(); }
        })();
      } });
  } catch {
    try { if (barrier) barrier.close(); else store?.close(); } catch { /* Preserve state/fault. */ }
    throw Object.assign(new Error('MAINTENANCE_STARTUP_FAILED'), { code: 'MAINTENANCE_STARTUP_FAILED' });
  }
}
`;
changed.set(prefix + 'maintenance/runtime.mjs', { old: null, text: runtime });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'labia-5b10t-build-'));
try {
  const pieces = [];
  for (const [name, { old, text }] of changed) {
    const before = path.join(temporary, 'before'), after = path.join(temporary, 'after');
    if (old !== null) fs.writeFileSync(before, old); fs.writeFileSync(after, text);
    const result = spawnSync('git', ['diff', '--no-index', '--', old === null ? '/dev/null' : before, after], { encoding: 'utf8' });
    if (result.status !== 1) throw Error('DIFF_FAILED');
    const lines = result.stdout.split('\n');
    lines[0] = 'diff --git a/' + name + ' b/' + name;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith('--- ')) lines[i] = old === null ? '--- /dev/null' : '--- a/' + name;
      if (lines[i].startsWith('+++ ')) lines[i] = '+++ b/' + name;
    }
    pieces.push(lines.join('\n')); if (old !== null) fs.unlinkSync(before);
  }
  const patch = pieces.join('');
  fs.writeFileSync(path.join(here, 'GATE_INTEGRATION.patch'), patch, { flag: 'wx' });
  const sources = Object.fromEntries([...changed].map(([name, value]) => [name, { oldSHA256: value.old === null ? null : createHash('sha256').update(value.old).digest('hex'), newSHA256: createHash('sha256').update(value.text).digest('hex') }]));
  fs.writeFileSync(path.join(here, 'GATE_PATCH_MANIFEST.json'), JSON.stringify({ base, patchSHA256: createHash('sha256').update(patch).digest('hex'), sources }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ files: changed.size, patchPrepared: true }));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }

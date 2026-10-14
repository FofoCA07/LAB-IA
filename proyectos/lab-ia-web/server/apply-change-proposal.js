import { execFile } from 'node:child_process';
import { mkdtemp, stat, writeFile, rm } from 'node:fs/promises';
import { runProposalGit, validProposalPath, validatePatchStructure } from './change-proposal.js';
import { validProposalId } from './proposal-store.js';
import { repositoryIdentity, indexSnapshot, trackedModes, validateApplyFileFingerprints, unchangedApplyPermissions,
  validateConfiguration, noUntracked, same } from './proposal-safety.js';

const capabilities = new WeakSet();
const usedCapabilities = new WeakSet();
const partialMessage = 'No se pudo confirmar la aplicación segura. Pueden existir cambios parciales; se requiere revisión manual.';
const ensure = (condition) => { if (!condition) throw new Error('Apply validation failed.'); };

// Only internally minted capabilities permit the one mutating Git invocation.
export function runApplyGit(workspace, args, options = {}) {
  const { temporaryIndex, input, deadline = Date.now() + 10_000 } = options;
  if (args[0] !== 'apply') {
    const command = args[0] === '-c' ? args[2] : args[0];
    if (!['rev-parse', 'ls-files', 'config', 'check-attr', 'status', 'diff'].includes(command)) {
      return Promise.reject(new Error('Unsafe Git invocation.'));
    }
    return runProposalGit(workspace, args, options);
  }
  const check = args.includes('--check');
  const expected = ['apply', ...(check ? ['--check'] : []), '--recount', '--index', '--whitespace=error', '-'];
  if (!same(args, expected) || (!check && !capabilities.has(temporaryIndex))
    || (temporaryIndex && (!capabilities.has(temporaryIndex) || temporaryIndex.workspace !== workspace
      || temporaryIndex.patch !== input || usedCapabilities.has(temporaryIndex)))) {
    return Promise.reject(new Error('Unsafe Git invocation.'));
  }
  if (!check) usedCapabilities.add(temporaryIndex);
  const timeout = Math.min(10_000, deadline - Date.now());
  if (timeout <= 0) return Promise.reject(new Error('Apply timeout.'));
  return new Promise((resolve, reject) => {
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
      GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C',
      ...(temporaryIndex ? { GIT_INDEX_FILE: temporaryIndex.path } : {}) };
    const child = execFile('git', ['--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args],
      { cwd: workspace, shell: false, env, timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin.on('error', () => {}); child.stdin.end(input ?? '');
  });
}

async function requestBody(request) {
  let timer;
  try {
    return await Promise.race([ (async () => {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length; ensure(size <= 1024); chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    })(), new Promise((_, reject) => {
      timer = setTimeout(() => { request.destroy(); reject(new Error('Body timeout.')); }, 5000);
    }) ]);
  } finally { clearTimeout(timer); }
}

export function createApplyChangeProposalHandler({ store, locks, getWorkspaceStatus, json, git = runApplyGit }) {
  return async function applyChangeProposal(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const reply = (status, code, error) => json(response, status, { applied: false, code, error });
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST'); reply(405, 'METHOD', 'Método no permitido.'); return;
    }
    if (request.url.includes('?')) { reply(400, 'INVALID_REQUEST', 'Solicitud no válida.'); return; }
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      reply(415, 'CONTENT_TYPE', 'Se requiere application/json.'); return;
    }
    if (request.headers.origin) {
      let origin;
      try { origin = new URL(request.headers.origin); } catch { /* Reject below. */ }
      if (!origin || !['http:', 'https:'].includes(origin.protocol) || origin.host !== request.headers.host) {
        reply(403, 'ORIGIN', 'Origen no permitido.'); return;
      }
    }
    let body;
    try {
      body = await requestBody(request);
      ensure(body && typeof body === 'object' && !Array.isArray(body)
        && Object.keys(body).length === 1 && Object.hasOwn(body, 'proposalId') && validProposalId(body.proposalId));
    } catch { reply(400, 'INVALID_REQUEST', 'Solicitud no válida.'); return; }
    const available = store.get(body.proposalId);
    if (!available || available.state !== 'ready') {
      reply(409, 'PROPOSAL_UNAVAILABLE', 'La propuesta no está disponible.'); return;
    }
    const release = locks.acquire(available.workspace);
    if (!release) { reply(409, 'BUSY', 'El workspace está ocupado.'); return; }
    const record = store.claim(body.proposalId);
    if (!record) { release(); reply(409, 'PROPOSAL_UNAVAILABLE', 'La propuesta no está disponible.'); return; }
    let directory; let temporaryIndex; let originalIndex; let identity;
    let honorFileMode;
    let succeeded = false; let auditPassed; let applyAttempted = false; let cleanupPassed = true;
    const deadline = Date.now() + 60_000;
    const run = (args, options = {}) => git(record.workspace, args, { deadline, ...options });
    async function workspaceUnchanged(auditDeadline = deadline) {
      let timer;
      const status = await Promise.race([getWorkspaceStatus(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Workspace timeout.')), 5000);
      })]).finally(() => clearTimeout(timer));
      ensure(status.available && status.running && status.workspace === record.workspace);
      const current = await repositoryIdentity(record.workspace, git, auditDeadline);
      ensure(same(current, record.repoIdentity) && current.repoRoot === record.repoRoot);
      ensure((await git(record.workspace, ['rev-parse', 'HEAD'], { deadline: auditDeadline })).trim() === record.baseHead);
      return current;
    }
    async function audit() {
      // Run every independent audit even when an earlier one fails.
      const auditDeadline = Date.now() + 30_000;
      const tasks = [
        () => workspaceUnchanged(auditDeadline),
        async () => ensure(originalIndex && (await indexSnapshot(record.repoIdentity)).equals(originalIndex)),
        async () => ensure(await git(record.workspace, ['diff', '--cached', '--no-ext-diff', '--no-textconv'], { deadline: auditDeadline }) === ''),
        () => noUntracked(record.workspace, git, auditDeadline),
        async () => {
          // Reject unsafe filters before any audit command inspects working-tree content.
          await validateConfiguration(record.workspace, record.paths, git, auditDeadline);
          const status = await git(record.workspace, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'], { deadline: auditDeadline });
          const entries = status.split('\0').filter(Boolean);
          ensure(status.endsWith('\0') && entries.length === record.paths.length);
          ensure(entries.every((entry) => entry.startsWith(' M ') && record.paths.includes(entry.slice(3))));
          ensure(new Set(entries.map((entry) => entry.slice(3))).size === record.paths.length);
        },
        async () => {
          const modes = await trackedModes(record.workspace, record.paths, git, auditDeadline);
          ensure(same(modes, record.modes));
          const current = await validateApplyFileFingerprints(record.workspace, record.paths, modes, git, auditDeadline);
          ensure(current.honorFileMode === honorFileMode);
          ensure(same(current.fingerprints, record.proposedFingerprints)
            && unchangedApplyPermissions(current, record.permissions, { afterApply: true }));
          if (record.proposedSizes) ensure(same(current.sizes, record.proposedSizes));
        },
      ];
      const results = await Promise.allSettled(tasks.map((task) => task()));
      return results.every((result) => result.status === 'fulfilled');
    }
    try {
      ensure(Array.isArray(record.paths) && record.paths.length > 0 && record.paths.length <= 20
        && new Set(record.paths).size === record.paths.length && record.paths.every(validProposalPath)
        && typeof record.patch === 'string' && Buffer.byteLength(record.patch) <= 512 * 1024);
      validatePatchStructure({ files: record.paths, patch: record.patch }, { recount: true });
      identity = await workspaceUnchanged();
      originalIndex = await indexSnapshot(identity);
      await validateConfiguration(record.workspace, record.paths, git, deadline);
      ensure(await run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']) === '');
      ensure(await run(['diff', '--cached', '--no-ext-diff', '--no-textconv']) === '');
      await noUntracked(record.workspace, git, deadline);
      const modes = await trackedModes(record.workspace, record.paths, git, deadline);
      ensure(same(modes, record.modes));
      const current = await validateApplyFileFingerprints(record.workspace, record.paths, modes, git, deadline);
      honorFileMode = current.honorFileMode;
      ensure(same(current.fingerprints, record.originalFingerprints) && unchangedApplyPermissions(current, record.permissions));
      if (record.sizes) ensure(same(current.sizes, record.sizes));
      const check = ['apply', '--check', '--recount', '--index', '--whitespace=error', '-'];
      await run(check, { input: record.patch });
      directory = await mkdtemp('/dev/shm/lab-proposal-');
      ensure(((await stat(directory)).mode & 0o7777) === 0o700);
      temporaryIndex = Object.freeze({ path: `${directory}/index`, workspace: record.workspace, patch: record.patch });
      await writeFile(temporaryIndex.path, originalIndex, { flag: 'wx', mode: 0o600 });
      capabilities.add(temporaryIndex);
      ensure((await indexSnapshot(identity)).equals(originalIndex));
      await run(check, { input: record.patch, temporaryIndex });
      await workspaceUnchanged();
      await validateConfiguration(record.workspace, record.paths, git, deadline);
      ensure((await indexSnapshot(identity)).equals(originalIndex));
      ensure(await run(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']) === '');
      applyAttempted = true;
      await run(['apply', '--recount', '--index', '--whitespace=error', '-'], { input: record.patch, temporaryIndex });
      succeeded = true;
    } catch { /* Only fixed public errors, including ambiguous process failures. */ }
    finally {
      try { auditPassed = await audit(); } catch { auditPassed = false; }
      if (temporaryIndex) capabilities.delete(temporaryIndex);
      if (directory) {
        try { await rm(directory, { recursive: true, force: true }); } catch { cleanupPassed = false; }
      }
      try { store.finish(record.proposalId, succeeded && auditPassed && cleanupPassed ? 'applied' : 'failed'); }
      finally { release(); }
    }
    if (succeeded && auditPassed && cleanupPassed) json(response, 200, { applied: true, files: record.paths });
    else reply(applyAttempted ? 500 : 409, 'APPLY_FAILED', partialMessage);
  };
}

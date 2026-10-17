import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { createProposalStore, createWorkspaceLocks } from './proposal-store.js';
import { repositoryIdentity, trackedModes, captureFileFingerprints, sha256, same } from './proposal-safety.js';
import { selectProposalFiles } from './file-selection.js';
import { generateDeterministicProposal } from './deterministic-proposal.js';
import { generateDeterministicDiff } from './deterministic-diff.js';
import { generateOllamaProposal } from './ollama-proposal.js';
import { readBoundedJson, AuthRequestError } from './security-http.js';

const patchLimit = 512 * 1024;
const forbiddenControls = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

const safeEndpointErrors = new WeakSet();
function failure(status, code, message) {
  const error = Object.assign(new Error(message), { status, publicCode: code });
  safeEndpointErrors.add(error);
  return error;
}

export function validateChangeRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'request')
    || typeof body.request !== 'string' || forbiddenControls.test(body.request)) {
    throw failure(400, 'INVALID_REQUEST', 'La solicitud debe contener únicamente una descripción válida.');
  }
  const request = body.request.trim();
  if (!request || request.length > 4000) {
    throw failure(400, 'INVALID_REQUEST', 'Describe el cambio usando entre 1 y 4000 caracteres.');
  }
  return request;
}

export function validProposalPath(path) {
  if (typeof path !== 'string' || !path || path.length > 1024 || path !== path.trim()
    || posix.isAbsolute(path) || /[\x00-\x1f\x7f-\x9f\\":]/.test(path)) return false;
  const parts = path.split('/');
  return parts.every((name) => name && name !== '.' && name !== '..'
    && !/^(?:\.git$|\.gitmodules$|\.env(?:\.|$)|id_rsa|id_ed25519|credentials|secrets|credenciales|secretos)/i.test(name)
    && !/\.(?:pem|key)$/i.test(name)
    && !(name.startsWith('.') && /(?:credential|secret|token|password|auth|ssh|aws|azure|gcloud|netrc|npmrc|pypirc)/i.test(name)));
}

const proposalErrors = {
  INVALID_PATCH_STRUCTURE: 'El diff generado no cumple la estructura segura requerida.',
  INVALID_TARGET_FILES: 'La propuesta intenta modificar archivos que no están permitidos.',
  PATCH_CHECK_FAILED: 'Git comprobó el diff, pero no puede aplicarse sobre el estado actual del proyecto.',
};

function proposalFailure(code) {
  return failure(502, code, proposalErrors[code]);
}

const patchStructureReasons = new Set([
  'missing_final_newline', 'unexpected_diff_header', 'duplicate_file', 'invalid_index_line',
  'invalid_file_headers', 'invalid_hunk_header', 'invalid_hunk_body', 'invalid_hunk_counts',
  'no_changes', 'declared_files_mismatch',
]);

function patchStructureFailure(reason) {
  return Object.assign(proposalFailure('INVALID_PATCH_STRUCTURE'), { patchStructureReason: reason });
}

// Accept only canonical text modifications, rather than trying to sanitize a
// broader Git patch grammar (renames, modes, binary data, quoted paths, etc.).
export function validatePatchStructure({ files, patch }, { recount = false } = {}) {
  const lines = patch.split('\n');
  if (lines.pop() !== '') throw patchStructureFailure('missing_final_newline');
  const seen = new Set();
  let i = 0;
  while (i < lines.length) {
    const path = files.find((path) => lines[i] === `diff --git a/${path} b/${path}`);
    if (!path) throw patchStructureFailure('unexpected_diff_header');
    if (seen.has(path)) throw patchStructureFailure('duplicate_file');
    seen.add(path);
    i++;
    if (lines[i]?.startsWith('index ')) {
      if (!/^index [a-f0-9]+\.\.[a-f0-9]+(?: 100(?:644|755))?$/.test(lines[i])) throw patchStructureFailure('invalid_index_line');
      i++;
    }
    if (lines[i++] !== `--- a/${path}` || lines[i++] !== `+++ b/${path}`) throw patchStructureFailure('invalid_file_headers');
    let hunks = 0;
    let changes = 0;
    while (i < lines.length && !lines[i].startsWith('diff --git ')) {
      const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(lines[i++]);
      if (!hunk) throw patchStructureFailure('invalid_hunk_header');
      const oldCount = Number(hunk[2] ?? 1);
      const newCount = Number(hunk[4] ?? 1);
      if (![oldCount, newCount].every(Number.isSafeInteger)) throw patchStructureFailure('invalid_hunk_counts');
      let oldLines = 0;
      let newLines = 0;
      let previousContent = false;
      while (i < lines.length && !lines[i].startsWith('@@ ') && !lines[i].startsWith('diff --git ')) {
        const line = lines[i++];
        if (line === '\\ No newline at end of file') {
          if (!previousContent) throw patchStructureFailure('invalid_hunk_body');
          previousContent = false;
          continue; // Metadata only: never contributes to old/new line counts.
        }
        if (![' ', '+', '-'].includes(line[0])) throw patchStructureFailure('invalid_hunk_body');
        if (line[0] !== '+') oldLines++;
        if (line[0] !== '-') newLines++;
        if (line[0] !== ' ') changes++;
        previousContent = true;
      }
      // Only Git --recount may tolerate declared/body count differences.
      if (!recount && (oldLines !== oldCount || newLines !== newCount)) throw patchStructureFailure('invalid_hunk_counts');
      hunks++;
    }
    if (!hunks || !changes) throw patchStructureFailure('no_changes');
  }
  if (seen.size !== files.length) throw patchStructureFailure('declared_files_mismatch');
}

const patchCheckReasons = new Set(['index_metadata_mismatch', 'content_or_context_mismatch', 'unknown']);

async function diagnosePatchCheck(workspace, patch, git, deadline, originalError) {
  // Exit 1 is a completed Git check rejection; timeout/spawn failures are ambiguous.
  if (originalError?.code !== 1 || originalError.killed || Date.now() >= deadline) return 'unknown';
  const lines = patch.split('\n');
  const diagnosticLines = lines.filter((line) => !/^index [a-f0-9]+\.\.[a-f0-9]+(?: 100(?:644|755))?$/.test(line));
  if (diagnosticLines.length === lines.length) return 'content_or_context_mismatch';
  try {
    await git(workspace, ['apply', '--check', '--recount', '--index', '--whitespace=error', '-'],
      { input: diagnosticLines.join('\n'), deadline });
    return 'index_metadata_mismatch';
  } catch (error) {
    return error?.code === 1 && !error.killed ? 'content_or_context_mismatch' : 'unknown';
  }
}

function gitEnvironment() {
  // Inherited GIT_DIR/GIT_WORK_TREE/pathspec/config variables must not redirect
  // validation. Optional locks are off so status never refreshes the index.
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
}

async function beforeDeadline(operation, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw Object.assign(failure(504, 'TIMEOUT', 'La propuesta excedió el tiempo máximo.'), { timeoutSource: 'endpoint' });
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(failure(504, 'TIMEOUT', 'La propuesta excedió el tiempo máximo.'), { timeoutSource: 'endpoint' })), remaining);
    })]);
  } finally { clearTimeout(timer); }
}

export function runProposalGit(workspace, args, { input, deadline = Date.now() + 10_000 } = {}) {
  if (args[0] === 'apply' && !args.includes('--check')) return Promise.reject(new Error('Read-only Git executor.'));
  return new Promise((resolveResult, reject) => {
    const timeout = Math.min(10_000, deadline - Date.now());
    if (timeout <= 0) { reject(Object.assign(failure(504, 'TIMEOUT', 'La propuesta excedió el tiempo máximo.'), { timeoutSource: 'endpoint' })); return; }
    const child = execFile('git', ['--literal-pathspecs', '-c', 'core.fsmonitor=false',
      '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd: workspace, shell: false, timeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
      encoding: 'utf8', env: gitEnvironment(),
    }, (error, stdout) => error ? reject(error) : resolveResult(stdout));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

const fileHelperMessages = Object.freeze({
  FILE_OPERATION_TIMEOUT: 'File operation timed out.',
  FILE_VALIDATION_FAILED: 'File validation failed.',
  AUTHORIZED_CATALOG_TOO_LARGE: 'Authorized catalog too large.',
  SELECTED_FILE_TOO_LARGE: 'Selected file too large.',
  SELECTED_CONTENT_TOO_LARGE: 'Selected content too large.',
});
const safeFileHelperErrors = new WeakSet();

function fileHelperError(code = 'FILE_VALIDATION_FAILED') {
  if (!Object.hasOwn(fileHelperMessages, code)) code = 'FILE_VALIDATION_FAILED';
  const error = Object.assign(new Error(fileHelperMessages[code]), { code });
  safeFileHelperErrors.add(error);
  return error;
}

function sanitizeFileHelperError(error) {
  // Only errors created here may retain a reason. Never trust external codes.
  return safeFileHelperErrors.has(error) ? error : fileHelperError();
}

function checkFileDeadline(deadline) {
  if (!Number.isFinite(deadline) || Date.now() >= deadline) {
    throw fileHelperError('FILE_OPERATION_TIMEOUT');
  }
}

// Caller supplies a stage-0 regular-file mode established from Git.
// Returned handle belongs to the caller and must always be closed.
export async function openTrackedRegularFile(workspace, path, mode, deadline) {
  let directory;
  let file;
  try {
    checkFileDeadline(deadline);
    if (!validProposalPath(path) || !['100644', '100755'].includes(mode)) throw fileHelperError();
    directory = await open(workspace, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const components = path.split('/');
    for (const name of components.slice(0, -1)) {
      checkFileDeadline(deadline);
      const next = await open(`/proc/self/fd/${directory.fd}/${name}`,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const previous = directory;
      directory = next;
      await previous.close();
    }
    checkFileDeadline(deadline);
    file = await open(`/proc/self/fd/${directory.fd}/${components.at(-1)}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!(await file.stat()).isFile()) throw fileHelperError();
    checkFileDeadline(deadline);
    await directory.close();
    directory = undefined;
    const result = file;
    file = undefined;
    return result;
  } catch (error) {
    throw sanitizeFileHelperError(error);
  } finally {
    await file?.close().catch(() => {});
    await directory?.close().catch(() => {});
  }
}

function trackedEntries(output) {
  if (typeof output !== 'string' || (output && !output.endsWith('\0'))) throw fileHelperError();
  const seen = new Set();
  return output.split('\0').filter(Boolean).map((entry) => {
    const match = /^(\d{6}) [a-f0-9]+ ([0-3])\t([^\0]+)$/.exec(entry);
    if (!match || seen.has(match[3])) throw fileHelperError();
    seen.add(match[3]);
    return { mode: match[1], stage: match[2], path: match[3] };
  });
}

async function selectedTrackedEntries(workspace, paths, git, deadline) {
  checkFileDeadline(deadline);
  const entries = trackedEntries(await git(workspace, ['ls-files', '--stage', '-z', '--', ...paths], { deadline }));
  checkFileDeadline(deadline);
  const tracked = new Map(entries.map(({ path, mode, stage }) => {
    if (stage !== '0' || !['100644', '100755'].includes(mode)) throw fileHelperError();
    return [path, mode];
  }));
  if (tracked.size !== paths.length || !paths.every((path) => tracked.has(path))) throw fileHelperError();
  return tracked;
}

// Unconnected preparation helper: no content is read to build the catalog.
export async function buildAuthorizedCatalog(workspace, deadline, git = runProposalGit) {
  try {
    checkFileDeadline(deadline);
    const entries = trackedEntries(await git(workspace, ['ls-files', '--stage', '-z'], { deadline }));
    checkFileDeadline(deadline);
    const candidates = entries.filter(({ mode, stage, path }) => stage === '0'
      && ['100644', '100755'].includes(mode) && validProposalPath(path));
    if (candidates.length > 1000) throw fileHelperError('AUTHORIZED_CATALOG_TOO_LARGE');
    const catalog = [];
    for (const { path, mode } of candidates) {
      checkFileDeadline(deadline);
      const file = await openTrackedRegularFile(workspace, path, mode, deadline);
      try { catalog.push(path); }
      finally { await file.close(); }
    }
    checkFileDeadline(deadline);
    return catalog.sort();
  } catch (error) {
    throw sanitizeFileHelperError(error);
  }
}

// Unconnected preparation helper: bytes are bounded before decoding/retention.
export async function readSelectedTextFiles(workspace, paths, deadline, git = runProposalGit) {
  try {
    checkFileDeadline(deadline);
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > 20
      || new Set(paths).size !== paths.length || !paths.every(validProposalPath)) throw fileHelperError();
    const tracked = await selectedTrackedEntries(workspace, paths, git, deadline);
    let total = 0;
    const result = [];
    for (const path of paths) {
      checkFileDeadline(deadline);
      const file = await openTrackedRegularFile(workspace, path, tracked.get(path), deadline);
      try {
        const buffer = Buffer.alloc(4096);
        // ignoreBOM=true preserves an initial UTF-8 BOM as U+FEFF.
        const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
        let size = 0;
        let content = '';
        while (true) {
          checkFileDeadline(deadline);
          const { bytesRead } = await file.read(buffer, 0, buffer.length, size);
          checkFileDeadline(deadline);
          if (!bytesRead) break;
          size += bytesRead;
          total += bytesRead;
          if (size > 16 * 1024) throw fileHelperError('SELECTED_FILE_TOO_LARGE');
          if (total > 32 * 1024) throw fileHelperError('SELECTED_CONTENT_TOO_LARGE');
          const bytes = buffer.subarray(0, bytesRead);
          if (bytes.includes(0)) throw fileHelperError();
          content += decoder.decode(bytes, { stream: true });
        }
        content += decoder.decode();
        result.push({ path, content });
      } finally { await file.close(); }
    }
    checkFileDeadline(deadline);
    return result;
  } catch (error) {
    throw sanitizeFileHelperError(error);
  }
}

async function verifyTrackedTextFiles(workspace, files, git, deadline) {
  const tracked = await selectedTrackedEntries(workspace, files, git, deadline);
  for (const path of files) {
    const file = await openTrackedRegularFile(workspace, path, tracked.get(path), deadline);
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let offset = 0;
      while (true) {
        if (Date.now() >= deadline) throw new Error('Text validation timed out.');
        const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) break;
        const bytes = buffer.subarray(0, bytesRead);
        if (bytes.includes(0)) throw new Error('Binary file.');
        decoder.decode(bytes, { stream: true });
        offset += bytesRead;
      }
      decoder.decode();
    } finally { await file.close(); }
  }
}

const endpointMessages = Object.freeze({
  FILE_SELECTION_CONTEXT_TOO_LARGE: 'El catálogo de selección excedió el tamaño máximo.',
  FILE_SELECTION_MODEL_INVALID: 'El modelo no devolvió una selección válida.',
  DETERMINISTIC_CONTEXT_TOO_LARGE: 'El contexto de la propuesta excedió el tamaño máximo.',
  DETERMINISTIC_MODEL_INVALID: 'El modelo no devolvió una propuesta válida.',
  OLLAMA_UNAVAILABLE: 'Ollama no está disponible.',
  OLLAMA_BAD_RESPONSE: 'Ollama no devolvió una respuesta válida.',
  OLLAMA_RESPONSE_TOO_LARGE: 'La respuesta de Ollama excedió el tamaño máximo.',
  FAILED: 'No se pudo generar una propuesta segura.',
  WORKSPACE_NOT_SAFE: 'No se pudo confirmar la seguridad del workspace.',
});

function mapProposalError(error) {
  let code;
  try { code = error?.code; } catch { /* Untrusted accessor. */ }
  if (typeof code !== 'string') code = 'FAILED';
  if (['OLLAMA_TIMEOUT', 'FILE_OPERATION_TIMEOUT', 'DIFF_TIMEOUT'].includes(code)) {
    return Object.assign(failure(504, 'TIMEOUT', 'La propuesta excedió el tiempo máximo.'),
      { timeoutSource: code === 'OLLAMA_TIMEOUT' ? 'client' : 'endpoint' });
  }
  const mapped = {
    AUTHORIZED_CATALOG_TOO_LARGE: 'FILE_SELECTION_CONTEXT_TOO_LARGE',
    SELECTED_FILE_TOO_LARGE: 'DETERMINISTIC_CONTEXT_TOO_LARGE',
    SELECTED_CONTENT_TOO_LARGE: 'DETERMINISTIC_CONTEXT_TOO_LARGE',
    FILE_VALIDATION_FAILED: 'WORKSPACE_NOT_SAFE',
    FILE_SELECTION_INPUT_INVALID: 'FAILED', DETERMINISTIC_INPUT_INVALID: 'FAILED',
    DIFF_INPUT_INVALID: 'FAILED', DIFF_PROCESS_FAILED: 'FAILED',
    DIFF_OUTPUT_TOO_LARGE: 'FAILED', DIFF_INVALID_OUTPUT: 'FAILED',
  };
  code = Object.hasOwn(mapped, code) ? mapped[code]
    : Object.hasOwn(endpointMessages, code) ? code : 'FAILED';
  return failure(code === 'OLLAMA_UNAVAILABLE' ? 503 : code === 'WORKSPACE_NOT_SAFE' || code === 'FAILED' ? 500 : 502,
    code, endpointMessages[code]);
}

async function validateProposalRepository(workspace, git, deadline) {
  if (!posix.isAbsolute(workspace) || await realpath(workspace) !== workspace
    || (await git(workspace, ['rev-parse', '--is-inside-work-tree'], { deadline })).trim() !== 'true'
    || await realpath((await git(workspace, ['rev-parse', '--show-toplevel'], { deadline })).trim()) !== workspace) {
    throw new Error();
  }
}

async function assertProposalWorkspaceState(workspace, baseHead, getWorkspaceStatus, git, deadline) {
  const status = await beforeDeadline(getWorkspaceStatus, deadline);
  if (!status.available || !status.running || status.workspace !== workspace) {
    throw failure(409, 'WORKSPACE_CHANGED', 'El workspace activo cambió durante la propuesta.');
  }
  try { await validateProposalRepository(workspace, git, deadline); }
  catch { throw failure(409, 'NOT_REPOSITORY', 'El workspace debe ser la raíz de un repositorio Git válido.'); }
  if (await git(workspace, ['status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none'], { deadline }) !== '') {
    throw failure(409, 'DIRTY_WORKSPACE', 'El repositorio debe estar completamente limpio para generar una propuesta.');
  }
  if ((await git(workspace, ['rev-parse', 'HEAD'], { deadline })).trim() !== baseHead) {
    throw failure(409, 'HEAD_CHANGED', 'El HEAD cambió durante la propuesta. Genera una nueva propuesta sobre la base actual.');
  }
}

function contentFingerprint({ path, content }) {
  return createHash('sha256').update(JSON.stringify(path), 'utf8').update('\0')
    .update(content, 'utf8').digest('hex');
}

export function proposalPhaseDeadline(globalDeadline, phase, now = Date.now()) {
  const cutoff = globalDeadline - 20_000 - (phase === 2 ? 10_000 : 0);
  return Math.min(cutoff, now + (phase === 1 ? 30_000 : 150_000));
}

async function registerAuditedProposal(registration, { workspace, baseHead, git, deadline, store }) {
  if (!same(await repositoryIdentity(workspace, git, deadline), registration.repoIdentity)) throw new Error();
  const finalSnapshot = await captureFileFingerprints(workspace, registration.paths, registration.modes, deadline);
  if (!same(finalSnapshot.fingerprints, registration.originalFingerprints)
    || !same(finalSnapshot.permissions, registration.permissions)
    || !same(finalSnapshot.sizes, registration.sizes)) throw new Error();
  if ((await git(workspace, ['rev-parse', 'HEAD'], { deadline })).trim() !== baseHead) throw new Error();
  return store.register(registration);
}

export function createChangeProposalHandler({ getWorkspaceStatus, json,
  git = runProposalGit, selectFiles = selectProposalFiles, generateProposal = generateDeterministicProposal,
  generateDiff = generateDeterministicDiff, store = createProposalStore(), locks = createWorkspaceLocks(),
  waitForWarmup = async () => {} }) {
  let proposalInProgress = false;
  return async function changeProposal(request, response, parsedBody) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      json(response, 405, { success: false, code: 'METHOD', error: 'Método no permitido.' }); return;
    }
    if (request.url.includes('?')) {
      json(response, 400, { success: false, code: 'INVALID_REQUEST', error: 'No se permiten parámetros.' }); return;
    }
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      json(response, 415, { success: false, code: 'CONTENT_TYPE', error: 'Se requiere application/json.' }); return;
    }
    if (request.headers.origin) {
      let origin;
      try { origin = new URL(request.headers.origin); } catch { /* Rejected below. */ }
      if (!origin || !['http:', 'https:'].includes(origin.protocol) || origin.host !== request.headers.host) {
        json(response, 403, { success: false, code: 'ORIGIN', error: 'Origen no permitido.' }); return;
      }
    }
    if (proposalInProgress) {
      json(response, 409, { success: false, code: 'BUSY', error: 'Ya hay una propuesta en curso.' }); return;
    }
    let ownsProposal = false;
    const deadline = Date.now() + 180_000;
    const workDeadline = deadline - 20_000;
    const timings = {};
    let stage = 'body_validation';
    let stageStarted = Date.now();
    let modelBudgetSeconds = 0;
    let timeoutDiagnostic;
    const enterStage = (next) => {
      timings[stage] = Math.max(0, Date.now() - stageStarted);
      stage = next;
      stageStarted = Date.now();
    };
    let workspace;
    let baseHead;
    let cleanInitially = false;
    let result;
    let release;
    let registration;
    let error;
    try {
      let body;
      try {
        body = parsedBody === undefined
          ? await readBoundedJson(request, { maxBytes: 32 * 1024 }) : parsedBody;
      } catch (cause) {
        if (cause instanceof AuthRequestError && cause.status === 413) {
          throw failure(413, 'BODY_TOO_LARGE', 'Solicitud demasiado grande.');
        }
        throw failure(400, 'INVALID_REQUEST', 'JSON no válido.');
      }
      const description = validateChangeRequest(body);
      enterStage('model_warmup');
      try { await beforeDeadline(() => waitForWarmup(workDeadline), workDeadline); }
      catch (cause) { throw safeEndpointErrors.has(cause) ? cause : mapProposalError(cause); }
      if (proposalInProgress) throw failure(409, 'BUSY', 'Ya hay una propuesta en curso.');
      proposalInProgress = true;
      ownsProposal = true;
      enterStage('initial_workspace_status');
      const status = await beforeDeadline(getWorkspaceStatus, workDeadline);
      if (!status.available || !status.running || !status.workspace) {
        throw failure(503, 'UNAVAILABLE', 'El contenedor o su workspace no están disponibles.');
      }
      workspace = status.workspace;
      release = locks.acquire(workspace);
      if (!release) throw failure(409, 'BUSY', 'El workspace está ocupado.');
      enterStage('repository_validation');
      try {
        await validateProposalRepository(workspace, git, workDeadline);
      } catch { throw failure(409, 'NOT_REPOSITORY', 'El workspace debe ser la raíz de un repositorio Git válido.'); }
      enterStage('initial_git_status');
      if (await git(workspace, ['status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none'], { deadline: workDeadline }) !== '') {
        throw failure(409, 'DIRTY_WORKSPACE', 'El repositorio debe estar completamente limpio para generar una propuesta.');
      }
      cleanInitially = true;
      enterStage('head_revision');
      try { baseHead = (await git(workspace, ['rev-parse', 'HEAD'], { deadline: workDeadline })).trim(); }
      catch { throw failure(409, 'NO_HEAD', 'No se pudo confirmar el HEAD del repositorio.'); }
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseHead)) throw failure(409, 'NO_HEAD', 'No se pudo confirmar el HEAD del repositorio.');
      enterStage('authorized_catalog');
      let catalog;
      try { catalog = await buildAuthorizedCatalog(workspace, workDeadline, git); }
      catch (cause) { throw mapProposalError(cause); }
      const checkpoint = () => assertProposalWorkspaceState(workspace, baseHead, getWorkspaceStatus, git, workDeadline);
      enterStage('before_selection_checkpoint');
      await checkpoint();
      const runPhase = async (phase, operation, input) => {
        const phaseDeadline = proposalPhaseDeadline(deadline, phase);
        if (phaseDeadline <= Date.now()) {
          throw Object.assign(failure(504, 'TIMEOUT', 'La propuesta excedió el tiempo máximo.'), { timeoutSource: 'endpoint' });
        }
        modelBudgetSeconds = Math.max(0, (phaseDeadline - Date.now()) / 1000);
        try {
          return await beforeDeadline(() => operation({ ...input, deadline: phaseDeadline }, {
            validatePath: validProposalPath,
            generate: (args) => generateOllamaProposal({ ...args, deadline: phaseDeadline,
              timeoutMs: Math.max(1, phaseDeadline - Date.now()) }),
          }), phaseDeadline);
        } catch (cause) {
          if (safeEndpointErrors.has(cause)) throw cause;
          throw mapProposalError(cause);
        }
      };
      enterStage('file_selection');
      const selection = await runPhase(1, selectFiles, { request: description, catalog });
      // Defensive membership check also covers injected implementations.
      if (!selection || !Array.isArray(selection.files) || !selection.files.length || selection.files.length > 20
        || new Set(selection.files).size !== selection.files.length
        || !selection.files.every((path) => validProposalPath(path) && catalog.includes(path))) {
        throw mapProposalError({ code: 'FILE_SELECTION_MODEL_INVALID' });
      }
      enterStage('after_selection_checkpoint');
      await checkpoint();
      enterStage('selected_files_read');
      let contents;
      try { contents = await readSelectedTextFiles(workspace, selection.files, workDeadline, git); }
      catch (cause) { throw mapProposalError(cause); }
      const repoIdentity = await repositoryIdentity(workspace, git, workDeadline);
      const modes = await trackedModes(workspace, selection.files, git, workDeadline);
      const originalSnapshot = await captureFileFingerprints(workspace, selection.files, modes, workDeadline);
      const fingerprints = new Map(contents.map((file) => [file.path, contentFingerprint(file)]));
      enterStage('after_read_checkpoint');
      await checkpoint();
      enterStage('proposal_generation');
      // Do not let an injected generator mutate the original snapshot in memory.
      const phase2 = await runPhase(2, generateProposal, { request: description,
        files: contents.map(({ path, content }) => ({ path, content })) });
      enterStage('after_generation_checkpoint');
      await checkpoint();
      enterStage('snapshot_verification');
      let currentContents;
      try { currentContents = await readSelectedTextFiles(workspace, selection.files, workDeadline, git); }
      catch (cause) { throw mapProposalError(cause); }
      if (currentContents.some((file) => fingerprints.get(file.path) !== contentFingerprint(file))) {
        throw failure(409, 'WORKSPACE_CHANGED', 'El workspace activo cambió durante la propuesta.');
      }
      currentContents = undefined;
      const plain = (value) => value && typeof value === 'object'
        && Object.getPrototypeOf(value) === Object.prototype;
      if (!plain(phase2) || Object.keys(phase2).length !== 2
        || !['summary', 'files'].every((key) => Object.hasOwn(phase2, key))
        || typeof phase2.summary !== 'string' || !phase2.summary.trim() || phase2.summary.length > 4000
        || forbiddenControls.test(phase2.summary) || !Array.isArray(phase2.files)
        || phase2.files.length < 1 || phase2.files.length > 20) {
        throw mapProposalError({ code: 'DETERMINISTIC_MODEL_INVALID' });
      }
      const seen = new Set();
      let proposedBytes = 0;
      for (const file of phase2.files) {
        if (!plain(file) || Object.keys(file).length !== 2
          || !['path', 'content'].every((key) => Object.hasOwn(file, key))
          || typeof file.path !== 'string' || !fingerprints.has(file.path) || seen.has(file.path)
          || typeof file.content !== 'string') throw mapProposalError({ code: 'DETERMINISTIC_MODEL_INVALID' });
        seen.add(file.path);
        proposedBytes += Buffer.byteLength(file.content, 'utf8');
        if (proposedBytes > 32 * 1024) throw mapProposalError({ code: 'DETERMINISTIC_CONTEXT_TOO_LARGE' });
      }
      enterStage('deterministic_diff');
      const originals = new Map(contents.map(({ path, content }) => [path, content]));
      const proposal = { summary: phase2.summary, files: [], patch: '' };
      for (const { path, content } of [...phase2.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
        let diff;
        try {
          diff = await beforeDeadline(() => generateDiff({ path, originalContent: originals.get(path),
            proposedContent: content, deadline: workDeadline }, { validatePath: validProposalPath }), workDeadline);
        } catch (cause) { throw safeEndpointErrors.has(cause) ? cause : mapProposalError(cause); }
        if (!plain(diff) || diff.path !== path || typeof diff.changed !== 'boolean' || typeof diff.patch !== 'string'
          || (!diff.changed && diff.patch !== '') || (diff.changed && !diff.patch)) {
          throw mapProposalError({ code: 'DIFF_INVALID_OUTPUT' });
        }
        if (diff.changed) { proposal.files.push(path); proposal.patch += diff.patch; }
        if (Buffer.byteLength(proposal.patch, 'utf8') > patchLimit) {
          throw mapProposalError({ code: 'DETERMINISTIC_MODEL_INVALID' });
        }
      }
      const proposedFingerprints = Object.fromEntries(phase2.files.map(({ path, content }) => [path, sha256(Buffer.from(content, 'utf8'))]));
      registration = { workspace, repoRoot: repoIdentity.repoRoot, repoIdentity, baseHead, paths: proposal.files, patch: proposal.patch,
        modes: Object.fromEntries(proposal.files.map((path) => [path, modes[path]])),
        sizes: Object.fromEntries(proposal.files.map((path) => [path, originalSnapshot.sizes[path]])),
        proposedSizes: Object.fromEntries(proposal.files.map((path) => [path, Buffer.byteLength(phase2.files.find((file) => file.path === path).content, 'utf8')])),
        permissions: Object.fromEntries(proposal.files.map((path) => [path, originalSnapshot.permissions[path]])),
        originalFingerprints: Object.fromEntries(proposal.files.map((path) => [path, originalSnapshot.fingerprints[path]])),
        proposedFingerprints: Object.fromEntries(proposal.files.map((path) => [path, proposedFingerprints[path]])) };
      contents = undefined;
      originals.clear();
      if (!proposal.files.length) throw patchStructureFailure('no_changes');
      enterStage('patch_structure');
      if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)
        || Object.keys(proposal).length !== 3 || !['summary', 'files', 'patch'].every((key) => Object.hasOwn(proposal, key))
        || typeof proposal.summary !== 'string' || !proposal.summary.trim() || proposal.summary.length > 4000
        || forbiddenControls.test(proposal.summary) || !Array.isArray(proposal.files) || !proposal.files.length
        || proposal.files.length > 20 || new Set(proposal.files).size !== proposal.files.length
        || !proposal.files.every((path) => validProposalPath(path) && fingerprints.has(path))
        || typeof proposal.patch !== 'string' || !proposal.patch.trim()
        || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(proposal.patch)
        || Buffer.byteLength(proposal.patch) > patchLimit) throw mapProposalError({ code: 'DETERMINISTIC_MODEL_INVALID' });
      if (!proposal.patch.endsWith('\n')) proposal.patch += '\n';
      if (Buffer.byteLength(proposal.patch) > patchLimit) throw mapProposalError({ code: 'DETERMINISTIC_MODEL_INVALID' });
      validatePatchStructure(proposal, { recount: true });
      enterStage('target_files_validation');
      try { await verifyTrackedTextFiles(workspace, proposal.files, git, workDeadline); }
      catch (cause) {
        if (cause?.code === 'FILE_OPERATION_TIMEOUT') throw mapProposalError(cause);
        throw proposalFailure('INVALID_TARGET_FILES');
      }
      enterStage('patch_check');
      // Every patch command, including the diagnostic retry, uses --check.
      try {
        await git(workspace, ['apply', '--check', '--recount', '--index', '--whitespace=error', '-'], { input: proposal.patch, deadline: workDeadline });
      } catch (cause) {
        const patchCheckReason = await diagnosePatchCheck(workspace, proposal.patch, git, workDeadline, cause);
        throw Object.assign(proposalFailure('PATCH_CHECK_FAILED'), { patchCheckReason });
      }
      registration.patch = proposal.patch;
      result = { success: true, workspace, engine: 'ollama-deterministic', baseHead, proposal };
    } catch (cause) {
      error = safeEndpointErrors.has(cause) ? cause : mapProposalError(cause);
      if (error.publicCode === 'TIMEOUT') {
        timeoutDiagnostic = { stage, timing: { elapsedMs: Math.max(0, Date.now() - stageStarted), modelBudgetSeconds } };
        if (['client', 'endpoint'].includes(error.timeoutSource)) timeoutDiagnostic.timeoutSource = error.timeoutSource;
      }
    }
    finally {
      enterStage('final_git_audit');
      if (cleanInitially) {
        let mountSafe = true;
        try {
          const current = await beforeDeadline(getWorkspaceStatus, Math.min(deadline, Date.now() + 5000));
          if (!current.available || !current.running || current.workspace !== workspace) throw new Error();
        } catch { mountSafe = false; }
        // Attempt Git auditing even when mount discovery failed. Each deadline
        // derives from the original request and fits within the final reserve.
        try {
          const status = await git(workspace, ['status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none'],
            { deadline: Math.min(deadline, Date.now() + 7000) });
          if (status !== '') throw new Error();
          if (baseHead && (await git(workspace, ['rev-parse', 'HEAD'],
            { deadline: Math.min(deadline, Date.now() + 7000) })).trim() !== baseHead) {
            error = failure(409, 'HEAD_CHANGED', 'El HEAD cambió durante la propuesta. Genera una nueva propuesta sobre la base actual.');
          }
        } catch {
          error = failure(500, 'WORKSPACE_NOT_SAFE', 'Error crítico: el workspace cambió o no se pudo confirmar que siga limpio. No se puede afirmar que la propuesta fue segura.');
        }
        if (!mountSafe) error = failure(500, 'WORKSPACE_NOT_SAFE', endpointMessages.WORKSPACE_NOT_SAFE);
      }
      timings[stage] = Math.max(0, Date.now() - stageStarted);
      if (!error && registration) {
        try {
          const registered = await registerAuditedProposal(registration, { workspace, baseHead, git, deadline, store });
          result.proposalId = registered.proposalId; result.expiresAt = registered.expiresAt;
        } catch { error = failure(500, 'WORKSPACE_NOT_SAFE', endpointMessages.WORKSPACE_NOT_SAFE); }
      }
      release?.();
      if (ownsProposal) proposalInProgress = false;
    }
    if (error) json(response, error.status ?? 502, { success: false, code: error.publicCode ?? 'FAILED',
      error: error.publicCode === 'TIMEOUT' ? 'La propuesta excedió el tiempo máximo.'
        : error.status ? error.message : 'No se pudo generar una propuesta segura.',
      ...(error.publicCode === 'TIMEOUT' ? timeoutDiagnostic : {}),
      ...(error.publicCode === 'INVALID_PATCH_STRUCTURE' && patchStructureReasons.has(error.patchStructureReason)
        ? { patchStructureReason: error.patchStructureReason } : {}),
      ...(error.publicCode === 'PATCH_CHECK_FAILED' && patchCheckReasons.has(error.patchCheckReason)
        ? { patchCheckReason: error.patchCheckReason } : {}) });
    else json(response, 200, result);
  };
}

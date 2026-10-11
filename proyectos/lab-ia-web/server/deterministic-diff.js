import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const deterministicDiffLimits = Object.freeze({ contentBytes: 16 * 1024, outputBytes: 128 * 1024 });
const helper = fileURLToPath(new URL('./diff-pipe-helper.py', import.meta.url));
const messages = Object.freeze({
  DIFF_INPUT_INVALID: 'La entrada del diff no es válida.',
  DIFF_TIMEOUT: 'La generación del diff excedió el tiempo máximo.',
  DIFF_PROCESS_FAILED: 'No se pudo generar el diff.',
  DIFF_OUTPUT_TOO_LARGE: 'El diff excedió el tamaño máximo.',
  DIFF_INVALID_OUTPUT: 'El diff generado no tiene el formato esperado.',
});
const failure = (code) => Object.freeze({ code, error: messages[code] });
const relativePath = (path) => typeof path === 'string' && path.length > 0 && path.length <= 1024
  && path === path.trim() && !/[\\\x00-\x1f\x7f-\x9f":]/u.test(path)
  && path.split('/').every((part) => part && part !== '.' && part !== '..');

function transformHeaders(raw, path) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw); }
  catch { throw failure('DIFF_INVALID_OUTPUT'); }
  const hunk = text.indexOf('\n@@ ');
  if (hunk < 0 || !text.endsWith('\n')) throw failure('DIFF_INVALID_OUTPUT');
  const lines = text.slice(0, hunk).split('\n');
  const match = /^diff --git a\/proc\/self\/fd\/([1-9]\d*) b\/proc\/self\/fd\/([1-9]\d*)$/.exec(lines[0]);
  if (!match || match[1] === match[2]) throw failure('DIFF_INVALID_OUTPUT');
  if (lines[1]?.startsWith('index ')) {
    if (!/^index [0-9a-f]{7,64}\.\.[0-9a-f]{7,64} 100644$/.test(lines[1])) {
      throw failure('DIFF_INVALID_OUTPUT');
    }
    lines.splice(1, 1);
  }
  if (lines.length !== 3 || lines[1] !== `--- a/proc/self/fd/${match[1]}`
    || lines[2] !== `+++ b/proc/self/fd/${match[2]}`
    || !/^\n@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?: [^\r\n]*)?\n/.test(text.slice(hunk))) {
    throw failure('DIFF_INVALID_OUTPUT');
  }
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}${text.slice(hunk)}`;
}

/** No filesystem writes, model calls or workspace access. Dependencies are injectable for tests. */
export async function generateDeterministicDiff(input = {}, { validatePath = relativePath,
  spawnImpl = spawn, killGroup = (pid, signal) => process.kill(-pid, signal) } = {}) {
  let oldBytes; let newBytes;
  try {
    const { path, originalContent, proposedContent, deadline } = input;
    if (!relativePath(path) || !validatePath(path) || !Number.isFinite(deadline)
      || ![originalContent, proposedContent].every((content) => typeof content === 'string'
        && content.isWellFormed() && !content.includes('\0')
        && Buffer.byteLength(content, 'utf8') <= deterministicDiffLimits.contentBytes)) {
      throw new Error();
    }
    oldBytes = Buffer.from(originalContent, 'utf8');
    newBytes = Buffer.from(proposedContent, 'utf8');
  } catch { throw failure('DIFF_INPUT_INVALID'); }
  const budget = input.deadline - Date.now();
  if (budget <= 0) throw failure('DIFF_TIMEOUT');
  const frame = Buffer.alloc(8 + oldBytes.length + newBytes.length);
  frame.writeUInt32BE(oldBytes.length, 0); frame.writeUInt32BE(newBytes.length, 4);
  oldBytes.copy(frame, 8); newBytes.copy(frame, 8 + oldBytes.length);
  return new Promise((resolve, reject) => {
    let child; let timer; let killTimer; let terminalCode; let size = 0; let chunks = []; let settled = false; let closed = false;
    const terminate = (signal = 'SIGKILL') => { if (!closed && Number.isInteger(child?.pid) && child.pid > 0) {
      try { killGroup(child.pid, signal); } catch { /* Group already exited. Never expose OS errors. */ }
    } };
    const abort = (code) => {
      if (terminalCode) return;
      terminalCode = code; chunks = []; terminate('SIGTERM');
      // Python can reap Git in finally; force the entire group if cleanup stalls.
      if (!closed) killTimer = setTimeout(() => terminate('SIGKILL'), 500);
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(killTimer);
      if (error) reject(error); else resolve(result);
    };
    try {
      child = spawnImpl('/usr/bin/python3', ['-B', helper], {
        cwd: '/', detached: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'],
        env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1', GIT_ATTR_NOSYSTEM: '1' },
      });
      timer = setTimeout(() => abort('DIFF_TIMEOUT'), Math.min(budget, 2_147_483_647));
      child.on('error', () => {
        if (Number.isInteger(child.pid) && child.pid > 0) abort('DIFF_PROCESS_FAILED');
        else finish(failure('DIFF_PROCESS_FAILED'));
      });
      child.stdout.on('data', (chunk) => {
        if (terminalCode) return;
        size += chunk.length;
        if (size > deterministicDiffLimits.outputBytes) abort('DIFF_OUTPUT_TOO_LARGE');
        else chunks.push(Buffer.from(chunk));
      });
      child.stdout.on('error', () => abort('DIFF_PROCESS_FAILED'));
      child.stdin.on('error', () => { /* Exit/close determines the safe error. */ });
      child.on('close', (code, signal) => {
        closed = true;
        if (terminalCode) return finish(failure(terminalCode));
        if (signal || (code !== 0 && code !== 1)) return finish(failure('DIFF_PROCESS_FAILED'));
        if (code === 0) {
          if (size || input.originalContent !== input.proposedContent) return finish(failure('DIFF_INVALID_OUTPUT'));
          return finish(null, { changed: false, path: input.path, patch: '' });
        }
        try {
          if (input.originalContent === input.proposedContent) throw failure('DIFF_INVALID_OUTPUT');
          finish(null, { changed: true, path: input.path, patch: transformHeaders(Buffer.concat(chunks, size), input.path) });
        } catch { finish(failure('DIFF_INVALID_OUTPUT')); }
      });
      child.stdin.end(frame);
    } catch {
      if (Number.isInteger(child?.pid) && child.pid > 0 && !closed) abort('DIFF_PROCESS_FAILED');
      else finish(failure('DIFF_PROCESS_FAILED'));
    }
  });
}

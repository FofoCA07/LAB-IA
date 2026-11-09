// Candidate only. Trusted backend hooks supply lifecycle evidence, never HTTP input.
import { EventEmitter } from 'node:events';

export const KINDS = Object.freeze(['summary', 'activation', 'chat', 'continuation',
  'proposal', 'apply', 'action', 'write', 'warmup', 'probe',
  'admin-health', 'admin-reviewer', 'admin-summary', 'admin-workspace']);
const RESOURCES = new Set(['process', 'remote', 'deferred', 'promise']);
const CODES = new Set(['TIMEOUT', 'PROCESS_ERROR', 'OPERATION_FAILED', 'UNCERTAIN']);
export function failure(code) { return Object.assign(new Error(code), { code }); }

export function createBarrier({ store, verifyRecovery = async () => false,
  verifyUncertain = async () => false } = {}) {
  if (!store?.load || !store?.save) throw failure('STORE_REQUIRED');
  const events = new EventEmitter();
  const jobs = new Map();
  let sequence = 0;
  let state = 'DRAINING';
  let recoveryRequired = true;
  let fault = null;
  let lastError = null;
  let disposed = false;
  let recoveryRunning = false;
  const recovered = store.load(); // Corruption must abort initialization, not reset state.
  if (recovered !== null) {
    if (recovered.version !== 1 || !['NORMAL', 'DRAINING', 'MAINTENANCE'].includes(recovered.state)
      || !Number.isSafeInteger(recovered.sequence) || recovered.sequence < 0
      || !Array.isArray(recovered.jobs) || recovered.jobs.length > 256) throw failure('INVALID_STATE');
    sequence = recovered.sequence;
    for (const item of recovered.jobs) {
      if (!/^j[1-9][0-9]*$/.test(item.id) || !KINDS.includes(item.kind)
        || jobs.has(item.id) || Number(item.id.slice(1)) > sequence) throw failure('INVALID_STATE');
      jobs.set(item.id, { id: item.id, kind: item.kind, recovered: true,
        rootDone: false, uncertain: true, resources: new Map() });
    }
    // Every boot starts DRAINING, including a previous MAINTENANCE checkpoint.
    // Historical state never substitutes for fresh termination evidence.
  }
  function status() {
    return { state, recoveryRequired, fault, lastError, active: jobs.size,
      jobs: [...jobs.values()].map(j => ({ id: j.id, kind: j.kind,
        rootDone: j.rootDone, uncertain: j.uncertain, recovered: j.recovered,
        resources: [...j.resources.values()] })) };
  }
  function save() {
    try {
      store.save({ version: 1, state, sequence,
        jobs: [...jobs.values()].map(({ id, kind }) => ({ id, kind })) });
    } catch {
      state = 'DRAINING'; fault = 'PERSISTENCE_FAILED';
      events.emit('change'); throw failure(fault);
    }
    events.emit('change');
  }
  function usable() { if (disposed || fault) throw failure(fault ?? 'DISPOSED'); }
  function ready() { usable(); if (recoveryRequired || jobs.size) throw failure('NOT_DRAINED'); }
  function drain() { usable(); state = 'DRAINING'; save(); return status(); }
  function confirm() {
    ready(); if (state !== 'DRAINING') throw failure('BAD_STATE');
    state = 'MAINTENANCE'; save(); return status();
  }
  function reopen() {
    ready(); if (state !== 'MAINTENANCE') throw failure('BAD_STATE');
    state = 'NORMAL'; save(); return status();
  }
  function ticket(kind, administrative = false) {
    usable();
    if (!KINDS.includes(kind) || kind.startsWith('admin-') !== administrative) throw failure('INVALID_KIND');
    if (recoveryRequired || (administrative ? state !== 'MAINTENANCE' || jobs.size : state !== 'NORMAL')) {
      throw failure('ADMISSION_CLOSED');
    }
    if (jobs.size >= 256 || sequence >= Number.MAX_SAFE_INTEGER) throw failure('CAPACITY');
    if (administrative) state = 'DRAINING'; // Never report maintenance while a diagnostic is active.
    const j = { id: `j${++sequence}`, kind, recovered: false, rootDone: false,
      uncertain: false, resources: new Map() };
    jobs.set(j.id, j);
    save(); // Durable registration before the caller can start work. No await in admission.
    let resourceSequence = 0;
    function settle() {
      if (j.rootDone && !j.resources.size && !j.uncertain) jobs.delete(j.id);
      save();
    }
    function mark(code) {
      usable(); if (!CODES.has(code)) throw failure('INVALID_CODE');
      if (!jobs.has(j.id)) throw failure('JOB_FINISHED');
      lastError = code;
      if (code !== 'OPERATION_FAILED') { j.uncertain = true; state = 'DRAINING'; }
      save();
    }
    function hold(type) {
      usable();
      // A previously reserved deferred operation can acquire its own resources
      // after HTTP/root completion. It cannot resurrect a finished job.
      if (!RESOURCES.has(type) || !jobs.has(j.id)
        || (j.rootDone && !j.resources.size)) throw failure('INVALID_RESOURCE');
      const id = ++resourceSequence; j.resources.set(id, type); save();
      let finished = false;
      return Object.freeze({ finish() {
        if (finished) return false;
        usable(); finished = true; j.resources.delete(id); settle(); return true;
      } });
    }
    return Object.freeze({ id: j.id, hold, mark,
      finish() {
        if (j.rootDone) return false;
        usable(); j.rootDone = true; settle(); return true;
      },
      // Call immediately after spawn, before returning to the event loop.
      // A Docker/shell client requires a remote verifier as well as local close.
      trackChild(child, { remote = false, verifyRemote = async () => false } = {}) {
        const process = hold('process');
        const upstream = remote ? hold('remote') : null;
        let closed = false;
        async function verifyRemoteCompletion() {
          if (!remote || !closed) throw failure('REMOTE_NOT_CLOSED');
          try {
            if (await verifyRemote() !== true) { mark('UNCERTAIN'); return false; }
            upstream.finish(); return true;
          } catch { try { mark('UNCERTAIN'); } catch { /* Fault remains closed. */ } return false; }
        }
        child.once('error', () => { try { mark('PROCESS_ERROR'); } catch { /* Fault remains closed. */ } });
        child.once('close', () => {
          closed = true;
          try { process.finish(); } catch { return; }
          if (remote) void verifyRemoteCompletion();
        });
        return Object.freeze({ verifyRemoteCompletion });
      },
    });
  }
  async function recover() {
    usable();
    if (!recoveryRequired || recoveryRunning) throw failure('BAD_STATE');
    recoveryRunning = true;
    try {
      if (await verifyRecovery(status()) !== true) throw failure('RECOVERY_REQUIRED');
      usable();
      if ([...jobs.values()].some(j => !j.recovered)) throw failure('NOT_DRAINED');
      jobs.clear(); recoveryRequired = false; save(); return status();
    } catch (error) {
      lastError = error.code === 'PERSISTENCE_FAILED' ? error.code : 'RECOVERY_REQUIRED';
      throw failure(lastError);
    } finally { recoveryRunning = false; }
  }
  async function reconcileJob(id) {
    usable(); const j = jobs.get(id);
    if (!j || j.recovered || !j.rootDone || j.resources.size || !j.uncertain) throw failure('NOT_RECONCILABLE');
    if (await verifyUncertain({ id: j.id, kind: j.kind }) !== true) throw failure('UNCERTAIN');
    usable(); if (jobs.get(id) !== j) throw failure('JOB_CHANGED');
    j.uncertain = false; jobs.delete(id); save(); return status();
  }
  function waitForDrain({ timeoutMs = 1000, signal } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) return Promise.reject(failure('INVALID_TIMEOUT'));
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); events.off('change', check); signal?.removeEventListener('abort', abort); };
      const abort = () => { cleanup(); reject(failure('WAIT_ABORTED')); };
      const check = () => {
        if (fault || disposed) { cleanup(); reject(failure(fault ?? 'DISPOSED')); }
        else if (state !== 'NORMAL' && !jobs.size && !recoveryRequired) { cleanup(); resolve(status()); }
      };
      timer = setTimeout(() => { cleanup(); reject(failure('WAIT_TIMEOUT')); }, timeoutMs);
      events.on('change', check); signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort(); else check();
    });
  }
  async function runAdministrative(kind, callback) {
    const job = ticket(kind, true);
    try { await callback(job); }
    catch { job.mark('OPERATION_FAILED'); throw failure('DIAGNOSTIC_FAILED'); }
    finally { job.finish(); }
    return status(); // Caller must confirm again; unfinished resources remain visible.
  }
  save();
  return Object.freeze({ status, drain, confirm, reopen, recover, reconcileJob, waitForDrain,
    admit: kind => ticket(kind), runAdministrative,
    close() {
      if (disposed) return;
      try { if (!fault) { state = 'DRAINING'; save(); } }
      finally { disposed = true; events.emit('change'); store.close?.(); }
    },
  });
}

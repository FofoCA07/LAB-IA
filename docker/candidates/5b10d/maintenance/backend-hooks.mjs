// Candidate integration hooks. No Docker client, network destination or credentials.
import { AsyncLocalStorage } from 'node:async_hooks';
import { failure } from './barrier.mjs';

export function createBackendHooks(barrier, json) {
  const context = new AsyncLocalStorage();
  function current() {
    const job = context.getStore(); if (!job) throw failure('MISSING_ADMISSION'); return job;
  }
  async function own(job, callback) {
    return context.run(job, async () => {
      try { return await callback(); }
      finally { job.finish(); }
    });
  }
  function run(kind, callback) { return own(barrier.admit(kind), callback); }
  async function dispatch(kind, request, response, callback) {
    let job;
    try { job = barrier.admit(kind); }
    catch (error) {
      if (!['ADMISSION_CLOSED', 'PERSISTENCE_FAILED', 'DISPOSED', 'CAPACITY'].includes(error.code)) throw error;
      if (!response.destroyed && !response.headersSent) {
        response.setHeader('Cache-Control', 'no-store');
        json(response, 503, { success: false, code: 'MAINTENANCE', error: 'Servicio temporalmente no disponible.' });
      }
      return;
    }
    return own(job, callback); // Never free tickets on request/response close.
  }
  function track(callback, type = 'promise') {
    const job = current(); const hold = job.hold(type);
    return Promise.resolve().then(callback).finally(() => hold.finish());
  }
  function defer(callback, schedule) {
    const job = current(); const hold = job.hold('deferred');
    try {
      schedule(() => {
        void context.run(job, async () => {
          try { await callback(); }
          catch { job.mark('OPERATION_FAILED'); }
          finally { hold.finish(); }
        }).catch(() => { /* Persistence fault remains observable and closed. */ });
      });
    } catch (error) { hold.finish(); throw error; }
  }
  function admitWarmup() {
    const job = barrier.admit('warmup'); // Own shared job; admission precedes scheduling/fetch.
    return Object.freeze({ run: callback => own(job, () => Promise.resolve().then(callback)) });
  }
  function child(start, { remote = false, verifyRemote, events = () => {} } = {}) {
    const job = current(); const reservation = job.hold('process');
    let process; let tracking;
    const emit = type => { try { events(type); } catch { /* Metadata observer only. */ } };
    try {
      process = start(); tracking = job.trackChild(process, { remote, verifyRemote });
    } catch (error) { job.mark('PROCESS_ERROR'); reservation.finish(); throw error; }
    reservation.finish(); emit('start');
    const done = new Promise(resolve => {
      process.once('exit', () => emit('exit'));
      process.once('close', (code, signal) => { emit('close'); resolve({ code, signal }); });
    });
    function interrupt(code, signal) {
      job.mark(code); emit(code === 'TIMEOUT' ? 'timeout' : 'cancel');
      if (!process.kill(signal)) return false;
      return true; // Successful signal delivery is NOT completion evidence.
    }
    return Object.freeze({ process, done, tracking,
      timeout: () => interrupt('TIMEOUT', 'SIGTERM'), cancel: () => interrupt('UNCERTAIN', 'SIGTERM') });
  }
  function trackedFetch(fetchImpl) {
    if (typeof fetchImpl !== 'function') throw failure('FETCH_REQUIRED');
    return async (...args) => {
      const job = current(); const hold = job.hold('remote'); let settled = false;
      const signal = args[1]?.signal;
      const interrupted = () => { if (!settled) { try { job.mark('UNCERTAIN'); } catch { /* Remains closed. */ } } };
      const release = () => { if (!settled) { settled = true; signal?.removeEventListener('abort', interrupted); hold.finish(); } };
      const uncertain = () => { if (settled) return; try { job.mark('UNCERTAIN'); } finally { release(); } };
      try {
        signal?.addEventListener('abort', interrupted, { once: true });
        if (signal?.aborted) throw failure('FETCH_ABORTED');
        const response = await fetchImpl(...args);
        if (!response.body) { uncertain(); return response; }
        const body = response.body;
        const wrapped = {
          getReader(...options) {
            const reader = body.getReader(...options);
            // A cancelled reader also resolves closed: only read().done is EOF.
            void reader.closed.catch(uncertain).catch(() => {});
            return new Proxy(reader, { get(target, key) {
              if (key === 'read') return async (...readArgs) => {
                try { const value = await target.read(...readArgs); if (value.done) release(); return value; }
                catch (error) { uncertain(); throw error; }
              };
              if (key === 'cancel') return (...cancelArgs) => { uncertain(); return target.cancel(...cancelArgs); };
              const value = Reflect.get(target, key, target);
              return typeof value === 'function' ? value.bind(target) : value;
            } });
          },
          cancel(...options) {
            return body.cancel(...options).then(uncertain, uncertain);
          },
          get locked() { return body.locked; },
        };
        return new Proxy(response, { get(target, key) {
          if (key === 'body') return wrapped;
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      } catch (error) { uncertain(); throw error; }
    };
  }
  function statusProbe(withCLI, inspectOnly) {
    if (barrier.status().state !== 'NORMAL' || barrier.status().recoveryRequired) return inspectOnly();
    return run('probe', withCLI);
  }
  return Object.freeze({ run, dispatch, track, defer, admitWarmup, child, trackedFetch, statusProbe });
}

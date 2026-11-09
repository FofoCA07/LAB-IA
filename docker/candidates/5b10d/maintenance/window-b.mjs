// Candidate decision protocol. No production adapter, process commands or default paths.
const scopes = ['local-client', 'container', 'remote-descendants', 'external'];
const same = (a, b) => a?.pid === b?.pid && a?.start === b?.start;
const error = code => Object.assign(new Error(code), { code });
export function createOperationalWindow(adapter, { deadlineMs = 1000 } = {}) {
  if (!Number.isInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 120000) throw error('INVALID_DEADLINE');
  let state = 'INITIAL'; let fault = null; let identity; let acceptanceIdentity; let acceptance = false; let busy = false;
  const status = () => ({ state, fault, acceptance });
  async function bounded(callback, remaining) {
    let timer;
    try {
      if (remaining <= 0) throw error('DEADLINE');
      return await Promise.race([Promise.resolve().then(callback), new Promise((_, reject) => { timer = setTimeout(() => reject(error('DEADLINE')), remaining); })]);
    } finally { clearTimeout(timer); }
  }
  async function exclusive(callback) {
    if (busy) throw error('BUSY'); busy = true;
    try { return await callback(); }
    catch (cause) { state = 'NO_GO'; fault = ['DEADLINE', 'WORK_UNKNOWN', 'INVENTORY_INCOMPLETE', 'BACKEND_REAPPEARED', 'PREFLIGHT', 'ADMISSION_NOT_CLOSED', 'UNAUTHORIZED', 'BAD_STATE', 'STATE_NOT_PRESERVED', 'ACCEPTANCE_FAILED'].includes(cause.code) ? cause.code : 'ADAPTER_FAILED'; throw error(fault); }
    finally { busy = false; }
  }
  function inventory(sample) {
    if (!sample || sample.complete !== true || !scopes.every(scope => sample.scopes?.includes(scope)) || !Array.isArray(sample.jobs)) throw error('INVENTORY_INCOMPLETE');
    if (sample.jobs.some(job => job.classification !== 'known' || !Number.isInteger(job.pid) || job.pid <= 0 || !/^\d+$/.test(job.start) || typeof job.active !== 'boolean')) throw error('WORK_UNKNOWN');
    return sample.jobs.some(job => job.active);
  }
  async function verifyClosed() {
    const sample = await adapter.admissionStatus();
    if (sample?.closed !== true || sample?.technical !== true || sample?.allEntrypoints !== true) throw error('ADMISSION_NOT_CLOSED');
  }
  async function verifyStopped() {
    await verifyClosed();
    const sample = await adapter.backendStatus();
    if (sample?.running !== false || sample?.listenerClosed !== true || sample?.supervisorHeld !== true) throw error('BACKEND_REAPPEARED');
    if (inventory(await adapter.inventory())) throw error('WORK_UNKNOWN');
  }
  async function verifyAcceptanceBackend() {
    await verifyClosed();
    const sample = await adapter.backendStatus();
    if (sample?.running !== true || sample?.supervisorHeld !== true || !same(sample.identity, acceptanceIdentity)) throw error('BACKEND_REAPPEARED');
  }
  return Object.freeze({ status,
    prepare: () => exclusive(async () => {
      if (state !== 'INITIAL') throw error('BAD_STATE');
      const deadline = Date.now() + deadlineMs;
      const run = callback => bounded(callback, deadline - Date.now());
      const preflight = await run(() => adapter.preflight());
      if (preflight?.passed !== true || preflight?.supervisorControlVerified !== true || preflight?.admissionControlVerified !== true
        || !Number.isInteger(preflight?.identity?.pid) || !/^\d+$/.test(preflight?.identity?.start)) throw error('PREFLIGHT');
      identity = preflight.identity;
      await run(() => adapter.closeAdmission()); await run(verifyClosed); state = 'DRAINING';
      while (true) {
        await run(verifyClosed);
        const backend = await run(() => adapter.backendStatus());
        if (backend.running !== true || !same(backend.identity, identity)) throw error('BACKEND_REAPPEARED');
        if (!inventory(await run(() => adapter.inventory()))) break;
        await run(() => adapter.waitForChange());
      }
      state = 'STOPPING'; await run(() => adapter.stopBackend(identity));
      await run(verifyStopped); await run(() => adapter.observeStability()); await run(verifyStopped);
      state = 'STOPPED'; return status();
    }),
    startAcceptance: () => exclusive(async () => {
      if (state !== 'STOPPED') throw error('BAD_STATE');
      await verifyStopped();
      if (await adapter.authorize('start-and-warmup-for-acceptance') !== true) throw error('UNAUTHORIZED');
      await adapter.startForAcceptance(); await verifyClosed();
      const started = await adapter.backendStatus();
      if (started?.running !== true || started?.supervisorHeld !== true || !Number.isInteger(started?.identity?.pid) || !/^\d+$/.test(started?.identity?.start)) throw error('BACKEND_REAPPEARED');
      acceptanceIdentity = started.identity; state = 'ACCEPTANCE';
      return status();
    }),
    accept: () => exclusive(async () => {
      if (state !== 'ACCEPTANCE') throw error('BAD_STATE');
      await verifyAcceptanceBackend(); if (inventory(await adapter.inventory())) throw error('WORK_UNKNOWN');
      if (await adapter.acceptance() !== true) throw error('ACCEPTANCE_FAILED');
      await verifyAcceptanceBackend();
      acceptance = true; state = 'ACCEPTED'; return status();
    }),
    reopen: () => exclusive(async () => {
      if (state !== 'ACCEPTED' || !acceptance) throw error('BAD_STATE');
      if (await adapter.authorize('reopen') !== true) throw error('UNAUTHORIZED');
      await verifyAcceptanceBackend(); if (inventory(await adapter.inventory())) throw error('WORK_UNKNOWN');
      await adapter.releaseAdmission(); state = 'NORMAL'; return status();
    }),
    rollback: () => exclusive(async () => {
      if (state !== 'STOPPED') throw error('BAD_STATE'); await verifyStopped();
      if (await adapter.rollbackPreservingState() !== true) throw error('STATE_NOT_PRESERVED');
      acceptance = false; return status();
    }),
  });
}

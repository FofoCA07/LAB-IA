// Candidate proof consumer, NOT a Docker adapter. Only trusted observations count.
// The current production CLI contract does not supply the required exec identity.
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const positive = value => Number.isSafeInteger(value) && value > 0;
export function identifiable(job) {
  return Boolean(job && hex(job.containerID) && timestamp(job.containerStartedAt)
    && hex(job.execID) && positive(job.pid) && typeof job.processStart === 'string'
    && /^\d+$/.test(job.processStart));
}
export async function verifyRemoteTermination(job, observe, { timeoutMs = 100 } = {}) {
  const no = reason => ({ terminated: false, reason, globalQuiescence: false });
  if (!identifiable(job)) return no('IDENTITY_INSUFFICIENT');
  if (typeof observe !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) return no('VERIFIER_CONFIGURATION');
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => observe(Object.freeze({ ...job }))),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('OBSERVATION_TIMEOUT')), timeoutMs); }),
    ]);
    if (!result || result.container?.id !== job.containerID
      || result.container?.startedAt !== job.containerStartedAt || result.container?.running !== true) return no('CONTAINER_CHANGED');
    if (result.execution?.id !== job.execID || result.execution?.pid !== job.pid
      || result.execution?.processStart !== job.processStart) return no('EXECUTION_CHANGED');
    if (result.execution.running !== false || !Number.isInteger(result.execution.exitCode)) return no('REMOTE_ACTIVE_OR_UNKNOWN');
    if (result.process !== null) {
      if (result.process?.pid !== job.pid || result.process?.start !== job.processStart) return no('PID_REUSED_OR_UNKNOWN');
      if (result.process.alive !== false) return no('REMOTE_PROCESS_ACTIVE');
    }
    if (result.inventory?.complete !== true || result.inventory?.scope !== 'tracked-exec-and-descendants'
      || result.inventory?.unknown !== 0 || !Array.isArray(result.inventory?.descendants)
      || result.inventory.descendants.some(p => !positive(p.pid) || !/^\d+$/.test(p.start) || p.alive !== false)) return no('DESCENDANTS_OR_INVENTORY_UNKNOWN');
    return { terminated: true, reason: 'TRACKED_EXECUTION_ENDED', globalQuiescence: false };
  } catch { return no('OBSERVATION_FAILED_OR_TIMEOUT'); }
  finally { clearTimeout(timer); }
}

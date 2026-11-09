// Prototype only: no Docker transport, launcher, HTTP endpoint or maintenance logic.
// observe is a trusted adapter, never evidence supplied by an HTTP caller.
import { randomUUID } from 'node:crypto';
import { identifiable, verifyRemoteTermination } from './remote-termination.mjs';

const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const fail = code => Object.assign(new Error(code), { code });

export function createRemoteRun({ containerId, containerStartedAt, observe,
  now = () => new Date().toISOString(), verificationTimeoutMs = 100 } = {}) {
  if (!hex(containerId) || !stamp(containerStartedAt) || typeof observe !== 'function') throw fail('INVALID_CONTRACT');
  const record = {
    runId: randomUUID(), containerId, containerStartedAt, executionId: null,
    state: 'CREATED', createdAt: now(), startedAt: null, verifiedAt: null,
    remoteEndedAt: null, result: null, pid: null, processStart: null,
    client: { exited: false, closed: false }, descendants: 'UNKNOWN',
    verification: 'NOT_VERIFIED', reason: null, blocksDrain: true,
  };
  let revision = 0; let attempted = false; let verifying = false;
  const snapshot = () => structuredClone(record);
  function uncertain(reason) {
    record.state = 'UNCERTAIN'; record.verification = 'NOT_VERIFIED';
    record.reason = reason; record.blocksDrain = true; record.result = null;
    record.verifiedAt = null; record.descendants = 'UNKNOWN';
    return snapshot();
  }
  return Object.freeze({
    snapshot,
    creationAttempted() {
      if (record.state !== 'CREATED' || attempted) throw fail('INVALID_CREATION');
      attempted = true; revision++; return snapshot();
    },
    bindExecution(executionId) {
      if (!attempted || record.state !== 'CREATED' || record.executionId || !hex(executionId)) throw fail('INVALID_EXECUTION');
      record.executionId = executionId; revision++; return snapshot();
    },
    started({ pid, processStart } = {}) {
      if (record.state !== 'CREATED' || !identifiable({ containerID: containerId,
        containerStartedAt, execID: record.executionId, pid, processStart })) throw fail('INVALID_START');
      record.pid = pid; record.processStart = processStart; record.startedAt = now();
      record.state = 'RUNNING'; revision++; return snapshot();
    },
    clientEvent(event) {
      if (!['exit', 'close', 'timeout', 'disconnect', 'cancel', 'error'].includes(event)) throw fail('INVALID_EVENT');
      if (record.state === 'FAILED') throw fail('ALREADY_FAILED');
      revision++;
      if (event === 'exit') record.client.exited = true;
      if (event === 'close') record.client.closed = true;
      return uncertain(event === 'close' ? 'REMOTE_PROOF_REQUIRED' : `CLIENT_${event.toUpperCase()}`);
    },
    // FAILED is restricted to local rejection BEFORE any exec creation attempt.
    // A lost create response might have created an exec: it must remain UNCERTAIN.
    rejectedBeforeCreation() {
      if (record.state !== 'CREATED' || attempted) throw fail('CREATION_MAY_HAVE_OCCURRED');
      revision++; record.state = 'FAILED'; record.reason = 'REJECTED_BEFORE_CREATION';
      record.verification = 'NOT_STARTED'; record.blocksDrain = false; return snapshot();
    },
    async verify() {
      if (record.state === 'FAILED') return snapshot();
      if (verifying) { revision++; return uncertain('VERIFICATION_IN_PROGRESS'); }
      verifying = true;
      try {
        const observedRevision = revision;
        let exitCode;
        const proof = await verifyRemoteTermination({ containerID: containerId,
          containerStartedAt, execID: record.executionId, pid: record.pid,
          processStart: record.processStart }, async identity => {
          const observation = await observe(identity);
          exitCode = observation?.execution?.exitCode;
          return observation;
        }, { timeoutMs: verificationTimeoutMs });
        if (revision !== observedRevision) return uncertain('OBSERVATION_RACED_WITH_EVENT');
        if (!record.client.closed) return uncertain('CLIENT_CLOSE_REQUIRED');
        if (!proof.terminated) return uncertain(proof.reason);
        // This is observation time, NOT a Docker-provided remote end timestamp.
        record.state = 'FINISHED_VERIFIED'; record.verification = 'VERIFIED_AT_OBSERVATION';
        record.verifiedAt = now(); record.descendants = 'ENDED_BY_TRUSTED_ADAPTER';
        record.reason = proof.reason; record.blocksDrain = false;
        record.result = { executionEnded: true, exitCode, output: 'NOT_RECORDED' };
        return snapshot();
      } finally { verifying = false; }
    },
  });
}

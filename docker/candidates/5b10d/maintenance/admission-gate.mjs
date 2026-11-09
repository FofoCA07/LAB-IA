// Thin candidate adapter. Reuses the existing state machine and lifecycle hooks.
// No Docker, HTTP admin endpoint, default path, remote verifier or auto-reopening.
import { createBackendHooks } from './backend-hooks.mjs';
import { openLocalControl } from './local-control.mjs';

export function createAdmissionGate({ barrier, json } = {}) {
  if (!barrier || typeof json !== 'function'
    || !['status', 'admit', 'drain', 'confirm', 'reopen', 'recover'].every(key => typeof barrier[key] === 'function')) {
    throw new TypeError('EXISTING_BARRIER_REQUIRED');
  }
  const hooks = createBackendHooks(barrier, json);
  return Object.freeze({
    hooks,
    status() {
      return { ...barrier.status(), scope: 'BACKEND_TRACKED_OPERATIONS_ONLY',
        remoteExclusivity: 'NOT_VERIFIED' };
    },
    openControl({ directory, authorize = () => false } = {}) {
      // The caller supplies an explicitly private directory. No diagnostics or
      // force-clear/reconcile command is added to the existing control protocol.
      return openLocalControl({ directory, barrier, authorize });
    },
  });
}

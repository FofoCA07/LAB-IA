import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const validProposalId = (id) => typeof id === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
function immutable(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(immutable);
    Object.freeze(value);
  }
  return value;
}

export function createProposalStore({ ttl = 600_000, maxProposals = 64,
  maxBytes = 8 * 1024 * 1024, now = () => performance.now(), wallNow = Date.now } = {}) {
  const entries = new Map();
  let bytes = 0;
  function replace(id, state) {
    const entry = entries.get(id);
    bytes -= entry.bytes;
    // Terminal receipts retain no patch, fingerprints or workspace.
    entry.record = immutable({ proposalId: id, expiresAt: entry.record.expiresAt, state });
    entry.bytes = Buffer.byteLength(JSON.stringify(entry.record));
    bytes += entry.bytes;
    entry.until = now() + ttl;
    return entry.record;
  }
  function cleanup() {
    for (const [id, entry] of entries) {
      if (entry.record.state === 'applying') continue;
      if (now() < entry.until) continue;
      if (entry.record.state === 'ready') replace(id, 'expired');
      else { bytes -= entry.bytes; entries.delete(id); }
    }
  }
  return Object.freeze({
    register(data) {
      cleanup();
      const record = immutable({ ...structuredClone(data), proposalId: randomUUID(),
        expiresAt: wallNow() + ttl, state: 'ready' });
      const size = Buffer.byteLength(JSON.stringify(record)) + 3; // Reserve ready → applying growth.
      if (entries.size >= maxProposals || bytes + size > maxBytes) throw new Error('Proposal capacity exceeded.');
      entries.set(record.proposalId, { record, bytes: size, until: now() + ttl });
      bytes += size;
      return record;
    },
    get(id) { cleanup(); return entries.get(id)?.record; },
    claim(id) {
      cleanup();
      const entry = entries.get(id);
      if (!entry || entry.record.state !== 'ready') return undefined;
      entry.record = immutable({ ...entry.record, state: 'applying' });
      return entry.record;
    },
    finish(id, state) {
      if (!['applied', 'failed'].includes(state) || entries.get(id)?.record.state !== 'applying') {
        throw new Error('Invalid proposal transition.');
      }
      return replace(id, state);
    },
    cleanup,
  });
}

export function createWorkspaceLocks() {
  const held = new Set();
  let exclusive = false;
  return Object.freeze({
    acquire(workspace) {
      if (exclusive || held.has(workspace)) return undefined;
      held.add(workspace);
      let released = false;
      return () => { if (!released) { released = true; held.delete(workspace); } };
    },
    acquireExclusive() {
      if (exclusive || held.size) return undefined;
      exclusive = true;
      return () => { exclusive = false; };
    },
  });
}

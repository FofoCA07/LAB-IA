import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { validProposalPath, readSelectedTextFiles, runProposalGit } from './change-proposal.js';
import { repositoryIdentity, same } from './proposal-safety.js';
import { createWorkspaceLocks } from './proposal-store.js';

const TTL = 600_000;
const reservation = 640 * 1024; // Covers worst-case JSON escaping of 32 KiB of text plus JS/UTF-8 copies.
const validId = (id) => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
const ensure = (value) => { if (!value) throw new Error('Invalid read action.'); };
const text = (value, max) => typeof value === 'string' && value.trim().length > 0
  && value.length <= max && !Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code <= 31 || (code >= 127 && code <= 159);
  });
const publicRecord = ({ actionId, agentId, agentName, type, projectName, reason, resources, state, createdAt, expiresAt }) =>
  ({ actionId, agentId, agentName, type, projectName, reason, resources: [...resources], state, createdAt, expiresAt });
const measure = (value) => JSON.stringify(value).length * 2 + Buffer.byteLength(JSON.stringify(value));

export function createActionStore({ maxActions = 64, maxBytes = 8 * 1024 * 1024,
  now = () => performance.now(), wallNow = Date.now, getWorkspaceStatus,
  git = runProposalGit, readFiles = readSelectedTextFiles, locks = createWorkspaceLocks() } = {}) {
  ensure(Number.isSafeInteger(maxActions) && maxActions > 0 && Number.isSafeInteger(maxBytes) && maxBytes > 0);
  const entries = new Map();
  let retained = 0;
  function resize(entry, reserved = false) {
    retained -= entry.bytes || 0;
    entry.bytes = measure(entry.record) + (reserved ? reservation : measure(entry.result ?? null));
    retained += entry.bytes;
  }
  function cleanup() {
    for (const [id, entry] of entries) {
      if (entry.record.state === 'running' || now() < entry.until) continue;
      if (entry.record.state === 'pending') {
        entry.record.state = 'expired';
        entry.result = undefined;
        entry.until = now() + TTL;
        resize(entry);
      } else { retained -= entry.bytes; entries.delete(id); }
    }
  }
  async function createReadAction(input, { beforePublish, expectedIdentity } = {}) {
    ensure(input && typeof input === 'object');
    ensure(beforePublish === undefined || typeof beforePublish === 'function');
    const { agentId, agentName, workspace, projectName, reason, paths } = input;
    ensure(text(agentId, 128) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agentId)
      && text(agentName, 160) && text(projectName, 200) && text(reason, 2000));
    ensure(Array.isArray(paths) && paths.length >= 1 && paths.length <= 20
      && new Set(paths).size === paths.length);
    const resources = Array.from(paths);
    ensure(resources.every(validProposalPath));
    ensure(typeof workspace === 'string' && isAbsolute(workspace));
    const canonical = await realpath(workspace);
    const identity = await repositoryIdentity(canonical, git, Date.now() + 10_000);
    ensure(expectedIdentity === undefined || same(identity, expectedIdentity));
    cleanup();
    const created = wallNow();
    const record = { actionId: randomUUID(), agentId, agentName, type: 'read', workspace: canonical,
      projectName, reason, resources, state: 'pending', createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + TTL).toISOString(), identity };
    const bytes = measure(record) + reservation;
    ensure(entries.size < maxActions && retained + bytes <= maxBytes);
    // Internal synchronous binding: a failed turn attachment leaves no visible action.
    if (beforePublish) ensure(beforePublish(publicRecord(record)) === undefined);
    entries.set(record.actionId, { record, bytes, until: now() + TTL });
    retained += bytes;
    return publicRecord(record);
  }
  async function decide(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 2 || !Object.hasOwn(body, 'actionId')
      || !Object.hasOwn(body, 'decision') || !validId(body.actionId)
      || !['approve_once', 'deny'].includes(body.decision)) {
      return { status: 400, body: { code: 'INVALID_REQUEST', error: 'Solicitud no válida.' } };
    }
    cleanup();
    const entry = entries.get(body.actionId);
    if (!entry || entry.record.state !== 'pending') {
      return { status: 409, body: { code: 'ACTION_UNAVAILABLE', error: 'La acción no está disponible.' } };
    }
    // Single-use claim is synchronous, before the first await (including workspace checks).
    entry.record.state = body.decision === 'deny' ? 'denied' : 'running';
    if (body.decision === 'deny') {
      resize(entry);
      return { status: 200, body: { state: 'denied' } };
    }
    const { record } = entry;
    const release = locks.acquire(record.workspace);
    const deadline = Date.now() + 10_000;
    async function checkpoint() {
      let timer;
      try {
        const status = await Promise.race([Promise.resolve().then(() => getWorkspaceStatus()),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error()), Math.max(1, deadline - Date.now())); })]);
        ensure(status.available && status.running && status.workspace === record.workspace);
        ensure(same(await repositoryIdentity(record.workspace, git, deadline), record.identity));
      } finally { clearTimeout(timer); }
    }
    try {
      ensure(release);
      await checkpoint();
      const contents = await readFiles(record.workspace, record.resources, deadline, git);
      await checkpoint();
      entry.result = contents;
      record.state = 'completed';
      resize(entry);
      ensure(retained <= maxBytes);
      return { status: 200, body: { state: 'completed', files: [...record.resources] } };
    } catch {
      entry.result = undefined;
      record.state = 'failed';
      resize(entry);
      return { status: 422, body: { state: 'failed', code: 'READ_FAILED', error: 'No se pudo completar la lectura autorizada.' } };
    } finally { release?.(); }
  }
  return Object.freeze({
    createReadAction, decide, cleanup,
    getAction(actionId) { cleanup(); const entry = entries.get(actionId); return entry ? publicRecord(entry.record) : null; },
    listActions() { cleanup(); return { actions: [...entries.values()].map(({ record }) => publicRecord(record)) }; },
    consumeCompletedReadResult(actionId) {
      cleanup();
      const entry = entries.get(actionId);
      if (entry?.record.state !== 'completed' || entry.result === undefined) return undefined;
      const result = entry.result;
      entry.result = undefined;
      resize(entry);
      return result;
    },
  });
}

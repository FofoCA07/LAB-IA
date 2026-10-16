import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const securityDefaults = Object.freeze({
  pairingTtlMs: 120_000,
  idleTimeoutMs: 1_800_000,
  absoluteTimeoutMs: 28_800_000,
  attemptWindowMs: 60_000,
  maxAttempts: 5,
  maxSessions: 64,
});

export const isSecurityToken = value => typeof value === 'string'
  && /^[A-Za-z0-9_-]{43}$/.test(value)
  && Buffer.from(value, 'base64url').toString('base64url') === value;
const digest = value => createHash('sha256').update(value).digest();
const token = () => randomBytes(32).toString('base64url');

// All authority is process-local. No import side effects, I/O or public records.
export function createSecurityStore({ now = () => performance.now(), wallNow = Date.now,
  idleTimeoutMs = securityDefaults.idleTimeoutMs,
  absoluteTimeoutMs = securityDefaults.absoluteTimeoutMs,
  maxSessions = securityDefaults.maxSessions } = {}) {
  if (![idleTimeoutMs, absoluteTimeoutMs, maxSessions].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('Invalid security store limits.');
  }
  let pairing;
  const sessions = new Map();
  let attempts = [];
  function discardPairing() { pairing?.hash.fill(0); pairing = undefined; }
  function cleanup() {
    const time = now();
    if (pairing && time >= pairing.until) discardPairing();
    for (const [key, session] of sessions) {
      if (time >= session.absoluteUntil || time >= session.idleUntil) sessions.delete(key);
    }
    attempts = attempts.filter(at => time - at < securityDefaults.attemptWindowMs);
  }
  function sessionEntry(sessionId) {
    cleanup();
    return isSecurityToken(sessionId) ? sessions.get(digest(sessionId).toString('hex')) : undefined;
  }
  function getSession(sessionId, { touch = true } = {}) {
    const session = sessionEntry(sessionId);
    if (!session) return null;
    if (touch) {
      session.lastActivityAt = wallNow();
      session.idleUntil = now() + idleTimeoutMs;
    }
    // Internal snapshot only; HTTP must explicitly select its public fields.
    return { csrfToken: session.csrfToken, createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt, expiresAt: session.expiresAt };
  }
  return Object.freeze({
    createPairing() {
      cleanup();
      const code = token();
      discardPairing(); // Explicit regeneration invalidates any previous code.
      pairing = { hash: digest(code), until: now() + securityDefaults.pairingTtlMs };
      return code;
    },
    pair(code) {
      cleanup();
      const time = now();
      if (attempts.length >= securityDefaults.maxAttempts) {
        return { status: 'limited', retryAfterSeconds: Math.max(1,
          Math.ceil((attempts[0] + securityDefaults.attemptWindowMs - time) / 1000)) };
      }
      attempts.push(time); // Global, bounded; cannot be reset by changing code or headers.
      if (!isSecurityToken(code) || !pairing || !timingSafeEqual(digest(code), pairing.hash)) {
        return { status: 'invalid' };
      }
      if (sessions.size >= maxSessions) return { status: 'unavailable' };
      const sessionId = token();
      const csrfToken = token();
      const created = wallNow();
      // Synchronous validation, consumption and session creation: no await gap.
      discardPairing();
      sessions.set(digest(sessionId).toString('hex'), { csrfToken, createdAt: created,
        lastActivityAt: created, expiresAt: created + absoluteTimeoutMs,
        absoluteUntil: time + absoluteTimeoutMs, idleUntil: time + idleTimeoutMs });
      return { status: 'paired', sessionId };
    },
    getSession,
    validateCsrf(sessionId, supplied) {
      const session = sessionEntry(sessionId);
      return Boolean(session && isSecurityToken(supplied)
        && timingSafeEqual(digest(supplied), digest(session.csrfToken)));
    },
    revokeSession(sessionId) {
      cleanup();
      return isSecurityToken(sessionId) && sessions.delete(digest(sessionId).toString('hex'));
    },
    cleanup,
  });
}

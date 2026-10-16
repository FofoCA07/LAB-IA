import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecurityStore, isSecurityToken, securityDefaults } from './security-store.js';

function fixture(options = {}) {
  let time = 0;
  const store = createSecurityStore({ now: () => time, wallNow: () => 1000 + time, ...options });
  return { store, setTime(value) { time = value; } };
}
function issued(store) {
  const code = store.createPairing();
  const result = store.pair(code);
  assert.equal(result.status, 'paired');
  return result.sessionId;
}

test('pairing is a fresh 256-bit canonical token; no authority serializes from store', () => {
  const { store } = fixture();
  const a = store.createPairing(); const b = store.createPairing();
  assert.ok(isSecurityToken(a) && isSecurityToken(b));
  assert.equal(Buffer.from(a, 'base64url').length, 32);
  assert.notEqual(a, b);
  assert.equal(JSON.stringify(store), '{}');
  assert.equal(store.pair(a).status, 'invalid');
  const result = store.pair(b);
  assert.equal(result.status, 'paired');
  assert.notEqual(result.sessionId, b);
  assert.notEqual(store.getSession(result.sessionId).csrfToken, result.sessionId);
  assert.equal(JSON.stringify(store), '{}');
});

test('incorrect code does not consume pairing; successful code can only be used once', () => {
  const { store } = fixture(); const code = store.createPairing();
  assert.equal(store.pair('A'.repeat(43)).status, 'invalid');
  assert.equal(store.pair(code).status, 'paired');
  assert.equal(store.pair(code).status, 'invalid');
});

for (const time of [119_999, 120_000, 120_001]) {
  test(`pairing TTL exact boundary ${time}ms`, () => {
    const f = fixture(); const code = f.store.createPairing(); f.setTime(time);
    assert.equal(f.store.pair(code).status, time < 120_000 ? 'paired' : 'invalid');
  });
}

test('two concurrent redeemers have exactly one winner and one session', async () => {
  const { store } = fixture(); const code = store.createPairing();
  const results = await Promise.all([1, 2].map(() => Promise.resolve().then(() => store.pair(code))));
  assert.deepEqual(results.map(result => result.status).sort(), ['invalid', 'paired']);
});

test('rolling global rate limit survives regenerated codes and resets at window boundary', () => {
  const f = fixture();
  for (let i = 0; i < 5; i++) assert.equal(f.store.pair('A'.repeat(43)).status, 'invalid');
  const code = f.store.createPairing();
  assert.deepEqual(f.store.pair(code), { status: 'limited', retryAfterSeconds: 60 });
  f.setTime(59_999); assert.equal(f.store.pair(code).status, 'limited');
  f.setTime(60_000); assert.equal(f.store.pair(code).status, 'paired');
});

test('session timestamps are detached and idle deadline moves only on accepted activity', () => {
  const f = fixture(); const id = issued(f.store);
  const first = f.store.getSession(id, { touch: false });
  assert.equal(first.createdAt, 1000);
  assert.equal(first.lastActivityAt, 1000);
  assert.equal(first.expiresAt, 1000 + securityDefaults.absoluteTimeoutMs);
  first.csrfToken = 'changed';
  f.setTime(500); const next = f.store.getSession(id);
  assert.equal(next.createdAt, 1000); assert.equal(next.lastActivityAt, 1500);
  assert.notEqual(next.csrfToken, 'changed');
  f.setTime(1_800_000); assert.ok(f.store.getSession(id, { touch: false }));
  f.setTime(1_800_500); assert.equal(f.store.getSession(id), null);
});

test('default idle expiry occurs exactly at 30 minutes', () => {
  const f = fixture(); const id = issued(f.store);
  f.setTime(1_799_999); assert.ok(f.store.getSession(id, { touch: false }));
  f.setTime(1_800_000); assert.equal(f.store.getSession(id), null);
});

test('absolute expiry occurs at 8 hours even with activity', () => {
  const f = fixture(); const id = issued(f.store);
  for (let time = 1_000_000; time < 28_800_000; time += 1_000_000) {
    f.setTime(time); assert.ok(f.store.getSession(id));
  }
  f.setTime(28_799_999); assert.ok(f.store.getSession(id));
  f.setTime(28_800_000); assert.equal(f.store.getSession(id), null);
});

test('CSRF is session-bound, expiry-aware and does not refresh idle deadline', () => {
  const f = fixture(); const a = issued(f.store); const b = issued(f.store);
  const csrf = f.store.getSession(a).csrfToken;
  assert.equal(f.store.validateCsrf(a, csrf), true);
  assert.equal(f.store.validateCsrf(b, csrf), false);
  for (const value of [undefined, '', 'bad', 'A'.repeat(43), [], {}]) {
    assert.equal(f.store.validateCsrf(a, value), false);
  }
  f.setTime(1_799_999); assert.equal(f.store.validateCsrf(a, csrf), true);
  f.setTime(1_800_000); assert.equal(f.store.validateCsrf(a, csrf), false);
});

test('revocation and restart invalidate sessions and pairing', () => {
  const { store } = fixture(); const id = issued(store); const code = store.createPairing();
  const next = createSecurityStore();
  assert.equal(next.getSession(id), null); assert.equal(next.pair(code).status, 'invalid');
  assert.equal(store.revokeSession(id), true);
  assert.equal(store.getSession(id), null); assert.equal(store.revokeSession(id), false);
});

test('capacity is bounded and expired sessions release capacity', () => {
  const f = fixture({ maxSessions: 1 }); issued(f.store);
  const code = f.store.createPairing(); assert.equal(f.store.pair(code).status, 'unavailable');
  f.setTime(1_800_000); const fresh = f.store.createPairing();
  assert.equal(f.store.pair(fresh).status, 'paired');
});

test('invalid token types and noncanonical encodings never authorize', () => {
  const { store } = fixture();
  for (const token of [null, undefined, 1, [], {}, 'x', 'A'.repeat(44), 'A'.repeat(42) + 'B']) {
    assert.equal(isSecurityToken(token), false);
    assert.equal(store.getSession(token), null);
    assert.equal(store.validateCsrf(token, token), false);
  }
  assert.throws(() => createSecurityStore({ maxSessions: 0 }));
});

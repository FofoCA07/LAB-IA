import test from 'node:test';
import assert from 'node:assert/strict';
import { createProposalStore, createWorkspaceLocks, validProposalId } from './proposal-store.js';

test('immutable snapshots, UUID, atomic single-use and terminal redaction', () => {
  const store = createProposalStore(); const input = { paths: ['README.md'], patch: 'private' };
  const record = store.register(input); input.paths.push('other');
  assert.ok(validProposalId(record.proposalId)); assert.ok(Object.isFrozen(record.paths));
  assert.deepEqual(record.paths, ['README.md']); assert.throws(() => record.paths.push('other'));
  assert.equal(store.claim(record.proposalId).state, 'applying');
  assert.equal(record.state, 'ready'); assert.equal(store.claim(record.proposalId), undefined);
  store.finish(record.proposalId, 'failed');
  assert.equal(store.get(record.proposalId).state, 'failed');
  assert.equal(store.get(record.proposalId).patch, undefined);
  assert.throws(() => store.finish(record.proposalId, 'applied'));
});
test('TTL expires at ten minutes, does not expire running apply, cleanup drops receipts', () => {
  let time = 0; const store = createProposalStore({ now: () => time, wallNow: () => 1000 });
  const first = store.register({ patch: 'secret' }); const running = store.register({});
  assert.equal(first.expiresAt, 601000); store.claim(running.proposalId);
  time = 600000; assert.equal(store.get(first.proposalId).state, 'expired');
  assert.equal(store.claim(first.proposalId), undefined);
  assert.equal(store.get(running.proposalId).state, 'applying');
  time += 600000; store.cleanup(); assert.equal(store.get(first.proposalId), undefined);
});
test('count and aggregate byte limits fail closed', () => {
  const count = createProposalStore({ maxProposals: 1 }); count.register({}); assert.throws(() => count.register({}));
  const bytes = createProposalStore({ maxBytes: 200 }); assert.throws(() => bytes.register({ patch: 'x'.repeat(200) }));
});
test('workspace locks and activation exclusive lock share coordination', () => {
  const locks = createWorkspaceLocks(); const release = locks.acquire('/a');
  assert.equal(locks.acquire('/a'), undefined); assert.equal(locks.acquireExclusive(), undefined);
  const other = locks.acquire('/b'); other(); release(); release();
  const exclusive = locks.acquireExclusive(); assert.equal(locks.acquire('/a'), undefined);
  exclusive(); assert.ok(locks.acquire('/a'));
});

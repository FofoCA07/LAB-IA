import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTurnStore, isTurnId, TURN_STATES, TURN_ERROR } from './turn-store.js';
const input = { conversationId: 1, agentId: 'senior-developer', userMessageId: 3 };

test('backend UUID, bounded metadata, detached snapshots and no private payload', () => {
  const store = createTurnStore();
  const turn = store.create({ ...input, turnId: 'client', state: 'completed', prompt: 'PRIVATE' });
  assert.ok(isTurnId(turn.turnId));
  assert.equal(turn.state, 'processing'); assert.equal(turn.actionId, null);
  assert.equal(JSON.stringify(turn).includes('PRIVATE'), false);
  turn.state = 'failed'; assert.equal(store.get(turn.turnId).state, 'processing');
  assert.equal(TURN_STATES.length, 7);
});

test('explicit completed/failed transitions, fixed safe error, terminals never revive', () => {
  for (const state of ['completed', 'failed']) {
    const store = createTurnStore(); const turn = store.create(input);
    assert.throws(() => store.transition(turn.turnId, 'continuing'));
    assert.throws(() => store.transition(turn.turnId, 'made-up'));
    if (state === 'completed') assert.throws(() => store.transition(turn.turnId, state, { content: 'PRIVATE' }));
    const terminal = store.transition(turn.turnId, state, state === 'completed' ? { messageId: 5 } : null);
    assert.equal(terminal.state, state);
    if (state === 'failed') assert.deepEqual(terminal.error, TURN_ERROR);
    for (const next of TURN_STATES) assert.throws(() => store.transition(turn.turnId, next));
    assert.equal(store.findActive(1), null);
    assert.throws(() => store.create(input));
  }
});

test('one active turn per conversation, independent conversations', () => {
  const store = createTurnStore(); store.create(input);
  assert.throws(() => store.create({ ...input, userMessageId: 4 }));
  assert.equal(store.create({ ...input, conversationId: 2 }).state, 'processing');
});

test('future internal action/continuation authority and transitions are bound and immutable', () => {
  for (const final of ['completed', 'failed', 'denied', 'expired']) {
    const store = createTurnStore(); const turn = store.create(input); const actionId = randomUUID();
    assert.throws(() => store.attachAction(turn.turnId, actionId));
    store.transition(turn.turnId, 'awaiting_permission');
    assert.throws(() => store.attachAction(turn.turnId, 'bad'));
    store.attachAction(turn.turnId, actionId);
    assert.throws(() => store.attachAction(turn.turnId, randomUUID()));
    assert.equal(store.getForContinuation(turn.turnId, 2, actionId), null);
    assert.equal(store.getForContinuation(turn.turnId, 1, randomUUID()), null);
    assert.equal(store.getForContinuation(turn.turnId, 1, actionId).actionId, actionId);
    if (['completed', 'failed'].includes(final)) store.transition(turn.turnId, 'continuing');
    store.transition(turn.turnId, final, final === 'completed' ? { messageId: 7 } : null);
    assert.equal(store.getForContinuation(turn.turnId, 1, actionId), null);
    assert.throws(() => store.transition(turn.turnId, 'processing'));
  }
});

test('active TTL, terminal retention and cleanup release capacity without reviving authority', () => {
  let time = 0; const store = createTurnStore({ now: () => time, ttlMs: 100, retentionMs: 50, maxTurns: 1 });
  const turn = store.create(input);
  time = 90; store.transition(turn.turnId, 'awaiting_permission');
  assert.equal(store.get(turn.turnId).expiresAt, 100);
  time = 100; assert.equal(store.get(turn.turnId).state, 'expired');
  assert.equal(store.findActive(1), null);
  assert.throws(() => store.transition(turn.turnId, 'continuing'));
  time = 150; store.cleanup(); assert.equal(store.get(turn.turnId), null);
  assert.deepEqual(store.stats(), { count: 0, reservedBytes: 0 });
  store.create(input);
});

test('count, approximate RAM, metadata and result limits fail closed', () => {
  for (const limits of [{ maxTurns: 1 }, { maxBytes: 2048 }]) {
    const store = createTurnStore(limits); const turn = store.create(input);
    assert.throws(() => store.create({ ...input, conversationId: 2 }));
    store.transition(turn.turnId, 'completed', { messageId: 8 });
    assert.ok(store.stats().reservedBytes <= 2048);
  }
  assert.throws(() => createTurnStore({ ttlMs: 0 }));
  const store = createTurnStore();
  assert.throws(() => store.create({ ...input, agentId: 'x'.repeat(129) }));
  assert.throws(() => store.create({ ...input, conversationId: -1 }));
});

test('backend restart discards active turns and continuation authority, without reconstruction', () => {
  const before = createTurnStore(); const turn = before.create(input);
  before.transition(turn.turnId, 'awaiting_permission');
  before.attachAction(turn.turnId, randomUUID());
  const restarted = createTurnStore();
  assert.equal(restarted.get(turn.turnId), null);
  assert.equal(restarted.findActive(1), null);
  assert.ok(restarted.create(input).turnId !== turn.turnId);
});

test('completion and synchronous persistence stay consistent across TTL boundary; expiry prevents writes', () => {
  let time = 0;
  const store = createTurnStore({ now: () => time, ttlMs: 100 });
  const turn = store.create(input);
  store.completeWithPersistence(turn.turnId, () => { time = 101; return 7; });
  assert.equal(store.get(turn.turnId).state, 'completed');
  const next = store.create({ ...input, userMessageId: 4 });
  time = 201;
  assert.throws(() => store.completeWithPersistence(next.turnId, () => assert.fail('must not persist')));
  assert.equal(store.get(next.turnId).state, 'expired');
});

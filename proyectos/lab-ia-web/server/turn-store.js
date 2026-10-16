import { randomUUID } from 'node:crypto';

export const isTurnId = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const TURN_STATES = Object.freeze(['processing', 'awaiting_permission', 'continuing',
  'completed', 'denied', 'expired', 'failed']);
const active = new Set(['processing', 'awaiting_permission', 'continuing']);
const transitions = {
  processing: ['completed', 'failed', 'awaiting_permission', 'expired'],
  awaiting_permission: ['continuing', 'denied', 'expired'],
  continuing: ['completed', 'failed', 'expired'],
};
export const TURN_ERROR = Object.freeze({ code: 'CHAT_RESPONSE_FAILED',
  message: 'No se pudo generar o guardar la respuesta. Intenta de nuevo más tarde.' });

// RAM only: a new store after restart contains no turns or continuation authority.
// Results reference persisted assistant messages; no prompts or model bodies are retained.
// Reserve 2 KiB per bounded metadata entry, including index/terminal growth allowance.
export function createTurnStore({ now = Date.now, ttlMs = 600_000, retentionMs = 600_000,
  maxTurns = 1000, maxBytes = 2_048_000 } = {}) {
  if (![ttlMs, retentionMs, maxTurns, maxBytes].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Invalid turn store limits');
  }
  const turns = new Map();
  const copy = value => value ? structuredClone(value) : null;
  function cleanup() {
    const time = now();
    for (const [id, turn] of turns) {
      if (active.has(turn.state) && time >= turn.expiresAt) {
        turn.state = 'expired'; turn.updatedAt = turn.expiresAt;
        turn.expiresAt += retentionMs;
      }
      if (!active.has(turn.state) && time >= turn.expiresAt) turns.delete(id);
    }
  }
  function get(turnId) { cleanup(); return copy(turns.get(turnId)); }
  function findActive(conversationId) {
    cleanup();
    return copy([...turns.values()].find(turn => turn.conversationId === conversationId && active.has(turn.state)));
  }
  function findForMessage(conversationId, userMessageId) {
    cleanup();
    return copy([...turns.values()].find(turn => turn.conversationId === conversationId && turn.userMessageId === userMessageId));
  }
  function create({ conversationId, agentId, userMessageId }) {
    cleanup();
    if (![conversationId, userMessageId].every(id => Number.isSafeInteger(id) && id > 0)
      || typeof agentId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agentId) || agentId.length > 128) {
      throw new Error('Invalid turn metadata');
    }
    if (findActive(conversationId) || findForMessage(conversationId, userMessageId)) throw new Error('Turn conflict');
    if (turns.size >= maxTurns || (turns.size + 1) * 2048 > maxBytes) throw new Error('Turn capacity');
    const time = now();
    const turn = { turnId: randomUUID(), conversationId, agentId, state: 'processing',
      createdAt: time, updatedAt: time, expiresAt: time + ttlMs, userMessageId,
      actionId: null, result: null, error: null };
    turns.set(turn.turnId, turn);
    return copy(turn);
  }
  function applyTransition(turnId, state, result = null) {
    const turn = turns.get(turnId);
    if (!turn || !transitions[turn.state]?.includes(state)) throw new Error('Invalid turn transition');
    if (state === 'completed' && (!result || Object.keys(result).length !== 1
      || !Number.isSafeInteger(result.messageId) || result.messageId <= 0)) throw new Error('Invalid turn result');
    if (state !== 'completed' && result !== null) throw new Error('Invalid turn result');
    turn.state = state; turn.updatedAt = now();
    // Active transitions never extend the original deadline.
    if (!active.has(state)) turn.expiresAt = turn.updatedAt + retentionMs;
    turn.result = state === 'completed' ? { messageId: result.messageId } : null;
    turn.error = state === 'failed' ? { ...TURN_ERROR } : null;
    return copy(turn);
  }
  function transition(turnId, state, result = null) {
    cleanup();
    return applyTransition(turnId, state, result);
  }
  // Validate expiry before synchronous persistence. No await or cleanup may split
  // assistant commit from its terminal state (even at the TTL boundary).
  function completeWithPersistence(turnId, persist) {
    cleanup();
    const turn = turns.get(turnId);
    if (!turn || !['processing', 'continuing'].includes(turn.state)) throw new Error('Invalid turn completion');
    const messageId = persist();
    return applyTransition(turnId, 'completed', { messageId });
  }
  function attachAction(turnId, actionId) {
    cleanup();
    const turn = turns.get(turnId);
    if (!turn || turn.state !== 'awaiting_permission' || turn.actionId !== null || !isTurnId(actionId)) {
      throw new Error('Invalid turn action');
    }
    turn.actionId = actionId; turn.updatedAt = now();
    return copy(turn);
  }
  function getForContinuation(turnId, conversationId, actionId) {
    const turn = get(turnId);
    if (!turn || turn.conversationId !== conversationId || turn.state !== 'awaiting_permission'
      || !turn.actionId || turn.actionId !== actionId) return null;
    return turn;
  }
  return { create, get, findActive, findForMessage, transition, completeWithPersistence, attachAction, getForContinuation, cleanup,
    stats() { cleanup(); return { count: turns.size, reservedBytes: turns.size * 2048 }; } };
}

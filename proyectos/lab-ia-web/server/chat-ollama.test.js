import test from 'node:test';
import assert from 'node:assert/strict';
import { generateChatReply, maxOllamaResponseBytes } from './chat-ollama.js';
const messages = [{ role: 'system', content: 'PRIVATE_SYSTEM' }, { role: 'user', content: 'PRIVATE_USER' }];
const envelope = overrides => ({ model: 'qwen3:8b', done: true, message: { role: 'assistant', content: 'Normal text reply' }, ...overrides });
const reply = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const call = (fetchImpl, options = {}) => generateChatReply({ messages, timeoutMs: 1000, ...options }, { fetchImpl });
const safeReject = promise => assert.rejects(promise, error => {
  assert.deepEqual(Object.keys(error).sort(), ['code', 'error']);
  assert.doesNotMatch(JSON.stringify(error), /PRIVATE|127\.0\.0\.1|stack|SQL/);
  return true;
});
test('normal text chat uses fixed backend model, no format/tools, stream false and keep alive', async () => {
  assert.equal(await call(async (url, request) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(request.redirect, 'error');
    assert.deepEqual(JSON.parse(request.body), { model: 'qwen3:8b', messages, stream: false, keep_alive: '1h' });
    return reply(envelope({ message: { role: 'assistant', content: 'Normal text reply', thinking: 'PRIVATE_THINKING' } }));
  }), 'Normal text reply');
});
test('transport, HTTP, malformed and tool responses fail safely', async () => {
  await safeReject(call(async () => { throw Error('PRIVATE_URL'); }));
  await safeReject(call(async () => new Response('PRIVATE_STDERR', { status: 500 })));
  await safeReject(call(async () => new Response('<html>PRIVATE</html>')));
  for (const value of [envelope({ done: false }), envelope({ model: 'other' }), envelope({ error: 'PRIVATE' }),
    envelope({ message: { role: 'user', content: 'PRIVATE' } }), envelope({ message: { role: 'assistant', content: ' ' } }),
    envelope({ message: { role: 'assistant', content: 'ok', tool_calls: [{ function: { name: 'read' } }] } })]) {
    await safeReject(call(async () => reply(value)));
  }
});
test('response headers and streamed bytes are bounded', async () => {
  await safeReject(call(async () => new Response('x', { headers: { 'Content-Length': String(maxOllamaResponseBytes + 1) } })));
  await safeReject(call(async () => new Response('x'.repeat(maxOllamaResponseBytes + 1))));
});
test('timeout bounds stalled fetch and stalled response body', async () => {
  let signal;
  await safeReject(call(async (_, request) => { signal = request.signal; return new Promise(() => {}); }, { timeoutMs: 15 }));
  assert.equal(signal.aborted, true);
  await safeReject(call(async () => new Response(new ReadableStream({ start() {} })), { timeoutMs: 15 }));
});
test('invalid timeout and oversized context never call fetch', async () => {
  const never = async () => { assert.fail('must not fetch'); };
  for (const timeoutMs of [0, Infinity, 120001]) await safeReject(call(never, { timeoutMs }));
  await safeReject(call(never, { messages: [{ role: 'user', content: 'x'.repeat(1024 * 1024) }] }));
});

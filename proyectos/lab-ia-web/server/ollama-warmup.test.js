import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOllamaWarmup, waitForOllamaWarmup } from './ollama-warmup.js';

const reply = () => new Response(JSON.stringify({ model: 'qwen3:8b', done: true,
  message: { role: 'assistant', content: '' }, done_reason: 'load' }), { headers: { 'content-type': 'application/json' } });
test('startup once, exact empty body, ready state and shared promise', async () => {
  const states = []; let calls = 0; let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const warmup = createOllamaWarmup({ onState: (state) => states.push(state), fetchImpl: async (url, request) => {
    calls++; assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(request.method, 'POST'); assert.equal(request.redirect, 'error');
    assert.deepEqual(JSON.parse(request.body), { model: 'qwen3:8b', messages: [], stream: false, keep_alive: '1h' });
    await gate; return reply();
  } });
  assert.equal(warmup.state, 'idle'); const first = warmup.start();
  assert.equal(warmup.state, 'loading'); assert.equal(warmup.start(), first);
  assert.equal(warmup.ensureReady(), first); assert.equal(warmup.ensureReady(), first);
  const one = waitForOllamaWarmup(warmup, Date.now() + 1000);
  const two = waitForOllamaWarmup(warmup, Date.now() + 1000);
  release(); await Promise.all([one, two]);
  assert.equal(calls, 1); assert.equal(warmup.state, 'ready'); assert.deepEqual(states, ['loading', 'ready']);
  assert.equal(warmup.ensureReady(), first);
});
test('failure safe, observed at startup, subsequent request retries only once', async () => {
  let calls = 0; const states = [];
  const warmup = createOllamaWarmup({ onState: (state) => states.push(state), fetchImpl: async () => {
    if (++calls === 1) throw new Error('PRIVATE_PROMPT_RESPONSE_STDERR');
    return reply();
  } });
  void warmup.start(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(warmup.state, 'failed'); assert.equal(calls, 1);
  await Promise.all([waitForOllamaWarmup(warmup, Date.now() + 1000), waitForOllamaWarmup(warmup, Date.now() + 1000)]);
  assert.equal(calls, 2); assert.equal(warmup.state, 'ready');
  assert.deepEqual(states, ['loading', 'failed', 'loading', 'ready']);
});
test('HTTP/private body/malformed response never escapes or becomes ready', async () => {
  for (const response of [new Response('PRIVATE', { status: 503 }), new Response('PRIVATE'),
    new Response(JSON.stringify({ model: 'qwen3:8b', done: true, error: 'PRIVATE' }))]) {
    const states = []; const warmup = createOllamaWarmup({ fetchImpl: async () => response, onState: (state) => states.push(state) });
    await assert.rejects(warmup.start(), (error) => {
      assert.deepEqual(error, { code: 'OLLAMA_UNAVAILABLE', error: 'Ollama no está disponible.' });
      assert.ok(Object.isFrozen(error)); assert.ok(!JSON.stringify(error).includes('PRIVATE')); return true;
    });
    assert.equal(warmup.state, 'failed'); assert.deepEqual(states, ['loading', 'failed']);
  }
});
test('request deadline does not cancel shared startup, another request can finish', async () => {
  let release; let signal;
  const warmup = createOllamaWarmup({ fetchImpl: async (_, request) => {
    signal = request.signal; await new Promise((resolve) => { release = resolve; }); return reply();
  } });
  warmup.start();
  const other = waitForOllamaWarmup(warmup, Date.now() + 1000);
  await assert.rejects(waitForOllamaWarmup(warmup, Date.now() + 15), (error) => error.code === 'OLLAMA_TIMEOUT');
  assert.equal(signal.aborted, false); assert.equal(warmup.state, 'loading'); release(); await other;
  assert.equal(warmup.state, 'ready');
});
test('expired deadline never starts warmup', async () => {
  const warmup = createOllamaWarmup({ fetchImpl: () => assert.fail('must not fetch') });
  await assert.rejects(waitForOllamaWarmup(warmup, Date.now() - 1), (error) => error.code === 'OLLAMA_TIMEOUT');
  assert.equal(warmup.state, 'idle');
});
test('warmup has a bounded timeout even when fetch ignores abort', async () => {
  const warmup = createOllamaWarmup({ timeoutMs: 15, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(warmup.start(), (error) => error.code === 'OLLAMA_UNAVAILABLE');
  assert.equal(warmup.state, 'failed');
});
test('listen callback triggers startup without awaiting it and injects same warmup', async () => {
  const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  assert.match(source, /server\.listen\([\s\S]*void ollamaWarmup\.start\(\)/);
  assert.equal((source.match(/ollamaWarmup\.start\(\)/g) ?? []).length, 1);
  assert.match(source, /waitForWarmup: \(deadline\) => waitForOllamaWarmup\(ollamaWarmup, deadline\)/);
});


test('next proposal rewarms after the one-hour confirmed residence window', async () => {
  let time = 0; let calls = 0;
  const warmup = createOllamaWarmup({ now: () => time, fetchImpl: async () => { calls++; return reply(); } });
  await warmup.start(); time = 3_599_999; await warmup.ensureReady(); assert.equal(calls, 1);
  time = 3_600_000; await warmup.ensureReady(); assert.equal(calls, 2); assert.equal(warmup.state, 'ready');
});

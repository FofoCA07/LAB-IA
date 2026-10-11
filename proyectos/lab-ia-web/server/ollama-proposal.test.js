import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOllamaProposal, ollamaProposalConfig, maxOllamaResponseBytes } from './ollama-proposal.js';

const privateText = 'PRIVATE_REQUEST_MESSAGES_PATCH_CONTENT';
const messages = [{ role: 'system', content: privateText }, { role: 'user', content: privateText }];
const options = () => ({ messages, timeoutMs: 1000 });
const chat = (overrides = {}) => ({ model: 'qwen3:8b', done: true,
  message: { role: 'assistant', content: '{"summary":"ok"}' }, ...overrides });
const reply = (value = chat(), init = {}) => new Response(JSON.stringify(value), {
  headers: { 'Content-Type': 'application/json' }, ...init,
});
const call = (fetchImpl, overrides = {}) => generateOllamaProposal({ ...options(), ...overrides }, { fetchImpl });
async function rejectsSafely(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    assert.deepEqual(Object.keys(error).sort(), ['code', 'error']);
    assert.equal(typeof error.error, 'string');
    assert.equal(Object.isFrozen(error), true);
    const serialized = JSON.stringify(error);
    for (const value of [privateText, 'PRIVATE_STDERR', 'PRIVATE_STDOUT', 'PRIVATE_RESPONSE']) {
      assert.equal(serialized.includes(value), false);
    }
    return true;
  });
}

test('fixed local configuration and minimal JSON request, without tools', async () => {
  const before = structuredClone(messages);
  let calls = 0;
  const result = await call(async (url, request) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    assert.equal(request.headers['Content-Type'], 'application/json');
    assert.ok(request.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(request.body), { model: 'qwen3:8b', messages, stream: false, format: 'json' });
    return reply(chat({ message: { role: 'assistant', content: '  generated text\n', thinking: privateText } }));
  });
  assert.equal(result, '  generated text\n');
  assert.equal(calls, 1);
  assert.deepEqual(messages, before);
  assert.deepEqual(ollamaProposalConfig, { baseUrl: 'http://127.0.0.1:11434', model: 'qwen3:8b' });
});

test('passes the official JSON schema format field', async () => {
  const format = { type: 'object', properties: { summary: { type: 'string' } },
    required: ['summary'], additionalProperties: false };
  await call(async (_, request) => {
    assert.deepEqual(JSON.parse(request.body).format, format);
    return reply();
  }, { format });
});

test('timeout aborts even when fetch does not settle', async () => {
  let signal;
  await rejectsSafely(call(async (_, request) => {
    signal = request.signal;
    return new Promise(() => {});
  }, { timeoutMs: 15 }), 'OLLAMA_TIMEOUT');
  assert.equal(signal.aborted, true);
});

test('deadline is enforced before any request', async () => {
  await rejectsSafely(call(() => assert.fail('must not fetch'), { deadline: Date.now() - 1 }), 'OLLAMA_TIMEOUT');
});

test('deadline and timeout use the earlier budget', async () => {
  await rejectsSafely(call(() => new Promise(() => {}), {
    deadline: Date.now() + 15, timeoutMs: 1000,
  }), 'OLLAMA_TIMEOUT');
});

test('timeout also covers a stalled response body', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    headers: { 'content-type': 'application/json' },
  });
  await rejectsSafely(call(async () => response, { timeoutMs: 15 }), 'OLLAMA_TIMEOUT');
  assert.equal(cancelled, true);
});

test('network errors never escape', async () => {
  await rejectsSafely(call(async () => { throw new Error(privateText + 'PRIVATE_STDERR PRIVATE_STDOUT'); }),
    'OLLAMA_UNAVAILABLE');
});

test('non-2xx rejects without consuming private error body', async () => {
  await rejectsSafely(call(async () => reply({ error: privateText }, { status: 500 })), 'OLLAMA_UNAVAILABLE');
});

test('invalid JSON does not escape', async () => {
  await rejectsSafely(call(async () => new Response(privateText, {
    headers: { 'content-type': 'application/json' },
  })), 'OLLAMA_BAD_RESPONSE');
});

for (const [name, value] of [
  ['null', null], ['missing message', { done: true }], ['unfinished', chat({ done: false })],
  ['wrong model', chat({ model: 'other' })], ['server error', chat({ error: privateText })],
  ['wrong role', chat({ message: { role: 'user', content: privateText } })],
  ['non-string content', chat({ message: { role: 'assistant', content: { privateText } } })],
  ['empty content', chat({ message: { role: 'assistant', content: '  ' } })],
  ['tool invocation', chat({ message: { role: 'assistant', content: privateText, tool_calls: [{}] } })],
]) {
  test(`invalid chat structure: ${name}`, async () => {
    await rejectsSafely(call(async () => reply(value)), 'OLLAMA_BAD_RESPONSE');
  });
}

test('rejects non-JSON content type', async () => {
  await rejectsSafely(call(async () => reply(chat(), { headers: { 'content-type': 'text/html' } })),
    'OLLAMA_BAD_RESPONSE');
});

test('accepts absent Content-Type and JSON charset', async () => {
  for (const headers of [{}, { 'content-type': 'application/json; charset=utf-8' }]) {
    const response = new Response(JSON.stringify(chat()));
    response.headers.delete('content-type');
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    assert.equal(await call(async () => response), chat().message.content);
  }
});

test('response byte limit is enforced without Content-Length', async () => {
  await rejectsSafely(call(async () => reply(chat({ message: {
    role: 'assistant', content: 'é'.repeat(maxOllamaResponseBytes / 2),
  } }))), 'OLLAMA_RESPONSE_TOO_LARGE');
});

test('oversized Content-Length is rejected before parsing', async () => {
  await rejectsSafely(call(async () => reply(chat(), { headers: {
    'content-type': 'application/json', 'content-length': String(maxOllamaResponseBytes + 1),
  } })), 'OLLAMA_RESPONSE_TOO_LARGE');
});

test('invalid UTF-8 is rejected safely', async () => {
  await rejectsSafely(call(async () => new Response(new Uint8Array([0xff]), {
    headers: { 'content-type': 'application/json' },
  })), 'OLLAMA_BAD_RESPONSE');
});

test('message extensions and tool roles cannot be sent', async () => {
  for (const message of [{ role: 'tool', content: privateText },
    { role: 'user', content: privateText, tools: [] }]) {
    await rejectsSafely(call(() => assert.fail('must not fetch'), { messages: [message] }), 'OLLAMA_BAD_RESPONSE');
  }
});

test('requires an explicit valid budget and supported format', async () => {
  for (const overrides of [{ timeoutMs: undefined }, { timeoutMs: 0 }, { deadline: NaN }, { format: 'xml' }]) {
    await rejectsSafely(call(() => assert.fail('must not fetch'), overrides), 'OLLAMA_BAD_RESPONSE');
  }
});

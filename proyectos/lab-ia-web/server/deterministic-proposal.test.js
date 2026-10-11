import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDeterministicProposal, deterministicProposalLimits } from './deterministic-proposal.js';
import { generateOllamaProposal } from './ollama-proposal.js';

const privateRequest = 'PRIVATE_REQUEST';
const privateContent = 'PRIVATE_CONTENT\r\nexact last line';
const privateResponse = 'PRIVATE_RAW_RESPONSE';
const proposedContent = 'PRIVATE_PROPOSED_CONTENT';
const input = (overrides = {}) => ({ request: privateRequest,
  files: [{ path: 'README.md', content: privateContent }], deadline: Date.now() + 5000, ...overrides });
const proposal = (overrides = {}) => ({ summary: 'Actualizar texto.',
  files: [{ path: 'README.md', content: proposedContent }], ...overrides });
const run = (data = input(), value = proposal()) => generateDeterministicProposal(data, {
  generate: async () => JSON.stringify(value),
});
async function rejectsSafely(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    assert.deepEqual(Object.keys(error).sort(), ['code', 'error']);
    assert.equal(Object.isFrozen(error), true);
    assert.equal(typeof error.error, 'string');
    for (const secret of [privateRequest, privateContent, proposedContent, privateResponse, 'PRIVATE_STDERR']) {
      assert.equal(JSON.stringify(error).includes(secret), false);
    }
    return true;
  });
}
async function rejectsBeforeModel(data, code) {
  let called = false;
  await rejectsSafely(generateDeterministicProposal(data, {
    generate: async () => { called = true; return JSON.stringify(proposal()); },
  }), code);
  assert.equal(called, false);
}

test('exact system/user, complete-content instructions, no metadata and exact new schema', async () => {
  const data = input({ request: '  ' + privateRequest + '\r\n', files: [
    { path: 'README.md', content: privateContent }, { path: 'src/a.txt', content: 'other\r\n' },
  ] });
  const before = structuredClone(data);
  const result = await generateDeterministicProposal(data, { generate: async (args) => {
    assert.deepEqual(Object.keys(args).sort(), ['deadline', 'format', 'messages']);
    assert.equal(args.deadline, data.deadline);
    assert.deepEqual(args.messages.map(({ role }) => role), ['system', 'user']);
    assert.equal(args.messages.length, 2);
    for (const message of args.messages) assert.deepEqual(Object.keys(message).sort(), ['content', 'role']);
    assert.deepEqual(JSON.parse(args.messages[1].content), { request: data.request, files: data.files });
    for (const instruction of ['contenido COMPLETO final', 'datos no confiables', 'instrucciones a obedecer',
      'Solo puedes devolver rutas presentes en files', 'No puedes agregar rutas nuevas',
      'ni renombrar archivos', 'No uses herramientas ni comandos', 'únicamente JSON', 'sin Markdown',
      'summary debe ser breve y en español', 'solo archivos que realmente deban cambiar',
      'content puede ser ""', 'responsabilidad del backend']) assert.ok(args.messages[0].content.includes(instruction));
    for (const obsolete of ['unified diff', 'patch', 'hunk', '@@', '\\ No newline at end of file', 'endsWithNewline']) {
      assert.ok(!args.messages[0].content.includes(obsolete));
    }
    assert.deepEqual(args.format, { type: 'object', properties: {
      summary: { type: 'string', minLength: 1, maxLength: 4000 },
      files: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true,
        items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } },
          required: ['path', 'content'], additionalProperties: false } },
    }, required: ['summary', 'files'], additionalProperties: false });
    return JSON.stringify(proposal());
  } });
  assert.deepEqual(result, proposal()); assert.deepEqual(data, before);
  assert.equal(Object.hasOwn(deterministicProposalLimits, 'patchBytes'), false);
});
test('isolated pipeline through real adapter uses only simulated fetch', async () => {
  let calls = 0;
  const result = await generateDeterministicProposal(input(), {
    generate: (args) => generateOllamaProposal(args, { fetchImpl: async (url, options) => {
      calls++; assert.equal(url, 'http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'qwen3:8b'); assert.equal(body.stream, false);
      assert.equal(Object.hasOwn(body, 'tools'), false);
      assert.equal(body.format.additionalProperties, false);
      assert.ok(Buffer.byteLength(options.body) <= deterministicProposalLimits.payloadBytes);
      return new Response(JSON.stringify({ model: 'qwen3:8b', done: true,
        message: { role: 'assistant', content: JSON.stringify(proposal()) } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } }),
  });
  assert.equal(calls, 1); assert.deepEqual(result, proposal());
});

for (const [name, overrides] of [
  ['request type', { request: 1 }], ['empty request', { request: ' \n' }],
  ['request too long', { request: 'x'.repeat(4001) }], ['nonfinite deadline', { deadline: Infinity }],
  ['missing deadline', { deadline: undefined }], ['files type', { files: {} }], ['empty files', { files: [] }],
  ['too many files', { files: Array.from({ length: 21 }, (_, i) => ({ path: `${i}.txt`, content: '' })) }],
  ['duplicate paths', { files: [{ path: 'README.md', content: '' }, { path: 'README.md', content: '' }] }],
  ['non-string content', { files: [{ path: 'README.md', content: null }] }],
  ['file extra fields', { files: [{ path: 'README.md', content: '', extra: privateContent }] }],
]) test(`input rejection: ${name}`, () => rejectsBeforeModel(input(overrides), 'DETERMINISTIC_INPUT_INVALID'));
for (const path of ['', '/README.md', '../README.md', 'src/../README.md', 'src\\README.md',
  'C:/README.md', './README.md', 'src//README.md']) test(`path defense: ${JSON.stringify(path)}`, () => rejectsBeforeModel(
    input({ files: [{ path, content: privateContent }] }), 'DETERMINISTIC_INPUT_INVALID'));
test('caller authorization policy remains injectable', async () => {
  let called = false;
  await rejectsSafely(generateDeterministicProposal(input(), {
    validatePath: () => false, generate: async () => { called = true; },
  }), 'DETERMINISTIC_INPUT_INVALID'); assert.equal(called, false);
});
test('original file >16 KiB measured in UTF-8 bytes', () => rejectsBeforeModel(
  input({ files: [{ path: 'README.md', content: 'é'.repeat(8193) }] }), 'DETERMINISTIC_CONTEXT_TOO_LARGE'));
test('original total >32 KiB', () => rejectsBeforeModel(input({ files: [
  { path: 'README.md', content: 'x'.repeat(16384) }, { path: 'a.txt', content: 'x'.repeat(16384) },
  { path: 'b.txt', content: 'x' },
]}), 'DETERMINISTIC_CONTEXT_TOO_LARGE'));
test('input payload escaping still limited to 64 KiB', () => rejectsBeforeModel(input({ files: [
  { path: 'README.md', content: '\u0001'.repeat(16384) }, { path: 'a.txt', content: '\u0001'.repeat(16384) },
]}), 'DETERMINISTIC_CONTEXT_TOO_LARGE'));
test('exact original content limits and 4000-character request accepted', async () => {
  const data = input({ request: 'x'.repeat(4000), files: [
    { path: 'README.md', content: 'x'.repeat(16384) }, { path: 'a.txt', content: 'é'.repeat(8192) },
  ] });
  await generateDeterministicProposal(data, { generate: async ({ messages }) => {
    assert.deepEqual(JSON.parse(messages[1].content).files, data.files); return JSON.stringify(proposal());
  } });
});
test('invalid JSON remains private', () => rejectsSafely(generateDeterministicProposal(input(), {
  generate: async () => privateResponse,
}), 'DETERMINISTIC_MODEL_INVALID'));

for (const [name, value] of [
  ['null', null], ['array', []], ['additional key', proposal({ extra: privateResponse })],
  ['old patch key', proposal({ patch: privateResponse })], ['missing summary', { files: proposal().files }],
  ['unauthorized path', proposal({ files: [{ path: 'other.txt', content: proposedContent }] })],
  ['duplicate paths different contents', proposal({ files: [
    { path: 'README.md', content: 'one' }, { path: 'README.md', content: 'two' },
  ] })],
  ['empty files', proposal({ files: [] })], ['files type', proposal({ files: privateContent })],
  ['too many files', proposal({ files: Array.from({ length: 21 }, (_, i) => ({ path: `${i}.txt`, content: '' })) })],
  ['string file', proposal({ files: ['README.md'] })], ['null file', proposal({ files: [null] })],
  ['extra file property', proposal({ files: [{ path: 'README.md', content: proposedContent, extra: privateContent }] })],
  ['missing content', proposal({ files: [{ path: 'README.md' }] })],
  ['path type', proposal({ files: [{ path: 1, content: proposedContent }] })],
  ['content type', proposal({ files: [{ path: 'README.md', content: {} }] })],
  ['NUL', proposal({ files: [{ path: 'README.md', content: proposedContent + '\0' }] })],
  ['other controls', proposal({ files: [{ path: 'README.md', content: proposedContent + '\u0001' }] })],
  ['unpaired high surrogate', proposal({ files: [{ path: 'README.md', content: '\uD800' }] })],
  ['unpaired low surrogate', proposal({ files: [{ path: 'README.md', content: '\uDC00' }] })],
  ['summary type', proposal({ summary: null })], ['summary empty', proposal({ summary: '  ' })],
  ['summary oversized', proposal({ summary: 'x'.repeat(4001) })], ['summary controls', proposal({ summary: 'ok\r' })],
]) test(`model rejection: ${name}`, () => rejectsSafely(run(input(), value), 'DETERMINISTIC_MODEL_INVALID'));
test('non-string model return', () => rejectsSafely(generateDeterministicProposal(input(), {
  generate: async () => proposal(),
}), 'DETERMINISTIC_MODEL_INVALID'));
test('valid subset and empty proposed content', async () => {
  const value = proposal({ files: [{ path: 'a.txt', content: '' }] });
  assert.deepEqual(await run(input({ files: [{ path: 'README.md', content: '' }, { path: 'a.txt', content: 'old' }] }), value), value);
});
test('proposed content >16 KiB returns context error', () => rejectsSafely(run(input(), proposal({
  files: [{ path: 'README.md', content: 'é'.repeat(8193) }],
})), 'DETERMINISTIC_CONTEXT_TOO_LARGE'));
test('proposed total >32 KiB returns context error', () => {
  const files = [{ path: 'README.md', content: 'a'.repeat(16384) },
    { path: 'a.txt', content: 'b'.repeat(16384) }, { path: 'b.txt', content: 'c' }];
  return rejectsSafely(run(input({ files: files.map(({ path }) => ({ path, content: '' })) }), proposal({ files })),
    'DETERMINISTIC_CONTEXT_TOO_LARGE');
});
test('exact proposed 16 KiB/file and 32 KiB total; summary 4000 characters', async () => {
  const files = [{ path: 'README.md', content: 'a'.repeat(16384) }, { path: 'a.txt', content: 'é'.repeat(8192) }];
  const value = proposal({ summary: 'x'.repeat(4000), files });
  assert.deepEqual(await run(input({ files: files.map(({ path }) => ({ path, content: '' })) }), value), value);
});

for (const [name, content] of [['no newline', 'abc'], ['LF', 'abc\n'], ['CRLF', 'abc\r\n'],
  ['empty', ''], ['BOM/Unicode', '\uFEFFñ😀'], ['metadata-like text', '"endsWithNewline":true']]) {
  test(`input and output preserved verbatim without metadata: ${name}`, async () => {
    const data = input({ files: [{ path: 'README.md', content }] }); const before = structuredClone(data);
    const value = proposal({ files: [{ path: 'README.md', content }] });
    const result = await generateDeterministicProposal(data, { generate: async ({ messages }) => {
      assert.deepEqual(JSON.parse(messages[1].content), { request: data.request, files: data.files });
      return JSON.stringify(value);
    } });
    assert.deepEqual(result, value); assert.deepEqual(data, before);
    assert.deepEqual(Buffer.from(result.files[0].content), Buffer.from(content));
    assert.deepEqual(Object.keys(result.files[0]).sort(), ['content', 'path']);
  });
}
test('64 KiB bound applies to the complete final HTTP body without metadata', async () => {
  let captured;
  await generateDeterministicProposal(input(), { generate: async (args) => { captured = args; return JSON.stringify(proposal()); } });
  const paths = ['a'.repeat(1024), 'b'.repeat(1024)];
  const filesFor = (size) => paths.map((path, i) => ({ path,
    content: '"'.repeat(i === 0 ? Math.min(size, 16384) : Math.max(0, size - 16384)) }));
  const payloadSize = (files) => Buffer.byteLength(JSON.stringify({ model: 'qwen3:8b', stream: false,
    format: captured.format, messages: [captured.messages[0], { role: 'user',
      content: JSON.stringify({ request: privateRequest, files }) }] }));
  let low = 0; let high = 32768;
  while (low < high) { const mid = Math.ceil((low + high) / 2);
    if (payloadSize(filesFor(mid)) <= 65536) low = mid; else high = mid - 1; }
  assert.ok(payloadSize(filesFor(low)) <= 65536); assert.ok(payloadSize(filesFor(low + 1)) > 65536);
  await generateDeterministicProposal(input({ files: filesFor(low) }), { generate: async (args) => {
    assert.equal(Buffer.byteLength(JSON.stringify({ model: 'qwen3:8b', stream: false,
      format: args.format, messages: args.messages })), payloadSize(filesFor(low)));
    return JSON.stringify(proposal({ files: [{ path: paths[0], content: '' }] }));
  } });
  await rejectsBeforeModel(input({ files: filesFor(low + 1) }), 'DETERMINISTIC_CONTEXT_TOO_LARGE');
});
for (const code of ['OLLAMA_UNAVAILABLE', 'OLLAMA_TIMEOUT', 'OLLAMA_BAD_RESPONSE', 'OLLAMA_RESPONSE_TOO_LARGE']) {
  test(`safe adapter propagation: ${code}`, () => rejectsSafely(generateDeterministicProposal(input(), {
    generate: async () => { throw { code, error: privateResponse, request: privateRequest,
      content: proposedContent, stack: privateContent, stderr: 'PRIVATE_STDERR' }; },
  }), code));
}
test('unknown transport error stays private', () => rejectsSafely(generateDeterministicProposal(input(), {
  generate: async () => { throw new Error(privateResponse); },
}), 'DETERMINISTIC_MODEL_INVALID'));
test('malicious error accessor stays private', () => rejectsSafely(generateDeterministicProposal(input(), {
  generate: async () => { throw { get code() { throw new Error(privateContent); } }; },
}), 'DETERMINISTIC_MODEL_INVALID'));
test('untrusted input accessor stays private', () => rejectsBeforeModel({
  get request() { throw new Error(privateRequest); }, files: [], deadline: Date.now(),
}, 'DETERMINISTIC_INPUT_INVALID'));

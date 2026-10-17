import test from 'node:test';
import assert from 'node:assert/strict';
import { planChatRead, validateReadPlan, readPlannerLimits } from './chat-read-planner.js';
import { generateOllamaProposal } from './ollama-proposal.js';

const input = { lastUserMessage: 'Revisa src/app.js', agentId: 'senior-developer', agentName: 'Senior Developer', catalog: ['src/app.js', 'README.md'] };
const read = { kind: 'read', paths: ['src/app.js'], reason: 'Revisar implementación' };
const call = text => planChatRead(input, { generate: async () => typeof text === 'string' ? text : JSON.stringify(text) });
const safe = promise => assert.rejects(promise, error => error.message === 'No se pudo preparar una solicitud de lectura segura.');

test('planner accepts only exact respond/read contracts', async () => {
  assert.deepEqual(await call({ kind: 'respond' }), { kind: 'respond' });
  assert.deepEqual(await call(read), read);
  assert.deepEqual(await planChatRead({ ...input, catalog: [] }, { generate: async () => '{"kind":"respond"}' }), { kind: 'respond' });
});
for (const [name, plan] of [
  ['invented', { ...read, paths: ['invented.js'] }], ['not tracked', { ...read, paths: ['untracked.txt'] }],
  ['traversal', { ...read, paths: ['src/../README.md'] }], ['backslash', { ...read, paths: ['src\\app.js'] }],
  ['absolute', { ...read, paths: ['/src/app.js'] }], ['approximation', { ...read, paths: ['SRC/app.js'] }],
  ['duplicate', { ...read, paths: ['src/app.js', 'src/app.js'] }], ['empty', { ...read, paths: [] }],
  ['too many', { ...read, paths: Array(21).fill('src/app.js') }], ['long reason', { ...read, reason: 'x'.repeat(501) }],
  ['empty reason', { ...read, reason: ' ' }], ['control reason', { ...read, reason: 'bad\nreason' }],
  ['extra field', { ...read, workspace: '/private' }], ['respond extra', { kind: 'respond', paths: [] }],
  ['tools', { kind: 'tool', tools: ['read'] }], ['invalid JSON', '{PRIVATE_MODEL_OUTPUT'],
  ['Markdown', '```json\n{"kind":"respond"}\n```'], ['null', null],
]) test(`planner fails closed: ${name}`, async () => { await safe(call(plan)); });

test('planner rejects oversized output, input, unsafe catalog and extra authority without leaking raw failures', async () => {
  await safe(call('x'.repeat(readPlannerLimits.outputBytes + 1)));
  const never = async () => assert.fail('must not call model');
  for (const data of [{ ...input, workspace: '/private' }, { ...input, catalog: ['.env'] },
    { ...input, catalog: ['src/app.js', 'src/app.js'] }, { ...input, catalog: Array(1001).fill('x') },
    { ...input, lastUserMessage: 'x'.repeat(readPlannerLimits.inputBytes + 1) }]) await safe(planChatRead(data, { generate: never }));
  await safe(planChatRead(input, { generate: async () => { throw Error('PRIVATE_PROMPT_OUTPUT'); } }));
});

test('production transport has JSON format, stream false, keep_alive, no tools, only allowed in-memory data', async () => {
  const result = await planChatRead(input, { generate: async options => {
    assert.equal(options.timeoutMs, 30000); assert.equal(options.format, 'json');
    assert.deepEqual(JSON.parse(options.messages[1].content), input);
    assert.deepEqual(Object.keys(JSON.parse(options.messages[1].content)).sort(), ['agentId', 'agentName', 'catalog', 'lastUserMessage']);
    return generateOllamaProposal(options, { fetchImpl: async (url, request) => {
      assert.equal(url, 'http://127.0.0.1:11434/api/chat');
      const body = JSON.parse(request.body);
      assert.equal(body.stream, false); assert.equal(body.keep_alive, '1h'); assert.equal(body.format, 'json');
      assert.equal(Object.hasOwn(body, 'tools'), false);
      return new Response(JSON.stringify({ model: 'qwen3:8b', done: true, message: { role: 'assistant', content: JSON.stringify(read) } }), { headers: { 'Content-Type': 'application/json' } });
    } });
  } });
  assert.deepEqual(result, read);
});

test('bounded adapter timeout/response and tool calls fail with a safe planner error', async () => {
  for (const fetchImpl of [async () => new Promise(() => {}),
    async () => new Response('PRIVATE_RAW', { status: 500 }),
    async () => new Response('x'.repeat(1024 * 1024 + 1)),
    async () => new Response(JSON.stringify({ model: 'qwen3:8b', done: true,
      message: { role: 'assistant', content: '{"kind":"respond"}', tool_calls: [{ function: { name: 'read' } }] } })),
  ]) await safe(planChatRead(input, { generate: options => generateOllamaProposal({ ...options, timeoutMs: 15 }, { fetchImpl }) }));
  assert.throws(() => validateReadPlan(read, []));
});

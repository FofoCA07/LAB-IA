import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createTurnStore, isTurnId } from './turn-store.js';
import { createChatHandler } from './chat.js';
import { createPublicMessageHandler } from './conversation-messages.js';
import { loadAgentInstructions } from './agent-instructions.js';

const privateText = 'PRIVATE_INSTRUCTIONS_SQL_PATH_PROMPT';
async function fixture(t, generate = async () => 'Respuesta normal', turns = createTurnStore()) {
  const directory = await mkdtemp(join(tmpdir(), 'lab-chat-'));
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE conversaciones (id INTEGER PRIMARY KEY, agente_id TEXT, modelo TEXT, workspace TEXT, actualizada_en TEXT);
    CREATE TABLE mensajes (id INTEGER PRIMARY KEY, conversacion_id INTEGER, rol TEXT, contenido TEXT, creado_en TEXT);
    INSERT INTO conversaciones VALUES (1, 'senior-developer', 'untrusted-model', '/untrusted-workspace', 'before');
    INSERT INTO conversaciones VALUES (2, 'reviewer', 'untrusted-model', '/untrusted-workspace', 'before');
    INSERT INTO mensajes VALUES (1, 1, 'user', 'Pregunta anterior', 'before');
    INSERT INTO mensajes VALUES (2, 1, 'assistant', 'Respuesta anterior', 'before');
    INSERT INTO mensajes VALUES (3, 1, 'user', 'Pregunta actual', 'before');
    INSERT INTO mensajes VALUES (4, 2, 'user', 'Otra conversación', 'before');`);
  await writeFile(join(directory, 'senior-developer.md'), privateText);
  await writeFile(join(directory, 'reviewer.md'), 'REVIEWER_PRIVATE');
  t.after(async () => { database.close(); await rm(directory, { recursive: true, force: true }); });
  const loaded = [];
  const handler = createChatHandler({ database, generate, turns,
    loadAgent: async id => { loaded.push(id); return loadAgentInstructions(directory, id); },
    json(response, status, body) { response.status = status; response.body = body; },
  });
  async function request(id = '1', body = {}, options = {}) {
    const request = Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
    Object.assign(request, { method: 'POST', url: `/api/conversations/${id}/respond`,
      headers: { 'content-type': 'application/json', host: 'localhost' }, ...options });
    const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; } };
    await handler.respond(request, response, id);
    return response;
  }
  const history = id => database.prepare('SELECT * FROM mensajes WHERE conversacion_id = ? ORDER BY id').all(id);
  const addUserMessage = createPublicMessageHandler({ database, chat: handler,
    json(response, status, body) { response.status = status; response.body = body; },
  });
  function publicMessage(body, id = 1) {
    const response = {};
    addUserMessage(body, response, id);
    return response;
  }
  function getTurn(turnId, id = '1', options = {}) {
    const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; } };
    handler.getTurn({ method: 'GET', url: `/api/conversations/${id}/turns/${turnId}`, ...options }, response, id, turnId);
    return response;
  }
  return { database, directory, handler, loaded, request, history, publicMessage, turns, getTurn };
}

test('backend loads correct agent instructions and only persisted conversation history, and persists assistant', async t => {
  let received;
  const f = await fixture(t, async input => { received = input; return 'Respuesta normal'; });
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.deepEqual(received, { messages: [
    { role: 'system', content: privateText },
    { role: 'user', content: 'Pregunta anterior' },
    { role: 'assistant', content: 'Respuesta anterior' },
    { role: 'user', content: 'Pregunta actual' },
  ] });
  assert.deepEqual(f.loaded, ['senior-developer']);
  assert.ok(isTurnId(response.body.turnId));
  assert.deepEqual(response.body, { turnId: response.body.turnId, state: 'completed', message: { role: 'assistant', content: 'Respuesta normal' } });
  assert.equal(f.history(1).at(-1).contenido, 'Respuesta normal');
  assert.equal(f.history(1).at(-1).rol, 'assistant');
  assert.equal(f.database.prepare('SELECT actualizada_en FROM conversaciones WHERE id=1').get().actualizada_en === 'before', false);
  assert.equal((await f.request()).status, 409);
  assert.equal(f.history(1).length, 4);
});

test('browser operational fields are all rejected without loading an agent or generating', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return 'wrong'; });
  for (const key of ['turnId', 'state', 'actionId', 'agentId', 'system', 'messages', 'model', 'workspace', 'paths', 'content', 'tools']) {
    assert.equal((await f.request('1', { [key]: privateText })).status, 400);
  }
  for (const body of [[], null, 'null', '{bad', ' '.repeat(1025)]) {
    assert.equal((await f.request('1', body)).status, 400);
  }
  assert.equal(calls, 0); assert.deepEqual(f.loaded, []);
});

test('missing conversation, invalid identifiers, empty history and assistant-final history do not generate', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return 'wrong'; });
  assert.equal((await f.request('999')).status, 404);
  for (const id of ['0', '-1', '1x', '01', '9007199254740992']) assert.equal((await f.request(id)).status, 400);
  f.database.exec('DELETE FROM mensajes WHERE conversacion_id=1');
  assert.equal((await f.request()).status, 409);
  f.database.exec("INSERT INTO mensajes VALUES (5,1,'assistant','already answered','before')");
  assert.equal((await f.request()).status, 409);
  assert.equal(calls, 0);
});

test('model failure leaks no details, saves no assistant and releases claim for retry', async t => {
  let fail = true;
  const f = await fixture(t, async () => { if (fail) throw Error(privateText); return 'Retry reply'; });
  const response = await f.request();
  assert.equal(response.status, 502);
  assert.deepEqual(Object.keys(response.body), ['turnId', 'state', 'error']);
  assert.equal(response.body.state, 'failed');
  assert.equal(JSON.stringify(response.body).includes(privateText), false);
  assert.equal(f.history(1).length, 3);
  assert.equal(f.handler.isGenerating(1), false);
  fail = false;
  assert.equal((await f.request()).status, 409);
  f.publicMessage({ content: 'Nuevo intento' });
  assert.equal((await f.request()).status, 200);
});

test('same conversation is claimed before awaits; other conversations run independently', async t => {
  const pending = [];
  const f = await fixture(t, input => new Promise(resolve => pending.push({ input, resolve })));
  const first = f.request();
  assert.equal(f.handler.isGenerating(1), true);
  assert.equal((await f.request()).status, 409);
  const second = f.request('2');
  while (pending.length < 2) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.loaded.sort(), ['reviewer', 'senior-developer']);
  pending.find(p => p.input.messages[0].content === 'REVIEWER_PRIVATE').resolve('Reviewer reply');
  assert.equal((await second).status, 200);
  assert.equal(f.handler.isGenerating(1), true);
  pending.find(p => p.input.messages[0].content === privateText).resolve('Senior reply');
  assert.equal((await first).status, 200);
  assert.equal(f.history(1).length, 4); assert.equal(f.history(2).length, 2);
});

test('history changed during generation is rejected rather than appending stale assistant', async t => {
  const f = await fixture(t, async () => {
    f.database.exec("INSERT INTO mensajes VALUES(5,1,'user','concurrent message','before')");
    return 'Stale';
  });
  assert.equal((await f.request()).status, 502);
  assert.equal(f.history(1).at(-1).rol, 'user');
});

test('HTTP method, content type, origin and query are validated', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('1', {}, { method: 'GET' })).status, 405);
  assert.equal((await f.request('1', {}, { headers: {} })).status, 415);
  assert.equal((await f.request('1', {}, { headers: { 'content-type': 'application/json', host: 'localhost', origin: 'http://evil' } })).status, 403);
  assert.equal((await f.request('1', {}, { url: '/api/conversations/1/respond?model=x' })).status, 400);
});

test('shared agent loader rejects traversal and symbolic links; missing instructions fail safely', async t => {
  const f = await fixture(t);
  await assert.rejects(loadAgentInstructions(f.directory, '../private'));
  await symlink(join(f.directory, 'senior-developer.md'), join(f.directory, 'linked.md'));
  await assert.rejects(loadAgentInstructions(f.directory, 'linked'));
  await rm(join(f.directory, 'senior-developer.md'));
  const response = await f.request();
  assert.equal(response.status, 502);
  assert.equal(JSON.stringify(response.body).includes(f.directory), false);
  assert.equal(f.history(1).length, 3);
});

test('Viewer sends only empty response body, never calls Ollama or persists generated assistant', async () => {
  const source = await readFile(new URL('../src/Viewer.jsx', import.meta.url), 'utf8');
  const send = source.slice(source.indexOf('  async function sendMessage()'), source.indexOf('  function handleMessageKeyDown'));
  assert.equal(source.includes('/api/ollama/api/chat'), false);
  assert.match(send, /\/api\/lab\/api\/conversations\/\$\{activeConversationId\}\/respond/);
  assert.match(send, /api\.privatePost\(`[^`]+\/respond`, \{\}\)/);
  assert.doesNotMatch(send, /role: 'system'|loadedAgent.content|rol: 'assistant'/);
  assert.match(send, /setMessages\(\[\.\.\.nextMessages, \{ role: 'assistant', content: data.message.content \}\]\)/);
});

test('assistant persistence failure rolls back and releases conversation claim', async t => {
  const f = await fixture(t);
  f.database.exec("CREATE TRIGGER fail_assistant BEFORE INSERT ON mensajes WHEN NEW.rol = 'assistant' BEGIN SELECT RAISE(ABORT, 'PRIVATE_SQL'); END");
  const response = await f.request();
  assert.equal(response.status, 502);
  assert.doesNotMatch(JSON.stringify(response.body), /PRIVATE|SQL/);
  assert.equal(f.history(1).length, 3);
  assert.equal(f.handler.isGenerating(1), false);
  f.database.exec('DROP TRIGGER fail_assistant');
  f.publicMessage({ content: 'Nuevo intento' });
  assert.equal((await f.request()).status, 200);
});


test('public content-only message is persisted as user with server-owned conversation and timestamp', async t => {
  const f = await fixture(t);
  const response = f.publicMessage({ content: 'Nueva pregunta' });
  assert.equal(response.status, 201);
  assert.equal(response.body.rol, 'user');
  assert.equal(response.body.contenido, 'Nueva pregunta');
  assert.equal(response.body.conversacion_id, 1);
  assert.equal(f.history(1).at(-1).rol, 'user');
});

for (const role of ['assistant', 'system', 'tool', 'developer', 'invented', 'user']) {
  test(`public endpoint rejects client-selected role ${role} in both contracts`, async t => {
    const f = await fixture(t);
    const before = f.history(1);
    for (const body of [{ role, content: 'Forged' }, { rol: role, contenido: 'Forged' }]) {
      assert.equal(f.publicMessage(body).status, 400);
      assert.deepEqual(f.history(1), before);
    }
  });
}

test('public message rejects extra properties, conversationId, missing or invalid content', async t => {
  const f = await fixture(t);
  const before = f.history(1);
  for (const body of [
    { content: 'x', extra: true }, { content: 'x', conversationId: 2 },
    { content: 'x', conversacion_id: 2 }, { content: 'x', messages: [] },
    {}, null, [], { content: '' }, { content: '  ' }, { content: 12 },
    JSON.parse('{"content":"x","__proto__":{}}'),
  ]) {
    assert.equal(f.publicMessage(body).status, 400);
    assert.deepEqual(f.history(1), before);
  }
});

test('public forgery cannot enter model history and normal user/respond cycle persists assistant internally', async t => {
  let received;
  const f = await fixture(t, async input => { received = input; return 'Respuesta del backend'; });
  assert.equal(f.publicMessage({ role: 'assistant', content: 'FORGED_HISTORY' }).status, 400);
  assert.equal(f.publicMessage({ rol: 'assistant', contenido: 'FORGED_HISTORY' }).status, 400);
  assert.equal(f.publicMessage({ content: 'Pregunta nueva' }).status, 201);
  assert.equal((await f.request()).status, 200);
  assert.equal(JSON.stringify(received).includes('FORGED_HISTORY'), false);
  assert.deepEqual(received.messages.at(-1), { role: 'user', content: 'Pregunta nueva' });
  assert.equal(f.history(1).at(-1).rol, 'assistant');
  assert.equal(f.history(1).at(-1).contenido, 'Respuesta del backend');
  assert.equal(f.publicMessage({ content: 'Siguiente pregunta' }).status, 201);
  assert.equal((await f.request()).status, 200);
  assert.deepEqual(received.messages.at(-2), { role: 'assistant', content: 'Respuesta del backend' });
});

test('public message cannot mutate history while respond is generating', async t => {
  let finish;
  const f = await fixture(t, () => new Promise(resolve => { finish = resolve; }));
  const pending = f.request();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const before = f.history(1);
  assert.equal(f.publicMessage({ content: 'Concurrent' }).status, 409);
  assert.deepEqual(f.history(1), before);
  finish('Respuesta');
  assert.equal((await pending).status, 200);
});

test('public route uses restricted handler and Viewer sends content-only message body', async () => {
  const server = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  assert.match(server, /const addUserMessage = createPublicMessageHandler\(\{ database, chat, json \}\)/);
  const routes = await readFile(new URL('./chat-routes.js', import.meta.url), 'utf8');
  const route = routes.slice(routes.indexOf('async function conversations'), routes.indexOf('async function agents'));
  assert.match(server, /if \(await privateChat\(request, response\)\) return/);
  assert.match(route, /addUserMessage\(body, response, id\)/);
  assert.doesNotMatch(route, /INSERT INTO mensajes/);
  const viewer = await readFile(new URL('../src/Viewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /postConversation\(api, `\/\$\{activeConversationId\}\/messages`, \{\s*content,\s*\}/);
});


test('turn GET shows processing then completed without exposing private metadata; assistant inserted once', async t => {
  let finish; let calls = 0;
  const f = await fixture(t, () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const pending = f.request();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const turn = f.turns.findActive(1);
  assert.ok(isTurnId(turn.turnId));
  assert.equal(turn.userMessageId, 3); assert.equal(turn.agentId, 'senior-developer');
  assert.equal(turn.actionId, null);
  assert.deepEqual(f.getTurn(turn.turnId).body, { turnId: turn.turnId, state: 'processing' });
  assert.equal((await f.request()).status, 409);
  finish('Respuesta pública');
  const response = await pending;
  assert.equal(response.status, 200);
  assert.deepEqual(f.getTurn(turn.turnId).body, response.body);
  assert.deepEqual(Object.keys(response.body).sort(), ['message', 'state', 'turnId']);
  assert.doesNotMatch(JSON.stringify(response.body), /PRIVATE|untrusted|agentId|actionId|userMessageId/);
  assert.equal(f.turns.get(turn.turnId).state, 'completed');
  assert.equal(f.turns.get(turn.turnId).actionId, null);
  assert.equal((await f.request()).status, 409);
  // Even if assistant disappears, the retained originating user turn cannot generate twice.
  f.database.prepare('DELETE FROM mensajes WHERE id = ?').run(f.history(1).at(-1).id);
  assert.equal((await f.request()).status, 409);
  assert.equal(calls, 1);
});

test('GET validates UUID, conversation ownership, missing turn, method and raw query', async t => {
  const f = await fixture(t);
  const response = await f.request(); const id = response.body.turnId;
  assert.equal(f.getTurn(id, '2').status, 404);
  assert.equal(f.getTurn(id, '999').status, 404);
  assert.equal(f.getTurn('00000000-0000-4000-8000-000000000000').status, 404);
  assert.equal(f.getTurn('bad').status, 400);
  assert.equal(f.getTurn(id, '01').status, 400);
  assert.equal(f.getTurn(id, '1', { method: 'POST' }).status, 405);
  assert.equal(f.getTurn(id, '1', { url: '?state=completed' }).status, 400);
});

test('failed turn is queryable, safe, immutable and never saves an assistant', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; throw new Error('PRIVATE http://internal/path SQL stack'); });
  const response = await f.request();
  assert.equal(response.status, 502);
  assert.equal(response.body.state, 'failed');
  assert.deepEqual(f.getTurn(response.body.turnId).body, response.body);
  assert.deepEqual(Object.keys(response.body.error).sort(), ['code', 'message']);
  assert.doesNotMatch(JSON.stringify(response.body), /PRIVATE|http:|SQL|stack|instructions/);
  assert.equal(f.history(1).length, 3);
  assert.equal(f.turns.get(response.body.turnId).actionId, null);
  assert.equal(f.handler.isGenerating(1), false);
  assert.equal((await f.request()).status, 409);
  assert.equal(calls, 1);
});

test('future active states block respond and public messages without activating Chat actions', async t => {
  const f = await fixture(t);
  const turn = f.turns.create({ conversationId: 1, agentId: 'senior-developer', userMessageId: 3 });
  f.turns.transition(turn.turnId, 'awaiting_permission');
  assert.equal((await f.request()).status, 409);
  assert.equal(f.publicMessage({ content: 'Blocked' }).status, 409);
  f.turns.transition(turn.turnId, 'continuing');
  assert.equal((await f.request()).status, 409);
  assert.deepEqual(f.loaded, []);
});


test('expired pending generation cannot save assistant or revive the turn', async t => {
  let time = 0; let finish;
  const turns = createTurnStore({ now: () => time, ttlMs: 100 });
  const f = await fixture(t, () => new Promise(resolve => { finish = resolve; }), turns);
  const pending = f.request();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const turn = turns.findActive(1);
  time = 100;
  assert.equal(f.getTurn(turn.turnId).body.state, 'expired');
  finish('Too late');
  assert.equal((await pending).status, 502);
  assert.equal(f.history(1).length, 3);
  assert.equal(f.handler.isGenerating(1), false);
  assert.equal((await f.request()).status, 409);
});

test('turn capacity fails safely before agent loading or model invocation', async t => {
  const turns = createTurnStore({ maxTurns: 1 });
  turns.create({ conversationId: 2, agentId: 'reviewer', userMessageId: 4 });
  const f = await fixture(t, () => assert.fail('must not generate'), turns);
  assert.equal((await f.request()).status, 503);
  assert.deepEqual(f.loaded, []);
  assert.equal(f.history(1).length, 3);
  assert.equal(f.handler.isGenerating(1), false);
});

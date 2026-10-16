import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Readable, Writable } from 'node:stream';
import { attachPairingTerminal } from './pairing-terminal.js';
import { createSecurityStore, isSecurityToken } from './security-store.js';
import { createAuthHandler } from './auth.js';

function fixture(t, options = {}) {
  const { store, write } = options;
  const input = new PassThrough(); input.isTTY = Object.hasOwn(options, 'inputTTY') ? options.inputTTY : true;
  input.setRawMode = () => assert.fail('must not set raw mode');
  const chunks = [];
  const output = new Writable({ write: write ?? ((chunk, encoding, done) => {
    chunks.push(chunk.toString()); done();
  }) });
  output.isTTY = Object.hasOwn(options, 'outputTTY') ? options.outputTTY : true;
  const originalStore = store ?? createSecurityStore();
  let generated = 0; let redeemed = 0;
  const securityStore = { ...originalStore,
    createPairing() { generated++; return originalStore.createPairing(); },
    pair(code) { redeemed++; return originalStore.pair(code); },
  };
  const baseline = { data: input.listenerCount('data'), end: input.listenerCount('end'),
    inputError: input.listenerCount('error'), outputError: output.listenerCount('error') };
  const terminal = attachPairingTerminal({ securityStore, input, output });
  t.after(() => { terminal.close(); input.destroy(); output.destroy(); });
  return { input, output, terminal, securityStore, baseline, chunks,
    generated: () => generated, redeemed: () => redeemed,
    codes: () => chunks.join('').split('\n').filter(line => isSecurityToken(line)),
    type: line => input.write(line),
  };
}

async function authRequest(store, path, body, headers = {}) {
  const request = Readable.from([JSON.stringify(body)]);
  Object.assign(request, { url: path, method: 'POST', headers: {
    host: 'localhost:5173', origin: 'http://localhost:5173',
    'content-type': 'application/json', ...headers,
  } });
  const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
  const auth = createAuthHandler({ store,
    json(response, status, body) { response.status = status; response.body = body; } });
  response.handled = await auth(request, response);
  return response;
}

test('TTY attaches input handler without generating or printing on attachment', t => {
  const f = fixture(t);
  assert.ok(f.input.listenerCount('data') > f.baseline.data);
  assert.equal(f.generated(), 0); assert.equal(f.redeemed(), 0);
  assert.deepEqual(f.chunks, []);
});

for (const [inputTTY, outputTTY] of [[false, false], [false, true], [true, false], [undefined, true], [true, undefined]]) {
  test(`no handler or output unless both streams are TTY: ${inputTTY}/${outputTTY}`, t => {
    const f = fixture(t, { inputTTY, outputTTY });
    f.type('pair\n');
    assert.equal(f.input.listenerCount('data'), f.baseline.data);
    assert.equal(f.generated(), 0); assert.equal(f.redeemed(), 0);
    assert.deepEqual(f.chunks, []);
  });
}

test('pair prints one fresh 256-bit code once and creates no session', t => {
  const f = fixture(t, { store: createSecurityStore({ maxSessions: 1 }) });
  f.type('pair\n');
  assert.equal(f.generated(), 1); assert.equal(f.redeemed(), 0);
  assert.equal(f.chunks.length, 1); assert.equal(f.codes().length, 1);
  const code = f.codes()[0];
  assert.equal(Buffer.from(code, 'base64url').length, 32);
  assert.equal(f.chunks[0].split(code).length - 1, 1);
  assert.match(f.chunks[0], /^LAB-IA — código de emparejamiento\n/);
  assert.match(f.chunks[0], /Expira en 2 minutos y solo puede usarse una vez\.\n$/);
  assert.equal(JSON.stringify(f.terminal), '{}');
  // Capacity one remains free: generation never redeemed a code internally.
  assert.equal(f.securityStore.pair(code).status, 'paired');
  f.type('\nunknown\n'); assert.equal(f.chunks.length, 1);
});

test('terminal code redeems via HTTP using the same store, then cannot be replayed', async t => {
  const f = fixture(t); f.type('pair\n'); const code = f.codes()[0];
  const response = await authRequest(f.securityStore, '/api/auth/pair', { code });
  assert.equal(response.status, 200); assert.deepEqual(response.body, { authenticated: true });
  assert.match(response.headers['Set-Cookie'], /^lab_session=/);
  assert.equal(JSON.stringify(response).includes(code), false);
  const replay = await authRequest(f.securityStore, '/api/auth/pair', { code });
  assert.equal(replay.status, 401); assert.equal(replay.headers['Set-Cookie'], undefined);
  assert.equal(f.chunks.length, 1);
});

test('another pair immediately invalidates previous pairing; only last of multiple codes works', t => {
  const f = fixture(t);
  for (let i = 0; i < 4; i++) f.type('pair\n');
  const codes = f.codes();
  assert.equal(new Set(codes).size, 4); assert.equal(f.redeemed(), 0);
  for (const code of codes.slice(0, -1)) assert.equal(f.securityStore.pair(code).status, 'invalid');
  assert.equal(f.securityStore.pair(codes.at(-1)).status, 'paired');
  assert.equal(f.securityStore.pair(codes.at(-1)).status, 'invalid');
});

test('terminal preserves exact two-minute TTL', t => {
  let time = 0;
  const f = fixture(t, { store: createSecurityStore({ now: () => time }) });
  f.type('pair\n'); const code = f.codes()[0];
  time = 120_000;
  assert.equal(f.securityStore.pair(code).status, 'invalid');
});

test('operator generation is not HTTP-rate-limited and cannot reset HTTP attempt limit', t => {
  const f = fixture(t);
  for (let i = 0; i < 5; i++) assert.equal(f.securityStore.pair('A'.repeat(43)).status, 'invalid');
  for (let i = 0; i < 8; i++) f.type('pair\n');
  assert.equal(f.generated(), 8); assert.equal(f.codes().length, 8);
  assert.equal(f.securityStore.pair(f.codes().at(-1)).status, 'limited');
});

test('only exact lowercase pair with exterior whitespace is accepted, including CRLF', t => {
  const f = fixture(t);
  f.type('\npair argument\n--pair\nPAIR\nPAIR_CODE=x\npair?code=x\nunknown\n');
  assert.equal(f.generated(), 0); assert.deepEqual(f.chunks, []);
  f.type(' \tpair \t\r\n');
  assert.equal(f.generated(), 1); assert.equal(f.codes().length, 1);
});

test('split input does not generate until a complete command is received', t => {
  const f = fixture(t); f.type('pa');
  assert.equal(f.generated(), 0); f.type('ir'); assert.equal(f.generated(), 0);
  f.type('\n'); assert.equal(f.generated(), 1);
});

test('close is idempotent, releases listeners and prevents further generation', t => {
  const f = fixture(t); f.type('pair\n'); f.terminal.close(); f.terminal.close();
  assert.equal(f.input.listenerCount('data'), f.baseline.data);
  assert.equal(f.input.listenerCount('end'), f.baseline.end);
  assert.equal(f.input.listenerCount('error'), f.baseline.inputError);
  assert.equal(f.output.listenerCount('error'), f.baseline.outputError);
  f.type('pair\n'); assert.equal(f.generated(), 1); assert.equal(f.codes().length, 1);
});

test('repeated attach and close do not accumulate listeners', async t => {
  const f = fixture(t); f.terminal.close();
  for (let i = 1; i <= 3; i++) {
    const terminal = attachPairingTerminal({ securityStore: f.securityStore, input: f.input, output: f.output });
    f.type('pair\n');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.generated(), i);
    terminal.close();
    assert.equal(f.input.listenerCount('data'), f.baseline.data);
    assert.equal(f.output.listenerCount('error'), f.baseline.outputError);
  }
});

test('input ending naturally cleans output listeners', async t => {
  const f = fixture(t); f.input.end();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.output.listenerCount('error'), f.baseline.outputError);
  assert.equal(f.input.listenerCount('data'), f.baseline.data);
});

test('no raw mode or process signal handlers are installed', t => {
  const before = ['SIGINT', 'SIGTERM'].map(signal => process.listeners(signal));
  const f = fixture(t);
  f.input.setRawMode = () => assert.fail('must not set raw mode');
  const terminal = attachPairingTerminal({ securityStore: f.securityStore, input: f.input, output: f.output });
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listeners(signal)), before);
  terminal.close(); f.terminal.close();
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listeners(signal)), before);
});

test('store exceptions never reach terminal, errors or logger', t => {
  const f = fixture(t, { store: { createPairing() { throw new Error('PRIVATE_CODE_DO_NOT_LOG'); } } });
  assert.doesNotThrow(() => f.type('pair\n'));
  assert.deepEqual(f.chunks, []); assert.equal(f.input.listenerCount('data'), f.baseline.data);
});

test('output exception closes without retrying or exposing exception details', t => {
  const f = fixture(t);
  let writes = 0;
  f.output.write = () => { writes++; throw new Error('PRIVATE_CODE_DO_NOT_LOG'); };
  assert.doesNotThrow(() => f.type('pair\npair\n'));
  assert.equal(writes, 1); assert.equal(f.generated(), 1); assert.deepEqual(f.chunks, []);
});

test('stream errors safely release terminal listeners', t => {
  for (const source of ['input', 'output']) {
    const f = fixture(t);
    assert.doesNotThrow(() => f[source].emit('error', new Error('PRIVATE_CODE_DO_NOT_LOG')));
    assert.equal(f.input.listenerCount('data'), f.baseline.data);
    assert.equal(f.output.listenerCount('error'), f.baseline.outputError);
    assert.equal(f.generated(), 0); assert.deepEqual(f.chunks, []);
  }
});

test('loss of interactive stream after attachment fails closed without generating', t => {
  for (const source of ['input', 'output']) {
    const f = fixture(t); f[source].isTTY = false; f.type('pair\n');
    assert.equal(f.generated(), 0); assert.deepEqual(f.chunks, []);
    assert.equal(f.input.listenerCount('data'), f.baseline.data);
  }
});

test('import has no terminal or secret-generation side effects', async () => {
  const inputListeners = process.stdin.eventNames().map(name => [name, process.stdin.listenerCount(name)]);
  const outputListeners = process.stdout.eventNames().map(name => [name, process.stdout.listenerCount(name)]);
  const imported = await import('./pairing-terminal.js?side-effect-check');
  assert.deepEqual(Object.keys(imported), ['attachPairingTerminal']);
  assert.deepEqual(process.stdin.eventNames().map(name => [name, process.stdin.listenerCount(name)]), inputListeners);
  assert.deepEqual(process.stdout.eventNames().map(name => [name, process.stdout.listenerCount(name)]), outputListeners);
});

test('HTTP still has no generator endpoint and cannot invoke terminal generation', async t => {
  const f = fixture(t);
  for (const path of ['/api/auth/create-pairing', '/api/auth/pairing', '/api/auth/generate']) {
    const response = await authRequest(f.securityStore, path, {});
    assert.equal(response.handled, false); assert.equal(response.body, undefined);
  }
  assert.equal(f.generated(), 0); assert.deepEqual(f.chunks, []);
});

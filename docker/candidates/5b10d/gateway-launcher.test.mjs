import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { selectFrontIPv4, startGateway, stopGateway, healthcheck } from './gateway-launcher.mjs';

const address = value => ({ address: value, family: 'IPv4', internal: false });
const front = { front0: [address('192.0.2.2')] };

class FakeServer extends EventEmitter {
  calls = [];
  listen(port, host) { this.calls.push([port, host]); this.emit('listening'); }
  close(callback) { this.closed = true; callback?.(); }
  closeAllConnections() { this.destroyed = true; }
}

test('A/E: FRONT selected even when UPSTREAM is enumerated first; defaults untouched', async () => {
  const server = new FakeServer();
  let options;
  const running = await startGateway({
    interfaces: { upstream0: [address('198.51.100.2')], ...front },
    createGateway: value => { options = value; return server; },
  });
  assert.equal(running.address, '192.0.2.2');
  assert.deepEqual(server.calls, [[8080, '192.0.2.2']]);
  assert.deepEqual(Object.keys(options).sort(), ['logger', 'upstreamHost', 'upstreamPort']);
  assert.equal(options.upstreamHost, 'host.docker.internal');
  assert.equal(options.upstreamPort, 11434);
  await stopGateway(server);
  assert.equal(server.closed, true);
});

for (const [name, interfaces] of [
  ['B: FRONT absent', {}],
  ['C: multiple FRONT IPv4 addresses', { front0: [address('192.0.2.2'), address('192.0.2.3')] }],
  ['D: only UPSTREAM', { upstream0: [address('198.51.100.2')] }],
  ['IPv6 only', { front0: [{ address: '2001:db8::1', family: 'IPv6', internal: false }] }],
  ['wildcard', { front0: [address('0.0.0.0')] }],
  ['loopback', { front0: [address('127.0.0.1')] }],
  ['internal', { front0: [{ ...address('192.0.2.2'), internal: true }] }],
]) {
  test(`${name}: no server constructed or listener opened`, async () => {
    let constructed = false;
    await assert.rejects(startGateway({ interfaces, createGateway: () => { constructed = true; } }));
    assert.equal(constructed, false);
  });
}

test('numeric family and IPv6 alongside exactly one IPv4 are supported', () => {
  assert.equal(selectFrontIPv4({ front0: [{ ...address('192.0.2.2'), family: 4 },
    { address: 'fe80::1', family: 'IPv6', internal: false }] }), '192.0.2.2');
});

test('F: asynchronous binding error closes server and exposes only a safe failure', async () => {
  const server = new FakeServer();
  server.listen = () => queueMicrotask(() => server.emit('error', new Error('private error detail')));
  await assert.rejects(startGateway({ interfaces: front, createGateway: () => server }),
    { message: 'FRONT_BIND_FAILED' });
  assert.equal(server.closed, true);
});

test('F: synchronous binding failure also fails closed', async () => {
  const server = new FakeServer();
  server.listen = () => { throw new Error('binding failed'); };
  await assert.rejects(startGateway({ interfaces: front, createGateway: () => server }),
    { message: 'FRONT_BIND_FAILED' });
  assert.equal(server.closed, true);
});

test('shutdown drains first, then closes remaining connections within the grace budget', async () => {
  const server = new FakeServer();
  let done;
  server.close = callback => { done = callback; };
  server.closeAllConnections = () => { server.destroyed = true; done(); };
  // Keep test alive while the production shutdown timer is intentionally unref'd.
  const hold = setTimeout(() => {}, 1000);
  try { await stopGateway(server, 5); } finally { clearTimeout(hold); }
  assert.equal(server.destroyed, true);
});

test('G: existing gateway contract and backend deadlines are unchanged', () => {
  const gateway = readFileSync(new URL('../../../proyectos/lab-ia-web/server/opencode-gateway.js',
    import.meta.url), 'utf8');
  assert.match(gateway, /const MODEL = 'qwen3:8b'/);
  assert.match(gateway, /maxConcurrent = 1/);
  assert.match(gateway, /totalMs = 105_000/);
  assert.match(gateway, /upstreamHeadersMs = 90_000/);
  assert.match(gateway, /streamIdleMs = 30_000/);
  const backend = readFileSync(new URL('../../../proyectos/lab-ia-web/server/index.js',
    import.meta.url), 'utf8');
  assert.match(backend, /'timeout', '-s', 'KILL', '110'/);
  assert.match(backend, /timeout: 120_000/);
});

test('CLI failure produces exit 1 without server startup or private diagnostics', () => {
  const child = spawnSync(process.execPath, [new URL('./gateway-launcher.mjs', import.meta.url).pathname,
    '--invalid'], { encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr.trim(), '{"event":"GATEWAY_START_FAILED"}');
});

function fakeHttp(status, body, capture = () => {}) {
  return (options, callback) => {
    capture(options);
    const request = new EventEmitter();
    request.destroy = error => request.emit('error', error);
    queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = status;
      callback(response);
      response.emit('data', Buffer.from(body));
      response.emit('end');
    });
    return request;
  };
}

test('healthcheck targets only FRONT and requires the gateway route denial', async () => {
  let request;
  await healthcheck('192.0.2.2', fakeHttp(404, '{"error":{"code":"ROUTE_DENIED"}}',
    options => { request = options; }));
  assert.deepEqual(request, { hostname: '192.0.2.2', port: 8080, path: '/api/tags',
    agent: false, timeout: 2000 });
});

test('healthcheck rejects arbitrary 404, unexpected success, malformed or oversized bodies', async () => {
  for (const [status, body] of [[404, '{}'], [200, '{}'], [404, '{'], [404, 'x'.repeat(513)]]) {
    await assert.rejects(healthcheck('192.0.2.2', fakeHttp(status, body)));
  }
});

test('healthcheck connection timeout is a failure', async () => {
  await assert.rejects(healthcheck('192.0.2.2', () => {
    const request = new EventEmitter();
    request.destroy = error => request.emit('error', error);
    queueMicrotask(() => request.emit('timeout'));
    return request;
  }));
});

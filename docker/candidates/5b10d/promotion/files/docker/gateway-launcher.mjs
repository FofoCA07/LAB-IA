import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { get } from 'node:http';
import { pathToFileURL } from 'node:url';

const FRONT = 'front0';
const PORT = 8080;

export function selectFrontIPv4(interfaces) {
  const addresses = (interfaces?.[FRONT] ?? [])
    .filter(entry => entry.family === 'IPv4' || entry.family === 4);
  if (addresses.length !== 1) throw new Error('FRONT_IPV4_REQUIRED');
  const entry = addresses[0];
  if (entry.internal !== false || isIP(entry.address) !== 4
    || ['0', '127'].includes(entry.address.split('.')[0])
    || Number(entry.address.split('.')[0]) >= 224
    || entry.address.startsWith('169.254.')) throw new Error('FRONT_IPV4_INVALID');
  return entry.address;
}

// Dependency injection is only an in-process test seam. CLI/env cannot select upstream.
export async function startGateway({ interfaces = networkInterfaces(), createGateway,
  logger = () => {} } = {}) {
  const address = selectFrontIPv4(interfaces); // Fail before constructing a server.
  const server = createGateway({ upstreamHost: 'host.docker.internal', upstreamPort: 11434,
    logger }); // Model, concurrency, sizes and timeouts remain module defaults.
  try {
    await new Promise((resolve, reject) => {
      const failed = error => { server.off('listening', ready); reject(error); };
      const ready = () => { server.off('error', failed); resolve(); };
      server.once('error', failed);
      server.once('listening', ready);
      server.listen(PORT, address);
    });
  } catch {
    server.close();
    throw new Error('FRONT_BIND_FAILED');
  }
  return { server, address };
}

export function stopGateway(server, graceMs = 25_000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => server.closeAllConnections(), graceMs);
    timer.unref();
    server.close(() => { clearTimeout(timer); resolve(); });
  });
}

export function healthcheck(address, httpGet = get) {
  return new Promise((resolve, reject) => {
    const request = httpGet({ hostname: address, port: PORT, path: '/api/tags',
      agent: false, timeout: 2000 }, response => {
      let body = '';
      response.on('data', chunk => {
        body += chunk.toString();
        if (body.length > 512) request.destroy(new Error('HEALTH_FAILED'));
      });
      response.once('error', reject);
      response.once('end', () => {
        try {
          if (response.statusCode !== 404
            || JSON.parse(body).error?.code !== 'ROUTE_DENIED') throw new Error();
          resolve();
        } catch { reject(new Error('HEALTH_FAILED')); }
      });
    });
    request.once('timeout', () => request.destroy(new Error('HEALTH_FAILED')));
    request.once('error', reject);
  });
}

async function main() {
  if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--healthcheck')) {
    throw new Error('INVALID_ARGUMENTS');
  }
  if (process.versions.node !== '22.23.4') throw new Error('NODE_VERSION_REQUIRED');
  if (process.argv[2] === '--healthcheck') {
    await healthcheck(selectFrontIPv4(networkInterfaces()));
    return;
  }
  const { createOpenCodeGateway } = await import('./opencode-gateway.mjs');
  // Native gateway logger emits only result/status/duration/bytes/reason.
  const logger = metadata => console.log(JSON.stringify(metadata));
  const { server } = await startGateway({ createGateway: createOpenCodeGateway, logger });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await stopGateway(server);
  };
  server.on('error', () => { process.exitCode = 1; void stop(); });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  console.log(JSON.stringify({ event: 'GATEWAY_READY', interface: FRONT, port: PORT }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(JSON.stringify({ event: 'GATEWAY_START_FAILED' }));
    process.exitCode = 1;
  });
}

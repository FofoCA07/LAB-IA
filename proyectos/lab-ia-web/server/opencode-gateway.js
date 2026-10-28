import { Buffer } from 'node:buffer';
import { createServer, request as httpRequest } from 'node:http';
import { isIP } from 'node:net';
import { Transform, pipeline } from 'node:stream';
import { TextDecoder } from 'node:util';

const PATH = '/v1/chat/completions';
const MODEL = 'qwen3:8b';
const JSON_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const own = (object, key) => Object.hasOwn(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
class Rejection extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const reject = (status = 400, code = 'INVALID_REQUEST') => { throw new Rejection(status, code); };
const requireValue = condition => { if (!condition) reject(); };
const keys = (value, allowed) => {
  requireValue(object(value));
  requireValue(Object.keys(value).every(key => allowed.includes(key)));
};

// JSON.parse owns syntax validation. This second pass only tracks containers and
// decoded object keys. Strings are tokens (including escaped quotes/backslashes),
// never searched using a duplicate-key regexp or a reviver.
function strictJson(text) {
  let value;
  try { value = JSON.parse(text); } catch { reject(); }
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}[\]:,]|[^\s{}[\]:,]+/g;
  const stack = [];
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    if (token === '{' || token === '[') {
      if (stack.length >= 64) reject(400, 'JSON_DEPTH');
      stack.push({ kind: token, keys: new Set(), expectKey: token === '{' });
    } else if (token === '}' || token === ']') {
      stack.pop();
    } else if (token === ',') {
      const frame = stack.at(-1);
      if (frame?.kind === '{') frame.expectKey = true;
    } else if (token.startsWith('"')) {
      const frame = stack.at(-1);
      if (frame?.kind === '{' && frame.expectKey) {
        const key = JSON.parse(token);
        if (frame.keys.has(key)) reject(400, 'DUPLICATE_KEY');
        frame.keys.add(key);
        frame.expectKey = false;
      }
    } else if (/^-?\d/.test(token) && !Number.isFinite(Number(token))) {
      reject();
    }
  }
  return value;
}

function validateSchema(schema) {
  requireValue(object(schema));
  // JSON schemas are opaque data except references: only local refs are allowed.
  const pending = [schema];
  while (pending.length) {
    const entry = pending.pop();
    if (object(entry) || Array.isArray(entry)) {
      if (own(entry, '$ref')) requireValue(typeof entry.$ref === 'string' && entry.$ref.startsWith('#'));
      if (own(entry, '$dynamicRef')) reject();
      if (own(entry, '$id') || own(entry, '$schema')) reject();
      pending.push(...Object.values(entry));
    }
  }
}
function validateFunction(fn) {
  keys(fn, ['name', 'description', 'parameters', 'strict']);
  requireValue(typeof fn.name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(fn.name));
  if (own(fn, 'description')) requireValue(typeof fn.description === 'string');
  if (own(fn, 'strict')) requireValue(typeof fn.strict === 'boolean');
  if (own(fn, 'parameters')) validateSchema(fn.parameters);
}
function validateMessage(message) {
  keys(message, ['role', 'content', 'tool_calls', 'tool_call_id', 'name']);
  requireValue(['system', 'user', 'assistant', 'tool'].includes(message.role));
  if (own(message, 'name')) requireValue(typeof message.name === 'string');
  if (own(message, 'tool_call_id')) {
    requireValue(message.role === 'tool' && typeof message.tool_call_id === 'string' && message.tool_call_id.length > 0);
  }
  if (message.role === 'tool') requireValue(own(message, 'tool_call_id'));
  if (own(message, 'tool_calls')) {
    requireValue(message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0);
    for (const call of message.tool_calls) {
      keys(call, ['id', 'type', 'function']);
      requireValue(typeof call.id === 'string' && call.id.length > 0 && call.type === 'function');
      keys(call.function, ['name', 'arguments']);
      requireValue(typeof call.function.name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(call.function.name));
      requireValue(typeof call.function.arguments === 'string');
    }
  }
  const content = message.content;
  if (typeof content === 'string') return;
  if (Array.isArray(content) && content.length > 0) {
    for (const part of content) {
      keys(part, ['type', 'text']);
      requireValue(part.type === 'text' && typeof part.text === 'string');
    }
    return;
  }
  requireValue(message.role === 'assistant' && own(message, 'tool_calls')
    && (content === null || !own(message, 'content')));
}
function validateBody(body) {
  const allowed = ['model', 'messages', 'stream', 'stream_options', 'temperature', 'top_p',
    'max_tokens', 'stop', 'tools', 'tool_choice', 'response_format'];
  keys(body, allowed);
  requireValue(own(body, 'model') && body.model === MODEL);
  requireValue(Array.isArray(body.messages) && body.messages.length > 0);
  body.messages.forEach(validateMessage);
  if (own(body, 'stream')) requireValue(typeof body.stream === 'boolean');
  if (own(body, 'stream_options')) {
    keys(body.stream_options, ['include_usage']);
    requireValue(body.stream === true && typeof body.stream_options.include_usage === 'boolean');
  }
  for (const [key, min, max] of [['temperature', 0, 2], ['top_p', 0, 1], ['max_tokens', 1, 2147483647]]) {
    if (own(body, key)) requireValue(typeof body[key] === 'number' && Number.isFinite(body[key])
      && body[key] >= min && body[key] <= max && (key !== 'max_tokens' || Number.isInteger(body[key])));
  }
  if (own(body, 'stop')) requireValue(typeof body.stop === 'string'
    || (Array.isArray(body.stop) && body.stop.length <= 4 && body.stop.every(v => typeof v === 'string')));
  if (own(body, 'tools')) {
    requireValue(Array.isArray(body.tools));
    for (const tool of body.tools) {
      keys(tool, ['type', 'function']);
      requireValue(tool.type === 'function');
      validateFunction(tool.function);
    }
  }
  if (own(body, 'tool_choice')) {
    if (typeof body.tool_choice === 'string') requireValue(['auto', 'none', 'required'].includes(body.tool_choice));
    else {
      keys(body.tool_choice, ['type', 'function']);
      keys(body.tool_choice.function, ['name']);
      requireValue(body.tool_choice.type === 'function' && typeof body.tool_choice.function.name === 'string'
        && body.tools?.some(tool => tool.function.name === body.tool_choice.function.name));
    }
  }
  if (own(body, 'response_format')) {
    const format = body.response_format;
    keys(format, ['type', 'json_schema']);
    requireValue(['text', 'json_object', 'json_schema'].includes(format.type));
    if (format.type === 'json_schema') {
      keys(format.json_schema, ['name', 'description', 'strict', 'schema']);
      requireValue(typeof format.json_schema.name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(format.json_schema.name));
      if (own(format.json_schema, 'description')) requireValue(typeof format.json_schema.description === 'string');
      if (own(format.json_schema, 'strict')) requireValue(typeof format.json_schema.strict === 'boolean');
      validateSchema(format.json_schema.schema);
    } else requireValue(!own(format, 'json_schema'));
  }
  return { ...body, model: MODEL };
}

function sseValidator(maxBytes, maxEventBytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = ''; let size = 0; let done = false;
  function consume(stream, final = false) {
    for (;;) {
      const separator = /\r?\n\r?\n/.exec(pending);
      if (!separator) break;
      const frame = pending.slice(0, separator.index);
      const boundary = separator.index + separator[0].length;
      const raw = pending.slice(0, boundary);
      pending = pending.slice(boundary);
      if (Buffer.byteLength(frame) > maxEventBytes || done) throw new Error('INVALID_SSE');
      const lines = frame.split(/\r?\n/);
      if (!lines.every(line => line === '' || line.startsWith('data:'))) throw new Error('INVALID_SSE');
      const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (data === '[DONE]') done = true;
      else {
        const event = JSON.parse(data);
        if (!object(event) || own(event, 'error') || !Array.isArray(event.choices)) throw new Error('INVALID_SSE');
      }
      stream.push(Buffer.from(raw));
    }
    if (Buffer.byteLength(pending) > maxEventBytes || (final && (pending.length || !done))) throw new Error('INVALID_SSE');
  }
  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        size += chunk.length;
        if (size > maxBytes) throw new Error('RESPONSE_LIMIT');
        pending += decoder.decode(chunk, { stream: true });
        consume(this); callback();
      } catch { callback(new Error('INVALID_UPSTREAM_STREAM')); }
    },
    flush(callback) {
      try { pending += decoder.decode(); consume(this, true); callback(); }
      catch { callback(new Error('INVALID_UPSTREAM_STREAM')); }
    },
  });
}

/** Returns an unstarted native HTTP server. Operator options never come from HTTP. */
export function createOpenCodeGateway({ upstreamHost, upstreamPort, logger = () => {},
  maxBodyBytes = 2 * 1024 * 1024, maxResponseBytes = 2 * 1024 * 1024,
  maxStreamBytes = 32 * 1024 * 1024, maxEventBytes = 256 * 1024, maxConcurrent = 1,
  incomingHeadersMs = 10_000, incomingBodyMs = 10_000, upstreamHeadersMs = 90_000,
  streamIdleMs = 30_000, totalMs = 105_000 } = {}) {
  if (typeof upstreamHost !== 'string' || !(isIP(upstreamHost) || /^[a-zA-Z0-9.-]+$/.test(upstreamHost))
    || !Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535
    || typeof logger !== 'function') throw new TypeError('Invalid gateway configuration');
  for (const limit of [maxBodyBytes, maxResponseBytes, maxStreamBytes, maxEventBytes, maxConcurrent,
    incomingHeadersMs, incomingBodyMs, upstreamHeadersMs, streamIdleMs, totalMs]) {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new TypeError('Invalid gateway limit');
  }
  if (maxBodyBytes > 2 * 1024 * 1024) throw new TypeError('Body limit exceeds ceiling');
  let active = 0;
  const headerTimers = new WeakMap();
  const connectionStarts = new WeakMap();
  const log = entry => { try { logger(Object.freeze(entry)); } catch { /* Logging cannot break policy. */ } };
  const server = createServer({ maxHeaderSize: 16 * 1024, insecureHTTPParser: false }, (req, res) => {
    clearTimeout(headerTimers.get(req.socket));
    const started = connectionStarts.get(req.socket) ?? Date.now();
    let upstream; let upstreamResponse; let bytes = 0; let responseBytes = 0;
    let acquired = false; let finished = false; let allowed = false;
    let bodyTimer; let headersTimer; let idleTimer; let totalTimer;
    const finish = (status, reason) => {
      if (finished) return;
      finished = true;
      for (const timer of [bodyTimer, headersTimer, idleTimer, totalTimer]) clearTimeout(timer);
      if (acquired) { active--; acquired = false; }
      log({ result: allowed ? 'allow' : 'deny', status, duration: Date.now() - started,
        bytes, responseBytes, reason });
    };
    const fail = (status, code) => {
      if (finished) return;
      finish(status, code);
      upstream?.destroy(); upstreamResponse?.destroy(); req.pause();
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(status, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(JSON.stringify({ error: { message: 'Gateway request failed.', code } }));
    };
    res.once('close', () => {
      if (!res.writableFinished) { upstream?.destroy(); upstreamResponse?.destroy(); finish(499, 'CLIENT_DISCONNECTED'); }
    });
    req.once('error', () => fail(400, 'INVALID_REQUEST'));
    totalTimer = setTimeout(() => fail(504, 'TOTAL_TIMEOUT'), Math.max(1, totalMs - (Date.now() - started)));
    (async () => {
      if (req.method !== 'POST' || req.url !== PATH) reject(404, 'ROUTE_DENIED');
      if (active >= maxConcurrent) reject(429, 'BUSY');
      const singleton = new Set();
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i].toLowerCase();
        if (['host', 'content-type', 'content-length', 'transfer-encoding', 'content-encoding'].includes(name)) {
          if (singleton.has(name)) reject(400, 'INVALID_HEADERS');
          singleton.add(name);
        }
      }
      if (!singleton.has('host')) reject(400, 'INVALID_HEADERS');
      if (!JSON_TYPE.test(req.headers['content-type'] ?? '')) reject(415, 'JSON_REQUIRED');
      if (own(req.headers, 'content-encoding') || own(req.headers, 'trailer') || own(req.headers, 'expect')
        || own(req.headers, 'upgrade') || /(?:^|,)\s*upgrade\s*(?:,|$)/i.test(req.headers.connection ?? '')) reject(400, 'INVALID_HEADERS');
      if (req.headers['transfer-encoding'] && req.headers['transfer-encoding'].toLowerCase() !== 'chunked') reject(400, 'INVALID_HEADERS');
      if (req.headers['content-length'] && Number(req.headers['content-length']) > maxBodyBytes) reject(413, 'BODY_LIMIT');
      active++; acquired = true;
      bodyTimer = setTimeout(() => fail(408, 'BODY_TIMEOUT'), incomingBodyMs);
      const chunks = [];
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        if (finished) return;
        bytes += chunk.length;
        if (bytes > maxBodyBytes) reject(413, 'BODY_LIMIT');
        chunks.push(chunk);
      }
      clearTimeout(bodyTimer);
      if (finished) return;
      if (Object.keys(req.trailers).length) reject(400, 'INVALID_HEADERS');
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks, bytes)); }
      catch { reject(400, 'INVALID_UTF8'); }
      const body = validateBody(strictJson(text));
      const serialized = Buffer.from(JSON.stringify(body));
      allowed = true;
      headersTimer = setTimeout(() => fail(504, 'UPSTREAM_HEADERS_TIMEOUT'), upstreamHeadersMs);
      upstream = httpRequest({ hostname: upstreamHost, port: upstreamPort, path: PATH, method: 'POST', agent: false,
        maxHeaderSize: 16 * 1024,
        headers: { 'Content-Type': 'application/json', Accept: body.stream ? 'text/event-stream' : 'application/json',
          'Content-Length': serialized.length } }, response => {
        upstreamResponse = response;
        clearTimeout(headersTimer);
        if (finished) { response.destroy(); return; }
        const status = response.statusCode;
        if (status !== 200) {
          fail(status >= 400 && status <= 599 ? status : 502, 'UPSTREAM_REJECTED'); return;
        }
        const type = response.headers['content-type'] ?? '';
        if (body.stream ? !/^text\/event-stream(?:\s*;\s*charset=utf-8)?$/i.test(type) : !JSON_TYPE.test(type)) {
          fail(502, 'UPSTREAM_CONTENT_TYPE'); return;
        }
        const resetIdle = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => fail(504, 'UPSTREAM_IDLE_TIMEOUT'), streamIdleMs);
        };
        resetIdle();
        response.on('data', chunk => { responseBytes += chunk.length; resetIdle(); });
        response.once('error', () => fail(502, 'UPSTREAM_DISCONNECTED'));
        if (body.stream) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'close' });
          const validator = sseValidator(maxStreamBytes, maxEventBytes);
          // Record a validation failure before pipeline destroys the client socket;
          // otherwise its close event looks like a client-initiated cancellation.
          validator.once('error', () => fail(502, 'UPSTREAM_STREAM_ERROR'));
          pipeline(response, validator, res, error => {
            if (error) fail(502, 'UPSTREAM_STREAM_ERROR');
            else finish(200, 'OK');
          });
        } else {
          const chunks = []; let size = 0;
          response.on('data', chunk => {
            size += chunk.length;
            if (size > maxResponseBytes) fail(502, 'UPSTREAM_RESPONSE_LIMIT');
            else chunks.push(chunk);
          });
          response.once('end', () => {
            if (finished) return;
            try {
              const data = strictJson(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
              if (!object(data) || own(data, 'error') || !Array.isArray(data.choices)) throw new Error();
              const output = JSON.stringify(data);
              res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' });
              res.end(output); finish(200, 'OK');
            } catch { fail(502, 'UPSTREAM_INVALID_JSON'); }
          });
        }
      });
      upstream.once('error', () => fail(502, 'UPSTREAM_UNAVAILABLE'));
      upstream.end(serialized);
    })().catch(error => fail(error instanceof Rejection ? error.status : 400,
      error instanceof Rejection ? error.code : 'INVALID_REQUEST'));
  });
  server.maxRequestsPerSocket = 1;
  server.requestTimeout = 0; // Absolute per-request timers above cover body and total.
  server.headersTimeout = incomingHeadersMs;
  server.on('connection', socket => {
    connectionStarts.set(socket, Date.now());
    const timer = setTimeout(() => socket.destroy(), Math.min(incomingHeadersMs, totalMs));
    headerTimers.set(socket, timer);
    socket.once('close', () => clearTimeout(timer));
  });
  const denySocket = socket => {
    clearTimeout(headerTimers.get(socket));
    log({ result: 'deny', status: 400, duration: 0, bytes: 0, responseBytes: 0, reason: 'INVALID_HTTP' });
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  };
  server.on('connect', (req, socket) => denySocket(socket));
  server.on('upgrade', (req, socket) => denySocket(socket));
  server.on('checkContinue', (req, res) => { clearTimeout(headerTimers.get(req.socket)); res.writeHead(417, { Connection: 'close' }); res.end(); });
  server.on('checkExpectation', (req, res) => { clearTimeout(headerTimers.get(req.socket)); res.writeHead(417, { Connection: 'close' }); res.end(); });
  server.on('clientError', (error, socket) => { if (socket.writable) denySocket(socket); else socket.destroy(); });
  return server;
}

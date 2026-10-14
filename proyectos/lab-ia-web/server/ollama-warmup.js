import { ollamaProposalConfig, maxOllamaResponseBytes } from './ollama-proposal.js';

const unavailable = () => Object.freeze({ code: 'OLLAMA_UNAVAILABLE', error: 'Ollama no está disponible.' });
const timeout = () => Object.freeze({ code: 'OLLAMA_TIMEOUT', error: 'Ollama excedió el tiempo máximo.' });

export function createOllamaWarmup({ fetchImpl = globalThis.fetch, timeoutMs = 180_000,
  onState = () => {}, now = Date.now } = {}) {
  let state = 'idle';
  let pending;
  let started = false;
  let readyUntil = 0;
  function transition(next) {
    state = next;
    try { onState(next); } catch { /* Logging cannot affect availability. */ }
  }
  function ensureReady() {
    if (state === 'ready' && now() >= readyUntil) transition('idle');
    if (state === 'loading' || state === 'ready') return pending;
    transition('loading');
    // Defer execution so pending is assigned even for a synchronously failing fetch.
    pending = Promise.resolve().then(async () => {
      const controller = new AbortController();
      let timer;
      let response;
      const operation = async () => {
        response = await fetchImpl(`${ollamaProposalConfig.baseUrl}/api/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ model: ollamaProposalConfig.model, messages: [], stream: false, keep_alive: '1h' }),
          signal: controller.signal, redirect: 'error',
        });
        if (controller.signal.aborted || !response.ok || !response.body) throw unavailable();
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.split(';')[0].trim().toLowerCase() !== 'application/json') throw unavailable();
        const reader = response.body.getReader();
        const chunks = []; let size = 0;
        const cancel = () => { void reader.cancel().catch(() => {}); };
        controller.signal.addEventListener('abort', cancel, { once: true });
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (controller.signal.aborted) throw unavailable();
            if (done) break;
            size += value.byteLength;
            if (size > maxOllamaResponseBytes) throw unavailable();
            chunks.push(value);
          }
          const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
          if (data?.model !== ollamaProposalConfig.model || data.done !== true || data.error !== undefined) throw unavailable();
        } finally {
          controller.signal.removeEventListener('abort', cancel);
          reader.releaseLock();
        }
      };
      try {
        await Promise.race([operation(), new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, timeoutMs);
        })]);
        readyUntil = now() + 3_600_000;
        transition('ready');
      } catch {
        transition('failed');
        throw unavailable();
      } finally {
        clearTimeout(timer);
        controller.abort();
        if (!response?.body?.locked) void response?.body?.cancel().catch(() => {});
      }
    });
    // Startup is fire-and-forget; always observe rejection without changing the shared promise.
    void pending.catch(() => {});
    return pending;
  }
  return Object.freeze({
    get state() { return state; },
    ensureReady,
    start() {
      if (!started) { started = true; return ensureReady(); }
      return pending;
    },
  });
}

// Per-request deadline never aborts a warmup shared with other requests.
export async function waitForOllamaWarmup(warmup, deadline) {
  const remaining = deadline - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) throw timeout();
  let timer;
  try {
    await Promise.race([warmup.ensureReady(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeout()), remaining);
    })]);
  } catch (error) {
    throw error?.code === 'OLLAMA_TIMEOUT' ? timeout() : unavailable();
  } finally { clearTimeout(timer); }
}

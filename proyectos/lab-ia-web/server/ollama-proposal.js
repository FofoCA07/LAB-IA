export const ollamaProposalConfig = Object.freeze({
  baseUrl: 'http://127.0.0.1:11434',
  model: 'qwen3:8b',
});
export const maxOllamaResponseBytes = 1024 * 1024;

const messagesByCode = Object.freeze({
  OLLAMA_UNAVAILABLE: 'Ollama no está disponible.',
  OLLAMA_TIMEOUT: 'Ollama excedió el tiempo máximo.',
  OLLAMA_BAD_RESPONSE: 'Ollama no devolvió una respuesta válida.',
  OLLAMA_RESPONSE_TOO_LARGE: 'La respuesta de Ollama excedió el tamaño máximo.',
});
// Plain records intentionally exclude stack, cause and external error details.
const safeFailures = new WeakSet();
const failure = (code) => {
  const error = Object.freeze({ code, error: messagesByCode[code] });
  safeFailures.add(error);
  return error;
};
const badResponse = () => failure('OLLAMA_BAD_RESPONSE');

/**
 * Ollama 0.30.8 ChatRequest officially supports `format`: "json" or a JSON
 * schema object. Default to JSON; proposal/schema validation belongs upstream.
 * https://github.com/ollama/ollama/blob/v0.30.8/api/types.go
 * No messages, responses or process errors are logged or retained by this module.
 * This transport does not guarantee identical outputs across model executions.
 */
export async function generateOllamaProposal({ messages, deadline, timeoutMs, format = 'json' } = {},
  { fetchImpl = globalThis.fetch } = {}) {
  let body;
  let budget;
  try {
    if (!Array.isArray(messages) || messages.length === 0
      || !messages.every((message) => message && typeof message === 'object'
        && Object.keys(message).length === 2
        && ['system', 'user', 'assistant'].includes(message.role)
        && typeof message.content === 'string')) throw badResponse();
    if (format !== 'json' && (!format || typeof format !== 'object' || Array.isArray(format))) {
      throw badResponse();
    }
    if ((deadline === undefined && timeoutMs === undefined)
      || (deadline !== undefined && !Number.isFinite(deadline))
      || (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0))) {
      throw badResponse();
    }
    budget = Math.min(deadline === undefined ? Infinity : deadline - Date.now(),
      timeoutMs === undefined ? Infinity : timeoutMs);
    if (budget > 2_147_483_647) throw badResponse();
    body = JSON.stringify({ model: ollamaProposalConfig.model,
      messages: messages.map(({ role, content }) => ({ role, content })), stream: false, format, keep_alive: '1h' });
  } catch {
    throw badResponse();
  }
  if (budget <= 0) throw failure('OLLAMA_TIMEOUT');

  const controller = new AbortController();
  let timer;
  const expiration = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(failure('OLLAMA_TIMEOUT'));
    }, budget);
  });
  const operation = async () => {
    let response;
    try {
      response = await fetchImpl(`${ollamaProposalConfig.baseUrl}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body, signal: controller.signal, redirect: 'error',
      });
    } catch {
      throw failure(controller.signal.aborted ? 'OLLAMA_TIMEOUT' : 'OLLAMA_UNAVAILABLE');
    }
    try {
      if (!response.ok) throw failure('OLLAMA_UNAVAILABLE');
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.split(';')[0].trim().toLowerCase() !== 'application/json') {
        throw badResponse();
      }
      const length = response.headers.get('content-length');
      if (length && /^\d+$/.test(length) && Number(length) > maxOllamaResponseBytes) {
        throw failure('OLLAMA_RESPONSE_TOO_LARGE');
      }
      if (!response.body) throw badResponse();
      const chunks = [];
      let size = 0;
      const reader = response.body.getReader();
      const cancelRead = () => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener('abort', cancelRead, { once: true });
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted) throw failure('OLLAMA_TIMEOUT');
          if (done) break;
          size += value.byteLength;
          if (size > maxOllamaResponseBytes) throw failure('OLLAMA_RESPONSE_TOO_LARGE');
          chunks.push(value);
        }
      } finally {
        controller.signal.removeEventListener('abort', cancelRead);
        reader.releaseLock();
      }
      let chat;
      try {
        chat = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
      } catch {
        throw badResponse();
      }
      if (chat?.error !== undefined || chat?.model !== ollamaProposalConfig.model || chat?.done !== true
        || chat?.message?.role !== 'assistant' || typeof chat.message.content !== 'string'
        || !chat.message.content.trim()
        || (chat.message.tool_calls !== undefined
          && (!Array.isArray(chat.message.tool_calls) || chat.message.tool_calls.length !== 0))) {
        throw badResponse();
      }
      return chat.message.content;
    } catch (error) {
      // Only records created here may escape. No body or external errors survive.
      if (controller.signal.aborted) throw failure('OLLAMA_TIMEOUT');
      if (safeFailures.has(error)) throw failure(error.code);
      throw badResponse();
    } finally {
      // Also stop unread bodies on HTTP/header rejection or oversized responses.
      if (!response?.body?.locked) await response?.body?.cancel().catch(() => {});
    }
  };
  try {
    return await Promise.race([operation(), expiration]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

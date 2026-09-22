(function (global) {
  const Errors = global.AISummaryErrors || (typeof require === 'function' ? require('./errors.js') : null);

  function tryParseJson(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function normalizePreview(raw) {
    return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  }

  function getEndpointHost(runtime) {
    try {
      return new URL(String(runtime?.baseUrl || '')).host || '';
    } catch {
      return '';
    }
  }

  function buildContext(runtime, stage) {
    return {
      provider: runtime?.provider || '',
      endpointMode: runtime?.endpointMode || '',
      stage: stage || '',
      endpointHost: getEndpointHost(runtime)
    };
  }

  function buildResponsesFallbackHint(runtime) {
    return runtime?.provider === 'openai' && runtime?.endpointMode === 'responses'
      ? '如果这是 OpenAI 兼容网关，可尝试切换到 `/chat/completions`。'
      : '';
  }

  function createTransportError(code, runtime, stage, detail, message, extra) {
    const payload = Object.assign({
      detail: String(detail || '').trim(),
      message,
      endpointHost: getEndpointHost(runtime)
    }, buildContext(runtime, stage), extra || {});
    return Errors.createError(code, payload);
  }

  // Parses a Retry-After header value (delay-seconds or HTTP-date) into
  // milliseconds, clamped to maxMs. Returns null when absent/unparseable.
  function parseRetryAfterMs(value, maxMs) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const cap = Number(maxMs) > 0 ? Number(maxMs) : Infinity;

    if (/^\d+$/.test(raw)) {
      return Math.min(Number(raw) * 1000, cap);
    }

    const date = Date.parse(raw);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(date - Date.now(), 0), cap);
    }

    return null;
  }

  // Retry delay: honor the server-provided Retry-After when present, else
  // exponential backoff with full jitter (random within [0, ceiling]) so many
  // clients retrying after an outage do not synchronize.
  function computeRetryDelayMs(options) {
    const config = options || {};
    const attempt = Number(config.attempt) > 0 ? Number(config.attempt) : 1;
    const baseDelayMs = Number(config.baseDelayMs) > 0 ? Number(config.baseDelayMs) : 1000;
    const maxDelayMs = Number(config.maxDelayMs) > 0 ? Number(config.maxDelayMs) : 8000;
    const maxRetryAfterMs = Number(config.maxRetryAfterMs) > 0 ? Number(config.maxRetryAfterMs) : 30000;
    const jitter = typeof config.jitter === 'function' ? config.jitter : Math.random;

    const retryAfterRaw = config.retryAfterMs;
    const retryAfterMs = retryAfterRaw === null || retryAfterRaw === undefined ? NaN : Number(retryAfterRaw);
    if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
      return Math.min(retryAfterMs, maxRetryAfterMs);
    }

    const ceiling = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
    return Math.round(jitter() * ceiling);
  }

  function isLikelyResponsesCompatibilityFailure(status, body, runtime) {    if (runtime?.endpointMode !== 'responses') return false;

    const text = String(body || '').toLowerCase();
    if (status === 404) return true;

    return [
      'not supported',
      'unsupported',
      'unknown url',
      'unknown path',
      'no route matched',
      'unrecognized request argument supplied: input',
      'unknown parameter: input',
      'messages is required',
      'missing required parameter: messages',
      'must provide messages',
      'expected messages',
      'chat/completions',
      'does not exist'
    ].some((needle) => text.includes(needle));
  }

  function createEndpointCompatibilityError(status, body, runtime, stage) {
    const hint = buildResponsesFallbackHint(runtime);
    const baseMessage = runtime?.endpointMode === 'responses'
      ? '当前接口可能不支持 `/responses`。'
      : '当前接口可能不支持所选接口路径。';

    return createTransportError(
      Errors.ERROR_CODES.ENDPOINT_NOT_SUPPORTED,
      runtime,
      stage,
      String(body || '').trim().slice(0, 300),
      hint ? (baseMessage + ' ' + hint) : baseMessage,
      { httpStatus: status, retriable: false }
    );
  }

  function normalizeTransportError(error, runtime, stage, options) {
    const config = options || {};
    const context = buildContext(runtime, stage);

    if (error?.code && error?.message) {
      return Errors.normalizeError(error, error.code, context);
    }

    if (error?.name === 'AbortError') {
      const code = config.runCancelled ? Errors.ERROR_CODES.RUN_CANCELLED : Errors.ERROR_CODES.NETWORK_TIMEOUT;
      return Errors.createError(code, Object.assign({ detail: error.message || '' }, context));
    }

    const detail = String(config.detail || error?.message || error || '').trim();
    const lowerDetail = detail.toLowerCase();
    const fallbackHint = buildResponsesFallbackHint(runtime);

    if (config.reason === 'stream_disconnected' || detail === 'stream_disconnected') {
      const message = fallbackHint
        ? '流式连接意外中断，当前接口可能只部分兼容 Responses/SSE。 ' + fallbackHint
        : '流式连接意外中断，请检查接口的流式支持或网关稳定性。';
      return createTransportError(Errors.ERROR_CODES.NETWORK_STREAM_DISCONNECTED, runtime, stage, detail, message);
    }

    if (/cors|cross-origin|cross origin|access-control-allow-origin|preflight/.test(lowerDetail)) {
      return createTransportError(
        Errors.ERROR_CODES.NETWORK_CORS_ERROR,
        runtime,
        stage,
        detail,
        '浏览器拦截了跨域请求，请检查接口的 CORS、扩展权限或代理配置。',
        { retriable: false }
      );
    }

    if (/dns|enotfound|nxdomain|name not resolved|getaddrinfo|err_name_not_resolved/.test(lowerDetail)) {
      return createTransportError(
        Errors.ERROR_CODES.NETWORK_DNS_ERROR,
        runtime,
        stage,
        detail,
        '无法解析接口域名，请检查接口地址、DNS 或代理配置。'
      );
    }

    if (/ssl|tls|certificate|err_cert|err_ssl|handshake/.test(lowerDetail)) {
      return createTransportError(
        Errors.ERROR_CODES.NETWORK_TLS_ERROR,
        runtime,
        stage,
        detail,
        '接口 TLS/证书握手失败，请检查 HTTPS 证书、代理或中间网关。'
      );
    }

    if (/connection refused|connection reset|connection closed|econnrefused|econnreset|err_connection_|failed to fetch|network|load failed/.test(lowerDetail)) {
      const message = fallbackHint
        ? '无法建立到当前接口的网络连接，请检查网关可用性、证书或浏览器拦截。 ' + fallbackHint
        : '无法建立到接口的网络连接，请检查网络、网关或代理。';
      return createTransportError(Errors.ERROR_CODES.NETWORK_CONNECTION_ERROR, runtime, stage, detail, message);
    }

    return Errors.normalizeError(error, Errors.ERROR_CODES.UNKNOWN_ERROR, context);
  }

  function createSseParser(onEvent) {
    let buffer = '';
    let eventName = '';
    let dataLines = [];

    function flushEvent() {
      const payload = dataLines.join('\n').trim();
      const currentEvent = eventName || 'message';
      eventName = '';
      dataLines = [];

      if (!payload) return;
      onEvent(currentEvent, payload);
    }

    return {
      push(chunk, isFinal) {
        buffer += String(chunk || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        while (buffer.includes('\n')) {
          const lineBreakIndex = buffer.indexOf('\n');
          const line = buffer.slice(0, lineBreakIndex);
          buffer = buffer.slice(lineBreakIndex + 1);

          if (!line) {
            flushEvent();
            continue;
          }

          if (line.startsWith(':')) continue;

          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
            continue;
          }

          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
          }
        }

        if (isFinal) {
          if (buffer.trim()) {
            const line = buffer.trim();
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            }
          }
          buffer = '';
          flushEvent();
        }
      }
    };
  }

  function extractTextFromRawBody(rawBody, adapter, runtime) {
    const trimmed = String(rawBody || '').trim();
    if (!trimmed) return '';

    const parsed = tryParseJson(trimmed);
    if (parsed) {
      return adapter.extractText(parsed, runtime);
    }

    let text = '';
    const blocks = trimmed.split(/\n\s*\n/);
    for (const block of blocks) {
      const lines = block.split('\n');
      let eventName = '';
      const dataLines = [];

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }

      const data = dataLines.join('\n').trim();
      if (!data || data === '[DONE]') continue;

      const json = tryParseJson(data);
      if (!json) continue;

      text += adapter.extractDelta(json, runtime, eventName) || '';
      if (!text) {
        text = adapter.extractText(json, runtime) || text;
      }
    }

    return text;
  }

  function extractUsageFromRawBody(rawBody, adapter, runtime) {
    const trimmed = String(rawBody || '').trim();
    if (!trimmed) return null;

    const parsed = tryParseJson(trimmed);
    if (parsed) {
      return adapter.extractUsage(parsed, runtime);
    }

    let usage = null;
    const blocks = trimmed.split(/\n\s*\n/);
    for (const block of blocks) {
      const dataLine = block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n')
        .trim();

      if (!dataLine || dataLine === '[DONE]') continue;

      const json = tryParseJson(dataLine);
      if (!json) continue;
      usage = adapter.extractUsage(json, runtime) || usage;
    }

    return usage;
  }

  function toSerializableValue(value, seen) {
    if (value === null) return null;

    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') return value;
    if (type === 'bigint') return String(value);
    if (type === 'undefined' || type === 'function' || type === 'symbol') return null;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      return value.map((item) => toSerializableValue(item, seen));
    }

    if (type !== 'object') {
      return String(value);
    }

    if (seen.has(value)) {
      return '[Circular]';
    }

    seen.add(value);

    if (value instanceof Error) {
      const serializedError = {
        name: value.name || 'Error',
        message: value.message || String(value),
        stack: value.stack || ''
      };
      seen.delete(value);
      return serializedError;
    }

    const output = {};
    Object.keys(value).forEach((key) => {
      const next = toSerializableValue(value[key], seen);
      if (typeof next !== 'undefined') {
        output[key] = next;
      }
    });

    seen.delete(value);
    return output;
  }

  function createTransportPayload(payload) {
    return toSerializableValue(payload, new WeakSet());
  }

  function sanitizeErrorForTransport(errorLike) {
    if (!errorLike) return null;

    const normalized = Errors.normalizeError(errorLike, errorLike?.code, {});
    const safeError = {
      code: normalized.code || Errors.ERROR_CODES.UNKNOWN_ERROR,
      message: normalized.message || '',
      retriable: !!normalized.retriable,
      detail: normalized.detail || '',
      stage: normalized.stage || '',
      provider: normalized.provider || '',
      endpointMode: normalized.endpointMode || ''
    };

    if (errorLike?.status) safeError.status = errorLike.status;
    if (errorLike?.name) safeError.name = errorLike.name;

    return createTransportPayload(safeError);
  }

  function sanitizeDiagnosticsForTransport(diagnostics) {
    if (!diagnostics) return null;

    const safeDiagnostics = Object.assign({}, diagnostics);

    // Remove sensitive fields that could expose user configuration
    delete safeDiagnostics.baseUrl;  // Custom API endpoints
    delete safeDiagnostics.family;   // Internal adapter family classification

    safeDiagnostics.lastError = diagnostics.lastError ? sanitizeErrorForTransport(diagnostics.lastError) : null;
    return createTransportPayload(safeDiagnostics);
  }

  function safePortPost(port, payload) {
    if (!port) return false;
    try {
      port.postMessage(createTransportPayload(payload));
      return true;
    } catch (error) {
      console.warn('[Yilan] Failed to post message to stream port.', error);
      return false;
    }
  }

  function safeSendResponse(sendResponse, payload) {
    if (typeof sendResponse !== 'function') return false;
    try {
      sendResponse(createTransportPayload(payload));
      return true;
    } catch (error) {
      console.warn('[Yilan] Failed to send runtime response.', error);
      try {
        sendResponse({ success: false, error: 'response_serialization_failed' });
      } catch {}
      return false;
    }
  }

  // Streams deliver hundreds of small deltas; posting one port message per
  // token amplifies IPC and serialization cost on both sides of the channel.
  // The batcher coalesces deltas and flushes them as a single 'tokens'
  // message on a short interval aligned with the sidebar's render cadence.
  function createTokenBatcher(postMessage, flushIntervalMs) {
    let buffer = '';
    let timer = null;
    let active = true;

    function flush() {
      timer = null;
      if (!active || !buffer) return;
      const batch = buffer;
      buffer = '';
      postMessage({ type: 'tokens', tokens: batch });
    }

    return {
      push(token) {
        if (!active) return;
        buffer += String(token || '');
        if (!timer) {
          timer = setTimeout(flush, flushIntervalMs);
        }
      },
      // Terminal transitions (done/cancelled/error) flush immediately so
      // trailing tokens cannot be dropped or arrive after the terminal
      // message.
      flushNow() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        flush();
        active = false;
      },
      // A provider retry restarts generation from scratch; buffered deltas
      // from the failed attempt must be dropped, never flushed.
      discard() {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        buffer = '';
        timer = null;
      }
    };
  }

  const api = {
    normalizePreview,
    tryParseJson,
    toSerializableValue,
    createTransportPayload,
    sanitizeErrorForTransport,
    sanitizeDiagnosticsForTransport,
    safePortPost,
    safeSendResponse,
    createTokenBatcher,
    createSseParser,
    extractTextFromRawBody,
    extractUsageFromRawBody,
    normalizeTransportError,
    parseRetryAfterMs,
    computeRetryDelayMs,
    isLikelyResponsesCompatibilityFailure,
    createEndpointCompatibilityError
  };

  global.AISummaryTransportUtils = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

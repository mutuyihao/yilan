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

  function isLikelyResponsesCompatibilityFailure(status, body, runtime) {
    if (runtime?.endpointMode !== 'responses') return false;

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

  const api = {
    normalizePreview,
    createSseParser,
    extractTextFromRawBody,
    extractUsageFromRawBody,
    normalizeTransportError,
    isLikelyResponsesCompatibilityFailure,
    createEndpointCompatibilityError
  };

  global.AISummaryTransportUtils = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

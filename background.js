importScripts(
  'shared/domain.js',
  'shared/errors.js',
  'shared/provider-presets.js',
  'shared/constants.js',
  'shared/adapter-utils.js',
  'adapters/openai-adapter.js',
  'adapters/anthropic-adapter.js',
  'adapters/registry.js'
);

importScripts(
  'shared/abort-utils.js',
  'shared/transport-utils.js',
  'background/run-state.js',
  'background/reader-sessions.js',
  'background/entrypoints.js'
);

const AbortUtils = self.AISummaryAbortUtils;
const Domain = self.AISummaryDomain;
const Errors = self.AISummaryErrors;
const Constants = self.AISummaryConstants;
const AdapterRegistry = self.AISummaryAdapterRegistry;
const TransportUtils = self.AISummaryTransportUtils;
const RunState = self.YilanRunState;
const ReaderSessions = self.YilanReaderSessions;
const Entrypoints = self.YilanEntrypoints;

const CONTENT_SCRIPT_FILES = [
  'shared/domain.js',
  'shared/strings.js',
  'shared/page-strategy.js',
  'shared/article-utils.js',
  'shared/constants.js',
  'libs/readability.js',
  'content.js'
];

function createTab(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url }, (tab) => {
      const error = chrome.runtime.lastError?.message || '';
      resolve({
        success: !error,
        error,
        tab: tab || null
      });
    });
  });
}

async function safeInjectAndRun(tab, action) {
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: CONTENT_SCRIPT_FILES
      });
    } catch (error) {
      console.error('[Yilan] Failed to inject content script.', error);
      return;
    }
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { action });
  } catch (error) {
    console.error('[Yilan] Failed to trigger content action.', error);
  }
}

Entrypoints.bindEntrypoints({
  logger: console,
  onTrigger: safeInjectAndRun
});

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildErrorContext(runtime, stage) {
  return {
    provider: runtime?.provider || '',
    endpointMode: runtime?.endpointMode || '',
    stage: stage || ''
  };
}

function createDiagnostics(runId, runtime, meta) {
  return {
    runId,
    stage: meta?.stage || 'primary',
    provider: runtime?.provider || '',
    adapterId: runtime?.adapterId || '',
    family: runtime?.family || '',
    endpointMode: runtime?.endpointMode || '',
    baseUrl: runtime?.baseUrl || '',
    model: runtime?.model || runtime?.defaultModel || '',
    startedAt: new Date().toISOString(),
    chunkIndex: typeof meta?.chunkIndex === 'number' ? meta.chunkIndex : null,
    chunkCount: typeof meta?.chunkCount === 'number' ? meta.chunkCount : null,
    articleId: meta?.articleId || '',
    transportMode: '',
    httpStatus: null,
    responseContentType: '',
    requestId: '',
    retryCount: 0,
    attemptCount: 0,
    usage: null,
    preview: '',
    lastError: null,
    status: 'running'
  };
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

function readRuntimeLastErrorMessage() {
  return chrome.runtime.lastError?.message || '';
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

function normalizeRuntimeError(error, runtime, stage, runId, options) {
  return TransportUtils.normalizeTransportError(error, runtime, stage, Object.assign({
    runCancelled: RunState.isRunCancelled(runId)
  }, options || {}));
}

async function consumeNonStreamResponse(response, adapter, runtime, signal) {
  const rawBody = await AbortUtils.raceWithAbort(response.text(), signal).catch((error) => {
    if (AbortUtils.isAbortError(error)) {
      throw error;
    }
    return '';
  });
  AbortUtils.throwIfAborted(signal);
  const text = TransportUtils.extractTextFromRawBody(rawBody, adapter, runtime);
  const usage = TransportUtils.extractUsageFromRawBody(rawBody, adapter, runtime);

  return {
    text: text || '',
    usage: usage || null,
    preview: TransportUtils.normalizePreview(rawBody)
  };
}

async function consumeStreamResponse(response, adapter, runtime, onToken, signal) {
  if (!response.body) {
    return {
      text: '',
      usage: null,
      preview: ''
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rawBody = '';
  let text = '';
  let usage = null;
  let abortError = null;

  function handleAbort() {
    abortError = AbortUtils.toAbortError(signal);
    try {
      reader.cancel(abortError);
    } catch (error) {
      console.warn('[Background] Failed to cancel stream reader:', error);
    }
  }

  if (signal?.aborted) {
    handleAbort();
  } else {
    signal?.addEventListener('abort', handleAbort, { once: true });
  }

  const parser = TransportUtils.createSseParser((eventName, rawData) => {
    if (!rawData || rawData === '[DONE]') return;

    const json = tryParseJson(rawData);
    if (!json) return;

    usage = adapter.extractUsage(json, runtime) || usage;

    const delta = adapter.extractDelta(json, runtime, eventName);
    if (delta) {
      AbortUtils.throwIfAborted(signal);
      text += delta;
      onToken(delta);
      return;
    }

    const finalText = adapter.extractText(json, runtime);
    if (finalText && !text) {
      AbortUtils.throwIfAborted(signal);
      text = finalText;
      onToken(finalText);
    }
  });

  try {
    while (true) {
      AbortUtils.throwIfAborted(signal);
      // Keep the native reader cadence for smoother token delivery; abort is handled via reader.cancel().
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      rawBody += chunk;
      parser.push(chunk, false);
    }

    AbortUtils.throwIfAborted(signal);
    const tail = decoder.decode();
    if (tail) {
      rawBody += tail;
      parser.push(tail, false);
    }

    AbortUtils.throwIfAborted(signal);
    parser.push('', true);

    if (!text) {
      text = TransportUtils.extractTextFromRawBody(rawBody, adapter, runtime);
    }

    return {
      text: text || '',
      usage: usage || TransportUtils.extractUsageFromRawBody(rawBody, adapter, runtime),
      preview: TransportUtils.normalizePreview(rawBody)
    };
  } catch (error) {
    if (signal?.aborted && !AbortUtils.isAbortError(error) && abortError) {
      throw abortError;
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', handleAbort);
    try {
      reader.releaseLock();
    } catch {}
  }
}

async function executeRun(options) {
  const settings = options.settings || {};
  const prompt = String(options.prompt || '');
  const runId = options.runId || Domain.createRuntimeId('run');
  const stream = !!options.stream;
  const meta = options.meta || {};

  if (!settings.apiKey) {
    throw Errors.createError(Errors.ERROR_CODES.CONFIG_MISSING_API_KEY, { stage: meta.stage || '' });
  }

  const resolution = AdapterRegistry.resolve(settings);
  if (!resolution) {
    throw Errors.createError(Errors.ERROR_CODES.ADAPTER_NOT_FOUND, { stage: meta.stage || '' });
  }

  const adapter = resolution.adapter;
  const runtime = resolution.snapshot;
  const diagnostics = createDiagnostics(runId, runtime, meta);
  diagnostics.transportMode = stream ? 'stream' : 'request';
  const maxRetries = runtime.retryPolicy?.maxRetries || Constants.DEFAULT_MAX_RETRIES;
  const timeoutMs = runtime.timeoutMs || Constants.DEFAULT_REQUEST_TIMEOUT_MS;
  const startedAt = Date.now();

  RunState.prepareRun(runId, {
    portId: options.portId || '',
    stage: meta.stage || 'primary',
    runtime
  });

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    if (RunState.isRunCancelled(runId)) {
      const cancelled = Errors.createError(Errors.ERROR_CODES.RUN_CANCELLED, buildErrorContext(runtime, meta.stage));
      cancelled.diagnostics = sanitizeDiagnosticsForTransport(diagnostics);
      throw cancelled;
    }

    diagnostics.attemptCount = attempt;
    diagnostics.httpStatus = null;
    diagnostics.responseContentType = '';
    diagnostics.requestId = '';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
    RunState.setRunController(runId, controller);

    try {
      const response = await AbortUtils.raceWithAbort(fetch(runtime.baseUrl, {
        method: 'POST',
        headers: adapter.buildHeaders(settings, runtime, stream),
        body: JSON.stringify(adapter.buildBody({ settings, prompt, runtime, stream, meta })),
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit'
      }), controller.signal);

      clearTimeout(timeout);
      diagnostics.httpStatus = response.status;
      diagnostics.responseContentType = response.headers.get('content-type') || '';
      diagnostics.requestId = response.headers.get('x-request-id') || '';

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        if (TransportUtils.isLikelyResponsesCompatibilityFailure(response.status, errorText, runtime)) {
          throw TransportUtils.createEndpointCompatibilityError(response.status, errorText, runtime, meta.stage);
        }
        throw Errors.createHttpError(response.status, errorText, Object.assign({
          responseContentType: diagnostics.responseContentType,
          requestId: diagnostics.requestId
        }, buildErrorContext(runtime, meta.stage)));
      }

      const result = stream
        ? await consumeStreamResponse(response, adapter, runtime, options.onToken || (() => {}), controller.signal)
        : await consumeNonStreamResponse(response, adapter, runtime, controller.signal);

      AbortUtils.throwIfAborted(controller.signal);

      if (!result.text.trim()) {
        throw Errors.createError(
          Errors.ERROR_CODES.UNSUPPORTED_RESPONSE_FORMAT,
          Object.assign({ detail: result.preview || 'empty_response' }, buildErrorContext(runtime, meta.stage))
        );
      }

      diagnostics.status = 'completed';
      diagnostics.retryCount = diagnostics.retryCount;
      diagnostics.durationMs = Date.now() - startedAt;
      diagnostics.completedAt = new Date().toISOString();
      diagnostics.preview = result.preview || '';
      diagnostics.usage = result.usage || null;

      RunState.finishRun(runId);

      return {
        success: true,
        runId,
        text: result.text,
        usage: result.usage || null,
        diagnostics
      };
    } catch (error) {
      clearTimeout(timeout);
      let normalized = normalizeRuntimeError(error, runtime, meta.stage, runId, { stream });
      diagnostics.lastError = sanitizeErrorForTransport(normalized);

      if (normalized.code === Errors.ERROR_CODES.RUN_CANCELLED) {
        RunState.setRunController(runId, null);
        diagnostics.status = 'cancelled';
        diagnostics.durationMs = Date.now() - startedAt;
        diagnostics.completedAt = new Date().toISOString();
        RunState.finishRun(runId);
        normalized.diagnostics = sanitizeDiagnosticsForTransport(diagnostics);
        throw normalized;
      }

      const shouldRetry = normalized.retriable && attempt < maxRetries;
      if (shouldRetry) {
        const delay = Math.min(Constants.RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1), Constants.RETRY_MAX_DELAY_MS);
        diagnostics.retryCount += 1;
        options.onRetry?.({ attempt, delay, error: normalized });
        const retryController = controller.signal.aborted ? new AbortController() : controller;
        if (retryController !== controller) {
          RunState.setRunController(runId, retryController);
        }

        try {
          await AbortUtils.waitWithAbort(delay, retryController.signal);
          RunState.setRunController(runId, null);
          continue;
        } catch (retryError) {
          RunState.setRunController(runId, null);
          normalized = normalizeRuntimeError(retryError, runtime, meta.stage, runId, { stream });
          diagnostics.lastError = sanitizeErrorForTransport(normalized);

          if (normalized.code === Errors.ERROR_CODES.RUN_CANCELLED) {
            diagnostics.status = 'cancelled';
            diagnostics.durationMs = Date.now() - startedAt;
            diagnostics.completedAt = new Date().toISOString();
            RunState.finishRun(runId);
            normalized.diagnostics = sanitizeDiagnosticsForTransport(diagnostics);
            throw normalized;
          }
        }
      }

      RunState.setRunController(runId, null);
      diagnostics.status = 'failed';
      diagnostics.durationMs = Date.now() - startedAt;
      diagnostics.completedAt = new Date().toISOString();
      RunState.finishRun(runId);
      normalized.diagnostics = sanitizeDiagnosticsForTransport(diagnostics);
      throw normalized;
    }
  }

  RunState.finishRun(runId);
  throw Errors.createError(Errors.ERROR_CODES.UNKNOWN_ERROR, { stage: meta.stage || '' });
}

async function handleStreamStart(port, portId, message) {
  const runId = message.runId || Domain.createRuntimeId('run');

  safePortPost(port, {
    type: 'started',
    runId,
    diagnostics: {
      runId,
      stage: message.meta?.stage || 'primary',
      status: 'starting'
    }
  });

  try {
    const result = await executeRun({
      settings: message.settings,
      prompt: message.prompt,
      runId,
      stream: true,
      meta: message.meta,
      portId,
      onToken(token) {
        safePortPost(port, { type: 'token', runId, token });
      },
      onRetry(payload) {
        safePortPost(port, { type: 'retry', runId, retry: payload });
      }
    });

    safePortPost(port, {
      type: 'done',
      runId,
      text: result.text,
      usage: result.usage,
      diagnostics: result.diagnostics
    });
  } catch (error) {
    const normalized = Errors.normalizeError(error, error?.code, error);
    const messageType = normalized.code === Errors.ERROR_CODES.RUN_CANCELLED ? 'cancelled' : 'error';
    safePortPost(port, {
      type: messageType,
      runId,
      error: normalized,
      diagnostics: error?.diagnostics || null
    });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai-stream') return;

  const portId = Domain.createRuntimeId('port');

  port.onMessage.addListener((message) => {
    if (message.action === 'startStream') {
      handleStreamStart(port, portId, message);
      return;
    }

    if (message.action === 'cancelRun' && message.runId) {
      safePortPost(port, {
        type: 'cancelAck',
        runId: message.runId,
        success: RunState.cancelRun(message.runId, 'user')
      });
    }
  });

  port.onDisconnect.addListener(() => {
    readRuntimeLastErrorMessage();
    RunState.cancelPortRuns(portId);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const rawSendResponse = sendResponse;
  sendResponse = (payload) => safeSendResponse(rawSendResponse, payload);

  if (message.action === 'testConnection') {
    const runId = Domain.createRuntimeId('test');
    executeRun({
      settings: message.settings,
      prompt: 'Please reply with OK only.',
      runId,
      stream: false,
      meta: { stage: 'test' }
    }).then((result) => {
      sendResponse({ success: true, diagnostics: result.diagnostics, text: result.text });
    }).catch((error) => {
      const normalized = Errors.normalizeError(error, error?.code, error);
      sendResponse({
        success: false,
        error: normalized,
        diagnostics: error?.diagnostics || null
      });
    });
    return true;
  }

  if (message.action === 'runPrompt') {
    executeRun({
      settings: message.settings,
      prompt: message.prompt,
      runId: message.runId,
      stream: false,
      meta: message.meta || {}
    }).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      const normalized = Errors.normalizeError(error, error?.code, error);
      sendResponse({
        success: false,
        runId: message.runId,
        error: normalized,
        diagnostics: error?.diagnostics || null
      });
    });
    return true;
  }

  if (message.action === 'cancelRun') {
    sendResponse({
      success: RunState.cancelRun(message.runId, 'user')
    });
    return false;
  }

  if (message.action === 'triggerHistory') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (tab) {
        await safeInjectAndRun(tab, 'showHistory');
      }
      sendResponse({ success: true });
    }).catch((error) => {
      sendResponse({ success: false, error: String(error?.message || error || '') });
    });
    return true;
  }

  if (message.action === 'getEntrypointStatus') {
    Entrypoints.getEntrypointStatus().then((entrypoints) => {
      sendResponse({ success: true, entrypoints });
    }).catch((error) => {
      sendResponse({
        success: false,
        error: String(error?.message || error || '获取入口状态失败。')
      });
    });
    return true;
  }

  if (message.action === 'openShortcutSettings') {
    Entrypoints.openShortcutSettings().then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({
        success: false,
        error: String(error?.message || error || '打开快捷键设置失败。'),
        url: Entrypoints.SHORTCUT_SETTINGS_URL
      });
    });
    return true;
  }

  if (message.action === 'openReaderTab') {
    ReaderSessions.createReaderSession(message.snapshot || null).then((sessionId) => {
      const url = chrome.runtime.getURL('reader.html?session=' + encodeURIComponent(sessionId));
      return createTab(url).then((result) => ({
        success: result.success,
        error: result.error,
        url,
        sessionId
      }));
    }).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse({
        success: false,
        error: String(error?.message || error || '打开阅读页失败。')
      });
    });
    return true;
  }

  return false;
});

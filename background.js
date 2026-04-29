importScripts(
  'shared/domain.js',
  'shared/errors.js',
  'shared/provider-presets.js',
  'adapters/openai-adapter.js',
  'adapters/anthropic-adapter.js',
  'adapters/registry.js'
);

importScripts('shared/abort-utils.js', 'shared/transport-utils.js');

const AbortUtils = self.AISummaryAbortUtils;
const Domain = self.AISummaryDomain;
const Errors = self.AISummaryErrors;
const AdapterRegistry = self.AISummaryAdapterRegistry;
const TransportUtils = self.AISummaryTransportUtils;

const CONTENT_SCRIPT_FILES = [
  'shared/domain.js',
  'shared/strings.js',
  'shared/page-strategy.js',
  'shared/article-utils.js',
  'libs/readability.js',
  'content.js'
];

const SUMMARY_CONTEXT_MENU_ID = 'summarizeArticle';
const SUMMARY_COMMAND_ID = 'trigger-summary';
const ENTRYPOINT_STATUS_KEY = 'entrypointStatus';
const READER_SESSION_PREFIX = 'readerSession:';
const READER_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SHORTCUT_SETTINGS_URL = /\bEdg\//.test(self.navigator?.userAgent || '')
  ? 'edge://extensions/shortcuts'
  : 'chrome://extensions/shortcuts';

const activeRuns = new Map();
const portRuns = new Map();

function storageLocalGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (items) => resolve(items || {}));
  });
}

function storageLocalSet(payload) {
  return new Promise((resolve) => {
    chrome.storage.local.set(payload, resolve);
  });
}

function storageLocalRemove(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

function contextMenusRemoveAll() {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      resolve(chrome.runtime.lastError?.message || '');
    });
  });
}

function contextMenuCreate(payload) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(payload, () => {
      resolve(chrome.runtime.lastError?.message || '');
    });
  });
}

function commandsGetAll() {
  return new Promise((resolve) => {
    chrome.commands.getAll((commands) => resolve(Array.isArray(commands) ? commands : []));
  });
}

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

function createDefaultEntrypointStatus() {
  return {
    browserShortcutSettingsUrl: SHORTCUT_SETTINGS_URL,
    contextMenu: {
      id: SUMMARY_CONTEXT_MENU_ID,
      status: 'unknown',
      lastEnsuredAt: '',
      lastTriggeredAt: '',
      lastCheckedAt: '',
      lastError: ''
    },
    shortcut: {
      command: SUMMARY_COMMAND_ID,
      status: 'unknown',
      shortcut: '',
      lastTriggeredAt: '',
      lastCheckedAt: '',
      conflictStatus: 'unknown',
      note: ''
    }
  };
}

async function cleanupReaderSessions() {
  const items = await storageLocalGet(null);
  const now = Date.now();
  const staleKeys = Object.entries(items || {})
    .filter(([key, value]) => {
      if (!String(key || '').startsWith(READER_SESSION_PREFIX)) return false;
      const createdAt = new Date(value?.createdAt || 0).getTime();
      return !createdAt || Number.isNaN(createdAt) || (now - createdAt) > READER_SESSION_MAX_AGE_MS;
    })
    .map(([key]) => key);

  if (staleKeys.length) {
    await storageLocalRemove(staleKeys);
  }
}

async function createReaderSession(snapshot) {
  await cleanupReaderSessions();
  const sessionId = Domain.createRuntimeId('reader');
  const key = READER_SESSION_PREFIX + sessionId;
  await storageLocalSet({
    [key]: {
      createdAt: new Date().toISOString(),
      snapshot: snapshot || null
    }
  });
  return sessionId;
}

async function readEntrypointStatus() {
  const items = await storageLocalGet(ENTRYPOINT_STATUS_KEY);
  const defaults = createDefaultEntrypointStatus();
  const stored = items[ENTRYPOINT_STATUS_KEY] || {};
  return {
    browserShortcutSettingsUrl: SHORTCUT_SETTINGS_URL,
    contextMenu: Object.assign({}, defaults.contextMenu, stored.contextMenu || {}),
    shortcut: Object.assign({}, defaults.shortcut, stored.shortcut || {})
  };
}

async function updateEntrypointStatus(patch) {
  const current = await readEntrypointStatus();
  const next = {
    browserShortcutSettingsUrl: SHORTCUT_SETTINGS_URL,
    contextMenu: Object.assign({}, current.contextMenu, patch?.contextMenu || {}),
    shortcut: Object.assign({}, current.shortcut, patch?.shortcut || {})
  };
  await storageLocalSet({ [ENTRYPOINT_STATUS_KEY]: next });
  return next;
}

async function ensureContextMenuRegistered(reason) {
  const checkedAt = new Date().toISOString();
  const removeError = await contextMenusRemoveAll();
  const createError = await contextMenuCreate({
    id: SUMMARY_CONTEXT_MENU_ID,
    title: '用一览总结此页',
    contexts: ['page', 'selection', 'link']
  });

  const error = createError || removeError;
  return updateEntrypointStatus({
    contextMenu: {
      id: SUMMARY_CONTEXT_MENU_ID,
      status: error ? 'error' : 'ready',
      lastEnsuredAt: checkedAt,
      lastCheckedAt: checkedAt,
      lastError: error ? '[' + reason + '] ' + error : ''
    }
  });
}

async function refreshShortcutStatus() {
  const checkedAt = new Date().toISOString();
  const commands = await commandsGetAll();
  const command = commands.find((item) => item.name === SUMMARY_COMMAND_ID) || null;
  const shortcut = command?.shortcut || '';
  const status = !command ? 'missing' : shortcut ? 'assigned' : 'unassigned';
  const note = !command
    ? 'manifest 中未找到 trigger-summary 快捷键。'
    : shortcut
      ? '浏览器已分配快捷键；如果按下无响应，请前往快捷键设置页重新绑定。'
      : '当前没有检测到已生效的快捷键，可能未分配或与其它快捷键冲突。';

  return updateEntrypointStatus({
    shortcut: {
      command: SUMMARY_COMMAND_ID,
      status,
      shortcut,
      lastCheckedAt: checkedAt,
      conflictStatus: shortcut ? 'unknown' : 'possible_or_unassigned',
      note
    }
  });
}

async function getEntrypointStatus() {
  await ensureContextMenuRegistered('status_check');
  return refreshShortcutStatus();
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenuRegistered('installed').catch((error) => {
    console.warn('[Yilan] Failed to register context menu on install.', error);
  });
  refreshShortcutStatus().catch((error) => {
    console.warn('[Yilan] Failed to refresh shortcut status on install.', error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenuRegistered('startup').catch((error) => {
    console.warn('[Yilan] Failed to register context menu on startup.', error);
  });
  refreshShortcutStatus().catch((error) => {
    console.warn('[Yilan] Failed to refresh shortcut status on startup.', error);
  });
});

ensureContextMenuRegistered('service_worker_started').catch((error) => {
  console.warn('[Yilan] Failed to register context menu on service worker start.', error);
});

refreshShortcutStatus().catch((error) => {
  console.warn('[Yilan] Failed to refresh shortcut status on service worker start.', error);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== SUMMARY_CONTEXT_MENU_ID) return;
  updateEntrypointStatus({
    contextMenu: {
      status: 'ready',
      lastTriggeredAt: new Date().toISOString()
    }
  }).catch(() => {});
  await safeInjectAndRun(tab, 'extractAndSummarize');
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== SUMMARY_COMMAND_ID) return;
  updateEntrypointStatus({
    shortcut: {
      status: 'assigned',
      lastTriggeredAt: new Date().toISOString()
    }
  }).catch(() => {});
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    await safeInjectAndRun(tab, 'extractAndSummarize');
  }
});

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

function ensurePortRunSet(portId) {
  if (!portRuns.has(portId)) {
    portRuns.set(portId, new Set());
  }
  return portRuns.get(portId);
}

function prepareRun(runId, payload) {
  const next = Object.assign({ runId, cancelled: false, controller: null }, activeRuns.get(runId) || {}, payload || {});
  activeRuns.set(runId, next);

  if (next.portId) {
    ensurePortRunSet(next.portId).add(runId);
  }

  return next;
}

function setRunController(runId, controller) {
  const entry = activeRuns.get(runId);
  if (!entry) return;
  entry.controller = controller || null;
  activeRuns.set(runId, entry);
}

function isRunCancelled(runId) {
  return !!activeRuns.get(runId)?.cancelled;
}

function cancelRun(runId, reason) {
  const entry = activeRuns.get(runId);
  if (!entry) return false;

  entry.cancelled = true;
  entry.cancelReason = reason || 'user';
  activeRuns.set(runId, entry);

  try {
    entry.controller?.abort(reason || 'user');
  } catch {}

  return true;
}

function finishRun(runId) {
  const entry = activeRuns.get(runId);
  if (entry?.portId) {
    const ids = portRuns.get(entry.portId);
    if (ids) {
      ids.delete(runId);
      if (!ids.size) {
        portRuns.delete(entry.portId);
      }
    }
  }

  activeRuns.delete(runId);
}

function cancelPortRuns(portId) {
  const ids = Array.from(portRuns.get(portId) || []);
  ids.forEach((runId) => cancelRun(runId, 'port_disconnected'));
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
    runCancelled: isRunCancelled(runId)
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
    } catch {}
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
  const maxRetries = runtime.retryPolicy?.maxRetries || 3;
  const timeoutMs = runtime.timeoutMs || 90000;
  const startedAt = Date.now();

  prepareRun(runId, {
    portId: options.portId || '',
    stage: meta.stage || 'primary',
    runtime
  });

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    if (isRunCancelled(runId)) {
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
    setRunController(runId, controller);

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

      finishRun(runId);

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
        setRunController(runId, null);
        diagnostics.status = 'cancelled';
        diagnostics.durationMs = Date.now() - startedAt;
        diagnostics.completedAt = new Date().toISOString();
        finishRun(runId);
        normalized.diagnostics = sanitizeDiagnosticsForTransport(diagnostics);
        throw normalized;
      }

      const shouldRetry = normalized.retriable && attempt < maxRetries;
      if (shouldRetry) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
        diagnostics.retryCount += 1;
        options.onRetry?.({ attempt, delay, error: normalized });
        const retryController = controller.signal.aborted ? new AbortController() : controller;
        if (retryController !== controller) {
          setRunController(runId, retryController);
        }

        try {
          await AbortUtils.waitWithAbort(delay, retryController.signal);
          setRunController(runId, null);
          continue;
        } catch (retryError) {
          setRunController(runId, null);
          normalized = normalizeRuntimeError(retryError, runtime, meta.stage, runId, { stream });
          diagnostics.lastError = sanitizeErrorForTransport(normalized);

          if (normalized.code === Errors.ERROR_CODES.RUN_CANCELLED) {
            diagnostics.status = 'cancelled';
            diagnostics.durationMs = Date.now() - startedAt;
            diagnostics.completedAt = new Date().toISOString();
            finishRun(runId);
            normalized.diagnostics = sanitizeDiagnosticsForTransport(diagnostics);
            throw normalized;
          }
        }
      }

      setRunController(runId, null);
      diagnostics.status = 'failed';
      diagnostics.durationMs = Date.now() - startedAt;
      diagnostics.completedAt = new Date().toISOString();
      finishRun(runId);
      normalized.diagnostics = sanitizeDiagnosticsForTransport(diagnostics);
      throw normalized;
    }
  }

  finishRun(runId);
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
        success: cancelRun(message.runId, 'user')
      });
    }
  });

  port.onDisconnect.addListener(() => {
    readRuntimeLastErrorMessage();
    cancelPortRuns(portId);
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
      success: cancelRun(message.runId, 'user')
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
    getEntrypointStatus().then((entrypoints) => {
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
    createTab(SHORTCUT_SETTINGS_URL).then((result) => {
      sendResponse({
        success: result.success,
        error: result.error,
        url: SHORTCUT_SETTINGS_URL
      });
    }).catch((error) => {
      sendResponse({
        success: false,
        error: String(error?.message || error || '打开快捷键设置失败。'),
        url: SHORTCUT_SETTINGS_URL
      });
    });
    return true;
  }

  if (message.action === 'openReaderTab') {
    createReaderSession(message.snapshot || null).then((sessionId) => {
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



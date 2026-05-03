importScripts(
  'shared/domain.js',
  'shared/errors.js',
  'shared/provider-presets.js',
  'shared/constants.js',
  'shared/adapter-utils.js',
  'shared/url-utils.js',
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

const AUTO_ENDPOINT_CACHE_STORAGE_KEY = 'yilanAutoEndpointModeCacheV1';
let autoEndpointModeCache = null;
let autoEndpointModeCacheLoad = null;

const MODELS_CACHE_STORAGE_KEY = 'yilanModelsCacheV1';
let modelsCache = null;
let modelsCacheLoad = null;

function loadAutoEndpointModeCache() {
  if (autoEndpointModeCache) return Promise.resolve(autoEndpointModeCache);
  if (autoEndpointModeCacheLoad) return autoEndpointModeCacheLoad;

  autoEndpointModeCacheLoad = new Promise((resolve) => {
    chrome.storage.local.get([AUTO_ENDPOINT_CACHE_STORAGE_KEY], (items) => {
      const raw = items?.[AUTO_ENDPOINT_CACHE_STORAGE_KEY];
      autoEndpointModeCache = raw && typeof raw === 'object' ? raw : {};
      resolve(autoEndpointModeCache);
    });
  });

  return autoEndpointModeCacheLoad;
}

function normalizeOpenAiBaseRootForCache(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // Normalize by stripping common endpoint suffixes and removing hash/search.
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.search = '';
    let path = String(parsed.pathname || '').replace(/\/+$/g, '');
    path = path
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/responses$/i, '')
      .replace(/\/completions$/i, '');
    parsed.pathname = path || '/';
    return parsed.toString().replace(/\/$/g, '');
  } catch {
    return raw
      .replace(/\/+$/g, '')
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/responses$/i, '')
      .replace(/\/completions$/i, '')
      .toLowerCase();
  }
}

function getAutoEndpointModeCacheKey(settings) {
  const provider = String(settings?.aiProvider || '').toLowerCase();
  if (provider !== 'openai') return '';

  const baseUrl = String(settings?.aiBaseURL || '').trim() || 'https://api.openai.com/v1';
  const baseRoot = normalizeOpenAiBaseRootForCache(baseUrl);
  return baseRoot ? provider + '|' + baseRoot : '';
}

async function getCachedAutoEndpointMode(cacheKey) {
  if (!cacheKey) return '';
  const cache = await loadAutoEndpointModeCache();
  const value = cache?.[cacheKey];
  return typeof value === 'string' ? value : '';
}

async function setCachedAutoEndpointMode(cacheKey, mode) {
  if (!cacheKey || !mode) return;
  const cache = await loadAutoEndpointModeCache();
  if (cache?.[cacheKey] === mode) return;
  cache[cacheKey] = mode;

  await new Promise((resolve) => {
    chrome.storage.local.set({ [AUTO_ENDPOINT_CACHE_STORAGE_KEY]: cache }, () => resolve());
  });
}

function loadModelsCache() {
  if (modelsCache) return Promise.resolve(modelsCache);
  if (modelsCacheLoad) return modelsCacheLoad;

  modelsCacheLoad = new Promise((resolve) => {
    chrome.storage.local.get([MODELS_CACHE_STORAGE_KEY], (items) => {
      const raw = items?.[MODELS_CACHE_STORAGE_KEY];
      modelsCache = raw && typeof raw === 'object' ? raw : {};
      resolve(modelsCache);
    });
  });

  return modelsCacheLoad;
}

function getModelsCacheKey(settings, runtime) {
  const provider = String(settings?.aiProvider || '').toLowerCase();
  if (!provider) return '';

  const baseUrl = String(runtime?.baseUrl || settings?.aiBaseURL || '').trim() || (provider === 'openai' ? 'https://api.openai.com/v1' : '');
  if (!baseUrl) return provider;

  const baseRoot = normalizeOpenAiBaseRootForCache(baseUrl);
  return baseRoot ? provider + '|' + baseRoot.toLowerCase() : provider;
}

function normalizeModelsCacheEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const models = Array.isArray(entry.models) ? entry.models.filter((id) => typeof id === 'string' && id.trim()) : [];
  if (!models.length) return null;

  return {
    fetchedAt: String(entry.fetchedAt || ''),
    models
  };
}

async function setCachedModels(cacheKey, entry) {
  if (!cacheKey) return;

  const cache = await loadModelsCache();
  const normalized = normalizeModelsCacheEntry(entry);
  if (!normalized) return;

  cache[cacheKey] = normalized;

  const entries = Object.entries(cache);
  if (entries.length > 20) {
    entries
      .sort((a, b) => String(b?.[1]?.fetchedAt || '').localeCompare(String(a?.[1]?.fetchedAt || '')))
      .slice(20)
      .forEach(([key]) => {
        try {
          delete cache[key];
        } catch {}
      });
  }

  await new Promise((resolve) => {
    chrome.storage.local.set({ [MODELS_CACHE_STORAGE_KEY]: cache }, () => resolve());
  });
}

function createErrorResponse(error, fallbackMessage, additionalFields = {}) {
  const normalized = Errors.normalizeError(error, error?.code, error);
  return {
    success: false,
    error: normalized,
    ...additionalFields
  };
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

function isAutoEndpointNotSupportedError(errorLike) {
  const code = String(errorLike?.code || '');
  if (code === Errors.ERROR_CODES.ENDPOINT_NOT_SUPPORTED) return true;
  if (code === Errors.ERROR_CODES.UNSUPPORTED_RESPONSE_FORMAT) return true;
  if (code === Errors.ERROR_CODES.HTTP_ERROR) {
    const status = Number(errorLike?.httpStatus || errorLike?.status || 0);
    if (status === 404) return true;

    // Some gateways return 400/405 with a "route/path not found" style payload instead of 404.
    if (status === 400 || status === 405) {
      const detail = String(errorLike?.detail || errorLike?.message || '').toLowerCase();
      return [
        'unknown url',
        'unknown path',
        'no route matched',
        'route not found',
        'cannot post',
        'cannot get',
        'page not found'
      ].some((needle) => detail.includes(needle));
    }

    return false;
  }
  return false;
}

function normalizeUrlNoTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function looksLikeOpenAiEndpointUrl(value) {
  const lowerValue = normalizeUrlNoTrailingSlash(value).toLowerCase();
  return (
    lowerValue.endsWith('/chat/completions') ||
    lowerValue.endsWith('/responses') ||
    lowerValue.endsWith('/completions')
  );
}

function toggleTrailingV1(value) {
  const normalized = normalizeUrlNoTrailingSlash(value);
  if (!normalized) return normalized;
  if (/\/v1$/i.test(normalized)) {
    return normalized.replace(/\/v1$/i, '');
  }
  return normalized + '/v1';
}

async function consumeNonStreamResponse(response, adapter, runtime, signal) {
  const rawBody = await AbortUtils.raceWithAbort(response.text(), signal).catch((error) => {
    if (AbortUtils.isAbortError(error)) {
      throw error;
    }
    console.error('[Yilan] Failed to read response body, using empty string.', error);
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

  const isOpenAiProvider = String(settings?.aiProvider || 'openai').toLowerCase() === 'openai';
  const wantsAutoEndpointMode = isOpenAiProvider && String(settings?.endpointMode || '').trim() === 'auto';
  const autoEndpointCacheKey = wantsAutoEndpointMode ? getAutoEndpointModeCacheKey(settings) : '';
  const cachedEndpointMode = wantsAutoEndpointMode ? await getCachedAutoEndpointMode(autoEndpointCacheKey) : '';
  let effectiveSettings = settings;
  if (wantsAutoEndpointMode && cachedEndpointMode) {
    effectiveSettings = Object.assign({}, settings, { endpointMode: cachedEndpointMode });
  }

  const normalizedBaseUrlInput = normalizeUrlNoTrailingSlash(effectiveSettings?.aiBaseURL || '');
  const canTryV1Toggle = isOpenAiProvider && !!normalizedBaseUrlInput && !looksLikeOpenAiEndpointUrl(normalizedBaseUrlInput);
  const autoBaseUrlTried = canTryV1Toggle ? new Set([normalizedBaseUrlInput]) : null;

  const autoEndpointCandidates = wantsAutoEndpointMode
    ? ['responses', 'chat_completions', 'legacy_completions']
    : [];
  const autoEndpointTried = wantsAutoEndpointMode ? new Set() : null;

  let resolution = AdapterRegistry.resolve(effectiveSettings);
  if (!resolution) {
    throw Errors.createError(Errors.ERROR_CODES.ADAPTER_NOT_FOUND, { stage: meta.stage || '' });
  }

  let adapter = resolution.adapter;
  let runtime = resolution.snapshot;
  if (autoEndpointTried) autoEndpointTried.add(runtime?.endpointMode || '');
  const diagnostics = createDiagnostics(runId, runtime, meta);
  diagnostics.transportMode = stream ? 'stream' : 'request';
  if (wantsAutoEndpointMode) {
    diagnostics.requestedEndpointMode = 'auto';
    diagnostics.autoEndpointCacheHit = !!cachedEndpointMode;
    diagnostics.autoEndpointTried = Array.from(autoEndpointTried || []);
    diagnostics.autoEndpointSelected = runtime?.endpointMode || '';
  }
  if (canTryV1Toggle) {
    diagnostics.autoBaseUrlTweak = true;
    diagnostics.autoBaseUrlInputHasV1 = /\/v1$/i.test(normalizedBaseUrlInput);
    diagnostics.autoBaseUrlAdjusted = false;
  }
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
        headers: adapter.buildHeaders(effectiveSettings, runtime, stream),
        body: JSON.stringify(adapter.buildBody({ settings: effectiveSettings, prompt, runtime, stream, meta })),
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit'
      }), controller.signal);

      clearTimeout(timeout);
      diagnostics.httpStatus = response.status;
      diagnostics.responseContentType = response.headers.get('content-type') || '';
      diagnostics.requestId = response.headers.get('x-request-id') || '';

      if (!response.ok) {
        const errorText = await response.text().catch((error) => {
          console.error('[Yilan] Failed to read error response body, using empty string.', error);
          return '';
        });
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

      if (wantsAutoEndpointMode) {
        diagnostics.autoEndpointTried = Array.from(autoEndpointTried || []);
        diagnostics.autoEndpointSelected = runtime?.endpointMode || '';
      }
      if (wantsAutoEndpointMode && autoEndpointCacheKey) {
        await setCachedAutoEndpointMode(autoEndpointCacheKey, runtime?.endpointMode || '');
      }
      if (meta?.stage === 'test' && canTryV1Toggle) {
        const originalBase = normalizeUrlNoTrailingSlash(settings?.aiBaseURL || '');
        const finalBase = normalizeUrlNoTrailingSlash(effectiveSettings?.aiBaseURL || '');
        if (originalBase && finalBase && originalBase !== finalBase) {
          await new Promise((resolve) => {
            chrome.storage.sync.set({ aiBaseURL: finalBase }, () => resolve());
          });
          diagnostics.autoBaseUrlSaved = true;
        }
      }

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

      if (wantsAutoEndpointMode && isAutoEndpointNotSupportedError(normalized) && autoEndpointTried) {
        const nextMode = autoEndpointCandidates.find((mode) => mode && !autoEndpointTried.has(mode));
        if (nextMode) {
          const nextSettings = Object.assign({}, effectiveSettings, { endpointMode: nextMode });
          const nextResolution = AdapterRegistry.resolve(nextSettings);
          if (nextResolution) {
            RunState.setRunController(runId, null);
            effectiveSettings = nextSettings;
            adapter = nextResolution.adapter;
            runtime = nextResolution.snapshot;
            autoEndpointTried.add(runtime?.endpointMode || nextMode);

            diagnostics.provider = runtime?.provider || diagnostics.provider;
            diagnostics.adapterId = runtime?.adapterId || diagnostics.adapterId;
            diagnostics.family = runtime?.family || diagnostics.family;
            diagnostics.endpointMode = runtime?.endpointMode || diagnostics.endpointMode;
            diagnostics.baseUrl = runtime?.baseUrl || diagnostics.baseUrl;
            diagnostics.model = runtime?.model || diagnostics.model;
            diagnostics.autoEndpointTried = Array.from(autoEndpointTried);
            diagnostics.autoEndpointSelected = runtime?.endpointMode || '';

            RunState.prepareRun(runId, { runtime });

            // Keep the attempt number stable when switching endpoint modes.
            attempt -= 1;
            continue;
          }
        }
      }

      if (canTryV1Toggle && isAutoEndpointNotSupportedError(normalized) && autoBaseUrlTried) {
        const currentBase = normalizeUrlNoTrailingSlash(effectiveSettings?.aiBaseURL || '');
        const nextBase = toggleTrailingV1(currentBase);
        if (nextBase && !autoBaseUrlTried.has(nextBase)) {
          const nextSettings = Object.assign({}, effectiveSettings, { aiBaseURL: nextBase });
          const nextResolution = AdapterRegistry.resolve(nextSettings);
          if (nextResolution) {
            RunState.setRunController(runId, null);
            effectiveSettings = nextSettings;
            adapter = nextResolution.adapter;
            runtime = nextResolution.snapshot;
            autoBaseUrlTried.add(nextBase);

            if (autoEndpointTried) {
              autoEndpointTried.clear();
              autoEndpointTried.add(runtime?.endpointMode || '');
            }

            diagnostics.provider = runtime?.provider || diagnostics.provider;
            diagnostics.adapterId = runtime?.adapterId || diagnostics.adapterId;
            diagnostics.family = runtime?.family || diagnostics.family;
            diagnostics.endpointMode = runtime?.endpointMode || diagnostics.endpointMode;
            diagnostics.baseUrl = runtime?.baseUrl || diagnostics.baseUrl;
            diagnostics.model = runtime?.model || diagnostics.model;
            if (typeof diagnostics.autoBaseUrlAdjusted === 'boolean') {
              diagnostics.autoBaseUrlAdjusted = true;
              diagnostics.autoBaseUrlAppliedV1 = /\/v1$/i.test(nextBase);
            }
            if (wantsAutoEndpointMode) {
              diagnostics.autoEndpointTried = Array.from(autoEndpointTried || []);
              diagnostics.autoEndpointSelected = runtime?.endpointMode || '';
            }

            RunState.prepareRun(runId, { runtime });

            // Keep the attempt number stable when tweaking base URL.
            attempt -= 1;
            continue;
          }
        }
      }

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

async function listModels(settings) {
  const stage = 'models';
  const provider = String(settings?.aiProvider || '').toLowerCase();

  if (!settings?.apiKey) {
    throw Errors.createError(Errors.ERROR_CODES.CONFIG_MISSING_API_KEY, { stage });
  }

  if (provider && provider !== 'openai') {
    return {
      success: true,
      fetchedAt: new Date().toISOString(),
      models: [],
      rawHint: '当前 provider 暂不支持自动拉取模型列表（仍可手动输入模型 ID）。'
    };
  }

  const resolution = AdapterRegistry.resolve(Object.assign({}, settings, { endpointMode: 'responses' })) || AdapterRegistry.resolve(settings);
  const runtime = resolution?.snapshot || null;
  const cacheKey = getModelsCacheKey(settings, runtime);

  const baseRoot = normalizeOpenAiBaseRootForCache(runtime?.baseUrl || settings?.aiBaseURL || 'https://api.openai.com/v1');
  if (!baseRoot) {
    throw Errors.createError(Errors.ERROR_CODES.NETWORK_ERROR, { stage, detail: 'missing_base_url', provider: 'openai' });
  }

  const candidates = [baseRoot];
  const toggled = toggleTrailingV1(baseRoot);
  if (toggled && toggled !== baseRoot) candidates.push(toggled);

  let lastError = null;
  for (const candidate of candidates) {
    const root = normalizeUrlNoTrailingSlash(candidate);
    if (!root) continue;

    const url = root + '/models';
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + String(settings?.apiKey || '')
        },
        mode: 'cors',
        credentials: 'omit'
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const error = Errors.createHttpError(response.status, body, {
          stage,
          provider: 'openai',
          endpointHost: (() => {
            try {
              return new URL(url).host || '';
            } catch {
              return '';
            }
          })()
        });

        // Common: 404 / "route not found" when the gateway expects a different `/v1` prefix.
        if (response.status === 404 || response.status === 400 || response.status === 405) {
          lastError = error;
          continue;
        }

        throw error;
      }

      const json = await response.json().catch(() => null);
      if (!json || typeof json !== 'object') {
        throw Errors.createError(Errors.ERROR_CODES.PARSE_ERROR, {
          stage,
          provider: 'openai',
          detail: 'invalid_models_response'
        });
      }

      const rows = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.models)
          ? json.models
          : Array.isArray(json.items)
            ? json.items
            : Array.isArray(json)
              ? json
              : [];

      const models = rows
        .map((item) => {
          if (typeof item === 'string') return { id: item };
          const id = String(item?.id || '').trim();
          if (!id) return null;
          const ownedBy = item?.owned_by ? String(item.owned_by) : '';
          return ownedBy ? { id, owned_by: ownedBy } : { id };
        })
        .filter(Boolean);

      const fetchedAt = new Date().toISOString();
      if (cacheKey) {
        await setCachedModels(cacheKey, {
          fetchedAt,
          models: models.map((item) => String(item?.id || '')).filter(Boolean)
        });
      }

      return {
        success: true,
        fetchedAt,
        models
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  throw Errors.createError(Errors.ERROR_CODES.NETWORK_ERROR, { stage, provider: 'openai', detail: 'models_request_failed' });
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
      sendResponse(createErrorResponse(error, '连接测试失败。', {
        diagnostics: error?.diagnostics || null
      }));
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
      sendResponse(createErrorResponse(error, '生成摘要失败。', {
        runId: message.runId,
        diagnostics: error?.diagnostics || null
      }));
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
      console.error('[Yilan] Failed to show history.', error);
      sendResponse(createErrorResponse(error, '打开历史记录失败。'));
    });
    return true;
  }

  if (message.action === 'getEntrypointStatus') {
    Entrypoints.getEntrypointStatus().then((entrypoints) => {
      sendResponse({ success: true, entrypoints });
    }).catch((error) => {
      console.error('[Yilan] Failed to get entrypoint status.', error);
      sendResponse(createErrorResponse(error, '获取入口状态失败。'));
    });
    return true;
  }

  if (message.action === 'openShortcutSettings') {
    Entrypoints.openShortcutSettings().then((result) => {
      sendResponse(result);
    }).catch((error) => {
      console.error('[Yilan] Failed to open shortcut settings.', error);
      sendResponse(createErrorResponse(error, '打开快捷键设置失败。', {
        url: Entrypoints.SHORTCUT_SETTINGS_URL
      }));
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
      console.error('[Yilan] Failed to open reader tab.', error);
      sendResponse(createErrorResponse(error, '打开阅读页失败。'));
    });
    return true;
  }

  if (message.action === 'listModels') {
    listModels(message.settings || {}).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse(createErrorResponse(error, '模型列表获取失败。'));
    });
    return true;
  }

  return false;
});

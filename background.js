importScripts(
  'shared/i18n.js',
  'shared/domain.js',
  'shared/errors.js',
  'shared/provider-catalog.generated.js',
  'shared/provider-presets.js',
  'shared/constants.js',
  'shared/adapter-utils.js',
  'shared/url-utils.js',
  'shared/chrome-api.js',
  'adapters/openai-adapter.js',
  'adapters/anthropic-adapter.js',
  'adapters/registry.js'
);

importScripts(
  'shared/abort-utils.js',
  'shared/transport-utils.js',
  'background/run-state.js',
  'background/endpoint-probe.js',
  'background/reader-sessions.js',
  'background/entrypoints.js',
  'background/endpoint-cache.js',
  'background/models-cache.js'
);

const AbortUtils = self.AISummaryAbortUtils;
const Domain = self.AISummaryDomain;
const Errors = self.AISummaryErrors;
const Constants = self.AISummaryConstants;
const UrlUtils = self.AISummaryUrlUtils;
const AdapterRegistry = self.AISummaryAdapterRegistry;
const TransportUtils = self.AISummaryTransportUtils;
const ChromeApi = self.YilanChromeApi;
const RunState = self.YilanRunState;
const EndpointProbe = self.YilanEndpointProbe;
const ReaderSessions = self.YilanReaderSessions;
const AutoEndpointCache = self.YilanAutoEndpointCache;
const ModelsCache = self.YilanModelsCache;

function bgText(key, fallback) {
  try {
    return self.chrome.i18n?.getMessage?.(key) || fallback;
  } catch (error) {
    return fallback;
  }
}
const Entrypoints = self.YilanEntrypoints;

const CONTENT_SCRIPT_FILES = [
  'shared/domain.js',
  'shared/strings.js',
  'shared/page-strategy.js',
  'shared/article-utils.js',
  'shared/bilibili-source.js',
  'shared/youtube-source.js',
  'shared/constants.js',
  'libs/readability.js',
  'content.js'
];

const normalizeOpenAiBaseRootForCache = UrlUtils.normalizeOpenAiBaseRoot;

function createErrorResponse(error, fallbackMessage, additionalFields = {}) {
  const normalized = Errors.normalizeError(error, error?.code, error);
  return {
    success: false,
    error: normalized,
    ...additionalFields
  };
}

const createTab = ChromeApi.createTab;

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

const tryParseJson = TransportUtils.tryParseJson;
const createTransportPayload = TransportUtils.createTransportPayload;
const sanitizeErrorForTransport = TransportUtils.sanitizeErrorForTransport;
const sanitizeDiagnosticsForTransport = TransportUtils.sanitizeDiagnosticsForTransport;
const safePortPost = TransportUtils.safePortPost;

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


const readRuntimeLastErrorMessage = ChromeApi.readRuntimeLastErrorMessage;
const safeSendResponse = TransportUtils.safeSendResponse;

function normalizeRuntimeError(error, runtime, stage, runId, options) {
  return TransportUtils.normalizeTransportError(error, runtime, stage, Object.assign({
    runCancelled: RunState.isRunCancelled(runId)
  }, options || {}));
}

const normalizeUrlNoTrailingSlash = UrlUtils.normalizeUrlNoTrailingSlash;
// listModels still toggles the /models root between /v1 forms directly.
const toggleTrailingV1 = UrlUtils.toggleTrailingV1;

function assertAllowedModelEndpointUrl(value, stage, provider, endpointMode) {
  if (!value) return;

  const isAllowed = UrlUtils?.isAllowedModelEndpointUrl
    ? UrlUtils.isAllowedModelEndpointUrl(value)
    : /^https:\/\//i.test(String(value || '').trim());

  if (isAllowed) return;
  throw Errors.createError(Errors.ERROR_CODES.CONFIG_INVALID_BASE_URL, {
    stage: stage || '',
    provider: provider || '',
    endpointMode: endpointMode || '',
    detail: String(value || '')
  });
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

async function consumeStreamResponse(response, adapter, runtime, onToken, signal, options) {
  if (!response.body) {
    return {
      text: '',
      usage: null,
      preview: ''
    };
  }

  const idleTimeoutMs = Number(options?.idleTimeoutMs) > 0 ? Number(options.idleTimeoutMs) : 0;
  const rawBodyMaxChars = Number(options?.rawBodyMaxChars) > 0 ? Number(options.rawBodyMaxChars) : 0;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rawBody = '';
  let rawBodyCapped = false;
  let text = '';
  let usage = null;
  let abortError = null;

  function appendRawBody(chunk) {
    if (rawBodyCapped) return;
    rawBody += chunk;
    // The raw capture only feeds the preview and the fallback parser; long
    // token streams do not need to stay in memory in full.
    if (rawBodyMaxChars && rawBody.length > rawBodyMaxChars) {
      rawBody = rawBody.slice(0, rawBodyMaxChars);
      rawBodyCapped = true;
    }
  }

  function handleAbort() {
    abortError = AbortUtils.toAbortError(signal);
    try {
      reader.cancel(abortError);
    } catch (error) {
      console.warn('[Background] Failed to cancel stream reader:', error);
    }
  }

  // Aborts the read loop when the server stops sending bytes without closing
  // the connection; surfaces as NETWORK_TIMEOUT so the retry policy applies.
  const idleWatchdog = AbortUtils.createIdleWatchdog({
    timeoutMs: idleTimeoutMs,
    onTimeout() {
      const idleError = new Error('idle_timeout');
      idleError.name = 'AbortError';
      try {
        reader.cancel(idleError);
      } catch (error) {
        console.warn('[Background] Failed to cancel stalled stream reader:', error);
      }
    }
  });

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

      idleWatchdog.bump();
      const chunk = decoder.decode(value, { stream: true });
      appendRawBody(chunk);
      parser.push(chunk, false);
    }

    AbortUtils.throwIfAborted(signal);
    const tail = decoder.decode();
    if (tail) {
      appendRawBody(tail);
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
    // Parse/abort failures must not leave the connection open.
    try {
      reader.cancel(error);
    } catch {}
    if (signal?.aborted && !AbortUtils.isAbortError(error) && abortError) {
      throw abortError;
    }
    throw error;
  } finally {
    idleWatchdog.dispose();
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
  const provider = String(settings?.aiProvider || 'openai').toLowerCase() || 'openai';

  if (!settings.apiKey) {
    throw Errors.createError(Errors.ERROR_CODES.CONFIG_MISSING_API_KEY, { stage: meta.stage || '' });
  }

  assertAllowedModelEndpointUrl(
    settings?.aiBaseURL || '',
    meta.stage || '',
    provider,
    String(settings?.endpointMode || '')
  );

  const isOpenAiProvider = provider === 'openai';
  // Compatibility-switch state machine (see background/endpoint-probe.js):
  // auto endpoint-mode probes and trailing-/v1 toggles never consume a retry,
  // so they live outside the attempt counter.
  const compat = EndpointProbe.createCompatibilityStateMachine({
    isOpenAiProvider,
    endpointMode: String(settings?.endpointMode || ''),
    baseUrl: settings?.aiBaseURL || ''
  });
  const wantsAutoEndpointMode = compat.wantsAutoEndpointMode;
  const canTryV1Toggle = compat.canTryV1Toggle;
  const autoEndpointCacheKey = wantsAutoEndpointMode ? AutoEndpointCache.getCacheKey(settings) : '';
  const cachedEndpointMode = wantsAutoEndpointMode ? await AutoEndpointCache.getCachedMode(autoEndpointCacheKey) : '';
  let effectiveSettings = settings;
  if (wantsAutoEndpointMode && cachedEndpointMode) {
    effectiveSettings = Object.assign({}, settings, { endpointMode: cachedEndpointMode });
  }

  const normalizedBaseUrlInput = compat.baseUrlInput;

  let resolution = AdapterRegistry.resolve(effectiveSettings);
  if (!resolution) {
    throw Errors.createError(Errors.ERROR_CODES.ADAPTER_NOT_FOUND, { stage: meta.stage || '' });
  }

  let adapter = resolution.adapter;
  let runtime = resolution.snapshot;
  compat.markEndpointModeTried(runtime?.endpointMode || '');
  const diagnostics = createDiagnostics(runId, runtime, meta);
  diagnostics.transportMode = stream ? 'stream' : 'request';
  if (wantsAutoEndpointMode) {
    diagnostics.requestedEndpointMode = 'auto';
    diagnostics.autoEndpointCacheHit = !!cachedEndpointMode;
    diagnostics.autoEndpointTried = Array.from(compat.autoEndpointTried || []);
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
  // Compatibility-switch attempts (auto endpoint mode / trailing-v1 tweak)
  // probe an unverified URL shape, so they run with a short timeout instead
  // of the full request deadline.
  let probeNextAttempt = false;

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

    const attemptTimeoutMs = probeNextAttempt ? Math.min(timeoutMs, Constants.ENDPOINT_PROBE_TIMEOUT_MS) : timeoutMs;
    probeNextAttempt = false;
    const controller = new AbortController();
    // The deadline covers the whole request: headers AND body. Clearing it
    // after the headers would let a stalled body hang the run forever.
    const timeout = setTimeout(() => controller.abort('timeout'), attemptTimeoutMs);
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
          requestId: diagnostics.requestId,
          retryAfterMs: TransportUtils.parseRetryAfterMs(response.headers.get('retry-after'), Constants.RETRY_AFTER_MAX_MS)
        }, buildErrorContext(runtime, meta.stage)));
      }

      const result = stream
        ? await consumeStreamResponse(response, adapter, runtime, options.onToken || (() => {}), controller.signal, {
            idleTimeoutMs: Constants.STREAM_IDLE_TIMEOUT_MS,
            rawBodyMaxChars: Constants.STREAM_RAW_BODY_MAX_CHARS
          })
        : await consumeNonStreamResponse(response, adapter, runtime, controller.signal);

      clearTimeout(timeout);
      AbortUtils.throwIfAborted(controller.signal);

      if (!result.text.trim()) {
        throw Errors.createError(
          Errors.ERROR_CODES.UNSUPPORTED_RESPONSE_FORMAT,
          Object.assign({ detail: result.preview || 'empty_response' }, buildErrorContext(runtime, meta.stage))
        );
      }

      diagnostics.status = 'completed';
      diagnostics.durationMs = Date.now() - startedAt;
      diagnostics.completedAt = new Date().toISOString();
      diagnostics.preview = result.preview || '';
      diagnostics.usage = result.usage || null;

      if (wantsAutoEndpointMode) {
        diagnostics.autoEndpointTried = Array.from(compat.autoEndpointTried || []);
        diagnostics.autoEndpointSelected = runtime?.endpointMode || '';
      }
      if (wantsAutoEndpointMode && autoEndpointCacheKey) {
        await AutoEndpointCache.setCachedMode(autoEndpointCacheKey, runtime?.endpointMode || '');
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

      // Compatibility switches (auto endpoint mode, trailing-/v1) retry the
      // request without consuming a retry slot; the state machine tracks what
      // has been tried and returns the next untried shape or null.
      const switchDecision = compat.nextCompatibilityAttempt(normalized, {
        baseInput: effectiveSettings?.aiBaseURL || ''
      });
      if (switchDecision) {
        const nextSettings = Object.assign({}, effectiveSettings,
          switchDecision.kind === 'endpoint_mode'
            ? { endpointMode: switchDecision.nextMode }
            : { aiBaseURL: switchDecision.nextBase });
        const nextResolution = AdapterRegistry.resolve(nextSettings);
        if (nextResolution) {
          RunState.setRunController(runId, null);
          effectiveSettings = nextSettings;
          adapter = nextResolution.adapter;
          runtime = nextResolution.snapshot;
          compat.applySwitch(switchDecision, runtime);

          diagnostics.provider = runtime?.provider || diagnostics.provider;
          diagnostics.adapterId = runtime?.adapterId || diagnostics.adapterId;
          diagnostics.family = runtime?.family || diagnostics.family;
          diagnostics.endpointMode = runtime?.endpointMode || diagnostics.endpointMode;
          diagnostics.baseUrl = runtime?.baseUrl || diagnostics.baseUrl;
          diagnostics.model = runtime?.model || diagnostics.model;
          if (switchDecision.kind === 'endpoint_mode') {
            diagnostics.autoEndpointTried = Array.from(compat.autoEndpointTried);
            diagnostics.autoEndpointSelected = runtime?.endpointMode || '';
          } else if (typeof diagnostics.autoBaseUrlAdjusted === 'boolean') {
            diagnostics.autoBaseUrlAdjusted = true;
            diagnostics.autoBaseUrlAppliedV1 = /\/v1$/i.test(switchDecision.nextBase || '');
          }
          if (wantsAutoEndpointMode) {
            diagnostics.autoEndpointTried = Array.from(compat.autoEndpointTried || []);
            diagnostics.autoEndpointSelected = runtime?.endpointMode || '';
          }

          RunState.prepareRun(runId, { runtime });

          probeNextAttempt = true;
          continue;
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
        // 'deterministic' disables jitter for tests that assert backoff timing.
        const retryJitter = runtime.retryPolicy?.jitter === 'deterministic' ? () => 1 : Math.random;
        const delay = TransportUtils.computeRetryDelayMs({
          attempt,
          retryAfterMs: typeof normalized.retryAfterMs === 'number' ? normalized.retryAfterMs : null,
          baseDelayMs: Constants.RETRY_BASE_DELAY_MS,
          maxDelayMs: Constants.RETRY_MAX_DELAY_MS,
          maxRetryAfterMs: Constants.RETRY_AFTER_MAX_MS,
          jitter: retryJitter
        });
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
      rawHint: bgText('bg_models_raw_hint', '当前 provider 暂不支持自动拉取模型列表（仍可手动输入模型 ID）。')
    };
  }

  assertAllowedModelEndpointUrl(
    settings?.aiBaseURL || '',
    stage,
    provider || 'openai',
    String(settings?.endpointMode || 'responses')
  );

  const resolution = AdapterRegistry.resolve(Object.assign({}, settings, { endpointMode: 'responses' })) || AdapterRegistry.resolve(settings);
  const runtime = resolution?.snapshot || null;
  const cacheKey = ModelsCache.getKey(settings, runtime);

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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), Constants.MODELS_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + String(settings?.apiKey || '')
        },
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal
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
        AbortUtils.throwIfAborted(controller.signal);
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
        await ModelsCache.setModels(cacheKey, {
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
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError) throw lastError;
  throw Errors.createError(Errors.ERROR_CODES.NETWORK_ERROR, { stage, provider: 'openai', detail: 'models_request_failed' });
}

// Stream deltas are coalesced by the transport layer (see createTokenBatcher)
// so one port message covers a whole flush interval instead of one per token.
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

  const tokenBatcher = TransportUtils.createTokenBatcher((payload) => {
    safePortPost(port, { ...payload, runId });
  }, Constants.STREAM_TOKEN_FLUSH_INTERVAL_MS);

  try {
    const result = await executeRun({
      settings: message.settings,
      prompt: message.prompt,
      runId,
      stream: true,
      meta: message.meta,
      portId,
      onToken(token) {
        tokenBatcher.push(token);
      },
      onRetry(payload) {
        // The retried attempt restarts generation from scratch; drop any
        // buffered deltas so they cannot duplicate the new attempt's output.
        tokenBatcher.discard();
        safePortPost(port, { type: 'retry', runId, retry: payload });
      }
    });

    tokenBatcher.flushNow();
    safePortPost(port, {
      type: 'done',
      runId,
      text: result.text,
      usage: result.usage,
      diagnostics: result.diagnostics
    });
  } catch (error) {
    tokenBatcher.flushNow();
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

// Defense-in-depth: with no externally_connectable declared, only this
// extension's own pages and content scripts can reach onMessage/onConnect.
// Asserting sender.id keeps that guarantee explicit even if a future refactor
// forwards page-context messages into these channels.
function isTrustedExtensionSender(sender) {
  return !sender?.id || sender.id === chrome.runtime.id;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai-stream') return;
  if (!isTrustedExtensionSender(port.sender)) return;

  const portId = Domain.createRuntimeId('port');

  port.onMessage.addListener((message) => {
    if (message.action === 'startStream') {
      handleStreamStart(port, portId, message);
      return;
    }

    if (message.action === 'ping') {
      // Heartbeat from the sidebar while a run is in flight; receiving any
      // port message resets the MV3 service-worker idle timer.
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
  if (!isTrustedExtensionSender(sender)) {
    return false;
  }

  const rawSendResponse = sendResponse;
  sendResponse = (payload) => safeSendResponse(rawSendResponse, payload);

  if (message.action === 'getYoutubePlayerResponse') {
    if (!sender.tab?.id) {
      sendResponse({ success: false, error: 'no_tab' });
      return false;
    }
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: () => {
        try {
          const player = /** @type {{ getPlayerResponse?: () => unknown } | null} */ (
            document.getElementById('movie_player') || document.querySelector('.html5-video-player')
          );
          const youtubeWindow = /** @type {Window & { ytInitialPlayerResponse?: unknown }} */ (window);
          return player?.getPlayerResponse?.() || youtubeWindow.ytInitialPlayerResponse || null;
        } catch (e) {
          return null;
        }
      }
    }).then((results) => {
      sendResponse({ success: true, playerResponse: results?.[0]?.result || null });
    }).catch((error) => {
      console.warn('[Yilan] executeScript failed:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

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
      sendResponse(createErrorResponse(error, bgText('bg_connection_test_failed', '连接测试失败。'), {
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
      sendResponse(createErrorResponse(error, bgText('bg_run_failed', '生成摘要失败。'), {
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
      sendResponse(createErrorResponse(error, bgText('bg_history_open_failed', '打开历史记录失败。')));
    });
    return true;
  }

  if (message.action === 'getEntrypointStatus') {
    Entrypoints.getEntrypointStatus({ ensure: message?.ensure !== false }).then((entrypoints) => {
      sendResponse({ success: true, entrypoints });
    }).catch((error) => {
      console.error('[Yilan] Failed to get entrypoint status.', error);
      sendResponse(createErrorResponse(error, bgText('bg_entrypoint_status_failed', '获取入口状态失败。')));
    });
    return true;
  }

  if (message.action === 'openShortcutSettings') {
    Entrypoints.openShortcutSettings().then((result) => {
      sendResponse(result);
    }).catch((error) => {
      console.error('[Yilan] Failed to open shortcut settings.', error);
      sendResponse(createErrorResponse(error, bgText('bg_shortcut_settings_failed', '打开快捷键设置失败。'), {
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
      sendResponse(createErrorResponse(error, bgText('bg_reader_open_failed', '打开阅读页失败。')));
    });
    return true;
  }

  if (message.action === 'listModels') {
    listModels(message.settings || {}).then((result) => {
      sendResponse(result);
    }).catch((error) => {
      sendResponse(createErrorResponse(error, bgText('popup_models_fetch_failed', '模型列表获取失败。')));
    });
    return true;
  }

  return false;
});

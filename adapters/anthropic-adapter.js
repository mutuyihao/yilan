(function (global) {
  const ProviderPresets = global.AISummaryProviderPresets || (typeof require === 'function' ? require('../shared/provider-presets.js') : null);
  const AdapterUtils = global.AISummaryAdapterUtils || (typeof require === 'function' ? require('../shared/adapter-utils.js') : null);
  const DEFAULT_BASE_ROOT = 'https://api.anthropic.com';

  function stripMessagesSuffix(value) {
    return AdapterUtils.trimTrailingSlash(value)
      .replace(/\/v1\/messages$/i, '')
      .replace(/\/messages$/i, '');
  }

  function appendMessagesEndpoint(baseRoot) {
    const root = AdapterUtils.trimTrailingSlash(stripMessagesSuffix(baseRoot || DEFAULT_BASE_ROOT));
    if (/\/v1$/i.test(root)) {
      return root + '/messages';
    }
    return root + '/v1/messages';
  }

  function isOfficialAnthropicEndpoint(baseUrl) {
    try {
      const url = new URL(String(baseUrl || ''));
      return url.hostname === 'api.anthropic.com';
    } catch {
      return /(^|\/)api\.anthropic\.com(\/|$)/i.test(String(baseUrl || ''));
    }
  }

  function resolve(settings) {
    const presetId = String(settings?.providerPreset || '').trim() || ProviderPresets?.inferPresetFromSettings?.(settings) || 'custom';
    const customUrl = String(settings?.aiBaseURL || '').trim();
    const model = settings?.modelName || 'claude-sonnet-4-20250514';
    const endpointMode = 'messages';
    const shouldApplyPresetRoot = presetId && presetId !== 'custom';

    let baseUrl = customUrl || DEFAULT_BASE_ROOT;

    if (!customUrl) {
      baseUrl = appendMessagesEndpoint(DEFAULT_BASE_ROOT);
    } else if (/\/v1\/messages$/i.test(AdapterUtils.trimTrailingSlash(customUrl))) {
      baseUrl = AdapterUtils.trimTrailingSlash(customUrl);
    } else if (settings?.endpointMode === 'messages' || shouldApplyPresetRoot || /\/v1$/i.test(AdapterUtils.trimTrailingSlash(customUrl))) {
      baseUrl = appendMessagesEndpoint(customUrl);
    } else {
      baseUrl = appendMessagesEndpoint(customUrl);
    }

    return {
      adapterId: 'anthropic_messages',
      provider: 'anthropic',
      family: 'anthropic_messages',
      displayName: 'Anthropic Messages',
      baseUrl,
      endpointMode,
      authScheme: 'x_api_key',
      credentialRef: 'storage.sync.apiKey',
      defaultModel: model,
      model,
      supportsStreaming: true,
      supportsSystemPrompt: true,
      supportsMultimodalInput: true,
      supportsJsonOutput: true,
      supportsReasoningControls: false,
      supportsLanguageControl: true,
      maxInputCharsHint: 28000,
      maxOutputTokensHint: 4096,
      inputFormat: 'messages',
      systemPromptStrategy: 'top_level_system',
      requestDefaults: {
        max_tokens: 4096
      },
      timeoutMs: 90000,
      retryPolicy: {
        maxRetries: 3,
        backoff: 'exponential'
      },
      streamEventFormat: 'sse',
      deltaFieldMapping: 'content_block_delta.delta.text',
      finishReasonMapping: 'provider_default'
    };
  }

  function buildHeaders(settings, runtime, expectsStream) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: expectsStream ? 'text/event-stream, application/json' : 'application/json',
      'x-api-key': String(settings?.apiKey || '')
    };

    if (isOfficialAnthropicEndpoint(runtime?.baseUrl)) {
      headers['anthropic-version'] = '2023-06-01';
    }

    return headers;
  }

  function buildBody(context) {
    const runtime = context.runtime || {};
    const model = runtime.model || runtime.defaultModel || 'claude-sonnet-4-20250514';

    return {
      model,
      max_tokens: runtime.requestDefaults?.max_tokens || 4096,
      stream: !!context.stream,
      messages: [{ role: 'user', content: String(context.prompt || '') }]
    };
  }

  function extractText(json) {
    if (!json || typeof json !== 'object') return '';

    if (Array.isArray(json.content)) {
      return json.content
        .filter((item) => item && item.type === 'text')
        .map((item) => item.text || '')
        .join('');
    }

    return '';
  }

  function extractDelta(json) {
    if (!json || typeof json !== 'object') return '';

    if (json.type === 'content_block_delta') {
      return json.delta?.text || '';
    }

    return '';
  }

  function extractUsage(json) {
    return json?.usage || json?.message?.usage || null;
  }

  const adapter = {
    id: 'anthropic',
    provider: 'anthropic',
    family: 'anthropic_messages',
    displayName: 'Anthropic',
    resolve,
    buildHeaders,
    buildBody,
    extractText,
    extractDelta,
    extractUsage
  };

  global.AISummaryAnthropicAdapter = adapter;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = adapter;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

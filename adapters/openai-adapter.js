(function (global) {
  const ProviderPresets = global.AISummaryProviderPresets || (typeof require === 'function' ? require('../shared/provider-presets.js') : null);
  const DEFAULT_BASE_ROOT = 'https://api.openai.com/v1';
  const ENDPOINT_PATHS = {
    responses: '/responses',
    chat_completions: '/chat/completions',
    legacy_completions: '/completions'
  };

  function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  function normalizeEndpointMode(value) {
    const mode = String(value || '').trim();
    return Object.prototype.hasOwnProperty.call(ENDPOINT_PATHS, mode) ? mode : '';
  }

  function detectEndpointModeFromUrl(value) {
    const lowerValue = trimTrailingSlash(value).toLowerCase();
    if (lowerValue.endsWith('/chat/completions')) return 'chat_completions';
    if (lowerValue.endsWith('/responses')) return 'responses';
    if (lowerValue.endsWith('/completions')) return 'legacy_completions';
    return '';
  }

  function stripKnownEndpointSuffix(value) {
    return trimTrailingSlash(value)
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/responses$/i, '')
      .replace(/\/completions$/i, '');
  }

  function appendEndpoint(baseRoot, endpointMode) {
    const safeMode = normalizeEndpointMode(endpointMode) || 'responses';
    return trimTrailingSlash(stripKnownEndpointSuffix(baseRoot || DEFAULT_BASE_ROOT)) + ENDPOINT_PATHS[safeMode];
  }

  function flattenTextParts(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(flattenTextParts).join('');

    if (typeof value === 'object') {
      if (typeof value.text === 'string') return value.text;
      if (typeof value.delta === 'string') return value.delta;
      if (typeof value.content === 'string') return value.content;
      if (Array.isArray(value.content)) return value.content.map(flattenTextParts).join('');
      if (Array.isArray(value.output)) return value.output.map(flattenTextParts).join('');
      if (value.message) return flattenTextParts(value.message);
      if (value.item) return flattenTextParts(value.item);
    }

    return '';
  }

  function resolve(settings) {
    const presetId = String(settings?.providerPreset || '').trim() || ProviderPresets?.inferPresetFromSettings?.(settings) || 'custom';
    const customUrl = String(settings?.aiBaseURL || '').trim();
    const explicitMode = normalizeEndpointMode(settings?.endpointMode);
    const detectedMode = detectEndpointModeFromUrl(customUrl);
    const presetMode = ProviderPresets?.normalizeEndpointMode
      ? ProviderPresets.normalizeEndpointMode(settings?.endpointMode, 'openai', presetId)
      : 'responses';

    let endpointMode = explicitMode || detectedMode || normalizeEndpointMode(presetMode) || 'responses';
    let baseUrl = customUrl || DEFAULT_BASE_ROOT;

    if (!customUrl) {
      baseUrl = appendEndpoint(DEFAULT_BASE_ROOT, endpointMode);
    } else if (explicitMode) {
      baseUrl = appendEndpoint(customUrl, explicitMode);
      endpointMode = explicitMode;
    } else if (detectedMode) {
      baseUrl = trimTrailingSlash(customUrl);
      endpointMode = detectedMode;
    } else if (presetId && presetId !== 'custom') {
      baseUrl = appendEndpoint(customUrl, endpointMode);
    } else {
      const normalized = trimTrailingSlash(customUrl);
      if (/\/v1$/i.test(normalized)) {
        baseUrl = normalized + '/responses';
        endpointMode = 'responses';
      } else {
        baseUrl = normalized;
        endpointMode = 'responses';
      }
    }

    const defaultModel = endpointMode === 'legacy_completions' ? 'gpt-3.5-turbo-instruct' : 'gpt-4o-mini';
    const inputFormat = endpointMode === 'responses' ? 'input' : endpointMode === 'legacy_completions' ? 'prompt' : 'messages';
    const adapterId = endpointMode === 'chat_completions'
      ? 'openai_chat_completions'
      : endpointMode === 'legacy_completions'
        ? 'openai_completions'
        : 'openai_responses';

    return {
      adapterId,
      provider: 'openai',
      family: 'openai_compatible',
      displayName: endpointMode === 'chat_completions'
        ? 'OpenAI Chat Completions'
        : endpointMode === 'legacy_completions'
          ? 'OpenAI Completions'
          : 'OpenAI Responses',
      baseUrl,
      endpointMode,
      authScheme: 'bearer',
      credentialRef: 'storage.sync.apiKey',
      defaultModel,
      model: settings?.modelName || defaultModel,
      supportsStreaming: true,
      supportsSystemPrompt: false,
      supportsMultimodalInput: endpointMode === 'responses',
      supportsJsonOutput: true,
      supportsReasoningControls: endpointMode === 'responses',
      supportsLanguageControl: true,
      maxInputCharsHint: 28000,
      maxOutputTokensHint: 4096,
      inputFormat,
      systemPromptStrategy: 'inline_prompt',
      requestDefaults: {},
      timeoutMs: 90000,
      retryPolicy: {
        maxRetries: 3,
        backoff: 'exponential'
      },
      streamEventFormat: 'sse',
      deltaFieldMapping: endpointMode === 'responses' ? 'response.output_text.delta' : 'choices[0].delta.content',
      finishReasonMapping: 'provider_default'
    };
  }

  function buildHeaders(settings, runtime, expectsStream) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: expectsStream ? 'text/event-stream, application/json' : 'application/json',
      Authorization: 'Bearer ' + String(settings?.apiKey || '')
    };

    if (runtime?.endpointMode === 'responses') {
      headers['OpenAI-Beta'] = 'responses=v1';
    }

    return headers;
  }

  function buildBody(context) {
    const runtime = context.runtime || {};
    const model = runtime.model || runtime.defaultModel || 'gpt-4o-mini';
    const stream = !!context.stream;
    const prompt = String(context.prompt || '');

    if (runtime.endpointMode === 'chat_completions') {
      return {
        model,
        stream,
        messages: [{ role: 'user', content: prompt }]
      };
    }

    if (runtime.endpointMode === 'legacy_completions') {
      return {
        model,
        stream,
        prompt,
        max_tokens: 4096
      };
    }

    return {
      model,
      stream,
      input: prompt
    };
  }

  function extractResponsesText(json) {
    if (!json || typeof json !== 'object') return '';

    if (typeof json.output_text === 'string') {
      return json.output_text;
    }

    if (typeof json.response?.output_text === 'string') {
      return json.response.output_text;
    }

    const candidates = [
      json.output,
      json.response?.output,
      json.item?.content,
      json.content,
      json.response,
      json.item
    ];

    for (const candidate of candidates) {
      const text = flattenTextParts(candidate);
      if (text) return text;
    }

    return '';
  }

  function extractChatText(json) {
    if (!json || typeof json !== 'object') return '';

    const choice = json.choices?.[0];
    if (!choice) return '';

    return (
      flattenTextParts(choice.message?.content) ||
      flattenTextParts(choice.delta?.content) ||
      flattenTextParts(choice.text)
    );
  }

  function extractText(json, runtime) {
    if (runtime?.endpointMode === 'responses') {
      return extractResponsesText(json) || extractChatText(json);
    }

    return extractChatText(json) || extractResponsesText(json);
  }

  function extractDelta(json, runtime, eventName) {
    if (!json || typeof json !== 'object') return '';

    if (runtime?.endpointMode === 'responses') {
      const type = String(json.type || eventName || '');

      if (type === 'response.output_text.delta') {
        return typeof json.delta === 'string' ? json.delta : '';
      }

      if (type.endsWith('.delta') && typeof json.delta === 'string') {
        return json.delta;
      }

      if (type.endsWith('.added') && typeof json.item?.text === 'string') {
        return json.item.text;
      }
    }

    return extractChatText(json);
  }

  function extractUsage(json) {
    return json?.usage || json?.response?.usage || null;
  }

  const adapter = {
    id: 'openai',
    provider: 'openai',
    family: 'openai_compatible',
    displayName: 'OpenAI Compatible',
    resolve,
    buildHeaders,
    buildBody,
    extractText,
    extractDelta,
    extractUsage
  };

  global.AISummaryOpenAIAdapter = adapter;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = adapter;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

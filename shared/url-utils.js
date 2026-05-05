(function (global) {
  const AdapterUtils = (/** @type {any} */ (global)).AISummaryAdapterUtils || (typeof require === 'function' ? require('./adapter-utils.js') : null);

  function trimTrailingSlash(value) {
    if (AdapterUtils?.trimTrailingSlash) return AdapterUtils.trimTrailingSlash(value);
    return String(value || '').replace(/\/+$/, '');
  }

  function normalizeBaseURLInput(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    let normalized = raw;
    if (!/^https?:\/\//i.test(normalized)) {
      // Treat bare domains/hosts as HTTPS by default for convenience.
      if (/^[a-z0-9.-]+(?::\d+)?(?:\/|$)/i.test(normalized)) {
        normalized = 'https://' + normalized;
      }
    }

    try {
      const parsed = new URL(normalized);
      parsed.hash = '';
      parsed.search = '';
      parsed.pathname = String(parsed.pathname || '').replace(/\/+$/, '') || '/';
      return parsed.toString().replace(/\/$/, '');
    } catch {
      return trimTrailingSlash(normalized);
    }
  }

  function normalizeUrlNoTrailingSlash(value) {
    return trimTrailingSlash(String(value || '').trim());
  }

  function detectOpenAiEndpointModeFromUrl(value) {
    const lowerValue = normalizeUrlNoTrailingSlash(value).toLowerCase();
    if (lowerValue.endsWith('/chat/completions')) return 'chat_completions';
    if (lowerValue.endsWith('/responses')) return 'responses';
    if (lowerValue.endsWith('/completions')) return 'legacy_completions';
    return '';
  }

  function detectAnthropicEndpointModeFromUrl(value) {
    const lowerValue = normalizeUrlNoTrailingSlash(value).toLowerCase();
    if (lowerValue.endsWith('/v1/messages')) return 'messages';
    return '';
  }

  function stripOpenAiEndpointSuffix(value) {
    return normalizeUrlNoTrailingSlash(value)
      .replace(/\/chat\/completions$/i, '')
      .replace(/\/responses$/i, '')
      .replace(/\/completions$/i, '');
  }

  function stripAnthropicMessagesSuffix(value) {
    return normalizeUrlNoTrailingSlash(value).replace(/\/v1\/messages$/i, '');
  }

  function toggleTrailingV1(value) {
    const normalized = normalizeUrlNoTrailingSlash(value);
    if (!normalized) return normalized;
    if (/\/v1$/i.test(normalized)) return normalized.replace(/\/v1$/i, '');
    return normalized + '/v1';
  }

  const UrlUtils = {
    normalizeBaseURLInput,
    normalizeUrlNoTrailingSlash,
    detectOpenAiEndpointModeFromUrl,
    detectAnthropicEndpointModeFromUrl,
    stripOpenAiEndpointSuffix,
    stripAnthropicMessagesSuffix,
    toggleTrailingV1
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = UrlUtils;
  } else {
    (/** @type {any} */ (global)).AISummaryUrlUtils = UrlUtils;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : {});

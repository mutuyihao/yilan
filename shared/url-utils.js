(function (global) {
  const AdapterUtils = (/** @type {any} */ (global)).AISummaryAdapterUtils || (typeof require === 'function' ? require('./adapter-utils.js') : null);

  function trimTrailingSlash(value) {
    if (AdapterUtils?.trimTrailingSlash) return AdapterUtils.trimTrailingSlash(value);
    return String(value || '').replace(/\/+$/, '');
  }

  function stripIpv6Brackets(hostname) {
    return String(hostname || '').trim().replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
  }

  function isIpv4Segment(value) {
    if (!/^\d+$/.test(String(value || ''))) return false;
    const numeric = Number(value);
    return numeric >= 0 && numeric <= 255;
  }

  function isPrivateIpv4Hostname(hostname) {
    const normalized = stripIpv6Brackets(hostname);
    const parts = normalized.split('.');
    if (parts.length !== 4 || !parts.every(isIpv4Segment)) return false;

    const first = Number(parts[0]);
    const second = Number(parts[1]);

    if (normalized === '0.0.0.0') return true;
    if (first === 10 || first === 127) return true;
    if (first === 169 && second === 254) return true;
    if (first === 192 && second === 168) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    return false;
  }

  function isLocalIpv6Hostname(hostname) {
    const normalized = stripIpv6Brackets(hostname);
    if (!normalized) return false;
    if (normalized === '::1') return true;
    if (/^fe[89ab][0-9a-f:]*$/i.test(normalized)) return true;
    if (/^f[cd][0-9a-f:]*$/i.test(normalized)) return true;
    return false;
  }

  function isAllowedHttpHostname(hostname) {
    const normalized = stripIpv6Brackets(hostname);
    if (!normalized) return false;
    if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
    if (normalized.endsWith('.local')) return true;
    if (isPrivateIpv4Hostname(normalized)) return true;
    if (isLocalIpv6Hostname(normalized)) return true;
    return false;
  }

  function isAllowedModelEndpointUrl(value) {
    if (!value) return true;

    try {
      const parsed = new URL(String(value || '').trim());
      const protocol = String(parsed.protocol || '').toLowerCase();
      if (protocol === 'https:') return true;
      if (protocol !== 'http:') return false;
      return isAllowedHttpHostname(parsed.hostname);
    } catch {
      return false;
    }
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
    isAllowedModelEndpointUrl,
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

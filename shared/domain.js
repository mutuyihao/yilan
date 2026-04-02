(function (global) {
  const TRACKING_PARAM_PATTERNS = [
    /^utm_/i,
    /^fbclid$/i,
    /^gclid$/i,
    /^spm$/i,
    /^mc_eid$/i,
    /^mc_cid$/i,
    /^ref$/i
  ];

  function normalizeWhitespace(input) {
    return String(input || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function getSourceHost(url) {
    try {
      return new URL(url).host || '';
    } catch {
      return '';
    }
  }

  function normalizeUrl(url) {
    if (!url) return '';

    try {
      const parsed = new URL(url);
      parsed.hash = '';

      const toDelete = [];
      parsed.searchParams.forEach((_, key) => {
        if (TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key))) {
          toDelete.push(key);
        }
      });
      toDelete.forEach((key) => parsed.searchParams.delete(key));

      const sorted = Array.from(parsed.searchParams.entries())
        .sort(([a], [b]) => a.localeCompare(b));
      parsed.search = '';
      sorted.forEach(([key, value]) => parsed.searchParams.append(key, value));

      return parsed.toString();
    } catch {
      return String(url || '').trim();
    }
  }

  function hashString(input) {
    const str = String(input || '');
    let hash = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function createRuntimeId(prefix) {
    const randomPart = Math.random().toString(36).slice(2, 8);
    return `${prefix}_${Date.now().toString(36)}_${randomPart}`;
  }

  function createDeterministicId(prefix, seed) {
    return `${prefix}_${hashString(seed)}`;
  }

  function inferLanguage(text, fallback) {
    const value = String(text || '');
    const cjkMatches = value.match(/[\u3400-\u9fff]/g) || [];
    const latinMatches = value.match(/[A-Za-z]/g) || [];

    if (cjkMatches.length >= 20 && cjkMatches.length >= latinMatches.length * 0.3) {
      return 'zh';
    }

    if (latinMatches.length >= 20) {
      return 'en';
    }

    return fallback || 'zh';
  }

  function detectSiteType(input) {
    const url = String(input?.url || '').toLowerCase();
    const host = String(input?.host || getSourceHost(url) || '').toLowerCase();
    const title = String(input?.title || '').toLowerCase();

    if (host.includes('github.com')) {
      return url.includes('/issues') || url.includes('/discussions') ? 'forum' : 'repo';
    }

    if (
      host.includes('stackoverflow.com') ||
      host.includes('reddit.com') ||
      host.includes('v2ex.com') ||
      host.includes('quora.com') ||
      host.includes('zhihu.com')
    ) {
      return 'forum';
    }

    if (
      host.startsWith('docs.') ||
      host.includes('developer.') ||
      url.includes('/docs') ||
      title.includes('documentation') ||
      title.includes('api reference')
    ) {
      return 'doc';
    }

    if (
      host.includes('medium.com') ||
      host.includes('substack.com') ||
      host.includes('dev.to') ||
      host.includes('hashnode.com') ||
      title.includes('blog')
    ) {
      return 'blog';
    }

    if (
      host.includes('news') ||
      host.includes('nytimes.com') ||
      host.includes('cnn.com') ||
      host.includes('reuters.com') ||
      host.includes('theverge.com') ||
      host.includes('36kr.com') ||
      host.includes('ithome.com')
    ) {
      return 'news';
    }

    return 'unknown';
  }

  function pickFirstNonEmpty(values) {
    for (const value of values) {
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return '';
  }

  function toIsoString(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString();
  }

  const api = {
    normalizeWhitespace,
    getSourceHost,
    normalizeUrl,
    hashString,
    createRuntimeId,
    createDeterministicId,
    inferLanguage,
    detectSiteType,
    pickFirstNonEmpty,
    toIsoString
  };

  global.AISummaryDomain = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

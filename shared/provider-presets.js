(function (global) {
  const Catalog = global.AISummaryProviderCatalog || (typeof require === 'function' ? require('./provider-catalog.generated.js') : null);

  const FALLBACK_ENDPOINT_MODE_META = {
    auto: { label: '自动判断', description: '按 Base URL 试探最终接口。' },
    responses: { label: 'Responses API', description: '使用 `/responses` 接口。' },
    chat_completions: { label: 'Chat Completions', description: '使用 `/chat/completions` 接口。' },
    legacy_completions: { label: 'Legacy Completions', description: '使用 `/completions` 接口。' },
    messages: { label: 'Messages API', description: '使用 `/v1/messages` 接口。' }
  };

  function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function listCatalogProviders() {
    if (Catalog?.listProviders) return Catalog.listProviders();
    return [];
  }

  function normalizeUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
  }

  function getProviderEntry(id) {
    const key = String(id || '').trim();
    const providers = listCatalogProviders();
    return providers.find((item) => item.id === key) || providers[0] || {
      id: 'custom',
      label: '自定义兼容接口',
      hint: '',
      routes: []
    };
  }

  function listRoutes(presetId) {
    const provider = getProviderEntry(presetId);
    return Array.isArray(provider.routes) ? provider.routes.slice() : [];
  }

  function routeToProfile(route) {
    if (!route) return null;
    return {
      routeId: route.routeId || '',
      label: route.label || '',
      endpointModes: Array.isArray(route.endpointModes) ? route.endpointModes.slice() : [],
      defaultEndpointMode: route.defaultEndpointMode || '',
      baseUrl: route.baseUrl || '',
      defaultModel: route.defaultModel || '',
      keyHint: route.keyHint || '',
      keyRule: route.keyRule ? cloneValue(route.keyRule) : null,
      hint: route.hint || '',
      sourceUrl: route.sourceUrl || ''
    };
  }

  function getPreset(id) {
    const entry = getProviderEntry(id);
    const defaultRoute = getDefaultRoute(entry.id);
    const providerProfiles = {};

    listRoutes(entry.id).forEach((route) => {
      const providerId = String(route.aiProvider || '').toLowerCase();
      if (!providerId || providerProfiles[providerId]) return;
      providerProfiles[providerId] = routeToProfile(route);
    });

    return {
      id: entry.id,
      label: entry.label,
      hint: entry.hint || '',
      sourceUrl: entry.sourceUrl || '',
      verifiedAt: entry.verifiedAt || '',
      defaultProvider: defaultRoute?.aiProvider || entry.defaultProvider || 'openai',
      defaultRouteId: defaultRoute?.routeId || '',
      providerProfiles
    };
  }

  function listPresets() {
    return listCatalogProviders().map((item) => getPreset(item.id));
  }

  function getProviderRoutes(presetId) {
    return listRoutes(presetId).map((route) => cloneValue(route));
  }

  function getProviderRoute(presetId, routeId) {
    const id = String(routeId || '').trim();
    const route = listRoutes(presetId).find((item) => item.routeId === id);
    return route ? cloneValue(route) : null;
  }

  function getProviderOptions(presetId) {
    const seen = new Set();
    const output = [];
    listRoutes(presetId).forEach((route) => {
      const provider = String(route.aiProvider || '').toLowerCase();
      if (!provider || seen.has(provider)) return;
      seen.add(provider);
      output.push(provider);
    });
    return output;
  }

  function normalizeProvider(provider, presetId) {
    const candidates = getProviderOptions(presetId);
    const normalized = String(provider || '').toLowerCase();
    return candidates.includes(normalized) ? normalized : (candidates[0] || 'openai');
  }

  function getDefaultRoute(presetId, provider) {
    const routes = listRoutes(presetId);
    const normalizedProvider = String(provider || '').toLowerCase();
    const providerRoutes = normalizedProvider
      ? routes.filter((route) => String(route.aiProvider || '').toLowerCase() === normalizedProvider)
      : routes;
    const candidates = providerRoutes.length ? providerRoutes : routes;
    const route = candidates.find((item) => item.isDefault) || candidates[0] || null;
    return route ? cloneValue(route) : null;
  }

function getProviderProfile(presetId, provider) {
    const requestedProvider = String(provider || '').toLowerCase();
    if (requestedProvider && !getProviderOptions(presetId).includes(requestedProvider)) {
      return null;
    }
    const normalizedProvider = normalizeProvider(provider, presetId);
    return routeToProfile(getDefaultRoute(presetId, normalizedProvider));
  }

  function getEndpointModes(presetId, provider) {
    const profile = getProviderProfile(presetId, provider);
    if (profile?.endpointModes?.length) return profile.endpointModes.slice();
    return String(provider || '').toLowerCase() === 'anthropic' ? ['messages'] : ['auto', 'responses', 'chat_completions', 'legacy_completions'];
  }

  function normalizeEndpointMode(mode, provider, presetId) {
    const candidates = getEndpointModes(presetId, provider);
    const normalized = String(mode || '').trim();
    if (candidates.includes(normalized)) return normalized;

    const profile = getProviderProfile(presetId, provider);
    if (profile?.defaultEndpointMode && candidates.includes(profile.defaultEndpointMode)) {
      return profile.defaultEndpointMode;
    }

    return candidates[0] || (String(provider || '').toLowerCase() === 'anthropic' ? 'messages' : 'auto');
  }

  function routeMatchesBaseUrl(route, baseUrl, provider) {
    if (!route?.baseUrl || !baseUrl) return 0;
    if (provider && String(route.aiProvider || '').toLowerCase() !== String(provider || '').toLowerCase()) return 0;

    const routeUrl = normalizeUrl(route.baseUrl);
    const targetUrl = normalizeUrl(baseUrl);
    if (!routeUrl || !targetUrl) return 0;
    if (targetUrl === routeUrl) return 100;
    if (targetUrl.startsWith(routeUrl + '/')) return 90;

    try {
      const routeParsed = new URL(routeUrl);
      const targetParsed = new URL(targetUrl);
      if (routeParsed.host === targetParsed.host) return 40;
    } catch {}

    return 0;
  }

  function inferRouteFromSettings(settings, presetIdOverride) {
    const presetId = String(presetIdOverride || settings?.providerPreset || inferPresetFromSettings(settings)).trim() || 'custom';
    const provider = String(settings?.aiProvider || '').trim().toLowerCase();
    const baseUrl = String(settings?.aiBaseURL || '').trim();
    const routes = listRoutes(presetId);
    let best = null;
    let bestScore = 0;

    routes.forEach((route) => {
      const score = routeMatchesBaseUrl(route, baseUrl, provider);
      if (score > bestScore) {
        best = route;
        bestScore = score;
      }
    });

    if (best) return cloneValue(best);
    return getDefaultRoute(presetId, normalizeProvider(provider, presetId));
  }

  function validateCredentials(presetId, provider, baseUrl, apiKey) {
    const key = String(apiKey || '').trim();
    if (!key) return { valid: true, message: '' };

    const route = inferRouteFromSettings({
      providerPreset: presetId,
      aiProvider: provider,
      aiBaseURL: baseUrl
    }, presetId);
    const rule = route?.keyRule;

    if (rule?.prefix && !key.startsWith(rule.prefix)) {
      return {
        valid: false,
        message: rule.message || `当前地址需要 ${rule.prefix} 开头的 API Key。`
      };
    }

    return { valid: true, message: '' };
  }

  function inferPresetFromSettings(settings) {
    const baseUrl = String(settings?.aiBaseURL || '').trim();
    const provider = String(settings?.aiProvider || '').toLowerCase();
    const model = String(settings?.modelName || '').trim().toLowerCase();
    let bestPreset = '';
    let bestScore = 0;

    listCatalogProviders().forEach((entry) => {
      (entry.routes || []).forEach((route) => {
        const score = routeMatchesBaseUrl(route, baseUrl, '');
        if (score > bestScore) {
          bestPreset = entry.id;
          bestScore = score;
        }
      });
    });

    if (bestPreset) return bestPreset;

    if (provider === 'anthropic' && model.startsWith('claude')) return 'anthropic_official';
    if (provider === 'openai' && model.startsWith('gemini')) return 'gemini';
    if ((provider === 'openai' || provider === 'anthropic') && model.startsWith('mimo')) return 'mimo';
    if (provider === 'openai' && model.startsWith('grok')) return 'xai';
    if (provider === 'openai' && (model.startsWith('gpt-') || model.startsWith('o'))) return 'openai_official';
    if (provider === 'anthropic') return 'anthropic_official';
    if (provider === 'openai') return 'openai_official';
    return 'custom';
  }

  const api = {
    ENDPOINT_MODE_META: cloneValue(Catalog?.ENDPOINT_MODE_META || FALLBACK_ENDPOINT_MODE_META),
    listPresets,
    getPreset,
    getProviderProfile,
    getProviderRoutes,
    getProviderRoute,
    getDefaultRoute,
    getProviderOptions,
    getEndpointModes,
    normalizeProvider,
    normalizeEndpointMode,
    validateCredentials,
    inferPresetFromSettings,
    inferRouteFromSettings
  };

  global.AISummaryProviderPresets = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

(function initYilanPopupProviderSelection(global) {
  function createProviderSelectionController(deps) {
    const $ = deps.$;
    const I18n = deps.i18n;
    const ProviderPresets = deps.providerPresets;
    const normalizeBaseURLInput = deps.normalizeBaseURLInput;
    const persistSettings = deps.persistSettings;
    const collectSettings = deps.collectSettings;
    const loadCachedModelOptions = deps.loadCachedModelOptions;
    const syncThemePreferenceControl = deps.syncThemePreferenceControl;
    const syncThemePaletteControl = deps.syncThemePaletteControl;
    const UrlUtils = deps.urlUtils;
    const UiLabels = deps.uiLabels;

  const BASE_URL_SECURITY_HINT = I18n.get('popup_base_url_security_hint');
  const PROVIDER_FALLBACK_HINTS = {
    openai: I18n.get('popup_fallback_hint_openai'),
    anthropic: I18n.get('popup_fallback_hint_anthropic')
  };

  const autoFillState = {
    baseURL: '',
    modelName: ''
  };

  // Provider-catalog copy (preset/route/endpoint-mode labels and hints) is
  // authored in Chinese inside the generated catalog; the locale catalogs
  // mirror it under id-derived keys so the uiLanguage setting can translate
  // it. Missing keys fall back to the catalog text (also covers third-party
  // presets added without translations).
  function catalogText(key, fallback) {
    const message = I18n.get(key);
    return message || fallback || '';
  }

  function routeKeyBase(route) {
    return 'provider_route_' + String(route?.routeId || '').replace(/-/g, '_');
  }

  function presetText(preset, suffix, fallback) {
    return catalogText('provider_preset_' + preset?.id + '_' + suffix, fallback);
  }

  function routeText(route, suffix, fallback) {
    return catalogText(routeKeyBase(route) + '_' + suffix, fallback);
  }

  function endpointModeText(mode, suffix, fallback) {
    return catalogText('provider_endpoint_mode_' + mode + '_' + suffix, fallback);
  }

  function buildEndpointPreview(provider, endpointMode) {
    if (provider === 'anthropic') return '/v1/messages';
    if (endpointMode === 'responses') return '/responses';
    if (endpointMode === 'chat_completions') return '/chat/completions';
    if (endpointMode === 'legacy_completions') return '/completions';
    return I18n.get('popup_endpoint_auto_probe');
  }

  function getEndpointModeLabel(mode) {
    const meta = ProviderPresets?.ENDPOINT_MODE_META?.[mode];
    return endpointModeText(mode, 'label', meta?.label) || mode || I18n.get('popup_endpoint_mode_auto');
  }

  function pickEffectiveBaseURLInput(rawInput, fallbackBaseUrl) {
    const normalized = normalizeBaseURLInput(rawInput);
    if (normalized) return normalized;
    return String(fallbackBaseUrl || '').trim();
  }

  function getConnectionFieldSettings() {
    return {
      providerPreset: $('providerPreset')?.value || 'custom',
      aiProvider: $('aiProvider')?.value || '',
      endpointMode: $('endpointMode')?.value || '',
      aiBaseURL: normalizeBaseURLInput($('baseURL')?.value || ''),
      modelName: $('modelName')?.value || ''
    };
  }

  function renderEndpointPreview() {
    const previewNode = $('endpointPreview');
    if (!previewNode) return;

    const { provider, endpointMode, route, profile } = getCurrentSelection();
    const rawInput = $('baseURL')?.value || '';
    const defaultBaseUrl = provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
    const baseRoot = pickEffectiveBaseURLInput(rawInput, route?.baseUrl || profile?.baseUrl || defaultBaseUrl);
    if (!baseRoot) {
      previewNode.textContent = '';
      return;
    }

    const openaiDetected = UrlUtils?.detectOpenAiEndpointModeFromUrl?.(baseRoot) || '';
    const anthropicDetected = UrlUtils?.detectAnthropicEndpointModeFromUrl?.(baseRoot) || '';
    const isFullEndpoint = !!(openaiDetected || anthropicDetected);
    const lines = [];

    if (isFullEndpoint) {
      const detectedMode = openaiDetected || anthropicDetected;
      lines.push(I18n.get('popup_preview_actual_url', [baseRoot]));
      lines.push(I18n.get('popup_preview_mode_full', [getEndpointModeLabel(detectedMode)]));
      lines.push(I18n.get('popup_preview_full_note'));
      previewNode.textContent = lines.join('\n');
      return;
    }

    if (provider === 'anthropic') {
      const root = UrlUtils?.stripAnthropicMessagesSuffix?.(baseRoot) || baseRoot;
      lines.push(I18n.get('popup_preview_actual_url', [`${root}/v1/messages`]));
      lines.push(I18n.get('popup_preview_mode', [getEndpointModeLabel('messages')]));
      previewNode.textContent = lines.join('\n');
      return;
    }

    const root = UrlUtils?.stripOpenAiEndpointSuffix?.(baseRoot) || baseRoot;
    const hasV1 = /\/v1$/i.test(root);

    if (endpointMode === 'auto') {
      lines.push(I18n.get('popup_preview_actual_url', [`${root}/responses -> ${root}/chat/completions -> ${root}/completions`]));
      lines.push(I18n.get('popup_preview_mode', [I18n.get('popup_endpoint_mode_auto')]));
      lines.push(hasV1 ? I18n.get('popup_base_url_has_v1') : I18n.get('popup_base_url_no_v1'));
      previewNode.textContent = lines.join('\n');
      return;
    }

    const path = buildEndpointPreview(provider, endpointMode);
    if (path && path.startsWith('/')) {
      lines.push(I18n.get('popup_preview_actual_url', [`${root}${path}`]));
      lines.push(I18n.get('popup_preview_mode', [getEndpointModeLabel(endpointMode)]));
      lines.push(hasV1 ? I18n.get('popup_base_url_has_v1') : I18n.get('popup_base_url_no_v1'));
      previewNode.textContent = lines.join('\n');
      return;
    }

    previewNode.textContent = '';
  }

  function inferPresetId(settings) {
    const stored = String(settings?.providerPreset || '').trim();
    if (stored) return stored;
    return ProviderPresets.inferPresetFromSettings(settings);
  }

  function inferEndpointMode(settings, presetId, provider) {
    const stored = String(settings?.endpointMode || '').trim();
    if (stored) {
      return ProviderPresets.normalizeEndpointMode(stored, provider, presetId);
    }

    const baseUrl = String(settings?.aiBaseURL || '').toLowerCase();
    if (baseUrl.includes('/chat/completions')) {
      return ProviderPresets.normalizeEndpointMode('chat_completions', provider, presetId);
    }
    if (baseUrl.includes('/responses')) {
      return ProviderPresets.normalizeEndpointMode('responses', provider, presetId);
    }
    if (/\/completions(?:$|[?#])/i.test(baseUrl)) {
      return ProviderPresets.normalizeEndpointMode('legacy_completions', provider, presetId);
    }
    if (provider === 'anthropic') {
      return ProviderPresets.normalizeEndpointMode('messages', provider, presetId);
    }
    return ProviderPresets.normalizeEndpointMode('', provider, presetId);
  }

  function renderPresetOptions() {
    const select = $('providerPreset');
    select.innerHTML = '';

    ProviderPresets.listPresets().forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = presetText(preset, 'label', preset.label);
      select.appendChild(option);
    });
  }

  function syncRouteOptions(presetId, preferredRouteId, preferredProvider) {
    const select = $('providerRoute');
    const routes = ProviderPresets.getProviderRoutes(presetId);
    select.innerHTML = '';

    routes.forEach((route) => {
      const option = document.createElement('option');
      option.value = route.routeId;
      option.textContent = routeText(route, 'label', route.label);
      select.appendChild(option);
    });

    let route = preferredRouteId ? ProviderPresets.getProviderRoute(presetId, preferredRouteId) : null;
    if (route && preferredProvider && route.aiProvider !== preferredProvider) {
      route = null;
    }
    if (!route) {
      route = ProviderPresets.inferRouteFromSettings(getConnectionFieldSettings(), presetId);
    }
    if (route && preferredProvider && route.aiProvider !== preferredProvider) {
      route = ProviderPresets.getDefaultRoute(presetId, preferredProvider);
    }
    if (!route) {
      route = ProviderPresets.getDefaultRoute(presetId);
    }

    if (route?.routeId) {
      select.value = route.routeId;
    }
    return route;
  }

  function syncProviderOptions(presetId, preferredProvider) {
    const allowed = new Set(ProviderPresets.getProviderOptions(presetId));
    const providerSelect = $('aiProvider');
    const candidate = preferredProvider || providerSelect.value;

    Array.from(providerSelect.options).forEach((option) => {
      const supported = allowed.has(option.value);
      option.disabled = !supported;
      option.textContent = UiLabels.getProviderLabel(option.value, { variant: 'settings', fallback: option.value });
    });

    providerSelect.value = ProviderPresets.normalizeProvider(candidate, presetId);
    return providerSelect.value;
  }

  function syncEndpointModeOptions(presetId, provider, preferredMode, route) {
    const select = $('endpointMode');
    const routeModes = Array.isArray(route?.endpointModes) ? route.endpointModes : [];
    const modes = routeModes.length ? routeModes : ProviderPresets.getEndpointModes(presetId, provider);
    const fallbackMode = route?.defaultEndpointMode || '';
    const requestedMode = preferredMode || fallbackMode;
    const nextMode = modes.includes(requestedMode)
      ? requestedMode
      : ProviderPresets.normalizeEndpointMode(fallbackMode || requestedMode, provider, presetId);
    select.innerHTML = '';

    modes.forEach((mode) => {
      const meta = ProviderPresets.ENDPOINT_MODE_META[mode] || { label: mode };
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = endpointModeText(mode, 'label', meta.label);
      select.appendChild(option);
    });

    select.value = modes.includes(nextMode) ? nextMode : (modes[0] || nextMode);
    return select.value;
  }

  function getCurrentSelection() {
    const presetId = $('providerPreset').value || 'custom';
    const selectedRouteId = $('providerRoute')?.value || '';
    const route = ProviderPresets.getProviderRoute(presetId, selectedRouteId)
      || ProviderPresets.inferRouteFromSettings(getConnectionFieldSettings(), presetId);
    const provider = ProviderPresets.normalizeProvider($('aiProvider').value || route?.aiProvider || '', presetId);
    const endpointMode = ProviderPresets.normalizeEndpointMode($('endpointMode').value || route?.defaultEndpointMode || '', provider, presetId);
    const preset = ProviderPresets.getPreset(presetId);
    const profile = ProviderPresets.getProviderProfile(presetId, provider);
    return { presetId, provider, endpointMode, preset, profile, route };
  }

  function maybeApplySuggestedValue(fieldId, suggestedValue, options = {}) {
    if (typeof suggestedValue === 'undefined') return;
    const field = $(fieldId);
    const currentValue = String(field.value || '').trim();
    const autoKey = fieldId === 'baseURL' ? 'baseURL' : 'modelName';
    const previousAutoValue = autoFillState[autoKey] || '';
    const shouldApply = options.force || !currentValue || currentValue === previousAutoValue;

    if (shouldApply) {
      field.value = String(suggestedValue || '');
    }
  }

  function updateHints() {
    const selection = getCurrentSelection();
    const { provider, endpointMode, preset, profile, route } = selection;
    const endpointMeta = ProviderPresets.ENDPOINT_MODE_META[endpointMode] || { description: '' };
    const endpointPreview = buildEndpointPreview(provider, endpointMode);
    const sourceText = preset?.sourceUrl
      ? I18n.get('popup_source_label', [preset.sourceUrl]) + (preset.verifiedAt ? I18n.get('popup_source_verified', [preset.verifiedAt]) : '')
      : '';

    $('presetHint').textContent = presetText(preset, 'hint', preset?.hint) || I18n.get('popup_preset_hint_default');
    $('routeHint').textContent = routeText(route, 'hint', route?.hint);
    $('apiKeyHint').textContent = routeText(route, 'key_hint', route?.keyHint) || I18n.get('popup_api_key_hint_default');
    $('endpointModeHint').textContent = [
      endpointModeText(endpointMode, 'description', endpointMeta.description),
      endpointPreview ? I18n.get('popup_endpoint_mode_hint_suffix', [endpointPreview]) : ''
    ].filter(Boolean).join(' ');

    const baseUrlHint = route?.baseUrl
      ? I18n.get('popup_base_url_hint_route', [route.baseUrl])
      : (PROVIDER_FALLBACK_HINTS[provider] || '');
    $('baseURLHint').textContent = [baseUrlHint, BASE_URL_SECURITY_HINT].filter(Boolean).join(' ');

    $('providerCatalogMeta').textContent = sourceText;
    $('baseURL').placeholder = route?.baseUrl || profile?.baseUrl || I18n.get('popup_base_url_placeholder_default');
    $('modelName').placeholder = route?.defaultModel || profile?.defaultModel || (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o-mini');
    renderEndpointPreview();
  }

  function syncSelectionState(options = {}) {
    const presetId = $('providerPreset').value || 'custom';
    let route = syncRouteOptions(presetId, options.preferredRouteId, options.preferredProvider);
    const provider = syncProviderOptions(presetId, route?.aiProvider || options.preferredProvider);

    if (!route || route.aiProvider !== provider) {
      route = syncRouteOptions(presetId, '', provider);
    }

    const endpointMode = syncEndpointModeOptions(
      presetId,
      provider,
      options.preferredEndpointMode || route?.defaultEndpointMode || $('endpointMode').value,
      route
    );

    $('aiProvider').value = provider;
    $('endpointMode').value = endpointMode;
    if (route?.routeId) $('providerRoute').value = route.routeId;

    if (options.syncSuggestedValues) {
      const shouldForce = !!options.forceSuggestedValues;
      maybeApplySuggestedValue('baseURL', route?.baseUrl || '', { force: shouldForce });
      maybeApplySuggestedValue('modelName', route?.defaultModel || '', { force: shouldForce });
    }

    autoFillState.baseURL = route?.baseUrl || '';
    autoFillState.modelName = route?.defaultModel || '';
    updateHints();
  }

  function bindSelectionListeners() {
    $('providerPreset').addEventListener('change', () => {
      const presetId = $('providerPreset').value || 'custom';
      const route = ProviderPresets.getDefaultRoute(presetId);
      syncSelectionState({
        preferredRouteId: route?.routeId || '',
        preferredProvider: route?.aiProvider || '',
        preferredEndpointMode: route?.defaultEndpointMode || '',
        syncSuggestedValues: true,
        forceSuggestedValues: true
      });
      persistSettings();
      loadCachedModelOptions(collectSettings());
    });

    $('providerRoute').addEventListener('change', () => {
      const presetId = $('providerPreset').value || 'custom';
      const route = ProviderPresets.getProviderRoute(presetId, $('providerRoute').value);
      syncSelectionState({
        preferredRouteId: route?.routeId || '',
        preferredProvider: route?.aiProvider || '',
        preferredEndpointMode: route?.defaultEndpointMode || '',
        syncSuggestedValues: true,
        forceSuggestedValues: true
      });
      persistSettings();
      loadCachedModelOptions(collectSettings());
    });

    $('aiProvider').addEventListener('change', () => {
      const presetId = $('providerPreset').value || 'custom';
      const provider = $('aiProvider').value;
      const route = ProviderPresets.getDefaultRoute(presetId, provider);
      syncSelectionState({
        preferredRouteId: route?.routeId || '',
        preferredProvider: provider,
        preferredEndpointMode: route?.defaultEndpointMode || $('endpointMode').value,
        syncSuggestedValues: true,
        forceSuggestedValues: true
      });
      persistSettings();
      loadCachedModelOptions(collectSettings());
    });

    $('endpointMode').addEventListener('change', () => {
      syncSelectionState({ preferredEndpointMode: $('endpointMode').value });
      persistSettings();
      loadCachedModelOptions(collectSettings());
    });

    $('themePreference').addEventListener('change', () => {
      syncThemePreferenceControl($('themePreference').value);
      persistSettings();
    });

    document.querySelectorAll('[data-palette-option]').forEach((button) => {
      button.addEventListener('click', () => {
        syncThemePaletteControl(button.dataset.paletteOption);
        persistSettings();
      });
    });
  }


    return {
      PROVIDER_FALLBACK_HINTS,
      BASE_URL_SECURITY_HINT,
      autoFillState,
      buildEndpointPreview,
      getEndpointModeLabel,
      pickEffectiveBaseURLInput,
      getConnectionFieldSettings,
      renderEndpointPreview,
      inferPresetId,
      inferEndpointMode,
      renderPresetOptions,
      syncRouteOptions,
      syncProviderOptions,
      syncEndpointModeOptions,
      getCurrentSelection,
      maybeApplySuggestedValue,
      updateHints,
      syncSelectionState,
      bindSelectionListeners
    };
  }

  const api = {
    createProviderSelectionController
  };

  global.YilanPopupProviderSelection = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

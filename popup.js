const Errors = window.AISummaryErrors;
const Trust = window.AISummaryTrust;
const ProviderPresets = window.AISummaryProviderPresets;
const Theme = window.AISummaryTheme;
const UiFormat = window.AISummaryUiFormat;
const UiLabels = window.AISummaryUiLabels;
const Constants = window.AISummaryConstants;
const UrlUtils = window.AISummaryUrlUtils;

const SETTINGS_KEYS = [
  'providerPreset',
  'aiProvider',
  'endpointMode',
  'apiKey',
  'aiBaseURL',
  'modelName',
  'systemPrompt',
  'autoTranslate',
  'defaultLanguage',
  'themePreference',
  'themePalette',
  'privacyMode',
  'defaultAllowHistory',
  'defaultAllowShare',
  'entrypointAutoStart',
  'entrypointSimpleMode',
  'entrypointReuseHistory'
];

const PROFILES_INDEX_KEY = 'yilanProfilesIndexV1';
const ACTIVE_PROFILE_ID_KEY = 'yilanActiveProfileIdV1';
const PROFILE_KEY_PREFIX = 'yilanProfileV1:';

const MODELS_CACHE_STORAGE_KEY = 'yilanModelsCacheV1';

const ACTIVE_TAB_STORAGE_KEY = 'popupActiveTab';
const IDLE_STATUS_TEXT = '设置修改后会自动保存。';
const WAITING_AUTOSAVE_TEXT = '检测到变更，输入停顿后会自动保存。';

const PROVIDER_FALLBACK_HINTS = {
  openai: '留空时使用 OpenAI 默认根地址，也可以直接填写完整 endpoint。',
  anthropic: '留空时使用 Anthropic 默认根地址，也可以填写兼容根地址。'
};

const THEME_PREFERENCE_LABELS = {
  system: '自动跟随系统',
  light: '固定浅色',
  dark: '固定深色'
};

const THEME_EFFECTIVE_LABELS = {
  light: '浅色',
  dark: '深色'
};

const THEME_PALETTE_LABELS = {
  jade: '松石绿',
  slate: '雾蓝',
  copper: '岩茶棕',
  plum: '檀紫'
};

const THEME_PALETTE_HINTS = {
  jade: '默认方案，清爽、稳定，适合长期阅读',
  slate: '蓝灰倾向更克制，适合弱化品牌色干扰',
  copper: '偏茶棕的暖调方案，保留温度但不偏黄',
  plum: '更有识别度的深檀色调，适合强调品牌感'
};

const autoFillState = {
  baseURL: '',
  modelName: ''
};

const saveState = {
  timer: null,
  lastSavedSignature: '',
  requestId: 0
};

const profileState = {
  activeId: '',
  index: []
};

const $ = (id) => document.getElementById(id);

function getRuntimeErrorMessage(errorLike) {
  if (!errorLike) {
    return typeof Errors?.getUserMessage === 'function' ? Errors.getUserMessage(null) : 'Unknown error.';
  }
  if (typeof errorLike === 'string') {
    return errorLike || (typeof Errors?.getUserMessage === 'function' ? Errors.getUserMessage(null) : 'Unknown error.');
  }

  const hasMessage = typeof errorLike?.message === 'string' && errorLike.message.trim();
  const hasCode = typeof errorLike?.code === 'string' && errorLike.code.trim();

  // Prefer raw messages for plain `{ message: string }` objects (e.g. chrome.runtime.lastError),
  // otherwise Errors.getUserMessage() will fall back to a generic "Unknown error" catalog message.
  if (hasMessage && !hasCode) return errorLike.message.trim();

  if (typeof Errors?.getUserMessage === 'function') {
    return Errors.getUserMessage(errorLike);
  }
  if (hasMessage) return errorLike.message.trim();
  return String(errorLike);
}

function buildErrorDetailsText(errorLike, diagnostics) {
  if (!errorLike && !diagnostics) return '';

  const error = errorLike && typeof errorLike === 'object' ? errorLike : null;
  const diag = diagnostics || (errorLike && typeof errorLike === 'object' ? errorLike.diagnostics : null);
  const lines = [];

  if (error?.code) lines.push(`code: ${error.code}`);
  if (typeof error?.httpStatus === 'number' && error.httpStatus) lines.push(`httpStatus: ${error.httpStatus}`);
  if (error?.endpointHost) lines.push(`endpointHost: ${error.endpointHost}`);
  if (error?.provider) lines.push(`provider: ${error.provider}`);
  if (error?.endpointMode) lines.push(`endpointMode: ${error.endpointMode}`);
  if (error?.stage) lines.push(`stage: ${error.stage}`);
  if (error?.detail) lines.push(`detail: ${String(error.detail).trim()}`);

  if (diag?.baseUrl) lines.push(`requestUrl: ${diag.baseUrl}`);
  if (diag?.adapterId) lines.push(`adapterId: ${diag.adapterId}`);
  if (diag?.model) lines.push(`model: ${diag.model}`);
  if (diag?.requestedEndpointMode) lines.push(`requestedEndpointMode: ${diag.requestedEndpointMode}`);
  if (diag?.autoEndpointSelected) lines.push(`autoEndpointSelected: ${diag.autoEndpointSelected}`);
  if (Array.isArray(diag?.autoEndpointTried) && diag.autoEndpointTried.length) {
    lines.push(`autoEndpointTried: ${diag.autoEndpointTried.join(' -> ')}`);
  }
  if (diag?.autoBaseUrlAdjusted) {
    lines.push(`autoBaseUrlAdjusted: true (appliedV1: ${diag.autoBaseUrlAppliedV1 ? 'yes' : 'no'})`);
  }

  return lines.join('\n').trim();
}

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(keys, (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(items || {});
    });
  });
}

function storageSet(payload) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(payload, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function storageLocalGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(items || {});
    });
  });
}

function storageLocalSet(payload) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(payload, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function runtimeSendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: { message: chrome.runtime.lastError.message } });
        return;
      }
      resolve(response || {});
    });
  });
}

function setStatus(text, tone) {
  const node = $('status');
  if (!node) return;
  node.textContent = text;
  node.className = 'status' + (tone ? ' ' + tone : '');
}

function setStatusDetails(text) {
  const detailsNode = $('statusDetails');
  const textNode = $('statusDetailsText');
  if (!detailsNode || !textNode) return;

  const value = String(text || '').trim();
  if (!value) {
    detailsNode.hidden = true;
    detailsNode.open = false;
    textNode.textContent = '';
    return;
  }

  textNode.textContent = value;
  detailsNode.hidden = false;
}

const formatDateTime = (value) => UiFormat.formatDateTime(value, { emptyText: '未记录', includeYear: false });

function setBadge(id, text, tone) {
  const node = $(id);
  if (!node) return;
  node.textContent = text;
  node.className = 'status-badge' + (tone ? ' ' + tone : '');
}

function getSaveSuccessText(settings) {
  return settings.privacyMode ? '已自动保存，当前处于无痕模式。' : '已自动保存。';
}

function renderThemeHint(preference, theme) {
  const normalizedPreference = Theme.normalizePreference(preference);
  const effectiveTheme = Theme.resolveTheme(normalizedPreference || theme);
  const preferenceLabel = THEME_PREFERENCE_LABELS[normalizedPreference] || THEME_PREFERENCE_LABELS.system;
  const effectiveLabel = THEME_EFFECTIVE_LABELS[effectiveTheme] || THEME_EFFECTIVE_LABELS.light;

  $('themeHint').textContent = normalizedPreference === 'system'
    ? `${preferenceLabel}。当前生效：${effectiveLabel}；系统主题变化时会自动切换。`
    : `${preferenceLabel}。当前 popup 和侧栏会保持 ${effectiveLabel} 模式。`;
}

function syncThemePreferenceControl(preference, options = {}) {
  const result = Theme.applyPreference(preference, { force: options.force !== false });
  const field = $('themePreference');
  if (field) {
    field.value = result.preference;
  }
  renderThemeHint(result.preference, result.theme);
  return result;
}

function renderPaletteHint(palette) {
  const normalizedPalette = Theme.normalizePalette(palette);
  const label = THEME_PALETTE_LABELS[normalizedPalette] || THEME_PALETTE_LABELS.jade;
  const hint = THEME_PALETTE_HINTS[normalizedPalette] || THEME_PALETTE_HINTS.jade;
  const hintNode = $('paletteHint');
  if (!hintNode) return;

  hintNode.textContent = `${label}：${hint}。会同步到 popup、侧栏和阅读页。`;
}

function setPaletteControlState(palette) {
  const normalizedPalette = Theme.normalizePalette(palette);
  const field = $('themePalette');
  if (field) {
    field.value = normalizedPalette;
  }

  document.querySelectorAll('[data-palette-option]').forEach((button) => {
    const isSelected = button.dataset.paletteOption === normalizedPalette;
    button.classList.toggle('active', isSelected);
    button.setAttribute('aria-checked', isSelected ? 'true' : 'false');
  });

  renderPaletteHint(normalizedPalette);
}

function syncThemePaletteControl(palette, options = {}) {
  const result = Theme.applyPalette(palette, { force: options.force !== false });
  setPaletteControlState(result.palette);
  return result;
}

function renderEntrypointStatus(entrypoints) {
  const contextMenu = entrypoints?.contextMenu || {};
  const shortcut = entrypoints?.shortcut || {};

  const contextMenuReady = contextMenu.status === 'ready';
  $('contextMenuDesc').textContent = contextMenuReady
    ? '右键菜单已注册，可以在网页空白区域直接启动摘要。'
    : (contextMenu.lastError || '右键菜单还没准备好，建议点击“检查入口”尝试修复。');
  setBadge(
    'contextMenuBadge',
    contextMenuReady ? '已就绪' : '待修复',
    contextMenuReady ? 'success' : 'warning'
  );

  const shortcutAssigned = shortcut.status === 'assigned' && shortcut.shortcut;
  $('shortcutDesc').textContent = shortcutAssigned
    ? `当前绑定：${shortcut.shortcut}`
    : '没有检测到生效中的快捷键，请前往快捷键设置页确认 Alt + S。';
  setBadge(
    'shortcutBadge',
    shortcutAssigned ? '已绑定' : shortcut.status === 'missing' ? '缺失' : '未绑定',
    shortcutAssigned ? 'success' : shortcut.status === 'missing' ? 'error' : 'warning'
  );

  $('entrypointMeta').textContent = [
    `菜单最近校验：${formatDateTime(contextMenu.lastEnsuredAt)}`,
    `菜单最近触发：${formatDateTime(contextMenu.lastTriggeredAt)}`,
    `快捷键最近触发：${formatDateTime(shortcut.lastTriggeredAt)}`
  ].join(' · ');
}

function buildEndpointPreview(provider, endpointMode) {
  if (provider === 'anthropic') return '/v1/messages';
  if (endpointMode === 'responses') return '/responses';
  if (endpointMode === 'chat_completions') return '/chat/completions';
  if (endpointMode === 'legacy_completions') return '/completions';
  return '按 Base URL 自动判断';
}

function pickEffectiveBaseURLInput(rawInput, fallbackBaseUrl) {
  const normalized = normalizeBaseURLInput(rawInput);
  if (normalized) return normalized;
  return String(fallbackBaseUrl || '').trim();
}

function renderEndpointPreview() {
  const previewNode = $('endpointPreview');
  if (!previewNode) return;

  const { provider, endpointMode, profile } = getCurrentSelection();
  const rawInput = $('baseURL')?.value || '';

  const defaultBaseUrl = provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
  const baseRoot = pickEffectiveBaseURLInput(rawInput, profile?.baseUrl || defaultBaseUrl);
  if (!baseRoot) {
    previewNode.textContent = '';
    return;
  }

  const openaiDetected = UrlUtils?.detectOpenAiEndpointModeFromUrl?.(baseRoot) || '';
  const anthropicDetected = UrlUtils?.detectAnthropicEndpointModeFromUrl?.(baseRoot) || '';
  const isFullEndpoint = !!(openaiDetected || anthropicDetected);

  if (isFullEndpoint) {
    const detectedLabel = openaiDetected
      ? (ProviderPresets?.ENDPOINT_MODE_META?.[openaiDetected]?.label || openaiDetected)
      : (ProviderPresets?.ENDPOINT_MODE_META?.[anthropicDetected]?.label || anthropicDetected);
    previewNode.textContent = `将请求：${baseRoot}。已识别为完整 endpoint（${detectedLabel}），将以 URL 为准，忽略 endpointMode 拼接。`;
    return;
  }

  if (provider === 'anthropic') {
    const root = UrlUtils?.stripAnthropicMessagesSuffix?.(baseRoot) || baseRoot;
    previewNode.textContent = `将请求：${root}/v1/messages。`;
    return;
  }

  const root = UrlUtils?.stripOpenAiEndpointSuffix?.(baseRoot) || baseRoot;
  const hasV1 = /\/v1$/i.test(root);

  if (endpointMode === 'auto') {
    previewNode.textContent = `将依次尝试：${root}/responses -> ${root}/chat/completions -> ${root}/completions。${hasV1 ? '当前 Base URL 包含 /v1。' : '当前 Base URL 不包含 /v1（如接口要求 /v1，可通过连接测试自动修正）。'}`;
    return;
  }

  const path = buildEndpointPreview(provider, endpointMode);
  if (path && path.startsWith('/')) {
    previewNode.textContent = `将请求：${root}${path}。${hasV1 ? '当前 Base URL 包含 /v1。' : '当前 Base URL 不包含 /v1（如接口要求 /v1，可通过连接测试自动修正）。'}`;
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
    option.textContent = preset.label;
    select.appendChild(option);
  });
}

function syncProviderOptions(presetId) {
  const allowed = new Set(ProviderPresets.getProviderOptions(presetId));
  const providerSelect = $('aiProvider');

  Array.from(providerSelect.options).forEach((option) => {
    const supported = allowed.has(option.value);
    option.disabled = !supported;
    option.textContent = UiLabels.getProviderLabel(option.value, { variant: 'settings', fallback: option.value });
  });

  providerSelect.value = ProviderPresets.normalizeProvider(providerSelect.value, presetId);
  return providerSelect.value;
}

function syncEndpointModeOptions(presetId, provider, preferredMode) {
  const select = $('endpointMode');
  const modes = ProviderPresets.getEndpointModes(presetId, provider);
  const nextMode = ProviderPresets.normalizeEndpointMode(preferredMode, provider, presetId);
  select.innerHTML = '';

  modes.forEach((mode) => {
    const meta = ProviderPresets.ENDPOINT_MODE_META[mode] || { label: mode };
    const option = document.createElement('option');
    option.value = mode;
    option.textContent = meta.label;
    select.appendChild(option);
  });

  select.value = nextMode;
  return nextMode;
}

function getCurrentSelection() {
  const presetId = $('providerPreset').value || 'custom';
  const provider = ProviderPresets.normalizeProvider($('aiProvider').value, presetId);
  const endpointMode = ProviderPresets.normalizeEndpointMode($('endpointMode').value, provider, presetId);
  const preset = ProviderPresets.getPreset(presetId);
  const profile = ProviderPresets.getProviderProfile(presetId, provider);
  return { presetId, provider, endpointMode, preset, profile };
}

function maybeApplySuggestedValue(fieldId, suggestedValue, options = {}) {
  if (!suggestedValue) return;
  const field = $(fieldId);
  const currentValue = String(field.value || '').trim();
  const autoKey = fieldId === 'baseURL' ? 'baseURL' : 'modelName';
  const previousAutoValue = autoFillState[autoKey] || '';
  const shouldApply = options.force || !currentValue || currentValue === previousAutoValue;

  if (shouldApply) {
    field.value = suggestedValue;
  }
}

function updateHints() {
  const { provider, endpointMode, preset, profile } = getCurrentSelection();
  const endpointMeta = ProviderPresets.ENDPOINT_MODE_META[endpointMode] || { description: '' };
  const endpointPreview = buildEndpointPreview(provider, endpointMode);

  $('presetHint').textContent = [preset.hint || '', profile?.hint || ''].filter(Boolean).join(' ');
  $('endpointModeHint').textContent = [
    endpointMeta.description || '',
    endpointPreview ? `当前会按这个模式补最终路径：${endpointPreview}。` : ''
  ].filter(Boolean).join(' ');

  if (profile?.baseUrl) {
    $('baseURLHint').textContent = `推荐根地址：${profile.baseUrl}。也可以直接填写完整 endpoint。`;
  } else {
    $('baseURLHint').textContent = PROVIDER_FALLBACK_HINTS[provider] || '';
  }

  $('modelHint').textContent = profile?.defaultModel
    ? `推荐模型：${profile.defaultModel}。如果你有专属模型 ID，也可以直接覆盖。`
    : '请填写目标厂商实际可用的模型名称。';

  $('baseURL').placeholder = profile?.baseUrl || '留空使用默认地址';
  $('modelName').placeholder = profile?.defaultModel || (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o-mini');
  renderEndpointPreview();
}

function syncSelectionState(options = {}) {
  const presetId = $('providerPreset').value || 'custom';
  const provider = syncProviderOptions(presetId);
  const endpointMode = syncEndpointModeOptions(
    presetId,
    provider,
    options.preferredEndpointMode || $('endpointMode').value
  );
  const profile = ProviderPresets.getProviderProfile(presetId, provider);

  $('aiProvider').value = provider;
  $('endpointMode').value = endpointMode;

  if (options.syncSuggestedValues) {
    const shouldForce = !!options.forceSuggestedValues && presetId !== 'custom';
    maybeApplySuggestedValue('baseURL', profile?.baseUrl || '', { force: shouldForce });
    maybeApplySuggestedValue('modelName', profile?.defaultModel || '', { force: shouldForce });
  }

  autoFillState.baseURL = profile?.baseUrl || '';
  autoFillState.modelName = profile?.defaultModel || '';
  updateHints();
}

function validateBaseURL(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeBaseURLInput(value) {
  if (UrlUtils?.normalizeBaseURLInput) return UrlUtils.normalizeBaseURLInput(value);

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
    return String(normalized).replace(/\/+$/, '');
  }
}

function collectSettings() {
  const presetId = $('providerPreset').value || 'custom';
  const provider = ProviderPresets.normalizeProvider($('aiProvider').value, presetId);
  const endpointMode = ProviderPresets.normalizeEndpointMode($('endpointMode').value, provider, presetId);

  return {
    providerPreset: presetId,
    aiProvider: provider,
    endpointMode,
    apiKey: $('apiKey').value.trim(),
    aiBaseURL: normalizeBaseURLInput($('baseURL').value.trim()),
    modelName: $('modelName').value.trim(),
    systemPrompt: $('systemPrompt').value.trim(),
    autoTranslate: $('autoTranslate').checked,
    defaultLanguage: $('defaultLanguage').value,
    themePreference: Theme.normalizePreference($('themePreference').value),
    themePalette: Theme.normalizePalette($('themePalette')?.value),
    privacyMode: $('privacyMode').checked,
    defaultAllowHistory: $('defaultAllowHistory').checked,
    defaultAllowShare: $('defaultAllowShare').checked,
    entrypointAutoStart: $('entrypointAutoStart').checked,
    entrypointSimpleMode: $('entrypointSimpleMode').checked,
    entrypointReuseHistory: $('entrypointReuseHistory').checked
  };
}

function createSettingsSignature(settings) {
  return JSON.stringify(settings);
}

function createProfileId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return 'prof_' + crypto.randomUUID();
    }
  } catch {}

  return 'prof_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function getProfileStorageKey(id) {
  const safeId = String(id || '').trim();
  return safeId ? PROFILE_KEY_PREFIX + safeId : '';
}

function normalizeProfilesIndex(value) {
  if (!Array.isArray(value)) return [];

  const output = [];
  const seen = new Set();
  value.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const id = String(item.id || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);

    const name = String(item.name || '').trim() || '未命名';
    output.push({
      id,
      name,
      updatedAt: String(item.updatedAt || ''),
      lastUsedAt: String(item.lastUsedAt || ''),
      providerPreset: String(item.providerPreset || ''),
      aiProvider: String(item.aiProvider || '')
    });
  });

  return output;
}

function upsertProfilesIndexEntry(index, entry, options = {}) {
  const next = [];
  const id = String(entry?.id || '').trim();
  if (!id) return normalizeProfilesIndex(index);

  const allowReorder = options.prepend === true;
  let replaced = false;

  (index || []).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const itemId = String(item.id || '').trim();
    if (!itemId) return;
    if (itemId === id) {
      next.push(Object.assign({}, item, entry));
      replaced = true;
    } else {
      next.push(item);
    }
  });

  if (!replaced) {
    if (allowReorder) next.unshift(entry);
    else next.push(entry);
  }

  return normalizeProfilesIndex(next);
}

function removeProfilesIndexEntry(index, id) {
  const targetId = String(id || '').trim();
  if (!targetId) return normalizeProfilesIndex(index);
  return normalizeProfilesIndex((index || []).filter((item) => String(item?.id || '').trim() !== targetId));
}

function findProfileIndexEntry(id) {
  const safeId = String(id || '').trim();
  if (!safeId) return null;
  return (profileState.index || []).find((entry) => entry && entry.id === safeId) || null;
}

function renderProfileSelector() {
  const select = $('profileSelect');
  if (!select) return;

  const activeId = profileState.activeId || '';
  select.innerHTML = '';

  const unboundOption = document.createElement('option');
  unboundOption.value = '';
  unboundOption.textContent = '当前配置（未绑定）';
  select.appendChild(unboundOption);

  (profileState.index || []).forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.id;

    const presetLabel = ProviderPresets?.getPreset?.(entry.providerPreset)?.label || entry.providerPreset || 'custom';
    option.textContent = entry.name + ' · ' + presetLabel;

    select.appendChild(option);
  });

  select.value = activeId;
  renderProfileHint();
}

function renderProfileHint() {
  const hint = $('profileHint');
  if (!hint) return;

  const activeId = profileState.activeId || '';
  const activeEntry = findProfileIndexEntry(activeId);

  hint.textContent = activeId && activeEntry
    ? `已绑定：${activeEntry.name}。后续修改会自动更新该配置。`
    : '未绑定：可以选择配置方案，或点击“另存为”创建一个可快速切换的配置。';

  const renameBtn = $('profileRenameBtn');
  const deleteBtn = $('profileDeleteBtn');
  if (renameBtn) renameBtn.disabled = !activeId;
  if (deleteBtn) deleteBtn.disabled = !activeId;
}

async function updateProfilesStorage(index, activeId) {
  const payload = {
    [PROFILES_INDEX_KEY]: normalizeProfilesIndex(index)
  };
  if (typeof activeId !== 'undefined') {
    payload[ACTIVE_PROFILE_ID_KEY] = String(activeId || '').trim();
  }
  await storageSet(payload);
}

async function activateProfile(profileId) {
  const id = String(profileId || '').trim();
  const select = $('profileSelect');

  if (!id) {
    profileState.activeId = '';
    await updateProfilesStorage(profileState.index, '');
    renderProfileSelector();
    setStatus('已切换到当前配置（未绑定）。', 'success');
    setStatusDetails('');
    return;
  }

  const key = getProfileStorageKey(id);
  if (!key) return;

  const items = await storageGet([key]);
  const profileSettings = items?.[key] && typeof items[key] === 'object' ? items[key] : null;
  if (!profileSettings) {
    if (select) select.value = profileState.activeId || '';
    setStatus('未找到该配置方案的数据，可能已被删除。', 'error');
    return;
  }

  applySettingsToForm(profileSettings);
  await persistSettings({ force: true, silentStatus: true, skipSuccessStatus: true });

  profileState.activeId = id;
  const now = new Date().toISOString();
  profileState.index = upsertProfilesIndexEntry(profileState.index, Object.assign({}, findProfileIndexEntry(id) || { id, name: '未命名' }, {
    id,
    lastUsedAt: now,
    providerPreset: profileSettings.providerPreset || '',
    aiProvider: profileSettings.aiProvider || ''
  }));

  await updateProfilesStorage(profileState.index, id);
  renderProfileSelector();
  setStatus('已切换配置方案。', 'success');
  setStatusDetails('');
}

async function createOrCloneProfile(name, settings, options = {}) {
  const safeName = String(name || '').trim();
  if (!safeName) return null;

  const payloadSettings = Object.assign({}, settings || {});
  const id = createProfileId();
  const now = new Date().toISOString();
  const key = getProfileStorageKey(id);
  if (!key) return null;

  const entry = {
    id,
    name: safeName,
    updatedAt: now,
    lastUsedAt: now,
    providerPreset: payloadSettings.providerPreset || '',
    aiProvider: payloadSettings.aiProvider || ''
  };

  const nextIndex = upsertProfilesIndexEntry(profileState.index, entry, { prepend: true });
  const nextActiveId = options.activate === false ? (profileState.activeId || '') : id;

  await storageSet(Object.assign({
    [key]: payloadSettings,
    [PROFILES_INDEX_KEY]: nextIndex,
    [ACTIVE_PROFILE_ID_KEY]: nextActiveId
  }, options.writeSettings !== false ? payloadSettings : {}));

  profileState.index = nextIndex;
  profileState.activeId = nextActiveId;
  renderProfileSelector();
  return id;
}

function getModelsCacheKeyFromSettings(settings) {
  const provider = String(settings?.aiProvider || '').trim().toLowerCase();
  if (!provider) return '';

  const baseUrl = normalizeBaseURLInput(settings?.aiBaseURL || '');
  if (!baseUrl) return provider;

  if (provider === 'openai') {
    const root = UrlUtils?.stripOpenAiEndpointSuffix?.(baseUrl) || baseUrl;
    return provider + '|' + String(root || '').toLowerCase();
  }

  if (provider === 'anthropic') {
    const root = UrlUtils?.stripAnthropicMessagesSuffix?.(baseUrl) || baseUrl;
    return provider + '|' + String(root || '').toLowerCase();
  }

  return provider + '|' + String(baseUrl || '').toLowerCase();
}

function renderModelOptions(models, meta = {}) {
  const datalist = $('modelNameOptions');
  if (!datalist) return;

  datalist.innerHTML = '';
  const ids = Array.isArray(models) ? models.map((item) => (typeof item === 'string' ? item : item?.id)).filter(Boolean) : [];
  ids.forEach((id) => {
    const option = document.createElement('option');
    option.value = String(id);
    datalist.appendChild(option);
  });

  const hint = $('modelListHint');
  if (!hint) return;

  if (!ids.length) {
    hint.textContent = meta.message || '';
    return;
  }

  const fetchedAt = meta.fetchedAt ? formatDateTime(meta.fetchedAt) : '';
  hint.textContent = fetchedAt ? `已加载 ${ids.length} 个模型（${fetchedAt}）。` : `已加载 ${ids.length} 个模型。`;
}

async function loadCachedModelOptions(settings) {
  try {
    const cacheKey = getModelsCacheKeyFromSettings(settings);
    if (!cacheKey) return;

    const items = await storageLocalGet([MODELS_CACHE_STORAGE_KEY]);
    const cache = items?.[MODELS_CACHE_STORAGE_KEY];
    const entry = cache && typeof cache === 'object' ? cache?.[cacheKey] : null;
    const models = Array.isArray(entry?.models) ? entry.models : [];
    if (!models.length) return;

    renderModelOptions(models, { fetchedAt: entry?.fetchedAt || '' });
  } catch {
    // Ignore local cache failures.
  }
}

async function refreshModelOptions(options = {}) {
  const button = $('refreshModelsBtn');
  if (button) {
    button.disabled = true;
    button.textContent = '刷新中...';
  }

  try {
    await persistSettings({ skipSuccessStatus: true, silentStatus: true });
    const settings = collectSettings();

    if (!settings.apiKey) {
      renderModelOptions([], { message: '请先填写 API Key 后再刷新模型列表。' });
      return;
    }

    const response = await runtimeSendMessage({ action: 'listModels', settings });
    if (!response.success) {
      renderModelOptions([], { message: '模型列表获取失败：' + getRuntimeErrorMessage(response.error) });
      return;
    }

    renderModelOptions(response.models || [], { fetchedAt: response.fetchedAt || '' });
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '刷新';
    }
  }
}

function clearAutoSaveTimer() {
  if (!saveState.timer) return;
  window.clearTimeout(saveState.timer);
  saveState.timer = null;
}

async function persistSettings(options = {}) {
  clearAutoSaveTimer();

  const settings = collectSettings();
  const signature = createSettingsSignature(settings);
  if (!options.force && signature === saveState.lastSavedSignature) {
    return false;
  }

  const requestId = ++saveState.requestId;
  syncThemePreferenceControl(settings.themePreference);
  syncThemePaletteControl(settings.themePalette);

  if (!options.silentStatus) {
    setStatus(options.statusText || '正在自动保存...');
  }

  try {
    const activeProfileId = String(profileState.activeId || '').trim();
    const payload = Object.assign({}, settings);

    if (activeProfileId) {
      const profileKey = getProfileStorageKey(activeProfileId);
      if (profileKey) {
        payload[profileKey] = Object.assign({}, settings);
      }

      const now = new Date().toISOString();
      const existingEntry = findProfileIndexEntry(activeProfileId) || { id: activeProfileId, name: '未命名' };
      profileState.index = upsertProfilesIndexEntry(profileState.index, Object.assign({}, existingEntry, {
        updatedAt: now,
        providerPreset: settings.providerPreset || '',
        aiProvider: settings.aiProvider || ''
      }));

      payload[PROFILES_INDEX_KEY] = profileState.index;
      payload[ACTIVE_PROFILE_ID_KEY] = activeProfileId;
    }

    await storageSet(payload);
    saveState.lastSavedSignature = signature;
    renderProfileHint();
    if (requestId === saveState.requestId && !options.skipSuccessStatus) {
      if (settings.aiBaseURL && !validateBaseURL(settings.aiBaseURL)) {
        setStatus('已保存，但 Base URL 格式可能不正确。', 'warning');
      } else {
        setStatus(getSaveSuccessText(settings), 'success');
      }
      setStatusDetails('');
    }
    return true;
  } catch (error) {
    if (requestId === saveState.requestId) {
      setStatus(`保存失败：${String(error?.message || error || '未知错误')}`, 'error');
      setStatusDetails('');
    }
    return false;
  }
}

function scheduleAutoSave() {
  clearAutoSaveTimer();
  setStatus(WAITING_AUTOSAVE_TEXT);
  saveState.timer = window.setTimeout(() => {
    persistSettings();
  }, Constants.AUTOSAVE_DEBOUNCE_MS);
}

function flushPendingChanges() {
  persistSettings({
    skipSuccessStatus: true,
    silentStatus: true
  });
}

function getStoredActiveTab() {
  try {
    return window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) || '';
  } catch (error) {
    return '';
  }
}

function storeActiveTab(tabId) {
  try {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tabId);
  } catch (error) {
    // Ignore storage failures in popup UI state.
  }
}

function activateTab(tabId) {
  const buttons = Array.from(document.querySelectorAll('[data-tab]'));
  const panels = Array.from(document.querySelectorAll('[data-tab-panel]'));
  const targetId = panels.some((panel) => panel.dataset.tabPanel === tabId) ? tabId : 'connection';

  buttons.forEach((button) => {
    const active = button.dataset.tab === targetId;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  });

  panels.forEach((panel) => {
    const active = panel.dataset.tabPanel === targetId;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });

  storeActiveTab(targetId);
}

function setupTabs() {
  activateTab(getStoredActiveTab() || 'connection');
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  });
}

function bindAutoSaveControls() {
  document.querySelectorAll('[data-autosave="immediate"]').forEach((field) => {
    field.addEventListener('change', () => {
      persistSettings();
    });
  });

  document.querySelectorAll('[data-autosave="debounced"]').forEach((field) => {
    field.addEventListener('input', scheduleAutoSave);
    field.addEventListener('change', () => {
      persistSettings();
    });
    field.addEventListener('blur', () => {
      persistSettings();
    });
  });

  const baseUrlField = $('baseURL');
  if (baseUrlField) {
    baseUrlField.addEventListener('input', () => {
      renderEndpointPreview();
    });
    baseUrlField.addEventListener('blur', () => {
      const normalized = normalizeBaseURLInput(baseUrlField.value);
      if (normalized !== baseUrlField.value) {
        baseUrlField.value = normalized;
        persistSettings();
      }
      loadCachedModelOptions(collectSettings());
    });
  }
}

function applySettingsToForm(settings) {
  const safeSettings = settings || {};
  const trustSettings = Trust.normalizeSettings(safeSettings);
  const presetId = inferPresetId(safeSettings);
  const provider = ProviderPresets.normalizeProvider(safeSettings.aiProvider || '', presetId);
  const endpointMode = inferEndpointMode(safeSettings, presetId, provider);
  const themePreference = Theme.normalizePreference(safeSettings.themePreference);
  const themePalette = Theme.normalizePalette(safeSettings.themePalette);

  $('providerPreset').value = presetId;
  $('aiProvider').value = provider;
  $('apiKey').value = safeSettings.apiKey || '';
  $('baseURL').value = safeSettings.aiBaseURL || '';
  $('modelName').value = safeSettings.modelName || '';
  $('systemPrompt').value = safeSettings.systemPrompt || '';
  $('autoTranslate').checked = !!safeSettings.autoTranslate;
  $('defaultLanguage').value = safeSettings.defaultLanguage || 'zh';
  $('themePreference').value = themePreference;
  $('themePalette').value = themePalette;
  $('privacyMode').checked = trustSettings.privacyMode;
  $('defaultAllowHistory').checked = trustSettings.defaultAllowHistory;
  $('defaultAllowShare').checked = trustSettings.defaultAllowShare;
  $('entrypointAutoStart').checked = safeSettings.entrypointAutoStart !== false;
  $('entrypointSimpleMode').checked = !!safeSettings.entrypointSimpleMode;
  $('entrypointReuseHistory').checked = safeSettings.entrypointReuseHistory !== false;

  syncSelectionState({ preferredEndpointMode: endpointMode });
  syncThemePreferenceControl(themePreference);
  syncThemePaletteControl(themePalette);

  saveState.lastSavedSignature = createSettingsSignature(collectSettings());
  renderEndpointPreview();
}

async function loadSettings() {
  const keys = SETTINGS_KEYS.concat([PROFILES_INDEX_KEY, ACTIVE_PROFILE_ID_KEY]);
  const items = await storageGet(keys);

  profileState.index = normalizeProfilesIndex(items?.[PROFILES_INDEX_KEY]);
  profileState.activeId = String(items?.[ACTIVE_PROFILE_ID_KEY] || '').trim();

  if (profileState.activeId && !findProfileIndexEntry(profileState.activeId)) {
    profileState.activeId = '';
    await updateProfilesStorage(profileState.index, '');
  }

  renderProfileSelector();
  applySettingsToForm(items);
  setStatus(IDLE_STATUS_TEXT);
  setStatusDetails('');

  await loadCachedModelOptions(collectSettings());
}

function handleSave(event) {
  event.preventDefault();
  persistSettings({
    force: true,
    statusText: '正在保存设置...'
  });
}

async function handleTestConnection() {
  await persistSettings({
    skipSuccessStatus: true,
    silentStatus: true
  });

  const settings = collectSettings();
  if (!settings.apiKey) {
    setStatus('请先填写 API Key。', 'error');
    return;
  }

  if (settings.aiBaseURL && !validateBaseURL(settings.aiBaseURL)) {
    setStatus('Base URL 格式不正确，请输入完整的 HTTP/HTTPS 地址。', 'error');
    return;
  }

  const button = $('testBtn');
  button.disabled = true;
  button.textContent = '测试中...';
  setStatus('正在测试连接...');

  const response = await runtimeSendMessage({ action: 'testConnection', settings });
  button.disabled = false;
  button.textContent = '测试连接';

  if (response.success) {
    const diag = response.diagnostics || {};
    const model = diag?.model || settings.modelName || '默认模型';
    const extras = [];

    if (diag?.requestedEndpointMode === 'auto' && diag?.autoEndpointSelected) {
      extras.push(`endpoint=${diag.autoEndpointSelected}`);
    }
    if (diag?.autoBaseUrlSaved && typeof diag?.autoBaseUrlAppliedV1 === 'boolean') {
      extras.push(diag.autoBaseUrlAppliedV1 ? '已自动补齐 /v1' : '已自动去除 /v1');
    }

    setStatus(`连接成功，当前模型：${model}${extras.length ? `（${extras.join('，')}）` : ''}`, 'success');
    setStatusDetails('');

    // Best-effort: refresh model list after a successful connection test.
    refreshModelOptions({ reason: 'after_test' }).catch(() => {});
    return;
  }

  setStatus(getRuntimeErrorMessage(response.error), 'error');
  setStatusDetails(buildErrorDetailsText(response.error, response.diagnostics));
}

async function openHistory() {
  setStatus('正在打开当前页面的历史记录...');
  const response = await runtimeSendMessage({ action: 'triggerHistory' });
  if (response.success) {
    setStatus('已在当前页面打开历史记录。', 'success');
    return;
  }
  setStatus(getRuntimeErrorMessage(response.error) || '打开历史记录失败。', 'error');
  setStatusDetails('');
}

async function loadEntrypointStatus(options = {}) {
  const silent = !!options.silent;
  if (!silent) {
    setStatus('正在检查右键菜单和快捷键状态...');
  }

  const response = await runtimeSendMessage({ action: 'getEntrypointStatus' });
  if (!response.success) {
    if (!silent) {
      setStatus(getRuntimeErrorMessage(response.error) || '入口状态检查失败。', 'error');
      setStatusDetails('');
    }
    $('contextMenuDesc').textContent = '右键菜单状态获取失败。';
    $('shortcutDesc').textContent = '快捷键状态获取失败。';
    $('entrypointMeta').textContent = '请刷新扩展后重试。';
    setBadge('contextMenuBadge', '失败', 'error');
    setBadge('shortcutBadge', '失败', 'error');
    return;
  }

  renderEntrypointStatus(response.entrypoints);
  if (!silent) {
    setStatus('入口状态已刷新。', 'success');
  }
}

async function openShortcutSettings() {
  setStatus('正在打开浏览器快捷键设置页...');
  const response = await runtimeSendMessage({ action: 'openShortcutSettings' });
  if (response.success) {
    setStatus('已打开快捷键设置页。', 'success');
    return;
  }
  setStatus(getRuntimeErrorMessage(response.error) || '打开快捷键设置页失败。', 'error');
  setStatusDetails('');
}

function bindSelectionListeners() {
  $('providerPreset').addEventListener('change', () => {
    const presetId = $('providerPreset').value || 'custom';
    const provider = ProviderPresets.normalizeProvider($('aiProvider').value, presetId);
    const endpointMode = ProviderPresets.normalizeEndpointMode('', provider, presetId);
    $('aiProvider').value = provider;
    syncSelectionState({
      preferredEndpointMode: endpointMode,
      syncSuggestedValues: true,
      forceSuggestedValues: true
    });
    persistSettings();
    loadCachedModelOptions(collectSettings());
  });

  $('aiProvider').addEventListener('change', () => {
    syncSelectionState({
      preferredEndpointMode: $('endpointMode').value,
      syncSuggestedValues: true
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

function bindProfileControls() {
  const select = $('profileSelect');
  const actionsBtn = $('profileActionsBtn');
  const actionsMenu = $('profileActionsMenu');
  let actionsMenuOpen = false;

  function setActionsMenuOpen(nextOpen) {
    if (!actionsBtn || !actionsMenu) return;
    actionsMenuOpen = !!nextOpen;
    actionsMenu.hidden = !actionsMenuOpen;
    actionsBtn.setAttribute('aria-expanded', actionsMenuOpen ? 'true' : 'false');
  }

  if (actionsBtn && actionsMenu) {
    setActionsMenuOpen(false);

    actionsBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      setActionsMenuOpen(!actionsMenuOpen);
    });

    actionsMenu.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('button')) return;
      setActionsMenuOpen(false);
    });

    document.addEventListener('click', (event) => {
      if (!actionsMenuOpen) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (actionsBtn.contains(target) || actionsMenu.contains(target)) return;
      setActionsMenuOpen(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!actionsMenuOpen) return;
      setActionsMenuOpen(false);
      actionsBtn.focus();
    });
  }

  if (select) {
    select.addEventListener('change', () => {
      setActionsMenuOpen(false);
      activateProfile(select.value).catch((error) => {
        setStatus(`切换配置失败：${String(error?.message || error || '未知错误')}`, 'error');
        setStatusDetails('');
      });
    });
  }

  const newBtn = $('profileNewBtn');
  if (newBtn) {
    newBtn.addEventListener('click', () => {
      setActionsMenuOpen(false);
      const name = String(window.prompt('新建配置方案名称', '') || '').trim();
      if (!name) return;
      createOrCloneProfile(name, collectSettings(), { activate: true, writeSettings: true })
        .then(() => {
          setStatus(`已创建并切换到配置方案：${name}`, 'success');
          setStatusDetails('');
        })
        .catch((error) => {
          setStatus(`新建配置失败：${String(error?.message || error || '未知错误')}`, 'error');
          setStatusDetails('');
        });
    });
  }

  const saveAsBtn = $('profileSaveAsBtn');
  if (saveAsBtn) {
    saveAsBtn.addEventListener('click', () => {
      setActionsMenuOpen(false);
      const baseName = findProfileIndexEntry(profileState.activeId)?.name || '配置方案';
      const name = String(window.prompt('另存为配置方案名称', baseName + ' 副本') || '').trim();
      if (!name) return;
      createOrCloneProfile(name, collectSettings(), { activate: true, writeSettings: true })
        .then(() => {
          setStatus(`已另存为并切换到配置方案：${name}`, 'success');
          setStatusDetails('');
        })
        .catch((error) => {
          setStatus(`另存为失败：${String(error?.message || error || '未知错误')}`, 'error');
          setStatusDetails('');
        });
    });
  }

  const renameBtn = $('profileRenameBtn');
  if (renameBtn) {
    renameBtn.addEventListener('click', () => {
      setActionsMenuOpen(false);
      const activeId = profileState.activeId || '';
      const entry = findProfileIndexEntry(activeId);
      if (!activeId || !entry) return;

      const nextName = String(window.prompt('重命名配置方案', entry.name) || '').trim();
      if (!nextName || nextName === entry.name) return;

      const nextIndex = upsertProfilesIndexEntry(profileState.index, Object.assign({}, entry, { name: nextName }));
      updateProfilesStorage(nextIndex, activeId)
        .then(() => {
          profileState.index = nextIndex;
          renderProfileSelector();
          setStatus('已重命名配置方案。', 'success');
          setStatusDetails('');
        })
        .catch((error) => {
          setStatus(`重命名失败：${String(error?.message || error || '未知错误')}`, 'error');
          setStatusDetails('');
        });
    });
  }

  const deleteBtn = $('profileDeleteBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      setActionsMenuOpen(false);
      const activeId = profileState.activeId || '';
      const entry = findProfileIndexEntry(activeId);
      if (!activeId || !entry) return;
      if (!window.confirm(`确定删除配置方案「${entry.name}」吗？`)) return;

      const key = getProfileStorageKey(activeId);
      const nextIndex = removeProfilesIndexEntry(profileState.index, activeId);

      Promise.resolve()
        .then(() => (key ? storageRemove([key]) : null))
        .then(() => updateProfilesStorage(nextIndex, ''))
        .then(() => {
          profileState.index = nextIndex;
          profileState.activeId = '';
          renderProfileSelector();
          setStatus('已删除配置方案，当前配置已解除绑定。', 'success');
          setStatusDetails('');
        })
        .catch((error) => {
          setStatus(`删除失败：${String(error?.message || error || '未知错误')}`, 'error');
          setStatusDetails('');
        });
    });
  }
}

function bindModelControls() {
  const refreshBtn = $('refreshModelsBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      refreshModelOptions().catch((error) => {
        renderModelOptions([], { message: '模型列表获取失败：' + String(error?.message || error || '未知错误') });
      });
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  renderPresetOptions();
  setupTabs();
  bindAutoSaveControls();
  bindSelectionListeners();
  bindProfileControls();
  bindModelControls();

  // Keep the form in sync when background logic auto-fixes settings (e.g. toggling `/v1` on testConnection).
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged && typeof chrome.storage.onChanged.addListener === 'function') {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;

      const baseUrlChange = changes?.aiBaseURL;
      if (baseUrlChange && typeof baseUrlChange.newValue !== 'undefined') {
        const baseUrlField = $('baseURL');
        if (baseUrlField && document.activeElement !== baseUrlField) {
          baseUrlField.value = String(baseUrlChange.newValue || '');
          saveState.lastSavedSignature = createSettingsSignature(collectSettings());
          renderEndpointPreview();
          loadCachedModelOptions(collectSettings());
        }
      }
    });
  }

  syncThemePreferenceControl(Theme.getCurrentPreference() || Theme.DEFAULT_PREFERENCE, { force: false });
  syncThemePaletteControl(Theme.getCurrentPalette() || Theme.DEFAULT_PALETTE, { force: false });
  Theme.onChange(({ preference, theme, palette }) => {
    $('themePreference').value = preference;
    renderThemeHint(preference, theme);
    setPaletteControlState(palette);
  });

  loadSettings().catch((error) => {
    setStatus(String(error?.message || error || '设置加载失败。'), 'error');
  });
  loadEntrypointStatus({ silent: true }).catch((error) => {
    setStatus(String(error?.message || error || '入口状态检查失败。'), 'error');
  });

  $('settingsForm').addEventListener('submit', handleSave);
  $('testBtn').addEventListener('click', handleTestConnection);
  $('historyBtn').addEventListener('click', openHistory);
  $('refreshEntrypointsBtn').addEventListener('click', () => {
    loadEntrypointStatus().catch((error) => {
      setStatus(String(error?.message || error || '入口状态检查失败。'), 'error');
    });
  });
  $('shortcutSettingsBtn').addEventListener('click', openShortcutSettings);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushPendingChanges();
  }
});

window.addEventListener('pagehide', flushPendingChanges);

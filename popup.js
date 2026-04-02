const Errors = window.AISummaryErrors;
const Trust = window.AISummaryTrust;
const ProviderPresets = window.AISummaryProviderPresets;
const Theme = window.AISummaryTheme;

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
  'privacyMode',
  'defaultAllowHistory',
  'defaultAllowShare',
  'entrypointAutoStart',
  'entrypointSimpleMode'
];

const ACTIVE_TAB_STORAGE_KEY = 'popupActiveTab';
const AUTOSAVE_DEBOUNCE_MS = 500;
const IDLE_STATUS_TEXT = '设置修改后会自动保存。';
const WAITING_AUTOSAVE_TEXT = '检测到变更，输入停顿后会自动保存。';

const PROVIDER_LABELS = {
  openai: 'OpenAI / OpenAI 兼容接口',
  anthropic: 'Anthropic / Claude 兼容接口'
};

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

const autoFillState = {
  baseURL: '',
  modelName: ''
};

const saveState = {
  timer: null,
  lastSavedSignature: '',
  requestId: 0
};

const $ = (id) => document.getElementById(id);

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

function formatDateTime(value) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未记录';
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

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
    : `${preferenceLabel}。当前 popup 和侧栏会保持 ${effectiveLabel} 配色。`;
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
    option.textContent = PROVIDER_LABELS[option.value] || option.value;
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

function collectSettings() {
  const presetId = $('providerPreset').value || 'custom';
  const provider = ProviderPresets.normalizeProvider($('aiProvider').value, presetId);
  const endpointMode = ProviderPresets.normalizeEndpointMode($('endpointMode').value, provider, presetId);

  return {
    providerPreset: presetId,
    aiProvider: provider,
    endpointMode,
    apiKey: $('apiKey').value.trim(),
    aiBaseURL: $('baseURL').value.trim(),
    modelName: $('modelName').value.trim(),
    systemPrompt: $('systemPrompt').value.trim(),
    autoTranslate: $('autoTranslate').checked,
    defaultLanguage: $('defaultLanguage').value,
    themePreference: Theme.normalizePreference($('themePreference').value),
    privacyMode: $('privacyMode').checked,
    defaultAllowHistory: $('defaultAllowHistory').checked,
    defaultAllowShare: $('defaultAllowShare').checked,
    entrypointAutoStart: $('entrypointAutoStart').checked,
    entrypointSimpleMode: $('entrypointSimpleMode').checked
  };
}

function createSettingsSignature(settings) {
  return JSON.stringify(settings);
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

  if (!options.silentStatus) {
    setStatus(options.statusText || '正在自动保存...');
  }

  try {
    await storageSet(settings);
    saveState.lastSavedSignature = signature;
    if (requestId === saveState.requestId && !options.skipSuccessStatus) {
      if (settings.aiBaseURL && !validateBaseURL(settings.aiBaseURL)) {
        setStatus('已保存，但 Base URL 格式可能不正确。', 'warning');
      } else {
        setStatus(getSaveSuccessText(settings), 'success');
      }
    }
    return true;
  } catch (error) {
    if (requestId === saveState.requestId) {
      setStatus(`保存失败：${String(error?.message || error || '未知错误')}`, 'error');
    }
    return false;
  }
}

function scheduleAutoSave() {
  clearAutoSaveTimer();
  setStatus(WAITING_AUTOSAVE_TEXT);
  saveState.timer = window.setTimeout(() => {
    persistSettings();
  }, AUTOSAVE_DEBOUNCE_MS);
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
}

async function loadSettings() {
  const settings = await storageGet(SETTINGS_KEYS);
  const trustSettings = Trust.normalizeSettings(settings);
  const presetId = inferPresetId(settings);
  const provider = ProviderPresets.normalizeProvider(settings.aiProvider || '', presetId);
  const endpointMode = inferEndpointMode(settings, presetId, provider);
  const themePreference = Theme.normalizePreference(settings.themePreference);

  $('providerPreset').value = presetId;
  $('aiProvider').value = provider;
  $('apiKey').value = settings.apiKey || '';
  $('baseURL').value = settings.aiBaseURL || '';
  $('modelName').value = settings.modelName || '';
  $('systemPrompt').value = settings.systemPrompt || '';
  $('autoTranslate').checked = !!settings.autoTranslate;
  $('defaultLanguage').value = settings.defaultLanguage || 'zh';
  $('themePreference').value = themePreference;
  $('privacyMode').checked = trustSettings.privacyMode;
  $('defaultAllowHistory').checked = trustSettings.defaultAllowHistory;
  $('defaultAllowShare').checked = trustSettings.defaultAllowShare;
  $('entrypointAutoStart').checked = settings.entrypointAutoStart !== false;
  $('entrypointSimpleMode').checked = !!settings.entrypointSimpleMode;

  syncSelectionState({ preferredEndpointMode: endpointMode });
  syncThemePreferenceControl(themePreference);

  saveState.lastSavedSignature = createSettingsSignature(collectSettings());
  setStatus(IDLE_STATUS_TEXT);
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
    const model = response.diagnostics?.model || settings.modelName || '默认模型';
    setStatus(`连接成功，当前模型：${model}`, 'success');
    return;
  }

  const error = Errors.normalizeError(response.error, response.error?.code, response.error);
  setStatus(error.message, 'error');
}

async function openHistory() {
  setStatus('正在打开当前页面的历史记录...');
  const response = await runtimeSendMessage({ action: 'triggerHistory' });
  if (response.success) {
    setStatus('已在当前页面打开历史记录。', 'success');
    return;
  }
  setStatus(response.error || '打开历史记录失败。', 'error');
}

async function loadEntrypointStatus(options = {}) {
  const silent = !!options.silent;
  if (!silent) {
    setStatus('正在检查右键菜单和快捷键状态...');
  }

  const response = await runtimeSendMessage({ action: 'getEntrypointStatus' });
  if (!response.success) {
    if (!silent) {
      setStatus(response.error?.message || response.error || '入口状态检查失败。', 'error');
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
  setStatus(response.error || '打开快捷键设置页失败。', 'error');
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
  });

  $('aiProvider').addEventListener('change', () => {
    syncSelectionState({
      preferredEndpointMode: $('endpointMode').value,
      syncSuggestedValues: true
    });
    persistSettings();
  });

  $('endpointMode').addEventListener('change', () => {
    syncSelectionState({ preferredEndpointMode: $('endpointMode').value });
    persistSettings();
  });

  $('themePreference').addEventListener('change', () => {
    syncThemePreferenceControl($('themePreference').value);
    persistSettings();
  });
}

window.addEventListener('DOMContentLoaded', () => {
  renderPresetOptions();
  setupTabs();
  bindAutoSaveControls();
  bindSelectionListeners();

  syncThemePreferenceControl(Theme.getCurrentPreference() || Theme.DEFAULT_PREFERENCE, { force: false });
  Theme.onChange(({ preference, theme }) => {
    $('themePreference').value = preference;
    renderThemeHint(preference, theme);
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

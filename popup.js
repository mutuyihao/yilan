const Errors = window.AISummaryErrors;
const Trust = window.AISummaryTrust;
const ProviderPresets = window.AISummaryProviderPresets;
const Theme = window.AISummaryTheme;
const UiFormat = window.AISummaryUiFormat;
const UiLabels = window.AISummaryUiLabels;
const Constants = window.AISummaryConstants;
const UrlUtils = window.AISummaryUrlUtils;
const ChromeApi = window.YilanChromeApi;
const I18n = window.YilanI18n;
const YilanPopupThemeControls = window.YilanPopupThemeControls;
const YilanPopupProfiles = window.YilanPopupProfiles;
const YilanPopupProviderSelection = window.YilanPopupProviderSelection;
const YilanPopupModels = window.YilanPopupModels;
const YilanPopupEntrypointsView = window.YilanPopupEntrypointsView;

const $ = (id) => document.getElementById(id);

const SETTINGS_KEYS = Constants.SETTINGS_KEYS;

const MODELS_CACHE_STORAGE_KEY = Constants.MODELS_CACHE_STORAGE_KEY;

const ACTIVE_TAB_STORAGE_KEY = 'popupActiveTab';
// Resolved at call time so a runtime uiLanguage switch updates copy without reloading.
const idleStatusText = () => I18n.get('popup_idle_status');
const waitingAutosaveText = () => I18n.get('popup_waiting_autosave');
const baseUrlInvalidMessage = () => I18n.get('popup_base_url_invalid');

function normalizeUiLanguage(value) {
  return value === 'zh' || value === 'en' ? value : 'auto';
}

function normalizeChunkConcurrency(value) {
  const parsed = Math.round(Number(value));
  return parsed >= 1 && parsed <= 4 ? parsed : 2;
}

const saveState = {
  timer: null,
  lastSavedSignature: '',
  requestId: 0
};

const getRuntimeErrorMessage = ChromeApi.getRuntimeErrorMessage;

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

const storageGet = ChromeApi.storageGet;
const storageSet = ChromeApi.storageSet;
const storageRemove = ChromeApi.storageRemove;
const storageLocalGet = ChromeApi.storageLocalGet;
const storageLocalSet = ChromeApi.storageLocalSet;
const runtimeSendMessage = ChromeApi.runtimeSendMessage;

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

const formatDateTime = (value) => UiFormat.formatDateTime(value, { emptyText: I18n.get('popup_not_recorded'), includeYear: false });

function setBadge(id, text, tone) {
  const node = $(id);
  if (!node) return;
  node.textContent = text;
  node.className = 'status-badge' + (tone ? ' ' + tone : '');
}

function getSaveSuccessText(settings) {
  return settings.privacyMode ? I18n.get('popup_saved_private') : I18n.get('popup_saved');
}

function validateBaseURL(url) {
  if (!url) return true;
  return UrlUtils.isAllowedModelEndpointUrl(url);
}

const normalizeBaseURLInput = UrlUtils.normalizeBaseURLInput;

function getProviderCredentialValidation(settings) {
  const presetId = String(settings?.providerPreset || '').trim();
  const provider = String(settings?.aiProvider || '').trim();
  const profile = ProviderPresets?.getProviderProfile?.(presetId, provider);
  const route = ProviderPresets?.inferRouteFromSettings?.(settings, presetId);
  const baseUrl = String(settings?.aiBaseURL || route?.baseUrl || profile?.baseUrl || '').trim();
  const apiKey = String(settings?.apiKey || '').trim();

  if (!ProviderPresets?.validateCredentials) {
    return { valid: true, message: '' };
  }

  return ProviderPresets.validateCredentials(presetId, provider, baseUrl, apiKey);
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
    uiLanguage: normalizeUiLanguage($('uiLanguage')?.value),
    chunkConcurrency: normalizeChunkConcurrency($('chunkConcurrency')?.value),
    themePreference: Theme.normalizePreference($('themePreference').value),
    themePalette: Theme.normalizePalette($('themePalette')?.value),
    sidebarCompactMode: !!$('sidebarCompactMode')?.checked,
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
    setStatus(options.statusText || I18n.get('popup_autosaving'));
  }

  try {
    const activeProfileId = String(profileState.activeId || '').trim();
    const payload = Object.assign({}, settings);

    if (activeProfileId && !options.skipProfileSync) {
      const profileKey = getProfileStorageKey(activeProfileId);
      if (profileKey) {
        payload[profileKey] = Object.assign({}, settings);
      }

      const now = new Date().toISOString();
      const existingEntry = findProfileIndexEntry(activeProfileId) || { id: activeProfileId, name: I18n.get('popup_unnamed_profile') };
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
      const credentialValidation = getProviderCredentialValidation(settings);
      if (settings.aiBaseURL && !validateBaseURL(settings.aiBaseURL)) {
        setStatus(baseUrlInvalidMessage(), 'warning');
      } else if (!credentialValidation.valid) {
        setStatus(credentialValidation.message, 'warning');
      } else {
        setStatus(getSaveSuccessText(settings), 'success');
      }
      setStatusDetails('');
    }
    return true;
  } catch (error) {
    if (requestId === saveState.requestId) {
      setStatus(I18n.get('popup_save_failed', [String(error?.message || error || I18n.get('popup_unknown_error'))]), 'error');
      setStatusDetails('');
    }
    return false;
  }
}

function scheduleAutoSave() {
  clearAutoSaveTimer();
  setStatus(waitingAutosaveText());
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
      updateHints();
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
  $('uiLanguage').value = normalizeUiLanguage(safeSettings.uiLanguage);
  $('chunkConcurrency').value = String(normalizeChunkConcurrency(safeSettings.chunkConcurrency));
  $('themePreference').value = themePreference;
  $('themePalette').value = themePalette;
  $('sidebarCompactMode').checked = !!safeSettings.sidebarCompactMode;
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
  setStatus(idleStatusText());
  setStatusDetails('');

  await loadCachedModelOptions(collectSettings());
}

function handleSave(event) {
  event.preventDefault();
  persistSettings({
    force: true,
    statusText: I18n.get('popup_saving_settings')
  });
}

async function handleTestConnection() {
  await persistSettings({
    skipSuccessStatus: true,
    silentStatus: true
  });

  const settings = collectSettings();
  if (!settings.apiKey) {
    setStatus(I18n.get('popup_need_api_key'), 'error');
    return;
  }

  if (settings.aiBaseURL && !validateBaseURL(settings.aiBaseURL)) {
    setStatus(baseUrlInvalidMessage(), 'error');
    return;
  }

  const credentialValidation = getProviderCredentialValidation(settings);
  if (!credentialValidation.valid) {
    setStatus(credentialValidation.message, 'error');
    return;
  }

  const button = $('testBtn');
  button.disabled = true;
  button.textContent = I18n.get('popup_testing');
  setStatus(I18n.get('popup_testing_connection'));

  try {
    const response = await runtimeSendMessage({ action: 'testConnection', settings });

    if (response.success) {
      const diag = response.diagnostics || {};
      const model = diag?.model || settings.modelName || I18n.get('popup_default_model');
      const extras = [];

      if (diag?.requestedEndpointMode === 'auto' && diag?.autoEndpointSelected) {
        extras.push(`endpoint=${diag.autoEndpointSelected}`);
      }
      if (diag?.autoBaseUrlSaved && typeof diag?.autoBaseUrlAppliedV1 === 'boolean') {
        extras.push(diag.autoBaseUrlAppliedV1 ? I18n.get('popup_auto_v1_added') : I18n.get('popup_auto_v1_removed'));
      }

      setStatus(I18n.get('popup_connected', [model, extras.length ? I18n.get('popup_extras_joined', [extras.join('，')]) : '']), 'success');
      setStatusDetails('');

      // Best-effort: refresh model list after a successful connection test.
      refreshModelOptions({ reason: 'after_test' }).catch(() => {});
      return;
    }

    setStatus(getRuntimeErrorMessage(response.error), 'error');
    setStatusDetails(buildErrorDetailsText(response.error, response.diagnostics));
  } finally {
    button.disabled = false;
    button.textContent = I18n.get('popup_test_btn');
  }
}

async function openHistory() {
  setStatus(I18n.get('popup_opening_history'));
  const response = await runtimeSendMessage({ action: 'triggerHistory' });
  if (response.success) {
    setStatus(I18n.get('popup_history_opened'), 'success');
    return;
  }
  setStatus(getRuntimeErrorMessage(response.error) || I18n.get('popup_history_open_failed'), 'error');
  setStatusDetails('');
}

// ---- Controller wiring (popup/* modules) ---------------------------------
// Controllers are created once at startup; destructured names keep every
// call site below unchanged. Cross-controller deps use lazy wrappers to
// avoid initialization-order cycles.
const themeControlsController = YilanPopupThemeControls.createThemeControlsController({
  $,
  theme: Theme,
  i18n: I18n
});
const {
  renderThemeHint,
  syncThemePreferenceControl,
  renderPaletteHint,
  setPaletteControlState,
  syncThemePaletteControl
} = themeControlsController;

const profilesController = YilanPopupProfiles.createProfilesController({
  $,
  i18n: I18n,
  providerPresets: ProviderPresets,
  storageGet,
  storageSet,
  storageRemove,
  collectSettings,
  applySettingsToForm,
  persistSettings,
  setStatus,
  setStatusDetails
});
const {
  PROFILES_INDEX_KEY,
  ACTIVE_PROFILE_ID_KEY,
  PROFILE_KEY_PREFIX,
  profileState,
  getProfileStorageKey,
  normalizeProfilesIndex,
  upsertProfilesIndexEntry,
  removeProfilesIndexEntry,
  findProfileIndexEntry,
  renderProfileSelector,
  renderProfileHint,
  updateProfilesStorage,
  activateProfile,
  createOrCloneProfile
} = profilesController;
const bindProfileControls = profilesController.bindProfileControls;

const providerSelectionController = YilanPopupProviderSelection.createProviderSelectionController({
  $,
  i18n: I18n,
  providerPresets: ProviderPresets,
  normalizeBaseURLInput,
  persistSettings,
  collectSettings,
  loadCachedModelOptions: (...args) => modelsController.loadCachedModelOptions(...args),
  syncThemePreferenceControl,
  syncThemePaletteControl,
  urlUtils: UrlUtils,
  uiLabels: UiLabels
});
const {
  inferPresetId,
  inferEndpointMode,
  renderPresetOptions,
  syncSelectionState,
  renderEndpointPreview,
  updateHints
} = providerSelectionController;
const bindSelectionListeners = providerSelectionController.bindSelectionListeners;

const modelsController = YilanPopupModels.createModelsController({
  $,
  i18n: I18n,
  urlUtils: UrlUtils,
  storageLocalGet,
  runtimeSendMessage,
  collectSettings,
  persistSettings,
  validateBaseURL,
  getProviderCredentialValidation,
  getRuntimeErrorMessage,
  formatDateTime,
  updateHints: (...args) => providerSelectionController.updateHints(...args),
  baseUrlInvalidMessage,
  modelsCacheStorageKey: MODELS_CACHE_STORAGE_KEY
});
const {
  renderModelOptions,
  loadCachedModelOptions,
  refreshModelOptions
} = modelsController;
const bindModelControls = modelsController.bindModelControls;

const entrypointsViewController = YilanPopupEntrypointsView.createEntrypointsViewController({
  $,
  i18n: I18n,
  runtimeSendMessage,
  setStatus,
  setStatusDetails,
  setBadge,
  getRuntimeErrorMessage,
  formatDateTime
});
const {
  renderEntrypointStatus,
  loadEntrypointStatus,
  openShortcutSettings
} = entrypointsViewController;

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
          syncSelectionState({ preferredEndpointMode: $('endpointMode').value });
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
    setStatus(String(error?.message || error || I18n.get('popup_settings_load_failed')), 'error');
  });
  loadEntrypointStatus({ silent: true }).catch((error) => {
    setStatus(String(error?.message || error || I18n.get('popup_entrypoint_check_failed')), 'error');
  });

  $('settingsForm').addEventListener('submit', handleSave);
  $('testBtn').addEventListener('click', handleTestConnection);
  $('historyBtn').addEventListener('click', openHistory);

  // Toggle API key visibility; the i18n binding attributes are swapped too so
  // a later locale switch re-applies the correct label for the current state.
  const apiKeyVisibilityBtn = $('apiKeyVisibilityBtn');
  if (apiKeyVisibilityBtn) {
    apiKeyVisibilityBtn.addEventListener('click', () => {
      const field = /** @type {HTMLInputElement} */ ($('apiKey'));
      if (!field) return;
      const reveal = field.type === 'password';
      field.type = reveal ? 'text' : 'password';
      const copyKey = reveal ? 'popup_api_key_hide' : 'popup_api_key_show';
      apiKeyVisibilityBtn.setAttribute('aria-pressed', reveal ? 'true' : 'false');
      apiKeyVisibilityBtn.setAttribute('data-i18n-title', copyKey);
      apiKeyVisibilityBtn.setAttribute('data-i18n-aria-label', copyKey);
      const label = I18n.get(copyKey);
      if (label) {
        apiKeyVisibilityBtn.title = label;
        apiKeyVisibilityBtn.setAttribute('aria-label', label);
      }
    });
  }
  $('refreshEntrypointsBtn').addEventListener('click', () => {
    loadEntrypointStatus().catch((error) => {
      setStatus(String(error?.message || error || I18n.get('popup_entrypoint_check_failed')), 'error');
    });
  });
  $('shortcutSettingsBtn').addEventListener('click', openShortcutSettings);

  // YilanI18n dispatches this after the uiLanguage override resolves or the
  // setting changes; repaint live copy that is not covered by data-i18n.
  document.addEventListener('yilan-locale-changed', () => {
    renderEndpointPreview();
    const testButton = $('testBtn');
    if (testButton && testButton.disabled) return;
    setStatus(idleStatusText());
    setStatusDetails('');
  });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    flushPendingChanges();
  }
});

window.addEventListener('pagehide', flushPendingChanges);

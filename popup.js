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
const Domain = window.AISummaryDomain;
const RecordStore = window.db;
const Surface = window.YilanPopupSurface || { surface: 'popup', pinned: false, isPopup: true, isTab: false };
const YilanPopupThemeControls = window.YilanPopupThemeControls;
const YilanPopupProfiles = window.YilanPopupProfiles;
const YilanPopupProviderSelection = window.YilanPopupProviderSelection;
const YilanPopupModels = window.YilanPopupModels;
const YilanPopupEntrypointsView = window.YilanPopupEntrypointsView;
const YilanPopupHome = window.YilanPopupHome;

const $ = (id) => document.getElementById(id);

const SETTINGS_KEYS = Constants.SETTINGS_KEYS;

const MODELS_CACHE_STORAGE_KEY = Constants.MODELS_CACHE_STORAGE_KEY;
const CONNECTION_CHECK_STORAGE_KEY = Constants.CONNECTION_CHECK_STORAGE_KEY;

const ACTIVE_TAB_STORAGE_KEY = 'popupActiveTab';
const HOME_TAB = 'home';
const DEFAULT_SETTINGS_TAB = 'connection';
// Reopening the popup shortly after leaving it on a settings tab (e.g. to
// copy an API key from the provider console) resumes there; otherwise the
// popup starts on the "此页" home view.
const TAB_RESUME_WINDOW_MS = 5 * 60 * 1000;
const OUTPUT_LANGUAGE_AUTO = 'auto';
// Home quick chips mirror these full-settings toggles.
const QUICK_TOGGLES = [
  ['quickSimpleMode', 'entrypointSimpleMode'],
  ['quickPrivacyMode', 'privacyMode']
];

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

const viewState = {
  activeTab: '',
  settingsLoaded: false,
  testing: false,
  connectionCheck: null
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
  // The home view only surfaces the footer for warnings and errors.
  const footer = $('statusFooter');
  if (footer) footer.dataset.tone = tone || '';
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

function setConnectResult(text, tone) {
  const node = $('connectResult');
  if (!node) return;
  node.textContent = text || '';
  node.className = 'connect-result' + (tone ? ' ' + tone : '');
  node.hidden = !text;
}

function setFieldAlert(id, text) {
  const node = $(id);
  if (!node) return;
  node.textContent = text || '';
  node.hidden = !text;
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
  syncDerivedControls();
  renderConnectionState();

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

// ---- Tabs & surfaces ----------------------------------------------------

function readStoredTab() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY) || 'null');
    if (parsed && typeof parsed.tab === 'string') {
      return { tab: parsed.tab, at: Number(parsed.at) || 0 };
    }
  } catch (error) {
    // Legacy plain-string values or blocked storage: start fresh.
  }
  return null;
}

function storeActiveTab(tabId) {
  try {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, JSON.stringify({ tab: tabId, at: Date.now() }));
  } catch (error) {
    // Ignore storage failures in popup UI state.
  }
}

function isTabAvailable(tabId) {
  if (!tabId) return false;
  // The full-tab surface is the options page: there is no "current page".
  if (tabId === HOME_TAB && !Surface.isPopup) return false;
  return !!document.querySelector('[data-tab-panel="' + tabId + '"]');
}

// The popup remembers its tab in localStorage (resume window); the full tab
// keeps its section in the URL hash and only reads the popup's memory as a
// hand-off when it was opened from the popup moments ago.
function resolveInitialTab() {
  const hashTab = String(window.location.hash || '').replace(/^#/, '');
  if (isTabAvailable(hashTab)) return hashTab;

  const stored = readStoredTab();
  const resumable = stored && stored.tab !== HOME_TAB && Date.now() - stored.at < TAB_RESUME_WINDOW_MS && isTabAvailable(stored.tab);
  if (Surface.isPopup) return resumable ? stored.tab : HOME_TAB;
  return resumable ? stored.tab : DEFAULT_SETTINGS_TAB;
}

function getNavigableTabButtons() {
  return Array.from(document.querySelectorAll('[data-tab]'))
    .filter((button) => isTabAvailable(button.dataset.tab));
}

function positionTabGlider() {
  const tabs = document.querySelector('.tabs');
  const active = tabs ? /** @type {HTMLElement | null} */ (tabs.querySelector('.tab.active')) : null;
  const glider = tabs ? /** @type {HTMLElement | null} */ (tabs.querySelector('.tab-glider')) : null;
  if (!tabs || !active || !glider) return;
  glider.style.height = active.offsetHeight + 'px';
  glider.style.transform = 'translateY(' + active.offsetTop + 'px)';
}

function focusFirstMissingConnectionField() {
  const settings = collectSettings();
  const target = !settings.apiKey ? $('apiKey') : !settings.modelName ? $('modelName') : null;
  if (target) window.requestAnimationFrame(() => target.focus());
}

function activateTab(tabId, options = {}) {
  const buttons = Array.from(document.querySelectorAll('[data-tab]'));
  const panels = Array.from(document.querySelectorAll('[data-tab-panel]'));
  const targetId = isTabAvailable(tabId) ? tabId : (Surface.isPopup ? HOME_TAB : DEFAULT_SETTINGS_TAB);
  viewState.activeTab = targetId;

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

  document.body.dataset.activeTab = targetId;
  if (Surface.isPopup) {
    storeActiveTab(targetId);
  } else if (window.location.hash !== '#' + targetId) {
    window.history.replaceState(null, '', '#' + targetId);
  }

  positionTabGlider();
  if (options.focusFirstMissing) focusFirstMissingConnectionField();
}

function setupTabs() {
  activateTab(resolveInitialTab());
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
    button.addEventListener('keydown', (event) => {
      const keyEvent = /** @type {KeyboardEvent} */ (event);
      const buttons = getNavigableTabButtons();
      const index = buttons.indexOf(button);
      let nextIndex = -1;
      if (keyEvent.key === 'ArrowRight' || keyEvent.key === 'ArrowDown') nextIndex = (index + 1) % buttons.length;
      else if (keyEvent.key === 'ArrowLeft' || keyEvent.key === 'ArrowUp') nextIndex = (index - 1 + buttons.length) % buttons.length;
      else if (keyEvent.key === 'Home') nextIndex = 0;
      else if (keyEvent.key === 'End') nextIndex = buttons.length - 1;
      if (nextIndex < 0) return;
      event.preventDefault();
      const next = buttons[nextIndex];
      activateTab(next.dataset.tab);
      next.focus();
    });
  });
  window.addEventListener('resize', positionTabGlider);
  if (document.fonts && typeof document.fonts.ready?.then === 'function') {
    document.fonts.ready.then(positionTabGlider).catch(() => {});
  }
}

function openFullSettings(tabId) {
  const target = isTabAvailable(tabId) && tabId !== HOME_TAB
    ? tabId
    : viewState.activeTab && viewState.activeTab !== HOME_TAB ? viewState.activeTab : DEFAULT_SETTINGS_TAB;
  storeActiveTab(target);
  flushPendingChanges();

  const finish = () => {
    if (Surface.isPopup && !Surface.pinned) window.close();
  };
  try {
    chrome.runtime.openOptionsPage(() => {
      void chrome.runtime.lastError;
      finish();
    });
  } catch (error) {
    ChromeApi.createTab(chrome.runtime.getURL('popup.html#' + target)).then(finish);
  }
}

const RAIL_LANGUAGE_SEQUENCE = ['auto', 'zh', 'en'];
const RAIL_LANGUAGE_TAGS = { auto: 'AUTO', zh: '中文', en: 'EN' };

function syncRailLanguageControl() {
  const tag = $('railLanguageTag');
  if (!tag) return;
  const select = /** @type {HTMLSelectElement | null} */ ($('uiLanguage'));
  const value = normalizeUiLanguage(select?.value);
  tag.textContent = RAIL_LANGUAGE_TAGS[value] || RAIL_LANGUAGE_TAGS.auto;
}

function bindRailControls() {
  const languageButton = $('railLanguageBtn');
  if (languageButton) {
    languageButton.addEventListener('click', () => {
      const select = /** @type {HTMLSelectElement | null} */ ($('uiLanguage'));
      if (!select) return;
      const current = normalizeUiLanguage(select.value);
      const index = RAIL_LANGUAGE_SEQUENCE.indexOf(current);
      select.value = RAIL_LANGUAGE_SEQUENCE[(index + 1) % RAIL_LANGUAGE_SEQUENCE.length];
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncRailLanguageControl();
    });
  }

  $('openFullSettingsBtn')?.addEventListener('click', () => openFullSettings(viewState.activeTab));
}

// ---- Derived controls: output language & home quick chips --------------
// The stored settings keep `autoTranslate` + `defaultLanguage`; the UI shows
// them as one choice: 'auto' (no translation) or a fixed output language.

function getOutputLanguageValue() {
  const autoTranslate = !!(/** @type {HTMLInputElement} */ ($('autoTranslate'))).checked;
  return autoTranslate ? ($('defaultLanguage').value || 'zh') : OUTPUT_LANGUAGE_AUTO;
}

function syncOutputLanguageControls() {
  const value = getOutputLanguageValue();
  document.querySelectorAll('[data-output-language-select]').forEach((node) => {
    const select = /** @type {HTMLSelectElement} */ (node);
    const known = Array.from(select.options).some((option) => option.value === value);
    select.value = known ? value : OUTPUT_LANGUAGE_AUTO;
  });
}

function applyOutputLanguage(value) {
  const autoTranslate = /** @type {HTMLInputElement} */ ($('autoTranslate'));
  if (value === OUTPUT_LANGUAGE_AUTO) {
    autoTranslate.checked = false;
  } else {
    autoTranslate.checked = true;
    $('defaultLanguage').value = value;
  }
  syncOutputLanguageControls();
  persistSettings();
}

function syncQuickToggles() {
  QUICK_TOGGLES.forEach(([chipId, fieldId]) => {
    const chip = $(chipId);
    const field = /** @type {HTMLInputElement | null} */ ($(fieldId));
    if (chip && field) chip.setAttribute('aria-pressed', field.checked ? 'true' : 'false');
  });
}

function syncDerivedControls() {
  syncOutputLanguageControls();
  syncQuickToggles();
}

function bindDerivedControls() {
  document.querySelectorAll('[data-output-language-select]').forEach((node) => {
    const select = /** @type {HTMLSelectElement} */ (node);
    select.addEventListener('change', () => applyOutputLanguage(select.value));
  });

  QUICK_TOGGLES.forEach(([chipId, fieldId]) => {
    const chip = $(chipId);
    const field = /** @type {HTMLInputElement | null} */ ($(fieldId));
    if (!chip || !field) return;
    chip.addEventListener('click', () => {
      field.checked = !field.checked;
      // Goes through the field's data-autosave listener like a direct toggle.
      field.dispatchEvent(new Event('change', { bubbles: true }));
      syncQuickToggles();
    });
    field.addEventListener('change', syncQuickToggles);
  });
}

// ---- Connection status ----------------------------------------------------
// A past test only counts while the connection fields still match it, so the
// popup never claims "ready" for settings that were never verified.

function getConnectionSignature(settings) {
  return YilanPopupHome.buildConnectionSignature(settings, Domain?.hashString);
}

async function loadConnectionCheck() {
  try {
    const items = await storageLocalGet([CONNECTION_CHECK_STORAGE_KEY]);
    const stored = items?.[CONNECTION_CHECK_STORAGE_KEY];
    viewState.connectionCheck = stored && typeof stored === 'object' ? stored : null;
  } catch (error) {
    viewState.connectionCheck = null;
  }
}

async function saveConnectionCheck(settings, ok, details) {
  viewState.connectionCheck = {
    signature: getConnectionSignature(settings),
    ok: !!ok,
    testedAt: new Date().toISOString(),
    model: String(details?.model || settings.modelName || ''),
    message: String(details?.message || '')
  };
  try {
    await storageLocalSet({ [CONNECTION_CHECK_STORAGE_KEY]: viewState.connectionCheck });
  } catch (error) {
    // The in-memory result still drives this popup session.
  }
}

function extractEndpointHost(url) {
  try {
    return url ? new URL(url).host : '';
  } catch (error) {
    return '';
  }
}

function getSelectedPresetLabel() {
  const select = /** @type {HTMLSelectElement | null} */ ($('providerPreset'));
  return String(select?.selectedOptions?.[0]?.textContent || '').trim();
}

function getConnectionSummary() {
  const settings = collectSettings();
  const check = viewState.connectionCheck;
  const state = YilanPopupHome.resolveConnectionState(settings, check, getConnectionSignature(settings));
  const presetLabel = getSelectedPresetLabel();

  let stateText = I18n.get('popup_conn_state_incomplete');
  if (state === 'verified') {
    stateText = I18n.get('popup_conn_state_verified', [YilanPopupHome.formatRelativeTime(check?.testedAt, I18n.getUILanguage())]);
  } else if (state === 'failed') {
    stateText = I18n.get('popup_conn_state_failed');
  } else if (state === 'unverified') {
    stateText = I18n.get('popup_conn_state_unverified');
  }

  return {
    settings,
    state,
    presetLabel,
    stateText,
    model: settings.modelName,
    detail: [presetLabel, stateText].filter(Boolean).join(' · ')
  };
}

function renderConnectionState() {
  const summary = getConnectionSummary();
  const { settings, state } = summary;

  const hero = $('connectHero');
  if (hero) hero.dataset.state = state;
  $('connectStateText').textContent = summary.stateText;
  $('connectHeroModel').textContent = settings.modelName || I18n.get('popup_hero_model_empty');

  const baseUrlInput = /** @type {HTMLInputElement} */ ($('baseURL'));
  const endpointHost = extractEndpointHost(settings.aiBaseURL || String(baseUrlInput?.placeholder || '').trim());
  const profileName = findProfileIndexEntry(profileState.activeId)?.name || '';
  $('connectHeroMeta').textContent = [profileName, summary.presetLabel, endpointHost].filter(Boolean).join(' · ');

  const testButton = $('testBtn');
  if (testButton) testButton.classList.toggle('is-quiet', state === 'verified');

  // Inline validation next to the offending field instead of only the footer.
  const credentialValidation = getProviderCredentialValidation(settings);
  const keyInvalid = !!settings.apiKey && !credentialValidation.valid;
  setFieldAlert('apiKeyValidation', keyInvalid ? credentialValidation.message : '');
  setFieldAlert('baseURLValidation', settings.aiBaseURL && !validateBaseURL(settings.aiBaseURL) ? baseUrlInvalidMessage() : '');

  const stepState = {
    provider: !!summary.presetLabel,
    key: !!settings.apiKey && !keyInvalid,
    model: !!settings.modelName
  };
  document.querySelectorAll('.connection-steps > [data-step]').forEach((stepNode) => {
    const stepName = stepNode.getAttribute('data-step') || '';
    stepNode.classList.toggle('step-done', !!stepState[stepName]);
    stepNode.classList.toggle('step-warn', stepName === 'key' && keyInvalid);
  });

  if (!viewState.testing) {
    if (state === 'failed') {
      setConnectResult(viewState.connectionCheck?.message || '', 'error');
    } else if (state !== 'verified') {
      // The last result described different settings; don't let it linger.
      setConnectResult('', '');
    }
  }

  homeController.renderConnection(summary);
  homeController.renderAction();
}

function getHomeContext() {
  const settings = collectSettings();
  const steps = { provider: true, key: !!settings.apiKey, model: !!settings.modelName };
  return {
    ready: viewState.settingsLoaded,
    // Until settings load, assume configured so first paint doesn't flash setup.
    configured: !viewState.settingsLoaded || (steps.key && steps.model),
    autoStart: settings.entrypointAutoStart,
    reuseHistory: settings.entrypointReuseHistory,
    steps
  };
}

// ---- Shortcut keycaps ---------------------------------------------------------

function splitShortcut(shortcut) {
  const raw = String(shortcut || '').trim();
  if (!raw) return [];
  // "Alt+S" on Windows/Linux, symbol strings such as "⌥S" on macOS.
  return raw.includes('+') ? raw.split('+').map((part) => part.trim()).filter(Boolean) : Array.from(raw);
}

function renderShortcutKeys(entrypoints) {
  const shortcut = entrypoints?.shortcut || {};
  const keys = shortcut.status === 'assigned' ? splitShortcut(shortcut.shortcut) : [];

  document.querySelectorAll('[data-shortcut-keys]').forEach((node) => {
    const slot = node.getAttribute('data-shortcut-keys');
    if (keys.length) {
      node.replaceChildren(...keys.map((key) => {
        const kbd = document.createElement('kbd');
        if (slot !== 'cta') kbd.className = 'keycap';
        kbd.textContent = key;
        return kbd;
      }));
      node.hidden = false;
    } else if (slot === 'cta') {
      node.hidden = true;
    }
  });

  const tip = $('homeTip');
  if (tip) tip.dataset.shortcut = keys.length ? 'assigned' : 'none';
}

function bindAutoSaveControls() {
  document.querySelectorAll('[data-autosave="immediate"]').forEach((field) => {
    field.addEventListener('change', () => {
      persistSettings();
    });
  });

  document.querySelectorAll('[data-autosave="debounced"]').forEach((field) => {
    field.addEventListener('input', () => {
      scheduleAutoSave();
      renderConnectionState();
    });
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
  syncDerivedControls();
  syncRailLanguageControl();

  saveState.lastSavedSignature = createSettingsSignature(collectSettings());
  renderConnectionState();
  renderEndpointPreview();
}

async function loadSettings() {
  const keys = SETTINGS_KEYS.concat([PROFILES_INDEX_KEY, ACTIVE_PROFILE_ID_KEY]);
  const [items] = await Promise.all([storageGet(keys), loadConnectionCheck()]);

  profileState.index = normalizeProfilesIndex(items?.[PROFILES_INDEX_KEY]);
  profileState.activeId = String(items?.[ACTIVE_PROFILE_ID_KEY] || '').trim();

  if (profileState.activeId && !findProfileIndexEntry(profileState.activeId)) {
    profileState.activeId = '';
    await updateProfilesStorage(profileState.index, '');
  }

  viewState.settingsLoaded = true;
  renderProfileSelector();
  applySettingsToForm(items);
  setStatus(idleStatusText());
  setStatusDetails('');

  await loadCachedModelOptions(collectSettings());
}

// Keep the active profile in step with other windows; a stale id here would
// make the next autosave write into the previously active profile's slot.
function handleExternalProfileChange(changes) {
  if (!viewState.settingsLoaded) return;
  const indexChange = changes?.[PROFILES_INDEX_KEY];
  const activeChange = changes?.[ACTIVE_PROFILE_ID_KEY];
  if (!indexChange && !activeChange) return;

  if (indexChange) profileState.index = normalizeProfilesIndex(indexChange.newValue);
  if (activeChange) profileState.activeId = String(activeChange.newValue || '').trim();
  renderProfileSelector();
  renderConnectionState();
}

function handleExternalSettingsChange(changes) {
  if (!viewState.settingsLoaded) return;
  const changedKeys = SETTINGS_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(changes || {}, key));
  if (!changedKeys.length) return;

  // Our own autosave echoes back values the form already holds.
  const current = collectSettings();
  const external = changedKeys.some((key) => JSON.stringify(changes[key].newValue ?? null) !== JSON.stringify(current[key] ?? null));
  // A debounced edit on this page is about to save; let it win.
  if (!external || saveState.timer) return;

  storageGet(SETTINGS_KEYS).then((items) => {
    applySettingsToForm(items);
    loadCachedModelOptions(collectSettings());
  }).catch(() => {});
}

function handleSave(event) {
  event.preventDefault();
  persistSettings({
    force: true,
    statusText: I18n.get('popup_saving_settings')
  });
}

function rejectTest(message) {
  setStatus(message, 'error');
  setConnectResult(message, 'error');
}

async function handleTestConnection() {
  await persistSettings({
    skipSuccessStatus: true,
    silentStatus: true
  });

  const settings = collectSettings();
  if (!settings.apiKey) {
    rejectTest(I18n.get('popup_need_api_key'));
    return;
  }

  if (settings.aiBaseURL && !validateBaseURL(settings.aiBaseURL)) {
    rejectTest(baseUrlInvalidMessage());
    return;
  }

  const credentialValidation = getProviderCredentialValidation(settings);
  if (!credentialValidation.valid) {
    rejectTest(credentialValidation.message);
    return;
  }

  const button = $('testBtn');
  viewState.testing = true;
  button.disabled = true;
  button.textContent = I18n.get('popup_testing');
  setStatus(I18n.get('popup_testing_connection'));
  setConnectResult(I18n.get('popup_testing_connection'), 'pending');

  const response = await runtimeSendMessage({ action: 'testConnection', settings });
  viewState.testing = false;
  button.disabled = false;
  button.textContent = I18n.get('popup_test_btn');

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

    const message = I18n.get('popup_connected', [model, extras.length ? I18n.get('popup_extras_joined', [extras.join('，')]) : '']);
    setStatus(message, 'success');
    setStatusDetails('');
    // The signature ignores a trailing /v1, so a background auto-fix of the
    // base URL keeps this result valid.
    await saveConnectionCheck(settings, true, { model });
    setConnectResult(message, 'success');
    renderConnectionState();

    // Best-effort: refresh model list after a successful connection test.
    refreshModelOptions({ reason: 'after_test' }).catch(() => {});
    return;
  }

  const errorMessage = getRuntimeErrorMessage(response.error);
  setStatus(errorMessage, 'error');
  setStatusDetails(buildErrorDetailsText(response.error, response.diagnostics));
  await saveConnectionCheck(settings, false, { message: errorMessage });
  renderConnectionState();
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
  syncThemePaletteControl
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
  formatDateTime,
  onStatus: renderShortcutKeys
});
const {
  renderEntrypointStatus,
  loadEntrypointStatus,
  openShortcutSettings
} = entrypointsViewController;

const homeController = YilanPopupHome.createHomeController({
  $,
  i18n: I18n,
  uiLabels: UiLabels,
  domain: Domain,
  runtimeSendMessage,
  getRuntimeErrorMessage,
  queryTargetTab: async () => {
    // `?surface=popup&targetTab=<id>` (pinned surfaces only) lets tests and
    // screenshots render the home view for a specific tab.
    const pinnedTabId = Number(new URLSearchParams(window.location.search).get('targetTab'));
    if (Surface.pinned && Number.isInteger(pinnedTabId) && pinnedTabId > 0) {
      return chrome.tabs.get(pinnedTabId);
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  },
  isFileSchemeAllowed: () => new Promise((resolve) => chrome.extension.isAllowedFileSchemeAccess(resolve)),
  findRecordForUrl: (url) => (RecordStore?.findReusableRecordByUrl ? RecordStore.findReusableRecordByUrl(url) : Promise.resolve(null)),
  getHomeContext,
  activateTab,
  openFullSettings,
  closeWindow: () => {
    if (!Surface.isPopup || Surface.pinned) return false;
    window.close();
    return true;
  }
});

window.addEventListener('DOMContentLoaded', () => {
  renderPresetOptions();
  setupTabs();
  bindAutoSaveControls();
  bindSelectionListeners();
  bindProfileControls();
  bindModelControls();
  bindRailControls();
  bindDerivedControls();
  homeController.bindControls();
  homeController.render();

  // Keep the form in sync with writes from elsewhere: background auto-fixes
  // (e.g. toggling `/v1` on testConnection), the options tab, or another
  // popup. Autosave writes the whole form, so a stale copy here would
  // otherwise overwrite those changes on the next save or on close.
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged && typeof chrome.storage.onChanged.addListener === 'function') {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      handleExternalProfileChange(changes);
      handleExternalSettingsChange(changes);
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
  if (Surface.isPopup) {
    homeController.load().catch(() => {});
  }

  $('settingsForm').addEventListener('submit', handleSave);
  $('testBtn').addEventListener('click', handleTestConnection);

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
    renderConnectionState();
    homeController.render();
    syncRailLanguageControl();
    window.requestAnimationFrame(positionTabGlider);
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

window.addEventListener('pagehide', () => {
  flushPendingChanges();
  // Refresh the resume window with the tab the popup is closed on.
  if (Surface.isPopup && viewState.activeTab) storeActiveTab(viewState.activeTab);
});

(function initYilanPopupHome(global) {
  // "此页" home view of the toolbar popup: what page this is, whether it can be
  // summarized, whether a summary already exists, and one primary action.
  // Pure helpers are exported alongside the controller for unit tests and for
  // popup.js (connection status uses the same signature/relative-time code).

  const SNIPPET_MAX_CHARS = 150;

  const PROTECTED_STORE_PAGES = [
    { host: 'chromewebstore.google.com', path: '/' },
    { host: 'chrome.google.com', path: '/webstore' },
    { host: 'microsoftedge.microsoft.com', path: '/addons' }
  ];

  const RELATIVE_TIME_UNITS = [
    ['year', 365 * 24 * 60 * 60],
    ['month', 30 * 24 * 60 * 60],
    ['week', 7 * 24 * 60 * 60],
    ['day', 24 * 60 * 60],
    ['hour', 60 * 60],
    ['minute', 60]
  ];

  const UNSUPPORTED_REASON_KEYS = {
    browser: 'popup_home_unsupported_browser',
    store: 'popup_home_unsupported_store',
    file: 'popup_home_unsupported_file',
    unknown: 'popup_home_unsupported_unknown'
  };

  const PAGE_KIND_KEYS = {
    youtube: 'popup_home_kind_youtube',
    bilibili: 'popup_home_kind_bilibili',
    file: 'popup_home_kind_file'
  };

  const TRIGGER_FAILURE_KEYS = {
    no_tab: 'popup_home_error_no_tab',
    inject_failed: 'popup_home_error_inject',
    message_failed: 'popup_home_error_message'
  };

  // Classifies a tab URL from the URL alone. `supported` means the content
  // script can be injected; restricted pages get a user-facing `reason`.
  function classifyPageUrl(url, domain) {
    const raw = String(url || '').trim();
    const result = { supported: false, reason: 'unknown', kind: 'web', host: '', url: raw };
    if (!raw) return result;

    let parsed;
    try {
      parsed = new URL(raw);
    } catch (error) {
      return result;
    }

    if (parsed.protocol === 'file:') {
      const segments = decodeURIComponent(parsed.pathname || '').split('/').filter(Boolean);
      return Object.assign(result, { supported: true, reason: '', kind: 'file', host: segments.pop() || raw });
    }

    result.host = parsed.host || raw;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return Object.assign(result, { reason: 'browser', host: parsed.protocol + '//' + (parsed.host || parsed.pathname) });
    }

    const hostname = parsed.hostname.toLowerCase();
    if (PROTECTED_STORE_PAGES.some((entry) => hostname === entry.host && parsed.pathname.startsWith(entry.path))) {
      return Object.assign(result, { reason: 'store' });
    }

    const Domain = domain || global.AISummaryDomain;
    const siteType = Domain?.detectSiteType ? Domain.detectSiteType({ url: raw, host: hostname }) : '';
    const kind = siteType === 'video'
      ? (hostname.includes('bilibili.com') ? 'bilibili' : 'youtube')
      : 'web';

    return Object.assign(result, {
      supported: true,
      reason: '',
      kind,
      host: hostname.replace(/^www\./, '')
    });
  }

  function toIntlLocale(uiLanguage) {
    if (uiLanguage === 'zh') return 'zh-CN';
    if (uiLanguage === 'en') return 'en';
    return undefined;
  }

  // "3 天前" / "3 days ago" through Intl, so both catalogs stay key-free.
  function formatRelativeTime(value, uiLanguage, nowMs) {
    const time = new Date(value || 0).getTime();
    if (!Number.isFinite(time) || time <= 0) return '';

    let formatter;
    try {
      formatter = new Intl.RelativeTimeFormat(toIntlLocale(uiLanguage), { numeric: 'auto' });
    } catch (error) {
      return '';
    }

    const now = typeof nowMs === 'number' ? nowMs : Date.now();
    const diffSeconds = Math.round((time - now) / 1000);
    if (Math.abs(diffSeconds) < 45) return formatter.format(0, 'second');

    for (const [unit, seconds] of RELATIVE_TIME_UNITS) {
      if (Math.abs(diffSeconds) >= seconds || unit === 'minute') {
        return formatter.format(Math.round(diffSeconds / seconds), /** @type {any} */ (unit));
      }
    }
    return '';
  }

  // Fingerprint of the fields that decide whether a past connection test
  // still applies. A trailing /v1 is ignored because the background may
  // toggle it automatically after a successful test.
  function buildConnectionSignature(settings, hashString) {
    const baseUrl = String(settings?.aiBaseURL || '')
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/v1$/i, '')
      .toLowerCase();
    const seed = [
      settings?.providerPreset,
      settings?.aiProvider,
      settings?.endpointMode,
      baseUrl,
      settings?.modelName,
      settings?.apiKey
    ].map((value) => String(value || '').trim()).join('␟');
    return typeof hashString === 'function' ? String(hashString(seed)) : seed;
  }

  // 'incomplete' | 'unverified' | 'verified' | 'failed'
  function resolveConnectionState(settings, check, signature) {
    if (!String(settings?.apiKey || '').trim() || !String(settings?.modelName || '').trim()) {
      return 'incomplete';
    }
    if (!check || !signature || check.signature !== signature) return 'unverified';
    return check.ok ? 'verified' : 'failed';
  }

  function buildSnippet(record, maxChars) {
    const limit = maxChars || SNIPPET_MAX_CHARS;
    // Prefer the markdown so section headings can be dropped from the preview;
    // list and quote markers are stripped per line, before lines are joined.
    const markdown = String(record?.summaryMarkdown || '');
    const lines = markdown
      ? markdown.split('\n').filter((line) => !/^\s*#{1,6}\s/.test(line))
      : [String(record?.summaryPlainText || '')];
    const text = lines
      .map((line) => line.replace(/^\s*>\s?/, '').replace(/^\s*(?:[-+*]|\d+[.)])\s+/, ''))
      .join(' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*`~|]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length <= limit) return text;
    return text.slice(0, limit).replace(/\s+\S*$/, '') + '…';
  }

  function createHomeController(deps) {
    const $ = deps.$;
    const I18n = deps.i18n;
    const UiLabels = deps.uiLabels;
    const Domain = deps.domain;
    const runtimeSendMessage = deps.runtimeSendMessage;
    const getRuntimeErrorMessage = deps.getRuntimeErrorMessage;
    const queryTargetTab = deps.queryTargetTab;
    const isFileSchemeAllowed = deps.isFileSchemeAllowed;
    const findRecordForUrl = deps.findRecordForUrl;
    const getHomeContext = deps.getHomeContext;
    const activateTab = deps.activateTab;
    const openFullSettings = deps.openFullSettings;
    const closeWindow = deps.closeWindow;

    const state = {
      loaded: false,
      tab: null,
      page: classifyPageUrl(''),
      record: null,
      busy: ''
    };

    function uiLanguage() {
      return typeof I18n.getUILanguage === 'function' ? I18n.getUILanguage() : '';
    }

    function setText(id, text) {
      const node = $(id);
      if (node) node.textContent = text;
    }

    // Dynamic labels keep data-i18n pointed at the current key so a live
    // locale switch repaints the right message.
    function setI18nText(id, key) {
      const node = $(id);
      if (!node) return;
      node.setAttribute('data-i18n', key);
      node.textContent = I18n.get(key);
    }

    function setFeedback(text, tone) {
      const node = $('homeFeedback');
      if (!node) return;
      node.textContent = text || '';
      node.className = 'home-feedback' + (tone ? ' ' + tone : '');
      node.hidden = !text;
    }

    function renderFavicon() {
      const img = /** @type {HTMLImageElement | null} */ ($('homePageFavicon'));
      const fallback = $('homePageFaviconFallback');
      const iconUrl = String(state.tab?.favIconUrl || '');
      const usable = /^(https?:|data:image\/)/i.test(iconUrl);
      const letter = (state.page.host || state.tab?.title || '·').replace(/^www\./, '').trim().charAt(0).toUpperCase() || '·';

      if (fallback) fallback.textContent = letter;
      if (!img) return;
      if (!usable) {
        img.hidden = true;
        img.removeAttribute('src');
        if (fallback) fallback.hidden = false;
        return;
      }
      img.onload = () => {
        img.hidden = false;
        if (fallback) fallback.hidden = true;
      };
      img.onerror = () => {
        img.hidden = true;
        if (fallback) fallback.hidden = false;
      };
      if (img.getAttribute('src') !== iconUrl) img.src = iconUrl;
    }

    function renderPage() {
      const card = $('homePageCard');
      if (!card) return;

      if (!state.loaded) {
        card.dataset.state = 'loading';
        setI18nText('homePageTitle', 'popup_home_loading_page');
        setText('homePageHost', '');
        return;
      }

      const page = state.page;
      card.dataset.state = page.supported ? 'ready' : 'unsupported';

      const titleNode = $('homePageTitle');
      if (titleNode) {
        const tabTitle = String(state.tab?.title || '').trim();
        if (tabTitle || page.supported) {
          titleNode.removeAttribute('data-i18n');
          titleNode.textContent = tabTitle || page.host || page.url || I18n.get('popup_home_untitled');
        } else {
          setI18nText('homePageTitle', 'popup_home_protected_title');
        }
        titleNode.title = titleNode.textContent;
      }
      setText('homePageHost', page.host || '');

      const kindNode = $('homePageKind');
      const kindKey = PAGE_KIND_KEYS[page.kind];
      if (kindNode) {
        kindNode.hidden = !kindKey || !page.supported;
        if (kindKey) setI18nText('homePageKind', kindKey);
      }

      const noteNode = $('homePageNote');
      if (noteNode) {
        const reasonKey = page.supported ? '' : (UNSUPPORTED_REASON_KEYS[page.reason] || UNSUPPORTED_REASON_KEYS.unknown);
        noteNode.hidden = !reasonKey;
        if (reasonKey) setI18nText('homePageNote', reasonKey);
      }

      renderFavicon();
      renderHistory();
    }

    function renderHistory() {
      const block = $('homeHistory');
      if (!block) return;
      const record = state.record;
      block.hidden = !record;
      if (!record) return;

      const time = formatRelativeTime(record.completedAt || record.updatedAt || record.createdAt, uiLanguage());
      const mode = UiLabels?.getSummaryModeLabel ? UiLabels.getSummaryModeLabel(record.summaryMode) : '';
      setText('homeHistoryMeta', I18n.get('popup_home_history_meta', [time || '—', mode || '']));
      setText('homeHistorySnippet', buildSnippet(record));
    }

    function renderSetup(context) {
      const setup = $('homeSetup');
      if (!setup) return;
      setup.hidden = context.configured;
      Array.from(global.document?.querySelectorAll('[data-setup-step]') || []).forEach((node) => {
        const step = node.getAttribute('data-setup-step') || '';
        node.classList.toggle('done', !!context.steps?.[step]);
      });
    }

    function renderAction() {
      const context = getHomeContext();
      renderSetup(context);

      const button = /** @type {HTMLButtonElement | null} */ ($('homeSummarizeBtn'));
      const quick = $('homeQuick');
      if (button) button.hidden = !context.configured;
      if (quick) quick.hidden = !context.configured;

      // The label promises exactly what the sidebar will do with the
      // entrypoint settings: show the saved summary, start one, or just open.
      const reuse = !!(state.record && context.reuseHistory);
      const labelKey = state.busy === 'summary'
        ? 'popup_home_opening'
        : reuse ? 'popup_home_open_summary'
          : context.autoStart === false ? 'popup_home_open_sidebar' : 'popup_home_summarize';
      if (button) {
        button.disabled = !context.ready || !state.loaded || !state.page.supported || !!state.busy;
        button.classList.toggle('is-busy', state.busy === 'summary');
        button.dataset.mode = reuse ? 'reuse' : 'summarize';
      }
      setI18nText('homeSummarizeLabel', labelKey);

      const historyButton = /** @type {HTMLButtonElement | null} */ ($('historyBtn'));
      if (historyButton) {
        historyButton.disabled = !state.loaded || !state.page.supported || !!state.busy;
      }
    }

    // `summary` comes from popup.js: { state, model, detail }.
    function renderConnection(summary) {
      const dot = $('homeConnectionDot');
      if (dot) dot.dataset.state = summary?.state || 'incomplete';
      setText('homeModelName', summary?.model || I18n.get('popup_hero_model_empty'));
      setText('homeConnectionText', summary?.detail || '');
    }

    function render() {
      renderPage();
      renderAction();
    }

    function describeTriggerFailure(response) {
      const key = TRIGGER_FAILURE_KEYS[response?.reason];
      if (key) return I18n.get(key);
      return getRuntimeErrorMessage(response?.error) || I18n.get('popup_home_error_generic');
    }

    async function runPageAction(kind, message, successKey) {
      if (state.busy || !state.page.supported) return;
      state.busy = kind;
      setFeedback('', '');
      renderAction();

      const response = await runtimeSendMessage(message);
      if (response?.success) {
        // The sidebar now owns the page; closing gets the popup out of its way.
        if (closeWindow()) return;
        state.busy = '';
        renderAction();
        setFeedback(I18n.get(successKey), 'success');
        return;
      }

      state.busy = '';
      renderAction();
      setFeedback(describeTriggerFailure(response), 'error');
    }

    // Both actions target the tab this view rendered, not whichever tab is
    // active by the time the background handles the message.
    function summarize() {
      return runPageAction('summary', { action: 'triggerSummary', tabId: state.tab?.id }, 'popup_home_opened');
    }

    function openHistory() {
      return runPageAction('history', { action: 'triggerHistory', tabId: state.tab?.id }, 'popup_history_opened');
    }

    // Open the popup, press Enter: keyboard users get the primary action
    // without tabbing through the rail. Never steals focus the user placed.
    function focusPrimaryAction() {
      const button = $('homeSummarizeBtn');
      const active = global.document?.activeElement;
      if (!button || button.disabled || button.hidden) return;
      if (active && active !== global.document.body) return;
      button.focus?.({ preventScroll: true });
    }

    async function load() {
      let tab = null;
      try {
        tab = await queryTargetTab();
      } catch (error) {
        tab = null;
      }

      state.tab = tab;
      let page = classifyPageUrl(tab?.url || tab?.pendingUrl || '', Domain);
      if (tab && !tab.url && !tab.pendingUrl) {
        // Host permissions expose the URL of every page the content script
        // could run on; a hidden URL means a protected browser page.
        page = Object.assign({}, page, { reason: 'browser' });
      }
      if (page.kind === 'file' && page.supported) {
        let allowed = true;
        try {
          allowed = await isFileSchemeAllowed();
        } catch (error) {
          allowed = true;
        }
        if (!allowed) page = Object.assign({}, page, { supported: false, reason: 'file' });
      }
      state.page = page;
      state.loaded = true;
      render();
      focusPrimaryAction();

      if (!page.supported || !findRecordForUrl) return;
      try {
        const match = await findRecordForUrl(page.url);
        state.record = match?.record || null;
      } catch (error) {
        state.record = null;
      }
      render();
    }

    function bindControls() {
      $('homeSummarizeBtn')?.addEventListener('click', () => {
        summarize().catch(() => {});
      });
      $('historyBtn')?.addEventListener('click', () => {
        openHistory().catch(() => {});
      });
      $('homeConnectionRow')?.addEventListener('click', () => activateTab('connection'));
      $('homeSetupBtn')?.addEventListener('click', () => activateTab('connection', { focusFirstMissing: true }));
      $('homeSetupTabBtn')?.addEventListener('click', () => openFullSettings('connection'));
    }

    return {
      state,
      load,
      render,
      renderAction,
      renderConnection,
      bindControls,
      summarize,
      openHistory,
      getTargetTabId: () => state.tab?.id
    };
  }

  const api = {
    SNIPPET_MAX_CHARS,
    classifyPageUrl,
    formatRelativeTime,
    buildConnectionSignature,
    resolveConnectionState,
    buildSnippet,
    createHomeController
  };

  global.YilanPopupHome = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

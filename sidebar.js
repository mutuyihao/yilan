const Domain = window.AISummaryDomain;
const Strings = window.AISummaryStrings;
const AbortUtils = window.AISummaryAbortUtils;
const Errors = window.AISummaryErrors;
const ArticleUtils = window.AISummaryArticle;
const DiagnosticsView = window.AISummaryDiagnosticsView;
const Trust = window.AISummaryTrust;
const RunUtils = window.AISummaryRunUtils;
const SidebarMetaView = window.AISummarySidebarMetaView;
const Theme = window.AISummaryTheme;
const UiFormat = window.AISummaryUiFormat;
const UiLabels = window.AISummaryUiLabels;
const SummaryText = window.AISummarySummaryText;
const ReaderView = window.AISummaryReaderView;
const HistoryView = window.AISummaryHistoryView;
const SidebarHistory = window.YilanSidebarHistory;
const recordStore = window.db;

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
  'entrypointSimpleMode',
  'entrypointReuseHistory'
];

const NAVIGATION_DURING_GENERATION = {
  DEFER: 'defer',
  REPLACE: 'replace',
  IGNORE: 'ignore'
};

const DEFAULT_NAVIGATION_POLICY = {
  autoStartOnNavigation: false,
  duringGeneration: NAVIGATION_DURING_GENERATION.DEFER
};

const markdownToPlainText = SummaryText.markdownToPlainText;
const stripMarkdownPreview = SummaryText.stripMarkdownPreview;
const extractBullets = SummaryText.extractBullets;
const buildReaderSnapshot = ReaderView.buildReaderSnapshot;
const buildHistoryItemView = HistoryView.buildHistoryItemView;
const buildHistoryGroupView = HistoryView.buildHistoryGroupView;
const buildDiagnosticsPanelModel = DiagnosticsView.buildDiagnosticsPanelModel;
const buildCancelledStateModel = DiagnosticsView.buildCancelledStateModel;
const buildArticleMetaView = SidebarMetaView.buildArticleMetaView;
const buildTrustCardView = SidebarMetaView.buildTrustCardView;
let historyController = null;

const state = {
  article: null,
  visibleRecord: null,
  visibleRecordUsesCurrentArticle: false,
  summaryMarkdown: '',
  generating: false,
  cancelRequested: false,
  runAbortController: null,
  activeRunIds: new Set(),
  activePort: null,
  activeStreamRunId: '',
  lastDiagnostics: null,
  historyQuery: '',
  favoritesOnly: false,
  selectedSiteHost: '',
  summaryModeMenuOpen: false,
  autoScroll: true,
  pendingNavigationPayload: null,
  settings: Object.assign({}, Trust.DEFAULT_SETTINGS),
  trustPolicy: Trust.buildTrustPolicy(null, Trust.DEFAULT_SETTINGS)
};

const elements = {
  articleTitle: document.getElementById('articleTitle'),
  sourceLink: document.getElementById('sourceLink'),
  hostBadge: document.getElementById('hostBadge'),
  siteTypeBadge: document.getElementById('siteTypeBadge'),
  strategyBadge: document.getElementById('strategyBadge'),
  modeBadge: document.getElementById('modeBadge'),
  authorValue: document.getElementById('authorValue'),
  publishedValue: document.getElementById('publishedValue'),
  lengthValue: document.getElementById('lengthValue'),
  chunkValue: document.getElementById('chunkValue'),
  warningList: document.getElementById('warningList'),
  trustTitle: document.getElementById('trustTitle'),
  trustSummary: document.getElementById('trustSummary'),
  trustModeBadge: document.getElementById('trustModeBadge'),
  trustHistoryBadge: document.getElementById('trustHistoryBadge'),
  trustShareBadge: document.getElementById('trustShareBadge'),
  trustSendValue: document.getElementById('trustSendValue'),
  trustSendNote: document.getElementById('trustSendNote'),
  trustHistoryValue: document.getElementById('trustHistoryValue'),
  trustHistoryNote: document.getElementById('trustHistoryNote'),
  trustShareValue: document.getElementById('trustShareValue'),
  trustShareNote: document.getElementById('trustShareNote'),
  privacyToggleBtn: document.getElementById('privacyToggleBtn'),
  summaryModeTrigger: document.getElementById('summaryModeTrigger'),
  summaryModeCurrentLabel: document.getElementById('summaryModeCurrentLabel'),
  summaryModeMenu: document.getElementById('summaryModeMenu'),
  summaryModeSelect: document.getElementById('summaryModeSelect'),
  regenerateBtn: document.getElementById('regenerateBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  favoriteBtn: document.getElementById('favoriteBtn'),
  copyBtn: document.getElementById('copyBtn'),
  shareBtn: document.getElementById('shareBtn'),
  exportBtn: document.getElementById('exportBtn'),
  contentPanel: document.getElementById('content'),
  summaryRoot: document.getElementById('summaryRoot'),
  diagnosticsBlock: document.getElementById('diagnosticsBlock'),
  diagnosticsToggle: document.getElementById('diagnosticsToggle'),
  diagnosticsPre: document.getElementById('diagnosticsPre'),
  statusText: document.getElementById('statusText'),
  statsText: document.getElementById('statsText'),
  historyPanel: document.getElementById('historyPanel'),
  readerBtn: document.getElementById('readerBtn'),
  historyBtn: document.getElementById('historyBtn'),
  themeBtn: document.getElementById('themeBtn'),
  historyCloseBtn: document.getElementById('historyCloseBtn'),
  historySearch: document.getElementById('historySearch'),
  favoritesOnly: document.getElementById('favoritesOnly'),
  historySiteFilters: document.getElementById('historySiteFilters'),
  historyList: document.getElementById('historyList'),
  closeBtn: document.getElementById('closeBtn')
};

marked.setOptions({
  breaks: true,
  gfm: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  }
});

const MARKDOWN_SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['class', 'target', 'rel', 'align']
};

function renderSanitizedMarkdownFragment(container, markdown) {
  const fragment = DOMPurify.sanitize(marked.parse(markdown || ''), {
    ...MARKDOWN_SANITIZE_OPTIONS,
    RETURN_DOM_FRAGMENT: true
  });
  container.replaceChildren(fragment);
}

function sanitizeMarkdownToHtml(markdown) {
  return DOMPurify.sanitize(marked.parse(markdown || ''), MARKDOWN_SANITIZE_OPTIONS);
}

let renderScheduled = false;
let renderTimeoutId = 0;
let renderFrameId = 0;
let lastMarkdownRenderAt = 0;
const STREAM_RENDER_INTERVAL_MS = 90;

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (items) => resolve(items || {}));
  });
}

function storageSet(payload) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(payload, resolve);
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

async function loadRuntimeSettings() {
  const rawSettings = await storageGet(SETTINGS_KEYS);
  const trustSettings = Trust.normalizeSettings(rawSettings);
  state.settings = Object.assign({
    entrypointAutoStart: true,
    entrypointSimpleMode: false,
    entrypointReuseHistory: true
  }, rawSettings, trustSettings);
  return state.settings;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function beginRunAbortController() {
  state.runAbortController = new AbortController();
  return state.runAbortController.signal;
}

function abortCurrentRun(reason) {
  if (!state.runAbortController || state.runAbortController.signal.aborted) return;
  try {
    state.runAbortController.abort(reason || 'user');
  } catch {}
}

function clearRunAbortController() {
  state.runAbortController = null;
}

function createCancelledUiError(meta, runId) {
  return normalizeUiError(Errors.createError(Errors.ERROR_CODES.RUN_CANCELLED, {
    stage: meta?.stage || '',
    diagnostics: {
      runId: runId || '',
      stage: meta?.stage || '',
      status: 'cancelled',
      chunkIndex: typeof meta?.chunkIndex === 'number' ? meta.chunkIndex : null,
      chunkCount: typeof meta?.chunkCount === 'number' ? meta.chunkCount : null,
      articleId: meta?.articleId || ''
    }
  }));
}

const escapeHtml = UiFormat.escapeHtml;
const formatDateTime = (value) => UiFormat.formatDateTime(value, { emptyText: '-' });

function getModeLabel(mode) {
  return UiLabels.getSummaryModeLabel(mode, { fallback: '\u6807\u51c6\u603b\u7ed3' });
}

function getSummaryModeOptions() {
  return ArticleUtils.getSummaryModeOptions();
}

function getSafeSummaryMode(mode) {
  const options = getSummaryModeOptions();
  const matched = options.find((item) => item.value === mode);
  return matched?.value || options[0]?.value || 'medium';
}

function setSummaryModeMenuOpen(open) {
  state.summaryModeMenuOpen = !!open;
  elements.summaryModeMenu.classList.toggle('hidden', !state.summaryModeMenuOpen);
  elements.summaryModeTrigger.classList.toggle('open', state.summaryModeMenuOpen);
  elements.summaryModeTrigger.setAttribute('aria-expanded', state.summaryModeMenuOpen ? 'true' : 'false');
}

function syncSummaryModeControl() {
  const value = getSafeSummaryMode(elements.summaryModeSelect.value);
  elements.summaryModeCurrentLabel.textContent = getModeLabel(value);

  elements.summaryModeMenu.querySelectorAll('.mode-option').forEach((button) => {
    const active = button.dataset.value === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function setSummaryModeControlValue(mode) {
  const nextMode = getSafeSummaryMode(mode);
  elements.summaryModeSelect.value = nextMode;
  syncSummaryModeControl();
  return nextMode;
}

function focusActiveSummaryModeOption() {
  const activeOption = elements.summaryModeMenu.querySelector('.mode-option.active') || elements.summaryModeMenu.querySelector('.mode-option');
  activeOption?.focus();
}

function getProviderLabel(provider) {
  return UiLabels.getProviderLabel(provider, { fallback: '\u672a\u77e5' });
}

function getRecordStatusLabel(status) {
  return UiLabels.getRecordStatusLabel(status, { fallback: '\u5df2\u5b8c\u6210' });
}

function getStrategyLabel(sourceStrategy, sourceType) {
  return UiLabels.getStrategyLabel(sourceStrategy, sourceType);
}

function getTargetLanguage(settings, article) {
  if (!settings.autoTranslate) return 'auto';
  return settings.defaultLanguage || article?.language || 'zh';
}

function withCustomPrompt(prompt, settings) {
  const custom = String(settings.systemPrompt || '').trim();
  if (!custom) return prompt;
  return [
    '\u4ee5\u4e0b\u662f\u7528\u6237\u7684\u989d\u5916\u8981\u6c42\uff0c\u8bf7\u4f18\u5148\u9075\u5b88\u3002',
    custom,
    '---',
    prompt
  ].join('\\n\\n');
}

function setStatus(text, tone) {
  elements.statusText.textContent = text || '\u5c31\u7eea';
  elements.statusText.className = 'status-text';
  if (tone === 'success') elements.statusText.classList.add('status-success');
  if (tone === 'warning') elements.statusText.classList.add('status-warning');
  if (tone === 'error') elements.statusText.classList.add('status-error');
  elements.statusText.classList.toggle('status-active', state.generating);
}

function setStats(text) {
  elements.statsText.textContent = text || '';
}

function getShareCardThemePalette() {
  const theme = Theme.getCurrentTheme();
  if (theme === 'light') {
    return {
      background: 'linear-gradient(180deg, #fffaf4 0%, #f1f6fb 100%)',
      canvasBackground: '#fffaf4',
      text: '#173043',
      heading: '#102a3b',
      shadow: '0 30px 80px rgba(127, 99, 58, 0.18)',
      subtitle: '#62798b',
      badgeBackground: 'rgba(21, 47, 69, 0.06)',
      badgeText: '#355b76',
      sourceBackground: 'rgba(21, 47, 69, 0.04)',
      sourceBorder: 'rgba(103, 126, 147, 0.14)',
      accent: '#128a74',
      accentText: '#0f6f5e',
      quoteBackground: 'rgba(18, 138, 116, 0.08)',
      quotePanelBackground: 'linear-gradient(135deg, rgba(18, 138, 116, 0.12), rgba(90, 149, 232, 0.07))',
      quotePanelBorder: 'rgba(18, 138, 116, 0.16)',
      quotePanelText: '#23465b',
      quotePanelLabel: '#40677f',
      quoteMark: 'rgba(18, 138, 116, 0.22)',
      codeBackground: 'rgba(21, 47, 69, 0.06)',
      codeText: '#2a6e9a',
      divider: 'rgba(103, 126, 147, 0.16)',
      brandGradient: 'linear-gradient(135deg, #1fa08a, #5a95e8)',
      brandInk: '#fffaf3'
    };
  }

  return {
    background: 'linear-gradient(180deg, #06131f 0%, #0b1b2b 100%)',
    canvasBackground: '#06131f',
    text: '#eff7ff',
    heading: '#f7fcff',
    shadow: '0 30px 80px rgba(1, 8, 14, 0.34)',
    subtitle: '#8eb0c6',
    badgeBackground: 'rgba(255,255,255,0.06)',
    badgeText: '#cfe7f8',
    sourceBackground: 'rgba(255,255,255,0.04)',
    sourceBorder: 'rgba(255,255,255,0.08)',
    accent: '#3ec0a0',
    accentText: '#76f0d1',
    quoteBackground: 'rgba(62,192,160,0.08)',
    quotePanelBackground: 'linear-gradient(135deg, rgba(62,192,160,0.14), rgba(83,144,241,0.08))',
    quotePanelBorder: 'rgba(62,192,160,0.14)',
    quotePanelText: '#dfeffb',
    quotePanelLabel: '#90b8cd',
    quoteMark: 'rgba(118, 240, 209, 0.18)',
    codeBackground: 'rgba(255,255,255,0.06)',
    codeText: '#a7d0ff',
    divider: 'rgba(255,255,255,0.1)',
    brandGradient: 'linear-gradient(135deg, #3ec0a0, #5390f1)',
    brandInk: '#06131f'
  };
}

function updateStatsFromMarkdown(markdown, article) {
  const plainLength = markdownToPlainText(markdown || '').length;
  const parts = [];
  if (plainLength) parts.push(plainLength + ' \u5b57');
  if (article?.chunkCount > 1) parts.push(article.chunkCount + ' \u6bb5');
  setStats(parts.join(' \u00b7 '));
}

function highlightBlocks(root) {
  root.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block);
  });
}

function getNowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function cancelScheduledMarkdownRender() {
  if (renderTimeoutId) {
    clearTimeout(renderTimeoutId);
    renderTimeoutId = 0;
  }
  if (renderFrameId) {
    cancelAnimationFrame(renderFrameId);
    renderFrameId = 0;
  }
  renderScheduled = false;
}

function scheduleMarkdownRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  const delay = Math.max(0, STREAM_RENDER_INTERVAL_MS - (getNowMs() - lastMarkdownRenderAt));
  renderTimeoutId = window.setTimeout(() => {
    renderTimeoutId = 0;
    renderFrameId = requestAnimationFrame(() => {
      renderFrameId = 0;
      renderScheduled = false;
      lastMarkdownRenderAt = getNowMs();
      renderMarkdown(state.summaryMarkdown, { highlight: false, clearPending: false });
      updateStatsFromMarkdown(state.summaryMarkdown, state.article);
      if (state.autoScroll) {
        elements.summaryRoot.scrollTop = elements.summaryRoot.scrollHeight;
      }
    });
  }, delay);
}

function renderMarkdown(markdown, options) {
  if (options?.clearPending !== false) {
    cancelScheduledMarkdownRender();
  }
  elements.summaryRoot.className = 'summary-root markdown-body';
  renderSanitizedMarkdownFragment(elements.summaryRoot, markdown);
  if (options?.highlight !== false) {
    highlightBlocks(elements.summaryRoot);
  }
}

function renderPlaceholder(title, detail) {
  cancelScheduledMarkdownRender();
  elements.summaryRoot.className = 'summary-root summary-placeholder';
  elements.summaryRoot.innerHTML = [
    '<div class="placeholder-icon">\u89c8</div>',
    '<h2>' + escapeHtml(title) + '</h2>',
    '<p>' + escapeHtml(detail) + '</p>'
  ].join('');
}

function renderInlineNote(title, detail, extraHtml) {
  cancelScheduledMarkdownRender();
  const busyHtml = state.generating
    ? [
        '<span class="inline-note-badge" aria-hidden="true">',
        '<span class="inline-note-badge-dots"><span></span><span></span><span></span></span>',
        '<span>\u5904\u7406\u4e2d</span>',
        '</span>'
      ].join('')
    : '';
  const loaderHtml = state.generating
    ? '<div class="inline-note-loader" aria-hidden="true"><span></span><span></span><span></span></div>'
    : '';
  elements.summaryRoot.className = 'summary-root';
  elements.summaryRoot.innerHTML = [
    '<div class="inline-note' + (state.generating ? ' inline-note-busy' : '') + '">',
    '<div class="inline-note-head">',
    '<strong>' + escapeHtml(title) + '</strong>',
    busyHtml,
    '</div>',
    '<div class="inline-note-body">' + escapeHtml(detail) + '</div>',
    loaderHtml,
    extraHtml || '',
    '</div>'
  ].join('');
}

function renderErrorBox(error) {
  cancelScheduledMarkdownRender();
  const detail = error.detail ? '<div style="margin-top:8px;opacity:.82">' + escapeHtml(error.detail) + '</div>' : '';
  elements.summaryRoot.className = 'summary-root';
  elements.summaryRoot.innerHTML = [
    '<div class="error-box">',
    '<strong>' + escapeHtml(error.message || '\u751f\u6210\u5931\u8d25') + '</strong>',
    detail,
    '</div>'
  ].join('');
}

function getRecordUiError(record) {
  if (record?.diagnostics?.error) {
    return normalizeUiError(record.diagnostics.error);
  }

  return normalizeUiError({
    code: record?.errorCode || (record?.status === 'cancelled' ? Errors.ERROR_CODES.RUN_CANCELLED : Errors.ERROR_CODES.UNKNOWN_ERROR),
    message: record?.errorMessage || (record?.status === 'cancelled' ? '\u672c\u6b21\u751f\u6210\u5df2\u53d6\u6d88\u3002' : '\u751f\u6210\u5931\u8d25\u3002')
  });
}

function renderCancelledState(record, errorLike, diagnostics) {
  cancelScheduledMarkdownRender();
  const safeDiagnostics = diagnostics || state.lastDiagnostics || null;
  const safeError = normalizeUiError(errorLike || Errors.createError(Errors.ERROR_CODES.RUN_CANCELLED));
  const cancelledView = buildCancelledStateModel(record, safeDiagnostics, state.summaryMarkdown);
  const partial = cancelledView.partial;
  const info = cancelledView.info;
  const detail = safeError.detail && safeError.detail !== safeError.message
    ? '<div class="cancelled-detail">' + escapeHtml(safeError.detail) + '</div>'
    : '';
  const partialHtml = partial.hasPartialContent
    ? [
        '<div class="cancelled-content-card">',
        '<div class="cancelled-content-head">\u53d6\u6d88\u524d\u5df2\u751f\u6210\u5185\u5bb9</div>',
        '<div class="markdown-body cancelled-content-body">' + sanitizeMarkdownToHtml(partial.markdown || '') + '</div>',
        '</div>'
      ].join('')
    : '';

  elements.summaryRoot.className = 'summary-root';
  elements.summaryRoot.innerHTML = [
    '<div class="cancelled-box">',
    '<strong>' + escapeHtml(info.title) + '</strong>',
    '<div class="cancelled-description">' + escapeHtml(info.detail) + '</div>',
    cancelledView.facts.length ? '<ul class="cancelled-meta-list">' + cancelledView.facts.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul>' : '',
    detail,
    '</div>',
    partialHtml
  ].join('');

  highlightBlocks(elements.summaryRoot);
}

function renderChunkProgress(completed, total, partialSummaries) {
  const recent = partialSummaries.slice(-2).map((item) => {
    return '<li>' + escapeHtml(stripMarkdownPreview(item, 140) || '\u5206\u6bb5\u5904\u7406\u5b8c\u6210') + '</li>';
  }).join('');

  renderInlineNote(
    '\u6b63\u5728\u5206\u6bb5\u603b\u7ed3\u957f\u6587',
    '\u5df2\u5b8c\u6210 ' + completed + '/' + total + ' \u4e2a\u5206\u6bb5\uff0c\u6b63\u5728\u6574\u7406\u4e2d\u3002',
    recent ? '<ul style="margin-top:10px">' + recent + '</ul>' : ''
  );
}

function createArticleFromRecord(record) {
  const snapshot = record?.articleSnapshot || {};
  return {
    articleId: record?.articleId || snapshot.articleId || '',
    canonicalUrl: snapshot.canonicalUrl || '',
    normalizedUrl: record?.normalizedUrl || snapshot.normalizedUrl || '',
    sourceUrl: record?.sourceUrl || snapshot.sourceUrl || '',
    sourceHost: record?.sourceHost || snapshot.sourceHost || Domain.getSourceHost(record?.normalizedUrl || record?.sourceUrl || ''),
    sourceType: snapshot.sourceType || 'unknown',
    title: record?.titleSnapshot || snapshot.title || '\u672a\u547d\u540d\u9875\u9762',
    subtitle: snapshot.subtitle || '',
    excerpt: snapshot.excerpt || '',
    author: snapshot.author || '',
    siteName: snapshot.siteName || snapshot.sourceHost || record?.sourceHost || '',
    publishedAt: snapshot.publishedAt || '',
    language: record?.languageSnapshot || snapshot.language || '',
    rawText: snapshot.rawText || '',
    cleanText: snapshot.cleanText || '',
    content: snapshot.content || snapshot.cleanText || '',
    contentHash: record?.contentHash || snapshot.contentHash || '',
    extractor: snapshot.extractor || '',
    contentLength: snapshot.contentLength || 0,
    isTruncated: !!snapshot.isTruncated,
    truncationReason: snapshot.truncationReason || '',
    chunkingStrategy: snapshot.chunkingStrategy || 'none',
    chunkCount: snapshot.chunkCount || 1,
    chunks: snapshot.chunks || [],
    sourceStrategy: snapshot.sourceStrategy || {
      strategyId: snapshot.sourceStrategyId || snapshot.sourceType || 'unknown',
      label: getStrategyLabel(snapshot.sourceStrategy, snapshot.sourceType),
      description: ''
    },
    preferredSummaryMode: snapshot.preferredSummaryMode || 'medium',
    allowHistory: snapshot.allowHistory !== false,
    allowShare: snapshot.allowShare !== false,
    diagnostics: snapshot.diagnostics || null,
    warnings: snapshot.warnings || [],
    qualityScore: snapshot.qualityScore || 0
  };
}

function setBadgeTone(element, tone) {
  if (!element) return;
  element.classList.remove('badge-accent', 'badge-soft', 'badge-success', 'badge-warning', 'badge-danger');
  if (tone) {
    element.classList.add('badge-' + tone);
  }
}

function renderTrustCard(article) {
  const trustView = buildTrustCardView(article, state.settings);
  state.trustPolicy = trustView.policy;

  elements.trustTitle.textContent = trustView.title;
  elements.trustSummary.textContent = trustView.summary;
  elements.trustModeBadge.textContent = trustView.modeBadge;
  elements.trustHistoryBadge.textContent = trustView.historyBadge;
  elements.trustShareBadge.textContent = trustView.shareBadge;
  elements.trustSendValue.textContent = trustView.sendValue;
  elements.trustSendNote.textContent = trustView.sendNote;
  elements.trustHistoryValue.textContent = trustView.historyValue;
  elements.trustHistoryNote.textContent = trustView.historyNote;
  elements.trustShareValue.textContent = trustView.shareValue;
  elements.trustShareNote.textContent = trustView.shareNote;
  elements.privacyToggleBtn.textContent = trustView.privacyToggleLabel;
  elements.privacyToggleBtn.classList.toggle('action-btn-primary', trustView.privacyTogglePrimary);

  setBadgeTone(elements.trustModeBadge, trustView.modeTone);
  setBadgeTone(elements.trustHistoryBadge, trustView.historyTone);
  setBadgeTone(elements.trustShareBadge, trustView.shareTone);
}

function renderArticleMeta(article, record) {
  const currentArticle = article || createArticleFromRecord(record);
  const modeKey = record?.summaryMode || elements.summaryModeSelect.value || 'medium';
  const safeModeKey = getSafeSummaryMode(modeKey);
  const metaView = buildArticleMetaView(currentArticle, {
    summaryMode: modeKey,
    simpleModeEnabled: !!state.settings?.entrypointSimpleMode && safeModeKey === 'short'
  });

  elements.articleTitle.textContent = metaView.title;
  elements.sourceLink.textContent = metaView.sourceText;
  elements.sourceLink.href = metaView.sourceHref;
  elements.hostBadge.textContent = metaView.hostLabel;
  elements.siteTypeBadge.textContent = metaView.siteTypeLabel;
  elements.strategyBadge.textContent = metaView.strategyLabel;
  elements.modeBadge.textContent = metaView.modeLabel;
  elements.authorValue.textContent = metaView.authorLabel;
  elements.publishedValue.textContent = metaView.publishedLabel;
  elements.lengthValue.textContent = metaView.lengthLabel;
  elements.chunkValue.textContent = metaView.chunkLabel;
  elements.warningList.innerHTML = metaView.warnings.map((item) => '<span class="warning-chip">' + escapeHtml(item) + '</span>').join('');
  renderTrustCard(currentArticle);
}

function composeDiagnostics(article, chunkRuns, finalRun, error) {
  const resolvedFinalRun = RunUtils.pickTerminalRun(finalRun, error);
  const allRuns = [...(chunkRuns || []), resolvedFinalRun].filter(Boolean);
  const retryCount = allRuns.reduce((sum, item) => sum + (item.retryCount || 0), 0);
  const durationMs = allRuns.reduce((sum, item) => sum + (item.durationMs || 0), 0);

  return {
    article: article ? {
      articleId: article.articleId,
      sourceHost: article.sourceHost,
      sourceType: article.sourceType,
      sourceStrategyId: article.sourceStrategy?.strategyId || '',
      sourceStrategyLabel: article.sourceStrategy?.label || '',
      extractor: article.extractor,
      qualityScore: article.qualityScore,
      warnings: article.warnings,
      contentLength: article.contentLength,
      chunkCount: article.chunkCount,
      chunkingStrategy: article.chunkingStrategy,
      isTruncated: article.isTruncated,
      truncationReason: article.truncationReason,
      extractedAt: article.extractedAt,
      diagnostics: article.diagnostics || null
    } : null,
    provider: resolvedFinalRun?.provider || chunkRuns?.[0]?.provider || '',
    adapterId: resolvedFinalRun?.adapterId || chunkRuns?.[0]?.adapterId || '',
    endpointMode: resolvedFinalRun?.endpointMode || chunkRuns?.[0]?.endpointMode || '',
    model: resolvedFinalRun?.model || chunkRuns?.[0]?.model || '',
    runId: resolvedFinalRun?.runId || chunkRuns?.[0]?.runId || '',
    retryCount,
    durationMs,
    chunkRuns: chunkRuns || [],
    finalRun: resolvedFinalRun || null,
    error: error || null
  };
}

function renderDiagnostics() {
  const diagnosticsView = buildDiagnosticsPanelModel(state.visibleRecord, state.lastDiagnostics, state.summaryMarkdown);

  if (elements.diagnosticsToggle) {
    elements.diagnosticsToggle.textContent = diagnosticsView.toggleLabel;
    elements.diagnosticsToggle.title = diagnosticsView.toggleLabel;
  }

  if (diagnosticsView.shouldAutoOpen) {
    elements.diagnosticsBlock.open = true;
  }

  elements.diagnosticsPre.textContent = state.lastDiagnostics
    ? diagnosticsView.summaryText + '\n\n--- \u539f\u59cb\u8bca\u65ad JSON ---\n' + JSON.stringify(state.lastDiagnostics, null, 2)
    : diagnosticsView.summaryText;
}

function createDraftRecord(article, settings, summaryMode, promptProfile, extra) {
  const now = new Date().toISOString();
  const targetLanguage = getTargetLanguage(settings, article);
  const trustPolicy = Trust.buildTrustPolicy(article, settings);
  const record = {
    recordId: Domain.createRuntimeId('sum'),
    articleId: article.articleId,
    parentRecordId: extra?.parentRecordId || '',
    runId: Domain.createRuntimeId('run'),
    createdAt: now,
    updatedAt: now,
    sourceUrl: article.sourceUrl,
    normalizedUrl: article.normalizedUrl,
    sourceHost: article.sourceHost,
    titleSnapshot: article.title,
    languageSnapshot: article.language,
    contentHash: article.contentHash,
    articleSnapshot: article,
    summaryMode,
    targetLanguage,
    promptProfile,
    customPromptUsed: !!String(settings.systemPrompt || '').trim(),
    promptVersion: '2026-03-25',
    adapterId: '',
    provider: settings.aiProvider || 'openai',
    model: settings.modelName || '',
    endpointMode: '',
    requestOptionsSnapshot: {
      sourceType: article.sourceType,
      sourceStrategyId: article.sourceStrategy?.strategyId || '',
      chunkCount: article.chunkCount,
      autoTranslate: !!settings.autoTranslate,
      privacyMode: trustPolicy.privacyMode,
      allowHistory: trustPolicy.allowHistory,
      allowShare: trustPolicy.allowShare
    },
    privacyMode: trustPolicy.privacyMode,
    allowHistory: trustPolicy.allowHistory,
    allowShare: trustPolicy.allowShare,
    retentionHint: trustPolicy.retentionHint,
    status: 'running',
    startedAt: now,
    completedAt: '',
    durationMs: 0,
    retryCount: 0,
    errorCode: '',
    errorMessage: '',
    finishReason: '',
    summaryMarkdown: '',
    summaryPlainText: '',
    summaryTitle: article.title,
    bullets: [],
    usage: null,
    shareCardTitle: article.title,
    shareCardSubtitle: getModeLabel(summaryMode),
    shareSourceUrl: article.normalizedUrl || article.sourceUrl,
    exportVariants: ['markdown', 'image'],
    favorite: false,
    tags: [],
    notes: '',
    lastViewedAt: now,
    diagnostics: null,
    originSummaryHash: extra?.originSummaryHash || ''
  };

  record.dedupeKey = recordStore.buildDedupeKey(record);
  return record;
}

function closeDiagnostics() {
  if (elements.diagnosticsBlock) {
    elements.diagnosticsBlock.open = false;
  }
}

function getHistoryController() {
  if (!historyController) {
    historyController = SidebarHistory.createHistoryController({
      elements,
      state,
      recordStore,
      renderPlaceholder,
      bindVisibleRecord,
      refreshActionStates,
      setStatus,
      closeDiagnostics,
      formatDateTime,
      escapeHtml,
      buildHistoryItemView,
      buildHistoryGroupView
    });
  }
  return historyController;
}

function finalizeRecord(baseRecord, updates) {
  const merged = Object.assign({}, baseRecord, updates || {});
  merged.summaryPlainText = merged.summaryPlainText || markdownToPlainText(merged.summaryMarkdown || '');
  merged.bullets = merged.bullets && merged.bullets.length ? merged.bullets : extractBullets(merged.summaryMarkdown || '');
  merged.updatedAt = new Date().toISOString();
  merged.dedupeKey = merged.dedupeKey || recordStore.buildDedupeKey(merged);
  return merged;
}

function normalizeUiError(errorLike) {
  return Errors.normalizeError(errorLike, errorLike?.code, errorLike);
}

function ensureArticleReady(article) {
  if (!article || !article.cleanText || article.cleanText.length < 120) {
    throw Errors.createError(Errors.ERROR_CODES.EXTRACTION_EMPTY, {
      detail: 'content_length=' + (article?.cleanText?.length || 0)
    });
  }
}

function refreshActionStates() {
  const hasArticle = !!state.article;
  const hasSummary = !!state.summaryMarkdown.trim();
  const allowShare = state.trustPolicy?.allowShare !== false;
  const canFavorite = !!state.visibleRecord && state.visibleRecord.allowHistory !== false;
  const processing = state.generating;

  elements.regenerateBtn.disabled = processing || !hasArticle;
  elements.cancelBtn.disabled = !processing || state.cancelRequested;
  elements.favoriteBtn.disabled = processing || !canFavorite;
  elements.readerBtn.disabled = !hasSummary;
  elements.copyBtn.disabled = !hasSummary;
  elements.shareBtn.disabled = !hasSummary || !allowShare;
  elements.exportBtn.disabled = !hasSummary;
  elements.privacyToggleBtn.disabled = processing;
  elements.statusText.classList.toggle('status-active', processing);
  elements.contentPanel.classList.toggle('content-panel-processing', processing);
  elements.cancelBtn.classList.toggle('action-btn-live', processing && !state.cancelRequested);

  document.querySelectorAll('.secondary-btn').forEach((button) => {
    button.disabled = processing || !hasSummary || !hasArticle;
  });

  updateFavoriteButton();
}

function bindVisibleRecord(record, options) {
  const preserveCurrentArticle = !!options?.preserveCurrentArticle && !!state.article;
  const displayArticle = preserveCurrentArticle ? state.article : createArticleFromRecord(record);

  state.visibleRecord = record;
  state.visibleRecordUsesCurrentArticle = preserveCurrentArticle;
  state.summaryMarkdown = record?.summaryMarkdown || '';
  state.article = displayArticle;
  renderArticleMeta(displayArticle, record);
  state.lastDiagnostics = record?.diagnostics || null;
  renderDiagnostics();

  if (record?.status === 'cancelled') {
    renderCancelledState(record, getRecordUiError(record), state.lastDiagnostics);
    if (state.summaryMarkdown.trim()) {
      updateStatsFromMarkdown(state.summaryMarkdown, displayArticle);
    } else {
      setStats('');
    }
  } else if (record?.status === 'failed') {
    renderErrorBox(getRecordUiError(record));
    setStats('');
  } else if (state.summaryMarkdown) {
    renderMarkdown(state.summaryMarkdown);
    updateStatsFromMarkdown(state.summaryMarkdown, displayArticle);
  } else {
    renderPlaceholder('\u6682\u65e0\u6458\u8981\u5185\u5bb9', '\u53ef\u4ee5\u91cd\u65b0\u751f\u6210\uff0c\u6216\u8005\u4ece\u5386\u53f2\u8bb0\u5f55\u91cc\u5207\u6362\u5176\u5b83\u6458\u8981\u3002');
    setStats('');
  }

  setStatus(
    record?.status === 'failed'
      ? (getRecordUiError(record).message || '\u751f\u6210\u5931\u8d25')
      : record?.status === 'cancelled'
        ? buildCancelledStateModel(record, state.lastDiagnostics, state.summaryMarkdown).statusText
        : '\u5df2\u52a0\u8f7d\u8bb0\u5f55',
    record?.status === 'failed' ? 'error' : record?.status === 'cancelled' ? 'warning' : ''
  );

  setSummaryModeControlValue(record?.summaryMode || 'medium');
  setSummaryModeMenuOpen(false);
  refreshActionStates();
}

function buildReusableRecordStatus(match) {
  const updatedAtLabel = formatDateTime(
    match?.record?.updatedAt || match?.record?.completedAt || match?.record?.createdAt || ''
  );
  const suffix = updatedAtLabel !== '-' ? '\uff08' + updatedAtLabel + '\uff09' : '';
  return '\u5df2\u52a0\u8f7d\u5f53\u524d\u9875\u9762\u7684\u5386\u53f2\u6458\u8981' + suffix + '\uff0c\u53ef\u70b9\u51fb\u201c\u91cd\u65b0\u751f\u6210\u201d\u66f4\u65b0\u5f53\u524d\u5185\u5bb9\u3002';
}

async function restoreReusableRecordForCurrentArticle(article) {
  const match = await recordStore.findReusableRecordForArticle(article);
  if (!match?.record) return false;

  bindVisibleRecord(match.record, { preserveCurrentArticle: true });
  setStatus(buildReusableRecordStatus(match), 'success');
  return true;
}

function normalizeNavigationPolicy(policy) {
  const rawDuringGeneration = String(policy?.duringGeneration || '').trim();
  const duringGeneration = rawDuringGeneration === NAVIGATION_DURING_GENERATION.IGNORE ||
    rawDuringGeneration === NAVIGATION_DURING_GENERATION.REPLACE ||
    rawDuringGeneration === NAVIGATION_DURING_GENERATION.DEFER
    ? rawDuringGeneration
    : DEFAULT_NAVIGATION_POLICY.duringGeneration;

  return {
    autoStartOnNavigation: policy?.autoStartOnNavigation === true,
    duringGeneration
  };
}

function createPendingNavigationPayload(message, navigationPolicy) {
  return {
    type: 'articleData',
    source: 'navigation',
    article: message.article,
    navigationPolicy
  };
}

function renderManualSummaryReadyState(triggeredByNavigation) {
  renderPlaceholder(
    '\u9875\u9762\u5df2\u5c31\u7eea',
    triggeredByNavigation
      ? '\u5df2\u5207\u6362\u5230\u65b0\u9875\u9762\uff0c\u4e0d\u4f1a\u81ea\u52a8\u5f00\u59cb\u603b\u7ed3\u3002\u70b9\u51fb\u201c\u91cd\u65b0\u751f\u6210\u201d\u540e\u624d\u4f1a\u8bf7\u6c42\u6a21\u578b\u3002'
      : '\u70b9\u51fb\u201c\u91cd\u65b0\u751f\u6210\u201d\u5f00\u59cb\u751f\u6210\u6458\u8981\uff0c\u6216\u5148\u5207\u6362\u6458\u8981\u6a21\u5f0f\u3002'
  );
  setStatus(triggeredByNavigation ? '\u7b49\u5f85\u624b\u52a8\u5f00\u59cb' : '\u5c31\u7eea');
  setStats('');
}

async function applyArticleDataPayload(message) {
  const triggeredByNavigation = message.source === 'navigation';
  const navigationPolicy = normalizeNavigationPolicy(message.navigationPolicy);

  getHistoryController().close();
  state.article = message.article;
  state.visibleRecord = null;
  state.visibleRecordUsesCurrentArticle = false;
  state.summaryMarkdown = '';

  let settings = state.settings || {};
  try {
    settings = await loadRuntimeSettings();
  } catch {}

  const entrypointAutoStart = settings.entrypointAutoStart !== false;
  const autoStart = triggeredByNavigation ? navigationPolicy.autoStartOnNavigation : entrypointAutoStart;
  const simpleMode = !!settings.entrypointSimpleMode;
  const reuseHistory = settings.entrypointReuseHistory !== false;
  const initialMode = simpleMode ? 'short' : (state.article?.preferredSummaryMode || 'medium');

  const suggestedMode = setSummaryModeControlValue(initialMode);
  setSummaryModeMenuOpen(false);
  renderArticleMeta(state.article, { summaryMode: suggestedMode });
  refreshActionStates();

  if (reuseHistory) {
    renderInlineNote('\u6b63\u5728\u68c0\u67e5\u5386\u53f2\u6458\u8981', '\u5982\u679c\u5f53\u524d\u9875\u9762\u5df2\u6709\u5df2\u5b8c\u6210\u6458\u8981\uff0c\u4f1a\u76f4\u63a5\u52a0\u8f7d\u6700\u8fd1\u4e00\u6b21\u8bb0\u5f55\u3002');
    setStatus('\u6b63\u5728\u68c0\u67e5\u5f53\u524d\u9875\u9762\u7684\u5386\u53f2\u6458\u8981...');
    setStats('');

    const restored = await restoreReusableRecordForCurrentArticle(state.article);
    if (restored) {
      return;
    }
  }

  if (!autoStart) {
    renderManualSummaryReadyState(triggeredByNavigation);
    return;
  }

  renderPlaceholder(
    '\u6b63\u5728\u8bfb\u53d6\u9875\u9762\u5185\u5bb9',
    simpleMode
      ? '\u5df2\u542f\u7528\u7b80\u5355\u603b\u7ed3\uff0c\u9a6c\u4e0a\u5f00\u59cb\u751f\u6210\u3002'
      : '\u9a6c\u4e0a\u5f00\u59cb\u751f\u6210\u5f53\u524d\u9875\u9762\u7684\u6458\u8981\u3002'
  );
  startPrimarySummary(suggestedMode).catch((error) => {
    const normalized = normalizeUiError(error);
    renderErrorBox(normalized);
    setStatus(normalized.message, 'error');
    refreshActionStates();
  });
}

async function handleArticleDataPayload(message) {
  const triggeredByNavigation = message.source === 'navigation';
  const navigationPolicy = normalizeNavigationPolicy(message.navigationPolicy);

  if (triggeredByNavigation && state.generating) {
    if (navigationPolicy.duringGeneration === NAVIGATION_DURING_GENERATION.IGNORE) {
      return;
    }

    if (navigationPolicy.duringGeneration === NAVIGATION_DURING_GENERATION.REPLACE) {
      state.pendingNavigationPayload = createPendingNavigationPayload(message, navigationPolicy);
      cancelGeneration().catch((error) => {
        console.error(error);
      });
      return;
    }

    // Default: keep the current run alive and apply only the latest SPA route after it settles.
    state.pendingNavigationPayload = createPendingNavigationPayload(message, navigationPolicy);
    return;
  }

  await applyArticleDataPayload(Object.assign({}, message, { navigationPolicy }));
}

async function applyPendingNavigationPayload() {
  if (state.generating || !state.pendingNavigationPayload) return;

  const pending = state.pendingNavigationPayload;
  state.pendingNavigationPayload = null;

  try {
    await applyArticleDataPayload(pending);
  } catch (error) {
    console.error(error);
    setStatus('\u5904\u7406\u9875\u9762\u5bfc\u822a\u66f4\u65b0\u5931\u8d25', 'error');
  }
}

function safeDisconnectPort() {
  if (!state.activePort) return;
  try {
    state.activePort.disconnect();
  } catch {}
  state.activePort = null;
  state.activeStreamRunId = '';
}

function readRuntimeLastErrorMessage() {
  return chrome.runtime.lastError?.message || '';
}

function addActiveRun(runId) {
  state.activeRunIds.add(runId);
}

function removeActiveRun(runId) {
  state.activeRunIds.delete(runId);
}

async function cancelGeneration() {
  if (!state.generating || state.cancelRequested) return;
  state.cancelRequested = true;
  setStatus('\u6b63\u5728\u53d6\u6d88\u672c\u6b21\u751f\u6210...', 'warning');

  refreshActionStates();
  abortCurrentRun('user_cancelled');

  const runIds = Array.from(state.activeRunIds);
  if (state.activePort && state.activeStreamRunId) {
    try {
      state.activePort.postMessage({ action: 'cancelRun', runId: state.activeStreamRunId });
    } catch {}
  }

  safeDisconnectPort();
  Promise.allSettled(runIds.map((runId) => runtimeSendMessage({ action: 'cancelRun', runId }))).catch(() => {});
}

function buildStreamStartStatus(meta) {
  if (meta?.stage === 'synthesis') return '\u6b63\u5728\u6c47\u603b\u6700\u7ec8\u7ed3\u679c...';
  if (meta?.stage === 'chunk') {
    if (typeof meta?.chunkIndex === 'number' && typeof meta?.chunkCount === 'number') {
      return '\u6b63\u5728\u603b\u7ed3\u7b2c ' + (meta.chunkIndex + 1) + '/' + meta.chunkCount + ' \u6bb5...';
    }
    return '\u6b63\u5728\u603b\u7ed3\u5f53\u524d\u5206\u6bb5...';
  }
  return '\u6b63\u5728\u751f\u6210\u603b\u7ed3...';
}

function buildStreamRetryStatus(meta, attempt) {
  const prefix = meta?.stage === 'chunk'
    ? buildStreamStartStatus(meta).replace(/\.\.\.$/, '')
    : meta?.stage === 'synthesis'
      ? '\u6b63\u5728\u6c47\u603b\u6700\u7ec8\u7ed3\u679c'
      : '\u6b63\u5728\u751f\u6210\u603b\u7ed3';
  return prefix + '\uff0c\u63a5\u53e3\u6ce2\u52a8\uff0c\u6b63\u5728\u8fdb\u884c\u7b2c ' + attempt + ' \u6b21\u91cd\u8bd5...';
}

function runPromptViaStream(settings, prompt, meta, signal, handlers) {
  return new Promise((resolve, reject) => {
    const runId = Domain.createRuntimeId('run');
    const port = chrome.runtime.connect({ name: 'ai-stream' });
    const options = handlers || {};
    let settled = false;
    let text = '';

    state.activePort = port;
    state.activeStreamRunId = runId;
    addActiveRun(runId);

    function cleanup() {
      if (settled) return;
      settled = true;
      removeActiveRun(runId);
      signal?.removeEventListener('abort', onAbort);
      if (state.activePort === port) {
        safeDisconnectPort();
      }
    }

    function onAbort() {
      cleanup();
      reject(createCancelledUiError(meta, runId));
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    port.onMessage.addListener((message) => {
      if (message.runId !== runId) return;

      if (message.type === 'started') {
        if (typeof options.onStarted === 'function') {
          options.onStarted(message);
        }
        return;
      }

      if (message.type === 'retry') {
        if (typeof options.onRetry === 'function') {
          options.onRetry(message.retry || {}, message);
        }
        return;
      }

      if (message.type === 'token') {
        const token = String(message.token || '');
        if (!token) return;
        text += token;
        if (typeof options.onToken === 'function') {
          options.onToken(token, text, message);
        }
        return;
      }

      if (message.type === 'done') {
        const finalText = String(message.text || '');
        if (finalText && !text) {
          text = finalText;
          if (typeof options.onToken === 'function') {
            options.onToken(finalText, text, Object.assign({}, message, { syntheticFinal: true }));
          }
        }
        const diagnostics = message.diagnostics || null;
        cleanup();
        resolve({ text, diagnostics, usage: message.usage || null });
        return;
      }

      if (message.type === 'cancelled' || message.type === 'error') {
        const error = normalizeUiError(Object.assign({}, message.error || {}, { diagnostics: message.diagnostics || null }));
        cleanup();
        reject(error);
      }
    });

    port.onDisconnect.addListener(() => {
      const disconnectReason = readRuntimeLastErrorMessage();
      if (settled) return;
      cleanup();
      reject(state.cancelRequested
        ? createCancelledUiError(meta, runId)
        : normalizeUiError(Errors.createError(Errors.ERROR_CODES.NETWORK_STREAM_DISCONNECTED, {
            stage: meta?.stage || '',
            detail: disconnectReason || 'stream_disconnected'
          }))
      );
    });

    port.postMessage({
      action: 'startStream',
      settings,
      prompt,
      runId,
      meta
    });
  });
}

function streamPrompt(settings, prompt, meta, signal) {
  return runPromptViaStream(settings, prompt, meta, signal, {
    onStarted() {
      setStatus(buildStreamStartStatus(meta));
    },
    onRetry(retry) {
      const attempt = retry?.attempt || 1;
      setStatus(buildStreamRetryStatus(meta, attempt), 'warning');
    },
    onToken(token) {
      state.summaryMarkdown += token;
      scheduleMarkdownRender();
    }
  });
}

function runChunkPrompt(settings, prompt, meta, signal) {
  return runPromptViaStream(settings, prompt, meta, signal, {
    onStarted() {
      setStatus(buildStreamStartStatus(meta));
    },
    onRetry(retry) {
      const attempt = retry?.attempt || 1;
      setStatus(buildStreamRetryStatus(meta, attempt), 'warning');
    }
  });
}

async function persistRecord(record) {
  const saved = await recordStore.saveRecord(record);
  state.visibleRecord = saved;
  return saved;
}

async function startPrimarySummary(summaryMode) {
  if (state.generating) return;

  const article = state.article;
  const settings = await loadRuntimeSettings();
  ensureArticleReady(article);

  if (!settings.apiKey) {
    throw Errors.createError(Errors.ERROR_CODES.CONFIG_MISSING_API_KEY);
  }

  const trustPolicy = Trust.buildTrustPolicy(article, settings);
  const simpleModeEnabled = !!settings.entrypointSimpleMode && summaryMode === 'short';

  state.generating = true;
  state.cancelRequested = false;
  state.summaryMarkdown = '';
  state.lastDiagnostics = null;
  renderDiagnostics();
  renderArticleMeta(article, { summaryMode });
  renderInlineNote(
    simpleModeEnabled ? '\u7b80\u5355\u603b\u7ed3\u6a21\u5f0f' : '\u51c6\u5907\u751f\u6210\u6458\u8981',
    simpleModeEnabled && article.chunkCount > 1
      ? '\u5df2\u542f\u7528\u7b80\u5355\u6a21\u5f0f\uff0c\u5c06\u8df3\u8fc7\u957f\u6587\u5206\u6bb5\u4ee5\u8282\u7701 token\u3002'
      : '\u6b63\u5728\u521d\u59cb\u5316\u672c\u6b21\u4efb\u52a1\uff0c\u8bf7\u7a0d\u5019\u3002'
  );
  setStatus(trustPolicy.allowHistory ? '\u6b63\u5728\u63d0\u53d6\u5e76\u751f\u6210\u603b\u7ed3...' : '\u6b63\u5728\u751f\u6210\u5f53\u524d\u9875\u9762\u6458\u8981\uff0c\u672c\u6b21\u4e0d\u4f1a\u5199\u5165\u5386\u53f2...');
  setStats('');
  refreshActionStates();

  const runSignal = beginRunAbortController();
  const draftRecord = createDraftRecord(article, settings, summaryMode, 'primary');
  state.visibleRecord = draftRecord;

  const chunkRuns = [];
  let finalRun = null;

  try {
    const partialSummaries = [];

    if (article.chunkCount > 1 && !simpleModeEnabled) {
      setStatus('\u6b63\u5728\u5206\u6bb5\u5206\u6790\u957f\u6587...');

      for (const chunk of article.chunks) {
        if (state.cancelRequested) {
          throw Errors.createError(Errors.ERROR_CODES.RUN_CANCELLED);
        }

        renderChunkProgress(partialSummaries.length, article.chunkCount, partialSummaries);
        const prompt = withCustomPrompt(ArticleUtils.buildChunkPrompt({
          article,
          chunk,
          summaryMode,
          targetLanguage: getTargetLanguage(settings, article)
        }), settings);

        const result = await runChunkPrompt(settings, prompt, {
          stage: 'chunk',
          articleId: article.articleId,
          chunkIndex: chunk.index,
          chunkCount: article.chunkCount
        }, runSignal);

        partialSummaries.push(result.text.trim());
        chunkRuns.push(result.diagnostics || null);
        renderChunkProgress(partialSummaries.length, article.chunkCount, partialSummaries);
      }
    }

    if (state.cancelRequested) {
      throw Errors.createError(Errors.ERROR_CODES.RUN_CANCELLED);
    }

    const prompt = withCustomPrompt(
      partialSummaries.length
        ? ArticleUtils.buildSynthesisPrompt({
            article,
            partialSummaries,
            summaryMode,
            targetLanguage: getTargetLanguage(settings, article)
          })
        : ArticleUtils.buildPrimaryPrompt({
            article,
            summaryMode,
            targetLanguage: getTargetLanguage(settings, article)
          }),
      settings
    );

    const streamResult = await streamPrompt(settings, prompt, {
      stage: partialSummaries.length ? 'synthesis' : 'primary',
      articleId: article.articleId,
      chunkCount: article.chunkCount
    }, runSignal);

    finalRun = streamResult.diagnostics || null;
    const diagnostics = composeDiagnostics(article, chunkRuns, finalRun, null);
    state.lastDiagnostics = diagnostics;
    renderDiagnostics();

    const completedRecord = finalizeRecord(draftRecord, RunUtils.buildTerminalRecordPatch(draftRecord, diagnostics, 'completed', {
      summaryMarkdown: state.summaryMarkdown,
      summaryPlainText: markdownToPlainText(state.summaryMarkdown),
      bullets: extractBullets(state.summaryMarkdown),
      usage: finalRun?.usage || null
    }));

    const savedRecord = await persistRecord(completedRecord);
    bindVisibleRecord(savedRecord);
    setStatus(completedRecord.allowHistory === false ? '\u751f\u6210\u5b8c\u6210\uff0c\u672c\u6b21\u672a\u5199\u5165\u5386\u53f2' : '\u751f\u6210\u5b8c\u6210', 'success');
    refreshActionStates();

    if (!elements.historyPanel.classList.contains('hidden')) {
      await getHistoryController().refresh();
    }
  } catch (errorLike) {
    const error = normalizeUiError(errorLike);
    const diagnostics = composeDiagnostics(article, chunkRuns, finalRun, error);
    state.lastDiagnostics = diagnostics;
    renderDiagnostics();

    const failedStatus = error.code === Errors.ERROR_CODES.RUN_CANCELLED ? 'cancelled' : 'failed';
    const failedRecord = finalizeRecord(draftRecord, RunUtils.buildTerminalRecordPatch(draftRecord, diagnostics, failedStatus, {
      errorCode: error.code,
      errorMessage: error.message,
      summaryMarkdown: state.summaryMarkdown
    }));

    const savedRecord = await persistRecord(failedRecord);
    bindVisibleRecord(savedRecord);
    refreshActionStates();
  } finally {
    state.generating = false;
    state.cancelRequested = false;
    clearRunAbortController();
    state.activeRunIds.clear();
    safeDisconnectPort();
    refreshActionStates();
    await applyPendingNavigationPayload();
  }
}

async function startSecondarySummary(mode) {
  if (state.generating || !state.article || !state.summaryMarkdown.trim()) return;

  const settings = await loadRuntimeSettings();
  if (!settings.apiKey) {
    renderErrorBox(Errors.createError(Errors.ERROR_CODES.CONFIG_MISSING_API_KEY));
    setStatus('\u8bf7\u5148\u914d\u7f6e API Key', 'error');
    return;
  }

  const article = state.article;
  const trustPolicy = Trust.buildTrustPolicy(article, settings);

  state.generating = true;
  state.cancelRequested = false;
  state.lastDiagnostics = null;
  renderDiagnostics();
  setStatus(trustPolicy.allowHistory ? '\u6b63\u5728\u751f\u6210 ' + getModeLabel(mode) + '...' : '\u6b63\u5728\u751f\u6210 ' + getModeLabel(mode) + '\uff0c\u672c\u6b21\u4e0d\u4f1a\u5199\u5165\u5386\u53f2...');
  refreshActionStates();

  const runSignal = beginRunAbortController();
  const sourceSummaryHash = Domain.hashString(state.summaryMarkdown);
  const draftRecord = createDraftRecord(article, settings, mode, 'secondary', {
    parentRecordId: state.visibleRecord?.recordId || '',
    originSummaryHash: sourceSummaryHash
  });

  const sourceMarkdown = state.summaryMarkdown;
  state.visibleRecord = draftRecord;
  state.summaryMarkdown = '';
  renderArticleMeta(article, { summaryMode: mode });
  renderInlineNote('\u6b63\u5728\u8fdb\u884c\u4e8c\u6b21\u751f\u6210', '\u57fa\u4e8e\u5f53\u524d\u6458\u8981\u751f\u6210 ' + getModeLabel(mode) + '\u3002');

  try {
    const prompt = withCustomPrompt(ArticleUtils.buildSecondaryPrompt({
      article,
      summaryMode: mode,
      targetLanguage: getTargetLanguage(settings, article),
      summaryMarkdown: sourceMarkdown
    }), settings);

    const streamResult = await streamPrompt(settings, prompt, {
      stage: 'secondary',
      articleId: article.articleId,
      chunkCount: article.chunkCount
    }, runSignal);

    const diagnostics = composeDiagnostics(article, [], streamResult.diagnostics || null, null);
    state.lastDiagnostics = diagnostics;
    renderDiagnostics();

    const completedRecord = finalizeRecord(draftRecord, RunUtils.buildTerminalRecordPatch(draftRecord, diagnostics, 'completed', {
      summaryMarkdown: state.summaryMarkdown,
      summaryPlainText: markdownToPlainText(state.summaryMarkdown),
      bullets: extractBullets(state.summaryMarkdown),
      usage: streamResult.diagnostics?.usage || null
    }));

    const savedRecord = await persistRecord(completedRecord);
    bindVisibleRecord(savedRecord);
    setStatus(completedRecord.allowHistory === false ? getModeLabel(mode) + ' \u751f\u6210\u5b8c\u6210\uff0c\u672c\u6b21\u672a\u5199\u5165\u5386\u53f2' : getModeLabel(mode) + ' \u751f\u6210\u5b8c\u6210', 'success');
  } catch (errorLike) {
    const error = normalizeUiError(errorLike);
    const diagnostics = composeDiagnostics(article, [], null, error);
    state.lastDiagnostics = diagnostics;
    renderDiagnostics();

    const failedStatus = error.code === Errors.ERROR_CODES.RUN_CANCELLED ? 'cancelled' : 'failed';
    const failedRecord = finalizeRecord(draftRecord, RunUtils.buildTerminalRecordPatch(draftRecord, diagnostics, failedStatus, {
      errorCode: error.code,
      errorMessage: error.message,
      summaryMarkdown: state.summaryMarkdown
    }));

    const savedRecord = await persistRecord(failedRecord);
    bindVisibleRecord(savedRecord);
  } finally {
    state.generating = false;
    state.cancelRequested = false;
    clearRunAbortController();
    state.activeRunIds.clear();
    safeDisconnectPort();
    refreshActionStates();
    await applyPendingNavigationPayload();
  }
}

async function toggleFavoriteFromMain() {
  if (!state.visibleRecord) return;
  if (state.visibleRecord.allowHistory === false) {
    setStatus('\u672c\u6b21\u7ed3\u679c\u672a\u5199\u5165\u5386\u53f2\uff0c\u4e0d\u80fd\u6536\u85cf\u3002', 'warning');
    return;
  }

  const next = finalizeRecord(state.visibleRecord, {
    favorite: !state.visibleRecord.favorite
  });

  const saved = await persistRecord(next);
  bindVisibleRecord(saved, { preserveCurrentArticle: state.visibleRecordUsesCurrentArticle });

  if (getHistoryController().isOpen()) {
    await getHistoryController().refresh();
  }
}

async function copySummary() {
  if (!state.summaryMarkdown.trim()) return;

  try {
    await navigator.clipboard.writeText(state.summaryMarkdown);
    setStatus('\u6458\u8981\u5df2\u590d\u5236\u5230\u526a\u8d34\u677f\u3002', 'success');
    return;
  } catch {}

  const textarea = document.createElement('textarea');
  textarea.value = state.summaryMarkdown;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  textarea.remove();
  setStatus(copied ? '\u6458\u8981\u5df2\u590d\u5236\u5230\u526a\u8d34\u677f\u3002' : '\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5', copied ? 'success' : 'error');
}

function sanitizeFilename(name) {
  return String(name || 'summary')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60) || 'summary';
}

const SHARE_QUOTE_MAX_CHARS = 140;

function buildShareQuoteSnippet(article, maxChars = SHARE_QUOTE_MAX_CHARS) {
  const preferredExcerpt = Domain.normalizeWhitespace(article?.excerpt || article?.subtitle || '');
  const preferredBody = Domain.normalizeWhitespace(article?.cleanText || article?.content || article?.rawText || '');
  const source = preferredExcerpt.length >= 36 ? preferredExcerpt : (preferredBody || preferredExcerpt);
  if (!source) return '';

  const safeLimit = Math.max(40, Number(maxChars) || SHARE_QUOTE_MAX_CHARS);
  if (source.length <= safeLimit) {
    return source;
  }

  return source.slice(0, safeLimit).trimEnd() + '...';
}

function exportMarkdown() {
  if (!state.summaryMarkdown.trim()) return;

  const article = state.article || createArticleFromRecord(state.visibleRecord);
  const record = state.visibleRecord;
  const header = [
    '# ' + (record?.summaryTitle || article?.title || '\u672a\u547d\u540d\u9875\u9762'),
    '',
    '> \u6765\u6e90\uff1a' + (article?.normalizedUrl || article?.sourceUrl || '-'),
    '> \u7ad9\u70b9\uff1a' + (article?.sourceHost || '-'),
    '> \u6a21\u5f0f\uff1a' + getModeLabel(record?.summaryMode || elements.summaryModeSelect.value),
    '> \u751f\u6210\u65f6\u95f4\uff1a' + formatDateTime(record?.completedAt || new Date().toISOString()),
    '',
    '---',
    ''
  ].join('\n');

  const blob = new Blob([header + state.summaryMarkdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizeFilename(article?.title || 'summary') + '.md';
  link.click();
  URL.revokeObjectURL(url);
  setStatus('Markdown \u5df2\u5bfc\u51fa\u3002', 'success');
}

function createShareCardElement() {
  const article = state.article || createArticleFromRecord(state.visibleRecord);
  const record = state.visibleRecord || {};
  const palette = getShareCardThemePalette();
  const quoteText = buildShareQuoteSnippet(article);
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-20000px';
  host.style.top = '0';
  host.style.width = '460px';
  host.style.pointerEvents = 'none';
  host.style.opacity = '1';
  host.style.zIndex = '2147483647';
  host.dataset.canvasBackground = palette.canvasBackground;

  host.innerHTML = [
    '<style>',
    '.share-card, .share-card * { box-sizing: border-box; animation: none !important; transition: none !important; }',
    '.share-card { width: 460px; padding: 28px; border-radius: 28px; background: ' + palette.background + '; color: ' + palette.text + '; font-family: IBM Plex Sans, Noto Sans SC, Segoe UI, sans-serif; box-shadow: ' + palette.shadow + '; }',
    '.share-top { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:22px; }',
    '.share-brand { display:flex; align-items:center; gap:12px; }',
    '.share-mark { width:42px; height:42px; border-radius:14px; background: ' + palette.brandGradient + '; color:' + palette.brandInk + '; display:flex; align-items:center; justify-content:center; font-weight:700; }',
    '.share-subtitle { font-size:12px; color:' + palette.subtitle + '; }',
    '.share-badges { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }',
    '.share-badge { padding:6px 10px; border-radius:999px; background: ' + palette.badgeBackground + '; color:' + palette.badgeText + '; font-size:12px; }',
    '.share-title { margin:0 0 14px; font-size:24px; line-height:1.35; color:' + palette.heading + '; }',
    '.share-source { padding:14px; border-radius:18px; background: ' + palette.sourceBackground + '; border:1px solid ' + palette.sourceBorder + '; margin-bottom:18px; }',
    '.share-source-label { font-size:12px; color:' + palette.subtitle + '; margin-bottom:6px; }',
    '.share-source-url { color:' + palette.accentText + '; font-size:13px; line-height:1.6; word-break:break-all; }',
    '.share-quote { position:relative; margin-bottom:18px; padding:18px 18px 18px 22px; border-radius:22px; background:' + palette.quotePanelBackground + '; border:1px solid ' + palette.quotePanelBorder + '; overflow:hidden; }',
    '.share-quote::before { content:"\\201C"; position:absolute; top:6px; left:12px; font-size:54px; line-height:1; color:' + palette.quoteMark + '; font-family: Georgia, Times New Roman, serif; }',
    '.share-quote-label { position:relative; margin:0 0 8px; padding-left:22px; font-size:12px; color:' + palette.quotePanelLabel + '; letter-spacing:0.02em; }',
    '.share-quote-text { position:relative; padding-left:22px; font-size:14px; line-height:1.78; color:' + palette.quotePanelText + '; }',
    '.share-content { color:' + palette.text + '; font-size:14px; line-height:1.75; }',
    '.share-content h1, .share-content h2, .share-content h3, .share-content h4 { color:' + palette.heading + '; line-height:1.4; margin:18px 0 10px; }',
    '.share-content h2 { padding-bottom:8px; border-bottom:1px solid ' + palette.divider + '; }',
    '.share-content p, .share-content ul, .share-content ol, .share-content blockquote, .share-content pre { margin:0 0 12px; }',
    '.share-content ul, .share-content ol { padding-left:20px; }',
    '.share-content ul li + li, .share-content ol li + li { margin-top:6px; }',
    '.share-content a { color:' + palette.accentText + '; text-decoration:none; border-bottom:1px solid ' + palette.divider + '; }',
    '.share-content strong { color:' + palette.heading + '; }',
    '.share-content blockquote { padding:10px 14px; border-left:3px solid ' + palette.accent + '; background: ' + palette.quoteBackground + '; }',
    '.share-content code { padding:2px 6px; border-radius:6px; background: ' + palette.codeBackground + '; color:' + palette.codeText + '; }',
    '.share-content pre code { display:block; padding:14px; white-space:pre-wrap; word-break:break-word; }',
    '.share-content hr { height:1px; margin:18px 0; border:0; background:' + palette.divider + '; }',
    '.share-content img { display:block; max-width:100%; height:auto; margin:18px auto; border-radius:14px; border:1px solid ' + palette.divider + '; }',
    '.share-content table { width:100%; display:block; overflow-x:auto; border-collapse:collapse; border:1px solid ' + palette.divider + '; border-radius:14px; }',
    '.share-content th, .share-content td { padding:10px 12px; text-align:left; border-right:1px solid ' + palette.divider + '; border-bottom:1px solid ' + palette.divider + '; }',
    '.share-content th { color:' + palette.heading + '; background:' + palette.quoteBackground + '; }',
    '.share-content th:last-child, .share-content td:last-child { border-right:none; }',
    '.share-content tr:last-child td { border-bottom:none; }',
    '.share-footer { margin-top:22px; padding-top:14px; border-top:1px solid ' + palette.divider + '; font-size:12px; color:' + palette.subtitle + '; display:flex; justify-content:space-between; gap:12px; }',
    '</style>',
    '<div class="share-card">',
    '  <div class="share-top">',
    '    <div class="share-brand">',
    '      <div class="share-mark">\u89c8</div>',
    '      <div>',
    '        <div style="font-size:16px;font-weight:700">\u4e00\u89c8</div>',
    '        <div class="share-subtitle">\u7a33\u5b9a\u6458\u8981\u5de5\u4f5c\u53f0</div>',
    '      </div>',
    '    </div>',
    '    <div class="share-subtitle">' + escapeHtml(formatDateTime(record?.completedAt || new Date().toISOString())) + '</div>',
    '  </div>',
    '  <div class="share-badges">',
    '    <span class="share-badge">' + escapeHtml(article?.sourceHost || '\u672a\u77e5\u6765\u6e90') + '</span>',
    '    <span class="share-badge">' + escapeHtml(Strings.SITE_TYPE_LABELS[article?.sourceType] || '\u901a\u7528\u7f51\u9875') + '</span>',
    '    <span class="share-badge">' + escapeHtml(getStrategyLabel(article?.sourceStrategy, article?.sourceType)) + '</span>',
    '    <span class="share-badge">' + escapeHtml(getModeLabel(record?.summaryMode || elements.summaryModeSelect.value)) + '</span>',
    '  </div>',
    '  <h1 class="share-title">' + escapeHtml(article?.title || '\u672a\u547d\u540d\u9875\u9762') + '</h1>',
    '  <div class="share-source">',
    '    <div class="share-source-label">\u6765\u6e90\u94fe\u63a5</div>',
    '    <div class="share-source-url">' + escapeHtml(article?.normalizedUrl || article?.sourceUrl || '-') + '</div>',
    '  </div>',
    quoteText
      ? '  <div class="share-quote"><div class="share-quote-label">\u539f\u6587\u6458\u5f55 \u00b7 \u6700\u591a ' + SHARE_QUOTE_MAX_CHARS + ' \u5b57</div><div class="share-quote-text">' + escapeHtml(quoteText) + '</div></div>'
      : '',
    '  <div class="share-content">' + sanitizeMarkdownToHtml(state.summaryMarkdown || '') + '</div>',
    '  <div class="share-footer">',
    '    <span>\u6765\u6e90\uff1a' + escapeHtml(article?.siteName || article?.sourceHost || '-') + '</span>',
    '    <span>' + escapeHtml(getProviderLabel(record?.provider || state.lastDiagnostics?.provider || '')) + '</span>',
    '  </div>',
    '</div>'
  ].join('');

  return host;
}

async function exportShareImage() {
  if (!state.summaryMarkdown.trim()) return;
  if (state.trustPolicy?.allowShare === false) {
    setStatus('\u5f53\u524d\u7b56\u7565\u5df2\u5173\u95ed\u5206\u4eab\u5361\u8f93\u51fa\u3002', 'warning');
    return;
  }

  const host = createShareCardElement();
  document.body.appendChild(host);
  setStatus('\u6b63\u5728\u751f\u6210\u957f\u622a\u56fe\uff0c\u8bf7\u7a0d\u5019...');

  try {
    await wait(120);
    if (document.fonts?.ready) {
      await Promise.race([document.fonts.ready, wait(1200)]);
    }

    const card = host.querySelector('.share-card');
    const width = Math.ceil(card.scrollWidth);
    const height = Math.ceil(card.scrollHeight);
    const canvas = await html2canvas(card, {
      backgroundColor: host.dataset.canvasBackground || '#06131f',
      scale: Math.min(window.devicePixelRatio || 2, 2),
      useCORS: true,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
      scrollX: 0,
      scrollY: 0,
      logging: false
    });

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = sanitizeFilename((state.article?.title || 'summary') + '-\u5206\u4eab\u5361') + '.png';
    link.click();
    setStatus('\u957f\u622a\u56fe\u5df2\u751f\u6210', 'success');
  } catch (error) {
    console.error(error);
    setStatus('\u957f\u622a\u56fe\u751f\u6210\u5931\u8d25\u3002', 'error');
  } finally {
    host.remove();
  }
}

async function togglePrivacyMode() {
  const nextPrivacyMode = !Trust.normalizeSettings(state.settings).privacyMode;
  await storageSet({ privacyMode: nextPrivacyMode });
  state.settings = Object.assign(
    {},
    state.settings,
    { privacyMode: nextPrivacyMode },
    Trust.normalizeSettings(Object.assign({}, state.settings, { privacyMode: nextPrivacyMode }))
  );
  renderTrustCard(state.article);
  refreshActionStates();
  setStatus(nextPrivacyMode ? '\u65e0\u75d5\u6a21\u5f0f\u5df2\u5f00\u542f\uff0c\u4e0b\u6b21\u751f\u6210\u4e0d\u4f1a\u5199\u5165\u5386\u53f2\u3002' : '\u65e0\u75d5\u6a21\u5f0f\u5df2\u5173\u95ed\uff0c\u4e0b\u6b21\u751f\u6210\u4f1a\u6062\u590d\u9ed8\u8ba4\u5386\u53f2\u7b56\u7565\u3002', nextPrivacyMode ? 'warning' : 'success');
}

function closeSidebar() {
  window.parent.postMessage({ type: 'closeSidebar' }, '*');
}

function initializeModeOptions() {
  const options = getSummaryModeOptions();
  elements.summaryModeSelect.innerHTML = options
    .map((item) => '<option value="' + escapeHtml(item.value) + '">' + escapeHtml(item.label) + '</option>')
    .join('');
  elements.summaryModeMenu.innerHTML = options
    .map((item) => (
      '<button class="mode-option" type="button" role="option" data-value="' + escapeHtml(item.value) + '">' +
        escapeHtml(item.label) +
      '</button>'
    ))
    .join('');
  setSummaryModeControlValue('medium');
  setSummaryModeMenuOpen(false);
}

function bindEvents() {
  elements.summaryRoot.addEventListener('scroll', () => {
    const distance = elements.summaryRoot.scrollHeight - elements.summaryRoot.scrollTop - elements.summaryRoot.clientHeight;
    state.autoScroll = distance <= 24;
  });

  elements.readerBtn.addEventListener('click', () => {
    openReaderTab().catch((error) => {
      const normalized = normalizeUiError(error);
      setStatus(normalized.message, 'error');
    });
  });
  elements.historyBtn.addEventListener('click', () => getHistoryController().open());
  elements.themeBtn.addEventListener('click', () => {
    cycleThemePreference().catch((error) => {
      const normalized = normalizeUiError(error);
      setStatus(normalized.message, 'error');
    });
  });
  elements.closeBtn.addEventListener('click', closeSidebar);
  elements.privacyToggleBtn.addEventListener('click', () => {
    togglePrivacyMode().catch((error) => {
      const normalized = normalizeUiError(error);
      setStatus(normalized.message, 'error');
    });
  });
  elements.summaryModeTrigger.addEventListener('click', () => {
    const nextOpen = !state.summaryModeMenuOpen;
    setSummaryModeMenuOpen(nextOpen);
    if (nextOpen) {
      focusActiveSummaryModeOption();
    }
  });
  elements.summaryModeTrigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSummaryModeMenuOpen(true);
      focusActiveSummaryModeOption();
    }

    if (event.key === 'Escape' && state.summaryModeMenuOpen) {
      event.preventDefault();
      setSummaryModeMenuOpen(false);
    }
  });
  elements.summaryModeMenu.addEventListener('click', (event) => {
    const option = event.target.closest('.mode-option');
    if (!option) return;
    setSummaryModeControlValue(option.dataset.value);
    setSummaryModeMenuOpen(false);
    elements.summaryModeTrigger.focus();
  });
  elements.summaryModeMenu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setSummaryModeMenuOpen(false);
      elements.summaryModeTrigger.focus();
    }
  });
  elements.summaryModeSelect.addEventListener('change', syncSummaryModeControl);
  elements.regenerateBtn.addEventListener('click', () => {
    startPrimarySummary(elements.summaryModeSelect.value).catch((error) => {
      const normalized = normalizeUiError(error);
      renderErrorBox(normalized);
      setStatus(normalized.message, 'error');
      refreshActionStates();
    });
  });
  elements.cancelBtn.addEventListener('click', cancelGeneration);
  elements.favoriteBtn.addEventListener('click', () => {
    toggleFavoriteFromMain().catch(console.error);
  });
  elements.copyBtn.addEventListener('click', copySummary);
  elements.exportBtn.addEventListener('click', exportMarkdown);
  elements.shareBtn.addEventListener('click', exportShareImage);
  document.querySelectorAll('.secondary-btn').forEach((button) => {
    button.addEventListener('click', () => {
      startSecondarySummary(button.dataset.mode).catch((error) => {
        const normalized = normalizeUiError(error);
        renderErrorBox(normalized);
        setStatus(normalized.message, 'error');
        refreshActionStates();
      });
    });
  });

  document.addEventListener('click', (event) => {
    if (!state.summaryModeMenuOpen) return;
    if (elements.summaryModeTrigger.contains(event.target) || elements.summaryModeMenu.contains(event.target)) return;
    setSummaryModeMenuOpen(false);
  });

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'historyData') {
      getHistoryController().open();
      return;
    }

    if (event.data?.type === 'articleData' && event.data.article) {
      handleArticleDataPayload(event.data).catch((error) => {
        console.error(error);
        setStatus('\u5904\u7406\u5165\u53e3\u89e6\u53d1\u5931\u8d25', 'error');
      });
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.summaryModeMenuOpen) {
      setSummaryModeMenuOpen(false);
      return;
    }
    if (event.key !== 'Escape') return;
    if (getHistoryController().isOpen()) {
      getHistoryController().close();
      return;
    }
    if (elements.diagnosticsBlock?.open) {
      closeDiagnostics();
      return;
    }
    closeSidebar();
  });
}

function getThemePreferenceDisplayLabel(preference) {
  if (preference === 'dark') return '\u6df1\u8272';
  if (preference === 'light') return '\u6d45\u8272';
  return '\u8ddf\u968f\u7cfb\u7edf';
}

function getThemeModeDisplayLabel(theme) {
  return theme === 'dark' ? '\u6df1\u8272' : '\u6d45\u8272';
}

function renderThemeToggleState() {
  const preference = Theme.getCurrentPreference();
  const theme = Theme.getCurrentTheme();
  const nextPreference = Theme.getNextPreference(preference);
  const currentLabel = preference === 'system'
    ? '\u8ddf\u968f\u7cfb\u7edf\uff08\u5f53\u524d' + getThemeModeDisplayLabel(theme) + '\uff09'
    : getThemePreferenceDisplayLabel(preference);
  const nextLabel = getThemePreferenceDisplayLabel(nextPreference);

  elements.themeBtn.textContent = '\u914d\u8272\uff1a' + getThemePreferenceDisplayLabel(preference);
  elements.themeBtn.dataset.preference = preference;
  elements.themeBtn.dataset.theme = theme;

  const title = '\u5f53\u524d\u914d\u8272\u4e3a' + currentLabel + '\uff1b\u70b9\u51fb\u5207\u6362\u5230' + nextLabel;
  elements.themeBtn.title = title;
  elements.themeBtn.setAttribute('aria-label', title);
}

async function cycleThemePreference() {
  const currentPreference = Theme.getCurrentPreference();
  const nextPreference = Theme.getNextPreference(currentPreference);
  const result = await Theme.saveThemePreference(nextPreference);
  const themeLabel = getThemeModeDisplayLabel(result.theme);

  setStatus(
    result.preference === 'system'
      ? '\u914d\u8272\u5df2\u6539\u4e3a\u8ddf\u968f\u7cfb\u7edf\uff0c\u5f53\u524d\u751f\u6548\uff1a' + themeLabel + '\u3002'
      : '\u914d\u8272\u5df2\u5207\u6362\u4e3a\u56fa\u5b9a' + themeLabel + '\u3002',
    'success'
  );
}

function updateFavoriteButton() {
  if (!elements.favoriteBtn) return;

  let text = '\u52a0\u5165\u6536\u85cf';
  let title = '\u628a\u8fd9\u6761\u603b\u7ed3\u52a0\u5165\u6536\u85cf';
  let active = false;

  if (state.visibleRecord?.allowHistory === false) {
    text = '\u672a\u5199\u5165\u5386\u53f2';
    title = '\u672c\u6b21\u7ed3\u679c\u6ca1\u6709\u5199\u5165\u5386\u53f2\uff0c\u56e0\u6b64\u4e0d\u80fd\u6536\u85cf';
  } else if (state.visibleRecord?.favorite) {
    text = '\u53d6\u6d88\u6536\u85cf';
    title = '\u628a\u8fd9\u6761\u603b\u7ed3\u4ece\u6536\u85cf\u4e2d\u79fb\u9664';
    active = true;
  }

  elements.favoriteBtn.textContent = text;
  elements.favoriteBtn.title = title;
  elements.favoriteBtn.setAttribute('aria-label', title);
  elements.favoriteBtn.classList.toggle('action-btn-favorite-active', active);
}

function createReaderSnapshot() {
  const article = state.article || createArticleFromRecord(state.visibleRecord);
  const record = state.visibleRecord || {};
  return buildReaderSnapshot({
    article,
    record,
    summaryMarkdown: state.summaryMarkdown,
    currentSummaryMode: elements.summaryModeSelect.value,
    generating: state.generating,
    diagnostics: state.lastDiagnostics
  });
}

async function openReaderTab() {
  const snapshot = createReaderSnapshot();
  if (!snapshot) {
    setStatus('\u5f53\u524d\u8fd8\u6ca1\u6709\u53ef\u9605\u8bfb\u7684\u6458\u8981\u5185\u5bb9\u3002', 'warning');
    return;
  }

  const response = await runtimeSendMessage({
    action: 'openReaderTab',
    snapshot
  });

  if (response.success) {
    setStatus('\u5df2\u5728\u65b0\u6807\u7b7e\u9875\u6253\u5f00\u4e13\u6ce8\u9605\u8bfb\u3002', 'success');
    return;
  }

  setStatus(response.error || '\u6253\u5f00\u9605\u8bfb\u9875\u5931\u8d25\u3002', 'error');
}

function init() {
  initializeModeOptions();
  getHistoryController();
  renderPlaceholder('\u51c6\u5907\u5f00\u59cb\u603b\u7ed3', '\u53f3\u952e\u5f53\u524d\u9875\u9762\u9009\u62e9\u201c\u7528\u4e00\u89c8\u603b\u7ed3\u6b64\u9875\u201d\uff0c\u6216\u4f7f\u7528\u5feb\u6377\u952e Alt + S\u3002');
  setStatus('\u5c31\u7eea');
  setStats('');
  renderThemeToggleState();
  renderDiagnostics();
  renderTrustCard(null);
  refreshActionStates();
  bindEvents();

  Theme.onChange(() => {
    renderThemeToggleState();
  });

  loadRuntimeSettings()
    .then(() => {
      renderTrustCard(state.article);
      refreshActionStates();
    })
    .catch((error) => {
      setStatus(String(error?.message || error || '\u8bbe\u7f6e\u52a0\u8f7d\u5931\u8d25\u3002'), 'error');
    });
}

init();

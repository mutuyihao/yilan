const Domain = window.AISummaryDomain;
const Strings = window.AISummaryStrings;
const AbortUtils = window.AISummaryAbortUtils;
const Errors = window.AISummaryErrors;
const ArticleUtils = window.AISummaryArticle;
const Trust = window.AISummaryTrust;
const RunUtils = window.AISummaryRunUtils;
const Theme = window.AISummaryTheme;
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

const PROVIDER_LABELS = {
  openai: 'OpenAI Compatible',
  anthropic: 'Anthropic',
  legacy: 'Legacy'
};

const WARNING_LABELS = {
  missing_title: '标题不完整',
  empty_content: '正文为空',
  very_short_content: '正文偏短',
  content_truncated: '正文已截断',
  legacy_import: '来自旧版历史迁移'
};

const THEME_PREFERENCE_LABELS = {
  system: '自动跟随系统',
  light: '固定日间',
  dark: '固定夜间'
};

const THEME_BUTTON_LABELS = {
  system: '自动',
  light: '日间',
  dark: '夜间'
};

const THEME_MODE_LABELS = {
  light: '日间',
  dark: '夜间'
};

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

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDuration(ms) {
  if (!ms) return '0s';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return minutes + 'm ' + seconds + 's';
}
function getModeLabel(mode) {
  return Strings.SUMMARY_MODES[mode]?.label || mode || '标准总结';
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
  return PROVIDER_LABELS[provider] || provider || '未知';
}

function getRecordStatusLabel(status) {
  const labels = {
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    running: '进行中'
  };
  return labels[status] || status || '已完成';
}

function getStrategyLabel(sourceStrategy, sourceType) {
  if (sourceStrategy?.label) return sourceStrategy.label;
  const fallback = {
    news: '新闻速读',
    blog: '博客洞察',
    doc: '文档精读',
    forum: '问答归纳',
    repo: 'README 导读'
  };
  return fallback[sourceType] || '通用精读';
}

function stripMarkdownPreview(markdown, limit = 120) {
  const plain = recordStore.markdownToPlainText(markdown || '');
  return plain.slice(0, limit);
}

function extractBullets(markdown) {
  return String(markdown || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, ''))
    .slice(0, 8);
}

function getTargetLanguage(settings, article) {
  if (!settings.autoTranslate) return 'auto';
  return settings.defaultLanguage || article?.language || 'zh';
}

function withCustomPrompt(prompt, settings) {
  const custom = String(settings.systemPrompt || '').trim();
  if (!custom) return prompt;
  return [
    '以下是用户的额外要求，请优先遵守。',
    custom,
    '---',
    prompt
  ].join('\n\n');
}

function summarizeWarnings(warnings) {
  return (warnings || []).map((item) => WARNING_LABELS[item] || item);
}

function setStatus(text, tone) {
  elements.statusText.textContent = text || '就绪';
  elements.statusText.className = 'status-text';
  if (tone === 'success') elements.statusText.classList.add('status-success');
  if (tone === 'warning') elements.statusText.classList.add('status-warning');
  if (tone === 'error') elements.statusText.classList.add('status-error');
  elements.statusText.classList.toggle('status-active', state.generating);
}

function setStats(text) {
  elements.statsText.textContent = text || '';
}

function renderThemeToggleState() {
  const preference = Theme.getCurrentPreference();
  const theme = Theme.getCurrentTheme();
  const nextPreference = Theme.getNextPreference(preference);
  const themeLabel = THEME_MODE_LABELS[theme] || THEME_MODE_LABELS.light;
  const currentLabel = preference === 'system'
    ? THEME_PREFERENCE_LABELS.system + '（当前' + themeLabel + '）'
    : THEME_PREFERENCE_LABELS[preference] || THEME_PREFERENCE_LABELS.system;
  const nextLabel = THEME_PREFERENCE_LABELS[nextPreference] || THEME_PREFERENCE_LABELS.system;
  const buttonLabel = THEME_BUTTON_LABELS[preference] || THEME_BUTTON_LABELS.system;

  elements.themeBtn.textContent = buttonLabel;
  elements.themeBtn.dataset.preference = preference;
  elements.themeBtn.dataset.theme = theme;

  const title = '当前：' + currentLabel + '；点击切换到：' + nextLabel;
  elements.themeBtn.title = title;
  elements.themeBtn.setAttribute('aria-label', title);
}

async function cycleThemePreference() {
  const currentPreference = Theme.getCurrentPreference();
  const nextPreference = Theme.getNextPreference(currentPreference);
  const result = await Theme.saveThemePreference(nextPreference);
  const themeLabel = THEME_MODE_LABELS[result.theme] || THEME_MODE_LABELS.light;

  setStatus(
    result.preference === 'system'
      ? '配色已改为跟随系统，当前生效：' + themeLabel + '。'
      : '配色已切换为固定' + themeLabel + '。',
    'success'
  );
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
  const plainLength = recordStore.markdownToPlainText(markdown || '').length;
  const parts = [];
  if (plainLength) parts.push(plainLength + ' 字');
  if (article?.chunkCount > 1) parts.push(article.chunkCount + ' 段');
  setStats(parts.join(' · '));
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
  renderTimeoutId = setTimeout(() => {
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
    '<div class="placeholder-icon">览</div>',
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
        '<span>处理中</span>',
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

function getRecordPartialSummary(record) {
  const markdown = record?.summaryMarkdown || state.summaryMarkdown || '';
  const plainText = recordStore.markdownToPlainText(markdown).trim();
  return {
    markdown,
    plainText,
    charCount: plainText.length,
    hasPartialContent: !!plainText
  };
}

function getSecondaryModeLabel(record, diagnostics) {
  const stage = diagnostics?.finalRun?.stage || diagnostics?.error?.stage || '';
  if (stage !== 'secondary' && record?.promptProfile !== 'secondary') return '';
  return getModeLabel(record?.summaryMode || '');
}

function getDiagnosticsUiOptions(record, diagnostics) {
  const partial = getRecordPartialSummary(record);
  return {
    partial,
    options: {
      hasPartialContent: partial.hasPartialContent,
      secondaryModeLabel: getSecondaryModeLabel(record, diagnostics)
    }
  };
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

function buildCancelledStatusText(record, diagnostics) {
  const { options } = getDiagnosticsUiOptions(record, diagnostics);
  const info = RunUtils.describeCancellation(diagnostics, options);
  return info.hasPartialContent ? info.detail + ' \u5df2\u4fdd\u7559\u5f53\u524d\u5df2\u751f\u6210\u5185\u5bb9\u3002' : info.detail;
}

function renderCancelledState(record, errorLike, diagnostics) {
  cancelScheduledMarkdownRender();
  const safeDiagnostics = diagnostics || state.lastDiagnostics || null;
  const safeError = normalizeUiError(errorLike || Errors.createError(Errors.ERROR_CODES.RUN_CANCELLED));
  const { partial, options } = getDiagnosticsUiOptions(record, safeDiagnostics);
  const info = RunUtils.describeCancellation(safeDiagnostics, options);
  const facts = [
    info.stageLabel ? '\u9636\u6bb5\uff1a' + info.stageLabel : '',
    info.progress ? '\u8fdb\u5ea6\uff1a' + info.progress : '',
    partial.hasPartialContent
      ? '\u5185\u5bb9\uff1a\u5df2\u4fdd\u7559\u53d6\u6d88\u524d\u5df2\u751f\u6210\u5185\u5bb9\uff0c\u5f53\u524d\u7ea6 ' + partial.charCount + ' \u5b57\u3002'
      : '\u5185\u5bb9\uff1a' + info.partial,
    partial.hasPartialContent
      ? '\u64cd\u4f5c\uff1a\u5f53\u524d\u5185\u5bb9\u4ecd\u53ef\u590d\u5236\u3001\u5bfc\u51fa\uff0c\u6216\u7ee7\u7eed\u505a\u4e8c\u6b21\u751f\u6210\u3002'
      : '\u64cd\u4f5c\uff1a\u53ef\u4ee5\u76f4\u63a5\u91cd\u65b0\u751f\u6210\uff0c\u6216\u7a0d\u540e\u91cd\u8bd5\u3002'
  ].filter(Boolean);
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
    facts.length ? '<ul class="cancelled-meta-list">' + facts.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul>' : '',
    detail,
    '</div>',
    partialHtml
  ].join('');

  highlightBlocks(elements.summaryRoot);
}

function renderChunkProgress(completed, total, partialSummaries) {
  const recent = partialSummaries.slice(-2).map((item) => {
    return '<li>' + escapeHtml(stripMarkdownPreview(item, 140) || '分段处理完成') + '</li>';
  }).join('');

  renderInlineNote(
    '正在分段总结长文',
    '已完成 ' + completed + '/' + total + ' 个分段，正在整理中。',
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
    title: record?.titleSnapshot || snapshot.title || '未命名页面',
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
  const policy = Trust.buildTrustPolicy(article, state.settings);
  state.trustPolicy = policy;

  elements.trustTitle.textContent = article ? '当前页面策略' : '当前默认策略';
  elements.trustSummary.textContent = policy.summary;
  elements.trustModeBadge.textContent = policy.modeLabel;
  elements.trustHistoryBadge.textContent = policy.historyLabel;
  elements.trustShareBadge.textContent = policy.shareLabel;
  elements.trustSendValue.textContent = policy.willSendToModel ? '会发送' : '等待页面内容';
  elements.trustSendNote.textContent = policy.sendMessage;
  elements.trustHistoryValue.textContent = policy.allowHistory ? '会写入本地历史' : '不会写入历史';
  elements.trustHistoryNote.textContent = policy.historyMessage;
  elements.trustShareValue.textContent = policy.allowShare ? '允许生成分享卡' : '当前不允许分享';
  elements.trustShareNote.textContent = policy.shareMessage;
  elements.privacyToggleBtn.textContent = policy.privacyMode ? '关闭无痕' : '开启无痕';
  elements.privacyToggleBtn.classList.toggle('action-btn-primary', policy.privacyMode);

  setBadgeTone(elements.trustModeBadge, policy.privacyMode ? 'warning' : 'soft');
  setBadgeTone(elements.trustHistoryBadge, policy.allowHistory ? 'success' : 'warning');
  setBadgeTone(elements.trustShareBadge, policy.allowShare ? 'accent' : 'danger');
}

function renderArticleMeta(article, record) {
  const currentArticle = article || createArticleFromRecord(record);
  const modeKey = record?.summaryMode || elements.summaryModeSelect.value || 'medium';

  elements.articleTitle.textContent = currentArticle?.title || '等待页面内容';
  elements.sourceLink.textContent = currentArticle?.normalizedUrl || currentArticle?.sourceUrl || '当前尚未载入网页链接';
  elements.sourceLink.href = currentArticle?.normalizedUrl || currentArticle?.sourceUrl || '#';
  elements.hostBadge.textContent = currentArticle?.sourceHost || '未识别站点';
  elements.siteTypeBadge.textContent = Strings.SITE_TYPE_LABELS[currentArticle?.sourceType] || '通用网页';
  elements.strategyBadge.textContent = getStrategyLabel(currentArticle?.sourceStrategy, currentArticle?.sourceType);
  elements.modeBadge.textContent = getModeLabel(modeKey);
  elements.authorValue.textContent = currentArticle?.author || '-';
  elements.publishedValue.textContent = formatDateTime(currentArticle?.publishedAt);
  elements.lengthValue.textContent = currentArticle?.contentLength ? currentArticle.contentLength + ' 字' : '-';
  const safeModeKey = getSafeSummaryMode(modeKey);
  const simpleModeEnabled = !!state.settings?.entrypointSimpleMode && safeModeKey === 'short';
  elements.chunkValue.textContent = simpleModeEnabled
    ? '简单模式 · 单次请求'
    : currentArticle?.chunkCount > 1
      ? (currentArticle.chunkingStrategy || 'paragraph_split') + ' · ' + currentArticle.chunkCount + ' 段'
      : '无需分段';

  const warnings = summarizeWarnings(currentArticle?.warnings || []);
  elements.warningList.innerHTML = warnings.map((item) => '<span class="warning-chip">' + escapeHtml(item) + '</span>').join('');
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
  if (!state.lastDiagnostics) {
    if (elements.diagnosticsToggle) {
      elements.diagnosticsToggle.textContent = '运行诊断';
      elements.diagnosticsToggle.title = '查看本次运行的诊断信息';
    }
    elements.diagnosticsPre.textContent = '\u7b49\u5f85\u672c\u6b21\u8fd0\u884c\u7684\u8bca\u65ad\u4fe1\u606f...';
    return;
  }

  const { options } = getDiagnosticsUiOptions(state.visibleRecord, state.lastDiagnostics);
  const summaryText = RunUtils.buildDiagnosticsSummary(state.lastDiagnostics, options);
  const status = state.lastDiagnostics?.finalRun?.status
    || (state.lastDiagnostics?.error?.code === Errors.ERROR_CODES.RUN_CANCELLED ? 'cancelled' : state.lastDiagnostics?.error ? 'failed' : 'completed');

  if (elements.diagnosticsToggle) {
    const label = status === 'failed'
      ? '错误诊断'
      : status === 'cancelled'
        ? '取消诊断'
        : status === 'running'
          ? '运行中诊断'
          : '运行诊断';
    elements.diagnosticsToggle.textContent = label;
    elements.diagnosticsToggle.title = label;
  }

  if (status === 'cancelled' || status === 'failed') {
    elements.diagnosticsBlock.open = true;
  }

  elements.diagnosticsPre.textContent = summaryText + '\n\n--- \u539f\u59cb\u8bca\u65ad JSON ---\n' + JSON.stringify(state.lastDiagnostics, null, 2);
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

function finalizeRecord(baseRecord, updates) {
  const merged = Object.assign({}, baseRecord, updates || {});
  merged.summaryPlainText = merged.summaryPlainText || recordStore.markdownToPlainText(merged.summaryMarkdown || '');
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

function updateFavoriteButton() {
  if (state.visibleRecord?.allowHistory === false) {
    elements.favoriteBtn.textContent = '不入历史';
    return;
  }

  const favorite = !!state.visibleRecord?.favorite;
  elements.favoriteBtn.textContent = favorite ? '已收藏' : '收藏';
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
        ? buildCancelledStatusText(record, state.lastDiagnostics)
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
  const suffix = updatedAtLabel !== '-' ? '（' + updatedAtLabel + '）' : '';
  return '已加载当前页面的历史摘要' + suffix + '，可点击“重新生成”更新当前内容。';
}

async function restoreReusableRecordForCurrentArticle(article) {
  const match = await recordStore.findReusableRecordForArticle(article);
  if (!match?.record) return false;

  bindVisibleRecord(match.record, { preserveCurrentArticle: true });
  setStatus(buildReusableRecordStatus(match), 'success');
  return true;
}

function renderHistoryEmpty(message) {
  elements.historySiteFilters.innerHTML = '';
  elements.historyList.innerHTML = '<div class="history-empty">' + escapeHtml(message) + '</div>';
}

function createHistorySiteChip(label, count, active, onClick, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'history-site-chip' + (active ? ' active' : '');
  if (title) button.title = title;

  const text = document.createElement('span');
  text.textContent = label;

  const countBadge = document.createElement('span');
  countBadge.className = 'history-site-chip-count';
  countBadge.textContent = String(count);

  button.appendChild(text);
  button.appendChild(countBadge);
  button.addEventListener('click', onClick);
  return button;
}

function renderHistorySiteFilters(buckets, totalCount) {
  elements.historySiteFilters.innerHTML = '';

  const allChip = createHistorySiteChip(
    '全部站点',
    totalCount,
    !state.selectedSiteHost,
    () => {
      if (!state.selectedSiteHost) return;
      state.selectedSiteHost = '';
      refreshHistoryList().catch(console.error);
    },
    '查看全部站点的总结记录'
  );
  elements.historySiteFilters.appendChild(allChip);

  buckets.forEach((bucket) => {
    const tip = [
      bucket.host,
      bucket.count + ' 条记录',
      bucket.favoriteCount ? bucket.favoriteCount + ' 条收藏' : '',
      bucket.latestUpdatedAt ? '最近更新：' + formatDateTime(bucket.latestUpdatedAt) : ''
    ].filter(Boolean).join(' · ');

    const chip = createHistorySiteChip(
      bucket.host,
      bucket.count,
      state.selectedSiteHost === bucket.host,
      () => {
        if (state.selectedSiteHost === bucket.host) return;
        state.selectedSiteHost = bucket.host;
        refreshHistoryList().catch(console.error);
      },
      tip
    );

    elements.historySiteFilters.appendChild(chip);
  });
}

function createHistoryItemElement(item) {
  const container = document.createElement('div');
  container.className = 'history-item';

  const header = document.createElement('div');
  header.className = 'history-item-header';

  const title = document.createElement('div');
  title.className = 'history-item-title';
  title.textContent = item.titleSnapshot || '未命名页面';

  const meta = document.createElement('div');
  meta.className = 'history-meta';
  meta.textContent = [
    formatDateTime(item.updatedAt || item.createdAt),
    getProviderLabel(item.provider),
    item.model || ''
  ].filter(Boolean).join(' · ');

  const preview = document.createElement('div');
  preview.className = 'history-preview';
  preview.textContent = stripMarkdownPreview(item.summaryMarkdown || item.errorMessage || '', 160) || '暂无预览';

  const footer = document.createElement('div');
  footer.className = 'history-item-footer';

  const tags = document.createElement('div');
  tags.className = 'history-tags';
  [
    Strings.SITE_TYPE_LABELS[item.articleSnapshot?.sourceType] || '通用网页',
    getStrategyLabel(item.articleSnapshot?.sourceStrategy, item.articleSnapshot?.sourceType),
    getModeLabel(item.summaryMode),
    getRecordStatusLabel(item.status)
  ].forEach((value) => {
    const tag = document.createElement('span');
    tag.className = 'badge';
    tag.textContent = value;
    tags.appendChild(tag);
  });

  const actions = document.createElement('div');
  actions.className = 'history-tags';
  const favoriteBtn = document.createElement('button');
  favoriteBtn.className = 'history-mini-btn';
  favoriteBtn.textContent = item.favorite ? '取消收藏' : '收藏';
  favoriteBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    const updated = await recordStore.toggleFavorite(item.recordId);
    if (state.visibleRecord?.recordId === updated?.recordId) {
      bindVisibleRecord(updated, { preserveCurrentArticle: state.visibleRecordUsesCurrentArticle });
    }
    await refreshHistoryList();
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'history-mini-btn';
  deleteBtn.textContent = '删除';
  deleteBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    await recordStore.deleteRecord(item.recordId);
    if (state.visibleRecord?.recordId === item.recordId) {
      state.visibleRecord = null;
      state.visibleRecordUsesCurrentArticle = false;
      state.summaryMarkdown = '';
      renderPlaceholder('记录已删除', '可以重新生成当前页面摘要。');
    }
    await refreshHistoryList();
    refreshActionStates();
  });

  actions.appendChild(favoriteBtn);
  actions.appendChild(deleteBtn);

  header.appendChild(title);
  footer.appendChild(tags);
  footer.appendChild(actions);

  container.appendChild(header);
  container.appendChild(meta);
  container.appendChild(preview);
  container.appendChild(footer);
  container.addEventListener('click', () => {
    bindVisibleRecord(item);
    closeHistoryPanel();
  });

  return container;
}

async function refreshHistoryList() {
  const items = await recordStore.searchRecords(state.historyQuery, { favoritesOnly: state.favoritesOnly });
  elements.historyList.innerHTML = '';

  if (!items.length) {
    renderHistoryEmpty('没有找到匹配的总结记录。');
    return;
  }

  const siteBuckets = recordStore.buildSiteBuckets(items);
  if (state.selectedSiteHost && !siteBuckets.some((bucket) => bucket.host === state.selectedSiteHost)) {
    state.selectedSiteHost = '';
  }

  renderHistorySiteFilters(siteBuckets, items.length);

  const filteredItems = recordStore.filterRecordsBySite(items, state.selectedSiteHost);
  const siteGroups = recordStore.groupRecordsBySite(filteredItems);

  siteGroups.forEach((group) => {
    const section = document.createElement('section');
    section.className = 'history-site-group';

    const header = document.createElement('div');
    header.className = 'history-site-group-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'history-site-group-title';

    const title = document.createElement('strong');
    title.textContent = group.host;

    const meta = document.createElement('div');
    meta.className = 'history-site-group-meta';
    meta.textContent = [
      group.count + ' 条记录',
      group.favoriteCount ? group.favoriteCount + ' 条收藏' : '',
      (group.sourceTypes || [])
        .map((type) => Strings.SITE_TYPE_LABELS[type] || type)
        .filter(Boolean)
        .slice(0, 3)
        .join(' / '),
      group.latestUpdatedAt ? '最近更新：' + formatDateTime(group.latestUpdatedAt) : ''
    ].filter(Boolean).join(' · ');

    const badge = document.createElement('span');
    badge.className = 'badge badge-soft';
    badge.textContent = state.selectedSiteHost ? '当前站点' : '站点聚合';

    titleWrap.appendChild(title);
    titleWrap.appendChild(meta);
    header.appendChild(titleWrap);
    header.appendChild(badge);

    const list = document.createElement('div');
    list.className = 'history-site-group-list';
    group.records.forEach((item) => {
      list.appendChild(createHistoryItemElement(item));
    });

    section.appendChild(header);
    section.appendChild(list);
    elements.historyList.appendChild(section);
  });
}

function openHistoryPanel() {
  if (elements.diagnosticsBlock) {
    elements.diagnosticsBlock.open = false;
  }
  elements.historyPanel.classList.remove('hidden');
  refreshHistoryList().catch((error) => {
    elements.historySiteFilters.innerHTML = '';
    elements.historyList.innerHTML = '<div class="history-empty">历史记录加载失败：' + escapeHtml(String(error?.message || error || 'unknown')) + '</div>';
  });
}

function closeHistoryPanel() {
  elements.historyPanel.classList.add('hidden');
}

function safeDisconnectPort() {
  if (!state.activePort) return;
  try {
    state.activePort.disconnect();
  } catch {}
  state.activePort = null;
  state.activeStreamRunId = '';
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
  setStatus('正在取消本次生成...', 'warning');

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

function streamPrompt(settings, prompt, meta, signal) {
  return new Promise((resolve, reject) => {
    const runId = Domain.createRuntimeId('run');
    const port = chrome.runtime.connect({ name: 'ai-stream' });
    let settled = false;

    state.activePort = port;
    state.activeStreamRunId = runId;
    addActiveRun(runId);

    function onAbort() {
      cleanup();
      reject(createCancelledUiError(meta, runId));
    }

    function cleanup() {
      if (settled) return;
      settled = true;
      removeActiveRun(runId);
      signal?.removeEventListener('abort', onAbort);
      if (state.activePort === port) {
        safeDisconnectPort();
      }
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    port.onMessage.addListener((message) => {
      if (message.runId !== runId) return;

      if (message.type === 'started') {
        setStatus(meta.stage === 'synthesis' ? '正在汇总最终结果...' : '正在生成总结...');
        return;
      }

      if (message.type === 'retry') {
        const attempt = message.retry?.attempt || 1;
        setStatus('接口波动，正在进行第 ' + attempt + ' 次重试...', 'warning');
        return;
      }

      if (message.type === 'token') {
        state.summaryMarkdown += message.token;
        scheduleMarkdownRender();
        return;
      }
      if (message.type === 'done') {
        const diagnostics = message.diagnostics || null;
        cleanup();
        resolve({ diagnostics, usage: message.usage || null });
        return;
      }

      if (message.type === 'cancelled' || message.type === 'error') {
        const error = normalizeUiError(Object.assign({}, message.error || {}, { diagnostics: message.diagnostics || null }));
        cleanup();
        reject(error);
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      cleanup();
      reject(state.cancelRequested
        ? createCancelledUiError(meta, runId)
        : normalizeUiError(Errors.createError(Errors.ERROR_CODES.NETWORK_ERROR, { detail: 'stream_disconnected' }))
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

async function runChunkPrompt(settings, prompt, meta, signal) {
  const runId = Domain.createRuntimeId('run');
  addActiveRun(runId);

  try {
    let response;

    try {
      response = await AbortUtils.raceWithAbort(runtimeSendMessage({
        action: 'runPrompt',
        settings,
        prompt,
        runId,
        meta
      }), signal);
    } catch (error) {
      if (AbortUtils.isAbortError(error)) {
        throw createCancelledUiError(meta, runId);
      }
      throw error;
    }

    if (!response?.success) {
      throw normalizeUiError(Object.assign({}, response?.error || {}, { diagnostics: response?.diagnostics || null }));
    }

    return response;
  } finally {
    removeActiveRun(runId);
  }
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
    simpleModeEnabled ? '简单总结模式' : '准备生成摘要',
    simpleModeEnabled && article.chunkCount > 1
      ? '已启用简单模式，将跳过长文分段以节省 token。'
      : '正在初始化本次任务，请稍候。'
  );
  setStatus(trustPolicy.allowHistory ? '正在提取并生成总结...' : '正在生成当前页面摘要，本次不会写入历史...');
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
      setStatus('正在分段分析长文...');

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
      summaryPlainText: recordStore.markdownToPlainText(state.summaryMarkdown),
      bullets: extractBullets(state.summaryMarkdown),
      usage: finalRun?.usage || null
    }));

    const savedRecord = await persistRecord(completedRecord);
    bindVisibleRecord(savedRecord);
    setStatus(completedRecord.allowHistory === false ? '生成完成，本次未写入历史' : '生成完成', 'success');
    refreshActionStates();

    if (!elements.historyPanel.classList.contains('hidden')) {
      await refreshHistoryList();
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
  }
}

async function startSecondarySummary(mode) {
  if (state.generating || !state.article || !state.summaryMarkdown.trim()) return;

  const settings = await loadRuntimeSettings();
  if (!settings.apiKey) {
    renderErrorBox(Errors.createError(Errors.ERROR_CODES.CONFIG_MISSING_API_KEY));
    setStatus('请先配置 API Key', 'error');
    return;
  }

  const article = state.article;
  const trustPolicy = Trust.buildTrustPolicy(article, settings);

  state.generating = true;
  state.cancelRequested = false;
  state.lastDiagnostics = null;
  renderDiagnostics();
  setStatus(trustPolicy.allowHistory ? '正在生成 ' + getModeLabel(mode) + '...' : '正在生成 ' + getModeLabel(mode) + '，本次不会写入历史...');
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
  renderInlineNote('正在进行二次生成', '基于当前摘要生成 ' + getModeLabel(mode) + '。');

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
      summaryPlainText: recordStore.markdownToPlainText(state.summaryMarkdown),
      bullets: extractBullets(state.summaryMarkdown),
      usage: streamResult.diagnostics?.usage || null
    }));

    const savedRecord = await persistRecord(completedRecord);
    bindVisibleRecord(savedRecord);
    setStatus(completedRecord.allowHistory === false ? getModeLabel(mode) + ' 生成完成，本次未写入历史' : getModeLabel(mode) + ' 生成完成', 'success');
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
  }
}
async function toggleFavoriteFromMain() {
  if (!state.visibleRecord) return;
  if (state.visibleRecord.allowHistory === false) {
    setStatus('本次结果未写入历史，不能收藏。', 'warning');
    return;
  }

  const next = finalizeRecord(state.visibleRecord, {
    favorite: !state.visibleRecord.favorite
  });

  const saved = await persistRecord(next);
  bindVisibleRecord(saved, { preserveCurrentArticle: state.visibleRecordUsesCurrentArticle });

  if (!elements.historyPanel.classList.contains('hidden')) {
    await refreshHistoryList();
  }
}

async function copySummary() {
  if (!state.summaryMarkdown.trim()) return;

  try {
    await navigator.clipboard.writeText(state.summaryMarkdown);
    setStatus('摘要已复制到剪贴板。', 'success');
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
  setStatus(copied ? '摘要已复制到剪贴板。' : '复制失败，请稍后重试', copied ? 'success' : 'error');
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
    '# ' + (record?.summaryTitle || article?.title || '未命名页面'),
    '',
    '> 来源：' + (article?.normalizedUrl || article?.sourceUrl || '-'),
    '> 站点：' + (article?.sourceHost || '-'),
    '> 模式：' + getModeLabel(record?.summaryMode || elements.summaryModeSelect.value),
    '> 生成时间：' + formatDateTime(record?.completedAt || new Date().toISOString()),
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
  setStatus('Markdown 已导出。', 'success');
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
    '      <div class="share-mark">览</div>',
    '      <div>',
    '        <div style="font-size:16px;font-weight:700">一览</div>',
    '        <div class="share-subtitle">稳定摘要工作台</div>',
    '      </div>',
    '    </div>',
    '    <div class="share-subtitle">' + escapeHtml(formatDateTime(record?.completedAt || new Date().toISOString())) + '</div>',
    '  </div>',
    '  <div class="share-badges">',
    '    <span class="share-badge">' + escapeHtml(article?.sourceHost || '未知来源') + '</span>',
    '    <span class="share-badge">' + escapeHtml(Strings.SITE_TYPE_LABELS[article?.sourceType] || '通用网页') + '</span>',
    '    <span class="share-badge">' + escapeHtml(getStrategyLabel(article?.sourceStrategy, article?.sourceType)) + '</span>',
    '    <span class="share-badge">' + escapeHtml(getModeLabel(record?.summaryMode || elements.summaryModeSelect.value)) + '</span>',
    '  </div>',
    '  <h1 class="share-title">' + escapeHtml(article?.title || '未命名页面') + '</h1>',
    '  <div class="share-source">',
    '    <div class="share-source-label">来源链接</div>',
    '    <div class="share-source-url">' + escapeHtml(article?.normalizedUrl || article?.sourceUrl || '-') + '</div>',
    '  </div>',
    quoteText
      ? '  <div class="share-quote"><div class="share-quote-label">原文摘录 · 最多 ' + SHARE_QUOTE_MAX_CHARS + ' 字</div><div class="share-quote-text">' + escapeHtml(quoteText) + '</div></div>'
      : '',
    '  <div class="share-content">' + sanitizeMarkdownToHtml(state.summaryMarkdown || '') + '</div>',
    '  <div class="share-footer">',
    '    <span>来源：' + escapeHtml(article?.siteName || article?.sourceHost || '-') + '</span>',
    '    <span>' + escapeHtml(getProviderLabel(record?.provider || state.lastDiagnostics?.provider || '')) + '</span>',
    '  </div>',
    '</div>'
  ].join('');

  return host;
}
async function exportShareImage() {
  if (!state.summaryMarkdown.trim()) return;
  if (state.trustPolicy?.allowShare === false) {
    setStatus('当前策略已关闭分享卡输出。', 'warning');
    return;
  }

  const host = createShareCardElement();
  document.body.appendChild(host);
  setStatus('正在生成长截图，请稍候...');

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
    link.download = sanitizeFilename((state.article?.title || 'summary') + '-分享卡') + '.png';
    link.click();
    setStatus('长截图已生成', 'success');
  } catch (error) {
    console.error(error);
    setStatus('长截图生成失败。', 'error');
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
  setStatus(nextPrivacyMode ? '无痕模式已开启，下次生成不会写入历史。' : '无痕模式已关闭，下次生成会恢复默认历史策略。', nextPrivacyMode ? 'warning' : 'success');
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
  elements.historyBtn.addEventListener('click', openHistoryPanel);
  elements.themeBtn.addEventListener('click', () => {
    cycleThemePreference().catch((error) => {
      const normalized = normalizeUiError(error);
      setStatus(normalized.message, 'error');
    });
  });
  elements.historyCloseBtn.addEventListener('click', closeHistoryPanel);
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
  elements.historySearch.addEventListener('input', () => {
    state.historyQuery = elements.historySearch.value || '';
    refreshHistoryList().catch(console.error);
  });
  elements.favoritesOnly.addEventListener('change', () => {
    state.favoritesOnly = !!elements.favoritesOnly.checked;
    refreshHistoryList().catch(console.error);
  });

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
      openHistoryPanel();
      return;
    }

    if (event.data?.type === 'articleData' && event.data.article) {
      (async () => {
        closeHistoryPanel();
        state.article = event.data.article;
        state.visibleRecord = null;
        state.visibleRecordUsesCurrentArticle = false;
        state.summaryMarkdown = '';

        let settings = state.settings || {};
        try {
          settings = await loadRuntimeSettings();
        } catch {}

        const autoStart = settings.entrypointAutoStart !== false;
        const simpleMode = !!settings.entrypointSimpleMode;
        const reuseHistory = settings.entrypointReuseHistory !== false;
        const initialMode = simpleMode ? 'short' : (state.article?.preferredSummaryMode || 'medium');
        const triggeredByNavigation = event.data.source === 'navigation';

        const suggestedMode = setSummaryModeControlValue(initialMode);
        setSummaryModeMenuOpen(false);
        renderArticleMeta(state.article, { summaryMode: suggestedMode });
        refreshActionStates();

        if (reuseHistory) {
          renderInlineNote('正在检查历史摘要', '如果当前页面已有已完成摘要，会直接加载最近一次记录。');
          setStatus('正在检查当前页面的历史摘要...');
          setStats('');

          const restored = await restoreReusableRecordForCurrentArticle(state.article);
          if (restored) {
            return;
          }
        }

        if (triggeredByNavigation && !autoStart) {
          renderPlaceholder('????????', '????????????????????????');
          setStatus('????????');
          setStats('');
          return;
        }
        if (triggeredByNavigation) {
          renderPlaceholder(
            '??????????',
            simpleMode
              ? '???????????????'
              : '???????????????????????'
          );
          startPrimarySummary(suggestedMode).catch((error) => {
            const normalized = normalizeUiError(error);
            renderErrorBox(normalized);
            setStatus(normalized.message, 'error');
            refreshActionStates();
          });
          return;
        }

        if (!autoStart) {
          renderPlaceholder('页面已就绪', '点击“重新生成”开始生成摘要，或先切换摘要模式。');
          setStatus('就绪');
          setStats('');
          return;
        }

        renderPlaceholder('正在读取页面内容', simpleMode ? '已启用简单总结，马上开始生成。' : '马上开始生成当前页面的摘要。');
        startPrimarySummary(suggestedMode).catch((error) => {
          const normalized = normalizeUiError(error);
          renderErrorBox(normalized);
          setStatus(normalized.message, 'error');
          refreshActionStates();
        });
      })().catch((error) => {
        console.error(error);
        setStatus('处理入口触发失败', 'error');
      });
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.summaryModeMenuOpen) {
      setSummaryModeMenuOpen(false);
      return;
    }
    if (event.key !== 'Escape') return;
    if (!elements.historyPanel.classList.contains('hidden')) {
      closeHistoryPanel();
      return;
    }
    if (elements.diagnosticsBlock?.open) {
      elements.diagnosticsBlock.open = false;
      return;
    }
    closeSidebar();
  });
}

function getThemePreferenceDisplayLabel(preference) {
  if (preference === 'dark') return '深色';
  if (preference === 'light') return '浅色';
  return '跟随系统';
}

function getThemeModeDisplayLabel(theme) {
  return theme === 'dark' ? '深色' : '浅色';
}

function renderThemeToggleState() {
  const preference = Theme.getCurrentPreference();
  const theme = Theme.getCurrentTheme();
  const nextPreference = Theme.getNextPreference(preference);
  const currentLabel = preference === 'system'
    ? '跟随系统（当前' + getThemeModeDisplayLabel(theme) + '）'
    : getThemePreferenceDisplayLabel(preference);
  const nextLabel = getThemePreferenceDisplayLabel(nextPreference);

  elements.themeBtn.textContent = '配色：' + getThemePreferenceDisplayLabel(preference);
  elements.themeBtn.dataset.preference = preference;
  elements.themeBtn.dataset.theme = theme;

  const title = '当前配色为' + currentLabel + '；点击切换到' + nextLabel;
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
      ? '配色已改为跟随系统，当前生效：' + themeLabel + '。'
      : '配色已切换为固定' + themeLabel + '。',
    'success'
  );
}

function updateFavoriteButton() {
  if (!elements.favoriteBtn) return;

  let text = '加入收藏';
  let title = '把这条总结加入收藏';
  let active = false;

  if (state.visibleRecord?.allowHistory === false) {
    text = '未写入历史';
    title = '本次结果没有写入历史，因此不能收藏';
  } else if (state.visibleRecord?.favorite) {
    text = '取消收藏';
    title = '把这条总结从收藏中移除';
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
  const summaryMarkdown = String(state.summaryMarkdown || record.summaryMarkdown || '').trim();
  if (!summaryMarkdown) return null;

  return {
    recordId: record.recordId || '',
    title: article?.title || record.summaryTitle || '未命名页面',
    sourceUrl: article?.normalizedUrl || article?.sourceUrl || record.normalizedUrl || record.sourceUrl || '',
    sourceHost: article?.sourceHost || record.sourceHost || '',
    author: article?.author || '',
    publishedAt: article?.publishedAt || '',
    publishedLabel: formatDateTime(article?.publishedAt),
    sourceTypeLabel: Strings.SITE_TYPE_LABELS[article?.sourceType] || '通用网页',
    strategyLabel: getStrategyLabel(article?.sourceStrategy, article?.sourceType),
    summaryMode: record.summaryMode || elements.summaryModeSelect.value || 'medium',
    summaryModeLabel: getModeLabel(record.summaryMode || elements.summaryModeSelect.value),
    provider: record.provider || '',
    providerLabel: getProviderLabel(record.provider),
    model: record.model || '',
    status: record.status || (state.generating ? 'running' : 'completed'),
    completedAt: record.completedAt || '',
    completedAtLabel: formatDateTime(record.completedAt || record.createdAt || ''),
    favorite: !!record.favorite,
    allowHistory: record.allowHistory !== false,
    privacyMode: !!record.privacyMode,
    summaryMarkdown,
    summaryPlainText: recordStore.markdownToPlainText(summaryMarkdown),
    diagnostics: state.lastDiagnostics || record.diagnostics || null
  };
}

async function openReaderTab() {
  const snapshot = createReaderSnapshot();
  if (!snapshot) {
    setStatus('当前还没有可阅读的摘要内容。', 'warning');
    return;
  }

  const response = await runtimeSendMessage({
    action: 'openReaderTab',
    snapshot
  });

  if (response.success) {
    setStatus('已在新标签页打开专注阅读。', 'success');
    return;
  }

  setStatus(response.error || '打开阅读页失败。', 'error');
}

function init() {
  initializeModeOptions();
  renderPlaceholder('准备开始总结', '右键当前页面选择“用一览总结此页”，或使用快捷键 Alt + S。');
  setStatus('就绪');
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
      setStatus(String(error?.message || error || '设置加载失败。'), 'error');
    });
}

init();



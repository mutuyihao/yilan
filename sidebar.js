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
const SidebarExport = window.YilanSidebarExport;
const SidebarReaderSession = window.YilanSidebarReaderSession;
const SidebarGeneration = window.YilanSidebarGeneration;
const SidebarModeControl = window.YilanSidebarModeControl;
const SidebarRender = window.YilanSidebarRender;
const SidebarEvents = window.YilanSidebarEvents;
const SidebarState = window.YilanSidebarState;
const ChromeApi = window.YilanChromeApi;
const I18n = window.YilanI18n;
const recordStore = window.db;

const SETTINGS_KEYS = SidebarState.SETTINGS_KEYS;
const NAVIGATION_DURING_GENERATION = SidebarState.NAVIGATION_DURING_GENERATION;
const DEFAULT_NAVIGATION_POLICY = SidebarState.DEFAULT_NAVIGATION_POLICY;

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

const state = SidebarState.createInitialState({ trust: Trust });
const elements = SidebarState.resolveElements(document);

const storageGet = ChromeApi.storageGetLenient;
const storageSet = ChromeApi.storageSetLenient;

function applySidebarCompactMode(enabled) {
  const compact = enabled === true;
  document.body.classList.toggle('sidebar-compact', compact);
  document.body.dataset.sidebarLayout = compact ? 'compact' : 'standard';
}

const runtimeSendMessage = ChromeApi.runtimeSendMessage;
const wait = ChromeApi.wait;

async function loadRuntimeSettings() {
  const rawSettings = await storageGet(SETTINGS_KEYS);
  const trustSettings = Trust.normalizeSettings(rawSettings);
  state.settings = Object.assign({
    entrypointAutoStart: true,
    entrypointSimpleMode: false,
    entrypointReuseHistory: true,
    sidebarCompactMode: false
  }, rawSettings, trustSettings);
  applySidebarCompactMode(state.settings.sidebarCompactMode === true);
  return state.settings;
}

const escapeHtml = UiFormat.escapeHtml;
const formatDateTime = (value) => UiFormat.formatDateTime(value, { emptyText: '-' });

function getModeLabel(mode) {
  return UiLabels.getSummaryModeLabel(mode);
}

const summaryModeController = SidebarModeControl.createModeControlController({
  state,
  elements,
  articleUtils: ArticleUtils,
  getModeLabel,
  escapeHtml,
  document
});

const renderController = SidebarRender.createRenderController({
  state,
  elements,
  summaryModeController,
  DOMPurify,
  marked,
  hljs,
  escapeHtml,
  markdownToPlainText,
  stripMarkdownPreview,
  buildCancelledStateModel,
  buildDiagnosticsPanelModel,
  buildArticleMetaView,
  buildTrustCardView,
  normalizeUiError,
  errors: Errors,
  createArticleFromRecord,
  window,
  performance
});
const sanitizeMarkdownToHtml = renderController.sanitizeMarkdownToHtml;
const renderMarkdown = renderController.renderMarkdown;
const scheduleMarkdownRender = renderController.scheduleMarkdownRender;
const renderPlaceholder = renderController.renderPlaceholder;
const renderInlineNote = renderController.renderInlineNote;
const renderErrorBox = renderController.renderErrorBox;
const renderCancelledState = renderController.renderCancelledState;
const renderChunkProgress = renderController.renderChunkProgress;
const renderArticleMeta = renderController.renderArticleMeta;
const renderTrustCard = renderController.renderTrustCard;
const renderDiagnostics = renderController.renderDiagnostics;
const setStatus = renderController.setStatus;

function getProviderLabel(provider) {
  return UiLabels.getProviderLabel(provider, { fallback: I18n.get('label_unknown') });
}

function getRecordStatusLabel(status) {
  return UiLabels.getRecordStatusLabel(status, { fallback: I18n.get('label_status_completed') });
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
  ].join('\n\n');
}

function getShareCardThemePalette() {
  const theme = Theme.getCurrentTheme();
  const rootStyle = window.getComputedStyle(/** @type {any} */ (document.documentElement));
  const token = (name, fallback) => {
    const value = rootStyle.getPropertyValue(name).trim();
    return value || fallback;
  };
  const bg = token('--bg', theme === 'light' ? '#f7faf7' : '#0a0e12');
  const bgSoft = token('--bg-soft', theme === 'light' ? '#eef6f2' : '#0f151d');
  const surfaceSoft = token('--surface-soft', theme === 'light' ? 'rgba(26, 32, 40, 0.045)' : 'rgba(255, 255, 255, 0.045)');
  const line = token('--line', theme === 'light' ? 'rgba(26, 32, 40, 0.10)' : 'rgba(255, 255, 255, 0.08)');
  const text = token('--text', theme === 'light' ? '#1a2028' : '#eef2f7');
  const muted = token('--text-soft', theme === 'light' ? '#5d6b7a' : '#8a99aa');
  const accent = token('--accent', theme === 'light' ? '#0b8a6f' : '#2bbf9a');
  const accentStrong = token('--accent-strong', theme === 'light' ? '#08745d' : '#3dd4b8');
  const accentSoft = token('--accent-soft', theme === 'light' ? 'rgba(11, 138, 111, 0.08)' : 'rgba(43, 191, 154, 0.12)');
  const brandGradient = token('--brand-gradient', theme === 'light'
    ? 'linear-gradient(135deg, #0b8a6f, #1fa89e)'
    : 'linear-gradient(135deg, #2bbf9a, #3dd4b8)');
  const brandInk = token('--brand-ink', theme === 'light' ? '#fbfffd' : '#041411');

  return {
    background: `linear-gradient(180deg, ${bg} 0%, ${bgSoft} 100%)`,
    canvasBackground: bg,
    text,
    heading: text,
    shadow: theme === 'light' ? '0 30px 80px rgba(26, 32, 40, 0.14)' : '0 30px 80px rgba(1, 8, 14, 0.34)',
    subtitle: muted,
    badgeBackground: surfaceSoft,
    badgeText: muted,
    sourceBackground: surfaceSoft,
    sourceBorder: line,
    accent,
    accentText: accentStrong,
    quoteBackground: accentSoft,
    quotePanelBackground: `linear-gradient(135deg, ${accentSoft}, ${surfaceSoft})`,
    quotePanelBorder: line,
    quotePanelText: text,
    quotePanelLabel: muted,
    quoteMark: accentSoft,
    codeBackground: surfaceSoft,
    codeText: accentStrong,
    divider: line,
    brandGradient,
    brandInk
  };
}

function getRecordUiError(record) {
  if (record?.diagnostics?.error) {
    return normalizeUiError(record.diagnostics.error);
  }

  return normalizeUiError({
    code: record?.errorCode || (record?.status === 'cancelled' ? Errors.ERROR_CODES.RUN_CANCELLED : Errors.ERROR_CODES.UNKNOWN_ERROR),
    message: record?.errorMessage || (record?.status === 'cancelled' ? I18n.get('sidebar_run_cancelled') : I18n.get('sidebar_run_failed'))
  });
}

function rebuildChunksFromSnapshot(snapshot) {
  const cleanText = snapshot?.cleanText || snapshot?.content || '';
  if (!cleanText || (snapshot?.chunkCount || 1) <= 1) return [];
  // Match the original chunking: strategy params if recorded, else the
  // article-utils defaults.
  const strategyParams = snapshot.diagnostics || {};
  return ArticleUtils.splitTextIntoChunks(cleanText, {
    maxChars: strategyParams.chunkMaxChars || 3600,
    minChunkChars: strategyParams.minChunkChars || 1400
  });
}

function createArticleFromRecord(record) {
  const snapshot = record?.articleSnapshot || {};
  return {    articleId: record?.articleId || snapshot.articleId || '',
    canonicalUrl: snapshot.canonicalUrl || '',
    normalizedUrl: record?.normalizedUrl || snapshot.normalizedUrl || '',
    sourceUrl: record?.sourceUrl || snapshot.sourceUrl || '',
    sourceHost: record?.sourceHost || snapshot.sourceHost || Domain.getSourceHost(record?.normalizedUrl || record?.sourceUrl || ''),
    sourceType: snapshot.sourceType || 'unknown',
    title: record?.titleSnapshot || snapshot.title || I18n.get('sidebar_unnamed_page'),
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
    // Persisted snapshots no longer store chunks (derivable from cleanText);
    // rebuild them lazily for chunked regeneration from a restored record.
    chunks: snapshot.chunks || rebuildChunksFromSnapshot(snapshot),
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

function createDraftRecord(article, settings, summaryMode, promptProfile, extra) {
  const now = new Date().toISOString();
  const targetLanguage = getTargetLanguage(settings, article);
  const trustPolicy = Trust.buildTrustPolicy(article, settings);
  const persistentArticle = RunUtils.sanitizeArticleSnapshotForPersistence
    ? RunUtils.sanitizeArticleSnapshotForPersistence(article)
    : article;
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
    articleSnapshot: persistentArticle,
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

let cachedSecondaryButtons = null;
let lastSubtitleOptionsSignature = null;

function getSecondaryButtons() {
  // The secondary action buttons are static sidebar markup; query once.
  if (!cachedSecondaryButtons) {
    cachedSecondaryButtons = Array.from(document.querySelectorAll('.secondary-btn'));
  }
  return cachedSecondaryButtons;
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
  if (elements.subtitleExportBtn) {
    const currentVideoDiagnostics = state.article?.diagnostics ||
      state.visibleRecord?.articleSnapshot?.diagnostics ||
      state.visibleRecord?.diagnostics?.article?.diagnostics ||
      null;
    const isVideoPage = state.article?.sourceType === 'video' ||
      !!currentVideoDiagnostics?.videoSource ||
      !!currentVideoDiagnostics?.bilibili ||
      !!currentVideoDiagnostics?.youtube;
    const hasSubtitleExport = exportController?.hasVideoSubtitleArtifact
      ? !!exportController.hasVideoSubtitleArtifact()
      : !!exportController?.hasBilibiliSubtitleArtifact?.();
    const subtitleOptions = getVideoSubtitleOptions();
    if (elements.subtitleTrackSelect) {
      // Rebuild the <option> list only when the option set actually changes;
      // refreshActionStates runs on every streaming tick during generation.
      const optionsSignature = subtitleOptions.map((option) => option.key + '|' + (option.label || '')).join(';;');
      if (optionsSignature !== lastSubtitleOptionsSignature) {
        const previousValue = elements.subtitleTrackSelect.value;
        elements.subtitleTrackSelect.innerHTML = '';
        subtitleOptions.forEach((option) => {
          const item = document.createElement('option');
          item.value = option.key;
          item.textContent = option.label || option.key;
          elements.subtitleTrackSelect.appendChild(item);
        });
        if (subtitleOptions.some((option) => option.key === previousValue)) {
          elements.subtitleTrackSelect.value = previousValue;
        }
        lastSubtitleOptionsSignature = optionsSignature;
      }
      elements.subtitleTrackSelect.hidden = !isVideoPage || subtitleOptions.length <= 1;
      elements.subtitleTrackSelect.disabled = processing || subtitleOptions.length <= 1;
      elements.subtitleTrackSelect.title = subtitleOptions.length > 1 ? I18n.get('sidebar_subtitle_track_title') : '';
    }
    elements.subtitleExportBtn.hidden = !isVideoPage;
    elements.subtitleExportBtn.disabled = processing || !hasSubtitleExport;
    elements.subtitleExportBtn.textContent = hasSubtitleExport ? I18n.get('sidebar_export_subtitles') : I18n.get('sidebar_no_subtitles');
    elements.subtitleExportBtn.title = hasSubtitleExport ? I18n.get('sidebar_export_subtitles_title') : I18n.get('sidebar_no_subtitles_title');
  }
  elements.privacyToggleBtn.disabled = processing;
  elements.statusText.classList.toggle('status-active', processing);
  elements.contentPanel.classList.toggle('content-panel-processing', processing);
  elements.cancelBtn.classList.toggle('action-btn-live', processing && !state.cancelRequested);

  getSecondaryButtons().forEach((button) => {
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
  } else if (record?.status === 'failed') {
    renderErrorBox(getRecordUiError(record));
  } else if (state.summaryMarkdown) {
    renderMarkdown(state.summaryMarkdown);
  } else {
    renderPlaceholder(I18n.get('sidebar_no_summary_title'), I18n.get('sidebar_no_summary_body'));
  }

  setStatus(
    record?.status === 'failed'
      ? (getRecordUiError(record).message || I18n.get('sidebar_run_failed_short'))
      : record?.status === 'cancelled'
        ? buildCancelledStateModel(record, state.lastDiagnostics, state.summaryMarkdown).statusText
        : I18n.get('sidebar_record_loaded'),
    record?.status === 'failed' ? 'error' : record?.status === 'cancelled' ? 'warning' : ''
  );

  summaryModeController.setValue(record?.summaryMode || 'medium');
  summaryModeController.setOpen(false);
  refreshActionStates();
}

function buildReusableRecordStatus(match) {
  const updatedAtLabel = formatDateTime(
    match?.record?.updatedAt || match?.record?.completedAt || match?.record?.createdAt || ''
  );
  const suffix = updatedAtLabel !== '-' ? I18n.get('sidebar_time_suffix', [updatedAtLabel]) : '';
  return I18n.get('sidebar_reused_history_status', [suffix]);
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
    I18n.get('sidebar_page_ready_title'),
    triggeredByNavigation
      ? I18n.get('sidebar_page_ready_nav_body')
      : I18n.get('sidebar_page_ready_body')
  );
  setStatus(triggeredByNavigation ? I18n.get('sidebar_waiting_manual_start') : I18n.get('sidebar_ready'));
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

  const suggestedMode = summaryModeController.setValue(initialMode);
  summaryModeController.setOpen(false);
  renderArticleMeta(state.article, { summaryMode: suggestedMode });
  refreshActionStates();

  if (reuseHistory) {
    renderInlineNote(I18n.get('sidebar_checking_history_note_title'), I18n.get('sidebar_checking_history_note_body'));
    setStatus(I18n.get('sidebar_checking_history_status'));

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
    I18n.get('sidebar_reading_page_title'),
    simpleMode
      ? I18n.get('sidebar_reading_page_simple_body')
      : I18n.get('sidebar_reading_page_body')
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
    setStatus(I18n.get('sidebar_navigation_update_failed'), 'error');
  }
}

const generationController = SidebarGeneration.createGenerationController({
  getState: () => state,
  getElements: () => elements,
  recordStore,
  domain: Domain,
  errors: Errors,
  articleUtils: ArticleUtils,
  runUtils: RunUtils,
  trust: Trust,
  loadRuntimeSettings,
  ensureArticleReady,
  withCustomPrompt,
  getTargetLanguage,
  createDraftRecord,
  finalizeRecord,
  normalizeUiError,
  composeDiagnostics,
  markdownToPlainText,
  extractBullets,
  getModeLabel,
  renderErrorBox,
  renderDiagnostics,
  renderArticleMeta,
  renderInlineNote,
  setStatus,
  refreshActionStates,
  renderChunkProgress,
  scheduleMarkdownRender,
  bindVisibleRecord,
  getHistoryController,
  applyPendingNavigationPayload,
  runtimeSendMessage,
  connectStream: () => chrome.runtime.connect({ name: 'ai-stream' }),
  readRuntimeLastErrorMessage: () => chrome.runtime.lastError?.message || ''
});
const cancelGeneration = generationController.cancelGeneration;
const persistRecord = generationController.persistRecord;
const startPrimarySummary = generationController.startPrimarySummary;
const startSecondarySummary = generationController.startSecondarySummary;

async function toggleFavoriteFromMain() {
  if (!state.visibleRecord) return;
  if (state.visibleRecord.allowHistory === false) {
    setStatus(I18n.get('sidebar_favorite_blocked_no_history'), 'warning');
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
    setStatus(I18n.get('sidebar_copied'), 'success');
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
  setStatus(copied ? I18n.get('sidebar_copied') : I18n.get('sidebar_copy_failed'), copied ? 'success' : 'error');
}

const exportController = SidebarExport.createExportController({
  getState: () => state,
  getElements: () => elements,
  getCurrentArticle: () => state.article,
  getCurrentRecord: () => state.visibleRecord,
  createArticleFromRecord,
  getShareCardThemePalette,
  sanitizeMarkdownToHtml,
  getStrategyLabel,
  getModeLabel,
  formatDateTime,
  escapeHtml,
  setStatus,
  wait,
  // Only returns a value when the global is already present (e.g. tests);
  // production resolves through the on-demand script loader in export.js.
  loadHtml2Canvas: () => (typeof html2canvas !== 'undefined' ? html2canvas : undefined),
  strings: Strings,
  normalizeWhitespace: Domain.normalizeWhitespace
});
const exportMarkdown = exportController.exportMarkdown;
const exportShareImage = exportController.exportShareImage;
const getVideoSubtitleOptions = exportController.getVideoSubtitleOptions || (() => []);
const exportBilibiliSubtitle = exportController.exportVideoSubtitle || exportController.exportBilibiliSubtitle;

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
  setStatus(nextPrivacyMode ? I18n.get('sidebar_privacy_on') : I18n.get('sidebar_privacy_off'), nextPrivacyMode ? 'warning' : 'success');
}

function closeSidebar() {
  window.parent.postMessage({ type: 'closeSidebar' }, '*');
}

function getThemePreferenceDisplayLabel(preference) {
  if (preference === 'dark') return I18n.get('sidebar_theme_dark');
  if (preference === 'light') return I18n.get('sidebar_theme_light');
  return I18n.get('sidebar_theme_system');
}

function getThemeModeDisplayLabel(theme) {
  return theme === 'dark' ? I18n.get('sidebar_theme_dark') : I18n.get('sidebar_theme_light');
}

function renderThemeToggleState() {
  const preference = Theme.getCurrentPreference();
  const theme = Theme.getCurrentTheme();
  const nextPreference = Theme.getNextPreference(preference);
  const currentLabel = preference === 'system'
    ? I18n.get('sidebar_theme_system_current', [getThemeModeDisplayLabel(theme)])
    : getThemePreferenceDisplayLabel(preference);
  const nextLabel = getThemePreferenceDisplayLabel(nextPreference);

  elements.themeBtn.textContent = I18n.get('sidebar_theme_btn_label', [getThemePreferenceDisplayLabel(preference)]);
  elements.themeBtn.dataset.preference = preference;
  elements.themeBtn.dataset.theme = theme;

  const title = I18n.get('sidebar_theme_btn_title', [currentLabel, nextLabel]);
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
      ? I18n.get('sidebar_theme_switched_system', [themeLabel])
      : I18n.get('sidebar_theme_switched_fixed', [themeLabel]),
    'success'
  );
}

function updateFavoriteButton() {
  if (!elements.favoriteBtn) return;

  let text = I18n.get('sidebar_add_favorite');
  let title = I18n.get('sidebar_add_favorite_title');
  let active = false;

  if (state.visibleRecord?.allowHistory === false) {
    text = I18n.get('sidebar_not_in_history');
    title = I18n.get('sidebar_not_in_history_title');
  } else if (state.visibleRecord?.favorite) {
    text = I18n.get('sidebar_remove_favorite');
    title = I18n.get('sidebar_remove_favorite_title');
    active = true;
  }

  elements.favoriteBtn.textContent = text;
  elements.favoriteBtn.title = title;
  elements.favoriteBtn.setAttribute('aria-label', title);
  elements.favoriteBtn.classList.toggle('action-btn-favorite-active', active);
}

function bindSettingsChangeListener() {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged?.addListener) return;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    if (!Object.prototype.hasOwnProperty.call(changes || {}, 'sidebarCompactMode')) return;

    const enabled = changes.sidebarCompactMode?.newValue === true;
    state.settings = Object.assign({}, state.settings, { sidebarCompactMode: enabled });
    applySidebarCompactMode(enabled);
  });
}

const readerSessionController = SidebarReaderSession.createReaderSessionController({
  getState: () => state,
  getElements: () => elements,
  getCurrentArticle: () => state.article,
  getCurrentRecord: () => state.visibleRecord,
  createArticleFromRecord,
  buildReaderSnapshot,
  runtimeSendMessage,
  setStatus
});
const openReaderTab = readerSessionController.openReaderTab;

const eventsController = SidebarEvents.createEventsController({
  state,
  elements,
  summaryModeController,
  getHistoryController,
  normalizeUiError,
  renderErrorBox,
  setStatus,
  refreshActionStates,
  closeDiagnostics,
  closeSidebar,
  openReaderTab,
  cycleThemePreference,
  togglePrivacyMode,
  startPrimarySummary,
  cancelGeneration,
  toggleFavoriteFromMain,
  copySummary,
  exportMarkdown,
  exportBilibiliSubtitle,
  exportShareImage,
  startSecondarySummary,
  handleArticleDataPayload,
  document,
  window,
  console
});

function init() {
  summaryModeController.initialize();
  getHistoryController();
  renderPlaceholder(I18n.get('sidebar_placeholder_title'), I18n.get('sidebar_init_placeholder_body'));
  setStatus(I18n.get('sidebar_ready'));
  renderThemeToggleState();
  renderDiagnostics();
  renderTrustCard(null);
  refreshActionStates();
  eventsController.bind();
  bindSettingsChangeListener();

  Theme.onChange(() => {
    renderThemeToggleState();
  });

  // Repaint the idle status when the uiLanguage override resolves or changes;
  // other copy re-renders on demand and static text is covered by data-i18n.
  document.addEventListener('yilan-locale-changed', () => {
    if (state.generating) return;
    setStatus(I18n.get('sidebar_ready'));
  });

  loadRuntimeSettings()
    .then(() => {
      renderTrustCard(state.article);
      refreshActionStates();
    })
    .catch((error) => {
      setStatus(String(error?.message || error || I18n.get('sidebar_settings_load_failed')), 'error');
    });
}

init();

(function (global) {
  const Strings = global.AISummaryStrings || (typeof require === 'function' ? require('./strings.js') : null);
  const UiFormat = global.AISummaryUiFormat || (typeof require === 'function' ? require('./ui-format.js') : null);
  const UiLabels = global.AISummaryUiLabels || (typeof require === 'function' ? require('./ui-labels.js') : null);
  const SummaryText = global.AISummarySummaryText || (typeof require === 'function' ? require('./summary-text.js') : null);

  const EMPTY_DATE_TEXT = '\u672a\u8bb0\u5f55';
  const UNKNOWN_PROVIDER_TEXT = '\u672a\u77e5\u6765\u6e90';
  const DEFAULT_SUMMARY_MODE_TEXT = '\u6807\u51c6\u603b\u7ed3';
  const DEFAULT_SOURCE_TYPE_TEXT = '\u901a\u7528\u7f51\u9875';
  const DEFAULT_TITLE_TEXT = '\u672a\u547d\u540d\u9875\u9762';

  function formatReaderDateTime(value) {
    return UiFormat.formatDateTime(value, { emptyText: EMPTY_DATE_TEXT });
  }

  function normalizeExternalUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
      const url = new URL(raw);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.toString();
      }
    } catch (error) {
      return '';
    }

    return '';
  }

  function buildReaderSnapshot(input) {
    const article = input?.article || null;
    const record = input?.record || {};
    const summaryMarkdown = String(input?.summaryMarkdown || record.summaryMarkdown || '').trim();
    if (!summaryMarkdown) return null;

    const summaryMode = record.summaryMode || input?.currentSummaryMode || 'medium';
    const provider = record.provider || '';

    return {
      recordId: record.recordId || '',
      title: article?.title || record.summaryTitle || DEFAULT_TITLE_TEXT,
      sourceUrl: article?.normalizedUrl || article?.sourceUrl || record.normalizedUrl || record.sourceUrl || '',
      sourceHost: article?.sourceHost || record.sourceHost || '',
      author: article?.author || '',
      publishedAt: article?.publishedAt || '',
      publishedLabel: formatReaderDateTime(article?.publishedAt),
      sourceTypeLabel: Strings?.SITE_TYPE_LABELS?.[article?.sourceType] || DEFAULT_SOURCE_TYPE_TEXT,
      strategyLabel: UiLabels.getStrategyLabel(article?.sourceStrategy, article?.sourceType),
      summaryMode,
      summaryModeLabel: UiLabels.getSummaryModeLabel(summaryMode, { variant: 'reader', fallback: DEFAULT_SUMMARY_MODE_TEXT }),
      provider,
      providerLabel: UiLabels.getProviderLabel(provider, { fallback: UNKNOWN_PROVIDER_TEXT }),
      model: record.model || '',
      status: record.status || (input?.generating ? 'running' : 'completed'),
      completedAt: record.completedAt || '',
      completedAtLabel: formatReaderDateTime(record.completedAt || record.createdAt || ''),
      favorite: !!record.favorite,
      allowHistory: record.allowHistory !== false,
      privacyMode: !!record.privacyMode,
      summaryMarkdown,
      summaryPlainText: SummaryText.markdownToPlainText(summaryMarkdown),
      diagnostics: input?.diagnostics || record.diagnostics || null
    };
  }

  function mergeSnapshotWithRecord(snapshot, record) {
    if (!record) return snapshot;

    const summaryMode = record.summaryMode || snapshot.summaryMode || 'medium';
    const provider = record.provider || snapshot.provider || '';
    const summaryMarkdown = record.summaryMarkdown || snapshot.summaryMarkdown || '';

    return Object.assign({}, snapshot, {
      recordId: record.recordId || snapshot.recordId || '',
      sourceUrl: record.normalizedUrl || record.sourceUrl || snapshot.sourceUrl || '',
      sourceHost: record.sourceHost || snapshot.sourceHost || '',
      summaryMode,
      summaryModeLabel: UiLabels.getSummaryModeLabel(summaryMode, { variant: 'reader', fallback: DEFAULT_SUMMARY_MODE_TEXT }),
      provider,
      providerLabel: UiLabels.getProviderLabel(provider, { fallback: UNKNOWN_PROVIDER_TEXT }),
      model: record.model || snapshot.model || '',
      status: record.status || snapshot.status || 'completed',
      completedAt: record.completedAt || snapshot.completedAt || '',
      completedAtLabel: formatReaderDateTime(record.completedAt || snapshot.completedAt || record.createdAt || ''),
      favorite: !!record.favorite,
      allowHistory: record.allowHistory !== false,
      privacyMode: !!record.privacyMode,
      summaryMarkdown,
      summaryPlainText: record.summaryPlainText || snapshot.summaryPlainText || SummaryText.markdownToPlainText(summaryMarkdown),
      diagnostics: record.diagnostics || snapshot.diagnostics || null
    });
  }

  const api = {
    normalizeExternalUrl,
    buildReaderSnapshot,
    mergeSnapshotWithRecord
  };

  global.AISummaryReaderView = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

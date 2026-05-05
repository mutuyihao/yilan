(function (global) {
  const Strings = global.AISummaryStrings || (typeof require === 'function' ? require('./strings.js') : null);
  const Trust = global.AISummaryTrust || (typeof require === 'function' ? require('./trust-policy.js') : null);
  const UiFormat = global.AISummaryUiFormat || (typeof require === 'function' ? require('./ui-format.js') : null);
  const UiLabels = global.AISummaryUiLabels || (typeof require === 'function' ? require('./ui-labels.js') : null);

  function formatSidebarDateTime(value) {
    return UiFormat.formatDateTime(value, { emptyText: '-' });
  }

  function formatContentLength(value) {
    const count = Number(value || 0);
    if (!Number.isFinite(count) || count <= 0) return '-';

    if (count >= 10000) {
      const wan = count / 10000;
      return wan.toLocaleString('zh-CN', {
        maximumFractionDigits: wan < 10 ? 1 : 0
      }) + '\u4e07\u5b57';
    }

    return Math.round(count).toLocaleString('zh-CN') + '\u5b57';
  }

  function formatChunkLabel(article, simpleModeEnabled) {
    if (simpleModeEnabled) return '\u7b80\u5355 \u00b7 \u5355\u6b21';

    const chunkCount = Number(article?.chunkCount || 0);
    if (chunkCount > 1) {
      const strategyLabel = UiLabels.getChunkingStrategyLabel(article?.chunkingStrategy, { fallback: '\u81ea\u52a8' });
      return strategyLabel + ' \u00b7 ' + chunkCount + ' \u6bb5';
    }

    return '\u5355\u6bb5';
  }

  function buildArticleMetaView(article, options) {
    const modeKey = options?.summaryMode || 'medium';
    const simpleModeEnabled = !!options?.simpleModeEnabled;

    return {
      title: article?.title || '\u7b49\u5f85\u9875\u9762\u5185\u5bb9',
      sourceText: article?.normalizedUrl || article?.sourceUrl || '\u5f53\u524d\u5c1a\u672a\u8f7d\u5165\u7f51\u9875\u94fe\u63a5',
      sourceHref: article?.normalizedUrl || article?.sourceUrl || '#',
      hostLabel: article?.sourceHost || '\u672a\u8bc6\u522b\u7ad9\u70b9',
      siteTypeLabel: Strings?.SITE_TYPE_LABELS?.[article?.sourceType] || '\u901a\u7528\u7f51\u9875',
      strategyLabel: UiLabels.getStrategyLabel(article?.sourceStrategy, article?.sourceType),
      modeLabel: UiLabels.getSummaryModeLabel(modeKey, { fallback: '\u6807\u51c6\u603b\u7ed3' }),
      authorLabel: article?.author || '-',
      publishedLabel: formatSidebarDateTime(article?.publishedAt),
      lengthLabel: formatContentLength(article?.contentLength),
      chunkLabel: formatChunkLabel(article, simpleModeEnabled),
      warnings: UiLabels.summarizeWarnings(article?.warnings || [])
    };
  }

  function buildTrustCardView(article, settings) {
    const policy = Trust.buildTrustPolicy(article, settings);

    return {
      policy,
      title: article ? '\u5f53\u524d\u9875\u9762\u7b56\u7565' : '\u5f53\u524d\u9ed8\u8ba4\u7b56\u7565',
      summary: policy.summary,
      modeBadge: policy.modeLabel,
      historyBadge: policy.historyLabel,
      shareBadge: policy.shareLabel,
      sendValue: policy.willSendToModel ? '\u4f1a\u53d1\u9001' : '\u7b49\u5f85\u9875\u9762\u5185\u5bb9',
      sendNote: policy.sendMessage,
      historyValue: policy.allowHistory ? '\u4f1a\u5199\u5165\u672c\u5730\u5386\u53f2' : '\u4e0d\u4f1a\u5199\u5165\u5386\u53f2',
      historyNote: policy.historyMessage,
      shareValue: policy.allowShare ? '\u5141\u8bb8\u751f\u6210\u5206\u4eab\u5361' : '\u5f53\u524d\u4e0d\u5141\u8bb8\u5206\u4eab',
      shareNote: policy.shareMessage,
      privacyToggleLabel: policy.privacyMode ? '\u5173\u95ed\u65e0\u75d5' : '\u5f00\u542f\u65e0\u75d5',
      privacyTogglePrimary: !!policy.privacyMode,
      modeTone: policy.privacyMode ? 'warning' : 'soft',
      historyTone: policy.allowHistory ? 'success' : 'warning',
      shareTone: policy.allowShare ? 'accent' : 'danger'
    };
  }

  const api = {
    buildArticleMetaView,
    buildTrustCardView
  };

  global.AISummarySidebarMetaView = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

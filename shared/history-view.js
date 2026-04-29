(function (global) {
  const Strings = global.AISummaryStrings || (typeof require === 'function' ? require('./strings.js') : null);
  const UiFormat = global.AISummaryUiFormat || (typeof require === 'function' ? require('./ui-format.js') : null);
  const UiLabels = global.AISummaryUiLabels || (typeof require === 'function' ? require('./ui-labels.js') : null);
  const SummaryText = global.AISummarySummaryText || (typeof require === 'function' ? require('./summary-text.js') : null);

  function getOption(options, key, fallback) {
    return Object.prototype.hasOwnProperty.call(options || {}, key) ? options[key] : fallback;
  }

  function buildHistoryItemMeta(item, options) {
    return [
      UiFormat.formatDateTime(item?.updatedAt || item?.createdAt, { emptyText: getOption(options, 'emptyDateText', '') }),
      UiLabels.getProviderLabel(item?.provider, { fallback: getOption(options, 'unknownProviderText', '\u672a\u77e5') }),
      item?.model || ''
    ].filter(Boolean).join(getOption(options, 'joiner', ' \u00b7 '));
  }

  function buildHistoryItemBadges(item, options) {
    return [
      Strings?.SITE_TYPE_LABELS?.[item?.articleSnapshot?.sourceType] || getOption(options, 'defaultSiteTypeText', '\u901a\u7528\u7f51\u9875'),
      UiLabels.getStrategyLabel(item?.articleSnapshot?.sourceStrategy, item?.articleSnapshot?.sourceType),
      UiLabels.getSummaryModeLabel(item?.summaryMode, { fallback: getOption(options, 'defaultSummaryModeText', '\u6807\u51c6\u603b\u7ed3') }),
      UiLabels.getRecordStatusLabel(item?.status, { fallback: getOption(options, 'defaultRecordStatusText', '\u5df2\u5b8c\u6210') })
    ].filter(Boolean);
  }

  function buildHistoryItemView(item, options) {
    return {
      title: item?.titleSnapshot || getOption(options, 'untitledText', '\u672a\u547d\u540d\u9875\u9762'),
      meta: buildHistoryItemMeta(item, options),
      preview: SummaryText.stripMarkdownPreview(
        item?.summaryMarkdown || item?.errorMessage || '',
        getOption(options, 'previewLimit', 160)
      ) || getOption(options, 'emptyPreviewText', '\u6682\u65e0\u9884\u89c8'),
      badges: buildHistoryItemBadges(item, options)
    };
  }

  function buildHistoryGroupSourceTypes(sourceTypes, options) {
    return (sourceTypes || [])
      .map((type) => Strings?.SITE_TYPE_LABELS?.[type] || type)
      .filter(Boolean)
      .slice(0, getOption(options, 'sourceTypeLimit', 3))
      .join(getOption(options, 'sourceTypeJoiner', ' / '));
  }

  function buildHistoryGroupView(group, options) {
    return {
      title: group?.host || '',
      meta: [
        typeof group?.count === 'number' ? group.count + getOption(options, 'recordCountSuffix', ' \u6761\u8bb0\u5f55') : '',
        group?.favoriteCount ? group.favoriteCount + getOption(options, 'favoriteCountSuffix', ' \u6761\u6536\u85cf') : '',
        buildHistoryGroupSourceTypes(group?.sourceTypes, options),
        group?.latestUpdatedAt
          ? getOption(options, 'latestUpdatedPrefix', '\u6700\u8fd1\u66f4\u65b0\uff1a') + UiFormat.formatDateTime(group.latestUpdatedAt, { emptyText: '' })
          : ''
      ].filter(Boolean).join(getOption(options, 'joiner', ' \u00b7 ')),
      badge: getOption(options, 'selected', false)
        ? getOption(options, 'selectedSiteBadgeText', '\u5f53\u524d\u7ad9\u70b9')
        : getOption(options, 'aggregateSiteBadgeText', '\u7ad9\u70b9\u805a\u5408')
    };
  }

  const api = {
    buildHistoryItemView,
    buildHistoryGroupView
  };

  global.AISummaryHistoryView = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

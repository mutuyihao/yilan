(function (global) {
  const Strings = global.AISummaryStrings || (typeof require === 'function' ? require('./strings.js') : null);

  const PROVIDER_LABELS = {
    openai: 'OpenAI Compatible',
    anthropic: 'Anthropic',
    legacy: 'Legacy'
  };

  const SETTINGS_PROVIDER_LABELS = {
    openai: 'OpenAI / OpenAI \u517c\u5bb9\u63a5\u53e3',
    anthropic: 'Anthropic / Claude \u517c\u5bb9\u63a5\u53e3'
  };

  const FALLBACK_SUMMARY_MODE_LABELS = {
    short: '\u7b80\u77ed\u603b\u7ed3',
    medium: '\u6807\u51c6\u603b\u7ed3',
    long: '\u8be6\u7ec6\u5206\u6790',
    key_points: '\u5173\u952e\u8981\u70b9',
    qa: '\u95ee\u7b54\u5361\u7247',
    glossary: '\u672f\u8bed\u8868',
    action_items: '\u884c\u52a8\u9879'
  };

  const READER_SUMMARY_MODE_LABELS = Object.assign({}, FALLBACK_SUMMARY_MODE_LABELS, {
    long: '\u6df1\u5ea6\u603b\u7ed3'
  });

  const RECORD_STATUS_LABELS = {
    completed: '\u5df2\u5b8c\u6210',
    failed: '\u5931\u8d25',
    cancelled: '\u5df2\u53d6\u6d88',
    running: '\u8fdb\u884c\u4e2d'
  };

  const READER_STATUS_LABELS = Object.assign({}, RECORD_STATUS_LABELS, {
    running: '\u751f\u6210\u4e2d'
  });

  const WARNING_LABELS = {
    missing_title: '\u6807\u9898\u4e0d\u5b8c\u6574',
    empty_content: '\u6b63\u6587\u4e3a\u7a7a',
    very_short_content: '\u6b63\u6587\u504f\u77ed',
    content_truncated: '\u6b63\u6587\u5df2\u622a\u65ad',
    legacy_import: '\u6765\u81ea\u65e7\u7248\u5386\u53f2\u8fc1\u79fb'
  };

  const STRATEGY_LABEL_FALLBACKS = {
    news: '\u65b0\u95fb\u901f\u8bfb',
    blog: '\u535a\u5ba2\u6d1e\u5bdf',
    doc: '\u6587\u6863\u7cbe\u8bfb',
    forum: '\u95ee\u7b54\u5f52\u7eb3',
    repo: 'README \u5bfc\u8bfb'
  };

  const CHUNKING_STRATEGY_LABELS = {
    none: '\u5355\u6bb5',
    paragraph_split: '\u6bb5\u843d',
    section_split: '\u7ae0\u8282'
  };

  function normalizeKey(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getProviderLabel(provider, options) {
    const key = normalizeKey(provider);
    const labels = options?.variant === 'settings' ? SETTINGS_PROVIDER_LABELS : PROVIDER_LABELS;
    const fallback = Object.prototype.hasOwnProperty.call(options || {}, 'fallback')
      ? options.fallback
      : '\u672a\u77e5';

    return labels[key] || provider || fallback;
  }

  function getSummaryModeLabel(mode, options) {
    const key = normalizeKey(mode);
    const fallback = Object.prototype.hasOwnProperty.call(options || {}, 'fallback')
      ? options.fallback
      : '\u6807\u51c6\u603b\u7ed3';
    const labels = options?.variant === 'reader'
      ? READER_SUMMARY_MODE_LABELS
      : (Strings?.SUMMARY_MODES || FALLBACK_SUMMARY_MODE_LABELS);
    const entry = labels[key];

    return (typeof entry === 'string' ? entry : entry?.label) || mode || fallback;
  }

  function getRecordStatusLabel(status, options) {
    const key = normalizeKey(status);
    const labels = options?.variant === 'reader' ? READER_STATUS_LABELS : RECORD_STATUS_LABELS;
    const fallback = Object.prototype.hasOwnProperty.call(options || {}, 'fallback')
      ? options.fallback
      : '\u5df2\u5b8c\u6210';

    return labels[key] || status || fallback;
  }

  function getStrategyLabel(sourceStrategy, sourceType) {
    if (sourceStrategy?.label) return sourceStrategy.label;
    return STRATEGY_LABEL_FALLBACKS[normalizeKey(sourceType)] || '\u901a\u7528\u7cbe\u8bfb';
  }

  function getChunkingStrategyLabel(strategy, options) {
    const key = normalizeKey(strategy);
    const fallback = Object.prototype.hasOwnProperty.call(options || {}, 'fallback')
      ? options.fallback
      : '\u81ea\u52a8';

    return CHUNKING_STRATEGY_LABELS[key] || strategy || fallback;
  }

  function getWarningLabel(warning) {
    return WARNING_LABELS[String(warning || '')] || warning;
  }

  function summarizeWarnings(warnings) {
    return (warnings || []).map(getWarningLabel);
  }

  const api = {
    getProviderLabel,
    getSummaryModeLabel,
    getRecordStatusLabel,
    getStrategyLabel,
    getChunkingStrategyLabel,
    getWarningLabel,
    summarizeWarnings
  };

  global.AISummaryUiLabels = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

(function (global) {
  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDateTime(value, options) {
    const emptyText = options?.emptyText || '\u672a\u8bb0\u5f55';
    if (!value) return emptyText;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return emptyText;

    const formatOptions = {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    };

    if (options?.includeYear !== false) {
      formatOptions.year = 'numeric';
    }

    return date.toLocaleString(options?.locale || 'zh-CN', formatOptions);
  }

  const api = {
    escapeHtml,
    formatDateTime
  };

  global.AISummaryUiFormat = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

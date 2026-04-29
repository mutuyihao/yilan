(function (global) {
  function markdownToPlainText(markdown) {
    return String(markdown || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^[>#\-*+\d.\s]+/gm, '')
      .replace(/\n{2,}/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripMarkdownPreview(markdown, limit = 120) {
    return markdownToPlainText(markdown).slice(0, limit);
  }

  function extractBullets(markdown) {
    return String(markdown || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line))
      .map((line) => line.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, ''))
      .slice(0, 8);
  }

  const api = {
    markdownToPlainText,
    stripMarkdownPreview,
    extractBullets
  };

  global.AISummarySummaryText = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

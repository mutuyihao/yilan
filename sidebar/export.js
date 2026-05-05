(function initYilanSidebarExport(global) {
  const DEFAULT_SHARE_QUOTE_MAX_CHARS = 140;

  function fallbackNormalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function sanitizeFilename(name) {
    return String(name || 'summary')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'summary';
  }

  function buildShareQuoteSnippet(article, maxChars, options) {
    const normalizeWhitespace = options?.normalizeWhitespace || fallbackNormalizeWhitespace;
    const safeMaxChars = typeof maxChars === 'number' ? maxChars : DEFAULT_SHARE_QUOTE_MAX_CHARS;
    const preferredExcerpt = normalizeWhitespace(article?.excerpt || article?.subtitle || '');
    const preferredBody = normalizeWhitespace(article?.cleanText || article?.content || article?.rawText || '');
    const source = preferredExcerpt.length >= 36 ? preferredExcerpt : (preferredBody || preferredExcerpt);
    if (!source) return '';

    const safeLimit = Math.max(40, Number(safeMaxChars) || DEFAULT_SHARE_QUOTE_MAX_CHARS);
    if (source.length <= safeLimit) {
      return source;
    }

    return source.slice(0, safeLimit).trimEnd() + '...';
  }

  function resolveShareModelLabel(record, diagnostics, settings) {
    const model = [
      record?.model,
      record?.diagnostics?.model,
      record?.diagnostics?.finalRun?.model,
      diagnostics?.model,
      diagnostics?.finalRun?.model,
      settings?.modelName
    ].map(fallbackNormalizeWhitespace).find(Boolean);

    return '\u6a21\u578b\uff1a' + (model || '-');
  }

  function createExportController(deps) {
    const getState = deps.getState;
    const getElements = deps.getElements;
    const getCurrentArticle = deps.getCurrentArticle;
    const getCurrentRecord = deps.getCurrentRecord;
    const createArticleFromRecord = deps.createArticleFromRecord;
    const getShareCardThemePalette = deps.getShareCardThemePalette;
    const sanitizeMarkdownToHtml = deps.sanitizeMarkdownToHtml;
    const getStrategyLabel = deps.getStrategyLabel;
    const getModeLabel = deps.getModeLabel;
    const formatDateTime = deps.formatDateTime;
    const escapeHtml = deps.escapeHtml;
    const setStatus = deps.setStatus;
    const wait = deps.wait;
    const html2canvasImpl = deps.html2canvas || (typeof html2canvas !== 'undefined' ? html2canvas : null);
    const strings = deps.strings || {};
    const normalizeWhitespace = deps.normalizeWhitespace || fallbackNormalizeWhitespace;
    const quoteMaxChars = deps.shareQuoteMaxChars || DEFAULT_SHARE_QUOTE_MAX_CHARS;

    function getSummaryMarkdown() {
      return String(getState()?.summaryMarkdown || '');
    }

    function resolveArticle() {
      return getCurrentArticle() || createArticleFromRecord(getCurrentRecord());
    }

    function exportMarkdown() {
      const summaryMarkdown = getSummaryMarkdown();
      if (!summaryMarkdown.trim()) return;

      const article = resolveArticle();
      const record = getCurrentRecord();
      const elements = getElements();
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

      const blob = new Blob([header + summaryMarkdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = sanitizeFilename(article?.title || 'summary') + '.md';
      link.click();
      URL.revokeObjectURL(url);
      setStatus('Markdown \u5df2\u5bfc\u51fa\u3002', 'success');
    }

    function createShareCardElement() {
      const state = getState();
      const summaryMarkdown = String(state?.summaryMarkdown || '');
      const article = resolveArticle();
      const record = getCurrentRecord() || {};
      const elements = getElements();
      const palette = getShareCardThemePalette();
      const quoteText = buildShareQuoteSnippet(article, quoteMaxChars, { normalizeWhitespace });
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
        '    <span class="share-badge">' + escapeHtml(strings.SITE_TYPE_LABELS?.[article?.sourceType] || '\u901a\u7528\u7f51\u9875') + '</span>',
        '    <span class="share-badge">' + escapeHtml(getStrategyLabel(article?.sourceStrategy, article?.sourceType)) + '</span>',
        '    <span class="share-badge">' + escapeHtml(getModeLabel(record?.summaryMode || elements.summaryModeSelect.value)) + '</span>',
        '  </div>',
        '  <h1 class="share-title">' + escapeHtml(article?.title || '\u672a\u547d\u540d\u9875\u9762') + '</h1>',
        '  <div class="share-source">',
        '    <div class="share-source-label">\u6765\u6e90\u94fe\u63a5</div>',
        '    <div class="share-source-url">' + escapeHtml(article?.normalizedUrl || article?.sourceUrl || '-') + '</div>',
        '  </div>',
        quoteText
          ? '  <div class="share-quote"><div class="share-quote-label">\u539f\u6587\u6458\u5f55 \u00b7 \u6700\u591a ' + quoteMaxChars + ' \u5b57</div><div class="share-quote-text">' + escapeHtml(quoteText) + '</div></div>'
          : '',
        '  <div class="share-content">' + sanitizeMarkdownToHtml(summaryMarkdown || '') + '</div>',
        '  <div class="share-footer">',
        '    <span>\u6765\u6e90\uff1a' + escapeHtml(article?.siteName || article?.sourceHost || '-') + '</span>',
        '    <span>' + escapeHtml(resolveShareModelLabel(record, state?.lastDiagnostics, state?.settings)) + '</span>',
        '  </div>',
        '</div>'
      ].join('');

      return host;
    }

    async function exportShareImage() {
      const state = getState();
      if (!String(state?.summaryMarkdown || '').trim()) return;
      if (state?.trustPolicy?.allowShare === false) {
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
        if (!html2canvasImpl) {
          throw new Error('html2canvas is not available');
        }

        const canvas = await html2canvasImpl(card, {
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
        link.download = sanitizeFilename((getState()?.article?.title || 'summary') + '-\u5206\u4eab\u5361') + '.png';
        link.click();
        setStatus('\u957f\u622a\u56fe\u5df2\u751f\u6210', 'success');
      } catch (error) {
        console.error(error);
        setStatus('\u957f\u622a\u56fe\u751f\u6210\u5931\u8d25\u3002', 'error');
      } finally {
        host.remove();
      }
    }

    return {
      exportMarkdown,
      createShareCardElement,
      exportShareImage
    };
  }

  const api = {
    DEFAULT_SHARE_QUOTE_MAX_CHARS,
    sanitizeFilename,
    buildShareQuoteSnippet,
    resolveShareModelLabel,
    createExportController
  };

  global.YilanSidebarExport = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

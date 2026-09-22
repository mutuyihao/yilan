(function initYilanSidebarExport(global) {
  const I18n = () => global.YilanI18n;
  const DEFAULT_SHARE_QUOTE_MAX_CHARS = 140;

  function normalizeWhitespaceText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function sanitizeFilename(name) {
    return String(name || 'summary')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || 'summary';
  }

  function downloadTextFile(text, options) {
    // Append + click + delayed revoke: the most download-safe order across
    // browsers; revoking immediately after click can cancel slow downloads.
    const blob = new Blob([text], { type: options?.mimeType || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = options?.filename || 'download.txt';
    document.body?.appendChild?.(link);
    link.click();
    link.remove?.();
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    setTimeout(() => revokeObjectURL(url), 1000);
  }

  function buildShareQuoteSnippet(article, maxChars, options) {
    const normalizeWhitespace = options?.normalizeWhitespace || normalizeWhitespaceText;
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
    ].map(normalizeWhitespaceText).find(Boolean);

    return I18n().get('sidebar_share_model_label', [model || '-']);
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
    const loadHtml2Canvas = deps.loadHtml2Canvas || null;
    const strings = deps.strings || {};
    const normalizeWhitespace = deps.normalizeWhitespace || normalizeWhitespaceText;
    const quoteMaxChars = deps.shareQuoteMaxChars || DEFAULT_SHARE_QUOTE_MAX_CHARS;

    let html2canvasPromise = null;

    // html2canvas (~198KB) is only needed for share-card export; load it on
    // first use instead of on every sidebar open. loadHtml2Canvas lets tests
    // (or a host page) provide the implementation; when it yields nothing,
    // the libs/ script is injected once and the resolved global is cached.
    function ensureHtml2Canvas() {
      const provided = typeof loadHtml2Canvas === 'function' ? loadHtml2Canvas() : undefined;
      if (provided) {
        return Promise.resolve(provided);
      }
      if (html2canvasPromise) return html2canvasPromise;

      html2canvasPromise = new Promise((resolve, reject) => {
        if (typeof html2canvas !== 'undefined') {
          resolve(html2canvas);
          return;
        }
        const script = document.createElement('script');
        // sidebar.html sits at the extension root; keep the path relative to it.
        script.src = 'libs/html2canvas.min.js';
        script.onload = () => resolve(typeof html2canvas !== 'undefined' ? html2canvas : null);
        script.onerror = () => {
          html2canvasPromise = null;
          reject(new Error('Failed to load html2canvas'));
        };
        document.head.appendChild(script);
      });
      return html2canvasPromise;
    }

    function getSummaryMarkdown() {
      return String(getState()?.summaryMarkdown || '');
    }

    function resolveArticle() {
      return getCurrentArticle() || createArticleFromRecord(getCurrentRecord());
    }

    function getVideoDiagnosticsList() {
      const state = getState() || {};
      const article = resolveArticle();
      const record = getCurrentRecord();
      return [
        article?.diagnostics,
        record?.articleSnapshot?.diagnostics,
        record?.diagnostics?.article?.diagnostics,
        state.lastDiagnostics?.article?.diagnostics
      ].filter(Boolean);
    }

    function getVideoDiagnostics(provider) {
      for (const diagnostics of getVideoDiagnosticsList()) {
        if (provider && diagnostics?.[provider]) return diagnostics[provider];
        if (!provider && (diagnostics?.youtube || diagnostics?.bilibili)) {
          return diagnostics.youtube || diagnostics.bilibili;
        }
      }

      return null;
    }

    function getCurrentVideoProvider() {
      const article = resolveArticle();
      const record = getCurrentRecord();
      const diagnostics = article?.diagnostics ||
        record?.articleSnapshot?.diagnostics ||
        record?.diagnostics?.article?.diagnostics ||
        null;
      if (diagnostics?.videoSource) return String(diagnostics.videoSource);
      if (diagnostics?.youtube) return 'youtube';
      if (diagnostics?.bilibili) return 'bilibili';
      return '';
    }

    function getBilibiliDiagnostics() {
      return getVideoDiagnostics('bilibili');
    }

    function getYoutubeDiagnostics() {
      return getVideoDiagnostics('youtube');
    }

    function buildSubtitleArtifact(payload, provider, extra) {
      if (!payload) return null;
      const text = String(payload.text || '').trim();
      if (provider === 'youtube' && text) {
        return Object.assign({
          text,
          extension: 'txt',
          mimeType: 'text/plain;charset=utf-8',
          provider
        }, extra || {});
      }

      const jsonText = String(payload.jsonText || '').trim();
      if (jsonText) {
        return Object.assign({
          text: jsonText,
          extension: 'json',
          mimeType: 'application/json;charset=utf-8',
          provider
        }, extra || {});
      }

      if (text) {
        return Object.assign({
          text,
          extension: 'txt',
          mimeType: 'text/plain;charset=utf-8',
          provider
        }, extra || {});
      }

      return null;
    }

    function getProviderLabelForSubtitle(provider) {
      if (provider === 'youtube') return 'YouTube';
      if (provider === 'bilibili') return 'Bilibili';
      return provider || 'video';
    }

    function getCaptionLanguageLabel(payload) {
      return [
        payload?.selectedLanguageName || payload?.languageName || '',
        payload?.selectedLanguageCode || payload?.languageCode || ''
      ].filter(Boolean).join(' / ');
    }

    function getSubtitleArtifactForProvider(provider) {
      for (const diagnostics of getVideoDiagnosticsList()) {
        const payload = provider === 'youtube'
          ? diagnostics?.youtube?.debug?.captions
          : diagnostics?.bilibili?.debug?.subtitles;
        const artifact = buildSubtitleArtifact(payload || null, provider, {
          languageCode: payload?.selectedLanguageCode || payload?.languageCode || '',
          languageName: payload?.selectedLanguageName || payload?.languageName || '',
          isAutomatic: !!payload?.isAutomatic,
          isTranslated: !!payload?.isTranslated,
          sourceLanguageCode: payload?.sourceLanguageCode || '',
          sourceLanguageName: payload?.sourceLanguageName || '',
          translationLanguageCode: payload?.translationLanguageCode || '',
          translationLanguageName: payload?.translationLanguageName || '',
          suffix: [
            'subtitle',
            payload?.selectedLanguageCode || payload?.languageCode || payload?.selectedLanguageName || payload?.languageName || ''
          ].filter(Boolean).join('-')
        });
        if (artifact) return artifact;
      }

      return null;
    }

    function getCurrentSubtitleOption(provider) {
      const artifact = provider === 'youtube'
        ? getYoutubeSubtitleArtifact()
        : getBilibiliSubtitleArtifact();
      if (!artifact) return null;

      const language = getCaptionLanguageLabel(artifact);
      return {
        key: provider + '-current',
        type: 'artifact',
        provider,
        label: [I18n().get('sidebar_subtitle_current'), getProviderLabelForSubtitle(provider), language].filter(Boolean).join(' · '),
        artifact
      };
    }

    function getVideoSubtitleOptions() {
      const provider = getCurrentVideoProvider();
      const options = [];

      if (provider === 'youtube') {
        const current = getCurrentSubtitleOption('youtube');
        return current ? [current] : [];
      }

      if (provider === 'bilibili') {
        const current = getCurrentSubtitleOption('bilibili');
        return current ? [current] : [];
      }

      const youtubeCurrent = getCurrentSubtitleOption('youtube');
      const bilibiliCurrent = getCurrentSubtitleOption('bilibili');
      if (youtubeCurrent) options.push(youtubeCurrent);
      if (bilibiliCurrent) options.push(bilibiliCurrent);
      return options;
    }

    function getBilibiliSubtitleArtifact() {
      return getSubtitleArtifactForProvider('bilibili');
    }

    function getYoutubeSubtitleArtifact() {
      return getSubtitleArtifactForProvider('youtube');
    }

    function getVideoSubtitleArtifact() {
      const provider = getCurrentVideoProvider();
      if (provider === 'youtube') return getYoutubeSubtitleArtifact();
      if (provider === 'bilibili') return getBilibiliSubtitleArtifact();
      return getYoutubeSubtitleArtifact() || getBilibiliSubtitleArtifact();
    }

    function hasBilibiliSubtitleArtifact() {
      return !!getBilibiliSubtitleArtifact();
    }

    function hasVideoSubtitleArtifact() {
      return getVideoSubtitleOptions().length > 0;
    }

    async function buildArtifactFromOption(option) {
      if (!option) return null;
      if (option.type === 'artifact') return option.artifact || null;
      return null;
    }

    function downloadSubtitleArtifact(artifact) {
      const text = String(artifact?.text || '');
      if (!text.trim()) {
        setStatus(I18n().get('sidebar_subtitle_empty_track'), 'warning');
        return false;
      }

      const article = resolveArticle();
      downloadTextFile(text, {
        mimeType: artifact.mimeType,
        filename: sanitizeFilename((article?.title || artifact.provider || 'video') + '-' + (artifact.suffix || 'subtitle')) + '.' + artifact.extension
      });
      return true;
    }

    async function exportVideoSubtitle() {
      const options = getVideoSubtitleOptions();
      const selectedKey = String(getElements()?.subtitleTrackSelect?.value || '');
      const option = options.find((item) => item.key === selectedKey) || options[0] || null;
      const artifact = await buildArtifactFromOption(option);
      if (!artifact) {
        setStatus(I18n().get('sidebar_video_no_subtitles'), 'warning');
        return;
      }

      if (downloadSubtitleArtifact(artifact)) {
        setStatus(I18n().get('sidebar_subtitle_exported'), 'success');
      }
    }

    function exportBilibiliSubtitle() {
      const artifact = getBilibiliSubtitleArtifact();
      if (!artifact) {
        setStatus(I18n().get('sidebar_bilibili_no_subtitles'), 'warning');
        return;
      }

      const article = resolveArticle();
      downloadTextFile(artifact.text, {
        mimeType: artifact.mimeType,
        filename: sanitizeFilename((article?.title || 'bilibili-video') + I18n().get('sidebar_file_subtitles')) + '.' + artifact.extension
      });
      setStatus(I18n().get('sidebar_subtitle_exported'), 'success');
    }

    function exportMarkdown() {
      const summaryMarkdown = getSummaryMarkdown();
      if (!summaryMarkdown.trim()) return;

      const article = resolveArticle();
      const record = getCurrentRecord();
      const elements = getElements();
      const header = [
        '# ' + (record?.summaryTitle || article?.title || I18n().get('sidebar_unnamed_page')),
        '',
        '> ' + I18n().get('sidebar_md_source') + (article?.normalizedUrl || article?.sourceUrl || '-'),
        '> ' + I18n().get('sidebar_md_site') + (article?.sourceHost || '-'),
        '> ' + I18n().get('sidebar_md_mode') + getModeLabel(record?.summaryMode || elements.summaryModeSelect.value),
        '> ' + I18n().get('sidebar_md_generated_at') + formatDateTime(record?.completedAt || new Date().toISOString()),
        '',
        '---',
        ''
      ].join('\n');

      downloadTextFile(header + summaryMarkdown, {
        mimeType: 'text/markdown;charset=utf-8',
        filename: sanitizeFilename(article?.title || 'summary') + '.md'
      });
      setStatus(I18n().get('sidebar_markdown_exported'), 'success');
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
        '        <div class="share-subtitle">' + I18n().get('sidebar_share_subtitle') + '</div>',
        '      </div>',
        '    </div>',
        '    <div class="share-subtitle">' + escapeHtml(formatDateTime(record?.completedAt || new Date().toISOString())) + '</div>',
        '  </div>',
        '  <div class="share-badges">',
        '    <span class="share-badge">' + escapeHtml(article?.sourceHost || I18n().get('sidebar_share_unknown_source')) + '</span>',
        '    <span class="share-badge">' + escapeHtml(strings.SITE_TYPE_LABELS?.[article?.sourceType] || I18n().get('sidebar_generic_page')) + '</span>',
        '    <span class="share-badge">' + escapeHtml(getStrategyLabel(article?.sourceStrategy, article?.sourceType)) + '</span>',
        '    <span class="share-badge">' + escapeHtml(getModeLabel(record?.summaryMode || elements.summaryModeSelect.value)) + '</span>',
        '  </div>',
        '  <h1 class="share-title">' + escapeHtml(article?.title || I18n().get('sidebar_unnamed_page')) + '</h1>',
        '  <div class="share-source">',
        '    <div class="share-source-label">' + I18n().get('sidebar_share_source_label') + '</div>',
        '    <div class="share-source-url">' + escapeHtml(article?.normalizedUrl || article?.sourceUrl || '-') + '</div>',
        '  </div>',
        quoteText
          ? '  <div class="share-quote"><div class="share-quote-label">' + I18n().get('sidebar_share_quote_label', [quoteMaxChars]) + '</div><div class="share-quote-text">' + escapeHtml(quoteText) + '</div></div>'
          : '',
        '  <div class="share-content">' + sanitizeMarkdownToHtml(summaryMarkdown || '') + '</div>',
        '  <div class="share-footer">',
        '    <span>' + I18n().get('sidebar_share_from') + escapeHtml(article?.siteName || article?.sourceHost || '-') + '</span>',
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
        setStatus(I18n().get('sidebar_share_disabled'), 'warning');
        return;
      }

      const host = createShareCardElement();
      document.body.appendChild(host);
      setStatus(I18n().get('sidebar_share_generating'));

      try {
        await wait(120);
        if (document.fonts?.ready) {
          await Promise.race([document.fonts.ready, wait(1200)]);
        }

        const card = host.querySelector('.share-card');
        const width = Math.ceil(card.scrollWidth);
        const height = Math.ceil(card.scrollHeight);
        const html2canvasImpl = await ensureHtml2Canvas();
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
        link.download = sanitizeFilename((getState()?.article?.title || 'summary') + I18n().get('sidebar_file_share_card')) + '.png';
        link.click();
        setStatus(I18n().get('sidebar_share_done'), 'success');
      } catch (error) {
        console.error(error);
        setStatus(I18n().get('sidebar_share_failed'), 'error');
      } finally {
        host.remove();
      }
    }

    return {
      exportMarkdown,
      exportVideoSubtitle,
      exportBilibiliSubtitle,
      getVideoSubtitleOptions,
      hasVideoSubtitleArtifact,
      hasBilibiliSubtitleArtifact,
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

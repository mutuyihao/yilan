(function initYilanSidebarRender(global) {
  const globalAny = /** @type {any} */ (global);
  const STREAM_RENDER_INTERVAL_MS = 90;
  const MARKDOWN_SANITIZE_OPTIONS = {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['class', 'target', 'rel', 'align']
  };

  function createRenderController(deps) {
    const state = deps.state;
    const elements = deps.elements;
    const summaryModeController = deps.summaryModeController;
    const domPurify = deps.DOMPurify || globalAny.DOMPurify;
    const markedImpl = deps.marked || globalAny.marked;
    const hljsImpl = deps.hljs || globalAny.hljs;
    const escapeHtml = deps.escapeHtml;
    const stripMarkdownPreview = deps.stripMarkdownPreview;
    const buildCancelledStateModel = deps.buildCancelledStateModel;
    const buildDiagnosticsPanelModel = deps.buildDiagnosticsPanelModel;
    const buildArticleMetaView = deps.buildArticleMetaView;
    const buildTrustCardView = deps.buildTrustCardView;
    const normalizeUiError = deps.normalizeUiError;
    const errors = deps.errors;
    const createArticleFromRecord = deps.createArticleFromRecord;
    const windowRef = deps.window || global;
    const performanceRef = deps.performance || global.performance;
    let renderScheduled = false;
    let renderTimeoutId = 0;
    let renderFrameId = 0;
    let lastMarkdownRenderAt = 0;

    if (markedImpl?.setOptions) {
      markedImpl.setOptions({
        breaks: true,
        gfm: true,
        highlight(code, lang) {
          if (lang && hljsImpl?.getLanguage?.(lang)) {
            return hljsImpl.highlight(code, { language: lang }).value;
          }
          return hljsImpl?.highlightAuto?.(code)?.value || code;
        }
      });
    }

    function parseMarkdown(markdown) {
      return markedImpl.parse(markdown || '');
    }

    function renderSanitizedMarkdownFragment(container, markdown) {
      const fragment = domPurify.sanitize(parseMarkdown(markdown), {
        ...MARKDOWN_SANITIZE_OPTIONS,
        RETURN_DOM_FRAGMENT: true
      });
      container.replaceChildren(fragment);
    }

    function sanitizeMarkdownToHtml(markdown) {
      return domPurify.sanitize(parseMarkdown(markdown), MARKDOWN_SANITIZE_OPTIONS);
    }

    function setStatus(text, tone) {
      elements.statusText.textContent = text || '\u5c31\u7eea';
      elements.statusText.className = 'status-text';
      if (tone === 'success') elements.statusText.classList.add('status-success');
      if (tone === 'warning') elements.statusText.classList.add('status-warning');
      if (tone === 'error') elements.statusText.classList.add('status-error');
      elements.statusText.classList.toggle('status-active', state.generating);
    }

    function setStats() {
      elements.statsText.textContent = '';
    }

    function updateStatsFromMarkdown() {
      setStats();
    }

    function highlightBlocks(root) {
      root.querySelectorAll('pre code').forEach((block) => {
        hljsImpl?.highlightElement?.(block);
      });
    }

    function getNowMs() {
      return typeof performanceRef !== 'undefined' && typeof performanceRef.now === 'function'
        ? performanceRef.now()
        : Date.now();
    }

    function cancelScheduledMarkdownRender() {
      if (renderTimeoutId) {
        (windowRef.clearTimeout || clearTimeout)(renderTimeoutId);
        renderTimeoutId = 0;
      }
      if (renderFrameId) {
        const cancelFrame = windowRef.cancelAnimationFrame || global.cancelAnimationFrame;
        if (cancelFrame) {
          cancelFrame(renderFrameId);
        }
        renderFrameId = 0;
      }
      renderScheduled = false;
    }

    function requestFrame(callback) {
      const requestAnimationFrame = windowRef.requestAnimationFrame || global.requestAnimationFrame;
      if (requestAnimationFrame) {
        return requestAnimationFrame(callback);
      }
      return (windowRef.setTimeout || setTimeout)(callback, 0);
    }

    function scheduleMarkdownRender() {
      if (renderScheduled) return;
      renderScheduled = true;
      const delay = Math.max(0, STREAM_RENDER_INTERVAL_MS - (getNowMs() - lastMarkdownRenderAt));
      renderTimeoutId = (windowRef.setTimeout || setTimeout)(() => {
        renderTimeoutId = 0;
        renderFrameId = requestFrame(() => {
          renderFrameId = 0;
          renderScheduled = false;
          lastMarkdownRenderAt = getNowMs();
          renderMarkdown(state.summaryMarkdown, { highlight: false, clearPending: false });
          updateStatsFromMarkdown();
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
        '<div class="placeholder-icon">\u89c8</div>',
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
            '<span>\u5904\u7406\u4e2d</span>',
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

    function renderCancelledState(record, errorLike, diagnostics) {
      cancelScheduledMarkdownRender();
      const safeDiagnostics = diagnostics || state.lastDiagnostics || null;
      const safeError = normalizeUiError(errorLike || errors.createError(errors.ERROR_CODES.RUN_CANCELLED));
      const cancelledView = buildCancelledStateModel(record, safeDiagnostics, state.summaryMarkdown);
      const partial = cancelledView.partial;
      const info = cancelledView.info;
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
        cancelledView.facts.length ? '<ul class="cancelled-meta-list">' + cancelledView.facts.map((item) => '<li>' + escapeHtml(item) + '</li>').join('') + '</ul>' : '',
        detail,
        '</div>',
        partialHtml
      ].join('');

      highlightBlocks(elements.summaryRoot);
    }

    function renderChunkProgress(completed, total, partialSummaries) {
      const recent = partialSummaries.slice(-2).map((item) => {
        return '<li>' + escapeHtml(stripMarkdownPreview(item, 140) || '\u5206\u6bb5\u5904\u7406\u5b8c\u6210') + '</li>';
      }).join('');

      renderInlineNote(
        '\u6b63\u5728\u5206\u6bb5\u603b\u7ed3\u957f\u6587',
        '\u5df2\u5b8c\u6210 ' + completed + '/' + total + ' \u4e2a\u5206\u6bb5\uff0c\u6b63\u5728\u6574\u7406\u4e2d\u3002',
        recent ? '<ul style="margin-top:10px">' + recent + '</ul>' : ''
      );
    }

    function setBadgeTone(element, tone) {
      if (!element) return;
      element.classList.remove('badge-accent', 'badge-soft', 'badge-success', 'badge-warning', 'badge-danger');
      if (tone) {
        element.classList.add('badge-' + tone);
      }
    }

    function renderTrustCard(article) {
      const trustView = buildTrustCardView(article, state.settings);
      state.trustPolicy = trustView.policy;

      elements.trustTitle.textContent = trustView.title;
      elements.trustSummary.textContent = trustView.summary;
      elements.trustModeBadge.textContent = trustView.modeBadge;
      elements.trustHistoryBadge.textContent = trustView.historyBadge;
      elements.trustShareBadge.textContent = trustView.shareBadge;
      elements.trustSendValue.textContent = trustView.sendValue;
      elements.trustSendNote.textContent = trustView.sendNote;
      elements.trustHistoryValue.textContent = trustView.historyValue;
      elements.trustHistoryNote.textContent = trustView.historyNote;
      elements.trustShareValue.textContent = trustView.shareValue;
      elements.trustShareNote.textContent = trustView.shareNote;
      elements.privacyToggleBtn.textContent = trustView.privacyToggleLabel;
      elements.privacyToggleBtn.classList.toggle('action-btn-primary', trustView.privacyTogglePrimary);

      setBadgeTone(elements.trustModeBadge, trustView.modeTone);
      setBadgeTone(elements.trustHistoryBadge, trustView.historyTone);
      setBadgeTone(elements.trustShareBadge, trustView.shareTone);
    }

    function renderArticleMeta(article, record) {
      const currentArticle = article || createArticleFromRecord(record);
      const modeKey = record?.summaryMode || elements.summaryModeSelect.value || 'medium';
      const safeModeKey = summaryModeController.getSafeMode(modeKey);
      const metaView = buildArticleMetaView(currentArticle, {
        summaryMode: modeKey,
        simpleModeEnabled: !!state.settings?.entrypointSimpleMode && safeModeKey === 'short'
      });

      elements.articleTitle.textContent = metaView.title;
      elements.sourceLink.textContent = metaView.sourceText;
      elements.sourceLink.href = metaView.sourceHref;
      elements.hostBadge.textContent = metaView.hostLabel;
      elements.siteTypeBadge.textContent = metaView.siteTypeLabel;
      elements.strategyBadge.textContent = metaView.strategyLabel;
      elements.modeBadge.textContent = metaView.modeLabel;
      [
        [elements.authorValue, metaView.authorLabel],
        [elements.publishedValue, metaView.publishedLabel],
        [elements.lengthValue, metaView.lengthLabel],
        [elements.chunkValue, metaView.chunkLabel]
      ].forEach(([element, text]) => {
        element.textContent = text;
        element.title = text;
      });
      elements.warningList.innerHTML = metaView.warnings.map((item) => '<span class="warning-chip">' + escapeHtml(item) + '</span>').join('');
      renderTrustCard(currentArticle);
    }

    function renderDiagnostics() {
      const diagnosticsView = buildDiagnosticsPanelModel(state.visibleRecord, state.lastDiagnostics, state.summaryMarkdown);

      if (elements.diagnosticsToggle) {
        elements.diagnosticsToggle.textContent = diagnosticsView.toggleLabel;
        elements.diagnosticsToggle.title = diagnosticsView.toggleLabel;
      }

      if (diagnosticsView.shouldAutoOpen) {
        elements.diagnosticsBlock.open = true;
      }

      elements.diagnosticsPre.textContent = state.lastDiagnostics
        ? diagnosticsView.summaryText + '\n\n--- \u539f\u59cb\u8bca\u65ad JSON ---\n' + JSON.stringify(state.lastDiagnostics, null, 2)
        : diagnosticsView.summaryText;
    }

    return {
      cancelScheduledMarkdownRender,
      renderArticleMeta,
      renderCancelledState,
      renderChunkProgress,
      renderDiagnostics,
      renderErrorBox,
      renderInlineNote,
      renderMarkdown,
      renderPlaceholder,
      renderTrustCard,
      sanitizeMarkdownToHtml,
      scheduleMarkdownRender,
      setStats,
      setStatus,
      updateStatsFromMarkdown
    };
  }

  const api = {
    createRenderController
  };

  globalAny.YilanSidebarRender = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

(function initYilanSidebarGeneration(global) {
  const I18n = () => global.YilanI18n;
  const ChromeApi = global.YilanChromeApi || (typeof require === 'function' ? require('../shared/chrome-api.js') : null);

  function readDefaultRuntimeLastErrorMessage() {
    if (ChromeApi?.readRuntimeLastErrorMessage) return ChromeApi.readRuntimeLastErrorMessage();
    return typeof chrome !== 'undefined' ? (chrome.runtime.lastError?.message || '') : '';
  }

  function buildStreamStartStatus(meta) {
    if (meta?.stage === 'synthesis') return I18n().get('sidebar_stream_synthesis');
    if (meta?.stage === 'chunk') {
      if (typeof meta?.chunkIndex === 'number' && typeof meta?.chunkCount === 'number') {
        return I18n().get('sidebar_stream_chunk_index', [meta.chunkIndex + 1, meta.chunkCount]);
      }
      return I18n().get('sidebar_stream_chunk');
    }
    return I18n().get('sidebar_stream_generating');
  }

  function buildStreamRetryStatus(meta, attempt) {
    const prefix = meta?.stage === 'chunk'
      ? buildStreamStartStatus(meta).replace(/\.\.\.$/, '')
      : meta?.stage === 'synthesis'
        ? I18n().get('sidebar_stream_synthesis_short')
        : I18n().get('sidebar_stream_generating_short');
    return I18n().get('sidebar_stream_retry', [prefix, attempt]);
  }

  function createGenerationController(deps) {
    const getState = deps.getState;
    const getElements = deps.getElements;
    const recordStore = deps.recordStore;
    const domain = deps.domain;
    const errors = deps.errors;
    const articleUtils = deps.articleUtils;
    const runUtils = deps.runUtils;
    const trust = deps.trust;
    const loadRuntimeSettings = deps.loadRuntimeSettings;
    const ensureArticleReady = deps.ensureArticleReady;
    const withCustomPrompt = deps.withCustomPrompt;
    const getTargetLanguage = deps.getTargetLanguage;
    const createDraftRecord = deps.createDraftRecord;
    const finalizeRecord = deps.finalizeRecord;
    const normalizeUiError = deps.normalizeUiError;
    const composeDiagnostics = deps.composeDiagnostics;
    const markdownToPlainText = deps.markdownToPlainText;
    const extractBullets = deps.extractBullets;
    const getModeLabel = deps.getModeLabel;
    const renderErrorBox = deps.renderErrorBox;
    const renderDiagnostics = deps.renderDiagnostics;
    const renderArticleMeta = deps.renderArticleMeta;
    const renderInlineNote = deps.renderInlineNote;
    const setStatus = deps.setStatus;
    const refreshActionStates = deps.refreshActionStates;
    const renderChunkProgress = deps.renderChunkProgress;
    const scheduleMarkdownRender = deps.scheduleMarkdownRender;
    const bindVisibleRecord = deps.bindVisibleRecord;
    const getHistoryController = deps.getHistoryController;
    const applyPendingNavigationPayload = deps.applyPendingNavigationPayload;
    const runtimeSendMessage = deps.runtimeSendMessage;
    const connectStream = deps.connectStream || (() => chrome.runtime.connect({ name: 'ai-stream' }));
    const readRuntimeLastErrorMessage = deps.readRuntimeLastErrorMessage || readDefaultRuntimeLastErrorMessage;

    function getActiveRunIds() {
      const state = getState();
      if (!state.activeRunIds || typeof state.activeRunIds.add !== 'function') {
        state.activeRunIds = new Set();
      }
      return state.activeRunIds;
    }

    function hasBilibiliDiagnostics(article) {
      return !!(article?.diagnostics?.videoSource === 'bilibili' || article?.diagnostics?.bilibili);
    }

    function buildInitialArticleDiagnostics(article) {
      if (!hasBilibiliDiagnostics(article)) return null;
      return composeDiagnostics(article, [], {
        status: 'starting',
        stage: 'primary',
        articleId: article.articleId,
        chunkCount: article.chunkCount
      }, null);
    }

    function sanitizeDiagnosticsForPersistence(diagnostics) {
      return runUtils.sanitizeDiagnosticsForPersistence
        ? runUtils.sanitizeDiagnosticsForPersistence(diagnostics)
        : diagnostics;
    }

    function bindSavedRecord(savedRecord, liveDiagnostics) {
      bindVisibleRecord(savedRecord);
      if (liveDiagnostics) {
        getState().lastDiagnostics = liveDiagnostics;
        renderDiagnostics();
      }
    }

    function beginRunAbortController() {
      const state = getState();
      state.runAbortController = new AbortController();
      return state.runAbortController.signal;
    }

    function abortCurrentRun(reason) {
      const state = getState();
      if (!state.runAbortController || state.runAbortController.signal.aborted) return;
      try {
        state.runAbortController.abort(reason || 'user');
      } catch (error) {
        console.warn('[Sidebar] Failed to abort current run:', error);
      }
    }

    function clearRunAbortController() {
      getState().runAbortController = null;
    }

    function createCancelledUiError(meta, runId) {
      return normalizeUiError(errors.createError(errors.ERROR_CODES.RUN_CANCELLED, {
        stage: meta?.stage || '',
        diagnostics: {
          runId: runId || '',
          stage: meta?.stage || '',
          status: 'cancelled',
          chunkIndex: typeof meta?.chunkIndex === 'number' ? meta.chunkIndex : null,
          chunkCount: typeof meta?.chunkCount === 'number' ? meta.chunkCount : null,
          articleId: meta?.articleId || ''
        }
      }));
    }

    function safeDisconnectPort() {
      const state = getState();
      if (!state.activePort) return;
      try {
        state.activePort.disconnect();
      } catch (error) {
        console.warn('[Sidebar] Failed to disconnect port:', error);
      }
      state.activePort = null;
      state.activeStreamRunId = '';
    }

    function addActiveRun(runId) {
      getActiveRunIds().add(runId);
    }

    function removeActiveRun(runId) {
      getActiveRunIds().delete(runId);
    }

    async function cancelGeneration() {
      const state = getState();
      if (!state.generating || state.cancelRequested) return;
      state.cancelRequested = true;
      setStatus(I18n().get('sidebar_cancelling'), 'warning');

      refreshActionStates();
      abortCurrentRun('user_cancelled');

      const runIds = Array.from(getActiveRunIds());
      if (state.activePort && state.activeStreamRunId) {
        try {
          state.activePort.postMessage({ action: 'cancelRun', runId: state.activeStreamRunId });
        } catch {}
      }

      safeDisconnectPort();
      // allSettled never rejects; the per-run results only feed the run-state
      // map inside the background worker and need no local handling.
      Promise.allSettled(runIds.map((runId) => runtimeSendMessage({ action: 'cancelRun', runId })));
    }

    function runPromptViaStream(settings, prompt, meta, signal, handlers) {
      return new Promise((resolve, reject) => {
        const runId = domain.createRuntimeId('run');
        const port = connectStream();
        const options = handlers || {};
        const state = getState();
        let settled = false;
        let text = '';
        let heartbeatTimer = null;

        state.activePort = port;
        state.activeStreamRunId = runId;
        addActiveRun(runId);

        // Pinging the service worker mid-run keeps the MV3 worker alive while
        // a long request has no other events to deliver.
        function startHeartbeat() {
          stopHeartbeat();
          heartbeatTimer = setInterval(() => {
            try {
              port.postMessage({ action: 'ping', runId });
            } catch {}
          }, (global.AISummaryConstants && global.AISummaryConstants.STREAM_HEARTBEAT_INTERVAL_MS) || 20000);
        }

        function stopHeartbeat() {
          if (heartbeatTimer === null) return;
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }

        function cleanup() {
          if (settled) return;
          settled = true;
          stopHeartbeat();
          removeActiveRun(runId);
          signal?.removeEventListener('abort', onAbort);
          if (getState().activePort === port) {
            safeDisconnectPort();
          } else {
            // A concurrent run has taken over the tracked port; close this
            // run's own port so it does not linger after the run finished.
            try {
              port.disconnect();
            } catch {}
          }
        }

        function onAbort() {
          cleanup();
          reject(createCancelledUiError(meta, runId));
        }

        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });

        port.onMessage.addListener((message) => {
          if (message.runId !== runId) return;

          if (message.type === 'started') {
            if (typeof options.onStarted === 'function') {
              options.onStarted(message);
            }
            return;
          }

          if (message.type === 'retry') {
            // The provider re-runs the request from scratch; drop tokens
            // accumulated by the aborted attempt so the retried attempt does
            // not append to partial output (which would duplicate copy on
            // screen and in the saved record).
            text = '';
            getState().summaryMarkdown = '';
            scheduleMarkdownRender();
            if (typeof options.onRetry === 'function') {
              options.onRetry(message.retry || {}, message);
            }
            return;
          }

          if (message.type === 'token') {
            const token = String(message.token || '');
            if (!token) return;
            text += token;
            if (typeof options.onToken === 'function') {
              options.onToken(token, text, message);
            }
            return;
          }

          if (message.type === 'tokens') {
            // Background coalesces streamed deltas into one message per flush
            // interval; the concatenated string appends exactly like the
            // per-token messages it replaces.
            const tokens = String(message.tokens || '');
            if (!tokens) return;
            text += tokens;
            if (typeof options.onToken === 'function') {
              options.onToken(tokens, text, message);
            }
            return;
          }

          if (message.type === 'done') {
            const finalText = String(message.text || '');
            if (finalText && !text) {
              text = finalText;
              if (typeof options.onToken === 'function') {
                options.onToken(finalText, text, Object.assign({}, message, { syntheticFinal: true }));
              }
            }
            const diagnostics = message.diagnostics || null;
            cleanup();
            resolve({ text, diagnostics, usage: message.usage || null });
            return;
          }

          if (message.type === 'cancelled' || message.type === 'error') {
            const error = normalizeUiError(Object.assign({}, message.error || {}, { diagnostics: message.diagnostics || null }));
            cleanup();
            reject(error);
          }
        });

        port.onDisconnect.addListener(() => {
          const disconnectReason = readRuntimeLastErrorMessage();
          if (settled) return;
          cleanup();
          reject(getState().cancelRequested
            ? createCancelledUiError(meta, runId)
            : normalizeUiError(errors.createError(errors.ERROR_CODES.NETWORK_STREAM_DISCONNECTED, {
                stage: meta?.stage || '',
                detail: disconnectReason || 'stream_disconnected'
              }))
          );
        });

        port.postMessage({
          action: 'startStream',
          settings,
          prompt,
          runId,
          meta
        });
        startHeartbeat();
      });
    }

    function streamPrompt(settings, prompt, meta, signal) {
      return runPromptViaStream(settings, prompt, meta, signal, {
        onStarted() {
          setStatus(buildStreamStartStatus(meta));
        },
        onRetry(retry) {
          const attempt = retry?.attempt || 1;
          setStatus(buildStreamRetryStatus(meta, attempt), 'warning');
        },
        onToken(token) {
          const state = getState();
          state.summaryMarkdown += token;
          scheduleMarkdownRender();
        }
      });
    }

    function runChunkPrompt(settings, prompt, meta, signal) {
      return runPromptViaStream(settings, prompt, meta, signal, {
        onStarted() {
          setStatus(buildStreamStartStatus(meta));
        },
        onRetry(retry) {
          const attempt = retry?.attempt || 1;
          setStatus(buildStreamRetryStatus(meta, attempt), 'warning');
        }
      });
    }

    async function persistRecord(record) {
      const saved = await recordStore.saveRecord(record);
      getState().visibleRecord = saved;
      return saved;
    }

    function getBilibiliSourceKind(article) {
      return article?.diagnostics?.videoSourceKind ||
        article?.diagnostics?.bilibili?.sourceKind ||
        '';
    }

    function getBilibiliOfficialSummaryMarkdown(article) {
      if (getBilibiliSourceKind(article) !== 'official_ai_summary') return '';
      return String(article?.cleanText || article?.content || '').trim();
    }

    async function completeWithBilibiliOfficialSummary(article, settings, summaryMode, trustPolicy) {
      const state = getState();
      const startedAt = Date.now();
      const officialMarkdown = getBilibiliOfficialSummaryMarkdown(article);
      if (!officialMarkdown) return false;

      state.generating = true;
      state.cancelRequested = false;
      state.summaryMarkdown = officialMarkdown;
      state.lastDiagnostics = buildInitialArticleDiagnostics(article);
      renderDiagnostics();
      renderArticleMeta(article, { summaryMode });
      renderInlineNote(
        I18n().get('sidebar_bilibili_note_title'),
        I18n().get('sidebar_bilibili_note_body')
      );
      setStatus(trustPolicy.allowHistory ? I18n().get('sidebar_bilibili_saving') : I18n().get('sidebar_bilibili_showing'));
      refreshActionStates();

      const draftRecord = createDraftRecord(article, settings, summaryMode, 'primary');
      state.visibleRecord = draftRecord;
      const finalRun = {
        runId: draftRecord.runId,
        stage: 'primary',
        provider: 'bilibili',
        adapterId: 'bilibili_official_ai_summary',
        family: 'bilibili',
        endpointMode: 'official_ai_summary',
        model: I18n().get('sidebar_bilibili_model'),
        status: 'completed',
        articleId: article.articleId,
        chunkCount: article.chunkCount,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        retryCount: 0
      };
      const diagnostics = composeDiagnostics(article, [], finalRun, null);
      state.lastDiagnostics = diagnostics;
      renderDiagnostics();

      const persistentDiagnostics = sanitizeDiagnosticsForPersistence(diagnostics);
      const completedRecord = finalizeRecord(draftRecord, runUtils.buildTerminalRecordPatch(draftRecord, persistentDiagnostics, 'completed', {
        summaryMarkdown: state.summaryMarkdown,
        summaryPlainText: markdownToPlainText(state.summaryMarkdown),
        bullets: extractBullets(state.summaryMarkdown),
        usage: null
      }));

      const savedRecord = await persistRecord(completedRecord);
      bindSavedRecord(savedRecord, diagnostics);
      setStatus(completedRecord.allowHistory === false ? I18n().get('sidebar_bilibili_done_nohistory') : I18n().get('sidebar_bilibili_done_saved'), 'success');
      refreshActionStates();

      if (!getElements().historyPanel.classList.contains('hidden')) {
        await getHistoryController().refresh();
      }

      return true;
    }

    async function startPrimarySummary(summaryMode) {
      const state = getState();
      if (state.generating) return;

      const article = state.article;
      const settings = await loadRuntimeSettings();
      const hasDirectOfficialSummary = !!getBilibiliOfficialSummaryMarkdown(article);
      if (!hasDirectOfficialSummary) {
        ensureArticleReady(article);
      }

      const trustPolicy = trust.buildTrustPolicy(article, settings);
      const simpleModeEnabled = !!settings.entrypointSimpleMode && summaryMode === 'short';

      try {
        if (await completeWithBilibiliOfficialSummary(article, settings, summaryMode, trustPolicy)) {
          state.generating = false;
          state.cancelRequested = false;
          clearRunAbortController();
          getActiveRunIds().clear();
          safeDisconnectPort();
          refreshActionStates();
          await applyPendingNavigationPayload();
          return;
        }
      } catch (error) {
        state.generating = false;
        state.cancelRequested = false;
        clearRunAbortController();
        getActiveRunIds().clear();
        safeDisconnectPort();
        refreshActionStates();
        throw error;
      }

      if (!settings.apiKey) {
        throw errors.createError(errors.ERROR_CODES.CONFIG_MISSING_API_KEY);
      }

      state.generating = true;
      state.cancelRequested = false;
      state.summaryMarkdown = '';
      state.lastDiagnostics = buildInitialArticleDiagnostics(article);
      renderDiagnostics();
      renderArticleMeta(article, { summaryMode });
      renderInlineNote(
        simpleModeEnabled ? I18n().get('sidebar_simple_mode_title') : I18n().get('sidebar_preparing_title'),
        simpleModeEnabled && article.chunkCount > 1
          ? I18n().get('sidebar_simple_mode_body')
          : I18n().get('sidebar_preparing_body')
      );
      setStatus(trustPolicy.allowHistory ? I18n().get('sidebar_generating_saving') : I18n().get('sidebar_generating_nohistory'));
      refreshActionStates();

      const runSignal = beginRunAbortController();
      const draftRecord = createDraftRecord(article, settings, summaryMode, 'primary');
      state.visibleRecord = draftRecord;

      const chunkRuns = [];
      let finalRun = null;

      try {
        const partialSummaries = [];

        if (article.chunkCount > 1 && !simpleModeEnabled) {
          setStatus(I18n().get('sidebar_chunking_long'));

          // Run chunks with bounded parallelism; results and diagnostics stay
          // in chunk order so synthesis input matches sequential runs. The
          // user picks the limit (1-4) in the popup; 1 keeps sequential runs.
          const configuredConcurrency = Math.round(Number(settings.chunkConcurrency));
          const fallbackConcurrency = Number(global.AISummaryConstants?.CHUNK_REQUEST_CONCURRENCY) > 0
            ? Number(global.AISummaryConstants.CHUNK_REQUEST_CONCURRENCY)
            : 2;
          const chunkConcurrency = configuredConcurrency >= 1 && configuredConcurrency <= 4
            ? configuredConcurrency
            : fallbackConcurrency;
          const settledResults = [];
          const chunkResults = await runUtils.mapWithConcurrency(
            article.chunks,
            chunkConcurrency,
            async (chunk, index) => {
              if (state.cancelRequested) {
                throw errors.createError(errors.ERROR_CODES.RUN_CANCELLED);
              }

              const prompt = withCustomPrompt(articleUtils.buildChunkPrompt({
                article,
                chunk,
                summaryMode,
                targetLanguage: getTargetLanguage(settings, article)
              }), settings);

              const result = await runChunkPrompt(settings, prompt, {
                stage: 'chunk',
                articleId: article.articleId,
                chunkIndex: chunk.index,
                chunkCount: article.chunkCount
              }, runSignal);
              settledResults[index] = result;
              return result;
            },
            {
              shouldStop: () => state.cancelRequested,
              onSettled: (completed, total) => {
                renderChunkProgress(completed, total, settledResults.filter(Boolean).map((item) => item.text.trim()));
              }
            }
          );

          for (const result of chunkResults) {
            partialSummaries.push(result.text.trim());
            chunkRuns.push(result.diagnostics || null);
          }
          renderChunkProgress(partialSummaries.length, article.chunkCount, partialSummaries);
        }

        if (state.cancelRequested) {
          throw errors.createError(errors.ERROR_CODES.RUN_CANCELLED);
        }

        const prompt = withCustomPrompt(
          partialSummaries.length
            ? articleUtils.buildSynthesisPrompt({
                article,
                partialSummaries,
                summaryMode,
                targetLanguage: getTargetLanguage(settings, article)
              })
            : articleUtils.buildPrimaryPrompt({
                article,
                summaryMode,
                targetLanguage: getTargetLanguage(settings, article)
              }),
          settings
        );

        const streamResult = await streamPrompt(settings, prompt, {
          stage: partialSummaries.length ? 'synthesis' : 'primary',
          articleId: article.articleId,
          chunkCount: article.chunkCount
        }, runSignal);

        finalRun = streamResult.diagnostics || null;
        const diagnostics = composeDiagnostics(article, chunkRuns, finalRun, null);
        state.lastDiagnostics = diagnostics;
        renderDiagnostics();

        const persistentDiagnostics = sanitizeDiagnosticsForPersistence(diagnostics);
        const completedRecord = finalizeRecord(draftRecord, runUtils.buildTerminalRecordPatch(draftRecord, persistentDiagnostics, 'completed', {
          summaryMarkdown: state.summaryMarkdown,
          summaryPlainText: markdownToPlainText(state.summaryMarkdown),
          bullets: extractBullets(state.summaryMarkdown),
          usage: finalRun?.usage || null
        }));

        const savedRecord = await persistRecord(completedRecord);
        bindSavedRecord(savedRecord, diagnostics);
        setStatus(completedRecord.allowHistory === false ? I18n().get('sidebar_completed_nohistory') : I18n().get('sidebar_completed'), 'success');
        refreshActionStates();

        if (!getElements().historyPanel.classList.contains('hidden')) {
          await getHistoryController().refresh();
        }
      } catch (errorLike) {
        const error = normalizeUiError(errorLike);
        const diagnostics = composeDiagnostics(article, chunkRuns, finalRun, error);
        state.lastDiagnostics = diagnostics;
        renderDiagnostics();

        const failedStatus = error.code === errors.ERROR_CODES.RUN_CANCELLED ? 'cancelled' : 'failed';
        const persistentDiagnostics = sanitizeDiagnosticsForPersistence(diagnostics);
        const failedRecord = finalizeRecord(draftRecord, runUtils.buildTerminalRecordPatch(draftRecord, persistentDiagnostics, failedStatus, {
          errorCode: error.code,
          errorMessage: error.message,
          summaryMarkdown: state.summaryMarkdown
        }));

        const savedRecord = await persistRecord(failedRecord);
        bindSavedRecord(savedRecord, diagnostics);
        refreshActionStates();
      } finally {
        state.generating = false;
        state.cancelRequested = false;
        clearRunAbortController();
        getActiveRunIds().clear();
        safeDisconnectPort();
        refreshActionStates();
        await applyPendingNavigationPayload();
      }
    }

    async function startSecondarySummary(mode) {
      const state = getState();
      if (state.generating || !state.article || !state.summaryMarkdown.trim()) return;

      const settings = await loadRuntimeSettings();
      if (!settings.apiKey) {
        renderErrorBox(errors.createError(errors.ERROR_CODES.CONFIG_MISSING_API_KEY));
        setStatus(I18n().get('sidebar_need_api_key'), 'error');
        return;
      }

      const article = state.article;
      const trustPolicy = trust.buildTrustPolicy(article, settings);

      state.generating = true;
      state.cancelRequested = false;
      state.lastDiagnostics = null;
      renderDiagnostics();
      setStatus(trustPolicy.allowHistory ? I18n().get('sidebar_generating_mode', [getModeLabel(mode)]) : I18n().get('sidebar_generating_mode_nohistory', [getModeLabel(mode)]));
      refreshActionStates();

      const runSignal = beginRunAbortController();
      const sourceSummaryHash = domain.hashString(state.summaryMarkdown);
      const draftRecord = createDraftRecord(article, settings, mode, 'secondary', {
        parentRecordId: state.visibleRecord?.recordId || '',
        originSummaryHash: sourceSummaryHash
      });

      const sourceMarkdown = state.summaryMarkdown;
      state.visibleRecord = draftRecord;
      state.summaryMarkdown = '';
      renderArticleMeta(article, { summaryMode: mode });
      renderInlineNote(I18n().get('sidebar_secondary_title'), I18n().get('sidebar_secondary_body', [getModeLabel(mode)]));

      try {
        const prompt = withCustomPrompt(articleUtils.buildSecondaryPrompt({
          article,
          summaryMode: mode,
          targetLanguage: getTargetLanguage(settings, article),
          summaryMarkdown: sourceMarkdown
        }), settings);

        const streamResult = await streamPrompt(settings, prompt, {
          stage: 'secondary',
          articleId: article.articleId,
          chunkCount: article.chunkCount
        }, runSignal);

        const diagnostics = composeDiagnostics(article, [], streamResult.diagnostics || null, null);
        state.lastDiagnostics = diagnostics;
        renderDiagnostics();

        const persistentDiagnostics = sanitizeDiagnosticsForPersistence(diagnostics);
        const completedRecord = finalizeRecord(draftRecord, runUtils.buildTerminalRecordPatch(draftRecord, persistentDiagnostics, 'completed', {
          summaryMarkdown: state.summaryMarkdown,
          summaryPlainText: markdownToPlainText(state.summaryMarkdown),
          bullets: extractBullets(state.summaryMarkdown),
          usage: streamResult.diagnostics?.usage || null
        }));

        const savedRecord = await persistRecord(completedRecord);
        bindSavedRecord(savedRecord, diagnostics);
        setStatus(completedRecord.allowHistory === false ? I18n().get('sidebar_secondary_done_nohistory', [getModeLabel(mode)]) : I18n().get('sidebar_secondary_done', [getModeLabel(mode)]), 'success');
      } catch (errorLike) {
        const error = normalizeUiError(errorLike);
        const diagnostics = composeDiagnostics(article, [], null, error);
        state.lastDiagnostics = diagnostics;
        renderDiagnostics();

        const failedStatus = error.code === errors.ERROR_CODES.RUN_CANCELLED ? 'cancelled' : 'failed';
        const persistentDiagnostics = sanitizeDiagnosticsForPersistence(diagnostics);
        const failedRecord = finalizeRecord(draftRecord, runUtils.buildTerminalRecordPatch(draftRecord, persistentDiagnostics, failedStatus, {
          errorCode: error.code,
          errorMessage: error.message,
          summaryMarkdown: state.summaryMarkdown
        }));

        const savedRecord = await persistRecord(failedRecord);
        bindSavedRecord(savedRecord, diagnostics);
      } finally {
        state.generating = false;
        state.cancelRequested = false;
        clearRunAbortController();
        getActiveRunIds().clear();
        safeDisconnectPort();
        refreshActionStates();
        await applyPendingNavigationPayload();
      }
    }

    return {
      cancelGeneration,
      runPromptViaStream,
      streamPrompt,
      runChunkPrompt,
      persistRecord,
      startPrimarySummary,
      startSecondarySummary
    };
  }

  const api = {
    buildStreamStartStatus,
    buildStreamRetryStatus,
    createGenerationController
  };

  global.YilanSidebarGeneration = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

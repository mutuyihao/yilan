(function initYilanSidebarGeneration(global) {
  function readDefaultRuntimeLastErrorMessage() {
    return typeof chrome !== 'undefined' ? (chrome.runtime.lastError?.message || '') : '';
  }

  function buildStreamStartStatus(meta) {
    if (meta?.stage === 'synthesis') return '\u6b63\u5728\u6c47\u603b\u6700\u7ec8\u7ed3\u679c...';
    if (meta?.stage === 'chunk') {
      if (typeof meta?.chunkIndex === 'number' && typeof meta?.chunkCount === 'number') {
        return '\u6b63\u5728\u603b\u7ed3\u7b2c ' + (meta.chunkIndex + 1) + '/' + meta.chunkCount + ' \u6bb5...';
      }
      return '\u6b63\u5728\u603b\u7ed3\u5f53\u524d\u5206\u6bb5...';
    }
    return '\u6b63\u5728\u751f\u6210\u603b\u7ed3...';
  }

  function buildStreamRetryStatus(meta, attempt) {
    const prefix = meta?.stage === 'chunk'
      ? buildStreamStartStatus(meta).replace(/\.\.\.$/, '')
      : meta?.stage === 'synthesis'
        ? '\u6b63\u5728\u6c47\u603b\u6700\u7ec8\u7ed3\u679c'
        : '\u6b63\u5728\u751f\u6210\u603b\u7ed3';
    return prefix + '\uff0c\u63a5\u53e3\u6ce2\u52a8\uff0c\u6b63\u5728\u8fdb\u884c\u7b2c ' + attempt + ' \u6b21\u91cd\u8bd5...';
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
    const setStats = deps.setStats;
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
      } catch {}
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
      } catch {}
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
      setStatus('\u6b63\u5728\u53d6\u6d88\u672c\u6b21\u751f\u6210...', 'warning');

      refreshActionStates();
      abortCurrentRun('user_cancelled');

      const runIds = Array.from(getActiveRunIds());
      if (state.activePort && state.activeStreamRunId) {
        try {
          state.activePort.postMessage({ action: 'cancelRun', runId: state.activeStreamRunId });
        } catch {}
      }

      safeDisconnectPort();
      Promise.allSettled(runIds.map((runId) => runtimeSendMessage({ action: 'cancelRun', runId }))).catch(() => {});
    }

    function runPromptViaStream(settings, prompt, meta, signal, handlers) {
      return new Promise((resolve, reject) => {
        const runId = domain.createRuntimeId('run');
        const port = connectStream();
        const options = handlers || {};
        const state = getState();
        let settled = false;
        let text = '';

        state.activePort = port;
        state.activeStreamRunId = runId;
        addActiveRun(runId);

        function cleanup() {
          if (settled) return;
          settled = true;
          removeActiveRun(runId);
          signal?.removeEventListener('abort', onAbort);
          if (getState().activePort === port) {
            safeDisconnectPort();
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

    async function startPrimarySummary(summaryMode) {
      const state = getState();
      if (state.generating) return;

      const article = state.article;
      const settings = await loadRuntimeSettings();
      ensureArticleReady(article);

      if (!settings.apiKey) {
        throw errors.createError(errors.ERROR_CODES.CONFIG_MISSING_API_KEY);
      }

      const trustPolicy = trust.buildTrustPolicy(article, settings);
      const simpleModeEnabled = !!settings.entrypointSimpleMode && summaryMode === 'short';

      state.generating = true;
      state.cancelRequested = false;
      state.summaryMarkdown = '';
      state.lastDiagnostics = null;
      renderDiagnostics();
      renderArticleMeta(article, { summaryMode });
      renderInlineNote(
        simpleModeEnabled ? '\u7b80\u5355\u603b\u7ed3\u6a21\u5f0f' : '\u51c6\u5907\u751f\u6210\u6458\u8981',
        simpleModeEnabled && article.chunkCount > 1
          ? '\u5df2\u542f\u7528\u7b80\u5355\u6a21\u5f0f\uff0c\u5c06\u8df3\u8fc7\u957f\u6587\u5206\u6bb5\u4ee5\u8282\u7701 token\u3002'
          : '\u6b63\u5728\u521d\u59cb\u5316\u672c\u6b21\u4efb\u52a1\uff0c\u8bf7\u7a0d\u5019\u3002'
      );
      setStatus(trustPolicy.allowHistory ? '\u6b63\u5728\u63d0\u53d6\u5e76\u751f\u6210\u603b\u7ed3...' : '\u6b63\u5728\u751f\u6210\u5f53\u524d\u9875\u9762\u6458\u8981\uff0c\u672c\u6b21\u4e0d\u4f1a\u5199\u5165\u5386\u53f2...');
      setStats('');
      refreshActionStates();

      const runSignal = beginRunAbortController();
      const draftRecord = createDraftRecord(article, settings, summaryMode, 'primary');
      state.visibleRecord = draftRecord;

      const chunkRuns = [];
      let finalRun = null;

      try {
        const partialSummaries = [];

        if (article.chunkCount > 1 && !simpleModeEnabled) {
          setStatus('\u6b63\u5728\u5206\u6bb5\u5206\u6790\u957f\u6587...');

          for (const chunk of article.chunks) {
            if (state.cancelRequested) {
              throw errors.createError(errors.ERROR_CODES.RUN_CANCELLED);
            }

            renderChunkProgress(partialSummaries.length, article.chunkCount, partialSummaries);
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

            partialSummaries.push(result.text.trim());
            chunkRuns.push(result.diagnostics || null);
            renderChunkProgress(partialSummaries.length, article.chunkCount, partialSummaries);
          }
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

        const completedRecord = finalizeRecord(draftRecord, runUtils.buildTerminalRecordPatch(draftRecord, diagnostics, 'completed', {
          summaryMarkdown: state.summaryMarkdown,
          summaryPlainText: markdownToPlainText(state.summaryMarkdown),
          bullets: extractBullets(state.summaryMarkdown),
          usage: finalRun?.usage || null
        }));

        const savedRecord = await persistRecord(completedRecord);
        bindVisibleRecord(savedRecord);
        setStatus(completedRecord.allowHistory === false ? '\u751f\u6210\u5b8c\u6210\uff0c\u672c\u6b21\u672a\u5199\u5165\u5386\u53f2' : '\u751f\u6210\u5b8c\u6210', 'success');
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
        const failedRecord = finalizeRecord(draftRecord, runUtils.buildTerminalRecordPatch(draftRecord, diagnostics, failedStatus, {
          errorCode: error.code,
          errorMessage: error.message,
          summaryMarkdown: state.summaryMarkdown
        }));

        const savedRecord = await persistRecord(failedRecord);
        bindVisibleRecord(savedRecord);
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
        setStatus('\u8bf7\u5148\u914d\u7f6e API Key', 'error');
        return;
      }

      const article = state.article;
      const trustPolicy = trust.buildTrustPolicy(article, settings);

      state.generating = true;
      state.cancelRequested = false;
      state.lastDiagnostics = null;
      renderDiagnostics();
      setStatus(trustPolicy.allowHistory ? '\u6b63\u5728\u751f\u6210 ' + getModeLabel(mode) + '...' : '\u6b63\u5728\u751f\u6210 ' + getModeLabel(mode) + '\uff0c\u672c\u6b21\u4e0d\u4f1a\u5199\u5165\u5386\u53f2...');
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
      renderInlineNote('\u6b63\u5728\u8fdb\u884c\u4e8c\u6b21\u751f\u6210', '\u57fa\u4e8e\u5f53\u524d\u6458\u8981\u751f\u6210 ' + getModeLabel(mode) + '\u3002');

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

        const completedRecord = finalizeRecord(draftRecord, runUtils.buildTerminalRecordPatch(draftRecord, diagnostics, 'completed', {
          summaryMarkdown: state.summaryMarkdown,
          summaryPlainText: markdownToPlainText(state.summaryMarkdown),
          bullets: extractBullets(state.summaryMarkdown),
          usage: streamResult.diagnostics?.usage || null
        }));

        const savedRecord = await persistRecord(completedRecord);
        bindVisibleRecord(savedRecord);
        setStatus(completedRecord.allowHistory === false ? getModeLabel(mode) + ' \u751f\u6210\u5b8c\u6210\uff0c\u672c\u6b21\u672a\u5199\u5165\u5386\u53f2' : getModeLabel(mode) + ' \u751f\u6210\u5b8c\u6210', 'success');
      } catch (errorLike) {
        const error = normalizeUiError(errorLike);
        const diagnostics = composeDiagnostics(article, [], null, error);
        state.lastDiagnostics = diagnostics;
        renderDiagnostics();

        const failedStatus = error.code === errors.ERROR_CODES.RUN_CANCELLED ? 'cancelled' : 'failed';
        const failedRecord = finalizeRecord(draftRecord, runUtils.buildTerminalRecordPatch(draftRecord, diagnostics, failedStatus, {
          errorCode: error.code,
          errorMessage: error.message,
          summaryMarkdown: state.summaryMarkdown
        }));

        const savedRecord = await persistRecord(failedRecord);
        bindVisibleRecord(savedRecord);
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

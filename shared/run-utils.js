(function (global) {
  function formatDuration(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '0ms';
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) {
      return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's';
    }

    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return minutes + 'm ' + seconds + 's';
  }

  function getRunStageLabel(stage, options) {
    switch (stage) {
      case 'chunk':
        return '\u5206\u6bb5\u603b\u7ed3';
      case 'synthesis':
        return '\u6700\u7ec8\u6c47\u603b';
      case 'secondary':
        return options?.secondaryModeLabel ? options.secondaryModeLabel + ' \u751f\u6210' : '\u7ee7\u7eed\u751f\u6210';
      case 'primary':
      default:
        return '\u4e3b\u6458\u8981\u751f\u6210';
    }
  }

  function getRunStatusLabel(status) {
    switch (status) {
      case 'completed':
        return '\u5df2\u5b8c\u6210';
      case 'failed':
        return '\u5931\u8d25';
      case 'cancelled':
        return '\u5df2\u53d6\u6d88';
      case 'starting':
        return '\u51c6\u5907\u4e2d';
      case 'running':
      default:
        return '\u8fdb\u884c\u4e2d';
    }
  }

  function pickTerminalRun(finalRun, errorLike) {
    return finalRun || errorLike?.diagnostics || null;
  }

  function buildTerminalRecordPatch(baseRecord, diagnostics, status, overrides) {
    const normalizedStatus = status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'completed';
    const safeDiagnostics = diagnostics || null;
    const extra = Object.assign({}, overrides || {});
    const completedAt = extra.completedAt || new Date().toISOString();
    delete extra.completedAt;

    return Object.assign({
      status: normalizedStatus,
      completedAt,
      durationMs: typeof safeDiagnostics?.durationMs === 'number' ? safeDiagnostics.durationMs : (typeof baseRecord?.durationMs === 'number' ? baseRecord.durationMs : 0),
      retryCount: typeof safeDiagnostics?.retryCount === 'number' ? safeDiagnostics.retryCount : (typeof baseRecord?.retryCount === 'number' ? baseRecord.retryCount : 0),
      adapterId: safeDiagnostics?.adapterId || baseRecord?.adapterId || '',
      provider: safeDiagnostics?.provider || baseRecord?.provider || '',
      model: safeDiagnostics?.model || baseRecord?.model || '',
      endpointMode: safeDiagnostics?.endpointMode || baseRecord?.endpointMode || '',
      finishReason: normalizedStatus,
      diagnostics: safeDiagnostics
    }, extra);
  }

  function buildChunkProgressLabel(diagnostics) {
    const safeDiagnostics = diagnostics || {};
    const chunkRuns = Array.isArray(safeDiagnostics.chunkRuns) ? safeDiagnostics.chunkRuns.filter(Boolean) : [];
    const finalRun = safeDiagnostics.finalRun || safeDiagnostics.error?.diagnostics || null;
    const totalChunks = finalRun?.chunkCount || safeDiagnostics.article?.chunkCount || 0;

    if (totalChunks <= 1) return '';

    const completedChunks = chunkRuns.length;
    if (finalRun?.stage === 'chunk' && typeof finalRun.chunkIndex === 'number') {
      return '\u5df2\u5b8c\u6210 ' + completedChunks + '/' + totalChunks + ' \u4e2a\u5206\u6bb5\uff0c\u5f53\u524d\u505c\u5728\u7b2c ' + (finalRun.chunkIndex + 1) + ' \u6bb5\u3002';
    }

    if (finalRun?.stage === 'synthesis') {
      return '\u5df2\u5b8c\u6210 ' + completedChunks + '/' + totalChunks + ' \u4e2a\u5206\u6bb5\uff0c\u5df2\u8fdb\u5165\u6700\u7ec8\u6c47\u603b\u3002';
    }

    return '\u5df2\u5b8c\u6210 ' + completedChunks + '/' + totalChunks + ' \u4e2a\u5206\u6bb5\u3002';
  }

  function describeCancellation(diagnostics, options) {
    const safeDiagnostics = diagnostics || {};
    const finalRun = safeDiagnostics.finalRun || safeDiagnostics.error?.diagnostics || null;
    const stage = finalRun?.stage || safeDiagnostics.error?.stage || '';
    const stageLabel = getRunStageLabel(stage, options);
    const totalChunks = finalRun?.chunkCount || safeDiagnostics.article?.chunkCount || 0;
    const currentChunk = typeof finalRun?.chunkIndex === 'number' ? finalRun.chunkIndex + 1 : 0;
    const hasPartialContent = !!options?.hasPartialContent;
    const chunkProgress = buildChunkProgressLabel(safeDiagnostics);
    let detail = '\u672c\u6b21\u751f\u6210\u5df2\u6309\u4f60\u7684\u64cd\u4f5c\u505c\u6b62\u3002';

    if (stage === 'chunk') {
      detail = currentChunk && totalChunks
        ? '\u5df2\u5728\u7b2c ' + currentChunk + '/' + totalChunks + ' \u4e2a\u5206\u6bb5\u65f6\u505c\u6b62\u3002'
        : '\u5df2\u5728\u5206\u6bb5\u603b\u7ed3\u9636\u6bb5\u505c\u6b62\u3002';
    } else if (stage === 'synthesis') {
      detail = totalChunks > 1
        ? '\u5206\u6bb5\u6574\u7406\u5df2\u5b8c\u6210\uff0c\u5df2\u5728\u6700\u7ec8\u6c47\u603b\u9636\u6bb5\u505c\u6b62\u3002'
        : '\u5df2\u5728\u6700\u7ec8\u6c47\u603b\u9636\u6bb5\u505c\u6b62\u3002';
    } else if (stage === 'secondary') {
      detail = options?.secondaryModeLabel
        ? '\u5df2\u505c\u6b62' + options.secondaryModeLabel + '\u751f\u6210\u3002'
        : '\u5df2\u505c\u6b62\u7ee7\u7eed\u751f\u6210\u3002';
    } else {
      detail = '\u5df2\u505c\u6b62\u5f53\u524d\u6458\u8981\u751f\u6210\u3002';
    }

    return {
      title: '\u5df2\u53d6\u6d88\u751f\u6210',
      stage,
      stageLabel,
      detail,
      progress: chunkProgress,
      partial: hasPartialContent
        ? '\u5df2\u4fdd\u7559\u5f53\u524d\u5df2\u751f\u6210\u5185\u5bb9\uff0c\u53ef\u76f4\u63a5\u590d\u5236\u3001\u5bfc\u51fa\u6216\u91cd\u65b0\u751f\u6210\u3002'
        : '\u672c\u6b21\u672a\u4fdd\u7559\u53ef\u7528\u6458\u8981\u5185\u5bb9\u3002',
      hasPartialContent
    };
  }

  function buildDiagnosticsSummary(diagnostics, options) {
    const safeDiagnostics = diagnostics || null;
    if (!safeDiagnostics) return '\u7b49\u5f85\u672c\u6b21\u8fd0\u884c\u7684\u8bca\u65ad\u4fe1\u606f...';

    const finalRun = safeDiagnostics.finalRun || safeDiagnostics.error?.diagnostics || null;
    const error = safeDiagnostics.error || finalRun?.lastError || null;
    const status = finalRun?.status || (error?.code === 'RUN_CANCELLED' ? 'cancelled' : error ? 'failed' : 'completed');
    const stage = finalRun?.stage || error?.stage || '';
    const lines = [
      '\u72b6\u6001: ' + getRunStatusLabel(status),
      '\u9636\u6bb5: ' + getRunStageLabel(stage, options)
    ];

    if (status === 'cancelled') {
      const cancellation = describeCancellation(safeDiagnostics, options);
      if (cancellation.detail) {
        lines.push('\u8bf4\u660e: ' + cancellation.detail);
      }
      if (cancellation.progress) {
        lines.push('\u8fdb\u5ea6: ' + cancellation.progress);
      }
      lines.push('\u5185\u5bb9: ' + cancellation.partial);
    } else {
      const progress = buildChunkProgressLabel(safeDiagnostics);
      if (progress) {
        lines.push('\u8fdb\u5ea6: ' + progress);
      }
      if (options?.hasPartialContent && status !== 'completed') {
        lines.push('\u5185\u5bb9: \u5df2\u4fdd\u7559\u5f53\u524d\u5df2\u751f\u6210\u5185\u5bb9\u3002');
      }
    }

    if (safeDiagnostics.article) {
      const articleInfo = [
        safeDiagnostics.article.sourceHost || '',
        safeDiagnostics.article.sourceStrategyLabel || safeDiagnostics.article.sourceType || ''
      ].filter(Boolean).join(' / ');
      if (articleInfo) {
        lines.push('\u9875\u9762: ' + articleInfo);
      }
    }

    const modelInfo = [safeDiagnostics.provider || '', safeDiagnostics.model || ''].filter(Boolean).join(' / ');
    if (modelInfo) {
      lines.push('\u6a21\u578b: ' + modelInfo);
    }

    const endpointInfo = [safeDiagnostics.endpointMode || '', safeDiagnostics.adapterId || ''].filter(Boolean).join(' / ');
    if (endpointInfo) {
      lines.push('\u63a5\u53e3: ' + endpointInfo);
    }

    lines.push('\u8017\u65f6: ' + formatDuration(typeof safeDiagnostics.durationMs === 'number' ? safeDiagnostics.durationMs : finalRun?.durationMs || 0));
    lines.push('\u91cd\u8bd5: ' + String(safeDiagnostics.retryCount || 0) + ' \u6b21');

    if (error?.code) {
      lines.push('\u9519\u8bef: ' + error.code + (error.message ? ' \u00b7 ' + error.message : ''));
    }

    if (safeDiagnostics.runId) {
      lines.push('\u8fd0\u884c ID: ' + safeDiagnostics.runId);
    }

    return lines.filter(Boolean).join('\n');
  }

  const api = {
    pickTerminalRun,
    buildTerminalRecordPatch,
    formatDuration,
    getRunStageLabel,
    getRunStatusLabel,
    buildChunkProgressLabel,
    describeCancellation,
    buildDiagnosticsSummary
  };

  global.AISummaryRunUtils = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

(function (global) {
  const Errors = global.AISummaryErrors || (typeof require === 'function' ? require('./errors.js') : null);
  const RunUtils = global.AISummaryRunUtils || (typeof require === 'function' ? require('./run-utils.js') : null);
  const SummaryText = global.AISummarySummaryText || (typeof require === 'function' ? require('./summary-text.js') : null);
  const UiLabels = global.AISummaryUiLabels || (typeof require === 'function' ? require('./ui-labels.js') : null);

  function getSidebarModeLabel(mode) {
    return UiLabels.getSummaryModeLabel(mode, { fallback: '\u6807\u51c6\u603b\u7ed3' });
  }

  function buildPartialSummary(record, summaryMarkdownFallback) {
    const markdown = record?.summaryMarkdown || summaryMarkdownFallback || '';
    const plainText = SummaryText.markdownToPlainText(markdown).trim();
    return {
      markdown,
      plainText,
      charCount: plainText.length,
      hasPartialContent: !!plainText
    };
  }

  function buildDiagnosticsOptions(record, diagnostics, summaryMarkdownFallback) {
    const partial = buildPartialSummary(record, summaryMarkdownFallback);
    const stage = diagnostics?.finalRun?.stage || diagnostics?.error?.stage || '';
    const secondaryModeLabel = stage !== 'secondary' && record?.promptProfile !== 'secondary'
      ? ''
      : getSidebarModeLabel(record?.summaryMode || '');

    return {
      partial,
      options: {
        hasPartialContent: partial.hasPartialContent,
        secondaryModeLabel
      }
    };
  }

  function getDiagnosticsStatus(diagnostics) {
    return diagnostics?.finalRun?.status
      || (diagnostics?.error?.code === Errors.ERROR_CODES.RUN_CANCELLED ? 'cancelled' : diagnostics?.error ? 'failed' : 'completed');
  }

  function getDiagnosticsToggleLabel(status) {
    if (status === 'failed') return '\u9519\u8bef\u8bca\u65ad';
    if (status === 'cancelled') return '\u53d6\u6d88\u8bca\u65ad';
    if (status === 'running') return '\u8fd0\u884c\u4e2d\u8bca\u65ad';
    return '\u8fd0\u884c\u8bca\u65ad';
  }

  function buildDiagnosticsPanelModel(record, diagnostics, summaryMarkdownFallback) {
    if (!diagnostics) {
      return {
        status: 'idle',
        toggleLabel: '\u8fd0\u884c\u8bca\u65ad',
        summaryText: '\u7b49\u5f85\u672c\u6b21\u8fd0\u884c\u7684\u8bca\u65ad\u4fe1\u606f...',
        shouldAutoOpen: false,
        partial: buildPartialSummary(record, summaryMarkdownFallback),
        options: {
          hasPartialContent: false,
          secondaryModeLabel: ''
        }
      };
    }

    const { partial, options } = buildDiagnosticsOptions(record, diagnostics, summaryMarkdownFallback);
    const status = getDiagnosticsStatus(diagnostics);

    return {
      status,
      toggleLabel: getDiagnosticsToggleLabel(status),
      summaryText: RunUtils.buildDiagnosticsSummary(diagnostics, options),
      shouldAutoOpen: status === 'cancelled' || status === 'failed',
      partial,
      options
    };
  }

  function buildCancelledStateModel(record, diagnostics, summaryMarkdownFallback) {
    const { partial, options } = buildDiagnosticsOptions(record, diagnostics, summaryMarkdownFallback);
    const info = RunUtils.describeCancellation(diagnostics, options);

    return {
      partial,
      info,
      facts: [
        info.stageLabel ? '\u9636\u6bb5\uff1a' + info.stageLabel : '',
        info.progress ? '\u8fdb\u5ea6\uff1a' + info.progress : '',
        partial.hasPartialContent
          ? '\u5185\u5bb9\uff1a\u5df2\u4fdd\u7559\u53d6\u6d88\u524d\u5df2\u751f\u6210\u5185\u5bb9\uff0c\u5f53\u524d\u7ea6 ' + partial.charCount + ' \u5b57\u3002'
          : '\u5185\u5bb9\uff1a' + info.partial,
        partial.hasPartialContent
          ? '\u64cd\u4f5c\uff1a\u5f53\u524d\u5185\u5bb9\u4ecd\u53ef\u590d\u5236\u3001\u5bfc\u51fa\uff0c\u6216\u7ee7\u7eed\u505a\u4e8c\u6b21\u751f\u6210\u3002'
          : '\u64cd\u4f5c\uff1a\u53ef\u4ee5\u76f4\u63a5\u91cd\u65b0\u751f\u6210\uff0c\u6216\u7a0d\u540e\u91cd\u8bd5\u3002'
      ].filter(Boolean),
      statusText: info.hasPartialContent ? info.detail + ' \u5df2\u4fdd\u7559\u5f53\u524d\u5df2\u751f\u6210\u5185\u5bb9\u3002' : info.detail
    };
  }

  const api = {
    buildPartialSummary,
    buildDiagnosticsOptions,
    getDiagnosticsStatus,
    getDiagnosticsToggleLabel,
    buildDiagnosticsPanelModel,
    buildCancelledStateModel
  };

  global.AISummaryDiagnosticsView = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

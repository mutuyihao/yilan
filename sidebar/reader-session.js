(function initYilanSidebarReaderSession(global) {
  function createReaderSessionController(deps) {
    const getState = deps.getState;
    const getElements = deps.getElements;
    const getCurrentArticle = deps.getCurrentArticle;
    const getCurrentRecord = deps.getCurrentRecord;
    const createArticleFromRecord = deps.createArticleFromRecord;
    const buildReaderSnapshot = deps.buildReaderSnapshot;
    const runtimeSendMessage = deps.runtimeSendMessage;
    const setStatus = deps.setStatus;

    function createReaderSnapshot() {
      const state = getState();
      const elements = getElements();
      const article = getCurrentArticle() || createArticleFromRecord(getCurrentRecord());
      const record = getCurrentRecord() || {};
      return buildReaderSnapshot({
        article,
        record,
        summaryMarkdown: state?.summaryMarkdown || '',
        currentSummaryMode: elements.summaryModeSelect.value,
        generating: !!state?.generating,
        diagnostics: state?.lastDiagnostics || null
      });
    }

    async function openReaderTab() {
      const snapshot = createReaderSnapshot();
      if (!snapshot) {
        setStatus('\u5f53\u524d\u8fd8\u6ca1\u6709\u53ef\u9605\u8bfb\u7684\u6458\u8981\u5185\u5bb9\u3002', 'warning');
        return;
      }

      const response = await runtimeSendMessage({
        action: 'openReaderTab',
        snapshot
      });

      if (response.success) {
        setStatus('\u5df2\u5728\u65b0\u6807\u7b7e\u9875\u6253\u5f00\u4e13\u6ce8\u9605\u8bfb\u3002', 'success');
        return;
      }

      setStatus(response.error || '\u6253\u5f00\u9605\u8bfb\u9875\u5931\u8d25\u3002', 'error');
    }

    return {
      createReaderSnapshot,
      openReaderTab
    };
  }

  const api = {
    createReaderSessionController
  };

  global.YilanSidebarReaderSession = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

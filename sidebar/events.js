(function initYilanSidebarEvents(global) {
  function createEventsController(deps) {
    const state = deps.state;
    const elements = deps.elements;
    const documentRef = deps.document || global.document;
    const windowRef = deps.window || global;
    const consoleRef = deps.console || global.console || { error() {} };
    const summaryModeController = deps.summaryModeController;
    const getHistoryController = deps.getHistoryController;
    const normalizeUiError = deps.normalizeUiError;
    const renderErrorBox = deps.renderErrorBox;
    const setStatus = deps.setStatus;
    const refreshActionStates = deps.refreshActionStates;
    const closeDiagnostics = deps.closeDiagnostics;
    const closeSidebar = deps.closeSidebar;
    const openReaderTab = deps.openReaderTab;
    const cycleThemePreference = deps.cycleThemePreference;
    const togglePrivacyMode = deps.togglePrivacyMode;
    const startPrimarySummary = deps.startPrimarySummary;
    const cancelGeneration = deps.cancelGeneration;
    const toggleFavoriteFromMain = deps.toggleFavoriteFromMain;
    const copySummary = deps.copySummary;
    const exportMarkdown = deps.exportMarkdown;
    const exportShareImage = deps.exportShareImage;
    const startSecondarySummary = deps.startSecondarySummary;
    const handleArticleDataPayload = deps.handleArticleDataPayload;
    let eventsBound = false;

    function reportStatusError(error) {
      const normalized = normalizeUiError(error);
      setStatus(normalized.message, 'error');
    }

    function reportGenerationError(error) {
      const normalized = normalizeUiError(error);
      renderErrorBox(normalized);
      setStatus(normalized.message, 'error');
      refreshActionStates();
    }

    function bind() {
      if (eventsBound) return;
      eventsBound = true;

      elements.summaryRoot.addEventListener('scroll', () => {
        const distance = elements.summaryRoot.scrollHeight - elements.summaryRoot.scrollTop - elements.summaryRoot.clientHeight;
        state.autoScroll = distance <= 24;
      });

      elements.readerBtn.addEventListener('click', () => {
        openReaderTab().catch(reportStatusError);
      });
      elements.historyBtn.addEventListener('click', () => getHistoryController().open());
      elements.themeBtn.addEventListener('click', () => {
        cycleThemePreference().catch(reportStatusError);
      });
      elements.closeBtn.addEventListener('click', closeSidebar);
      elements.privacyToggleBtn.addEventListener('click', () => {
        togglePrivacyMode().catch(reportStatusError);
      });
      summaryModeController.bindEvents();
      elements.regenerateBtn.addEventListener('click', () => {
        startPrimarySummary(elements.summaryModeSelect.value).catch(reportGenerationError);
      });
      elements.cancelBtn.addEventListener('click', cancelGeneration);
      elements.favoriteBtn.addEventListener('click', () => {
        toggleFavoriteFromMain().catch((error) => {
          consoleRef.error(error);
        });
      });
      elements.copyBtn.addEventListener('click', copySummary);
      elements.exportBtn.addEventListener('click', exportMarkdown);
      elements.shareBtn.addEventListener('click', exportShareImage);
      documentRef.querySelectorAll('.secondary-btn').forEach((button) => {
        button.addEventListener('click', () => {
          startSecondarySummary(button.dataset.mode).catch(reportGenerationError);
        });
      });

      windowRef.addEventListener('message', (event) => {
        if (event.data?.type === 'historyData') {
          getHistoryController().open();
          return;
        }

        if (event.data?.type === 'articleData' && event.data.article) {
          handleArticleDataPayload(event.data).catch((error) => {
            consoleRef.error(error);
            setStatus('\u5904\u7406\u5165\u53e3\u89e6\u53d1\u5931\u8d25', 'error');
          });
        }
      });

      documentRef.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && summaryModeController.closeIfOpen()) {
          return;
        }
        if (event.key !== 'Escape') return;
        if (getHistoryController().isOpen()) {
          getHistoryController().close();
          return;
        }
        if (elements.diagnosticsBlock?.open) {
          closeDiagnostics();
          return;
        }
        closeSidebar();
      });
    }

    return {
      bind
    };
  }

  const api = {
    createEventsController
  };

  global.YilanSidebarEvents = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

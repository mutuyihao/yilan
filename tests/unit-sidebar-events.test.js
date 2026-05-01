const { test, assert, freshRequire } = require('./harness');

function createEventTarget(initial) {
  return Object.assign({
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(listener);
    },
    dispatch(type, event) {
      const payload = event || {};
      if (!('target' in payload)) {
        payload.target = this;
      }
      (this.listeners[type] || []).forEach((listener) => listener(payload));
      return payload;
    }
  }, initial || {});
}

function createButton(dataset) {
  return createEventTarget({
    dataset: dataset || {}
  });
}

function createController(overrides) {
  const SidebarEvents = freshRequire('sidebar/events.js');
  const calls = [];
  const secondaryButtons = [
    createButton({ mode: 'action_items' }),
    createButton({ mode: 'qa' })
  ];
  const documentRef = createEventTarget({
    querySelectorAll(selector) {
      return selector === '.secondary-btn' ? secondaryButtons : [];
    }
  });
  const windowRef = createEventTarget();
  const state = { autoScroll: false };
  const elements = {
    summaryRoot: createEventTarget({
      scrollHeight: 240,
      scrollTop: 100,
      clientHeight: 120
    }),
    readerBtn: createButton(),
    historyBtn: createButton(),
    themeBtn: createButton(),
    closeBtn: createButton(),
    privacyToggleBtn: createButton(),
    regenerateBtn: createButton(),
    cancelBtn: createButton(),
    favoriteBtn: createButton(),
    copyBtn: createButton(),
    exportBtn: createButton(),
    shareBtn: createButton(),
    summaryModeSelect: { value: 'medium' },
    diagnosticsBlock: { open: false }
  };
  const historyController = {
    open: () => calls.push(['history.open']),
    close: () => calls.push(['history.close']),
    isOpen: () => !!overrides?.historyOpen
  };
  const summaryModeController = {
    bindEvents: () => calls.push(['mode.bind']),
    closeIfOpen: () => {
      calls.push(['mode.closeIfOpen']);
      return !!overrides?.modeOpen;
    }
  };

  const controller = SidebarEvents.createEventsController({
    state,
    elements,
    summaryModeController,
    getHistoryController: () => historyController,
    normalizeUiError: (error) => ({ message: String(error?.message || error || 'normalized') }),
    renderErrorBox: (error) => calls.push(['renderErrorBox', error.message]),
    setStatus: (text, tone) => calls.push(['setStatus', text, tone]),
    refreshActionStates: () => calls.push(['refreshActionStates']),
    closeDiagnostics: () => {
      calls.push(['closeDiagnostics']);
      elements.diagnosticsBlock.open = false;
    },
    closeSidebar: () => calls.push(['closeSidebar']),
    openReaderTab: async () => calls.push(['openReaderTab']),
    cycleThemePreference: async () => calls.push(['cycleThemePreference']),
    togglePrivacyMode: async () => calls.push(['togglePrivacyMode']),
    startPrimarySummary: async (mode) => calls.push(['startPrimarySummary', mode]),
    cancelGeneration: () => calls.push(['cancelGeneration']),
    toggleFavoriteFromMain: async () => calls.push(['toggleFavoriteFromMain']),
    copySummary: () => calls.push(['copySummary']),
    exportMarkdown: () => calls.push(['exportMarkdown']),
    exportShareImage: () => calls.push(['exportShareImage']),
    startSecondarySummary: async (mode) => calls.push(['startSecondarySummary', mode]),
    handleArticleDataPayload: async (message) => calls.push(['handleArticleDataPayload', message.article?.title]),
    document: documentRef,
    window: windowRef,
    console: {
      error: (error) => calls.push(['console.error', String(error?.message || error || '')])
    }
  });

  return { controller, calls, state, elements, documentRef, windowRef, secondaryButtons };
}

test('sidebar events controller binds buttons, secondary actions, and scroll state', [
  'ui.sidebar_contract',
  'generation.primary',
  'generation.secondary',
  'export.markdown',
  'export.share_card',
  'reader.session',
  'settings.theme',
  'privacy.policy',
  'run.cancellation'
], async () => {
  const { controller, calls, state, elements, secondaryButtons } = createController();
  controller.bind();
  controller.bind();

  elements.summaryRoot.dispatch('scroll');
  assert.strictEqual(state.autoScroll, true);
  elements.summaryRoot.scrollTop = 80;
  elements.summaryRoot.dispatch('scroll');
  assert.strictEqual(state.autoScroll, false);

  elements.readerBtn.dispatch('click');
  elements.historyBtn.dispatch('click');
  elements.themeBtn.dispatch('click');
  elements.closeBtn.dispatch('click');
  elements.privacyToggleBtn.dispatch('click');
  elements.regenerateBtn.dispatch('click');
  elements.cancelBtn.dispatch('click');
  elements.favoriteBtn.dispatch('click');
  elements.copyBtn.dispatch('click');
  elements.exportBtn.dispatch('click');
  elements.shareBtn.dispatch('click');
  secondaryButtons[0].dispatch('click');

  await Promise.resolve();

  assert.deepStrictEqual(calls, [
    ['mode.bind'],
    ['openReaderTab'],
    ['history.open'],
    ['cycleThemePreference'],
    ['closeSidebar'],
    ['togglePrivacyMode'],
    ['startPrimarySummary', 'medium'],
    ['cancelGeneration'],
    ['toggleFavoriteFromMain'],
    ['copySummary'],
    ['exportMarkdown'],
    ['exportShareImage'],
    ['startSecondarySummary', 'action_items']
  ]);
});

test('sidebar events controller handles sidebar messages', [
  'ui.sidebar_contract',
  'content.sidebar_injection',
  'history.search'
], async () => {
  const { controller, calls, windowRef } = createController();
  controller.bind();

  windowRef.dispatch('message', { data: { type: 'historyData' } });
  windowRef.dispatch('message', { data: { type: 'articleData', article: { title: 'Article A' } } });
  windowRef.dispatch('message', { data: { type: 'articleData' } });
  await Promise.resolve();

  assert.deepStrictEqual(calls, [
    ['mode.bind'],
    ['history.open'],
    ['handleArticleDataPayload', 'Article A']
  ]);
});

test('sidebar events controller preserves Escape close priority', 'ui.sidebar_contract', () => {
  const mode = createController({ modeOpen: true });
  mode.controller.bind();
  mode.documentRef.dispatch('keydown', { key: 'Escape' });
  assert.deepStrictEqual(mode.calls, [
    ['mode.bind'],
    ['mode.closeIfOpen']
  ]);

  const history = createController({ historyOpen: true });
  history.controller.bind();
  history.documentRef.dispatch('keydown', { key: 'Escape' });
  assert.deepStrictEqual(history.calls, [
    ['mode.bind'],
    ['mode.closeIfOpen'],
    ['history.close']
  ]);

  const diagnostics = createController();
  diagnostics.elements.diagnosticsBlock.open = true;
  diagnostics.controller.bind();
  diagnostics.documentRef.dispatch('keydown', { key: 'Escape' });
  assert.deepStrictEqual(diagnostics.calls, [
    ['mode.bind'],
    ['mode.closeIfOpen'],
    ['closeDiagnostics']
  ]);

  const fallback = createController();
  fallback.controller.bind();
  fallback.documentRef.dispatch('keydown', { key: 'Escape' });
  assert.deepStrictEqual(fallback.calls, [
    ['mode.bind'],
    ['mode.closeIfOpen'],
    ['closeSidebar']
  ]);
});

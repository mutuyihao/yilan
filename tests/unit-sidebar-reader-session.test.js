const { test, assert, freshRequire } = require('./harness');

function createController(overrides) {
  const SidebarReaderSession = freshRequire('sidebar/reader-session.js');
  const calls = {
    messages: [],
    statuses: []
  };
  const state = Object.assign({
    article: { title: 'Current Article' },
    visibleRecord: { recordId: 'rec_1' },
    summaryMarkdown: '## Summary',
    generating: false,
    lastDiagnostics: { runId: 'run_1' }
  }, overrides?.state || {});
  const elements = {
    summaryModeSelect: { value: overrides?.mode || 'medium' }
  };

  const controller = SidebarReaderSession.createReaderSessionController({
    getState: () => state,
    getElements: () => elements,
    getCurrentArticle: () => state.article,
    getCurrentRecord: () => state.visibleRecord,
    createArticleFromRecord: (record) => ({ title: record?.titleSnapshot || 'Record Article' }),
    buildReaderSnapshot: overrides?.buildReaderSnapshot || ((input) => ({
      title: input.article?.title,
      recordId: input.record?.recordId,
      summaryMarkdown: input.summaryMarkdown,
      currentSummaryMode: input.currentSummaryMode,
      diagnostics: input.diagnostics
    })),
    runtimeSendMessage: async (message) => {
      calls.messages.push(message);
      return overrides?.response || { success: true };
    },
    setStatus: (text, tone) => {
      calls.statuses.push({ text, tone });
    }
  });

  return { controller, calls, state };
}

test('sidebar reader session controller opens reader tabs with current snapshot payloads', [
  'reader.session',
  'reader.page'
], async () => {
  const { controller, calls } = createController();

  assert.deepStrictEqual(controller.createReaderSnapshot(), {
    title: 'Current Article',
    recordId: 'rec_1',
    summaryMarkdown: '## Summary',
    currentSummaryMode: 'medium',
    diagnostics: { runId: 'run_1' }
  });

  await controller.openReaderTab();
  assert.strictEqual(calls.messages.length, 1);
  assert.strictEqual(calls.messages[0].action, 'openReaderTab');
  assert.strictEqual(calls.messages[0].snapshot.title, 'Current Article');
  assert.deepStrictEqual(calls.statuses, [
    { text: '已在新标签页打开专注阅读。', tone: 'success' }
  ]);
});

test('sidebar reader session controller reports empty and failed reader states', [
  'reader.session',
  'reader.page'
], async () => {
  const empty = createController({
    buildReaderSnapshot: () => null
  });
  await empty.controller.openReaderTab();
  assert.deepStrictEqual(empty.calls.messages, []);
  assert.deepStrictEqual(empty.calls.statuses, [
    { text: '当前还没有可阅读的摘要内容。', tone: 'warning' }
  ]);

  const failed = createController({
    response: { success: false, error: 'reader failed' }
  });
  await failed.controller.openReaderTab();
  assert.strictEqual(failed.calls.messages[0].action, 'openReaderTab');
  assert.deepStrictEqual(failed.calls.statuses, [
    { text: 'reader failed', tone: 'error' }
  ]);
});

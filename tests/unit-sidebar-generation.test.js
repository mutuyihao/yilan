const { test, assert, freshRequire } = require('./harness');

function createPort() {
  const listeners = {
    message: [],
    disconnect: []
  };
  const posted = [];
  let disconnected = 0;
  const port = {
    onMessage: {
      addListener(listener) {
        listeners.message.push(listener);
      }
    },
    onDisconnect: {
      addListener(listener) {
        listeners.disconnect.push(listener);
      }
    },
    postMessage(message) {
      posted.push(message);
    },
    disconnect() {
      disconnected += 1;
    }
  };

  return {
    port,
    posted,
    listeners,
    get disconnected() {
      return disconnected;
    }
  };
}

function createController(overrides) {
  const SidebarGeneration = freshRequire('sidebar/generation.js');
  const state = Object.assign({
    generating: true,
    cancelRequested: false,
    runAbortController: new AbortController(),
    activeRunIds: new Set(['run_existing']),
    activePort: null,
    activeStreamRunId: '',
    summaryMarkdown: '',
    visibleRecord: null
  }, overrides?.state || {});
  const calls = {
    messages: [],
    statuses: [],
    refreshes: 0,
    scheduled: 0
  };
  const portBundle = overrides?.portBundle || createPort();

  const controller = SidebarGeneration.createGenerationController({
    getState: () => state,
    getElements: () => ({ historyPanel: { classList: { contains: () => true } } }),
    recordStore: {
      saveRecord: async (record) => Object.assign({}, record, { saved: true })
    },
    domain: {
      createRuntimeId: () => 'run_generated',
      hashString: (value) => 'hash_' + String(value || '').length
    },
    errors: {
      ERROR_CODES: {
        CONFIG_MISSING_API_KEY: 'CONFIG_MISSING_API_KEY',
        NETWORK_STREAM_DISCONNECTED: 'NETWORK_STREAM_DISCONNECTED',
        RUN_CANCELLED: 'RUN_CANCELLED'
      },
      createError: (code, payload) => Object.assign(new Error(code), { code }, payload || {})
    },
    articleUtils: {},
    runUtils: {},
    trust: {},
    loadRuntimeSettings: async () => ({ apiKey: 'test' }),
    ensureArticleReady: () => {},
    withCustomPrompt: (prompt) => prompt,
    getTargetLanguage: () => 'auto',
    createDraftRecord: () => ({}),
    finalizeRecord: (record, updates) => Object.assign({}, record, updates),
    normalizeUiError: (error) => error,
    composeDiagnostics: () => ({}),
    markdownToPlainText: (value) => String(value || ''),
    extractBullets: () => [],
    getModeLabel: (mode) => mode,
    renderErrorBox: () => {},
    renderDiagnostics: () => {},
    renderArticleMeta: () => {},
    renderInlineNote: () => {},
    setStatus: (text, tone) => {
      calls.statuses.push({ text, tone });
    },
    setStats: () => {},
    refreshActionStates: () => {
      calls.refreshes += 1;
    },
    renderChunkProgress: () => {},
    scheduleMarkdownRender: () => {
      calls.scheduled += 1;
    },
    bindVisibleRecord: () => {},
    getHistoryController: () => ({ refresh: async () => {} }),
    applyPendingNavigationPayload: async () => {},
    runtimeSendMessage: async (message) => {
      calls.messages.push(message);
      return { success: true };
    },
    connectStream: () => portBundle.port,
    readRuntimeLastErrorMessage: () => ''
  });

  return { SidebarGeneration, controller, state, calls, portBundle };
}

test('sidebar generation helpers format stream progress and retry statuses', [
  'generation.primary',
  'generation.secondary',
  'transport.streaming'
], () => {
  const SidebarGeneration = freshRequire('sidebar/generation.js');

  assert.strictEqual(SidebarGeneration.buildStreamStartStatus({ stage: 'synthesis' }), '\u6b63\u5728\u6c47\u603b\u6700\u7ec8\u7ed3\u679c...');
  assert.strictEqual(SidebarGeneration.buildStreamStartStatus({ stage: 'chunk', chunkIndex: 1, chunkCount: 3 }), '\u6b63\u5728\u603b\u7ed3\u7b2c 2/3 \u6bb5...');
  assert.strictEqual(SidebarGeneration.buildStreamStartStatus({ stage: 'chunk' }), '\u6b63\u5728\u603b\u7ed3\u5f53\u524d\u5206\u6bb5...');
  assert.strictEqual(SidebarGeneration.buildStreamStartStatus({ stage: 'primary' }), '\u6b63\u5728\u751f\u6210\u603b\u7ed3...');
  assert.strictEqual(SidebarGeneration.buildStreamRetryStatus({ stage: 'chunk', chunkIndex: 0, chunkCount: 2 }, 2), '\u6b63\u5728\u603b\u7ed3\u7b2c 1/2 \u6bb5\uff0c\u63a5\u53e3\u6ce2\u52a8\uff0c\u6b63\u5728\u8fdb\u884c\u7b2c 2 \u6b21\u91cd\u8bd5...');
});

test('sidebar generation controller cancels active stream and runtime runs', [
  'run.cancellation',
  'transport.streaming'
], async () => {
  const portBundle = createPort();
  const { controller, state, calls } = createController({
    portBundle,
    state: {
      activePort: portBundle.port,
      activeStreamRunId: 'run_stream'
    }
  });

  await controller.cancelGeneration();

  assert.strictEqual(state.cancelRequested, true);
  assert.deepStrictEqual(portBundle.posted, [
    { action: 'cancelRun', runId: 'run_stream' }
  ]);
  assert.deepStrictEqual(calls.messages, [
    { action: 'cancelRun', runId: 'run_existing' }
  ]);
  assert.strictEqual(state.activePort, null);
  assert.strictEqual(state.activeStreamRunId, '');
  assert.strictEqual(calls.statuses[0].text, '\u6b63\u5728\u53d6\u6d88\u672c\u6b21\u751f\u6210...');
  assert.strictEqual(calls.statuses[0].tone, 'warning');
  assert.strictEqual(calls.refreshes, 1);
});

test('sidebar generation stream runner posts startStream and resolves streamed text', [
  'generation.primary',
  'transport.streaming'
], async () => {
  const portBundle = createPort();
  const { controller, state, calls } = createController({ portBundle });

  const stream = controller.runPromptViaStream({ modelName: 'm' }, 'Prompt', { stage: 'primary' }, null, {
    onToken(token) {
      state.summaryMarkdown += token;
      calls.scheduled += 1;
    }
  });

  assert.deepStrictEqual(portBundle.posted, [
    {
      action: 'startStream',
      settings: { modelName: 'm' },
      prompt: 'Prompt',
      runId: 'run_generated',
      meta: { stage: 'primary' }
    }
  ]);
  assert.ok(state.activeRunIds.has('run_generated'));

  portBundle.listeners.message[0]({ runId: 'run_generated', type: 'token', token: 'Hello ' });
  portBundle.listeners.message[0]({
    runId: 'run_generated',
    type: 'done',
    diagnostics: { runId: 'run_generated' },
    usage: { totalTokens: 3 }
  });

  const result = await stream;
  assert.deepStrictEqual(result, {
    text: 'Hello ',
    diagnostics: { runId: 'run_generated' },
    usage: { totalTokens: 3 }
  });
  assert.strictEqual(state.summaryMarkdown, 'Hello ');
  assert.strictEqual(state.activeRunIds.has('run_generated'), false);
  assert.strictEqual(state.activePort, null);
  assert.strictEqual(portBundle.disconnected, 1);
  assert.strictEqual(calls.scheduled, 1);
});

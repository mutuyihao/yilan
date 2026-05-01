const { test, assert, freshRequire } = require('./harness');

function createTrust() {
  const defaultSettings = {
    privacyMode: false,
    defaultAllowHistory: true,
    defaultAllowShare: true
  };
  return {
    DEFAULT_SETTINGS: defaultSettings,
    buildTrustPolicy(article, settings) {
      return {
        article,
        settings,
        allowShare: settings.defaultAllowShare !== false
      };
    }
  };
}

test('sidebar state module creates isolated default state and navigation constants', [
  'ui.sidebar_contract',
  'content.spa_navigation_refresh'
], () => {
  const SidebarState = freshRequire('sidebar/state.js');
  const trust = createTrust();
  const first = SidebarState.createInitialState({ trust });
  const second = SidebarState.createInitialState({ trust });

  assert.deepStrictEqual(SidebarState.SETTINGS_KEYS, [
    'providerPreset',
    'aiProvider',
    'endpointMode',
    'apiKey',
    'aiBaseURL',
    'modelName',
    'systemPrompt',
    'autoTranslate',
    'defaultLanguage',
    'themePreference',
    'privacyMode',
    'defaultAllowHistory',
    'defaultAllowShare',
    'entrypointAutoStart',
    'entrypointSimpleMode',
    'entrypointReuseHistory'
  ]);
  assert.deepStrictEqual(SidebarState.NAVIGATION_DURING_GENERATION, {
    DEFER: 'defer',
    REPLACE: 'replace',
    IGNORE: 'ignore'
  });
  assert.deepStrictEqual(SidebarState.DEFAULT_NAVIGATION_POLICY, {
    autoStartOnNavigation: false,
    duringGeneration: 'defer'
  });

  assert.strictEqual(first.article, null);
  assert.strictEqual(first.visibleRecord, null);
  assert.strictEqual(first.visibleRecordUsesCurrentArticle, false);
  assert.strictEqual(first.summaryMarkdown, '');
  assert.strictEqual(first.generating, false);
  assert.strictEqual(first.cancelRequested, false);
  assert.strictEqual(first.runAbortController, null);
  assert.ok(first.activeRunIds instanceof Set);
  assert.strictEqual(first.activePort, null);
  assert.strictEqual(first.activeStreamRunId, '');
  assert.strictEqual(first.lastDiagnostics, null);
  assert.strictEqual(first.historyQuery, '');
  assert.strictEqual(first.favoritesOnly, false);
  assert.strictEqual(first.selectedSiteHost, '');
  assert.strictEqual(first.summaryModeMenuOpen, false);
  assert.strictEqual(first.autoScroll, true);
  assert.strictEqual(first.pendingNavigationPayload, null);
  assert.deepStrictEqual(first.settings, trust.DEFAULT_SETTINGS);
  assert.notStrictEqual(first.settings, trust.DEFAULT_SETTINGS);
  assert.deepStrictEqual(first.trustPolicy, {
    article: null,
    settings: trust.DEFAULT_SETTINGS,
    allowShare: true
  });

  first.activeRunIds.add('run_1');
  first.settings.privacyMode = true;
  assert.strictEqual(second.activeRunIds.has('run_1'), false);
  assert.strictEqual(second.settings.privacyMode, false);
  assert.notStrictEqual(first.activeRunIds, second.activeRunIds);
  assert.notStrictEqual(first.settings, second.settings);
});

test('sidebar state module resolves the sidebar DOM element map', 'ui.sidebar_contract', () => {
  const SidebarState = freshRequire('sidebar/state.js');
  const requested = [];
  const documentRef = {
    getElementById(id) {
      requested.push(id);
      return { id };
    }
  };

  const elements = SidebarState.resolveElements(documentRef);

  assert.deepStrictEqual(requested, Object.values(SidebarState.ELEMENT_IDS));
  assert.strictEqual(elements.articleTitle.id, 'articleTitle');
  assert.strictEqual(elements.contentPanel.id, 'content');
  assert.strictEqual(elements.summaryRoot.id, 'summaryRoot');
  assert.strictEqual(elements.diagnosticsBlock.id, 'diagnosticsBlock');
  assert.strictEqual(elements.historyPanel.id, 'historyPanel');
  assert.strictEqual(elements.closeBtn.id, 'closeBtn');
  assert.deepStrictEqual(Object.keys(elements), Object.keys(SidebarState.ELEMENT_IDS));
});

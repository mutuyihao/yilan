const vm = require('vm');
const {
  test,
  assert,
  readText,
  readJson,
  listFirstPartyJsFiles
} = require('./harness');

function extractHtmlIds(html) {
  const ids = new Set();
  const regex = /\bid="([^"]+)"/g;
  let match;
  while ((match = regex.exec(html))) {
    ids.add(match[1]);
  }
  return ids;
}

function extractScriptSources(html) {
  const sources = [];
  const regex = /<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g;
  let match;
  while ((match = regex.exec(html))) {
    sources.push(match[1]);
  }
  return sources;
}

function extractQuotedCalls(js, callPattern) {
  const ids = new Set();
  let match;
  while ((match = callPattern.exec(js))) {
    ids.add(match[1]);
  }
  return ids;
}

function assertAllIdsExist(pageName, jsIds, htmlIds) {
  const missing = Array.from(jsIds).filter((id) => !htmlIds.has(id));
  assert.deepStrictEqual(missing, [], pageName + ' is missing DOM ids');
}

function assertInOrder(values, expected) {
  const indexes = expected.map((item) => values.indexOf(item));
  assert.ok(indexes.every((index) => index >= 0), 'Missing expected script: ' + expected.join(', '));
  const sorted = indexes.slice().sort((a, b) => a - b);
  assert.deepStrictEqual(indexes, sorted, 'Scripts are not in dependency order');
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

test('first-party JavaScript files pass syntax checks', 'quality.syntax', () => {
  const files = listFirstPartyJsFiles();
  assert.ok(files.includes('background.js'));
  assert.ok(files.includes('sidebar.js'));
  assert.ok(files.includes('tests/run-tests.js'));

  files.forEach((file) => {
    assert.doesNotThrow(() => {
      new vm.Script(readText(file), { filename: file });
    }, file);
  });
});

test('manifest declares MV3 shell, entrypoints, permissions, and accessible resources', [
  'manifest.mv3',
  'manifest.permissions',
  'entrypoint.context_menu',
  'entrypoint.shortcut'
], () => {
  const manifest = readJson('manifest.json');
  assert.strictEqual(manifest.manifest_version, 3);
  assert.strictEqual(manifest.background.service_worker, 'background.js');
  assert.strictEqual(manifest.action.default_popup, 'popup.html');
  assert.ok(manifest.permissions.includes('contextMenus'));
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.permissions.includes('storage'));
  assert.ok(manifest.permissions.includes('clipboardWrite'));
  assert.deepStrictEqual(manifest.host_permissions, ['<all_urls>']);
  assert.strictEqual(manifest.commands['trigger-summary'].suggested_key.default, 'Alt+S');

  const resources = manifest.web_accessible_resources.flatMap((item) => item.resources);
  [
    'sidebar.html',
    'style.css',
    'db.js',
    'sidebar.js',
    'shared/theme.js',
    'shared/ui-format.js',
    'shared/ui-labels.js',
    'shared/summary-text.js',
    'shared/diagnostics-view.js',
    'shared/reader-view.js',
    'shared/history-view.js',
    'shared/sidebar-meta-view.js',
    'shared/domain.js',
    'shared/article-utils.js',
    'shared/trust-policy.js',
    'libs/purify.min.js',
    'libs/marked.min.js',
    'libs/html2canvas.min.js'
  ].forEach((resource) => {
    assert.ok(resources.includes(resource), 'Missing web accessible resource: ' + resource);
  });
});

test('manifest, HTML script tags, and imported resources point to existing files', 'manifest.permissions', () => {
  const manifest = readJson('manifest.json');
  const resources = manifest.web_accessible_resources.flatMap((item) => item.resources);
  resources.forEach((resource) => {
    assert.ok(readText(resource).length > 0, 'Missing resource file: ' + resource);
  });

  ['sidebar.html', 'popup.html', 'reader.html'].forEach((htmlFile) => {
    extractScriptSources(readText(htmlFile)).forEach((script) => {
      assert.ok(readText(script).length > 0, htmlFile + ' references missing script ' + script);
    });
  });

  const background = readText('background.js');
  [
    'shared/domain.js',
    'shared/errors.js',
    'shared/provider-presets.js',
    'adapters/openai-adapter.js',
    'adapters/anthropic-adapter.js',
    'adapters/registry.js',
    'shared/abort-utils.js',
    'shared/transport-utils.js'
  ].forEach((script) => {
    assert.ok(background.includes("'" + script + "'"), 'background importScripts missing ' + script);
  });
});

test('sidebar page DOM, scripts, actions, history, export, share, and reader contracts stay wired', [
  'ui.sidebar_contract',
  'history.search',
  'history.favorite_delete',
  'history.site_filters',
  'export.markdown',
  'export.share_card',
  'reader.session',
  'reader.page',
  'settings.theme',
  'privacy.policy'
], () => {
  const html = readText('sidebar.html');
  const js = readText('sidebar.js');
  const ids = extractHtmlIds(html);
  const jsIds = extractQuotedCalls(js, /getElementById\('([^']+)'\)/g);
  assertAllIdsExist('sidebar.html', jsIds, ids);

  assertInOrder(extractScriptSources(html), [
    'shared/domain.js',
    'shared/strings.js',
    'shared/page-strategy.js',
    'shared/article-utils.js',
    'shared/trust-policy.js',
    'shared/run-utils.js',
    'shared/ui-format.js',
    'shared/ui-labels.js',
    'shared/summary-text.js',
    'shared/diagnostics-view.js',
    'shared/reader-view.js',
    'shared/history-view.js',
    'shared/sidebar-meta-view.js',
    'libs/purify.min.js',
    'libs/marked.min.js',
    'libs/highlight.min.js',
    'libs/html2canvas.min.js',
    'db.js',
    'sidebar.js'
  ]);

  ['action_items', 'glossary', 'qa'].forEach((mode) => {
    assert.ok(html.includes('data-mode="' + mode + '"'), 'Missing secondary mode button: ' + mode);
  });
  assert.ok(js.includes('function exportMarkdown()'));
  assert.ok(js.includes("new Blob([header + state.summaryMarkdown]"));
  assert.ok(js.includes('function exportShareImage()'));
  assert.ok(js.includes('html2canvas(card'));
  assert.ok(js.includes("action: 'openReaderTab'"));
  assert.ok(js.includes('recordStore.searchRecords'));
  assert.ok(js.includes('recordStore.toggleFavorite'));
  assert.ok(js.includes('recordStore.deleteRecord'));
  assert.ok(js.includes('recordStore.findReusableRecordForArticle'));
  assert.ok(js.includes('Trust.buildTrustPolicy'));
  assert.ok(js.includes('AISummaryTheme'));
  assert.strictEqual(countMatches(js, /function renderThemeToggleState\(/g), 1);
  assert.strictEqual(countMatches(js, /function cycleThemePreference\(/g), 1);
  assert.strictEqual(countMatches(js, /function updateFavoriteButton\(/g), 1);
});

test('popup DOM, tabs, autosave, provider settings, connection test, and entrypoint controls stay wired', [
  'ui.popup_contract',
  'settings.presets',
  'settings.autosave',
  'settings.connection_test',
  'entrypoint.status'
], () => {
  const html = readText('popup.html');
  const js = readText('popup.js');
  const ids = extractHtmlIds(html);
  const jsIds = extractQuotedCalls(js, /\$\('([^']+)'\)/g);
  assertAllIdsExist('popup.html', jsIds, ids);

  assertInOrder(extractScriptSources(html), [
    'shared/ui-format.js',
    'shared/ui-labels.js',
    'shared/errors.js',
    'shared/trust-policy.js',
    'shared/provider-presets.js',
    'popup.js'
  ]);

  ['connection', 'preferences', 'entrypoints'].forEach((tab) => {
    assert.ok(html.includes('data-tab="' + tab + '"'));
    assert.ok(html.includes('data-tab-panel="' + tab + '"'));
  });
  assert.ok(html.includes('data-autosave="immediate"'));
  assert.ok(html.includes('data-autosave="debounced"'));
  assert.ok(js.includes('function scheduleAutoSave()'));
  assert.ok(js.includes('function flushPendingChanges()'));
  assert.ok(js.includes("action: 'testConnection'"));
  assert.ok(js.includes("action: 'triggerHistory'"));
  assert.ok(js.includes("action: 'getEntrypointStatus'"));
  assert.ok(js.includes("action: 'openShortcutSettings'"));
  assert.ok(js.includes('ProviderPresets.listPresets()'));
});

test('reader page DOM, markdown rendering, copy, diagnostics, and session lookup stay wired', [
  'ui.reader_contract',
  'reader.page',
  'reader.session',
  'export.markdown'
], () => {
  const html = readText('reader.html');
  const js = readText('reader.js');
  const ids = extractHtmlIds(html);
  const dollarIds = extractQuotedCalls(js, /\$\('([^']+)'\)/g);
  assertAllIdsExist('reader.html', dollarIds, ids);

  assertInOrder(extractScriptSources(html), [
    'shared/ui-format.js',
    'shared/ui-labels.js',
    'shared/summary-text.js',
    'shared/reader-view.js',
    'db.js',
    'libs/purify.min.js',
    'libs/marked.min.js',
    'libs/highlight.min.js',
    'reader.js'
  ]);

  assert.ok(js.includes('readerSession:'));
  assert.ok(js.includes('recordStore.getRecordById'));
  assert.ok(js.includes('navigator.clipboard.writeText'));
  assert.ok(js.includes('DOMPurify.sanitize'));
  assert.ok(js.includes('marked.parse'));
  assert.ok(js.includes('readerDiagnostics'));
});

test('background service worker exposes entrypoints, run actions, cancellation, reader sessions, and status checks', [
  'entrypoint.context_menu',
  'entrypoint.shortcut',
  'entrypoint.status',
  'settings.connection_test',
  'generation.primary',
  'run.cancellation',
  'reader.session',
  'transport.streaming'
], () => {
  const js = readText('background.js');
  assert.ok(js.includes('chrome.runtime.onInstalled.addListener'));
  assert.ok(js.includes('chrome.contextMenus.onClicked.addListener'));
  assert.ok(js.includes('chrome.commands.onCommand.addListener'));
  assert.ok(js.includes('chrome.runtime.onConnect.addListener'));
  assert.ok(js.includes("message.action === 'testConnection'"));
  assert.ok(js.includes("message.action === 'runPrompt'"));
  assert.ok(js.includes("message.action === 'cancelRun'"));
  assert.ok(js.includes("message.action === 'triggerHistory'"));
  assert.ok(js.includes("message.action === 'getEntrypointStatus'"));
  assert.ok(js.includes("message.action === 'openReaderTab'"));
  assert.ok(js.includes('createReaderSession'));
  assert.ok(js.includes('cancelPortRuns'));
  assert.ok(js.includes('executeRun'));
  assert.ok(js.includes('TransportUtils.normalizeTransportError'));
  assert.ok(js.includes('TransportUtils.createSseParser'));
  assert.ok(js.includes('TransportUtils.extractTextFromRawBody'));
  assert.ok(js.includes('TransportUtils.extractUsageFromRawBody'));
  assert.ok(js.includes('TransportUtils.normalizePreview'));
  assert.strictEqual(countMatches(js, /function createSseParser\(/g), 0);
  assert.strictEqual(countMatches(js, /function extractTextFromRawBody\(/g), 0);
  assert.strictEqual(countMatches(js, /function extractUsageFromRawBody\(/g), 0);
});

test('content script extraction, sidebar injection, and SPA navigation contracts stay wired', [
  'content.extraction',
  'content.sidebar_injection',
  'content.spa_navigation_refresh'
], () => {
  const js = readText('content.js');
  const sidebar = readText('sidebar.js');
  assert.ok(js.includes('new Readability'));
  assert.ok(js.includes('ArticleUtils.buildArticleSnapshot'));
  assert.ok(js.includes('createSidebarFrame'));
  assert.ok(js.includes('injectSidebar'));
  assert.ok(js.includes('postToExistingSidebar'));
  assert.ok(js.includes('removeSidebar'));
  assert.ok(js.includes('syncSidebarViewport'));
  assert.ok(js.includes("window.addEventListener('popstate'"));
  assert.ok(js.includes("window.addEventListener('hashchange'"));
  assert.ok(js.includes("autoStartOnNavigation: false"));
  assert.ok(js.includes("duringGeneration: 'defer'"));
  assert.ok(js.includes("source: 'navigation'"));
  assert.ok(js.includes("event.data?.type === 'closeSidebar'"));
  assert.ok(sidebar.includes('DEFAULT_NAVIGATION_POLICY'));
  assert.ok(sidebar.includes('NAVIGATION_DURING_GENERATION'));
  assert.ok(sidebar.includes("DEFER: 'defer'"));
  assert.ok(sidebar.includes("REPLACE: 'replace'"));
  assert.ok(sidebar.includes("IGNORE: 'ignore'"));
  assert.ok(sidebar.includes('pendingNavigationPayload'));
  assert.ok(sidebar.includes('applyPendingNavigationPayload'));
  assert.ok(sidebar.includes('navigationPolicy.autoStartOnNavigation'));
});

test('planning docs record upgrade direction and TS/Preact migration guardrails', 'quality.docs_upgrade_design', () => {
  const index = readText('docs/README.md');
  const upgradeDoc = readText('docs/UPGRADE_DESIGN.md');
  const migrationDoc = readText('docs/TS_PREACT_MIGRATION.md');

  assert.ok(index.includes('TS_PREACT_MIGRATION.md'));

  [
    'Pinboard',
    '\u4e2a\u4eba\u7f51\u9875\u8bb0\u5fc6\u5e93',
    '\u91cd\u6784\u62a4\u680f',
    'Phase 0',
    'Phase 1',
    'Phase 2',
    'Phase 3',
    'Phase 4',
    '\u56de\u5f52\u6e05\u5355'
  ].forEach((needle) => {
    assert.ok(upgradeDoc.includes(needle), 'Upgrade design missing: ' + needle);
  });

  [
    'TypeScript',
    'Preact',
    'npm.cmd run typecheck',
    'popup',
    'reader',
    'sidebar',
    'dist/'
  ].forEach((needle) => {
    assert.ok(migrationDoc.includes(needle), 'TS/Preact migration design missing: ' + needle);
  });
});

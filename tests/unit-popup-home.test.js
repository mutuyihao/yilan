const { test, assert, freshRequire } = require('./harness');

const Domain = freshRequire('shared/domain.js');
const Home = freshRequire('popup/home.js');

function createFakeNode() {
  const attributes = new Map();
  const classes = new Set();
  const listeners = new Map();
  return {
    textContent: '',
    title: '',
    hidden: false,
    disabled: false,
    className: '',
    dataset: {},
    classList: {
      toggle: (name, force) => {
        const next = force === undefined ? !classes.has(name) : !!force;
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
      contains: (name) => classes.has(name)
    },
    setAttribute: (name, value) => attributes.set(name, String(value)),
    getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
    removeAttribute: (name) => attributes.delete(name),
    addEventListener: (type, handler) => listeners.set(type, handler),
    click() {
      const handler = listeners.get('click');
      return handler ? handler() : undefined;
    }
  };
}

function setupHomeController(overrides) {
  const nodes = new Map();
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, createFakeNode());
    return nodes.get(id);
  };
  const sent = [];
  const context = Object.assign({ ready: true, configured: true, autoStart: true, reuseHistory: true, steps: {} }, overrides?.context);
  const calls = { activateTab: [], openFullSettings: [], closed: 0 };

  const controller = Home.createHomeController({
    $,
    // Echo keys (and substitutions) so assertions stay locale-independent.
    i18n: {
      get: (key, subs) => key + (subs ? '(' + [].concat(subs).join('|') + ')' : ''),
      getUILanguage: () => 'en'
    },
    uiLabels: { getSummaryModeLabel: (mode) => 'mode:' + mode },
    domain: Domain,
    runtimeSendMessage: async (message) => {
      sent.push(message);
      return overrides?.response || { success: true };
    },
    getRuntimeErrorMessage: () => '',
    queryTargetTab: async () => overrides?.tab || null,
    isFileSchemeAllowed: async () => overrides?.fileAccess !== false,
    findRecordForUrl: async () => (overrides?.record ? { record: overrides.record } : null),
    getHomeContext: () => context,
    activateTab: (tab, options) => calls.activateTab.push([tab, options]),
    openFullSettings: (tab) => calls.openFullSettings.push(tab),
    closeWindow: () => {
      calls.closed += 1;
      return overrides?.closes !== false;
    }
  });

  return { controller, $, sent, calls, context };
}

test('popup home classifies the current tab URL before offering a summary', ['ui.popup_home'], () => {
  const article = Home.classifyPageUrl('https://www.example.com/post?id=1', Domain);
  assert.strictEqual(article.supported, true);
  assert.strictEqual(article.kind, 'web');
  assert.strictEqual(article.host, 'example.com');

  assert.strictEqual(Home.classifyPageUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', Domain).kind, 'youtube');
  assert.strictEqual(Home.classifyPageUrl('https://youtu.be/dQw4w9WgXcQ', Domain).kind, 'youtube');
  assert.strictEqual(Home.classifyPageUrl('https://www.bilibili.com/video/BV1xx411c7mD', Domain).kind, 'bilibili');

  const file = Home.classifyPageUrl('file:///C:/docs/My%20Notes.html', Domain);
  assert.strictEqual(file.supported, true);
  assert.strictEqual(file.kind, 'file');
  assert.strictEqual(file.host, 'My Notes.html');

  ['chrome://extensions/', 'edge://settings', 'about:blank', 'chrome-extension://abc/popup.html', 'view-source:https://example.com'].forEach((url) => {
    const result = Home.classifyPageUrl(url, Domain);
    assert.strictEqual(result.supported, false, url);
    assert.strictEqual(result.reason, 'browser', url);
  });

  assert.strictEqual(Home.classifyPageUrl('https://chromewebstore.google.com/detail/abc', Domain).reason, 'store');
  assert.strictEqual(Home.classifyPageUrl('https://chrome.google.com/webstore/detail/abc', Domain).reason, 'store');
  assert.strictEqual(Home.classifyPageUrl('https://microsoftedge.microsoft.com/addons/detail/abc', Domain).reason, 'store');
  // Other Google / Microsoft pages stay summarizable.
  assert.strictEqual(Home.classifyPageUrl('https://chrome.google.com/blog', Domain).supported, true);

  assert.strictEqual(Home.classifyPageUrl('', Domain).reason, 'unknown');
  assert.strictEqual(Home.classifyPageUrl('not a url', Domain).reason, 'unknown');
});

test('popup home formats relative times through Intl in both UI languages', ['ui.popup_home'], () => {
  const now = Date.parse('2026-10-02T12:00:00.000Z');
  assert.strictEqual(Home.formatRelativeTime('2026-10-02T11:59:50.000Z', 'en', now), 'now');
  assert.strictEqual(Home.formatRelativeTime('2026-10-02T11:55:00.000Z', 'en', now), '5 minutes ago');
  assert.strictEqual(Home.formatRelativeTime('2026-10-01T12:00:00.000Z', 'en', now), 'yesterday');
  assert.strictEqual(Home.formatRelativeTime('2026-09-29T12:00:00.000Z', 'en', now), '3 days ago');
  assert.strictEqual(Home.formatRelativeTime('2026-10-02T09:00:00.000Z', 'zh', now), '3小时前');
  assert.strictEqual(Home.formatRelativeTime('', 'en', now), '');
  assert.strictEqual(Home.formatRelativeTime('garbage', 'en', now), '');
});

test('popup connection state only trusts a test that matches the current settings', ['ui.popup_home', 'settings.connection_test'], () => {
  const settings = {
    providerPreset: 'custom',
    aiProvider: 'openai',
    endpointMode: 'responses',
    aiBaseURL: 'https://gateway.example.com/v1',
    modelName: 'gpt-test',
    apiKey: 'sk-secret'
  };
  const signature = Home.buildConnectionSignature(settings, Domain.hashString);
  assert.ok(!signature.includes('sk-secret'), 'the signature must not embed the raw key');

  // The background may toggle a trailing /v1 after a successful test.
  assert.strictEqual(Home.buildConnectionSignature(Object.assign({}, settings, { aiBaseURL: 'https://gateway.example.com/' }), Domain.hashString), signature);
  assert.notStrictEqual(Home.buildConnectionSignature(Object.assign({}, settings, { modelName: 'other' }), Domain.hashString), signature);
  assert.notStrictEqual(Home.buildConnectionSignature(Object.assign({}, settings, { apiKey: 'sk-rotated' }), Domain.hashString), signature);

  assert.strictEqual(Home.resolveConnectionState(Object.assign({}, settings, { apiKey: '' }), null, signature), 'incomplete');
  assert.strictEqual(Home.resolveConnectionState(Object.assign({}, settings, { modelName: '' }), null, signature), 'incomplete');
  assert.strictEqual(Home.resolveConnectionState(settings, null, signature), 'unverified');
  assert.strictEqual(Home.resolveConnectionState(settings, { signature, ok: true }, signature), 'verified');
  assert.strictEqual(Home.resolveConnectionState(settings, { signature, ok: false }, signature), 'failed');
  assert.strictEqual(Home.resolveConnectionState(settings, { signature: 'stale', ok: true }, signature), 'unverified');
});

test('popup home snippet strips markdown and trims on a word boundary', ['ui.popup_home'], () => {
  assert.strictEqual(Home.buildSnippet({ summaryPlainText: 'Short and sweet.' }), 'Short and sweet.');
  // Section headings are dropped; list markers, emphasis, and link targets are flattened.
  assert.strictEqual(Home.buildSnippet({ summaryMarkdown: '## Title\n- **Bold** point\n- See [docs](https://x.dev) - now' }), 'Bold point See docs - now');
  const long = Home.buildSnippet({ summaryPlainText: 'word '.repeat(80) }, 40);
  assert.ok(long.endsWith('…'));
  assert.ok(long.length <= 41);
  assert.strictEqual(Home.buildSnippet(null), '');
});

test('popup home renders the page, saved summary, and reuse-aware primary action', ['ui.popup_home', 'history.reuse_current_page'], async () => {
  const { controller, $ } = setupHomeController({
    tab: { id: 7, url: 'https://example.com/post', title: 'Example Post', favIconUrl: 'https://example.com/favicon.ico' },
    record: { summaryMode: 'short', completedAt: '2020-01-01T00:00:00.000Z', summaryPlainText: 'Saved summary text.' }
  });

  await controller.load();
  assert.strictEqual($('homePageCard').dataset.state, 'ready');
  assert.strictEqual($('homePageTitle').textContent, 'Example Post');
  assert.strictEqual($('homePageHost').textContent, 'example.com');
  assert.strictEqual($('homeHistory').hidden, false);
  assert.ok($('homeHistoryMeta').textContent.includes('mode:short'));
  assert.strictEqual($('homeHistorySnippet').textContent, 'Saved summary text.');
  assert.strictEqual($('homeSummarizeLabel').textContent, 'popup_home_open_summary');
  assert.strictEqual($('homeSummarizeBtn').disabled, false);
  assert.strictEqual($('historyBtn').disabled, false);
  assert.strictEqual($('homeSetup').hidden, true);
});

test('popup home explains restricted pages and keeps page actions disabled', ['ui.popup_home'], async () => {
  const { controller, $ } = setupHomeController({ tab: { id: 3, url: 'chrome://extensions/', title: 'Extensions' } });

  await controller.load();
  assert.strictEqual($('homePageCard').dataset.state, 'unsupported');
  assert.strictEqual($('homePageNote').hidden, false);
  assert.strictEqual($('homePageNote').textContent, 'popup_home_unsupported_browser');
  assert.strictEqual($('homeSummarizeBtn').disabled, true);
  assert.strictEqual($('historyBtn').disabled, true);

  // Without host access the tab URL is hidden: treat it as a protected page.
  const hidden = setupHomeController({ tab: { id: 6 } });
  await hidden.controller.load();
  assert.strictEqual(hidden.$('homePageNote').textContent, 'popup_home_unsupported_browser');
  assert.strictEqual(hidden.$('homePageTitle').textContent, 'popup_home_protected_title');
  assert.strictEqual(hidden.$('homeSummarizeBtn').disabled, true);

  const blockedFile = setupHomeController({ tab: { id: 4, url: 'file:///tmp/a.html' }, fileAccess: false });
  await blockedFile.controller.load();
  assert.strictEqual(blockedFile.$('homePageNote').textContent, 'popup_home_unsupported_file');
  assert.strictEqual(blockedFile.$('homeSummarizeBtn').disabled, true);
});

test('popup home labels the primary action by what the sidebar will do', ['ui.popup_home'], async () => {
  const manual = setupHomeController({ tab: { id: 1, url: 'https://example.com/a' }, context: { autoStart: false } });
  await manual.controller.load();
  assert.strictEqual(manual.$('homeSummarizeLabel').textContent, 'popup_home_open_sidebar');

  const fresh = setupHomeController({ tab: { id: 1, url: 'https://example.com/a' } });
  await fresh.controller.load();
  assert.strictEqual(fresh.$('homeSummarizeLabel').textContent, 'popup_home_summarize');

  const setup = setupHomeController({ tab: { id: 1, url: 'https://example.com/a' }, context: { configured: false } });
  await setup.controller.load();
  assert.strictEqual(setup.$('homeSetup').hidden, false);
  assert.strictEqual(setup.$('homeSummarizeBtn').hidden, true);
  assert.strictEqual(setup.$('homeQuick').hidden, true);
});

test('popup home summarize targets the rendered tab and reports failures inline', ['ui.popup_home'], async () => {
  const ok = setupHomeController({ tab: { id: 42, url: 'https://example.com/a' } });
  await ok.controller.load();
  await ok.controller.summarize();
  assert.deepStrictEqual(ok.sent, [{ action: 'triggerSummary', tabId: 42 }]);
  assert.strictEqual(ok.calls.closed, 1);

  // A pinned surface (tests/screenshots) stays open and confirms instead.
  const pinned = setupHomeController({ tab: { id: 5, url: 'https://example.com/a' }, closes: false });
  await pinned.controller.load();
  await pinned.controller.openHistory();
  assert.deepStrictEqual(pinned.sent, [{ action: 'triggerHistory', tabId: 5 }]);
  assert.strictEqual(pinned.$('homeFeedback').hidden, false);
  assert.strictEqual(pinned.$('homeFeedback').textContent, 'popup_history_opened');
  assert.strictEqual(pinned.$('homeSummarizeBtn').disabled, false);

  const failed = setupHomeController({
    tab: { id: 9, url: 'https://example.com/a' },
    response: { success: false, reason: 'inject_failed' }
  });
  await failed.controller.load();
  await failed.controller.summarize();
  assert.strictEqual(failed.calls.closed, 0);
  assert.strictEqual(failed.$('homeFeedback').textContent, 'popup_home_error_inject');
  assert.ok(failed.$('homeFeedback').className.includes('error'));
  assert.strictEqual(failed.$('homeSummarizeBtn').disabled, false);
});

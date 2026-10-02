// Captures the popup at its real toolbar size (452px wide, height clamped to
// Chrome's 600px popup limit) plus the full-tab options surface.
// Output: outputs/popup-redesign/*.png
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { chromium } = require('@playwright/test');
const { resetExtensionState, setSyncSettings, buildDefaultSettings } = require('../e2e/extension-harness');

const EXTENSION_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(EXTENSION_ROOT, 'outputs', 'popup-redesign');
const ARTICLE_HOST = 'notes.example.com';
const POPUP_WIDTH = 452;
const POPUP_MAX_HEIGHT = 600;

const ARTICLE_TITLE = '深度工作：在碎片化时代重建专注力的 7 个方法';
const ARTICLE_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${ARTICLE_TITLE}</title><link rel="icon" href="/favicon.svg"></head>
<body><article><h1>${ARTICLE_TITLE}</h1><p>${'专注是一种可以训练的能力。'.repeat(40)}</p></article></body></html>`;
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#e8743b"/><path d="M9 22V10h4l3 6 3-6h4v12h-3v-7l-3 6h-2l-3-6v7z" fill="#fff"/></svg>';

function startArticleServer() {
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/favicon.svg')) {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end(FAVICON_SVG);
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(ARTICLE_HTML);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function launch(port) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yilan-popup-shots-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: process.env.YILAN_E2E_CHANNEL || 'chromium',
    headless: process.env.PW_HEADLESS !== '0',
    viewport: { width: POPUP_WIDTH, height: POPUP_MAX_HEIGHT },
    args: [
      '--lang=zh-CN',
      // A system proxy would bypass the host mapping for the fake article host.
      '--no-proxy-server',
      `--host-resolver-rules=MAP ${ARTICLE_HOST} 127.0.0.1:${port}`,
      `--disable-extensions-except=${EXTENSION_ROOT}`,
      `--load-extension=${EXTENSION_ROOT}`
    ]
  });
  const serviceWorker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  return {
    context,
    serviceWorker,
    extensionId: new URL(serviceWorker.url()).hostname,
    async close() {
      await context.close().catch(() => {});
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  };
}

// Same-URL hash changes do not reload; always start from a blank document.
async function openFresh(page, url) {
  await page.goto('about:blank');
  await page.goto(url);
}

async function settle(page) {
  await page.mouse.move(POPUP_WIDTH - 2, 2);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(400);
}

// Real popups shrink to their content height; mirror that before shooting.
async function shootPopup(page, name) {
  await settle(page);
  const height = await page.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));
  await page.setViewportSize({ width: POPUP_WIDTH, height: Math.min(POPUP_MAX_HEIGHT, height) });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUTPUT_DIR, name + '.png') });
  await page.setViewportSize({ width: POPUP_WIDTH, height: POPUP_MAX_HEIGHT });
}

async function shootFull(page, name) {
  await settle(page);
  // Viewport only: full-page capture misplaces the fixed rail and sticky footer.
  await page.screenshot({ path: path.join(OUTPUT_DIR, name + '.png') });
}

async function markConnectionVerified(page, minutesAgo) {
  await page.evaluate((minutes) => new Promise((resolve) => {
    const settings = window.collectSettings();
    chrome.storage.local.set({
      yilanConnectionCheckV1: {
        signature: window.YilanPopupHome.buildConnectionSignature(settings, window.AISummaryDomain.hashString),
        ok: true,
        testedAt: new Date(Date.now() - minutes * 60000).toISOString(),
        model: settings.modelName,
        message: ''
      }
    }, resolve);
  }), minutesAgo);
}

(async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const server = await startArticleServer();
  const harness = await launch(server.address().port);
  try {
    await resetExtensionState(harness.serviceWorker);
    const settings = buildDefaultSettings('https://api.xiaomimimo.com', {
      providerPreset: 'mimo',
      aiBaseURL: 'https://api.xiaomimimo.com/v1',
      apiKey: 'sk-preview-0000',
      modelName: 'mimo-v2-pro',
      themePreference: 'light'
    });
    await setSyncSettings(harness.serviceWorker, settings);

    const articleUrl = `http://${ARTICLE_HOST}/2026/deep-work`;
    const freshUrl = `http://${ARTICLE_HOST}/2026/reading-list`;
    const article = await harness.context.newPage();
    await article.goto(articleUrl);
    const fresh = await harness.context.newPage();
    await fresh.goto(freshUrl);
    await article.waitForTimeout(500);
    const tabIds = await harness.serviceWorker.evaluate(async (urls) => {
      const tabs = await chrome.tabs.query({});
      return urls.map((url) => tabs.find((tab) => tab.url === url)?.id);
    }, [articleUrl, freshUrl]);

    const base = `chrome-extension://${harness.extensionId}/popup.html`;
    const popup = await harness.context.newPage();
    await openFresh(popup, `${base}?surface=popup&targetTab=${tabIds[1]}`);
    await popup.waitForFunction(() => document.getElementById('apiKey').value);
    await markConnectionVerified(popup, 3);
    await popup.evaluate(async (url) => {
      await window.db.saveRecord({
        sourceUrl: url,
        normalizedUrl: url,
        titleSnapshot: '深度工作：在碎片化时代重建专注力的 7 个方法',
        summaryMode: 'medium',
        status: 'completed',
        completedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        summaryMarkdown: '## 核心观点\n- 专注力是稀缺资源，需要用固定的“深度时段”主动保护，而不是靠意志力硬撑。\n- 把浅层事务批量处理，减少上下文切换带来的注意力残留。'
      });
    }, articleUrl);

    // 01-02: home with and without a saved summary for the page.
    await openFresh(popup, `${base}?surface=popup&targetTab=${tabIds[0]}`);
    await popup.waitForSelector('#homeHistory:not([hidden])');
    await shootPopup(popup, '01-home-saved-summary');
    await openFresh(popup, `${base}?surface=popup&targetTab=${tabIds[1]}`);
    await popup.waitForSelector('#homePageCard[data-state="ready"]');
    await shootPopup(popup, '02-home-fresh-page');

    // 03: a page the browser does not let extensions read.
    await openFresh(popup, `${base}?surface=popup`);
    await popup.waitForSelector('#homePageCard[data-state="unsupported"]');
    await shootPopup(popup, '03-home-restricted-page');

    // 04-07: settings tabs (verified connection).
    await openFresh(popup, `${base}?surface=popup&targetTab=${tabIds[1]}#connection`);
    await popup.waitForSelector('#connectHero[data-state="verified"]');
    await shootPopup(popup, '04-connection-verified');
    await popup.evaluate(() => {
      document.getElementById('advancedPreferences').open = true;
    });
    await popup.click('.tab[data-tab="preferences"]');
    await shootPopup(popup, '05-preferences');
    await popup.click('.tab[data-tab="entrypoints"]');
    await shootPopup(popup, '06-entrypoints');

    // 07-08: dark theme.
    await setSyncSettings(harness.serviceWorker, { themePreference: 'dark' });
    await openFresh(popup, `${base}?surface=popup&targetTab=${tabIds[0]}#home`);
    await popup.waitForSelector('#homeHistory:not([hidden])');
    await shootPopup(popup, '07-home-dark');
    await popup.click('.tab[data-tab="connection"]');
    await shootPopup(popup, '08-connection-dark');

    // 09: English UI, slate palette.
    await setSyncSettings(harness.serviceWorker, { themePreference: 'light', uiLanguage: 'en', themePalette: 'slate' });
    await openFresh(popup, `${base}?surface=popup&targetTab=${tabIds[0]}#home`);
    await popup.waitForSelector('#homeHistory:not([hidden])');
    await popup.waitForSelector('#homeSummarizeLabel[data-i18n="popup_home_open_summary"]');
    await popup.waitForTimeout(600);
    await shootPopup(popup, '09-home-en-slate');

    // 10: connection edited since the last test -> unverified.
    await setSyncSettings(harness.serviceWorker, { uiLanguage: 'zh', themePalette: 'jade', modelName: 'mimo-v2-flash' });
    await openFresh(popup, `${base}?surface=popup&targetTab=${tabIds[1]}#connection`);
    await popup.waitForSelector('#connectHero[data-state="unverified"]');
    await shootPopup(popup, '10-connection-unverified');

    // 11: first run, nothing configured yet.
    await setSyncSettings(harness.serviceWorker, { apiKey: '', modelName: '' });
    await openFresh(popup, `${base}?surface=popup&targetTab=${tabIds[1]}#home`);
    await popup.waitForSelector('#homeSetup:not([hidden])');
    await shootPopup(popup, '11-home-first-run');

    // 12-13: the same document as the full-tab options page.
    await setSyncSettings(harness.serviceWorker, { apiKey: 'sk-preview-0000', modelName: 'mimo-v2-pro' });
    const options = await harness.context.newPage();
    await options.setViewportSize({ width: 1280, height: 860 });
    await openFresh(options, `${base}?surface=tab#connection`);
    await options.waitForSelector('#panel-connection.active');
    await shootFull(options, '12-options-connection');
    await setSyncSettings(harness.serviceWorker, { themePreference: 'dark' });
    await options.click('.tab[data-tab="preferences"]');
    await shootFull(options, '13-options-preferences-dark');
  } finally {
    await harness.close();
    server.close();
  }
  console.log('done ->', OUTPUT_DIR);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

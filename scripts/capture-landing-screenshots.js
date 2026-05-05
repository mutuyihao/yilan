const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('@playwright/test');
const { startTestServer } = require('../e2e/test-server');
const {
  buildDefaultSettings,
  resetExtensionState,
  setSyncSettings,
  triggerActiveTabAction,
  waitForSidebarFrame,
  openExtensionPage
} = require('../e2e/extension-harness');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'landing-page', 'assets', 'screens');
const extensionRoot = root;

const CONTENT_VIEWPORT = { width: 1600, height: 1200 };
const SIDEBAR_VIEWPORT = { width: 1600, height: 933 };

async function launchCaptureContext() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yilan-landing-shots-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: process.env.PW_HEADLESS !== '0',
    viewport: CONTENT_VIEWPORT,
    deviceScaleFactor: 2,
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`
    ]
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }

  const extensionId = new URL(serviceWorker.url()).hostname;
  return {
    context,
    serviceWorker,
    extensionId,
    async close() {
      await context.close();
      await fs.rm(userDataDir, { recursive: true, force: true });
    }
  };
}

function createStoredRecord(overrides) {
  const extra = overrides || {};
  const title = String(extra.titleSnapshot || extra.title || 'Archived Article');
  const slug = String(extra.slug || title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'archived-article';
  const sourceUrl = extra.sourceUrl || `https://${extra.sourceHost || 'research.example.com'}/${slug}`;
  const sourceHost = extra.sourceHost || new URL(sourceUrl).host;
  const recordId = extra.recordId || 'landing_' + slug;
  const articleId = extra.articleId || 'article_' + slug;
  const contentHash = extra.contentHash || 'hash_' + slug;
  const articleSnapshot = Object.assign({
    articleId,
    normalizedUrl: sourceUrl,
    sourceUrl,
    sourceHost,
    sourceType: extra.sourceType || 'doc',
    sourceStrategy: {
      strategyId: 'general_reader',
      label: '通用精读',
      description: ''
    },
    title,
    cleanText: `${title} clean text for landing screenshots.`,
    content: `${title} clean text for landing screenshots.`,
    contentHash,
    allowHistory: true,
    allowShare: true,
    chunkCount: 1,
    chunkingStrategy: 'none'
  }, extra.articleSnapshot || {});

  return Object.assign({
    recordId,
    articleId,
    sourceUrl,
    normalizedUrl: sourceUrl,
    sourceHost,
    titleSnapshot: title,
    contentHash,
    articleSnapshot,
    summaryMode: extra.summaryMode || 'medium',
    targetLanguage: 'zh',
    promptProfile: 'primary',
    provider: 'openai',
    model: 'mock-model',
    endpointMode: 'responses',
    allowHistory: true,
    allowShare: true,
    retentionHint: 'persistent',
    status: 'completed',
    createdAt: extra.createdAt || '2026-05-05T08:00:00.000Z',
    updatedAt: extra.updatedAt || '2026-05-05T08:00:00.000Z',
    completedAt: extra.completedAt || '2026-05-05T08:00:00.000Z',
    summaryMarkdown: extra.summaryMarkdown || [
      '## 核心结论',
      '- 这是一条用于落地页截图的历史摘要。'
    ].join('\n'),
    favorite: !!extra.favorite,
    tags: extra.tags || [],
    notes: extra.notes || ''
  }, extra, { articleSnapshot });
}

async function waitForTheme(scope, theme) {
  await scope.waitForFunction((expected) => {
    return document.documentElement.dataset.theme === expected;
  }, theme);
}

async function waitForFonts(scope) {
  await scope.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });
}

async function prepareLandingArticle(page) {
  await page.evaluate(() => {
    document.title = '一览信息整理工作流：从网页到可回看的资料库';

    const setMeta = (selector, attr, value) => {
      const element = document.querySelector(selector);
      if (element) element.setAttribute(attr, value);
    };

    setMeta('link[rel="canonical"]', 'href', 'https://docs.example.com/yilan/ai-reading-workspace');
    setMeta('meta[name="author"]', 'content', 'Yilan Team');
    setMeta('meta[name="description"]', 'content', '一览把网页抽取、结构化总结、二次生成和本地历史串成一条工作流。');
    setMeta('meta[property="og:site_name"]', 'content', 'Yilan Docs');
    setMeta('meta[property="article:published_time"]', 'content', '2026-05-05T09:30:00+08:00');

    const title = document.querySelector('article h1');
    if (title) {
      title.textContent = '一览信息整理工作流：从网页到可回看的资料库';
    }

    const paragraphs = Array.from(document.querySelectorAll('article p'));
    const body = [
      '一览面向需要长时间处理网页资料的用户：先抽取正文和来源信息，再生成结构化摘要，让网页不再停留在浏览器标签页里。',
      '摘要完成后，可以继续生成行动项、术语表或问答卡片。每一次结果都可以写入本地历史，按站点、标题、模型和关键词检索。',
      '产品保持 BYOK 与本地优先的边界：用户使用自己的模型接口，清楚知道哪些内容会发送给模型、哪些结果会保存在本地。',
      '当信息需要复用时，可以打开专注阅读页、复制 Markdown、导出文件，或者生成带来源链接的分享卡。'
    ];

    paragraphs.forEach((paragraph, index) => {
      paragraph.textContent = body[index % body.length].repeat(index === 0 ? 4 : 8);
    });
  });
}

async function composeSidebarShot(context, buffer, theme, outputPath, options) {
  const page = await context.newPage();
  const frameTop = options?.frameTop || 96;
  const frameLeft = options?.frameLeft || 584;
  const frameWidth = options?.frameWidth || 432;
  const frameHeight = options?.frameHeight || 1030;
  const viewportHeight = frameHeight - 34;
  const encoded = buffer.toString('base64');
  const light = theme === 'light';

  await page.setViewportSize(CONTENT_VIEWPORT);
  await page.setContent(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    html, body {
      width: ${CONTENT_VIEWPORT.width}px;
      height: ${CONTENT_VIEWPORT.height}px;
      margin: 0;
      overflow: hidden;
      background: ${light ? '#d9d8d1' : '#091018'};
      font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
    }

    body::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 13% 4%, ${light ? 'rgba(18, 138, 116, 0.42)' : 'rgba(90, 210, 190, 0.35)'}, transparent 11%),
        radial-gradient(circle at 22% 78%, ${light ? 'rgba(44, 74, 92, 0.30)' : 'rgba(74, 114, 146, 0.30)'}, transparent 17%),
        radial-gradient(circle at 88% 40%, ${light ? 'rgba(55, 164, 148, 0.23)' : 'rgba(45, 148, 130, 0.23)'}, transparent 18%),
        linear-gradient(135deg, ${light ? '#e4e0d6 0%, #d2d8d4 45%, #c8ccc3 100%' : '#071017 0%, #111b23 48%, #18212a 100%'});
      filter: blur(1px);
      transform: scale(1.02);
    }

    .ghost {
      position: absolute;
      width: 420px;
      height: 820px;
      left: 260px;
      bottom: -48px;
      border-radius: 22px;
      background: ${light ? 'rgba(239, 246, 243, 0.22)' : 'rgba(95, 180, 170, 0.08)'};
      box-shadow: 0 60px 90px ${light ? 'rgba(20, 45, 62, 0.20)' : 'rgba(0, 0, 0, 0.42)'};
      filter: blur(10px);
    }

    .frame {
      position: absolute;
      top: ${frameTop}px;
      left: ${frameLeft}px;
      width: ${frameWidth}px;
      height: ${frameHeight}px;
      overflow: hidden;
      border-radius: 18px;
      border: 1px solid ${light ? 'rgba(58, 75, 84, 0.16)' : 'rgba(182, 232, 224, 0.18)'};
      background: ${light ? '#fbf6ed' : '#0d151c'};
      box-shadow:
        0 42px 92px ${light ? 'rgba(26, 38, 45, 0.34)' : 'rgba(0, 0, 0, 0.64)'},
        0 0 0 1px ${light ? 'rgba(255, 255, 255, 0.46)' : 'rgba(255, 255, 255, 0.04)'};
    }

    .chrome {
      height: 34px;
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 0 18px;
      background: ${light ? '#f5f1eb' : '#121d25'};
      border-bottom: 1px solid ${light ? 'rgba(36, 50, 60, 0.10)' : 'rgba(255, 255, 255, 0.08)'};
    }

    .dot {
      width: 11px;
      height: 11px;
      border-radius: 999px;
      display: block;
    }

    .dot:nth-child(1) { background: #ff6159; }
    .dot:nth-child(2) { background: #ffbd2e; }
    .dot:nth-child(3) { background: #28c840; }

    .viewport {
      height: ${viewportHeight}px;
      overflow: hidden;
      background: ${light ? '#fbf6ed' : '#0d151c'};
    }

    img {
      display: block;
      width: 420px;
      height: auto;
    }
  </style>
</head>
<body>
  <div class="ghost"></div>
  <div class="frame">
    <div class="chrome">
      <span class="dot"></span>
      <span class="dot"></span>
      <span class="dot"></span>
    </div>
    <div class="viewport">
      <img alt="" src="data:image/png;base64,${encoded}">
    </div>
  </div>
</body>
</html>`);

  await page.screenshot({ path: outputPath, animations: 'disabled' });
  await page.close();
}

async function captureTheme(theme, server) {
  const harness = await launchCaptureContext();
  try {
    await resetExtensionState(harness.serviceWorker);
    await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
      themePreference: theme,
      themePalette: 'jade',
      privacyMode: false,
      defaultAllowHistory: true,
      defaultAllowShare: true,
      entrypointAutoStart: true,
      entrypointSimpleMode: false,
      entrypointReuseHistory: true
    }));

    const page = harness.context.pages()[0] || await harness.context.newPage();
    await page.setViewportSize(CONTENT_VIEWPORT);
    await page.goto(server.origin + '/article-basic');
    await prepareLandingArticle(page);
    await page.bringToFront();

    server.clearRequests();
    await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
    const sidebar = await waitForSidebarFrame(page);
    await waitForTheme(sidebar, theme);
    await waitForFonts(sidebar);
    await sidebar.waitForSelector('#copyBtn:not([disabled])');

    const workflowBuffer = await sidebar.locator('body').screenshot({ animations: 'disabled' });
    await composeSidebarShot(
      harness.context,
      workflowBuffer,
      theme,
      path.join(outputDir, `workflow-summary-${theme}.png`),
      { frameTop: 96, frameLeft: 584, frameWidth: 432, frameHeight: 1030 }
    );

    await sidebar.locator('.secondary-btn[data-mode="qa"]').click();
    await sidebar.waitForFunction(() => {
      const text = document.getElementById('summaryRoot')?.textContent || '';
      return text.includes('Q1.') || text.includes('问答') || text.includes('一览把网页抽取');
    });
    await waitForFonts(sidebar);
    const heroBuffer = await sidebar.locator('body').screenshot({ animations: 'disabled' });
    await composeSidebarShot(
      harness.context,
      heroBuffer,
      theme,
      path.join(outputDir, `hero-main-${theme}.png`),
      { frameTop: 96, frameLeft: 584, frameWidth: 432, frameHeight: 1030 }
    );

    await sidebar.evaluate(async (records) => {
      for (const record of records) {
        await window.db.saveRecord(record);
      }
    }, [
      createStoredRecord({
        recordId: 'landing_research_memory',
        titleSnapshot: 'AI 研究备忘：从网页到个人资料库',
        sourceHost: 'research.example.com',
        sourceUrl: 'https://research.example.com/ai-memory-workflow',
        updatedAt: '2026-05-05T09:10:00.000Z',
        completedAt: '2026-05-05T09:10:00.000Z',
        summaryMarkdown: '## 核心结论\n- 将网页内容沉淀为本地可检索资料库，比一次性摘要更有长期价值。',
        favorite: true,
        tags: ['研究', '资料库']
      }),
      createStoredRecord({
        recordId: 'landing_product_notes',
        titleSnapshot: '产品笔记：摘要、行动项与回看流程',
        sourceHost: 'notes.example.com',
        sourceUrl: 'https://notes.example.com/reading-workflow',
        updatedAt: '2026-05-05T08:40:00.000Z',
        completedAt: '2026-05-05T08:40:00.000Z',
        summaryMarkdown: '## 行动项\n1. 保存关键网页。\n2. 生成行动清单。\n3. 在历史里回看。',
        tags: ['行动项']
      })
    ]);

    await page.setViewportSize(SIDEBAR_VIEWPORT);
    await page.waitForTimeout(250);
    await sidebar.locator('#historyBtn').click();
    await sidebar.waitForFunction(() => {
      const panel = document.getElementById('historyPanel');
      return panel && !panel.classList.contains('hidden');
    });
    await waitForFonts(sidebar);
    await sidebar.locator('body').screenshot({
      path: path.join(outputDir, `history-reader-${theme}.png`),
      animations: 'disabled'
    });

    await setSyncSettings(harness.serviceWorker, buildDefaultSettings('https://api.example.com', {
      themePreference: theme,
      themePalette: 'jade',
      providerPreset: 'custom',
      aiProvider: 'openai',
      endpointMode: 'responses',
      apiKey: 'sk-yilan-demo-key',
      aiBaseURL: 'https://api.example.com/v1',
      modelName: 'gpt-4o-mini',
      privacyMode: false,
      defaultAllowHistory: true,
      defaultAllowShare: true
    }));

    const popup = await openExtensionPage(harness.context, harness.extensionId, 'popup.html');
    await popup.setViewportSize({ width: 520, height: 980 });
    await waitForTheme(popup, theme);
    await waitForFonts(popup);
    await popup.waitForSelector('#settingsForm');
    await popup.locator('body').screenshot({
      path: path.join(outputDir, `settings-panel-${theme}.png`),
      animations: 'disabled'
    });
  } finally {
    await harness.close();
  }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });
  const server = await startTestServer();
  try {
    for (const theme of ['light', 'dark']) {
      await captureTheme(theme, server);
    }
  } finally {
    await server.close();
  }

  console.log('Landing page screenshots updated in ' + path.relative(root, outputDir));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

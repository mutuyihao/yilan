const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { startTestServer } = require('./test-server');
const {
  buildDefaultSettings,
  launchExtensionContext,
  openExtensionPage,
  resetExtensionState,
  setSyncSettings,
  setLocalState,
  triggerActiveTabAction,
  waitForSidebarFrame,
  countStoredRecords,
  seedStoredRecords,
  overrideRuntimePolicy,
  mockNextFetchTimeout,
  mockNextFetchError,
  mockFetchFailures,
  mockNextStreamDisconnect
} = require('./extension-harness');

function createStoredRecord(overrides) {
  const extra = overrides || {};
  const title = String(extra.titleSnapshot || extra.title || 'Stored Record');
  const slug = String(extra.slug || title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'stored-record';
  const recordId = extra.recordId || 'stored_' + slug;
  const sourceUrl = extra.sourceUrl || `https://${extra.sourceHost || 'docs.example.com'}/${slug}`;
  const normalizedUrl = extra.normalizedUrl || sourceUrl;
  const sourceHost = extra.sourceHost || new URL(sourceUrl).host;
  const articleId = extra.articleId || 'article_' + slug;
  const contentHash = extra.contentHash || 'hash_' + slug;
  const articleSnapshot = Object.assign({
    articleId,
    normalizedUrl,
    sourceUrl,
    sourceHost,
    sourceType: 'doc',
    sourceStrategy: {
      strategyId: 'general_reader',
      label: 'General Reader',
      description: ''
    },
    title,
    cleanText: `${title} clean body text for seeded history tests.`,
    content: `${title} clean body text for seeded history tests.`,
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
    normalizedUrl,
    sourceHost,
    titleSnapshot: title,
    contentHash,
    articleSnapshot,
    summaryMode: 'medium',
    targetLanguage: 'auto',
    promptProfile: 'primary',
    provider: 'openai',
    model: 'gpt-4o-mini',
    endpointMode: 'responses',
    allowHistory: true,
    allowShare: true,
    retentionHint: 'persistent',
    status: 'completed',
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
    completedAt: '2026-04-15T00:00:00.000Z',
    summaryMarkdown: '## Stored Summary\n- Stored point.',
    favorite: false,
    tags: [],
    notes: ''
  }, extra, { articleSnapshot });
}

function historyItem(sidebar, title) {
  return sidebar.locator('.history-item').filter({ hasText: title });
}

async function expectDiagnosticsCode(sidebar, code) {
  await expect(sidebar.locator('.error-box')).toBeVisible();
  await expect(sidebar.locator('#diagnosticsPre')).toContainText(`"code": "${code}"`);
}

async function openHistorySidebar(harness, page) {
  await triggerActiveTabAction(harness.serviceWorker, 'showHistory');
  return await waitForSidebarFrame(page);
}

test.describe('Yilan extension E2E', () => {
  let server;

  test.beforeAll(async () => {
    server = await startTestServer();
  });

  test.afterAll(async () => {
    await server.close();
  });

  test('popup saves settings and validates connection against the mock API', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      const settings = buildDefaultSettings(server.origin, {
        providerPreset: 'custom',
        aiProvider: 'openai',
        endpointMode: 'responses',
        modelName: 'mock-model'
      });
      await setSyncSettings(harness.serviceWorker, settings);

      const popupPage = await openExtensionPage(harness.context, harness.extensionId, 'popup.html');
      await expect(popupPage.locator('#apiKey')).toHaveValue('test-key');
      await expect(popupPage.locator('#baseURL')).toHaveValue(server.origin + '/v1');
      await expect(popupPage.locator('#modelName')).toHaveValue('mock-model');

      await popupPage.fill('#modelName', 'mock-model-ui');
      await popupPage.evaluate(() => {
        const form = document.getElementById('settingsForm');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await popupPage.reload();
      await expect(popupPage.locator('#modelName')).toHaveValue('mock-model-ui');

      server.clearRequests();
      await popupPage.evaluate(() => {
        document.getElementById('testBtn').click();
      });
      await expect.poll(() => server.getRequests().length).toBe(1);

      const requests = server.getRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].stream).toBe(false);
      expect(requests[0].prompt).toContain('Please reply with OK only.');
    } finally {
      await harness.close();
    }
  });

  test('popup debounced autosave persists edited settings without explicit submit', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        modelName: 'initial-model'
      }));

      const popupPage = await openExtensionPage(harness.context, harness.extensionId, 'popup.html');
      await expect(popupPage.locator('#modelName')).toHaveValue('initial-model');

      await popupPage.locator('#modelName').fill('autosaved-model');
      await expect(popupPage.locator('#status')).toContainText('输入停顿后会自动保存');
      await expect.poll(async () => {
        return await popupPage.locator('#status').textContent();
      }).toContain('已自动保存');

      await popupPage.reload();
      await expect(popupPage.locator('#modelName')).toHaveValue('autosaved-model');
    } finally {
      await harness.close();
    }
  });

  test('popup shows endpoint compatibility errors from the background testConnection path', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        aiBaseURL: server.origin + '/v1-error',
        endpointMode: 'responses'
      }));

      const popupPage = await openExtensionPage(harness.context, harness.extensionId, 'popup.html');
      server.clearRequests();
      await popupPage.locator('#testBtn').click();

      await expect.poll(() => server.getRequests().length).toBe(1);
      await expect(popupPage.locator('#status')).toContainText('当前接口可能不支持');
    } finally {
      await harness.close();
    }
  });

  test('popup testConnection auto-toggles /v1 when the gateway requires it', async () => {
    const strictServer = await startTestServer({ openaiV1Policy: 'require' });
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(strictServer.origin, {
        providerPreset: 'custom',
        aiProvider: 'openai',
        endpointMode: 'responses',
        aiBaseURL: strictServer.origin,
        modelName: 'mock-model'
      }));

      const popupPage = await openExtensionPage(harness.context, harness.extensionId, 'popup.html');
      strictServer.clearRequests();
      await popupPage.locator('#testBtn').click();

      await expect.poll(() => strictServer.getRequests().length).toBe(2);
      await expect(popupPage.locator('#testBtn')).toBeEnabled();

      await popupPage.reload();
      await expect(popupPage.locator('#baseURL')).toHaveValue(strictServer.origin + '/v1');
    } finally {
      await harness.close();
      await strictServer.close();
    }
  });

  test('popup testConnection auto-removes /v1 when the gateway forbids it', async () => {
    const strictServer = await startTestServer({ openaiV1Policy: 'forbid' });
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(strictServer.origin, {
        providerPreset: 'openai_official',
        aiProvider: 'openai',
        endpointMode: 'responses',
        aiBaseURL: strictServer.origin + '/v1',
        modelName: 'mock-model'
      }));

      const popupPage = await openExtensionPage(harness.context, harness.extensionId, 'popup.html');
      strictServer.clearRequests();
      await popupPage.locator('#testBtn').click();

      await expect.poll(() => strictServer.getRequests().length).toBe(2);
      await expect(popupPage.locator('#testBtn')).toBeEnabled();

      await popupPage.reload();
      await expect(popupPage.locator('#baseURL')).toHaveValue(strictServer.origin);
    } finally {
      await harness.close();
      await strictServer.close();
    }
  });

  test('popup testConnection resolves endpointMode=auto by falling back to chat_completions', async () => {
    const compatServer = await startTestServer({
      allowResponses: false,
      allowChatCompletions: true,
      allowLegacyCompletions: false
    });
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(compatServer.origin, {
        providerPreset: 'custom',
        aiProvider: 'openai',
        endpointMode: 'auto',
        aiBaseURL: compatServer.origin + '/v1',
        modelName: 'mock-model'
      }));

      const popupPage = await openExtensionPage(harness.context, harness.extensionId, 'popup.html');
      compatServer.clearRequests();
      await popupPage.locator('#testBtn').click();

      await expect.poll(() => compatServer.getRequests().length).toBe(2);
      await expect(popupPage.locator('#testBtn')).toBeEnabled();
      const requests = compatServer.getRequests();
      expect(requests[0].pathname).toMatch(/\/responses$/);
      expect(requests[1].pathname).toMatch(/\/chat\/completions$/);
    } finally {
      await harness.close();
      await compatServer.close();
    }
  });

  test('injects the sidebar, generates a summary, writes history, and opens the reader page', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true,
        defaultAllowShare: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      server.clearRequests();
      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');

      const sidebar = await waitForSidebarFrame(page);
      await expect(sidebar.locator('#statusText')).toContainText('生成完成');
      await expect(sidebar.locator('#summaryRoot')).toContainText('这是模拟摘要');
      await expect(sidebar.locator('#favoriteBtn')).toHaveText(/加入收藏|取消收藏/);
      await expect.poll(async () => await countStoredRecords(sidebar)).toBe(1);

      await sidebar.locator('#historyBtn').click();
      await expect(sidebar.locator('.history-item-title')).toContainText('Playwright Basic Article');
      await sidebar.locator('#historyCloseBtn').click();

      await sidebar.locator('#readerBtn').click();
      await expect.poll(() => {
        return harness.context.pages().some((item) => item.url().includes('/reader.html?session='));
      }).toBe(true);
      const readerPage = harness.context.pages().find((item) => item.url().includes('/reader.html?session='));
      await readerPage.waitForLoadState();
      await expect(readerPage).toHaveURL(/reader\.html\?session=/);
      await expect(readerPage.locator('#readerTitle')).toContainText('Playwright Basic Article');
      await expect(readerPage.locator('#summaryArticle')).toContainText('这是模拟摘要');

      const requests = server.getRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests.some((item) => item.stream)).toBe(true);
    } finally {
      await harness.close();
    }
  });

  test('handles long article chunking and secondary action-items generation', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        entrypointSimpleMode: false,
        privacyMode: false
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-long');
      await page.bringToFront();

      server.clearRequests();
      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');

      const sidebar = await waitForSidebarFrame(page);
      await expect(sidebar.locator('#summaryRoot')).toContainText('最终汇总');

      const primaryRequests = server.getRequests();
      expect(primaryRequests.filter((item) => item.prompt.includes('你正在帮助总结一篇长网页，这是其中一个分段。')).length).toBeGreaterThan(0);
      expect(primaryRequests.some((item) => item.prompt.includes('以下是同一篇长网页分段总结后的结果'))).toBe(true);

      server.clearRequests();
      await sidebar.locator('[data-mode="action_items"]').click();
      await expect(sidebar.locator('#summaryRoot')).toContainText('可立即执行');

      const secondaryRequests = server.getRequests();
      expect(secondaryRequests).toHaveLength(1);
      expect(secondaryRequests[0].prompt).toContain('以下是网页原始摘要，请基于摘要内容进行二次加工。');
    } finally {
      await harness.close();
    }
  });

  test('reuses stored history for the same page without calling the AI endpoint again', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        entrypointAutoStart: true,
        entrypointReuseHistory: true,
        privacyMode: false
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      let sidebar = await waitForSidebarFrame(page);
      await expect(sidebar.locator('#summaryRoot')).toContainText('这是模拟摘要');
      expect(server.getRequests().length).toBeGreaterThan(0);

      server.clearRequests();
      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      sidebar = await waitForSidebarFrame(page);
      await expect(sidebar.locator('#statusText')).toContainText('已加载当前页面的历史摘要');
      expect(server.getRequests()).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  test('SPA navigation refreshes sidebar context without auto-starting a new summary', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        entrypointAutoStart: true,
        entrypointReuseHistory: true,
        privacyMode: false
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/spa-router');
      await page.bringToFront();

      server.clearRequests();
      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      const sidebar = await waitForSidebarFrame(page);

      await expect.poll(() => server.getRequests().length).toBe(1);
      await expect(sidebar.locator('#articleTitle')).toContainText('SPA Initial Article');
      await expect(sidebar.locator('#copyBtn')).toBeEnabled();

      server.clearRequests();
      await page.locator('#routeNext').click();

      await expect(sidebar.locator('#articleTitle')).toContainText('SPA Routed Article');
      await expect(sidebar.locator('#summaryRoot')).toHaveClass(/summary-placeholder/);
      await expect(sidebar.locator('#regenerateBtn')).toBeEnabled();
      expect(server.getRequests()).toHaveLength(0);

      await sidebar.locator('#regenerateBtn').click();
      await expect.poll(() => server.getRequests().length).toBe(1);
      await expect(sidebar.locator('#copyBtn')).toBeEnabled();
    } finally {
      await harness.close();
    }
  });

  test('SPA navigation during generation defers sidebar refresh until the old run completes', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        entrypointAutoStart: true,
        entrypointReuseHistory: true,
        privacyMode: false
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/spa-router?slow=1');
      await page.bringToFront();

      server.clearRequests();
      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      const sidebar = await waitForSidebarFrame(page);

      await expect.poll(() => server.getRequests().length).toBe(1);
      await expect(sidebar.locator('#articleTitle')).toContainText('Playwright Slow Article');
      await expect(sidebar.locator('#cancelBtn')).toBeEnabled();

      await page.locator('#routeNext').click();
      await page.waitForTimeout(800);

      expect(server.getRequests()).toHaveLength(1);
      await expect(sidebar.locator('#articleTitle')).toContainText('Playwright Slow Article');

      await expect(sidebar.locator('#articleTitle')).toContainText('SPA Routed Article', { timeout: 20000 });
      await expect(sidebar.locator('#summaryRoot')).toHaveClass(/summary-placeholder/);
      await expect(sidebar.locator('#regenerateBtn')).toBeEnabled();
      expect(server.getRequests()).toHaveLength(1);

      await sidebar.locator('#regenerateBtn').click();
      await expect.poll(() => server.getRequests().length).toBe(2);
      await expect(sidebar.locator('#copyBtn')).toBeEnabled();
    } finally {
      await harness.close();
    }
  });

  test('keeps no-trace summaries out of IndexedDB history', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: true,
        defaultAllowHistory: true,
        entrypointAutoStart: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      const sidebar = await waitForSidebarFrame(page);

      await expect(sidebar.locator('#statusText')).toContainText('本次未写入历史');
      await expect(sidebar.locator('#favoriteBtn')).toHaveText('未写入历史');
      await expect.poll(async () => await countStoredRecords(sidebar)).toBe(0);

      await sidebar.locator('#historyBtn').click();
      await expect(sidebar.locator('.history-empty')).toContainText('没有找到匹配的总结记录');
    } finally {
      await harness.close();
    }
  });

  test('disables share export when sharing is turned off by policy', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true,
        defaultAllowShare: false
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      const sidebar = await waitForSidebarFrame(page);

      await expect(sidebar.locator('#statusText')).toContainText('生成完成');
      await expect(sidebar.locator('#trustShareBadge')).toContainText('禁止分享');
      await expect(sidebar.locator('#shareBtn')).toBeDisabled();
    } finally {
      await harness.close();
    }
  });

  test('cancels a slow streaming generation and renders the cancelled state', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true,
        entrypointAutoStart: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-slow');
      await page.bringToFront();

      server.clearRequests();
      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      const sidebar = await waitForSidebarFrame(page);

      await expect(sidebar.locator('#cancelBtn')).toBeEnabled();
      await expect(sidebar.locator('#statusText')).toContainText(/正在提取并生成总结|正在生成总结/);
      await sidebar.locator('#cancelBtn').click();

      await expect(sidebar.locator('.cancelled-box')).toBeVisible();
      await expect(sidebar.locator('#summaryRoot')).toContainText('已取消生成');
      await expect(sidebar.locator('#statusText')).toContainText(/已停止|已在第/);
      await expect.poll(async () => await countStoredRecords(sidebar)).toBe(1);

      const requests = server.getRequests();
      expect(requests.length).toBeGreaterThan(0);
      expect(requests[0].responseOptions.delayMs).toBeGreaterThan(0);
    } finally {
      await harness.close();
    }
  });

  test('surfaces request timeouts as NETWORK_TIMEOUT diagnostics', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await overrideRuntimePolicy(harness.serviceWorker, {
        timeoutMs: 150,
        maxRetries: 1
      });
      await mockNextFetchTimeout(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      const sidebar = await waitForSidebarFrame(page);

      await expectDiagnosticsCode(sidebar, 'NETWORK_TIMEOUT');
      await expect.poll(async () => await countStoredRecords(sidebar)).toBe(1);
    } finally {
      await harness.close();
    }
  });

  test('surfaces CORS failures as NETWORK_CORS_ERROR diagnostics', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await overrideRuntimePolicy(harness.serviceWorker, {
        maxRetries: 1
      });
      await mockNextFetchError(harness.serviceWorker, 'CORS preflight failed');
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      const sidebar = await waitForSidebarFrame(page);

      await expectDiagnosticsCode(sidebar, 'NETWORK_CORS_ERROR');
      await expect.poll(async () => await countStoredRecords(sidebar)).toBe(1);
    } finally {
      await harness.close();
    }
  });

  test('surfaces network disconnects as NETWORK_CONNECTION_ERROR diagnostics', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await overrideRuntimePolicy(harness.serviceWorker, {
        maxRetries: 1
      });
      await mockNextFetchError(harness.serviceWorker, 'Failed to fetch');
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      const sidebar = await waitForSidebarFrame(page);

      await expectDiagnosticsCode(sidebar, 'NETWORK_CONNECTION_ERROR');
      await expect.poll(async () => await countStoredRecords(sidebar)).toBe(1);
    } finally {
      await harness.close();
    }
  });

  test('surfaces broken SSE streams as NETWORK_STREAM_DISCONNECTED diagnostics', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await overrideRuntimePolicy(harness.serviceWorker, {
        maxRetries: 1
      });
      await mockNextStreamDisconnect(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      const sidebar = await waitForSidebarFrame(page);

      await expectDiagnosticsCode(sidebar, 'NETWORK_STREAM_DISCONNECTED');
      await expect.poll(async () => await countStoredRecords(sidebar)).toBe(1);
    } finally {
      await harness.close();
    }
  });

  test('retries once after a transient network failure and records retry diagnostics', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await overrideRuntimePolicy(harness.serviceWorker, {
        maxRetries: 2
      });
      await mockFetchFailures(harness.serviceWorker, ['Failed to fetch']);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      server.clearRequests();
      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      const sidebar = await waitForSidebarFrame(page);

      await expect.poll(async () => {
        return await sidebar.locator('#statusText').textContent();
      }).toContain('第 1 次重试');

      await expect(sidebar.locator('#summaryRoot')).toContainText('这是模拟摘要');
      await expect(sidebar.locator('#statusText')).toContainText('生成完成');
      await expect(sidebar.locator('#diagnosticsPre')).toContainText('重试: 1 次');
      await expect.poll(() => server.getRequests().length).toBe(1);
    } finally {
      await harness.close();
    }
  });

  test('backs off across two transient failures before succeeding on the third attempt', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await overrideRuntimePolicy(harness.serviceWorker, {
        maxRetries: 3
      });
      await mockFetchFailures(harness.serviceWorker, ['Failed to fetch', 'Failed to fetch']);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      server.clearRequests();
      const startedAt = Date.now();
      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      const sidebar = await waitForSidebarFrame(page);

      await expect(sidebar.locator('#summaryRoot')).toContainText('这是模拟摘要');
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeGreaterThanOrEqual(2500);
      await expect(sidebar.locator('#statusText')).toContainText('生成完成');
      await expect(sidebar.locator('#diagnosticsPre')).toContainText('重试: 2 次');
      await expect.poll(() => server.getRequests().length).toBe(1);
    } finally {
      await harness.close();
    }
  });

  test('history panel toggles favorites, deletes records, and filters by site', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      const sidebar = await openHistorySidebar(harness, page);
      await seedStoredRecords(sidebar, [
        createStoredRecord({
          recordId: 'docs_alpha',
          titleSnapshot: 'Docs Record Alpha',
          sourceUrl: 'https://docs.example.com/alpha',
          normalizedUrl: 'https://docs.example.com/alpha',
          sourceHost: 'docs.example.com',
          updatedAt: '2026-04-15T01:00:00.000Z',
          completedAt: '2026-04-15T01:00:00.000Z',
          summaryMarkdown: '## Docs Alpha\n- Alpha note.'
        }),
        createStoredRecord({
          recordId: 'docs_beta',
          titleSnapshot: 'Docs Record Beta',
          sourceUrl: 'https://docs.example.com/beta',
          normalizedUrl: 'https://docs.example.com/beta',
          sourceHost: 'docs.example.com',
          updatedAt: '2026-04-15T02:00:00.000Z',
          completedAt: '2026-04-15T02:00:00.000Z',
          summaryMarkdown: '## Docs Beta\n- Beta note.'
        }),
        createStoredRecord({
          recordId: 'news_gamma',
          titleSnapshot: 'News Record Gamma',
          sourceUrl: 'https://news.example.com/gamma',
          normalizedUrl: 'https://news.example.com/gamma',
          sourceHost: 'news.example.com',
          updatedAt: '2026-04-15T03:00:00.000Z',
          completedAt: '2026-04-15T03:00:00.000Z',
          articleSnapshot: {
            sourceType: 'news'
          },
          summaryMarkdown: '## News Gamma\n- Gamma note.'
        })
      ]);

      await sidebar.locator('#historyCloseBtn').click();
      await sidebar.locator('#historyBtn').click();
      await expect(sidebar.locator('.history-item-title')).toHaveCount(3);

      await historyItem(sidebar, 'Docs Record Beta').locator('.history-mini-btn').first().click();
      await expect.poll(async () => {
        return await sidebar.evaluate(async (title) => {
          const items = await window.db.searchRecords(title);
          const match = items.find((item) => item.titleSnapshot === title);
          return !!match && !!match.favorite;
        }, 'Docs Record Beta');
      }).toBe(true);

      await sidebar.locator('#favoritesOnly').check();
      await expect(sidebar.locator('.history-item-title')).toHaveCount(1);
      await expect(sidebar.locator('.history-item-title')).toContainText(['Docs Record Beta']);

      await sidebar.locator('#favoritesOnly').uncheck();
      await historyItem(sidebar, 'Docs Record Alpha').locator('.history-mini-btn').nth(1).click();
      await expect.poll(async () => await countStoredRecords(sidebar)).toBe(2);
      await expect(historyItem(sidebar, 'Docs Record Alpha')).toHaveCount(0);

      await sidebar.locator('.history-site-chip').filter({ hasText: 'news.example.com' }).click();
      await expect(sidebar.locator('.history-item-title')).toHaveCount(1);
      await expect(sidebar.locator('.history-item-title')).toContainText(['News Record Gamma']);
      await expect(historyItem(sidebar, 'Docs Record Beta')).toHaveCount(0);
    } finally {
      await harness.close();
    }
  });

  test('opens the reader from a selected history record instead of the current page snapshot', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      const sidebar = await openHistorySidebar(harness, page);
      await seedStoredRecords(sidebar, [
        createStoredRecord({
          recordId: 'archived_reader_record',
          titleSnapshot: 'Archived Reader Record',
          sourceUrl: 'https://archive.example.com/reader-source',
          normalizedUrl: 'https://archive.example.com/reader-source',
          sourceHost: 'archive.example.com',
          updatedAt: '2026-04-15T05:00:00.000Z',
          completedAt: '2026-04-15T05:00:00.000Z',
          summaryMarkdown: '## Archived Summary\n- Loaded from history record.',
          articleSnapshot: {
            sourceType: 'doc',
            title: 'Archived Reader Record',
            cleanText: 'Archived reader clean text.',
            content: 'Archived reader clean text.'
          }
        })
      ]);

      await sidebar.locator('#historyCloseBtn').click();
      await sidebar.locator('#historyBtn').click();
      await historyItem(sidebar, 'Archived Reader Record').click();

      await expect(sidebar.locator('#articleTitle')).toContainText('Archived Reader Record');
      await expect(sidebar.locator('#readerBtn')).toBeEnabled();
      await sidebar.locator('#readerBtn').click();

      await expect.poll(() => {
        return harness.context.pages().some((item) => item.url().includes('/reader.html?session='));
      }).toBe(true);
      const readerPage = harness.context.pages().find((item) => item.url().includes('/reader.html?session='));
      await readerPage.waitForLoadState();
      await expect(readerPage.locator('#readerTitle')).toContainText('Archived Reader Record');
      await expect(readerPage.locator('#readerTitle')).not.toContainText('Playwright Basic Article');
      await expect(readerPage.locator('#readerSourceLink')).toHaveAttribute('href', 'https://archive.example.com/reader-source');
      await expect(readerPage.locator('#summaryArticle')).toContainText('Loaded from history record.');
    } finally {
      await harness.close();
    }
  });

  test('opens cancelled history records in the reader with partial content and diagnostics', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      const sidebar = await openHistorySidebar(harness, page);
      await seedStoredRecords(sidebar, [
        createStoredRecord({
          recordId: 'cancelled_reader_record',
          titleSnapshot: 'Cancelled Reader Record',
          sourceUrl: 'https://archive.example.com/cancelled-reader',
          normalizedUrl: 'https://archive.example.com/cancelled-reader',
          sourceHost: 'archive.example.com',
          updatedAt: '2026-04-15T05:30:00.000Z',
          completedAt: '2026-04-15T05:30:00.000Z',
          status: 'cancelled',
          errorCode: 'RUN_CANCELLED',
          errorMessage: '本次生成已取消。',
          summaryMarkdown: '## Partial Cancelled Summary\n- Partial content kept before cancellation.',
          diagnostics: {
            runId: 'run_cancelled_reader',
            retryCount: 0,
            durationMs: 1234,
            provider: 'openai',
            model: 'gpt-4o-mini',
            endpointMode: 'responses',
            finalRun: {
              status: 'cancelled',
              stage: 'primary',
              durationMs: 1234
            },
            error: {
              code: 'RUN_CANCELLED',
              message: '本次生成已取消。',
              stage: 'primary'
            }
          },
          articleSnapshot: {
            sourceType: 'doc',
            title: 'Cancelled Reader Record',
            cleanText: 'Partial cancelled reader clean text.',
            content: 'Partial cancelled reader clean text.'
          }
        })
      ]);

      await sidebar.locator('#historyCloseBtn').click();
      await sidebar.locator('#historyBtn').click();
      await historyItem(sidebar, 'Cancelled Reader Record').click();

      await expect(sidebar.locator('.cancelled-box')).toBeVisible();
      await expect(sidebar.locator('#readerBtn')).toBeEnabled();
      await sidebar.locator('#readerBtn').click();

      await expect.poll(() => {
        return harness.context.pages().some((item) => item.url().includes('/reader.html?session='));
      }).toBe(true);
      const readerPage = harness.context.pages().find((item) => item.url().includes('/reader.html?session='));
      await readerPage.waitForLoadState();
      await expect(readerPage.locator('#readerTitle')).toContainText('Cancelled Reader Record');
      await expect(readerPage.locator('#detailRow')).toContainText('已取消');
      await expect(readerPage.locator('#summaryArticle')).toContainText('Partial content kept before cancellation.');
      await expect(readerPage.locator('#readerDiagnostics')).toBeVisible();
      await expect(readerPage.locator('#diagnosticsPre')).toContainText('RUN_CANCELLED');
      await expect(readerPage.locator('#copyBtn')).toBeEnabled();
    } finally {
      await harness.close();
    }
  });

  test('failed history records without summaries stay unreadable and keep the reader button disabled', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      const sidebar = await openHistorySidebar(harness, page);
      await seedStoredRecords(sidebar, [
        createStoredRecord({
          recordId: 'failed_reader_record',
          titleSnapshot: 'Failed Reader Record',
          sourceUrl: 'https://archive.example.com/failed-reader',
          normalizedUrl: 'https://archive.example.com/failed-reader',
          sourceHost: 'archive.example.com',
          updatedAt: '2026-04-15T05:40:00.000Z',
          completedAt: '2026-04-15T05:40:00.000Z',
          status: 'failed',
          errorCode: 'NETWORK_CONNECTION_ERROR',
          errorMessage: '接口连接失败，请稍后重试。',
          summaryMarkdown: '',
          diagnostics: {
            runId: 'run_failed_reader',
            retryCount: 1,
            durationMs: 1800,
            provider: 'openai',
            model: 'gpt-4o-mini',
            endpointMode: 'responses',
            finalRun: {
              status: 'failed',
              stage: 'primary',
              durationMs: 1800
            },
            error: {
              code: 'NETWORK_CONNECTION_ERROR',
              message: '接口连接失败，请稍后重试。',
              stage: 'primary'
            }
          }
        })
      ]);

      await sidebar.locator('#historyCloseBtn').click();
      await sidebar.locator('#historyBtn').click();
      await expect(historyItem(sidebar, 'Failed Reader Record').locator('.history-preview')).toContainText('接口连接失败');
      await historyItem(sidebar, 'Failed Reader Record').click();

      await expect(sidebar.locator('.error-box')).toBeVisible();
      await expect(sidebar.locator('#summaryRoot')).toContainText('接口连接失败');
      await expect(sidebar.locator('#readerBtn')).toBeDisabled();
    } finally {
      await harness.close();
    }
  });

  test('shows the reader empty state when the session is missing or expired', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);

      const readerPage = await openExtensionPage(
        harness.context,
        harness.extensionId,
        'reader.html?session=missing-session'
      );

      await expect(readerPage.locator('#emptyState')).toBeVisible();
      await expect(readerPage.locator('#emptyTitle')).toContainText('无法打开阅读页');
      await expect(readerPage.locator('#emptyDetail')).toContainText('阅读会话已失效');
    } finally {
      await harness.close();
    }
  });

  test('reader falls back to the stored snapshot when the referenced history record no longer exists', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setLocalState(harness.serviceWorker, {
        'readerSession:orphan-snapshot': {
          createdAt: '2026-04-15T06:00:00.000Z',
          snapshot: {
            recordId: 'deleted_record_id',
            title: 'Orphan Snapshot Reader',
            sourceUrl: 'https://archive.example.com/orphan-reader',
            sourceHost: 'archive.example.com',
            sourceTypeLabel: '文档',
            strategyLabel: 'General Reader',
            summaryMode: 'medium',
            summaryModeLabel: '标准总结',
            provider: 'openai',
            providerLabel: 'OpenAI Compatible',
            model: 'gpt-4o-mini',
            status: 'completed',
            completedAt: '2026-04-15T06:00:00.000Z',
            completedAtLabel: '2026/04/15 06:00',
            favorite: false,
            allowHistory: true,
            privacyMode: false,
            summaryMarkdown: '## Snapshot Summary\n- Loaded from session snapshot fallback.',
            summaryPlainText: 'Snapshot Summary Loaded from session snapshot fallback.'
          }
        }
      });

      const readerPage = await openExtensionPage(
        harness.context,
        harness.extensionId,
        'reader.html?session=orphan-snapshot'
      );

      await expect(readerPage.locator('#readerLayout')).toBeVisible();
      await expect(readerPage.locator('#readerTitle')).toContainText('Orphan Snapshot Reader');
      await expect(readerPage.locator('#readerSourceLink')).toHaveAttribute('href', 'https://archive.example.com/orphan-reader');
      await expect(readerPage.locator('#summaryArticle')).toContainText('Loaded from session snapshot fallback.');
      await expect(readerPage.locator('#emptyState')).toBeHidden();
    } finally {
      await harness.close();
    }
  });

  test('reader disables outbound source links when the snapshot has no valid source URL', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setLocalState(harness.serviceWorker, {
        'readerSession:no-source': {
          createdAt: '2026-04-15T06:10:00.000Z',
          snapshot: {
            title: 'Reader Without Source',
            sourceUrl: '',
            sourceHost: '',
            sourceTypeLabel: '通用网页',
            strategyLabel: 'General Reader',
            summaryMode: 'medium',
            summaryModeLabel: '标准总结',
            provider: 'openai',
            providerLabel: 'OpenAI Compatible',
            model: 'gpt-4o-mini',
            status: 'completed',
            completedAt: '2026-04-15T06:10:00.000Z',
            completedAtLabel: '2026/04/15 06:10',
            favorite: false,
            allowHistory: false,
            privacyMode: true,
            summaryMarkdown: '## No Source Summary\n- Source URL is unavailable.',
            summaryPlainText: 'No Source Summary Source URL is unavailable.'
          }
        }
      });

      const readerPage = await openExtensionPage(
        harness.context,
        harness.extensionId,
        'reader.html?session=no-source'
      );

      await expect(readerPage.locator('#readerTitle')).toContainText('Reader Without Source');
      await expect(readerPage.locator('#readerSourceLink')).toHaveAttribute('aria-disabled', 'true');
      await expect(readerPage.locator('#readerSourceLink')).toContainText('没有可用原文链接');
      await expect(readerPage.locator('#openSourceBtn')).toHaveAttribute('aria-disabled', 'true');
      await expect(readerPage.locator('#summaryArticle')).toContainText('Source URL is unavailable.');
    } finally {
      await harness.close();
    }
  });

  test('exports markdown and share-card image as downloads', async () => {
    const harness = await launchExtensionContext();
    try {
      await resetExtensionState(harness.serviceWorker);
      await setSyncSettings(harness.serviceWorker, buildDefaultSettings(server.origin, {
        privacyMode: false,
        defaultAllowHistory: true,
        defaultAllowShare: true
      }));

      const page = harness.context.pages()[0] || await harness.context.newPage();
      await page.goto(server.origin + '/article-basic');
      await page.bringToFront();

      await triggerActiveTabAction(harness.serviceWorker, 'extractAndSummarize');
      const sidebar = await waitForSidebarFrame(page);
      await expect(sidebar.locator('#summaryRoot')).toContainText('这是模拟摘要');

      const markdownDownloadPromise = page.waitForEvent('download');
      await sidebar.locator('#exportBtn').click();
      const markdownDownload = await markdownDownloadPromise;
      expect(markdownDownload.suggestedFilename()).toMatch(/Playwright Basic Article.*\.md$/);
      const markdownPath = path.join(os.tmpdir(), 'yilan-playwright-export.md');
      await markdownDownload.saveAs(markdownPath);
      const markdownContent = await fs.readFile(markdownPath, 'utf8');
      expect(markdownContent).toContain('# Playwright Basic Article');
      expect(markdownContent).toContain('> 来源：');
      expect(markdownContent).toContain('## 核心结论');

      const imageDownloadPromise = page.waitForEvent('download');
      await sidebar.locator('#shareBtn').click();
      const imageDownload = await imageDownloadPromise;
      expect(imageDownload.suggestedFilename()).toMatch(/Playwright Basic Article.*\.png$/);
      const imagePath = path.join(os.tmpdir(), 'yilan-playwright-share.png');
      await imageDownload.saveAs(imagePath);
      const stat = await fs.stat(imagePath);
      expect(stat.size).toBeGreaterThan(1024);
      await expect(sidebar.locator('#statusText')).toContainText('长截图已生成');
    } finally {
      await harness.close();
    }
  });
});

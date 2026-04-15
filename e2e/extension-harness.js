const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { chromium } = require('@playwright/test');

const EXTENSION_ROOT = path.resolve(__dirname, '..');
const CONTENT_SCRIPT_FILES = [
  'shared/domain.js',
  'shared/strings.js',
  'shared/page-strategy.js',
  'shared/article-utils.js',
  'libs/readability.js',
  'content.js'
];
const DB_NAME = 'aiSummaryDB';

function buildDefaultSettings(origin, overrides) {
  return Object.assign({
    providerPreset: 'custom',
    aiProvider: 'openai',
    endpointMode: 'responses',
    apiKey: 'test-key',
    aiBaseURL: origin + '/v1',
    modelName: 'mock-model',
    systemPrompt: '',
    autoTranslate: false,
    defaultLanguage: 'zh',
    themePreference: 'system',
    privacyMode: false,
    defaultAllowHistory: true,
    defaultAllowShare: true,
    entrypointAutoStart: true,
    entrypointSimpleMode: false,
    entrypointReuseHistory: true
  }, overrides || {});
}

async function launchExtensionContext() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'yilan-playwright-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: process.env.PW_HEADLESS !== '0',
    acceptDownloads: true,
    viewport: { width: 1440, height: 960 },
    args: [
      `--disable-extensions-except=${EXTENSION_ROOT}`,
      `--load-extension=${EXTENSION_ROOT}`
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

async function openExtensionPage(context, extensionId, relativePath) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${relativePath}`);
  return page;
}

async function resetExtensionState(serviceWorker) {
  await serviceWorker.evaluate(async (dbName) => {
    await new Promise((resolve, reject) => {
      chrome.storage.sync.clear(() => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });

    await new Promise((resolve, reject) => {
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });

    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('delete database failed'));
      request.onblocked = () => resolve();
    });
  }, DB_NAME);
}

async function setSyncSettings(serviceWorker, settings) {
  await serviceWorker.evaluate(async (payload) => {
    await new Promise((resolve, reject) => {
      chrome.storage.sync.set(payload, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }, settings);
}

async function setLocalState(serviceWorker, payload) {
  await serviceWorker.evaluate(async (items) => {
    await new Promise((resolve, reject) => {
      chrome.storage.local.set(items || {}, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }, payload);
}

async function triggerActiveTabAction(serviceWorker, action) {
  await serviceWorker.evaluate(async ({ actionName, files }) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error('No active tab found.');
    }

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    } catch {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files
      });
    }

    await chrome.tabs.sendMessage(tab.id, { action: actionName });
  }, {
    actionName: action,
    files: CONTENT_SCRIPT_FILES
  });
}

async function waitForSidebarFrame(page) {
  const handle = await page.waitForSelector('#ai-summary-sidebar', { state: 'attached' });
  let frame = await handle.contentFrame();
  if (!frame) {
    await page.waitForTimeout(200);
    frame = await handle.contentFrame();
  }
  if (!frame) {
    throw new Error('Sidebar iframe did not resolve to a frame.');
  }
  await frame.waitForSelector('#statusText');
  return frame;
}

async function countStoredRecords(frame) {
  return await frame.evaluate(async () => {
    const items = await window.db.getAll();
    return items.length;
  });
}

async function seedStoredRecords(frame, records) {
  await frame.evaluate(async (items) => {
    for (const item of items || []) {
      await window.db.saveRecord(item);
    }
  }, records);
}

async function overrideRuntimePolicy(serviceWorker, overrides) {
  await serviceWorker.evaluate((policy) => {
    const registry = self.AISummaryAdapterRegistry;
    const originalResolve = registry.resolve.bind(registry);

    registry.resolve = function patchedResolve(settings) {
      const result = originalResolve(settings);
      if (!result) return result;

      if (typeof policy?.timeoutMs === 'number') {
        result.snapshot.timeoutMs = policy.timeoutMs;
      }

      if (typeof policy?.maxRetries === 'number') {
        result.snapshot.retryPolicy = Object.assign({}, result.snapshot.retryPolicy || {}, {
          maxRetries: policy.maxRetries
        });
      }

      return result;
    };
  }, overrides || {});
}

async function mockNextFetchTimeout(serviceWorker) {
  await serviceWorker.evaluate(() => {
    const originalFetch = self.fetch.bind(self);
    let used = false;

    self.fetch = function patchedFetch(input, init) {
      if (used) {
        return originalFetch(input, init);
      }

      used = true;
      const signal = init && init.signal;

      return new Promise((resolve, reject) => {
        if (signal && signal.aborted) {
          const abortError = new Error(String(signal.reason || 'timeout'));
          abortError.name = 'AbortError';
          reject(abortError);
          return;
        }

        if (!signal) {
          return;
        }

        signal.addEventListener('abort', () => {
          const abortError = new Error(String(signal.reason || 'timeout'));
          abortError.name = 'AbortError';
          reject(abortError);
        }, { once: true });
      });
    };
  });
}

async function mockNextFetchError(serviceWorker, message) {
  await serviceWorker.evaluate((detail) => {
    const originalFetch = self.fetch.bind(self);
    let used = false;

    self.fetch = function patchedFetch(input, init) {
      if (used) {
        return originalFetch(input, init);
      }

      used = true;
      return Promise.reject(new Error(String(detail || 'Failed to fetch')));
    };
  }, message);
}

async function mockFetchFailures(serviceWorker, failures) {
  await serviceWorker.evaluate((messages) => {
    const originalFetch = self.fetch.bind(self);
    const queue = Array.isArray(messages) ? messages.slice() : [messages];

    self.fetch = function patchedFetch(input, init) {
      if (!queue.length) {
        return originalFetch(input, init);
      }

      const detail = queue.shift();
      return Promise.reject(new Error(String(detail || 'Failed to fetch')));
    };
  }, failures);
}

async function mockNextStreamDisconnect(serviceWorker) {
  await serviceWorker.evaluate(() => {
    const originalFetch = self.fetch.bind(self);
    let used = false;

    self.fetch = function patchedFetch(input, init) {
      if (used) {
        return originalFetch(input, init);
      }

      used = true;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            'event: response.output_text.delta\n' +
            'data: {"type":"response.output_text.delta","delta":"Partial stream token."}\n\n'
          ));
          controller.error(new Error('stream_disconnected'));
        }
      });

      return Promise.resolve(new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8'
        }
      }));
    };
  });
}

async function setCheckbox(page, selector, checked) {
  const locator = page.locator(selector);
  if (checked) {
    await locator.check();
  } else {
    await locator.uncheck();
  }
}

async function configurePopupSettings(page, origin, overrides) {
  const settings = buildDefaultSettings(origin, overrides);

  await page.waitForSelector('#settingsForm');
  await page.selectOption('#providerPreset', settings.providerPreset);
  await page.selectOption('#aiProvider', settings.aiProvider);
  await page.selectOption('#endpointMode', settings.endpointMode);
  await page.fill('#apiKey', settings.apiKey);
  await page.fill('#baseURL', settings.aiBaseURL);
  await page.fill('#modelName', settings.modelName);
  await page.fill('#systemPrompt', settings.systemPrompt);
  await setCheckbox(page, '#autoTranslate', settings.autoTranslate);
  await page.selectOption('#defaultLanguage', settings.defaultLanguage);
  await page.selectOption('#themePreference', settings.themePreference);
  await setCheckbox(page, '#privacyMode', settings.privacyMode);
  await setCheckbox(page, '#defaultAllowHistory', settings.defaultAllowHistory);
  await setCheckbox(page, '#defaultAllowShare', settings.defaultAllowShare);
  await setCheckbox(page, '#entrypointAutoStart', settings.entrypointAutoStart);
  await setCheckbox(page, '#entrypointSimpleMode', settings.entrypointSimpleMode);
  await setCheckbox(page, '#entrypointReuseHistory', settings.entrypointReuseHistory);

  return settings;
}

module.exports = {
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
  mockNextStreamDisconnect,
  configurePopupSettings
};

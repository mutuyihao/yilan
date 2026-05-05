(function initYilanEntrypoints(global) {
  const SUMMARY_CONTEXT_MENU_ID = 'summarizeArticle';
  const SUMMARY_COMMAND_ID = 'trigger-summary';
  const ENTRYPOINT_STATUS_KEY = 'entrypointStatus';
  const CONTENT_ACTION = 'extractAndSummarize';
  const SHORTCUT_SETTINGS_URL = /\bEdg\//.test(global.navigator?.userAgent || '')
    ? 'edge://extensions/shortcuts'
    : 'chrome://extensions/shortcuts';

  let bound = false;

  function readRuntimeLastErrorMessage() {
    return chrome.runtime.lastError?.message || '';
  }

  function storageLocalGet(key) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get(key, (items) => {
        const error = readRuntimeLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve(items || {});
      });
    });
  }

  function storageLocalSet(payload) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(payload, () => {
        const error = readRuntimeLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve();
      });
    });
  }

  function contextMenusRemoveAll() {
    return new Promise((resolve) => {
      chrome.contextMenus.removeAll(() => {
        resolve(chrome.runtime.lastError?.message || '');
      });
    });
  }

  function contextMenuCreate(payload) {
    return new Promise((resolve) => {
      chrome.contextMenus.create(payload, () => {
        resolve(chrome.runtime.lastError?.message || '');
      });
    });
  }

  function commandsGetAll() {
    return new Promise((resolve, reject) => {
      chrome.commands.getAll((commands) => {
        const error = readRuntimeLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve(Array.isArray(commands) ? commands : []);
      });
    });
  }

  function createTab(url) {
    return new Promise((resolve) => {
      chrome.tabs.create({ url }, (tab) => {
        const error = chrome.runtime.lastError?.message || '';
        resolve({
          success: !error,
          error,
          tab: tab || null
        });
      });
    });
  }

  function createDefaultEntrypointStatus() {
    return {
      browserShortcutSettingsUrl: SHORTCUT_SETTINGS_URL,
      contextMenu: {
        id: SUMMARY_CONTEXT_MENU_ID,
        status: 'unknown',
        lastEnsuredAt: '',
        lastTriggeredAt: '',
        lastCheckedAt: '',
        lastError: ''
      },
      shortcut: {
        command: SUMMARY_COMMAND_ID,
        status: 'unknown',
        shortcut: '',
        lastTriggeredAt: '',
        lastCheckedAt: '',
        conflictStatus: 'unknown',
        note: ''
      }
    };
  }

  async function readEntrypointStatus() {
    const items = await storageLocalGet(ENTRYPOINT_STATUS_KEY);
    const defaults = createDefaultEntrypointStatus();
    const stored = items[ENTRYPOINT_STATUS_KEY] || {};
    return {
      browserShortcutSettingsUrl: SHORTCUT_SETTINGS_URL,
      contextMenu: Object.assign({}, defaults.contextMenu, stored.contextMenu || {}),
      shortcut: Object.assign({}, defaults.shortcut, stored.shortcut || {})
    };
  }

  async function updateEntrypointStatus(patch) {
    const current = await readEntrypointStatus();
    const next = {
      browserShortcutSettingsUrl: SHORTCUT_SETTINGS_URL,
      contextMenu: Object.assign({}, current.contextMenu, patch?.contextMenu || {}),
      shortcut: Object.assign({}, current.shortcut, patch?.shortcut || {})
    };
    await storageLocalSet({ [ENTRYPOINT_STATUS_KEY]: next });
    return next;
  }

  async function ensureContextMenuRegistered(reason) {
    const checkedAt = new Date().toISOString();
    const removeError = await contextMenusRemoveAll();
    const createError = await contextMenuCreate({
      id: SUMMARY_CONTEXT_MENU_ID,
      title: '用一览总结此页',
      contexts: ['page', 'selection', 'link']
    });

    const error = createError || removeError;
    return updateEntrypointStatus({
      contextMenu: {
        id: SUMMARY_CONTEXT_MENU_ID,
        status: error ? 'error' : 'ready',
        lastEnsuredAt: checkedAt,
        lastCheckedAt: checkedAt,
        lastError: error ? '[' + reason + '] ' + error : ''
      }
    });
  }

  async function refreshShortcutStatus() {
    const checkedAt = new Date().toISOString();
    const commands = await commandsGetAll();
    const command = commands.find((item) => item.name === SUMMARY_COMMAND_ID) || null;
    const shortcut = command?.shortcut || '';
    const status = !command ? 'missing' : shortcut ? 'assigned' : 'unassigned';
    const note = !command
      ? 'manifest 中未找到 trigger-summary 快捷键。'
      : shortcut
        ? '浏览器已分配快捷键；如果按下无响应，请前往快捷键设置页重新绑定。'
        : '当前没有检测到已生效的快捷键，可能未分配或与其它快捷键冲突。';

    return updateEntrypointStatus({
      shortcut: {
        command: SUMMARY_COMMAND_ID,
        status,
        shortcut,
        lastCheckedAt: checkedAt,
        conflictStatus: shortcut ? 'unknown' : 'possible_or_unassigned',
        note
      }
    });
  }

  async function getEntrypointStatus() {
    await ensureContextMenuRegistered('status_check');
    return refreshShortcutStatus();
  }

  async function openShortcutSettings() {
    const result = await createTab(SHORTCUT_SETTINGS_URL);
    return {
      success: result.success,
      error: result.error,
      url: SHORTCUT_SETTINGS_URL
    };
  }

  function warn(logger, message, error) {
    const target = logger || console;
    if (typeof target?.warn === 'function') {
      target.warn(message, error);
    }
  }

  function bindEntrypoints(options) {
    if (bound) return false;
    bound = true;

    const logger = options?.logger || console;
    const onTrigger = typeof options?.onTrigger === 'function'
      ? options.onTrigger
      : async () => {};

    function ensureAndRefresh(reason, label) {
      ensureContextMenuRegistered(reason).catch((error) => {
        warn(logger, '[Yilan] Failed to register context menu on ' + label + '.', error);
      });
      refreshShortcutStatus().catch((error) => {
        warn(logger, '[Yilan] Failed to refresh shortcut status on ' + label + '.', error);
      });
    }

    chrome.runtime.onInstalled.addListener(() => {
      ensureAndRefresh('installed', 'install');
    });

    chrome.runtime.onStartup.addListener(() => {
      ensureAndRefresh('startup', 'startup');
    });

    ensureAndRefresh('service_worker_started', 'service worker start');

    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
      if (info.menuItemId !== SUMMARY_CONTEXT_MENU_ID) return;
      updateEntrypointStatus({
        contextMenu: {
          status: 'ready',
          lastTriggeredAt: new Date().toISOString()
        }
      }).catch(() => {});
      await onTrigger(tab, CONTENT_ACTION);
    });

    chrome.commands.onCommand.addListener(async (command) => {
      if (command !== SUMMARY_COMMAND_ID) return;
      updateEntrypointStatus({
        shortcut: {
          status: 'assigned',
          lastTriggeredAt: new Date().toISOString()
        }
      }).catch(() => {});
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await onTrigger(tab, CONTENT_ACTION);
      }
    });

    return true;
  }

  const api = {
    SUMMARY_CONTEXT_MENU_ID,
    SUMMARY_COMMAND_ID,
    ENTRYPOINT_STATUS_KEY,
    SHORTCUT_SETTINGS_URL,
    createDefaultEntrypointStatus,
    readEntrypointStatus,
    updateEntrypointStatus,
    ensureContextMenuRegistered,
    refreshShortcutStatus,
    getEntrypointStatus,
    openShortcutSettings,
    bindEntrypoints
  };

  global.YilanEntrypoints = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);

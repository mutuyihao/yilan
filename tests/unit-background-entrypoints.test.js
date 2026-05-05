const { test, assert, freshRequire } = require('./harness');

function installChromeEntrypointFake(options) {
  const store = Object.assign({}, options?.store || {});
  const calls = {
    createdMenus: [],
    createdTabs: [],
    removeAllCount: 0
  };
  const listeners = {};
  const commands = options?.commands || [];
  const tabs = options?.tabs || [{ id: 1 }];
  const failures = Object.assign({}, options?.failures || {});

  function withLastError(message, callback) {
    global.chrome.runtime.lastError = message ? { message } : null;
    try {
      callback();
    } finally {
      global.chrome.runtime.lastError = null;
    }
  }

  global.chrome = {
    runtime: {
      lastError: null,
      onInstalled: {
        addListener(listener) {
          listeners.installed = listener;
        }
      },
      onStartup: {
        addListener(listener) {
          listeners.startup = listener;
        }
      }
    },
    storage: {
      local: {
        get(key, callback) {
          withLastError(failures.storageGet, () => {
            callback({ [key]: store[key] });
          });
        },
        set(payload, callback) {
          withLastError(failures.storageSet, () => {
            if (!failures.storageSet) {
              Object.assign(store, payload || {});
            }
            callback?.();
          });
        }
      }
    },
    contextMenus: {
      removeAll(callback) {
        calls.removeAllCount += 1;
        callback?.();
      },
      create(payload, callback) {
        calls.createdMenus.push(payload);
        callback?.();
      },
      onClicked: {
        addListener(listener) {
          listeners.contextClicked = listener;
        }
      }
    },
    commands: {
      getAll(callback) {
        withLastError(failures.commandsGetAll, () => {
          callback(commands);
        });
      },
      onCommand: {
        addListener(listener) {
          listeners.command = listener;
        }
      }
    },
    tabs: {
      create(payload, callback) {
        calls.createdTabs.push(payload.url);
        callback?.({ id: 99, url: payload.url });
      },
      query() {
        return Promise.resolve(tabs);
      }
    }
  };

  return { store, calls, listeners };
}

test('background entrypoints maintain context menu and shortcut status', [
  'entrypoint.context_menu',
  'entrypoint.shortcut',
  'entrypoint.status'
], async () => {
  const fake = installChromeEntrypointFake({
    commands: [{ name: 'trigger-summary', shortcut: 'Alt+S' }]
  });

  const Entrypoints = freshRequire('background/entrypoints.js');
  const status = await Entrypoints.getEntrypointStatus();

  assert.strictEqual(status.contextMenu.status, 'ready');
  assert.strictEqual(status.shortcut.status, 'assigned');
  assert.strictEqual(status.shortcut.shortcut, 'Alt+S');
  assert.strictEqual(fake.calls.removeAllCount, 1);
  assert.strictEqual(fake.calls.createdMenus[0].id, Entrypoints.SUMMARY_CONTEXT_MENU_ID);
  assert.strictEqual(fake.store[Entrypoints.ENTRYPOINT_STATUS_KEY].contextMenu.id, Entrypoints.SUMMARY_CONTEXT_MENU_ID);

  const shortcutResult = await Entrypoints.openShortcutSettings();
  assert.strictEqual(shortcutResult.success, true);
  assert.strictEqual(shortcutResult.url, Entrypoints.SHORTCUT_SETTINGS_URL);
  assert.deepStrictEqual(fake.calls.createdTabs, [Entrypoints.SHORTCUT_SETTINGS_URL]);

  delete global.chrome;
});

test('background entrypoints bind browser events to content triggers once', [
  'entrypoint.context_menu',
  'entrypoint.shortcut'
], async () => {
  const fake = installChromeEntrypointFake({
    commands: [{ name: 'trigger-summary', shortcut: 'Alt+S' }],
    tabs: [{ id: 42 }]
  });
  const triggered = [];
  const warnings = [];
  const Entrypoints = freshRequire('background/entrypoints.js');

  assert.strictEqual(Entrypoints.bindEntrypoints({
    logger: {
      warn(message, error) {
        warnings.push({ message, error });
      }
    },
    onTrigger(tab, action) {
      triggered.push({ tab, action });
    }
  }), true);
  assert.strictEqual(Entrypoints.bindEntrypoints({ onTrigger() {} }), false);

  await fake.listeners.contextClicked({ menuItemId: Entrypoints.SUMMARY_CONTEXT_MENU_ID }, { id: 7 });
  await fake.listeners.command(Entrypoints.SUMMARY_COMMAND_ID);
  await fake.listeners.contextClicked({ menuItemId: 'other' }, { id: 8 });
  await fake.listeners.command('other-command');

  assert.deepStrictEqual(triggered, [
    { tab: { id: 7 }, action: 'extractAndSummarize' },
    { tab: { id: 42 }, action: 'extractAndSummarize' }
  ]);
  assert.deepStrictEqual(warnings, []);

  delete global.chrome;
});

test('background entrypoints surface callback failures from storage and commands', [
  'entrypoint.status'
], async () => {
  let fake = installChromeEntrypointFake({
    failures: { storageGet: 'storage_read_failed' }
  });
  let Entrypoints = freshRequire('background/entrypoints.js');
  await assert.rejects(() => Entrypoints.readEntrypointStatus(), /storage_read_failed/);
  delete global.chrome;

  fake = installChromeEntrypointFake({
    failures: { commandsGetAll: 'commands_unavailable' }
  });
  Entrypoints = freshRequire('background/entrypoints.js');
  await assert.rejects(() => Entrypoints.refreshShortcutStatus(), /commands_unavailable/);
  delete global.chrome;
});

const { test, assert, freshRequire } = require('./harness');

function installChromeStorage(seed, options) {
  const store = Object.assign({}, seed || {});
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
      lastError: null
    },
    storage: {
      local: {
        get(key, callback) {
          withLastError(failures.get, () => {
            if (key === null) {
              callback(Object.assign({}, store));
              return;
            }
            callback({ [key]: store[key] });
          });
        },
        set(payload, callback) {
          withLastError(failures.set, () => {
            if (!failures.set) {
              Object.assign(store, payload || {});
            }
            callback?.();
          });
        },
        remove(keys, callback) {
          withLastError(failures.remove, () => {
            if (!failures.remove) {
              (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
                delete store[key];
              });
            }
            callback?.();
          });
        }
      }
    }
  };
  return store;
}

test('background reader sessions create snapshots and clean up stale entries', 'reader.session', async () => {
  const staleKey = 'readerSession:stale';
  const freshKey = 'readerSession:fresh';
  const store = installChromeStorage({
    [staleKey]: {
      createdAt: new Date(Date.now() - (25 * 60 * 60 * 1000)).toISOString(),
      snapshot: { title: 'stale' }
    },
    [freshKey]: {
      createdAt: new Date().toISOString(),
      snapshot: { title: 'fresh' }
    },
    unrelated: {
      createdAt: 'not-a-date'
    }
  });

  const ReaderSessions = freshRequire('background/reader-sessions.js');
  const staleKeys = await ReaderSessions.cleanupReaderSessions();
  assert.deepStrictEqual(staleKeys, [staleKey]);
  assert.strictEqual(store[staleKey], undefined);
  assert.ok(store[freshKey]);
  assert.ok(store.unrelated);

  const sessionId = await ReaderSessions.createReaderSession({ title: 'new snapshot' });
  const sessionKey = ReaderSessions.READER_SESSION_PREFIX + sessionId;
  assert.ok(sessionId.startsWith('reader_'));
  assert.deepStrictEqual(store[sessionKey].snapshot, { title: 'new snapshot' });
  assert.ok(store[sessionKey].createdAt);

  delete global.chrome;
});

test('background reader sessions surface storage callback failures', 'reader.session', async () => {
  installChromeStorage({}, {
    failures: { get: 'storage_read_failed' }
  });
  let ReaderSessions = freshRequire('background/reader-sessions.js');
  await assert.rejects(() => ReaderSessions.cleanupReaderSessions(), /storage_read_failed/);
  delete global.chrome;

  installChromeStorage({}, {
    failures: { set: 'storage_write_failed' }
  });
  ReaderSessions = freshRequire('background/reader-sessions.js');
  await assert.rejects(() => ReaderSessions.createReaderSession({ title: 'new snapshot' }), /storage_write_failed/);
  delete global.chrome;
});

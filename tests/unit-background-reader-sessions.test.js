const { test, assert, freshRequire } = require('./harness');

function installChromeStorage(seed) {
  const store = Object.assign({}, seed || {});
  global.chrome = {
    storage: {
      local: {
        get(key, callback) {
          if (key === null) {
            callback(Object.assign({}, store));
            return;
          }
          callback({ [key]: store[key] });
        },
        set(payload, callback) {
          Object.assign(store, payload || {});
          callback?.();
        },
        remove(keys, callback) {
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
            delete store[key];
          });
          callback?.();
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

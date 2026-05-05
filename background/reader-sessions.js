(function initYilanReaderSessions(global) {
  const Domain = global.AISummaryDomain || (typeof require === 'function' ? require('../shared/domain.js') : null);

  const READER_SESSION_PREFIX = 'readerSession:';
  const READER_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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

  function storageLocalRemove(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        const error = readRuntimeLastErrorMessage();
        if (error) {
          reject(new Error(error));
          return;
        }
        resolve();
      });
    });
  }

  async function cleanupReaderSessions() {
    const items = await storageLocalGet(null);
    const now = Date.now();
    const staleKeys = Object.entries(items || {})
      .filter(([key, value]) => {
        if (!String(key || '').startsWith(READER_SESSION_PREFIX)) return false;
        const createdAt = new Date(value?.createdAt || 0).getTime();
        return !createdAt || Number.isNaN(createdAt) || (now - createdAt) > READER_SESSION_MAX_AGE_MS;
      })
      .map(([key]) => key);

    if (staleKeys.length) {
      await storageLocalRemove(staleKeys);
    }

    return staleKeys;
  }

  async function createReaderSession(snapshot) {
    await cleanupReaderSessions();
    const sessionId = Domain.createRuntimeId('reader');
    const key = READER_SESSION_PREFIX + sessionId;
    await storageLocalSet({
      [key]: {
        createdAt: new Date().toISOString(),
        snapshot: snapshot || null
      }
    });
    return sessionId;
  }

  const api = {
    READER_SESSION_PREFIX,
    READER_SESSION_MAX_AGE_MS,
    cleanupReaderSessions,
    createReaderSession
  };

  global.YilanReaderSessions = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);

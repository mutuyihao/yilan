function asyncRequest(work) {
  const request = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null
  };

  setTimeout(() => {
    try {
      request.result = work();
      if (typeof request.onsuccess === 'function') {
        request.onsuccess({ target: request });
      }
    } catch (error) {
      request.error = error;
      if (typeof request.onerror === 'function') {
        request.onerror({ target: request });
      }
    }
  }, 0);

  return request;
}

class FakeObjectStore {
  constructor(name, options) {
    this.name = name;
    this.keyPath = options?.keyPath || 'id';
    this.items = new Map();
    this.indexes = new Map();
  }

  createIndex(name, keyPath, options) {
    this.indexes.set(name, { name, keyPath, options: options || {} });
    return this.index(name);
  }

  index(name) {
    const indexConfig = this.indexes.get(name);
    if (!indexConfig) {
      throw new Error('Missing index: ' + name);
    }

    return {
      get: (value) => asyncRequest(() => {
        for (const item of this.items.values()) {
          if (item?.[indexConfig.keyPath] === value) {
            return clone(item);
          }
        }
        return undefined;
      })
    };
  }

  get(key) {
    return asyncRequest(() => clone(this.items.get(key)));
  }

  getAll() {
    return asyncRequest(() => Array.from(this.items.values()).map(clone));
  }

  put(value) {
    return asyncRequest(() => {
      const key = value?.[this.keyPath];
      if (!key) throw new Error('Missing keyPath value: ' + this.keyPath);
      this.items.set(key, clone(value));
      return key;
    });
  }

  delete(key) {
    return asyncRequest(() => {
      this.items.delete(key);
      return undefined;
    });
  }

  clear() {
    return asyncRequest(() => {
      this.items.clear();
      return undefined;
    });
  }

  openCursor() {
    return asyncRequest(() => null);
  }
}

class FakeDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this.stores = new Map();
    this.objectStoreNames = {
      contains: (storeName) => this.stores.has(storeName)
    };
  }

  createObjectStore(name, options) {
    const store = new FakeObjectStore(name, options || {});
    this.stores.set(name, store);
    return store;
  }

  transaction(storeNames) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = {
      error: null,
      onerror: null,
      objectStore: (name) => {
        if (!names.includes(name)) {
          throw new Error('Store not in transaction: ' + name);
        }
        const store = this.stores.get(name);
        if (!store) throw new Error('Missing store: ' + name);
        return store;
      }
    };
    return transaction;
  }
}

function clone(value) {
  if (typeof value === 'undefined') return undefined;
  return JSON.parse(JSON.stringify(value));
}

function createFakeIndexedDB() {
  const databases = new Map();

  return {
    open(name, version) {
      const request = {
        result: undefined,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null
      };

      setTimeout(() => {
        try {
          let database = databases.get(name);
          const needsUpgrade = !database || (version && version > database.version);

          if (!database) {
            database = new FakeDatabase(name, version || 1);
            databases.set(name, database);
          } else if (version && version > database.version) {
            database.version = version;
          }

          request.result = database;
          request.transaction = {
            objectStore: (storeName) => {
              const store = database.stores.get(storeName);
              if (!store) throw new Error('Missing store: ' + storeName);
              return store;
            }
          };

          if (needsUpgrade && typeof request.onupgradeneeded === 'function') {
            request.onupgradeneeded({
              target: request,
              oldVersion: 0,
              newVersion: version || database.version
            });
          }

          if (typeof request.onsuccess === 'function') {
            request.onsuccess({ target: request });
          }
        } catch (error) {
          request.error = error;
          if (typeof request.onerror === 'function') {
            request.onerror({ target: request });
          }
        }
      }, 0);

      return request;
    }
  };
}

module.exports = {
  createFakeIndexedDB
};

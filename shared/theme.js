(function initAISummaryTheme(global) {
  const STORAGE_KEY = 'themePreference';
  const DEFAULT_PREFERENCE = 'system';
  const PREFERENCES = ['system', 'light', 'dark'];
  const listeners = new Set();
  const mediaQuery = typeof global.matchMedia === 'function'
    ? global.matchMedia('(prefers-color-scheme: dark)')
    : null;

  let currentPreference = DEFAULT_PREFERENCE;
  let currentTheme = mediaQuery?.matches ? 'dark' : 'light';
  let loadPromise = null;

  function normalizePreference(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return PREFERENCES.includes(normalized) ? normalized : DEFAULT_PREFERENCE;
  }

  function resolveTheme(preference) {
    const normalized = normalizePreference(preference);
    if (normalized === 'system') {
      return mediaQuery?.matches ? 'dark' : 'light';
    }
    return normalized;
  }

  function notify(snapshot) {
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (error) {
        console.error(error);
      }
    });
  }

  function applyPreference(preference, options = {}) {
    const nextPreference = normalizePreference(preference);
    const nextTheme = resolveTheme(nextPreference);
    const root = global.document?.documentElement;
    const changed = nextPreference !== currentPreference || nextTheme !== currentTheme;

    currentPreference = nextPreference;
    currentTheme = nextTheme;

    if (root) {
      root.dataset.themePreference = currentPreference;
      root.dataset.theme = currentTheme;
      root.style.colorScheme = currentTheme;
    }

    const snapshot = { preference: currentPreference, theme: currentTheme };
    if (changed || options.force) {
      notify(snapshot);
    }
    return snapshot;
  }

  function getStorage() {
    return global.chrome?.storage?.sync || null;
  }

  function loadThemePreference() {
    if (loadPromise) return loadPromise;

    const storage = getStorage();
    if (!storage?.get) {
      loadPromise = Promise.resolve(applyPreference(currentPreference, { force: true }));
      return loadPromise;
    }

    loadPromise = new Promise((resolve) => {
      storage.get([STORAGE_KEY], (items) => {
        resolve(applyPreference(items?.[STORAGE_KEY], { force: true }));
      });
    });

    return loadPromise;
  }

  function saveThemePreference(preference) {
    const nextPreference = normalizePreference(preference);
    const storage = getStorage();

    applyPreference(nextPreference, { force: true });

    if (!storage?.set) {
      return Promise.resolve({ preference: currentPreference, theme: currentTheme });
    }

    return new Promise((resolve) => {
      storage.set({ [STORAGE_KEY]: nextPreference }, () => {
        resolve({ preference: currentPreference, theme: currentTheme });
      });
    });
  }

  function getCurrentPreference() {
    return currentPreference;
  }

  function getCurrentTheme() {
    return currentTheme;
  }

  function getNextPreference(preference) {
    const normalized = normalizePreference(preference);
    const index = PREFERENCES.indexOf(normalized);
    return PREFERENCES[(index + 1) % PREFERENCES.length];
  }

  function onChange(listener) {
    listeners.add(listener);
    return function unsubscribe() {
      listeners.delete(listener);
    };
  }

  applyPreference(DEFAULT_PREFERENCE, { force: true });

  if (global.chrome?.storage?.onChanged?.addListener) {
    global.chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes?.[STORAGE_KEY]) return;
      applyPreference(changes[STORAGE_KEY].newValue, { force: true });
    });
  }

  if (mediaQuery) {
    const onThemeMediaChange = () => {
      if (currentPreference !== 'system') return;
      applyPreference(currentPreference, { force: true });
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onThemeMediaChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(onThemeMediaChange);
    }
  }

  global.AISummaryTheme = {
    STORAGE_KEY,
    DEFAULT_PREFERENCE,
    PREFERENCES,
    normalizePreference,
    resolveTheme,
    applyPreference,
    loadThemePreference,
    saveThemePreference,
    getCurrentPreference,
    getCurrentTheme,
    getNextPreference,
    onChange
  };

  loadThemePreference().catch(() => {});
})(window);

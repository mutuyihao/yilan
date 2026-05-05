(function initAISummaryTheme(global) {
  const STORAGE_KEY = 'themePreference';
  const PALETTE_STORAGE_KEY = 'themePalette';
  const DEFAULT_PREFERENCE = 'system';
  const DEFAULT_PALETTE = 'jade';
  const PREFERENCES = ['system', 'light', 'dark'];
  const PALETTES = ['jade', 'slate', 'copper', 'plum'];
  const listeners = new Set();
  const mediaQuery = typeof global.matchMedia === 'function'
    ? global.matchMedia('(prefers-color-scheme: dark)')
    : null;

  let currentPreference = DEFAULT_PREFERENCE;
  let currentTheme = mediaQuery?.matches ? 'dark' : 'light';
  let currentPalette = DEFAULT_PALETTE;
  let loadPromise = null;

  function normalizePreference(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return PREFERENCES.includes(normalized) ? normalized : DEFAULT_PREFERENCE;
  }

  function normalizePalette(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return PALETTES.includes(normalized) ? normalized : DEFAULT_PALETTE;
  }

  function resolveTheme(preference) {
    const normalized = normalizePreference(preference);
    if (normalized === 'system') {
      return mediaQuery?.matches ? 'dark' : 'light';
    }
    return normalized;
  }

  function createSnapshot() {
    return {
      preference: currentPreference,
      theme: currentTheme,
      palette: currentPalette
    };
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
      root.dataset.palette = currentPalette;
      root.style.colorScheme = currentTheme;
    }

    const snapshot = createSnapshot();
    if (changed || options.force) {
      notify(snapshot);
    }
    return snapshot;
  }

  function applyPalette(palette, options = {}) {
    const nextPalette = normalizePalette(palette);
    const root = global.document?.documentElement;
    const changed = nextPalette !== currentPalette;

    currentPalette = nextPalette;

    if (root) {
      root.dataset.palette = currentPalette;
    }

    const snapshot = createSnapshot();
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
      applyPalette(currentPalette, { force: false });
      loadPromise = Promise.resolve(applyPreference(currentPreference, { force: true }));
      return loadPromise;
    }

    loadPromise = new Promise((resolve) => {
      storage.get([STORAGE_KEY, PALETTE_STORAGE_KEY], (items) => {
        applyPalette(items?.[PALETTE_STORAGE_KEY], { force: false });
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
      return Promise.resolve(createSnapshot());
    }

    return new Promise((resolve) => {
      storage.set({ [STORAGE_KEY]: nextPreference }, () => {
        resolve(createSnapshot());
      });
    });
  }

  function saveThemePalette(palette) {
    const nextPalette = normalizePalette(palette);
    const storage = getStorage();

    applyPalette(nextPalette, { force: true });

    if (!storage?.set) {
      return Promise.resolve(createSnapshot());
    }

    return new Promise((resolve) => {
      storage.set({ [PALETTE_STORAGE_KEY]: nextPalette }, () => {
        resolve(createSnapshot());
      });
    });
  }

  function getCurrentPreference() {
    return currentPreference;
  }

  function getCurrentTheme() {
    return currentTheme;
  }

  function getCurrentPalette() {
    return currentPalette;
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
      if (areaName !== 'sync') return;
      if (changes?.[PALETTE_STORAGE_KEY]) {
        applyPalette(changes[PALETTE_STORAGE_KEY].newValue, { force: true });
      }
      if (changes?.[STORAGE_KEY]) {
        applyPreference(changes[STORAGE_KEY].newValue, { force: true });
      }
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
    PALETTE_STORAGE_KEY,
    DEFAULT_PREFERENCE,
    DEFAULT_PALETTE,
    PREFERENCES,
    PALETTES,
    normalizePreference,
    normalizePalette,
    resolveTheme,
    applyPreference,
    applyPalette,
    loadThemePreference,
    saveThemePreference,
    saveThemePalette,
    getCurrentPreference,
    getCurrentTheme,
    getCurrentPalette,
    getNextPreference,
    onChange
  };

  loadThemePreference().catch(() => {});
})(window);

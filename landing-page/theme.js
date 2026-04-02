(function () {
  var STORAGE_KEY = 'yilan-landing-theme-mode';
  var MODE_ORDER = ['system', 'light', 'dark'];
  var MODE_LABELS = {
    system: '系统',
    light: '日间',
    dark: '深夜'
  };
  var root = document.documentElement;
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  var ogImageMeta = document.querySelector('meta[property="og:image"]');
  var mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function isValidMode(value) {
    return value === 'system' || value === 'light' || value === 'dark';
  }

  function readStoredMode() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      return isValidMode(stored) ? stored : 'system';
    } catch (error) {
      return 'system';
    }
  }

  function resolveTheme(mode) {
    if (mode === 'light' || mode === 'dark') return mode;
    return mediaQuery && mediaQuery.matches ? 'dark' : 'light';
  }

  function getNextMode(mode) {
    var index = MODE_ORDER.indexOf(mode);
    return MODE_ORDER[(index + 1 + MODE_ORDER.length) % MODE_ORDER.length];
  }

  function updateThemeMeta(theme) {
    if (themeMeta) {
      themeMeta.setAttribute('content', theme === 'light' ? '#f7efe2' : '#07131f');
    }
  }

  function updateThemeToggle(mode, theme) {
    var button = document.querySelector('[data-theme-toggle]');
    if (!button) return;

    var value = button.querySelector('[data-theme-toggle-value]');
    var nextMode = getNextMode(mode);
    var modeLabel = MODE_LABELS[mode] || MODE_LABELS.system;
    var resolvedThemeLabel = MODE_LABELS[theme] || MODE_LABELS.light;
    var nextModeLabel = MODE_LABELS[nextMode] || MODE_LABELS.system;

    if (value) {
      value.textContent = modeLabel;
    }

    button.dataset.mode = mode;
    button.dataset.resolvedTheme = theme;
    button.title = mode === 'system'
      ? '当前跟随系统（' + resolvedThemeLabel + '），点击切换到' + nextModeLabel
      : '当前固定' + modeLabel + '，点击切换到' + nextModeLabel;
    button.setAttribute('aria-label', '外观模式：' + modeLabel + '。点击切换到' + nextModeLabel);
  }

  function updateThemeShots(theme) {
    var images = document.querySelectorAll('img[data-light-src][data-dark-src]');
    images.forEach(function (image) {
      var nextSrc = theme === 'light' ? image.getAttribute('data-light-src') : image.getAttribute('data-dark-src');
      if (nextSrc && image.getAttribute('src') !== nextSrc) {
        image.setAttribute('src', nextSrc);
      }
    });

    if (ogImageMeta) {
      var nextOg = theme === 'light' ? ogImageMeta.getAttribute('data-light-src') : ogImageMeta.getAttribute('data-dark-src');
      if (nextOg) {
        ogImageMeta.setAttribute('content', nextOg);
      }
    }
  }

  function applyTheme(mode, options) {
    var safeMode = isValidMode(mode) ? mode : 'system';
    var resolvedTheme = resolveTheme(safeMode);

    root.dataset.themeMode = safeMode;
    root.dataset.theme = resolvedTheme;
    updateThemeMeta(resolvedTheme);
    updateThemeToggle(safeMode, resolvedTheme);
    updateThemeShots(resolvedTheme);

    if (options && options.persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, safeMode);
      } catch (error) {
        // Ignore storage failures in private or locked-down contexts.
      }
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(root.dataset.themeMode || readStoredMode());

    var toggle = document.querySelector('[data-theme-toggle]');
    if (toggle) {
      toggle.addEventListener('click', function () {
        applyTheme(getNextMode(root.dataset.themeMode || 'system'), { persist: true });
      });
    }
  });

  if (mediaQuery) {
    var handleSystemThemeChange = function () {
      if ((root.dataset.themeMode || 'system') === 'system') {
        applyTheme('system');
      }
    };

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleSystemThemeChange);
    }
  }
})();
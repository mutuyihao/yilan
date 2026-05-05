(function initYilanVersion(global) {
  const FALLBACK_VERSION = '1.0.0';
  const globalAny = /** @type {any} */ (global);

  function resolveVersion() {
    try {
      const runtime = globalAny.chrome && globalAny.chrome.runtime;
      const manifest = runtime && typeof runtime.getManifest === 'function'
        ? runtime.getManifest()
        : null;
      return manifest && manifest.version ? manifest.version : FALLBACK_VERSION;
    } catch (error) {
      return FALLBACK_VERSION;
    }
  }

  function applyVersionLabel(root) {
    const version = resolveVersion();
    const label = 'v' + version;
    const scope = root || global.document;
    if (!scope || typeof scope.querySelectorAll !== 'function') return;

    scope.querySelectorAll('[data-yilan-version]').forEach((node) => {
      node.textContent = label;
      node.setAttribute('title', '一览 ' + label);
      node.setAttribute('aria-label', '一览版本 ' + label);
    });
  }

  globalAny.YilanVersion = {
    apply: applyVersionLabel,
    get: resolveVersion
  };

  if (global.document) {
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', () => applyVersionLabel(global.document), { once: true });
    } else {
      applyVersionLabel(global.document);
    }
  }
})(globalThis);

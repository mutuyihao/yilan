(function initYilanPopupSurface(global) {
  // popup.html renders on two surfaces: the toolbar popup (compact, opens on
  // the "此页" home view) and a full browser tab (the extension options page,
  // settings only). Loaded in <head> so the stylesheet can switch layouts
  // through :root[data-surface] before first paint. `?surface=popup|tab`
  // pins the surface explicitly for tests and screenshots.
  function readPinnedSurface() {
    try {
      const value = new URLSearchParams(global.location?.search || '').get('surface');
      return value === 'popup' || value === 'tab' ? value : '';
    } catch (error) {
      return '';
    }
  }

  function detectSurface() {
    try {
      // Synchronous and reliable from the first script: a toolbar popup is
      // registered as a 'popup' view, an options/regular tab is not.
      const views = global.chrome?.extension?.getViews?.({ type: 'popup' });
      if (Array.isArray(views)) return views.includes(global) ? 'popup' : 'tab';
    } catch (error) {
      // Fall through to the compact layout.
    }
    return 'popup';
  }

  const pinned = readPinnedSurface();
  const surface = pinned || detectSurface();

  if (global.document?.documentElement) {
    global.document.documentElement.dataset.surface = surface;
  }

  global.YilanPopupSurface = {
    surface,
    pinned: !!pinned,
    isPopup: surface === 'popup',
    isTab: surface === 'tab'
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

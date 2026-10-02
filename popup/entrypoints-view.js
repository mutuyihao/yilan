(function initYilanPopupEntrypointsView(global) {
  function createEntrypointsViewController(deps) {
    const $ = deps.$;
    const I18n = deps.i18n;
    const runtimeSendMessage = deps.runtimeSendMessage;
    const setStatus = deps.setStatus;
    const setStatusDetails = deps.setStatusDetails;
    const setBadge = deps.setBadge;
    const getRuntimeErrorMessage = deps.getRuntimeErrorMessage;
    const formatDateTime = deps.formatDateTime;
    const onStatus = typeof deps.onStatus === 'function' ? deps.onStatus : () => {};

  function renderEntrypointStatus(entrypoints) {
    const contextMenu = entrypoints?.contextMenu || {};
    const shortcut = entrypoints?.shortcut || {};
    onStatus(entrypoints);

    const contextMenuReady = contextMenu.status === 'ready';
    $('contextMenuDesc').textContent = contextMenuReady
      ? I18n.get('popup_context_menu_ready')
      : (contextMenu.lastError || I18n.get('popup_context_menu_not_ready'));
    setBadge(
      'contextMenuBadge',
      contextMenuReady ? I18n.get('popup_badge_ready') : I18n.get('popup_badge_repair'),
      contextMenuReady ? 'success' : 'warning'
    );

    const shortcutAssigned = shortcut.status === 'assigned' && shortcut.shortcut;
    $('shortcutDesc').textContent = shortcutAssigned
      ? I18n.get('popup_shortcut_bound', [shortcut.shortcut])
      : I18n.get('popup_shortcut_missing');
    setBadge(
      'shortcutBadge',
      shortcutAssigned ? I18n.get('popup_badge_bound') : shortcut.status === 'missing' ? I18n.get('popup_badge_missing') : I18n.get('popup_badge_unbound'),
      shortcutAssigned ? 'success' : shortcut.status === 'missing' ? 'error' : 'warning'
    );

    $('entrypointMeta').textContent = [
      I18n.get('popup_meta_menu_checked', [formatDateTime(contextMenu.lastEnsuredAt)]),
      I18n.get('popup_meta_menu_triggered', [formatDateTime(contextMenu.lastTriggeredAt)]),
      I18n.get('popup_meta_shortcut_triggered', [formatDateTime(shortcut.lastTriggeredAt)])
    ].join(' · ');
  }

  async function loadEntrypointStatus(options = {}) {
    const silent = !!options.silent;
    if (!silent) {
      setStatus(I18n.get('popup_checking_entrypoints'));
    }

    // Silent (popup-open) checks are read-only; manual rechecks also repair.
    const response = await runtimeSendMessage({ action: 'getEntrypointStatus', ensure: !silent });
    if (!response.success) {
      if (!silent) {
        setStatus(getRuntimeErrorMessage(response.error) || I18n.get('popup_entrypoint_check_failed'), 'error');
        setStatusDetails('');
      }
      $('contextMenuDesc').textContent = I18n.get('popup_context_menu_status_failed');
      $('shortcutDesc').textContent = I18n.get('popup_shortcut_status_failed');
      $('entrypointMeta').textContent = I18n.get('popup_reload_hint');
      setBadge('contextMenuBadge', I18n.get('popup_badge_failed'), 'error');
      setBadge('shortcutBadge', I18n.get('popup_badge_failed'), 'error');
      return;
    }

    renderEntrypointStatus(response.entrypoints);
    if (!silent) {
      setStatus(I18n.get('popup_entrypoints_refreshed'), 'success');
    }
  }

  async function openShortcutSettings() {
    setStatus(I18n.get('popup_opening_shortcut_settings'));
    const response = await runtimeSendMessage({ action: 'openShortcutSettings' });
    if (response.success) {
      setStatus(I18n.get('popup_shortcut_settings_opened'), 'success');
      return;
    }
    setStatus(getRuntimeErrorMessage(response.error) || I18n.get('popup_shortcut_settings_failed'), 'error');
    setStatusDetails('');
  }


    return {
      renderEntrypointStatus,
      loadEntrypointStatus,
      openShortcutSettings
    };
  }

  const api = {
    createEntrypointsViewController
  };

  global.YilanPopupEntrypointsView = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

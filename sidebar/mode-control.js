(function initYilanSidebarModeControl(global) {
  function createModeControlController(deps) {
    const state = deps.state || deps.getState?.() || {};
    const elements = deps.elements || deps.getElements?.() || {};
    const articleUtils = deps.articleUtils;
    const getModeLabel = deps.getModeLabel;
    const escapeHtml = deps.escapeHtml || ((value) => String(value ?? ''));
    const documentRef = deps.document || global.document;
    let eventsBound = false;

    function getOptions() {
      return articleUtils.getSummaryModeOptions();
    }

    function getSafeMode(mode) {
      const options = getOptions();
      const matched = options.find((item) => item.value === mode);
      return matched?.value || options[0]?.value || 'medium';
    }

    function isOpen() {
      return !!state.summaryModeMenuOpen;
    }

    function setOpen(open) {
      state.summaryModeMenuOpen = !!open;
      elements.summaryModeMenu.classList.toggle('hidden', !state.summaryModeMenuOpen);
      elements.summaryModeTrigger.classList.toggle('open', state.summaryModeMenuOpen);
      elements.summaryModeTrigger.setAttribute('aria-expanded', state.summaryModeMenuOpen ? 'true' : 'false');
    }

    function closeIfOpen() {
      if (!isOpen()) return false;
      setOpen(false);
      return true;
    }

    function sync() {
      const value = getSafeMode(elements.summaryModeSelect.value);
      elements.summaryModeCurrentLabel.textContent = getModeLabel(value);

      elements.summaryModeMenu.querySelectorAll('.mode-option').forEach((button) => {
        const active = button.dataset.value === value;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    function setValue(mode) {
      const nextMode = getSafeMode(mode);
      elements.summaryModeSelect.value = nextMode;
      sync();
      return nextMode;
    }

    function focusActiveOption() {
      const activeOption = elements.summaryModeMenu.querySelector('.mode-option.active') ||
        elements.summaryModeMenu.querySelector('.mode-option');
      activeOption?.focus();
    }

    function initialize() {
      const options = getOptions();
      elements.summaryModeSelect.innerHTML = options
        .map((item) => '<option value="' + escapeHtml(item.value) + '">' + escapeHtml(item.label) + '</option>')
        .join('');
      elements.summaryModeMenu.innerHTML = options
        .map((item) => (
          '<button class="mode-option" type="button" role="option" data-value="' + escapeHtml(item.value) + '">' +
            escapeHtml(item.label) +
          '</button>'
        ))
        .join('');
      setValue('medium');
      setOpen(false);
    }

    function bindEvents() {
      if (eventsBound) return;
      eventsBound = true;

      elements.summaryModeTrigger.addEventListener('click', () => {
        const nextOpen = !isOpen();
        setOpen(nextOpen);
        if (nextOpen) {
          focusActiveOption();
        }
      });

      elements.summaryModeTrigger.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setOpen(true);
          focusActiveOption();
        }

        if (event.key === 'Escape' && isOpen()) {
          event.preventDefault();
          setOpen(false);
        }
      });

      elements.summaryModeMenu.addEventListener('click', (event) => {
        const option = event.target.closest('.mode-option');
        if (!option) return;
        setValue(option.dataset.value);
        setOpen(false);
        elements.summaryModeTrigger.focus();
      });

      elements.summaryModeMenu.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
          elements.summaryModeTrigger.focus();
        }
      });

      elements.summaryModeSelect.addEventListener('change', sync);

      documentRef.addEventListener('click', (event) => {
        if (!isOpen()) return;
        if (elements.summaryModeTrigger.contains(event.target) || elements.summaryModeMenu.contains(event.target)) return;
        setOpen(false);
      });
    }

    return {
      bindEvents,
      closeIfOpen,
      focusActiveOption,
      getOptions,
      getSafeMode,
      initialize,
      isOpen,
      setOpen,
      setValue,
      sync
    };
  }

  const api = {
    createModeControlController
  };

  global.YilanSidebarModeControl = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

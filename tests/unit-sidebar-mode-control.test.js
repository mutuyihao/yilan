const { test, assert, freshRequire } = require('./harness');

function createClassList(initial) {
  const classes = new Set(initial || []);
  return {
    add(name) {
      classes.add(name);
    },
    remove(name) {
      classes.delete(name);
    },
    toggle(name, force) {
      const enabled = force === undefined ? !classes.has(name) : !!force;
      if (enabled) {
        classes.add(name);
      } else {
        classes.delete(name);
      }
    },
    contains(name) {
      return classes.has(name);
    }
  };
}

function createEventTargetElement() {
  return {
    attributes: {},
    classList: createClassList(),
    focused: false,
    listeners: {},
    addEventListener(type, listener) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(listener);
    },
    contains(target) {
      return target === this;
    },
    dispatch(type, event) {
      const payload = event || {};
      if (!('target' in payload)) {
        payload.target = this;
      }
      (this.listeners[type] || []).forEach((listener) => listener(payload));
      return payload;
    },
    focus() {
      this.focused = true;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
}

function createModeButton(value, label) {
  const button = createEventTargetElement();
  button.dataset = { value };
  button.label = label;
  button.closest = (selector) => selector === '.mode-option' ? button : null;
  return button;
}

function createModeMenu() {
  const menu = createEventTargetElement();
  menu.classList = createClassList(['hidden']);
  menu.buttons = [];
  menu.contains = (target) => target === menu || menu.buttons.includes(target);
  menu.querySelectorAll = (selector) => selector === '.mode-option' ? menu.buttons : [];
  menu.querySelector = (selector) => {
    if (selector === '.mode-option.active') {
      return menu.buttons.find((button) => button.classList.contains('active')) || null;
    }
    if (selector === '.mode-option') {
      return menu.buttons[0] || null;
    }
    return null;
  };
  Object.defineProperty(menu, 'innerHTML', {
    get() {
      return menu._innerHTML || '';
    },
    set(value) {
      menu._innerHTML = String(value || '');
      menu.buttons = [];
      const regex = /data-value="([^"]+)">([^<]*)<\/button>/g;
      let match;
      while ((match = regex.exec(menu._innerHTML))) {
        menu.buttons.push(createModeButton(match[1], match[2]));
      }
    }
  });
  return menu;
}

function createSelectElement() {
  const select = createEventTargetElement();
  select.value = '';
  Object.defineProperty(select, 'innerHTML', {
    get() {
      return select._innerHTML || '';
    },
    set(value) {
      select._innerHTML = String(value || '');
    }
  });
  return select;
}

function createKeyboardEvent(key) {
  return {
    key,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    }
  };
}

function createController() {
  const SidebarModeControl = freshRequire('sidebar/mode-control.js');
  const state = { summaryModeMenuOpen: false };
  const elements = {
    summaryModeTrigger: createEventTargetElement(),
    summaryModeCurrentLabel: { textContent: '' },
    summaryModeMenu: createModeMenu(),
    summaryModeSelect: createSelectElement()
  };
  const documentRef = createEventTargetElement();

  const controller = SidebarModeControl.createModeControlController({
    state,
    elements,
    articleUtils: {
      getSummaryModeOptions: () => [
        { value: 'medium', label: 'Standard' },
        { value: 'short', label: 'Short' },
        { value: 'detailed', label: 'Detailed' }
      ]
    },
    getModeLabel: (mode) => ({ medium: 'Standard', short: 'Short', detailed: 'Detailed' }[mode] || 'Standard'),
    escapeHtml: (value) => String(value || ''),
    document: documentRef
  });

  return { controller, state, elements, documentRef };
}

test('sidebar mode control initializes options and normalizes selected mode', 'ui.sidebar_contract', () => {
  const { controller, state, elements } = createController();

  controller.initialize();

  assert.strictEqual(elements.summaryModeSelect.value, 'medium');
  assert.strictEqual(elements.summaryModeCurrentLabel.textContent, 'Standard');
  assert.strictEqual(state.summaryModeMenuOpen, false);
  assert.strictEqual(elements.summaryModeMenu.classList.contains('hidden'), true);
  assert.strictEqual(elements.summaryModeTrigger.attributes['aria-expanded'], 'false');
  assert.deepStrictEqual(elements.summaryModeMenu.buttons.map((button) => button.dataset.value), ['medium', 'short', 'detailed']);
  assert.strictEqual(elements.summaryModeMenu.buttons[0].classList.contains('active'), true);
  assert.strictEqual(elements.summaryModeMenu.buttons[0].attributes['aria-selected'], 'true');

  assert.strictEqual(controller.setValue('missing'), 'medium');
  assert.strictEqual(controller.setValue('short'), 'short');
  assert.strictEqual(elements.summaryModeSelect.value, 'short');
  assert.strictEqual(elements.summaryModeCurrentLabel.textContent, 'Short');
  assert.strictEqual(elements.summaryModeMenu.buttons[1].classList.contains('active'), true);
});

test('sidebar mode control handles clicks, keyboard close, and outside clicks', 'ui.sidebar_contract', () => {
  const { controller, state, elements, documentRef } = createController();
  controller.initialize();
  controller.bindEvents();

  elements.summaryModeTrigger.dispatch('click');
  assert.strictEqual(state.summaryModeMenuOpen, true);
  assert.strictEqual(elements.summaryModeTrigger.classList.contains('open'), true);
  assert.strictEqual(elements.summaryModeMenu.buttons[0].focused, true);

  documentRef.dispatch('click', { target: elements.summaryModeTrigger });
  assert.strictEqual(state.summaryModeMenuOpen, true);

  documentRef.dispatch('click', { target: { outside: true } });
  assert.strictEqual(state.summaryModeMenuOpen, false);

  elements.summaryModeTrigger.dispatch('click');
  elements.summaryModeMenu.dispatch('click', { target: elements.summaryModeMenu.buttons[1] });
  assert.strictEqual(elements.summaryModeSelect.value, 'short');
  assert.strictEqual(state.summaryModeMenuOpen, false);
  assert.strictEqual(elements.summaryModeTrigger.focused, true);

  const arrowEvent = createKeyboardEvent('ArrowDown');
  elements.summaryModeTrigger.dispatch('keydown', arrowEvent);
  assert.strictEqual(arrowEvent.prevented, true);
  assert.strictEqual(state.summaryModeMenuOpen, true);

  const menuEscapeEvent = createKeyboardEvent('Escape');
  elements.summaryModeMenu.dispatch('keydown', menuEscapeEvent);
  assert.strictEqual(menuEscapeEvent.prevented, true);
  assert.strictEqual(state.summaryModeMenuOpen, false);

  elements.summaryModeTrigger.dispatch('click');
  assert.strictEqual(controller.closeIfOpen(), true);
  assert.strictEqual(controller.closeIfOpen(), false);
});

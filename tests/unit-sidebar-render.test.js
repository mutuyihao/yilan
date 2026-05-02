const { test, assert, freshRequire } = require('./harness');

function createClassList(initial) {
  const classes = new Set(initial || []);
  return {
    add(name) {
      classes.add(name);
    },
    remove(...names) {
      names.forEach((name) => classes.delete(name));
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

function createElement() {
  return {
    attributes: {},
    classList: createClassList(),
    className: '',
    href: '',
    innerHTML: '',
    open: false,
    scrollHeight: 0,
    scrollTop: 0,
    textContent: '',
    title: '',
    querySelectorAll() {
      return [];
    },
    replaceChildren(fragment) {
      this.fragment = fragment;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function createElements() {
  return {
    articleTitle: createElement(),
    authorValue: createElement(),
    chunkValue: createElement(),
    diagnosticsBlock: createElement(),
    diagnosticsPre: createElement(),
    diagnosticsToggle: createElement(),
    hostBadge: createElement(),
    lengthValue: createElement(),
    modeBadge: createElement(),
    privacyToggleBtn: createElement(),
    publishedValue: createElement(),
    siteTypeBadge: createElement(),
    sourceLink: createElement(),
    statsText: createElement(),
    statusText: createElement(),
    strategyBadge: createElement(),
    summaryModeSelect: Object.assign(createElement(), { value: 'medium' }),
    summaryRoot: createElement(),
    trustHistoryBadge: createElement(),
    trustHistoryNote: createElement(),
    trustHistoryValue: createElement(),
    trustModeBadge: createElement(),
    trustSendNote: createElement(),
    trustSendValue: createElement(),
    trustShareBadge: createElement(),
    trustShareNote: createElement(),
    trustShareValue: createElement(),
    trustSummary: createElement(),
    trustTitle: createElement(),
    warningList: createElement()
  };
}

function createController(overrides) {
  const SidebarRender = freshRequire('sidebar/render.js');
  const state = Object.assign({
    article: null,
    autoScroll: false,
    generating: true,
    lastDiagnostics: null,
    settings: {},
    summaryMarkdown: '',
    visibleRecord: null
  }, overrides?.state || {});
  const elements = overrides?.elements || createElements();
  const markedImpl = overrides?.marked || {
    options: null,
    setOptions(options) {
      this.options = options;
    },
    parse(markdown) {
      return '<p>' + escapeHtml(markdown || '') + '</p>';
    }
  };
  const domPurifyImpl = overrides?.DOMPurify || {
    sanitize(value, options) {
      return options?.RETURN_DOM_FRAGMENT ? { html: String(value || '') } : String(value || '');
    }
  };
  const hljsImpl = overrides?.hljs || {
    getLanguage: () => false,
    highlightAuto: (code) => ({ value: code }),
    highlightElement() {}
  };

  const controller = SidebarRender.createRenderController({
    state,
    elements,
    summaryModeController: overrides?.summaryModeController || {
      getSafeMode: (mode) => mode === 'short' ? 'short' : 'medium'
    },
    DOMPurify: domPurifyImpl,
    marked: markedImpl,
    hljs: hljsImpl,
    escapeHtml: overrides?.escapeHtml || escapeHtml,
    markdownToPlainText: overrides?.markdownToPlainText || ((value) => String(value || '').replace(/[#*_`]/g, '').trim()),
    stripMarkdownPreview: overrides?.stripMarkdownPreview || ((value, max) => String(value || '').slice(0, max)),
    buildCancelledStateModel: overrides?.buildCancelledStateModel || (() => ({
      partial: { hasPartialContent: false, markdown: '' },
      info: { title: '已取消', detail: '用户取消了本次生成。' },
      facts: ['已保留诊断']
    })),
    buildDiagnosticsPanelModel: overrides?.buildDiagnosticsPanelModel || (() => ({
      shouldAutoOpen: true,
      summaryText: '诊断摘要',
      toggleLabel: '运行诊断（1）'
    })),
    buildArticleMetaView: overrides?.buildArticleMetaView || (() => ({
      authorLabel: '作者',
      chunkLabel: '1 段',
      hostLabel: 'example.com',
      lengthLabel: '120 字',
      modeLabel: '简短总结',
      publishedLabel: '2026-05-01',
      siteTypeLabel: '文章',
      sourceHref: 'https://example.com/a',
      sourceText: 'https://example.com/a',
      strategyLabel: '通用精读',
      title: '页面标题',
      warnings: ['低质量正文']
    })),
    buildTrustCardView: overrides?.buildTrustCardView || (() => ({
      historyBadge: '写入历史',
      historyNote: '会写入本地',
      historyTone: 'success',
      historyValue: '允许',
      modeBadge: '标准模式',
      modeTone: 'accent',
      policy: { allowHistory: true, allowShare: true },
      privacyToggleLabel: '开启无痕',
      privacyTogglePrimary: true,
      sendNote: '发送正文',
      sendValue: '会发送',
      shareBadge: '允许分享',
      shareNote: '可生成分享卡',
      shareTone: 'soft',
      shareValue: '允许',
      summary: '当前策略摘要',
      title: '当前策略'
    })),
    normalizeUiError: overrides?.normalizeUiError || ((error) => error),
    errors: overrides?.errors || {
      ERROR_CODES: { RUN_CANCELLED: 'RUN_CANCELLED' },
      createError: (code) => ({ code, message: code })
    },
    createArticleFromRecord: overrides?.createArticleFromRecord || (() => ({ title: '记录页面' })),
    window: overrides?.window || {
      clearTimeout,
      setTimeout,
      requestAnimationFrame: (callback) => {
        callback();
        return 1;
      },
      cancelAnimationFrame() {}
    },
    performance: overrides?.performance || { now: () => 0 }
  });

  return {
    controller,
    deps: {
      DOMPurify: domPurifyImpl,
      hljs: hljsImpl,
      marked: markedImpl
    },
    elements,
    state
  };
}

test('sidebar render controller updates status, stats, placeholder, and error states', 'ui.sidebar_contract', () => {
  const { controller, elements } = createController();

  controller.setStatus('生成完成', 'success');
  assert.strictEqual(elements.statusText.textContent, '生成完成');
  assert.strictEqual(elements.statusText.className, 'status-text');
  assert.strictEqual(elements.statusText.classList.contains('status-success'), true);
  assert.strictEqual(elements.statusText.classList.contains('status-active'), true);

  controller.setStats('12 字');
  assert.strictEqual(elements.statsText.textContent, '12 字');

  controller.renderPlaceholder('准备开始', '等待页面内容');
  assert.strictEqual(elements.summaryRoot.className, 'summary-root summary-placeholder');
  assert.ok(elements.summaryRoot.innerHTML.includes('准备开始'));
  assert.ok(elements.summaryRoot.innerHTML.includes('等待页面内容'));

  controller.renderErrorBox({ message: '生成失败', detail: 'network' });
  assert.strictEqual(elements.summaryRoot.className, 'summary-root');
  assert.ok(elements.summaryRoot.innerHTML.includes('生成失败'));
  assert.ok(elements.summaryRoot.innerHTML.includes('network'));
});

test('sidebar render controller renders article meta, trust policy, and diagnostics', 'ui.sidebar_contract', () => {
  const { controller, elements, state } = createController({
    state: {
      lastDiagnostics: { runId: 'run_1' },
      settings: { entrypointSimpleMode: true },
      summaryMarkdown: '# 摘要',
      visibleRecord: { recordId: 'sum_1' }
    }
  });

  controller.renderArticleMeta({ title: '输入文章' }, { summaryMode: 'short' });

  assert.strictEqual(elements.articleTitle.textContent, '页面标题');
  assert.strictEqual(elements.sourceLink.href, 'https://example.com/a');
  assert.strictEqual(elements.hostBadge.textContent, 'example.com');
  assert.strictEqual(elements.warningList.innerHTML, '<span class="warning-chip">低质量正文</span>');
  assert.deepStrictEqual(state.trustPolicy, { allowHistory: true, allowShare: true });
  assert.strictEqual(elements.privacyToggleBtn.textContent, '开启无痕');
  assert.strictEqual(elements.privacyToggleBtn.classList.contains('action-btn-primary'), true);
  assert.strictEqual(elements.trustModeBadge.classList.contains('badge-accent'), true);

  controller.renderDiagnostics();

  assert.strictEqual(elements.diagnosticsToggle.textContent, '运行诊断（1）');
  assert.strictEqual(elements.diagnosticsToggle.title, '运行诊断（1）');
  assert.strictEqual(elements.diagnosticsBlock.open, true);
  assert.ok(elements.diagnosticsPre.textContent.includes('诊断摘要'));
  assert.ok(elements.diagnosticsPre.textContent.includes('"runId": "run_1"'));
});

test('sidebar render controller sanitizes markdown, highlights code, and schedules stream renders', 'ui.sidebar_contract', () => {
  const sanitizeCalls = [];
  const highlightCalls = [];
  const timers = [];
  const frames = [];
  let now = 10;
  const elements = createElements();
  const codeBlock = { id: 'code_1' };
  elements.summaryRoot.scrollHeight = 540;
  elements.summaryRoot.querySelectorAll = (selector) => selector === 'pre code' ? [codeBlock] : [];
  const marked = {
    options: null,
    setOptions(options) {
      this.options = options;
    },
    parse(markdown) {
      return '<p>' + escapeHtml(markdown || '') + '</p>';
    }
  };
  const { controller, state } = createController({
    elements,
    state: {
      article: { chunkCount: 2 },
      autoScroll: true,
      summaryMarkdown: '## Streamed text'
    },
    DOMPurify: {
      sanitize(value, options) {
        sanitizeCalls.push({ value: String(value || ''), options });
        if (options?.RETURN_DOM_FRAGMENT) {
          return { sanitizedFragment: String(value || '') };
        }
        return 'safe:' + String(value || '');
      }
    },
    marked,
    hljs: {
      getLanguage: (lang) => lang === 'js',
      highlight: (code, options) => ({ value: options.language + ':' + code }),
      highlightAuto: (code) => ({ value: 'auto:' + code }),
      highlightElement(block) {
        highlightCalls.push(block);
      }
    },
    window: {
      clearTimeout() {},
      setTimeout(callback, delay) {
        timers.push({ callback, delay });
        return timers.length;
      },
      requestAnimationFrame(callback) {
        frames.push(callback);
        return frames.length;
      },
      cancelAnimationFrame() {}
    },
    performance: { now: () => now }
  });

  assert.strictEqual(marked.options.breaks, true);
  assert.strictEqual(marked.options.gfm, true);
  assert.strictEqual(marked.options.highlight('const a = 1;', 'js'), 'js:const a = 1;');
  assert.strictEqual(marked.options.highlight('plain', ''), 'auto:plain');

  controller.renderMarkdown('**bold**');
  assert.strictEqual(elements.summaryRoot.className, 'summary-root markdown-body');
  assert.deepStrictEqual(elements.summaryRoot.fragment, { sanitizedFragment: '<p>**bold**</p>' });
  assert.strictEqual(highlightCalls.length, 1);
  assert.strictEqual(highlightCalls[0], codeBlock);
  assert.strictEqual(sanitizeCalls[0].options.RETURN_DOM_FRAGMENT, true);
  assert.deepStrictEqual(sanitizeCalls[0].options.ADD_ATTR, ['class', 'target', 'rel', 'align']);

  const safeHtml = controller.sanitizeMarkdownToHtml('[link](https://example.com)');
  assert.strictEqual(safeHtml, 'safe:<p>[link](https://example.com)</p>');
  assert.strictEqual(sanitizeCalls[1].options.RETURN_DOM_FRAGMENT, undefined);
  assert.deepStrictEqual(sanitizeCalls[1].options.USE_PROFILES, { html: true });

  highlightCalls.length = 0;
  controller.scheduleMarkdownRender();
  controller.scheduleMarkdownRender();

  assert.strictEqual(timers.length, 1);
  assert.strictEqual(timers[0].delay, 80);

  timers[0].callback();
  assert.strictEqual(frames.length, 1);

  now = 100;
  frames[0]();

  assert.strictEqual(elements.summaryRoot.className, 'summary-root markdown-body');
  assert.deepStrictEqual(elements.summaryRoot.fragment, { sanitizedFragment: '<p>## Streamed text</p>' });
  assert.strictEqual(elements.statsText.textContent, '13 字 · 2 段');
  assert.strictEqual(elements.summaryRoot.scrollTop, 540);
  assert.strictEqual(highlightCalls.length, 0);

  state.summaryMarkdown = '## Re-rendered';
  controller.scheduleMarkdownRender();
  assert.strictEqual(timers.length, 2);
});

test('sidebar render controller renders cancelled partial content and chunk progress', 'ui.sidebar_contract', () => {
  const sanitizeCalls = [];
  const highlightCalls = [];
  const cancelledModelCalls = [];
  const elements = createElements();
  const codeBlock = { id: 'cancelled_code' };
  elements.summaryRoot.querySelectorAll = (selector) => selector === 'pre code' ? [codeBlock] : [];
  const { controller } = createController({
    elements,
    state: {
      generating: true,
      lastDiagnostics: { runId: 'state_diag' },
      summaryMarkdown: 'partial from state'
    },
    DOMPurify: {
      sanitize(value, options) {
        sanitizeCalls.push({ value: String(value || ''), options });
        if (options?.RETURN_DOM_FRAGMENT) {
          return { sanitizedFragment: String(value || '') };
        }
        return 'safe-partial:' + String(value || '').replace(/&lt;script&gt;bad&lt;\/script&gt;/g, '');
      }
    },
    hljs: {
      getLanguage: () => false,
      highlightAuto: (code) => ({ value: code }),
      highlightElement(block) {
        highlightCalls.push(block);
      }
    },
    buildCancelledStateModel(record, diagnostics, markdown) {
      cancelledModelCalls.push({ record, diagnostics, markdown });
      return {
        partial: { hasPartialContent: true, markdown: '取消前内容 <script>bad</script>' },
        info: { title: '已取消', detail: '用户取消了本次生成。' },
        facts: ['已完成 1/2 段', '保留部分内容']
      };
    },
    normalizeUiError: (error) => ({
      message: error.message || '已取消',
      detail: error.detail || ''
    })
  });

  controller.renderCancelledState(
    { recordId: 'sum_1' },
    { message: '已取消', detail: '用户主动停止' },
    { runId: 'diag_1' }
  );

  assert.deepStrictEqual(cancelledModelCalls[0], {
    record: { recordId: 'sum_1' },
    diagnostics: { runId: 'diag_1' },
    markdown: 'partial from state'
  });
  assert.strictEqual(elements.summaryRoot.className, 'summary-root');
  assert.ok(elements.summaryRoot.innerHTML.includes('已取消'));
  assert.ok(elements.summaryRoot.innerHTML.includes('用户主动停止'));
  assert.ok(elements.summaryRoot.innerHTML.includes('取消前已生成内容'));
  assert.ok(elements.summaryRoot.innerHTML.includes('safe-partial:'));
  assert.strictEqual(sanitizeCalls[0].options.RETURN_DOM_FRAGMENT, undefined);
  assert.strictEqual(elements.summaryRoot.innerHTML.includes('<script>bad</script>'), false);
  assert.deepStrictEqual(highlightCalls, [codeBlock]);

  controller.renderChunkProgress(2, 5, [
    '第一段已完成',
    '第二段包含 **重点** 和后续观察点'
  ]);

  assert.strictEqual(elements.summaryRoot.className, 'summary-root');
  assert.ok(elements.summaryRoot.innerHTML.includes('inline-note-busy'));
  assert.ok(elements.summaryRoot.innerHTML.includes('正在分段总结长文'));
  assert.ok(elements.summaryRoot.innerHTML.includes('已完成 2/5 个分段'));
  assert.ok(elements.summaryRoot.innerHTML.includes('第二段包含 **重点** 和后续观察点'));
});

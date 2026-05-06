const { test, assert, freshRequire } = require('./harness');

const Domain = freshRequire('shared/domain.js');
const Strings = freshRequire('shared/strings.js');
const PageStrategy = freshRequire('shared/page-strategy.js');
const ArticleUtils = freshRequire('shared/article-utils.js');
const Trust = freshRequire('shared/trust-policy.js');
const Errors = freshRequire('shared/errors.js');
const AbortUtils = freshRequire('shared/abort-utils.js');
const RunUtils = freshRequire('shared/run-utils.js');
const UiFormat = freshRequire('shared/ui-format.js');
const UiLabels = freshRequire('shared/ui-labels.js');
const SummaryText = freshRequire('shared/summary-text.js');
const DiagnosticsView = freshRequire('shared/diagnostics-view.js');
const ReaderView = freshRequire('shared/reader-view.js');
const HistoryView = freshRequire('shared/history-view.js');
const SidebarMetaView = freshRequire('shared/sidebar-meta-view.js');
const ProviderPresets = freshRequire('shared/provider-presets.js');
const UrlUtils = freshRequire('shared/url-utils.js');

test('domain utilities normalize URLs, hosts, hashes, language, dates, and site types', [
  'content.extraction',
  'article.snapshot',
  'page.strategy'
], () => {
  assert.strictEqual(
    Domain.normalizeWhitespace(' a  b \r\n\n\n c\t\t d '),
    'a b\n\n c d'
  );
  assert.strictEqual(Domain.getSourceHost('https://docs.example.com/a'), 'docs.example.com');
  assert.strictEqual(Domain.getSourceHost('not a url'), '');
  assert.strictEqual(
    Domain.normalizeUrl('https://example.com/post?b=2&utm_source=x&a=1&fbclid=y#section'),
    'https://example.com/post?a=1&b=2'
  );
  assert.strictEqual(Domain.normalizeUrl(' not-url '), 'not-url');
  assert.strictEqual(Domain.hashString('same'), Domain.hashString('same'));
  assert.notStrictEqual(Domain.hashString('same'), Domain.hashString('different'));
  assert.ok(Domain.createRuntimeId('run').startsWith('run_'));
  assert.strictEqual(Domain.createDeterministicId('art', 'seed'), Domain.createDeterministicId('art', 'seed'));
  assert.strictEqual(Domain.inferLanguage('\u4e2d\u6587'.repeat(20), 'en'), 'zh');
  assert.strictEqual(Domain.inferLanguage('english words '.repeat(20), 'zh'), 'en');
  assert.strictEqual(Domain.inferLanguage('123', 'ja'), 'ja');
  assert.strictEqual(Domain.detectSiteType({ url: 'https://github.com/a/b', title: 'repo' }), 'repo');
  assert.strictEqual(Domain.detectSiteType({ url: 'https://github.com/a/b/issues/1', title: 'issue' }), 'forum');
  assert.strictEqual(Domain.detectSiteType({ url: 'https://stackoverflow.com/questions/1', title: 'q' }), 'forum');
  assert.strictEqual(Domain.detectSiteType({ url: 'https://docs.example.com/api', title: 'API Reference' }), 'doc');
  assert.strictEqual(Domain.detectSiteType({ url: 'https://medium.com/post', title: 'post' }), 'blog');
  assert.strictEqual(Domain.detectSiteType({ url: 'https://news.example.com/a', title: 'news' }), 'news');
  assert.strictEqual(Domain.detectSiteType({ url: 'https://example.com/a', title: 'plain' }), 'unknown');
  assert.strictEqual(Domain.pickFirstNonEmpty(['', null, ' value ']), 'value');
  assert.strictEqual(Domain.toIsoString('2026-04-15T00:00:00Z'), '2026-04-15T00:00:00.000Z');
  assert.strictEqual(Domain.toIsoString('invalid'), '');
});

test('page strategies cover all page types and fall back safely', 'page.strategy', () => {
  Object.keys(Strings.SITE_TYPE_LABELS).forEach((sourceType) => {
    const strategy = PageStrategy.resolveStrategy({ sourceType });
    assert.ok(strategy.strategyId);
    assert.ok(strategy.label);
    assert.ok(strategy.promptFocus);
    assert.ok(strategy.chunkMaxChars > 0);
    assert.ok(strategy.minChunkChars > 0);
  });

  const unknown = PageStrategy.resolveStrategy({ sourceType: 'missing' });
  assert.strictEqual(unknown.strategyId, 'general_reader');
  assert.strictEqual(unknown.sourceType, 'missing');
});

test('article snapshots normalize metadata, warnings, quality, and truncation', [
  'content.extraction',
  'article.snapshot'
], () => {
  const snapshot = ArticleUtils.buildArticleSnapshot({
    title: '',
    text: '\u6b63\u6587'.repeat(400),
    sourceUrl: 'https://docs.example.com/post?utm_source=x',
    meta: {
      canonicalUrl: 'https://docs.example.com/post',
      ogTitle: 'API Reference',
      description: 'Doc subtitle',
      author: 'Author',
      publishedAt: '2026-04-15T08:00:00+08:00',
      language: 'zh',
      siteName: 'Docs'
    },
    extractor: 'readability',
    maxChars: 500
  });

  assert.ok(snapshot.articleId.startsWith('art_'));
  assert.strictEqual(snapshot.normalizedUrl, 'https://docs.example.com/post');
  assert.strictEqual(snapshot.sourceHost, 'docs.example.com');
  assert.strictEqual(snapshot.title, 'API Reference');
  assert.strictEqual(snapshot.sourceType, 'doc');
  assert.strictEqual(snapshot.sourceStrategy.label, '\u6587\u6863\u7cbe\u8bfb');
  assert.strictEqual(snapshot.extractor, 'readability');
  assert.strictEqual(snapshot.isTruncated, true);
  assert.ok(snapshot.warnings.includes('content_truncated'));
  assert.ok(snapshot.qualityScore < 100);
  assert.strictEqual(snapshot.allowHistory, true);
  assert.strictEqual(snapshot.allowShare, true);
});

test('article chunking splits large paragraphs and preserves order', 'article.chunking', () => {
  const text = Array.from({ length: 8 })
    .map((_, index) => '\u7b2c ' + (index + 1) + ' \u6bb5\u3002' + '\u5185\u5bb9'.repeat(800))
    .join('\n\n');
  const chunks = ArticleUtils.splitTextIntoChunks(text, { maxChars: 1800, minChunkChars: 800 });

  assert.ok(chunks.length > 1);
  assert.deepStrictEqual(chunks.map((chunk) => chunk.index), chunks.map((_, index) => index));
  assert.ok(chunks.every((chunk) => chunk.chunkId.startsWith('chunk_')));
  assert.ok(chunks.every((chunk) => chunk.content.length > 0));

  const hugeParagraph = 'abc'.repeat(1000);
  const paragraphChunks = ArticleUtils.splitTextIntoChunks(hugeParagraph, { maxChars: 500, minChunkChars: 100 });
  assert.ok(paragraphChunks.length > 1);
  assert.ok(paragraphChunks.every((chunk) => chunk.charLength <= 500));
});

test('article prompt builders cover primary, chunk, synthesis, and secondary flows', [
  'prompt.primary',
  'prompt.secondary',
  'generation.primary',
  'generation.long_chunking',
  'generation.secondary'
], () => {
  const article = ArticleUtils.buildArticleSnapshot({
    title: 'API Reference',
    text: '\u6b63\u6587\u5185\u5bb9\u3002'.repeat(500),
    sourceUrl: 'https://docs.example.com/reference',
    meta: { siteName: 'Docs', language: 'zh' },
    extractor: 'readability'
  });

  const primary = ArticleUtils.buildPrimaryPrompt({ article, summaryMode: 'medium', targetLanguage: 'zh' });
  assert.ok(primary.includes('API Reference'));
  assert.ok(primary.includes(Strings.SUMMARY_MODES.medium.prompt));
  assert.ok(primary.includes('\u9875\u9762\u7b56\u7565: \u6587\u6863\u7cbe\u8bfb'));
  assert.ok(primary.includes('\u8bf7\u4f7f\u7528\u4e2d\u6587\u8f93\u51fa\u3002'));

  const chunkPrompt = ArticleUtils.buildChunkPrompt({ article, chunk: article.chunks[0], summaryMode: 'long', targetLanguage: 'en' });
  assert.ok(chunkPrompt.includes('\u5f53\u524d\u5206\u6bb5'));
  assert.ok(chunkPrompt.includes('Please answer in English.'));

  const synthesis = ArticleUtils.buildSynthesisPrompt({ article, summaryMode: 'short', targetLanguage: 'fr', partialSummaries: ['A', 'B'] });
  assert.ok(synthesis.includes('\u5206\u6bb5 1'));
  assert.ok(synthesis.includes('Veuillez r\u00e9pondre en fran\u00e7ais.'));

  const secondary = ArticleUtils.buildSecondaryPrompt({ article, summaryMode: 'qa', targetLanguage: 'auto', summaryMarkdown: '## Summary' });
  assert.ok(secondary.includes('\u539f\u59cb\u6458\u8981'));
  assert.ok(secondary.includes('\u95ee\u7b54\u5361\u7247'));

  const options = ArticleUtils.getSummaryModeOptions();
  assert.strictEqual(options.length, Object.keys(Strings.SUMMARY_MODES).length);
  assert.ok(options.some((item) => item.value === 'action_items'));
});

test('article meta reader supports content attributes and text content fallback', 'content.extraction', () => {
  const doc = {
    querySelector(selector) {
      const values = {
        'meta[name="description"]': { getAttribute: () => 'Meta description', textContent: '' },
        title: { getAttribute: () => '', textContent: 'Title text' }
      };
      return values[selector] || null;
    }
  };

  assert.strictEqual(ArticleUtils.readMetaContent(doc, ['missing', 'meta[name="description"]']), 'Meta description');
  assert.strictEqual(ArticleUtils.readMetaContent(doc, ['title']), 'Title text');
  assert.strictEqual(ArticleUtils.readMetaContent(doc, ['missing']), '');
});

test('trust policy covers unloaded pages, no-trace mode, overrides, and record projection', [
  'privacy.policy',
  'settings.theme'
], () => {
  const unloaded = Trust.buildTrustPolicy(null, { privacyMode: false });
  assert.strictEqual(unloaded.willSendToModel, false);
  assert.strictEqual(unloaded.allowHistory, true);

  const noTrace = Trust.buildTrustPolicy({ allowHistory: true, allowShare: true }, {
    privacyMode: true,
    defaultAllowHistory: true,
    defaultAllowShare: false
  });
  assert.strictEqual(noTrace.privacyMode, true);
  assert.strictEqual(noTrace.allowHistory, false);
  assert.strictEqual(noTrace.allowShare, false);
  assert.strictEqual(noTrace.retentionHint, 'session_only');

  const override = Trust.buildTrustPolicy({ allowHistory: false, allowShare: false }, {}, {
    allowHistory: true,
    allowShare: true,
    retentionHint: 'persistent'
  });
  assert.strictEqual(override.allowHistory, true);
  assert.strictEqual(override.allowShare, true);

  const record = Trust.applyPolicyToRecord({
    articleSnapshot: { title: 'T' }
  }, noTrace);
  assert.strictEqual(record.allowHistory, false);
  assert.strictEqual(record.articleSnapshot.allowHistory, false);
});

test('error utilities preserve catalog defaults and diagnostic extras', 'transport.errors', () => {
  const configError = Errors.createError(Errors.ERROR_CODES.CONFIG_MISSING_API_KEY, { stage: 'primary' });
  assert.strictEqual(configError.retriable, false);
  assert.strictEqual(configError.stage, 'primary');

  const invalidBaseUrl = Errors.createError(Errors.ERROR_CODES.CONFIG_INVALID_BASE_URL);
  assert.strictEqual(invalidBaseUrl.retriable, false);
  assert.ok(Errors.getUserMessage(invalidBaseUrl).includes('HTTPS'));

  const normalized = Errors.normalizeError({
    code: Errors.ERROR_CODES.RUN_CANCELLED,
    message: '\u672c\u6b21\u751f\u6210\u5df2\u53d6\u6d88\u3002',
    diagnostics: { runId: 'run_1' },
    provider: 'openai'
  });
  assert.deepStrictEqual(normalized.diagnostics, { runId: 'run_1' });
  assert.strictEqual(normalized.provider, 'openai');

  const http = Errors.createHttpError(500, 'Server failed', { endpointMode: 'responses' });
  assert.strictEqual(http.code, Errors.ERROR_CODES.HTTP_ERROR);
  assert.strictEqual(http.httpStatus, 500);
  assert.ok(Errors.getUserMessage(http).includes('500'));
});

test('URL utilities normalize endpoints and only allow HTTP for local networks', 'settings.endpoint_security', () => {
  assert.strictEqual(UrlUtils.normalizeBaseURLInput('api.example.com/v1'), 'https://api.example.com/v1');
  assert.strictEqual(UrlUtils.isAllowedModelEndpointUrl('https://api.example.com/v1'), true);
  assert.strictEqual(UrlUtils.isAllowedModelEndpointUrl('http://127.0.0.1:11434/v1'), true);
  assert.strictEqual(UrlUtils.isAllowedModelEndpointUrl('http://192.168.1.8:8080/v1'), true);
  assert.strictEqual(UrlUtils.isAllowedModelEndpointUrl('http://[::1]:11434/v1'), true);
  assert.strictEqual(UrlUtils.isAllowedModelEndpointUrl('http://printer.local:8080/v1'), true);
  assert.strictEqual(UrlUtils.isAllowedModelEndpointUrl('http://api.example.com/v1'), false);
  assert.strictEqual(UrlUtils.isAllowedModelEndpointUrl('ftp://192.168.1.8/v1'), false);
  assert.strictEqual(UrlUtils.isAllowedModelEndpointUrl('not a url'), false);
});

test('abort utilities race promises, wait with abort, and preserve abort reasons', 'run.cancellation', async () => {
  const direct = new Error('direct');
  direct.name = 'AbortError';
  assert.strictEqual(AbortUtils.isAbortError(direct), true);

  const controller = new AbortController();
  const promise = AbortUtils.raceWithAbort(new Promise((resolve) => setTimeout(() => resolve('late'), 50)), controller.signal);
  controller.abort('user_cancelled');
  await assert.rejects(promise, (error) => error?.name === 'AbortError' && error.reason === 'user_cancelled');

  const waitController = new AbortController();
  const waitPromise = AbortUtils.waitWithAbort(100, waitController.signal);
  setTimeout(() => waitController.abort('stop'), 10);
  await assert.rejects(waitPromise, (error) => error?.name === 'AbortError');

  const completed = await AbortUtils.raceWithAbort(Promise.resolve('ok'), null);
  assert.strictEqual(completed, 'ok');
});

test('run utilities describe cancellation, progress, diagnostics, and terminal patches', [
  'run.cancellation',
  'run.diagnostics'
], () => {
  assert.strictEqual(RunUtils.formatDuration(999), '999ms');
  assert.strictEqual(RunUtils.formatDuration(1500), '1.5s');
  assert.strictEqual(RunUtils.formatDuration(65000), '1m 5s');
  assert.strictEqual(RunUtils.getRunStageLabel('secondary', { secondaryModeLabel: '\u95ee\u7b54\u5361\u7247' }), '\u95ee\u7b54\u5361\u7247 \u751f\u6210');
  assert.strictEqual(RunUtils.getRunStatusLabel('failed'), '\u5931\u8d25');

  const diagnostics = {
    article: {
      chunkCount: 5,
      sourceHost: 'www.v2ex.com',
      sourceStrategyLabel: '\u95ee\u7b54\u5f52\u7eb3'
    },
    provider: 'openai',
    model: 'gpt-4.1-mini',
    endpointMode: 'responses',
    adapterId: 'openai_responses',
    retryCount: 1,
    durationMs: 4820,
    runId: 'run_cancelled_3',
    chunkRuns: [{ runId: 'chunk_1' }, { runId: 'chunk_2' }],
    finalRun: {
      runId: 'run_cancelled_3',
      stage: 'chunk',
      status: 'cancelled',
      chunkIndex: 2,
      chunkCount: 5
    },
    error: {
      code: Errors.ERROR_CODES.RUN_CANCELLED,
      message: '\u672c\u6b21\u751f\u6210\u5df2\u53d6\u6d88\u3002'
    }
  };

  const cancellation = RunUtils.describeCancellation(diagnostics, { hasPartialContent: false });
  assert.strictEqual(cancellation.title, '\u5df2\u53d6\u6d88\u751f\u6210');
  assert.strictEqual(cancellation.stageLabel, '\u5206\u6bb5\u603b\u7ed3');
  assert.ok(cancellation.detail.includes('3/5'));
  assert.ok(cancellation.progress.includes('2/5'));

  const summary = RunUtils.buildDiagnosticsSummary(diagnostics, { hasPartialContent: true });
  assert.ok(summary.includes('\u72b6\u6001: \u5df2\u53d6\u6d88'));
  assert.ok(summary.includes('\u6a21\u578b: openai / gpt-4.1-mini'));
  assert.ok(summary.includes('\u9519\u8bef: RUN_CANCELLED'));

  const patch = RunUtils.buildTerminalRecordPatch({ provider: 'fallback' }, diagnostics, 'failed', { errorCode: 'X' });
  assert.strictEqual(patch.status, 'failed');
  assert.strictEqual(patch.provider, 'openai');
  assert.strictEqual(patch.errorCode, 'X');
  assert.deepStrictEqual(RunUtils.pickTerminalRun(null, { diagnostics }), diagnostics);
});

test('UI format utilities escape HTML and preserve page-specific date fallbacks', [
  'ui.sidebar_contract',
  'ui.popup_contract',
  'ui.reader_contract'
], () => {
  assert.strictEqual(
    UiFormat.escapeHtml(`A&B <tag attr="x">'`),
    'A&amp;B &lt;tag attr=&quot;x&quot;&gt;&#39;'
  );
  assert.strictEqual(UiFormat.formatDateTime('', { emptyText: '-' }), '-');
  assert.strictEqual(UiFormat.formatDateTime('invalid', { emptyText: '\u672a\u8bb0\u5f55' }), '\u672a\u8bb0\u5f55');

  const value = '2026-04-15T08:30:00.000Z';
  assert.strictEqual(
    UiFormat.formatDateTime(value, { includeYear: false }),
    new Date(value).toLocaleString('zh-CN', {
      hour12: false,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  );
  assert.strictEqual(
    UiFormat.formatDateTime(value),
    new Date(value).toLocaleString('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  );
});

test('UI label utilities preserve page-specific provider, mode, and status labels', [
  'ui.sidebar_contract',
  'ui.popup_contract',
  'ui.reader_contract',
  'history.storage'
], () => {
  assert.strictEqual(UiLabels.getProviderLabel('openai'), 'OpenAI Compatible');
  assert.strictEqual(
    UiLabels.getProviderLabel('openai', { variant: 'settings', fallback: 'openai' }),
    'OpenAI / OpenAI \u517c\u5bb9\u63a5\u53e3'
  );
  assert.strictEqual(UiLabels.getProviderLabel('', { fallback: '\u672a\u77e5\u6765\u6e90' }), '\u672a\u77e5\u6765\u6e90');

  assert.strictEqual(UiLabels.getSummaryModeLabel('long'), '\u8be6\u7ec6\u5206\u6790');
  assert.strictEqual(UiLabels.getSummaryModeLabel('long', { variant: 'reader' }), '\u6df1\u5ea6\u603b\u7ed3');
  assert.strictEqual(UiLabels.getSummaryModeLabel('', { fallback: '\u6807\u51c6\u603b\u7ed3' }), '\u6807\u51c6\u603b\u7ed3');

  assert.strictEqual(UiLabels.getRecordStatusLabel('running'), '\u8fdb\u884c\u4e2d');
  assert.strictEqual(UiLabels.getRecordStatusLabel('running', { variant: 'reader' }), '\u751f\u6210\u4e2d');
  assert.strictEqual(UiLabels.getRecordStatusLabel('', { fallback: '\u5df2\u5b8c\u6210' }), '\u5df2\u5b8c\u6210');

  assert.strictEqual(UiLabels.getStrategyLabel({ label: '\u81ea\u5b9a\u4e49\u7b56\u7565' }, 'news'), '\u81ea\u5b9a\u4e49\u7b56\u7565');
  assert.strictEqual(UiLabels.getStrategyLabel(null, 'doc'), '\u6587\u6863\u7cbe\u8bfb');
  assert.strictEqual(UiLabels.getStrategyLabel(null, 'missing'), '\u901a\u7528\u7cbe\u8bfb');
  assert.deepStrictEqual(
    UiLabels.summarizeWarnings(['missing_title', 'content_truncated', 'custom_warning']),
    ['\u6807\u9898\u4e0d\u5b8c\u6574', '\u6b63\u6587\u5df2\u622a\u65ad', 'custom_warning']
  );
});

test('summary text utilities normalize markdown previews and bullets for storage and history UI', [
  'history.storage',
  'ui.sidebar_contract',
  'reader.page'
], () => {
  assert.strictEqual(
    SummaryText.markdownToPlainText('## Title\n- A **bold** [link](https://x.test)\n```js\nhidden\n```'),
    'Title A **bold** link'
  );
  assert.strictEqual(
    SummaryText.stripMarkdownPreview('## Title\n- A **bold** [link](https://x.test)', 8),
    'Title A '
  );
  assert.strictEqual(SummaryText.stripMarkdownPreview('## Title', 0), '');
  assert.deepStrictEqual(
    SummaryText.extractBullets('- One\n1. Two\nParagraph\n+ Three'),
    ['One', 'Two', 'Three']
  );
  assert.strictEqual(
    SummaryText.extractBullets(Array.from({ length: 10 }, (_, index) => '- item ' + index).join('\n')).length,
    8
  );
});

test('history view utilities build stable item and group labels for sidebar rendering', [
  'history.search',
  'history.site_filters',
  'ui.sidebar_contract'
], () => {
  const updatedAt = '2026-04-15T08:30:00.000Z';
  const itemView = HistoryView.buildHistoryItemView({
    titleSnapshot: 'Stored Doc',
    updatedAt,
    provider: 'openai',
    model: 'gpt-4o-mini',
    summaryMarkdown: '## Heading\n- First bullet',
    summaryMode: 'long',
    status: 'running',
    articleSnapshot: {
      sourceType: 'doc',
      sourceStrategy: { label: 'Custom Strategy' }
    }
  }, { joiner: ' | ' });

  assert.strictEqual(itemView.title, 'Stored Doc');
  assert.strictEqual(
    itemView.meta,
    [
      UiFormat.formatDateTime(updatedAt, { emptyText: '' }),
      'OpenAI Compatible',
      'gpt-4o-mini'
    ].join(' | ')
  );
  assert.strictEqual(itemView.preview, 'Heading First bullet');
  assert.deepStrictEqual(itemView.badges, [
    Strings.SITE_TYPE_LABELS.doc,
    'Custom Strategy',
    UiLabels.getSummaryModeLabel('long', { fallback: '\u6807\u51c6\u603b\u7ed3' }),
    UiLabels.getRecordStatusLabel('running', { fallback: '\u5df2\u5b8c\u6210' })
  ]);

  const groupView = HistoryView.buildHistoryGroupView({
    host: 'docs.example.com',
    count: 3,
    favoriteCount: 1,
    sourceTypes: ['doc', 'news'],
    latestUpdatedAt: updatedAt
  }, {
    joiner: ' | ',
    selected: true,
    recordCountSuffix: ' records',
    favoriteCountSuffix: ' favorites',
    latestUpdatedPrefix: 'Updated: ',
    selectedSiteBadgeText: 'selected',
    aggregateSiteBadgeText: 'grouped'
  });

  assert.strictEqual(groupView.title, 'docs.example.com');
  assert.strictEqual(
    groupView.meta,
    [
      '3 records',
      '1 favorites',
      [Strings.SITE_TYPE_LABELS.doc, Strings.SITE_TYPE_LABELS.news].join(' / '),
      'Updated: ' + UiFormat.formatDateTime(updatedAt, { emptyText: '' })
    ].join(' | ')
  );
  assert.strictEqual(groupView.badge, 'selected');
});

test('reader view utilities normalize URLs and merge snapshots with stored records', [
  'reader.page',
  'reader.session',
  'ui.reader_contract'
], () => {
  const built = ReaderView.buildReaderSnapshot({
    article: {
      title: 'Reader Title',
      normalizedUrl: 'https://docs.example.com/post',
      sourceUrl: 'https://docs.example.com/post?utm_source=x',
      sourceHost: 'docs.example.com',
      author: 'Author',
      publishedAt: '2026-04-15T08:30:00.000Z',
      sourceType: 'doc',
      sourceStrategy: { label: 'Doc Strategy' }
    },
    record: {
      recordId: 'rec_reader',
      summaryMode: 'long',
      provider: 'openai',
      model: 'gpt-4o-mini',
      status: 'running',
      createdAt: '2026-04-15T09:00:00.000Z',
      favorite: true,
      allowHistory: true,
      privacyMode: true
    },
    summaryMarkdown: '## Title\n- First bullet',
    currentSummaryMode: 'medium',
    generating: true,
    diagnostics: { stage: 'streaming' }
  });

  assert.strictEqual(built.recordId, 'rec_reader');
  assert.strictEqual(built.title, 'Reader Title');
  assert.strictEqual(built.sourceUrl, 'https://docs.example.com/post');
  assert.strictEqual(built.sourceTypeLabel, Strings.SITE_TYPE_LABELS.doc);
  assert.strictEqual(built.strategyLabel, 'Doc Strategy');
  assert.strictEqual(built.summaryMode, 'long');
  assert.strictEqual(built.summaryModeLabel, UiLabels.getSummaryModeLabel('long', { variant: 'reader', fallback: '\u6807\u51c6\u603b\u7ed3' }));
  assert.strictEqual(built.providerLabel, 'OpenAI Compatible');
  assert.strictEqual(built.summaryPlainText, 'Title First bullet');
  assert.deepStrictEqual(built.diagnostics, { stage: 'streaming' });

  const merged = ReaderView.mergeSnapshotWithRecord({
    recordId: 'snap_1',
    sourceUrl: 'https://fallback.example.com',
    sourceHost: 'fallback.example.com',
    summaryMode: 'medium',
    provider: 'legacy',
    status: 'completed',
    completedAt: '2026-04-15T07:00:00.000Z',
    summaryMarkdown: '## Snapshot',
    summaryPlainText: 'Snapshot',
    diagnostics: { snapshot: true }
  }, {
    recordId: 'rec_db',
    normalizedUrl: 'https://db.example.com/post',
    sourceHost: 'db.example.com',
    summaryMode: 'qa',
    provider: 'anthropic',
    model: 'claude-sonnet',
    status: 'failed',
    createdAt: '2026-04-15T10:00:00.000Z',
    completedAt: '',
    summaryMarkdown: '',
    summaryPlainText: '',
    diagnostics: { stored: true },
    favorite: false,
    allowHistory: false,
    privacyMode: false
  });

  assert.strictEqual(merged.recordId, 'rec_db');
  assert.strictEqual(merged.sourceUrl, 'https://db.example.com/post');
  assert.strictEqual(merged.sourceHost, 'db.example.com');
  assert.strictEqual(merged.summaryModeLabel, UiLabels.getSummaryModeLabel('qa', { variant: 'reader', fallback: '\u6807\u51c6\u603b\u7ed3' }));
  assert.strictEqual(merged.providerLabel, UiLabels.getProviderLabel('anthropic', { fallback: '\u672a\u77e5\u6765\u6e90' }));
  assert.strictEqual(merged.status, 'failed');
  assert.strictEqual(merged.summaryMarkdown, '## Snapshot');
  assert.strictEqual(merged.summaryPlainText, 'Snapshot');
  assert.deepStrictEqual(merged.diagnostics, { stored: true });

  assert.strictEqual(ReaderView.normalizeExternalUrl('https://example.com/path'), 'https://example.com/path');
  assert.strictEqual(ReaderView.normalizeExternalUrl('javascript:alert(1)'), '');
  assert.strictEqual(ReaderView.buildReaderSnapshot({ summaryMarkdown: '   ' }), null);
});

test('diagnostics view utilities build sidebar diagnostics and cancelled-state models', [
  'ui.sidebar_contract',
  'run.cancellation',
  'run.diagnostics'
], () => {
  const diagnostics = {
    article: {
      chunkCount: 4
    },
    finalRun: {
      status: 'cancelled',
      stage: 'chunk',
      chunkIndex: 1,
      chunkCount: 4
    },
    error: {
      code: Errors.ERROR_CODES.RUN_CANCELLED,
      stage: 'chunk'
    }
  };
  const record = {
    summaryMode: 'qa',
    promptProfile: 'secondary',
    summaryMarkdown: '## Partial\n- Bullet'
  };

  const panel = DiagnosticsView.buildDiagnosticsPanelModel(record, diagnostics, '');
  assert.strictEqual(panel.status, 'cancelled');
  assert.strictEqual(panel.toggleLabel, '\u53d6\u6d88\u8bca\u65ad');
  assert.strictEqual(panel.shouldAutoOpen, true);
  assert.strictEqual(panel.partial.charCount > 0, true);
  assert.strictEqual(panel.options.hasPartialContent, true);
  assert.strictEqual(
    panel.options.secondaryModeLabel,
    UiLabels.getSummaryModeLabel('qa', { fallback: '\u6807\u51c6\u603b\u7ed3' })
  );
  assert.ok(panel.summaryText.includes('\u72b6\u6001: \u5df2\u53d6\u6d88'));
  assert.ok(panel.summaryText.includes('\u8fdb\u5ea6:'));
  assert.ok(panel.summaryText.includes('\u7b2c 2 \u6bb5'));

  const cancelled = DiagnosticsView.buildCancelledStateModel(record, diagnostics, '');
  assert.strictEqual(cancelled.info.title, '\u5df2\u53d6\u6d88\u751f\u6210');
  assert.ok(cancelled.statusText.includes('\u5df2\u4fdd\u7559\u5f53\u524d\u5df2\u751f\u6210\u5185\u5bb9'));
  assert.ok(cancelled.facts.some((item) => item.includes('\u9636\u6bb5\uff1a')));
  assert.ok(cancelled.facts.some((item) => item.includes('\u5185\u5bb9\uff1a\u5df2\u4fdd\u7559\u53d6\u6d88\u524d\u5df2\u751f\u6210\u5185\u5bb9')));

  const idle = DiagnosticsView.buildDiagnosticsPanelModel(null, null, '');
  assert.strictEqual(idle.status, 'idle');
  assert.strictEqual(idle.toggleLabel, '\u8fd0\u884c\u8bca\u65ad');
  assert.strictEqual(idle.summaryText, '\u7b49\u5f85\u672c\u6b21\u8fd0\u884c\u7684\u8bca\u65ad\u4fe1\u606f...');
});

test('sidebar meta view utilities build article meta and trust card labels for sidebar rendering', [
  'ui.sidebar_contract',
  'privacy.policy',
  'page.strategy'
], () => {
  const articleView = SidebarMetaView.buildArticleMetaView({
    title: 'Doc Page',
    normalizedUrl: 'https://docs.example.com/post',
    sourceUrl: 'https://docs.example.com/post?utm_source=x',
    sourceHost: 'docs.example.com',
    sourceType: 'doc',
    sourceStrategy: { label: 'Doc Strategy' },
    author: 'Author',
    publishedAt: '2026-04-15T08:30:00.000Z',
    contentLength: 2048,
    chunkingStrategy: 'paragraph_split',
    chunkCount: 3,
    warnings: ['missing_title', 'custom_warning']
  }, {
    summaryMode: 'long',
    simpleModeEnabled: false
  });

  assert.strictEqual(articleView.title, 'Doc Page');
  assert.strictEqual(articleView.sourceText, 'https://docs.example.com/post');
  assert.strictEqual(articleView.siteTypeLabel, Strings.SITE_TYPE_LABELS.doc);
  assert.strictEqual(articleView.strategyLabel, 'Doc Strategy');
  assert.strictEqual(articleView.modeLabel, UiLabels.getSummaryModeLabel('long', { fallback: '\u6807\u51c6\u603b\u7ed3' }));
  assert.strictEqual(articleView.authorLabel, 'Author');
  assert.strictEqual(articleView.publishedLabel, UiFormat.formatDateTime('2026-04-15T08:30:00.000Z', { emptyText: '-' }));
  assert.strictEqual(articleView.lengthLabel, '2,048\u5b57');
  assert.strictEqual(articleView.chunkLabel, '\u6bb5\u843d \u00b7 3 \u6bb5');
  assert.deepStrictEqual(articleView.warnings, [UiLabels.getWarningLabel('missing_title'), 'custom_warning']);

  const simpleArticleView = SidebarMetaView.buildArticleMetaView({}, {
    summaryMode: 'short',
    simpleModeEnabled: true
  });
  assert.strictEqual(simpleArticleView.chunkLabel, '\u7b80\u5355 \u00b7 \u5355\u6b21');

  const trustView = SidebarMetaView.buildTrustCardView({ allowHistory: true, allowShare: false }, {
    privacyMode: true,
    defaultAllowHistory: true,
    defaultAllowShare: false
  });
  assert.strictEqual(trustView.policy.privacyMode, true);
  assert.strictEqual(trustView.title, '\u5f53\u524d\u9875\u9762\u7b56\u7565');
  assert.strictEqual(trustView.sendValue, '\u4f1a\u53d1\u9001');
  assert.strictEqual(trustView.shareValue, '\u5f53\u524d\u4e0d\u5141\u8bb8\u5206\u4eab');
  assert.strictEqual(trustView.privacyTogglePrimary, true);
  assert.strictEqual(trustView.modeTone, 'warning');
  assert.strictEqual(trustView.historyTone, 'warning');
  assert.strictEqual(trustView.shareTone, 'danger');
});

test('provider presets are immutable and infer provider profiles', [
  'settings.presets',
  'provider.registry'
], () => {
  const presets = ProviderPresets.listPresets();
  assert.ok(presets.length >= 10);
  presets[0].label = 'mutated';
  assert.notStrictEqual(ProviderPresets.getPreset('custom').label, 'mutated');

  assert.deepStrictEqual(ProviderPresets.getProviderOptions('deepseek').sort(), ['anthropic', 'openai']);
  assert.strictEqual(ProviderPresets.normalizeProvider('missing', 'deepseek'), 'openai');
  assert.strictEqual(ProviderPresets.normalizeEndpointMode('missing', 'openai', 'deepseek'), 'chat_completions');
  assert.deepStrictEqual(ProviderPresets.getEndpointModes('anthropic_official', 'anthropic'), ['messages']);
  assert.strictEqual(ProviderPresets.getProviderProfile('missing', 'openai').defaultModel, 'gpt-4o-mini');
  assert.strictEqual(ProviderPresets.getProviderProfile('gemini', 'anthropic'), null);

  const cases = [
    ['https://api.anthropic.com', 'anthropic_official'],
    ['https://api.openai.com/v1', 'openai_official'],
    ['https://api.deepseek.com', 'deepseek'],
    ['https://generativelanguage.googleapis.com/v1beta/openai', 'gemini'],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen'],
    ['https://api.x.ai/v1', 'xai'],
    ['https://open.bigmodel.cn/api/paas/v4', 'glm'],
    ['https://api.minimaxi.com/v1', 'minimax'],
    ['https://ark.cn-beijing.volces.com/api/v3', 'doubao'],
    ['https://api.hunyuan.cloud.tencent.com/v1', 'hunyuan']
  ];

  cases.forEach(([aiBaseURL, expected]) => {
    assert.strictEqual(ProviderPresets.inferPresetFromSettings({ aiProvider: 'openai', aiBaseURL }), expected);
  });

  assert.strictEqual(ProviderPresets.inferPresetFromSettings({ aiProvider: 'openai', modelName: 'gpt-4o-mini' }), 'openai_official');
  assert.strictEqual(ProviderPresets.inferPresetFromSettings({ aiProvider: 'openai', modelName: 'gemini-2.5-flash' }), 'gemini');
  assert.strictEqual(ProviderPresets.inferPresetFromSettings({ aiProvider: 'openai', modelName: 'grok-4' }), 'xai');
  assert.strictEqual(ProviderPresets.inferPresetFromSettings({ aiProvider: 'anthropic', modelName: 'claude-sonnet' }), 'anthropic_official');
});

test('theme module resolves, saves, cycles, and notifies preferences', 'settings.theme', async () => {
  const previousWindow = global.window;
  const stored = {};
  const listeners = [];
  const fakeWindow = {
    document: {
      documentElement: {
        dataset: {},
        style: {}
      }
    },
    chrome: {
      storage: {
        sync: {
          get(keys, callback) {
            const result = {};
            [].concat(keys).forEach((key) => {
              result[key] = stored[key];
            });
            callback(result);
          },
          set(payload, callback) {
            Object.assign(stored, payload);
            callback();
          }
        },
        onChanged: {
          addListener(listener) {
            listeners.push(listener);
          }
        }
      }
    }
  };

  try {
    global.window = fakeWindow;
    freshRequire('shared/theme.js');
    const Theme = fakeWindow.AISummaryTheme;

    assert.strictEqual(Theme.normalizePreference('bad'), 'system');
    assert.strictEqual(Theme.normalizePalette('bad'), 'jade');
    assert.strictEqual(Theme.normalizePalette('slate'), 'slate');
    assert.strictEqual(Theme.resolveTheme('light'), 'light');
    assert.strictEqual(Theme.getNextPreference('system'), 'light');
    assert.strictEqual(Theme.getNextPreference('dark'), 'system');

    const snapshots = [];
    const unsubscribe = Theme.onChange((snapshot) => snapshots.push(snapshot));
    const saved = await Theme.saveThemePreference('dark');
    assert.deepStrictEqual(saved, { preference: 'dark', theme: 'dark', palette: 'jade' });
    assert.strictEqual(fakeWindow.document.documentElement.dataset.theme, 'dark');
    assert.strictEqual(fakeWindow.document.documentElement.dataset.palette, 'jade');
    assert.strictEqual(stored[Theme.STORAGE_KEY], 'dark');
    assert.ok(snapshots.some((snapshot) => snapshot.preference === 'dark'));

    const savedPalette = await Theme.saveThemePalette('plum');
    assert.deepStrictEqual(savedPalette, { preference: 'dark', theme: 'dark', palette: 'plum' });
    assert.strictEqual(fakeWindow.document.documentElement.dataset.palette, 'plum');
    assert.strictEqual(stored[Theme.PALETTE_STORAGE_KEY], 'plum');
    assert.ok(snapshots.some((snapshot) => snapshot.palette === 'plum'));
    unsubscribe();

    listeners[0]({ [Theme.STORAGE_KEY]: { newValue: 'light' } }, 'sync');
    assert.strictEqual(Theme.getCurrentTheme(), 'light');
    listeners[0]({ [Theme.PALETTE_STORAGE_KEY]: { newValue: 'slate' } }, 'sync');
    assert.strictEqual(Theme.getCurrentPalette(), 'slate');
  } finally {
    global.window = previousWindow;
  }
});

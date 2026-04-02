const assert = require('assert');

const Domain = require('../shared/domain.js');
const Strings = require('../shared/strings.js');
const AbortUtils = require('../shared/abort-utils.js');
const Errors = require('../shared/errors.js');
const RunUtils = require('../shared/run-utils.js');
const PageStrategy = require('../shared/page-strategy.js');
const ArticleUtils = require('../shared/article-utils.js');
const Trust = require('../shared/trust-policy.js');
const ProviderPresets = require('../shared/provider-presets.js');
const OpenAIAdapter = require('../adapters/openai-adapter.js');
const AnthropicAdapter = require('../adapters/anthropic-adapter.js');
const AdapterRegistry = require('../adapters/registry.js');

global.AISummaryDomain = Domain;
const RecordStore = require('../db.js');

function testNormalizeUrl() {
  const output = Domain.normalizeUrl('https://example.com/post?b=2&utm_source=x&a=1#section');
  assert.strictEqual(output, 'https://example.com/post?a=1&b=2');
}

function testDetectSiteType() {
  assert.strictEqual(Domain.detectSiteType({ url: 'https://docs.example.com/api', title: 'API Reference' }), 'doc');
  assert.strictEqual(Domain.detectSiteType({ url: 'https://github.com/openai/openai', title: 'repo' }), 'repo');
  assert.strictEqual(Domain.detectSiteType({ url: 'https://news.ycombinator.com', title: 'news' }), 'news');
}

function testResolvePageStrategy() {
  const docStrategy = PageStrategy.resolveStrategy({ sourceType: 'doc' });
  const repoStrategy = PageStrategy.resolveStrategy({ sourceType: 'repo' });
  assert.strictEqual(docStrategy.label, '\u6587\u6863\u7cbe\u8bfb');
  assert.strictEqual(docStrategy.preferredSummaryMode, 'long');
  assert.strictEqual(repoStrategy.label, 'README \u5bfc\u8bfb');
  assert.strictEqual(repoStrategy.preferredSummaryMode, 'key_points');
}

function testSplitTextIntoChunks() {
  const text = Array.from({ length: 8 }).map((_, index) => '\u7b2c ' + (index + 1) + ' \u6bb5\u3002' + '\u5185\u5bb9'.repeat(800)).join('\n\n');
  const chunks = ArticleUtils.splitTextIntoChunks(text, { maxChars: 1800, minChunkChars: 800 });
  assert.ok(chunks.length > 1, 'should split into multiple chunks');
  assert.ok(chunks.every((item) => item.content.length > 0), 'each chunk should contain content');
}

function testBuildArticleSnapshot() {
  const snapshot = ArticleUtils.buildArticleSnapshot({
    title: 'API Reference',
    text: '\u8fd9\u662f\u6d4b\u8bd5\u6b63\u6587\u3002'.repeat(700),
    sourceUrl: 'https://docs.example.com/post?utm_source=x',
    meta: {
      siteName: 'Example',
      author: 'Author',
      language: 'zh',
      canonicalUrl: 'https://docs.example.com/post'
    },
    extractor: 'readability'
  });

  assert.ok(snapshot.articleId.startsWith('art_'));
  assert.strictEqual(snapshot.normalizedUrl, 'https://docs.example.com/post');
  assert.strictEqual(snapshot.sourceHost, 'docs.example.com');
  assert.strictEqual(snapshot.extractor, 'readability');
  assert.ok(snapshot.chunkCount >= 1);
  assert.strictEqual(snapshot.sourceType, 'doc');
  assert.strictEqual(snapshot.sourceStrategy.label, '\u6587\u6863\u7cbe\u8bfb');
  assert.strictEqual(snapshot.preferredSummaryMode, 'long');
}

function testPromptBuilders() {
  const article = ArticleUtils.buildArticleSnapshot({
    title: 'API Reference',
    text: '\u6b63\u6587\u5185\u5bb9\u3002'.repeat(400),
    sourceUrl: 'https://docs.example.com/reference',
    meta: { siteName: 'Docs', language: 'zh' },
    extractor: 'readability'
  });

  const primary = ArticleUtils.buildPrimaryPrompt({ article, summaryMode: 'medium', targetLanguage: 'zh' });
  assert.ok(primary.includes('API Reference'));
  assert.ok(primary.includes(Strings.SUMMARY_MODES.medium.prompt));
  assert.ok(primary.includes('\u9875\u9762\u7b56\u7565: \u6587\u6863\u7cbe\u8bfb'));

  const chunkPrompt = ArticleUtils.buildChunkPrompt({ article, chunk: article.chunks[0], summaryMode: 'long', targetLanguage: 'zh' });
  assert.ok(chunkPrompt.includes('\u5f53\u524d\u5206\u6bb5'));
  assert.ok(chunkPrompt.includes('\u9875\u9762\u7b56\u7565: \u6587\u6863\u7cbe\u8bfb'));

  const synthesis = ArticleUtils.buildSynthesisPrompt({ article, summaryMode: 'short', targetLanguage: 'zh', partialSummaries: ['A', 'B'] });
  assert.ok(synthesis.includes('\u5206\u6bb5 1'));
  assert.ok(synthesis.includes('\u9875\u9762\u7b56\u7565: \u6587\u6863\u7cbe\u8bfb'));

  const secondary = ArticleUtils.buildSecondaryPrompt({ article, summaryMode: 'qa', targetLanguage: 'zh', summaryMarkdown: '## Summary' });
  assert.ok(secondary.includes('\u539f\u59cb\u6458\u8981'));
  assert.ok(secondary.includes('\u9875\u9762\u7b56\u7565: \u6587\u6863\u7cbe\u8bfb'));
}

function testTrustPolicy() {
  const article = {
    allowHistory: true,
    allowShare: true
  };

  const noTrace = Trust.buildTrustPolicy(article, {
    privacyMode: true,
    defaultAllowHistory: true,
    defaultAllowShare: false
  });

  assert.strictEqual(noTrace.privacyMode, true);
  assert.strictEqual(noTrace.allowHistory, false);
  assert.strictEqual(noTrace.allowShare, false);
  assert.strictEqual(noTrace.retentionHint, 'session_only');

  const standard = Trust.buildTrustPolicy(article, {
    privacyMode: false,
    defaultAllowHistory: true,
    defaultAllowShare: true
  });

  assert.strictEqual(standard.allowHistory, true);
  assert.strictEqual(standard.allowShare, true);
}

function testShouldPersistRecord() {
  assert.strictEqual(RecordStore.shouldPersistRecord({ allowHistory: false, retentionHint: 'session_only' }), false);
  assert.strictEqual(RecordStore.shouldPersistRecord({ allowHistory: true, retentionHint: 'persistent' }), true);
}

function testShouldPersistCancelledSessionOnlyRecord() {
  assert.strictEqual(RecordStore.shouldPersistRecord({ status: 'cancelled', allowHistory: false, retentionHint: 'session_only' }), false);
}

function testNormalizeErrorPreservesDiagnostics() {
  const diagnostics = { runId: 'run_cancelled_1', durationMs: 1234 };
  const normalized = Errors.normalizeError({
    code: Errors.ERROR_CODES.RUN_CANCELLED,
    message: '\u672c\u6b21\u751f\u6210\u5df2\u53d6\u6d88\u3002',
    diagnostics,
    provider: 'openai'
  });

  assert.deepStrictEqual(normalized.diagnostics, diagnostics);
  assert.strictEqual(normalized.provider, 'openai');
}

function testRunUtilsForCancelledRecord() {
  const diagnostics = {
    runId: 'run_cancelled_2',
    provider: 'anthropic',
    adapterId: 'anthropic_messages',
    endpointMode: 'messages',
    model: 'claude-3-7-sonnet',
    retryCount: 2,
    durationMs: 3456
  };

  const terminalRun = RunUtils.pickTerminalRun(null, { diagnostics });
  assert.deepStrictEqual(terminalRun, diagnostics);

  const patch = RunUtils.buildTerminalRecordPatch({
    provider: 'openai',
    model: 'gpt-4o-mini',
    endpointMode: 'responses'
  }, diagnostics, 'cancelled', {
    errorCode: Errors.ERROR_CODES.RUN_CANCELLED,
    errorMessage: '\u672c\u6b21\u751f\u6210\u5df2\u53d6\u6d88\u3002'
  });

  assert.strictEqual(patch.status, 'cancelled');
  assert.strictEqual(patch.finishReason, 'cancelled');
  assert.strictEqual(patch.provider, 'anthropic');
  assert.strictEqual(patch.adapterId, 'anthropic_messages');
  assert.strictEqual(patch.endpointMode, 'messages');
  assert.strictEqual(patch.model, 'claude-3-7-sonnet');
  assert.strictEqual(patch.retryCount, 2);
  assert.strictEqual(patch.durationMs, 3456);
  assert.deepStrictEqual(patch.diagnostics, diagnostics);
}

function testRunUtilsDescribeCancellation() {
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
  assert.ok(cancellation.partial.includes('\u672a\u4fdd\u7559'));
}

function testRunUtilsBuildDiagnosticsSummary() {
  const diagnostics = {
    article: {
      chunkCount: 4,
      sourceHost: 'docs.example.com',
      sourceStrategyLabel: '\u6587\u6863\u7cbe\u8bfb'
    },
    provider: 'anthropic',
    model: 'claude-3-7-sonnet',
    endpointMode: 'messages',
    adapterId: 'anthropic_messages',
    retryCount: 2,
    durationMs: 3456,
    runId: 'run_cancelled_4',
    chunkRuns: [{ runId: 'chunk_1' }, { runId: 'chunk_2' }, { runId: 'chunk_3' }],
    finalRun: {
      runId: 'run_cancelled_4',
      stage: 'secondary',
      status: 'cancelled',
      chunkCount: 4
    },
    error: {
      code: Errors.ERROR_CODES.RUN_CANCELLED,
      message: '\u672c\u6b21\u751f\u6210\u5df2\u53d6\u6d88\u3002'
    }
  };

  const summary = RunUtils.buildDiagnosticsSummary(diagnostics, {
    hasPartialContent: true,
    secondaryModeLabel: '\u95ee\u7b54\u5361\u7247'
  });

  assert.ok(summary.includes('\u72b6\u6001: \u5df2\u53d6\u6d88'));
  assert.ok(summary.includes('\u9636\u6bb5: \u95ee\u7b54\u5361\u7247 \u751f\u6210'));
  assert.ok(summary.includes('\u5185\u5bb9: \u5df2\u4fdd\u7559\u5f53\u524d\u5df2\u751f\u6210\u5185\u5bb9'));
  assert.ok(summary.includes('\u6a21\u578b: anthropic / claude-3-7-sonnet'));
  assert.ok(summary.includes('\u63a5\u53e3: messages / anthropic_messages'));
  assert.ok(summary.includes('\u9519\u8bef: RUN_CANCELLED'));
}

function createSiteFixtureRecords() {
  return [
    {
      recordId: 'rec_docs_1',
      sourceHost: 'docs.example.com',
      favorite: true,
      updatedAt: '2026-03-25T10:00:00.000Z',
      articleSnapshot: { sourceType: 'doc' }
    },
    {
      recordId: 'rec_news_1',
      sourceHost: 'news.example.com',
      favorite: false,
      updatedAt: '2026-03-25T11:00:00.000Z',
      articleSnapshot: { sourceType: 'news' }
    },
    {
      recordId: 'rec_docs_2',
      sourceHost: 'docs.example.com',
      favorite: false,
      updatedAt: '2026-03-25T12:00:00.000Z',
      articleSnapshot: { sourceType: 'doc' }
    },
    {
      recordId: 'rec_forum_1',
      sourceHost: '',
      favorite: false,
      updatedAt: '2026-03-24T09:00:00.000Z',
      articleSnapshot: { sourceHost: 'forum.example.com', sourceType: 'forum' }
    }
  ];
}

function testBuildSiteBuckets() {
  const buckets = RecordStore.buildSiteBuckets(createSiteFixtureRecords());
  assert.strictEqual(buckets.length, 3);
  assert.strictEqual(buckets[0].host, 'docs.example.com');
  assert.strictEqual(buckets[0].count, 2);
  assert.strictEqual(buckets[0].favoriteCount, 1);
  assert.deepStrictEqual(buckets[0].sourceTypes, ['doc']);
  assert.strictEqual(buckets[1].host, 'news.example.com');
  assert.strictEqual(buckets[2].host, 'forum.example.com');
}

function testFilterRecordsBySite() {
  const records = createSiteFixtureRecords();
  const filtered = RecordStore.filterRecordsBySite(records, 'docs.example.com');
  const allRecords = RecordStore.filterRecordsBySite(records, '');

  assert.strictEqual(filtered.length, 2);
  assert.ok(filtered.every((record) => RecordStore.getRecordSiteHost(record) === 'docs.example.com'));
  assert.strictEqual(allRecords.length, records.length);
  assert.notStrictEqual(allRecords, records);
}

function testGroupRecordsBySite() {
  const groups = RecordStore.groupRecordsBySite(createSiteFixtureRecords());
  assert.strictEqual(groups.length, 3);
  assert.strictEqual(groups[0].host, 'docs.example.com');
  assert.strictEqual(groups[0].records.length, 2);
  assert.strictEqual(groups[0].records[0].recordId, 'rec_docs_1');
  assert.strictEqual(groups[1].host, 'news.example.com');
  assert.strictEqual(groups[2].host, 'forum.example.com');
}

function testOpenAIAdapterResolve() {
  const defaultResolved = OpenAIAdapter.resolve({ aiProvider: 'openai' });
  assert.strictEqual(defaultResolved.endpointMode, 'responses');
  assert.strictEqual(defaultResolved.baseUrl, 'https://api.openai.com/v1/responses');

  const chatResolved = OpenAIAdapter.resolve({ aiProvider: 'openai', aiBaseURL: 'https://api.example.com/v1/chat/completions' });
  assert.strictEqual(chatResolved.endpointMode, 'chat_completions');
  assert.strictEqual(chatResolved.baseUrl, 'https://api.example.com/v1/chat/completions');

  const deepseekResolved = OpenAIAdapter.resolve({
    providerPreset: 'deepseek',
    aiProvider: 'openai',
    endpointMode: 'chat_completions',
    aiBaseURL: 'https://api.deepseek.com'
  });
  assert.strictEqual(deepseekResolved.baseUrl, 'https://api.deepseek.com/chat/completions');

  const geminiResolved = OpenAIAdapter.resolve({
    providerPreset: 'gemini',
    aiProvider: 'openai',
    aiBaseURL: 'https://generativelanguage.googleapis.com/v1beta/openai'
  });
  assert.strictEqual(geminiResolved.endpointMode, 'chat_completions');
  assert.strictEqual(geminiResolved.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');

  const qwenResolved = OpenAIAdapter.resolve({
    providerPreset: 'qwen',
    aiProvider: 'openai',
    endpointMode: 'chat_completions',
    aiBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  });
  assert.strictEqual(qwenResolved.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');

  const glmResolved = OpenAIAdapter.resolve({
    providerPreset: 'glm',
    aiProvider: 'openai',
    aiBaseURL: 'https://open.bigmodel.cn/api/paas/v4'
  });
  assert.strictEqual(glmResolved.baseUrl, 'https://open.bigmodel.cn/api/paas/v4/chat/completions');

  const doubaoResponsesResolved = OpenAIAdapter.resolve({
    providerPreset: 'doubao',
    aiProvider: 'openai',
    endpointMode: 'responses',
    aiBaseURL: 'https://ark.cn-beijing.volces.com/api/v3'
  });
  assert.strictEqual(doubaoResponsesResolved.baseUrl, 'https://ark.cn-beijing.volces.com/api/v3/responses');

  const xaiResolved = OpenAIAdapter.resolve({
    providerPreset: 'xai',
    aiProvider: 'openai',
    aiBaseURL: 'https://api.x.ai/v1'
  });
  assert.strictEqual(xaiResolved.endpointMode, 'responses');
  assert.strictEqual(xaiResolved.baseUrl, 'https://api.x.ai/v1/responses');

  const delta = OpenAIAdapter.extractDelta({ type: 'response.output_text.delta', delta: 'hello' }, defaultResolved, 'message');
  assert.strictEqual(delta, 'hello');

  const text = OpenAIAdapter.extractText({ output_text: 'world' }, defaultResolved);
  assert.strictEqual(text, 'world');
}

function testAnthropicAdapter() {
  const resolved = AnthropicAdapter.resolve({ aiProvider: 'anthropic' });
  assert.strictEqual(resolved.endpointMode, 'messages');
  assert.strictEqual(resolved.baseUrl, 'https://api.anthropic.com/v1/messages');

  const officialHeaders = AnthropicAdapter.buildHeaders({ apiKey: 'test-key' }, resolved, true);
  assert.strictEqual(officialHeaders['anthropic-version'], '2023-06-01');

  const qwenResolved = AnthropicAdapter.resolve({
    providerPreset: 'qwen',
    aiProvider: 'anthropic',
    endpointMode: 'messages',
    aiBaseURL: 'https://dashscope.aliyuncs.com/apps/anthropic'
  });
  assert.strictEqual(qwenResolved.baseUrl, 'https://dashscope.aliyuncs.com/apps/anthropic/v1/messages');
  const qwenHeaders = AnthropicAdapter.buildHeaders({ apiKey: 'test-key' }, qwenResolved, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(qwenHeaders, 'anthropic-version'));

  const hunyuanResolved = AnthropicAdapter.resolve({
    providerPreset: 'hunyuan',
    aiProvider: 'anthropic',
    aiBaseURL: 'https://api.hunyuan.cloud.tencent.com/anthropic'
  });
  assert.strictEqual(hunyuanResolved.baseUrl, 'https://api.hunyuan.cloud.tencent.com/anthropic/v1/messages');

  const delta = AnthropicAdapter.extractDelta({ type: 'content_block_delta', delta: { text: 'hello' } }, resolved);
  assert.strictEqual(delta, 'hello');

  const text = AnthropicAdapter.extractText({ content: [{ type: 'text', text: 'world' }] }, resolved);
  assert.strictEqual(text, 'world');
}

function testProviderPresetsInference() {
  assert.strictEqual(
    ProviderPresets.inferPresetFromSettings({
      aiProvider: 'openai',
      aiBaseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      modelName: 'gemini-2.5-flash'
    }),
    'gemini'
  );

  assert.strictEqual(
    ProviderPresets.inferPresetFromSettings({
      aiProvider: 'openai',
      aiBaseURL: 'https://api.x.ai/v1',
      modelName: 'grok-4-1-fast-reasoning'
    }),
    'xai'
  );
}

function testAdapterRegistry() {
  const openai = AdapterRegistry.resolve({ aiProvider: 'openai' });
  assert.strictEqual(openai.snapshot.provider, 'openai');

  const anthropic = AdapterRegistry.resolve({ aiProvider: 'anthropic' });
  assert.strictEqual(anthropic.snapshot.provider, 'anthropic');
}

async function testAbortUtilsRaceWithAbort() {
  const controller = new AbortController();
  const promise = AbortUtils.raceWithAbort(new Promise((resolve) => setTimeout(() => resolve('late'), 50)), controller.signal);
  controller.abort('user_cancelled');
  await assert.rejects(promise, (error) => error?.name === 'AbortError');
}

async function testAbortUtilsWaitWithAbort() {
  const controller = new AbortController();
  const promise = AbortUtils.waitWithAbort(100, controller.signal);
  setTimeout(() => controller.abort('user_cancelled'), 10);
  await assert.rejects(promise, (error) => error?.name === 'AbortError');
}
async function run() {
  testNormalizeUrl();
  testDetectSiteType();
  testResolvePageStrategy();
  testSplitTextIntoChunks();
  testBuildArticleSnapshot();
  testPromptBuilders();
  testTrustPolicy();
  testShouldPersistRecord();
  testShouldPersistCancelledSessionOnlyRecord();
  testNormalizeErrorPreservesDiagnostics();
  testRunUtilsForCancelledRecord();
  testRunUtilsDescribeCancellation();
  testRunUtilsBuildDiagnosticsSummary();
  testBuildSiteBuckets();
  testFilterRecordsBySite();
  testGroupRecordsBySite();
  testOpenAIAdapterResolve();
  testAnthropicAdapter();
  testProviderPresetsInference();
  testAdapterRegistry();
  await testAbortUtilsRaceWithAbort();
  await testAbortUtilsWaitWithAbort();
  console.log('All tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});



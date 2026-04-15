const { performance } = require('perf_hooks');
const { test, assert, freshRequire } = require('./harness');
const { createFakeIndexedDB } = require('./fake-indexeddb');

const Domain = freshRequire('shared/domain.js');
global.AISummaryDomain = Domain;
global.indexedDB = createFakeIndexedDB();

const RecordStore = freshRequire('db.js');

function readBudgetMs(envName, fallbackMs) {
  const value = Number(process.env[envName]);
  return Number.isFinite(value) && value > 0 ? value : fallbackMs;
}

const PERF_BUDGETS_MS = Object.freeze({
  historyHelpers10k: readBudgetMs('YILAN_PERF_BUDGET_HISTORY_HELPERS_10K_MS', 1200),
  indexedDbSearch1k: readBudgetMs('YILAN_PERF_BUDGET_INDEXEDDB_SEARCH_1K_MS', 3000)
});

function createArticle(overrides) {
  return Object.assign({
    articleId: 'art_1',
    normalizedUrl: 'https://example.com/post',
    sourceUrl: 'https://example.com/post?utm_source=x',
    sourceHost: 'example.com',
    title: 'Example title',
    cleanText: 'Clean source text',
    contentHash: 'hash_1',
    allowHistory: true,
    allowShare: true
  }, overrides || {});
}

function createRecord(overrides) {
  const article = createArticle(overrides?.articleSnapshot);
  return Object.assign({
    recordId: overrides?.recordId || Domain.createRuntimeId('sum'),
    articleId: article.articleId,
    sourceUrl: article.sourceUrl,
    normalizedUrl: article.normalizedUrl,
    sourceHost: article.sourceHost,
    titleSnapshot: article.title,
    contentHash: article.contentHash,
    articleSnapshot: article,
    summaryMode: 'medium',
    targetLanguage: 'auto',
    promptProfile: 'primary',
    provider: 'openai',
    model: 'gpt-4o-mini',
    endpointMode: 'responses',
    allowHistory: true,
    allowShare: true,
    retentionHint: 'persistent',
    status: 'completed',
    completedAt: '2026-04-15T00:00:00.000Z',
    summaryMarkdown: '## Summary\n- One **point** with [link](https://example.com).',
    favorite: false,
    tags: ['alpha'],
    notes: 'note text'
  }, overrides || {});
}

function createLargeHistoryRecords(count) {
  const records = [];

  for (let index = 0; index < count; index += 1) {
    const hostIndex = index % 200;
    const sourceType = ['doc', 'news', 'forum', 'blog'][index % 4];
    const host = `site-${String(hostIndex).padStart(3, '0')}.example.com`;
    const url = `https://${host}/articles/${index}`;
    const isNeedle = index % 137 === 0;
    const article = createArticle({
      articleId: `art_perf_${index}`,
      normalizedUrl: url,
      sourceUrl: url,
      sourceHost: host,
      title: `Performance article ${index}`,
      cleanText: `Clean text ${index}`,
      contentHash: `hash_perf_${index}`,
      sourceType,
      sourceStrategyId: `strategy_${sourceType}`,
      sourceStrategy: { label: `Strategy ${sourceType}` }
    });

    records.push(createRecord({
      recordId: `rec_perf_${index}`,
      articleId: article.articleId,
      normalizedUrl: article.normalizedUrl,
      sourceUrl: article.sourceUrl,
      sourceHost: host,
      titleSnapshot: `${article.title}${isNeedle ? ' needle-token' : ''}`,
      contentHash: article.contentHash,
      articleSnapshot: article,
      completedAt: new Date(Date.UTC(2026, 3, 15, 0, 0, index % 60)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 3, 15, 0, index % 60, index % 60)).toISOString(),
      summaryMarkdown: `## Summary ${index}\n- ${isNeedle ? 'needle-token' : 'ordinary'} history item for ${host}.`,
      summaryPlainText: `Summary ${index} ${isNeedle ? 'needle-token' : 'ordinary'} history item for ${host}.`,
      favorite: index % 10 === 0,
      tags: [`tag-${index % 12}`],
      notes: `note ${index}`
    }));
  }

  return records;
}

function assertWithinBudget(label, elapsedMs, budgetMs) {
  assert.ok(
    elapsedMs <= budgetMs,
    `${label} exceeded performance budget: ${elapsedMs.toFixed(1)}ms > ${budgetMs}ms`
  );
}

test('record store pure helpers normalize markdown, dedupe keys, persistence, sites, and reuse scoring', [
  'history.storage',
  'history.site_filters',
  'history.reuse_current_page'
], () => {
  assert.strictEqual(
    RecordStore.markdownToPlainText('## Title\n- A **bold** [link](https://x.test)\n```js\nhidden\n```'),
    'Title A **bold** link'
  );

  const record = createRecord({ recordId: 'rec_1' });
  assert.ok(RecordStore.buildDedupeKey(record).startsWith('dedupe_'));
  assert.strictEqual(RecordStore.getRecordSiteHost({ sourceHost: 'docs.example.com' }), 'docs.example.com');
  assert.strictEqual(RecordStore.getRecordSiteHost({ articleSnapshot: { sourceHost: 'fallback.example.com' } }), 'fallback.example.com');
  assert.strictEqual(RecordStore.getRecordSiteHost({}), '\u672a\u77e5\u6765\u6e90');
  assert.strictEqual(RecordStore.shouldPersistRecord({ allowHistory: false, retentionHint: 'persistent' }), false);
  assert.strictEqual(RecordStore.shouldPersistRecord({ allowHistory: true, retentionHint: 'session_only' }), false);
  assert.strictEqual(RecordStore.shouldPersistRecord({ allowHistory: true, retentionHint: 'persistent' }), true);
  assert.strictEqual(RecordStore.isReusablePrimaryRecord(createRecord({ status: 'completed', promptProfile: 'primary' })), true);
  assert.strictEqual(RecordStore.isReusablePrimaryRecord(createRecord({ status: 'failed' })), false);
  assert.strictEqual(RecordStore.isReusablePrimaryRecord(createRecord({ promptProfile: 'secondary' })), false);

  const article = createArticle();
  assert.deepStrictEqual(RecordStore.getReusableRecordMatch(record, article), { score: 3, matchType: 'articleId' });
  assert.deepStrictEqual(
    RecordStore.getReusableRecordMatch(Object.assign({}, record, { articleId: 'other' }), article),
    { score: 2, matchType: 'normalizedUrl' }
  );
  assert.deepStrictEqual(
    RecordStore.getReusableRecordMatch(Object.assign({}, record, {
      articleId: 'other',
      normalizedUrl: 'https://other.example.com/post',
      sourceUrl: 'https://example.com/post'
    }), article),
    { score: 1, matchType: 'sourceUrl' }
  );
});

test('record store site buckets, filters, and grouping support history panels', [
  'history.search',
  'history.site_filters'
], () => {
  const records = [
    createRecord({ recordId: 'docs_1', sourceHost: 'docs.example.com', favorite: true, updatedAt: '2026-04-15T01:00:00.000Z', articleSnapshot: { sourceType: 'doc' } }),
    createRecord({ recordId: 'news_1', sourceHost: 'news.example.com', favorite: false, updatedAt: '2026-04-15T02:00:00.000Z', articleSnapshot: { sourceType: 'news' } }),
    createRecord({ recordId: 'docs_2', sourceHost: 'docs.example.com', favorite: false, updatedAt: '2026-04-15T03:00:00.000Z', articleSnapshot: { sourceType: 'doc' } }),
    createRecord({ recordId: 'forum_1', sourceHost: '', favorite: false, updatedAt: '2026-04-14T01:00:00.000Z', articleSnapshot: { sourceHost: 'forum.example.com', sourceType: 'forum' } })
  ];

  const buckets = RecordStore.buildSiteBuckets(records);
  assert.strictEqual(buckets.length, 3);
  assert.strictEqual(buckets[0].host, 'docs.example.com');
  assert.strictEqual(buckets[0].count, 2);
  assert.strictEqual(buckets[0].favoriteCount, 1);
  assert.deepStrictEqual(buckets[0].sourceTypes, ['doc']);
  assert.strictEqual(buckets[2].host, 'forum.example.com');

  const filtered = RecordStore.filterRecordsBySite(records, 'docs.example.com');
  assert.strictEqual(filtered.length, 2);
  assert.notStrictEqual(RecordStore.filterRecordsBySite(records, ''), records);

  const groups = RecordStore.groupRecordsBySite(records);
  assert.strictEqual(groups[0].host, 'docs.example.com');
  assert.strictEqual(groups[0].records.length, 2);
  assert.strictEqual(groups[1].host, 'news.example.com');
});

test('record store large history helpers stay within baseline budget', [
  'history.search',
  'history.site_filters',
  'quality.performance_baseline'
], () => {
  const records = createLargeHistoryRecords(10000);
  const targetHost = 'site-042.example.com';

  const startedAt = performance.now();
  const buckets = RecordStore.buildSiteBuckets(records);
  const filtered = RecordStore.filterRecordsBySite(records, targetHost);
  const groups = RecordStore.groupRecordsBySite(records);
  const elapsedMs = performance.now() - startedAt;

  assert.strictEqual(buckets.length, 200);
  assert.strictEqual(filtered.length, 50);
  assert.ok(filtered.every((record) => RecordStore.getRecordSiteHost(record) === targetHost));
  assert.strictEqual(groups.length, buckets.length);
  assert.strictEqual(groups.reduce((total, group) => total + group.records.length, 0), records.length);
  assertWithinBudget('10k history helper operations', elapsedMs, PERF_BUDGETS_MS.historyHelpers10k);
});

test('record store migrates legacy records into structured records', 'history.storage', () => {
  const migrated = RecordStore.migrateLegacyRecord({
    url: 'https://example.com/legacy?utm_source=x',
    title: 'Legacy',
    summary: 'Legacy summary',
    timestamp: Date.parse('2026-04-01T00:00:00.000Z')
  });

  assert.ok(migrated.recordId.startsWith('sum_'));
  assert.ok(migrated.articleId.startsWith('art_'));
  assert.strictEqual(migrated.normalizedUrl, 'https://example.com/legacy');
  assert.strictEqual(migrated.adapterId, 'legacy_import');
  assert.strictEqual(migrated.articleSnapshot.extractor, 'legacy_import');
  assert.deepStrictEqual(migrated.articleSnapshot.warnings, ['legacy_import']);
});

test('record store IndexedDB API saves, dedupes, searches, favorites, updates, deletes, clears, and reuses', [
  'history.storage',
  'history.search',
  'history.favorite_delete',
  'history.reuse_current_page'
], async () => {
  await RecordStore.clearAll();

  const first = await RecordStore.saveRecord(createRecord({
    recordId: 'rec_first',
    titleSnapshot: 'First title',
    summaryMarkdown: '## First\n- Alpha content',
    completedAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z'
  }));
  assert.strictEqual(first.titleSnapshot, 'First title');
  assert.strictEqual(first.summaryPlainText, 'First Alpha content');
  assert.deepStrictEqual(first.tags, ['alpha']);

  const deduped = await RecordStore.saveRecord(createRecord({
    recordId: 'rec_second',
    titleSnapshot: 'Updated same logical record',
    summaryMarkdown: '## Updated',
    favorite: true
  }));
  assert.strictEqual(deduped.recordId, first.recordId);
  assert.strictEqual(deduped.titleSnapshot, 'Updated same logical record');
  assert.strictEqual(deduped.favorite, true);

  await RecordStore.saveRecord(createRecord({
    recordId: 'rec_other',
    articleId: 'art_other',
    normalizedUrl: 'https://news.example.com/item',
    sourceUrl: 'https://news.example.com/item',
    sourceHost: 'news.example.com',
    titleSnapshot: 'News item',
    summaryMarkdown: '## News',
    summaryMode: 'short',
    articleSnapshot: createArticle({
      articleId: 'art_other',
      normalizedUrl: 'https://news.example.com/item',
      sourceUrl: 'https://news.example.com/item',
      sourceHost: 'news.example.com',
      sourceType: 'news'
    })
  }));

  const all = await RecordStore.getAll();
  assert.strictEqual(all.length, 2);
  assert.ok(all[0].updatedAt >= all[1].updatedAt);

  const favorites = await RecordStore.getAll({ favoritesOnly: true });
  assert.strictEqual(favorites.length, 1);
  assert.strictEqual(favorites[0].favorite, true);

  assert.strictEqual((await RecordStore.searchRecords('updated')).length, 1);
  assert.strictEqual((await RecordStore.searchRecords('news')).length, 1);
  assert.strictEqual((await RecordStore.searchRecords('', { favoritesOnly: true })).length, 1);

  const toggled = await RecordStore.toggleFavorite(first.recordId);
  assert.strictEqual(toggled.favorite, false);
  assert.strictEqual(await RecordStore.toggleFavorite('missing'), null);

  const patched = await RecordStore.updateRecord(first.recordId, { notes: 'patched note' });
  assert.strictEqual(patched.notes, 'patched note');
  assert.strictEqual(await RecordStore.updateRecord('missing', { notes: 'x' }), null);

  const reusable = await RecordStore.findReusableRecordForArticle(createArticle());
  assert.strictEqual(reusable.record.recordId, first.recordId);
  assert.strictEqual(reusable.matchType, 'articleId');
  assert.strictEqual(reusable.exact, true);

  await RecordStore.deleteRecord(first.recordId);
  assert.strictEqual((await RecordStore.getRecordById(first.recordId)), undefined);

  await RecordStore.clearAll();
  assert.deepStrictEqual(await RecordStore.getAll(), []);
});

test('record store IndexedDB search stays within baseline budget for 1k records', [
  'history.storage',
  'history.search',
  'history.favorite_delete',
  'quality.performance_baseline'
], async () => {
  await RecordStore.clearAll();

  try {
    const records = createLargeHistoryRecords(1000);
    await Promise.all(records.map((record) => RecordStore.saveRecord(record)));
    assert.strictEqual((await RecordStore.getAll()).length, records.length);

    const startedAt = performance.now();
    const needleResults = await RecordStore.searchRecords('needle-token');
    const favoriteResults = await RecordStore.searchRecords('', { favoritesOnly: true });
    const siteResults = await RecordStore.searchRecords('site-042.example.com');
    const elapsedMs = performance.now() - startedAt;

    assert.strictEqual(needleResults.length, 8);
    assert.strictEqual(favoriteResults.length, 100);
    assert.strictEqual(siteResults.length, 5);
    assertWithinBudget('1k IndexedDB history searches', elapsedMs, PERF_BUDGETS_MS.indexedDbSearch1k);
  } finally {
    await RecordStore.clearAll();
  }
});

test('session-only records are normalized but not persisted', [
  'history.storage',
  'privacy.policy'
], async () => {
  await RecordStore.clearAll();
  const transient = await RecordStore.saveRecord(createRecord({
    recordId: 'rec_transient',
    allowHistory: false,
    retentionHint: 'session_only',
    favorite: true,
    tags: ['private'],
    notes: 'private'
  }));

  assert.strictEqual(transient.allowHistory, false);
  assert.strictEqual(transient.favorite, false);
  assert.deepStrictEqual(transient.tags, []);
  assert.strictEqual(transient.notes, '');
  assert.deepStrictEqual(await RecordStore.getAll(), []);
});

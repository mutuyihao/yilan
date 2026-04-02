(function (global) {
  const Domain = global.AISummaryDomain || (typeof require === 'function' ? require('./shared/domain.js') : null);

  const DB_NAME = 'aiSummaryDB';
  const DB_VERSION = 2;
  const LEGACY_STORE = 'history';
  const RECORD_STORE = 'summaryRecords';

  function toPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function markdownToPlainText(markdown) {
    return String(markdown || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^[>#\-*+\d.\s]+/gm, '')
      .replace(/\n{2,}/g, '\n')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildDedupeKey(record) {
    const seed = [
      record.articleId || record.normalizedUrl || record.sourceUrl || '',
      record.summaryMode || 'medium',
      record.targetLanguage || 'auto',
      record.promptProfile || 'primary',
      record.parentRecordId || '',
      record.originSummaryHash || ''
    ].join('|');

    return Domain.createDeterministicId('dedupe', seed);
  }

  function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function getRecordSiteHost(record) {
    return String(record?.sourceHost || record?.articleSnapshot?.sourceHost || '').trim() || '未知来源';
  }

  function shouldPersistRecord(record) {
    const allowHistory = record?.allowHistory !== false;
    const retentionHint = String(record?.retentionHint || '').toLowerCase();

    if (!allowHistory) return false;
    if (retentionHint === 'session_only' || retentionHint === 'none') return false;
    return true;
  }

  function buildSiteBuckets(records) {
    const groups = new Map();

    (records || []).forEach((record) => {
      const host = getRecordSiteHost(record);
      const existing = groups.get(host) || {
        host,
        count: 0,
        favoriteCount: 0,
        latestUpdatedAt: '',
        sourceTypes: new Set()
      };

      existing.count += 1;
      if (record?.favorite) existing.favoriteCount += 1;
      const updatedAt = String(record?.updatedAt || record?.createdAt || '');
      if (!existing.latestUpdatedAt || updatedAt > existing.latestUpdatedAt) {
        existing.latestUpdatedAt = updatedAt;
      }
      const sourceType = String(record?.articleSnapshot?.sourceType || 'unknown');
      if (sourceType) existing.sourceTypes.add(sourceType);
      groups.set(host, existing);
    });

    return Array.from(groups.values())
      .map((bucket) => ({
        host: bucket.host,
        count: bucket.count,
        favoriteCount: bucket.favoriteCount,
        latestUpdatedAt: bucket.latestUpdatedAt,
        sourceTypes: Array.from(bucket.sourceTypes)
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        if (b.latestUpdatedAt !== a.latestUpdatedAt) return String(b.latestUpdatedAt).localeCompare(String(a.latestUpdatedAt));
        return String(a.host).localeCompare(String(b.host));
      });
  }

  function filterRecordsBySite(records, selectedSiteHost) {
    const siteHost = String(selectedSiteHost || '').trim();
    if (!siteHost) return Array.isArray(records) ? records.slice() : [];
    return (records || []).filter((record) => getRecordSiteHost(record) === siteHost);
  }

  function groupRecordsBySite(records) {
    const buckets = buildSiteBuckets(records);
    return buckets.map((bucket) => ({
      host: bucket.host,
      count: bucket.count,
      favoriteCount: bucket.favoriteCount,
      latestUpdatedAt: bucket.latestUpdatedAt,
      sourceTypes: bucket.sourceTypes,
      records: filterRecordsBySite(records, bucket.host)
    }));
  }

  function normalizeRecord(input, existing) {
    const now = new Date().toISOString();
    const base = Object.assign({}, existing || {}, input || {});
    const summaryMarkdown = String(base.summaryMarkdown || base.summary || '');
    const sourceUrl = String(base.sourceUrl || base.url || '');
    const normalizedUrl = base.normalizedUrl || Domain.normalizeUrl(sourceUrl);
    const titleSnapshot = base.titleSnapshot || base.title || '未命名页面';
    const contentHash = base.contentHash || Domain.hashString(base.articleSnapshot?.cleanText || summaryMarkdown || titleSnapshot);
    const articleId = base.articleId || Domain.createDeterministicId('art', (normalizedUrl || sourceUrl || titleSnapshot) + '|' + contentHash);
    const recordId = existing?.recordId || base.recordId || Domain.createRuntimeId('sum');
    const allowHistory = typeof base.allowHistory === 'boolean' ? base.allowHistory : base.articleSnapshot?.allowHistory !== false;
    const allowShare = typeof base.allowShare === 'boolean' ? base.allowShare : base.articleSnapshot?.allowShare !== false;
    const retentionHint = base.retentionHint || base.articleSnapshot?.retentionHint || (allowHistory ? 'persistent' : 'session_only');

    const record = {
      recordId,
      articleId,
      parentRecordId: base.parentRecordId || '',
      runId: base.runId || Domain.createRuntimeId('run'),
      createdAt: existing?.createdAt || base.createdAt || now,
      updatedAt: now,
      sourceUrl,
      normalizedUrl,
      sourceHost: base.sourceHost || Domain.getSourceHost(normalizedUrl || sourceUrl),
      titleSnapshot,
      languageSnapshot: base.languageSnapshot || base.articleSnapshot?.language || '',
      contentHash,
      articleSnapshotRef: base.articleSnapshotRef || '',
      articleSnapshot: base.articleSnapshot || existing?.articleSnapshot || null,
      summaryMode: base.summaryMode || 'medium',
      targetLanguage: base.targetLanguage || 'auto',
      promptProfile: base.promptProfile || 'primary',
      customPromptUsed: !!base.customPromptUsed,
      promptVersion: base.promptVersion || '2026-03-25',
      adapterId: base.adapterId || '',
      provider: base.provider || '',
      model: base.model || '',
      endpointMode: base.endpointMode || '',
      requestOptionsSnapshot: base.requestOptionsSnapshot || null,
      privacyMode: !!base.privacyMode,
      allowHistory,
      allowShare,
      retentionHint,
      status: base.status || 'completed',
      startedAt: base.startedAt || now,
      completedAt: base.completedAt || '',
      durationMs: typeof base.durationMs === 'number' ? base.durationMs : 0,
      retryCount: typeof base.retryCount === 'number' ? base.retryCount : 0,
      errorCode: base.errorCode || '',
      errorMessage: base.errorMessage || '',
      finishReason: base.finishReason || '',
      summaryMarkdown,
      summaryPlainText: base.summaryPlainText || markdownToPlainText(summaryMarkdown),
      summaryTitle: base.summaryTitle || titleSnapshot,
      bullets: normalizeArray(base.bullets),
      usage: base.usage || null,
      shareCardTitle: base.shareCardTitle || titleSnapshot,
      shareCardSubtitle: base.shareCardSubtitle || '',
      shareSourceUrl: base.shareSourceUrl || normalizedUrl || sourceUrl,
      exportVariants: normalizeArray(base.exportVariants).length ? normalizeArray(base.exportVariants) : ['markdown', 'image'],
      pinned: allowHistory ? !!base.pinned : false,
      favorite: allowHistory ? (typeof base.favorite === 'boolean' ? base.favorite : !!existing?.favorite) : false,
      tags: allowHistory ? normalizeArray(base.tags) : [],
      notes: allowHistory ? (base.notes || '') : '',
      lastViewedAt: base.lastViewedAt || now,
      diagnostics: base.diagnostics || existing?.diagnostics || null,
      originSummaryHash: base.originSummaryHash || '',
      dedupeKey: base.dedupeKey || ''
    };

    record.dedupeKey = record.dedupeKey || buildDedupeKey(record);
    return record;
  }

  function migrateLegacyRecord(item) {
    const timestamp = item?.timestamp || Date.now();
    const iso = new Date(timestamp).toISOString();
    const sourceUrl = String(item?.url || '');
    const normalizedUrl = Domain.normalizeUrl(sourceUrl);
    const summaryMarkdown = String(item?.summary || '');
    const contentHash = Domain.hashString(summaryMarkdown || item?.title || sourceUrl || String(timestamp));
    const articleId = Domain.createDeterministicId('art', (normalizedUrl || sourceUrl || item?.title || 'legacy') + '|' + contentHash);

    return normalizeRecord({
      recordId: Domain.createDeterministicId('sum', String(timestamp) + '|' + contentHash),
      articleId,
      runId: Domain.createDeterministicId('run', 'legacy|' + timestamp),
      createdAt: iso,
      updatedAt: iso,
      sourceUrl,
      normalizedUrl,
      sourceHost: Domain.getSourceHost(normalizedUrl || sourceUrl),
      titleSnapshot: item?.title || '未命名页面',
      contentHash,
      summaryMode: 'medium',
      targetLanguage: 'auto',
      promptProfile: 'legacy',
      customPromptUsed: false,
      promptVersion: 'legacy',
      adapterId: 'legacy_import',
      provider: 'legacy',
      model: '',
      endpointMode: '',
      privacyMode: false,
      allowHistory: true,
      allowShare: true,
      retentionHint: 'persistent',
      status: 'completed',
      startedAt: iso,
      completedAt: iso,
      durationMs: 0,
      retryCount: 0,
      finishReason: 'legacy_import',
      summaryMarkdown,
      summaryTitle: item?.title || '未命名页面',
      shareCardTitle: item?.title || '未命名页面',
      shareCardSubtitle: '历史迁移记录',
      shareSourceUrl: normalizedUrl || sourceUrl,
      articleSnapshot: {
        articleId,
        sourceUrl,
        normalizedUrl,
        sourceHost: Domain.getSourceHost(normalizedUrl || sourceUrl),
        title: item?.title || '未命名页面',
        language: '',
        cleanText: '',
        contentHash,
        extractor: 'legacy_import',
        contentLength: 0,
        isTruncated: false,
        warnings: ['legacy_import'],
        allowHistory: true,
        allowShare: true,
        retentionHint: 'persistent'
      }
    });
  }

  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const transaction = event.target.transaction;

        let recordStore = null;
        if (!db.objectStoreNames.contains(RECORD_STORE)) {
          recordStore = db.createObjectStore(RECORD_STORE, { keyPath: 'recordId' });
          recordStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          recordStore.createIndex('dedupeKey', 'dedupeKey', { unique: false });
          recordStore.createIndex('favorite', 'favorite', { unique: false });
          recordStore.createIndex('normalizedUrl', 'normalizedUrl', { unique: false });
          recordStore.createIndex('status', 'status', { unique: false });
        } else {
          recordStore = transaction.objectStore(RECORD_STORE);
        }

        if (db.objectStoreNames.contains(LEGACY_STORE)) {
          const legacyStore = transaction.objectStore(LEGACY_STORE);
          legacyStore.openCursor().onsuccess = (cursorEvent) => {
            const cursor = cursorEvent.target.result;
            if (!cursor) return;
            const migrated = migrateLegacyRecord(cursor.value);
            recordStore.put(migrated);
            cursor.continue();
          };
        }
      };
    });
  }

  async function getStore(mode) {
    const database = await initDB();
    const transaction = database.transaction([RECORD_STORE], mode);
    return {
      database,
      transaction,
      store: transaction.objectStore(RECORD_STORE)
    };
  }

  async function getRecordById(recordId) {
    const { store } = await getStore('readonly');
    return toPromise(store.get(recordId));
  }

  async function saveRecord(input) {
    const candidate = normalizeRecord(input, null);
    if (!shouldPersistRecord(candidate)) {
      return candidate;
    }

    const { store, transaction } = await getStore('readwrite');

    return new Promise((resolve, reject) => {
      const dedupeRequest = store.index('dedupeKey').get(candidate.dedupeKey);

      dedupeRequest.onerror = () => reject(dedupeRequest.error);
      dedupeRequest.onsuccess = () => {
        const existing = dedupeRequest.result || null;
        const nextRecord = normalizeRecord(candidate, existing);

        const putRequest = store.put(nextRecord);
        putRequest.onerror = () => reject(putRequest.error);
        putRequest.onsuccess = () => resolve(nextRecord);
      };

      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function getAll(options) {
    const { store } = await getStore('readonly');
    const items = await toPromise(store.getAll());
    const normalized = (items || []).sort((a, b) => {
      return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
    });

    if (options?.favoritesOnly) {
      return normalized.filter((item) => item.favorite);
    }

    return normalized;
  }

  async function searchRecords(query, options) {
    const keyword = String(query || '').trim().toLowerCase();
    const items = await getAll(options);
    if (!keyword) return items;

    return items.filter((item) => {
      return [
        item.titleSnapshot,
        item.sourceHost,
        item.summaryPlainText,
        item.summaryMode,
        item.provider,
        item.model,
        item.articleSnapshot?.sourceType,
        item.articleSnapshot?.sourceStrategy?.label,
        item.articleSnapshot?.sourceStrategyId
      ].some((field) => String(field || '').toLowerCase().includes(keyword));
    });
  }

  async function toggleFavorite(recordId) {
    const existing = await getRecordById(recordId);
    if (!existing) return null;
    return saveRecord(Object.assign({}, existing, { favorite: !existing.favorite }));
  }

  async function updateRecord(recordId, patch) {
    const existing = await getRecordById(recordId);
    if (!existing) return null;
    return saveRecord(Object.assign({}, existing, patch || {}));
  }

  async function deleteRecord(recordId) {
    const { store, transaction } = await getStore('readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(recordId);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function clearAll() {
    const { store, transaction } = await getStore('readwrite');
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  const api = {
    markdownToPlainText,
    buildDedupeKey,
    getRecordSiteHost,
    buildSiteBuckets,
    filterRecordsBySite,
    groupRecordsBySite,
    migrateLegacyRecord,
    shouldPersistRecord,
    saveRecord,
    getAll,
    searchRecords,
    getRecordById,
    toggleFavorite,
    updateRecord,
    deleteRecord,
    clearAll
  };

  global.db = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

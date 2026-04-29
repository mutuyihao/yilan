const recordStore = window.db;
const UiFormat = window.AISummaryUiFormat;
const UiLabels = window.AISummaryUiLabels;
const ReaderView = window.AISummaryReaderView;

const READER_SESSION_PREFIX = 'readerSession:';

const $ = (id) => document.getElementById(id);

function storageLocalGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(items || {});
    });
  });
}

function setStatus(text, tone) {
  const node = $('statusLine');
  node.textContent = text || '';
  node.className = 'status-line' + (tone ? ' ' + tone : '');
}

const escapeHtml = UiFormat.escapeHtml;
const normalizeExternalUrl = ReaderView.normalizeExternalUrl;
const mergeSnapshotWithRecord = ReaderView.mergeSnapshotWithRecord;

function getStatusLabel(status) {
  return UiLabels.getRecordStatusLabel(status, { variant: 'reader', fallback: '已完成' });
}

function estimateReadMinutes(text) {
  const plain = String(text || '').trim();
  if (!plain) return '约 1 分钟';
  const minutes = Math.max(1, Math.round(plain.length / 500));
  return `约 ${minutes} 分钟阅读`;
}

function buildBadge(label, tone) {
  return `<span class="badge${tone ? ' ' + tone : ''}">${escapeHtml(label)}</span>`;
}

function buildDetail(label, value) {
  return `<span class="detail-pill">${escapeHtml(label)}<strong>${escapeHtml(value)}</strong></span>`;
}

function parseSessionId() {
  const url = new URL(window.location.href);
  return String(url.searchParams.get('session') || '').trim();
}

async function loadReaderSnapshot() {
  const sessionId = parseSessionId();
  if (!sessionId) {
    throw new Error('没有找到阅读会话。');
  }

  const storageKey = READER_SESSION_PREFIX + sessionId;
  const items = await storageLocalGet(storageKey);
  const snapshot = items?.[storageKey]?.snapshot || null;
  if (!snapshot) {
    throw new Error('阅读会话已失效，请回到侧栏重新打开。');
  }

  if (snapshot.recordId && snapshot.allowHistory !== false) {
    try {
      const record = await recordStore.getRecordById(snapshot.recordId);
      if (record) {
        return mergeSnapshotWithRecord(snapshot, record);
      }
    } catch (error) {
      // Fall back to the passed snapshot when DB lookup fails.
    }
  }

  return snapshot;
}

function renderEmpty(title, detail) {
  $('readerLayout').classList.add('hidden');
  $('readerHero').classList.add('hidden');
  $('readerContent').classList.add('hidden');
  $('readerDiagnostics').classList.add('hidden');
  $('emptyTitle').textContent = title;
  $('emptyDetail').textContent = detail;
  $('emptyState').classList.remove('hidden');
}

function renderReader(snapshot) {
  document.title = `${snapshot.title || '一览阅读'} - 一览`;

  $('emptyState').classList.add('hidden');
  $('readerLayout').classList.remove('hidden');
  $('readerHero').classList.remove('hidden');
  $('readerContent').classList.remove('hidden');

  $('readerTitle').textContent = snapshot.title || '未命名页面';

  const sourceUrl = normalizeExternalUrl(snapshot.sourceUrl);
  const sourceLink = $('readerSourceLink');
  sourceLink.href = sourceUrl || '#';
  sourceLink.textContent = sourceUrl || '没有可用原文链接';
  sourceLink.setAttribute('aria-disabled', sourceUrl ? 'false' : 'true');
  sourceLink.tabIndex = sourceUrl ? 0 : -1;
  sourceLink.classList.toggle('is-disabled', !sourceUrl);

  const openSourceBtn = $('openSourceBtn');
  openSourceBtn.href = sourceUrl || '#';
  openSourceBtn.setAttribute('aria-disabled', sourceUrl ? 'false' : 'true');
  openSourceBtn.tabIndex = sourceUrl ? 0 : -1;
  openSourceBtn.classList.toggle('is-disabled', !sourceUrl);

  $('badgeRow').innerHTML = [
    snapshot.sourceHost ? buildBadge(snapshot.sourceHost) : '',
    snapshot.sourceTypeLabel ? buildBadge(snapshot.sourceTypeLabel) : '',
    snapshot.strategyLabel ? buildBadge(snapshot.strategyLabel) : '',
    snapshot.summaryModeLabel ? buildBadge(snapshot.summaryModeLabel, 'accent') : '',
    snapshot.privacyMode ? buildBadge('无痕模式') : '',
    snapshot.favorite ? buildBadge('已收藏') : ''
  ].filter(Boolean).join('');

  $('detailRow').innerHTML = [
    buildDetail('状态', getStatusLabel(snapshot.status)),
    buildDetail('阅读', estimateReadMinutes(snapshot.summaryPlainText || snapshot.summaryMarkdown || '')),
    snapshot.author ? buildDetail('作者', snapshot.author) : '',
    snapshot.completedAtLabel && snapshot.completedAtLabel !== '未记录' ? buildDetail('生成时间', snapshot.completedAtLabel) : '',
    snapshot.providerLabel ? buildDetail('模型供应商', snapshot.providerLabel) : '',
    snapshot.model ? buildDetail('模型', snapshot.model) : ''
  ].filter(Boolean).join('');

  $('summaryArticle').dataset.markdown = snapshot.summaryMarkdown || '';
  renderSanitizedMarkdownFragment($('summaryArticle'), snapshot.summaryMarkdown || '');

  const diagnosticsBlock = $('readerDiagnostics');
  const diagnosticsPre = $('diagnosticsPre');
  if (snapshot.diagnostics) {
    diagnosticsPre.textContent = JSON.stringify(snapshot.diagnostics, null, 2);
    diagnosticsBlock.classList.remove('hidden');
  } else {
    diagnosticsBlock.classList.add('hidden');
  }

  setStatus(snapshot.allowHistory === false ? '这是一次未写入历史的临时阅读视图。' : '阅读页已准备好。');
}

async function copyMarkdown() {
  const content = $('summaryArticle').dataset.markdown || '';
  if (!content) return;

  await navigator.clipboard.writeText(content);
  setStatus('Markdown 已复制到剪贴板。', 'success');
}

const MARKDOWN_SANITIZE_OPTIONS = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['class', 'target', 'rel', 'align']
};

function renderSanitizedMarkdownFragment(container, markdown) {
  const fragment = DOMPurify.sanitize(marked.parse(markdown || ''), {
    ...MARKDOWN_SANITIZE_OPTIONS,
    RETURN_DOM_FRAGMENT: true
  });
  container.replaceChildren(fragment);
}

window.addEventListener('DOMContentLoaded', async () => {
  marked.setOptions({
    breaks: true,
    gfm: true,
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    }
  });

  try {
    const snapshot = await loadReaderSnapshot();
    renderReader(snapshot);
  } catch (error) {
    renderEmpty('无法打开阅读页', String(error?.message || error || '发生未知错误。'));
  }

  $('copyBtn').addEventListener('click', () => {
    copyMarkdown().catch((error) => {
      setStatus(String(error?.message || error || '复制失败。'), 'error');
    });
  });
});

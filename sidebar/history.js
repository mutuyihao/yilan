(function (global) {
  function createHistoryController(deps) {
    const elements = deps.elements;
    const state = deps.state;
    const recordStore = deps.recordStore;
    const renderPlaceholder = deps.renderPlaceholder;
    const bindVisibleRecord = deps.bindVisibleRecord;
    const refreshActionStates = deps.refreshActionStates;
    const setStatus = deps.setStatus;
    const closeDiagnostics = deps.closeDiagnostics;
    const formatDateTime = deps.formatDateTime;
    const escapeHtml = deps.escapeHtml;
    const buildHistoryItemView = deps.buildHistoryItemView;
    const buildHistoryGroupView = deps.buildHistoryGroupView;

    function reportHistoryError(error, fallbackMessage) {
      const message = String(error?.message || error || fallbackMessage || '操作失败');
      console.error('[Yilan] History action failed.', error);
      if (typeof setStatus === 'function') {
        setStatus(message, 'error');
      }
    }

    function renderEmpty(message) {
      elements.historySiteFilters.innerHTML = '';
      elements.historyList.innerHTML = '<div class="history-empty">' + escapeHtml(message) + '</div>';
    }

    function createSiteChip(label, count, active, onClick, title) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-site-chip' + (active ? ' active' : '');
      if (title) button.title = title;

      const text = document.createElement('span');
      text.textContent = label;

      const countBadge = document.createElement('span');
      countBadge.className = 'history-site-chip-count';
      countBadge.textContent = String(count);

      button.appendChild(text);
      button.appendChild(countBadge);
      button.addEventListener('click', onClick);
      return button;
    }

    function renderSiteFilters(buckets, totalCount) {
      elements.historySiteFilters.innerHTML = '';

      const allChip = createSiteChip(
        '\u5168\u90e8\u7ad9\u70b9',
        totalCount,
        !state.selectedSiteHost,
        () => {
          if (!state.selectedSiteHost) return;
          state.selectedSiteHost = '';
          refresh().catch(console.error);
        },
        '\u67e5\u770b\u5168\u90e8\u7ad9\u70b9\u7684\u603b\u7ed3\u8bb0\u5f55'
      );
      elements.historySiteFilters.appendChild(allChip);

      buckets.forEach((bucket) => {
        const tip = [
          bucket.host,
          bucket.count + ' \u6761\u8bb0\u5f55',
          bucket.favoriteCount ? bucket.favoriteCount + ' \u6761\u6536\u85cf' : '',
          bucket.latestUpdatedAt ? '\u6700\u8fd1\u66f4\u65b0\uff1a' + formatDateTime(bucket.latestUpdatedAt) : ''
        ].filter(Boolean).join(' \u00b7 ');

        const chip = createSiteChip(
          bucket.host,
          bucket.count,
          state.selectedSiteHost === bucket.host,
          () => {
            if (state.selectedSiteHost === bucket.host) return;
            state.selectedSiteHost = bucket.host;
            refresh().catch(console.error);
          },
          tip
        );

        elements.historySiteFilters.appendChild(chip);
      });
    }

    function createItemElement(item) {
      const view = buildHistoryItemView(item);
      const container = document.createElement('div');
      container.className = 'history-item';

      const header = document.createElement('div');
      header.className = 'history-item-header';

      const title = document.createElement('div');
      title.className = 'history-item-title';
      title.textContent = view.title;

      const meta = document.createElement('div');
      meta.className = 'history-meta';
      meta.textContent = view.meta;

      const preview = document.createElement('div');
      preview.className = 'history-preview';
      preview.textContent = view.preview;

      const footer = document.createElement('div');
      footer.className = 'history-item-footer';

      const tags = document.createElement('div');
      tags.className = 'history-tags';
      view.badges.forEach((value) => {
        const tag = document.createElement('span');
        tag.className = 'badge';
        tag.textContent = value;
        tags.appendChild(tag);
      });

      const actions = document.createElement('div');
      actions.className = 'history-tags';

      const favoriteBtn = document.createElement('button');
      favoriteBtn.className = 'history-mini-btn';
      favoriteBtn.textContent = item.favorite ? '\u53d6\u6d88\u6536\u85cf' : '\u6536\u85cf';
      favoriteBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        try {
          const updated = await recordStore.toggleFavorite(item.recordId);
          if (state.visibleRecord?.recordId === updated?.recordId) {
            bindVisibleRecord(updated, { preserveCurrentArticle: state.visibleRecordUsesCurrentArticle });
          }
          await refresh();
        } catch (error) {
          reportHistoryError(error, '\u66f4\u65b0\u6536\u85cf\u72b6\u6001\u5931\u8d25');
        }
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'history-mini-btn';
      deleteBtn.textContent = '\u5220\u9664';
      deleteBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        try {
          await recordStore.deleteRecord(item.recordId);
          if (state.visibleRecord?.recordId === item.recordId) {
            state.visibleRecord = null;
            state.visibleRecordUsesCurrentArticle = false;
            state.summaryMarkdown = '';
            renderPlaceholder('\u8bb0\u5f55\u5df2\u5220\u9664', '\u53ef\u4ee5\u91cd\u65b0\u751f\u6210\u5f53\u524d\u9875\u9762\u6458\u8981\u3002');
          }
          await refresh();
          refreshActionStates();
        } catch (error) {
          reportHistoryError(error, '\u5220\u9664\u5386\u53f2\u8bb0\u5f55\u5931\u8d25');
        }
      });

      actions.appendChild(favoriteBtn);
      actions.appendChild(deleteBtn);

      header.appendChild(title);
      footer.appendChild(tags);
      footer.appendChild(actions);

      container.appendChild(header);
      container.appendChild(meta);
      container.appendChild(preview);
      container.appendChild(footer);
      container.addEventListener('click', () => {
        bindVisibleRecord(item);
        close();
      });

      return container;
    }

    async function refresh() {
      const items = await recordStore.searchRecords(state.historyQuery, { favoritesOnly: state.favoritesOnly });
      elements.historyList.innerHTML = '';

      if (!items.length) {
        renderEmpty('\u6ca1\u6709\u627e\u5230\u5339\u914d\u7684\u603b\u7ed3\u8bb0\u5f55\u3002');
        return;
      }

      const siteBuckets = recordStore.buildSiteBuckets(items);
      if (state.selectedSiteHost && !siteBuckets.some((bucket) => bucket.host === state.selectedSiteHost)) {
        state.selectedSiteHost = '';
      }

      renderSiteFilters(siteBuckets, items.length);

      const filteredItems = recordStore.filterRecordsBySite(items, state.selectedSiteHost);
      const siteGroups = recordStore.groupRecordsBySite(filteredItems);

      siteGroups.forEach((group) => {
        const groupView = buildHistoryGroupView(group, { selected: !!state.selectedSiteHost });
        const section = document.createElement('section');
        section.className = 'history-site-group';

        const header = document.createElement('div');
        header.className = 'history-site-group-header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'history-site-group-title';

        const title = document.createElement('strong');
        title.textContent = groupView.title;

        const meta = document.createElement('div');
        meta.className = 'history-site-group-meta';
        meta.textContent = groupView.meta;

        const badge = document.createElement('span');
        badge.className = 'badge badge-soft';
        badge.textContent = groupView.badge;

        titleWrap.appendChild(title);
        titleWrap.appendChild(meta);
        header.appendChild(titleWrap);
        header.appendChild(badge);

        const list = document.createElement('div');
        list.className = 'history-site-group-list';
        group.records.forEach((item) => {
          list.appendChild(createItemElement(item));
        });

        section.appendChild(header);
        section.appendChild(list);
        elements.historyList.appendChild(section);
      });
    }

    function open() {
      if (typeof closeDiagnostics === 'function') {
        closeDiagnostics();
      }
      elements.historyPanel.classList.remove('hidden');
      refresh().catch((error) => {
        elements.historySiteFilters.innerHTML = '';
        elements.historyList.innerHTML = '<div class="history-empty">\u5386\u53f2\u8bb0\u5f55\u52a0\u8f7d\u5931\u8d25\uff1a' + escapeHtml(String(error?.message || error || 'unknown')) + '</div>';
      });
    }

    function close() {
      elements.historyPanel.classList.add('hidden');
    }

    function isOpen() {
      return !elements.historyPanel.classList.contains('hidden');
    }

    elements.historyCloseBtn.addEventListener('click', close);
    elements.historySearch.addEventListener('input', () => {
      state.historyQuery = elements.historySearch.value || '';
      refresh().catch((error) => {
        reportHistoryError(error, '\u5237\u65b0\u5386\u53f2\u8bb0\u5f55\u5931\u8d25');
      });
    });
    elements.favoritesOnly.addEventListener('change', () => {
      state.favoritesOnly = !!elements.favoritesOnly.checked;
      refresh().catch((error) => {
        reportHistoryError(error, '\u5237\u65b0\u5386\u53f2\u8bb0\u5f55\u5931\u8d25');
      });
    });

    return {
      open,
      close,
      refresh,
      isOpen
    };
  }

  global.YilanSidebarHistory = {
    createHistoryController
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

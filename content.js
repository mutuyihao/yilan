if (!window.__aiSummaryInjected) {
  window.__aiSummaryInjected = true;

  const Domain = window.AISummaryDomain;
  const ArticleUtils = window.AISummaryArticle;
  const Constants = window.AISummaryConstants;
  const SIDEBAR_FRAME_ID = 'ai-summary-sidebar';
  const SIDEBAR_FRAME_WIDTH = 420;
  const NAVIGATION_REFRESH_POLICY = {
    autoStartOnNavigation: false,
    duringGeneration: 'defer'
  };
  let detachViewportSync = null;
  let navigationPollTimer = 0;
  let navigationMutationObserver = null;
  let navigationMutationTimer = 0;
  let activeSidebarPayloadType = '';
  let currentPageKey = buildPageContextKey();

  function readCanonicalUrl(doc) {
    const canonicalLink = doc.querySelector('link[rel="canonical"]');
    return canonicalLink?.href || '';
  }

  function collectMeta(doc, readabilityArticle) {
    const readMetaContent = ArticleUtils.readMetaContent;

    const canonicalUrl = readCanonicalUrl(doc) || readMetaContent(doc, [
      'meta[property="og:url"]',
      'meta[name="twitter:url"]'
    ]);

    return {
      canonicalUrl,
      ogTitle: readMetaContent(doc, [
        'meta[property="og:title"]',
        'meta[name="twitter:title"]'
      ]),
      htmlTitle: doc.title || '',
      description: readMetaContent(doc, [
        'meta[name="description"]',
        'meta[property="og:description"]',
        'meta[name="twitter:description"]'
      ]) || readabilityArticle?.excerpt || '',
      author: readMetaContent(doc, [
        'meta[name="author"]',
        'meta[property="article:author"]',
        'meta[name="article:author"]',
        'meta[name="parsely-author"]'
      ]),
      siteName: readMetaContent(doc, [
        'meta[property="og:site_name"]',
        'meta[name="application-name"]'
      ]),
      publishedAt: readMetaContent(doc, [
        'meta[property="article:published_time"]',
        'meta[name="article:published_time"]',
        'meta[name="pubdate"]',
        'meta[name="publish-date"]',
        'meta[itemprop="datePublished"]'
      ]),
      language: doc.documentElement?.lang || navigator.language || ''
    };
  }

  function extractArticleSnapshot() {
    let readabilityArticle = null;

    try {
      if (typeof Readability !== 'undefined') {
        readabilityArticle = new Readability(document.cloneNode(true)).parse();
      }
    } catch (error) {
      console.warn('[Yilan] Readability parse failed.', error);
    }

    const bodyText = Domain.normalizeWhitespace(document.body?.innerText || '');
    const readabilityText = Domain.normalizeWhitespace(readabilityArticle?.textContent || '');
    const bestText = readabilityText.length >= 200 ? readabilityText : bodyText;
    const meta = collectMeta(document, readabilityArticle);

    return ArticleUtils.buildArticleSnapshot({
      title: readabilityArticle?.title || document.title || location.hostname,
      text: bestText,
      excerpt: readabilityArticle?.excerpt || meta.description || '',
      sourceUrl: location.href,
      meta,
      extractor: readabilityText.length >= 200 ? 'readability' : 'body_fallback',
      maxChars: 28000
    });
  }

  function buildPageKey() {
    const routeHash = /^#!?\//.test(window.location.hash || '') ? window.location.hash : '';
    return [
      window.location.origin || '',
      window.location.pathname || '',
      window.location.search || '',
      routeHash
    ].join('');
  }

  function buildPageContextKey() {
    const h1Text = Domain.normalizeWhitespace(document.querySelector('h1')?.textContent || '');
    return [
      buildPageKey(),
      document.title || '',
      readCanonicalUrl(document) || '',
      h1Text
    ].join('\n');
  }

  function isDiscourseListingPage() {
    const path = window.location.pathname || '';
    const generator = document.querySelector('meta[name="generator"]')?.getAttribute('content') || '';
    const discourseLike = /discourse/i.test(generator) || document.body?.classList.contains('navigation-topics');
    if (!discourseLike) return false;
    if (/\/t\//.test(path)) return false;
    return (
      path === '/' ||
      /^\/(?:latest|new|top)?\/?$/.test(path) ||
      /^\/c\//.test(path) ||
      /^\/categories\/?$/.test(path) ||
      /^\/tag\//.test(path) ||
      /^\/search\/?$/.test(path)
    );
  }

  function createSidebarFrame() {
    const existing = document.getElementById(SIDEBAR_FRAME_ID);
    if (existing) {
      existing.remove();
    }

    const iframe = document.createElement('iframe');
    iframe.id = SIDEBAR_FRAME_ID;
    iframe.src = chrome.runtime.getURL('sidebar.html');
    iframe.setAttribute('allow', 'clipboard-read; clipboard-write');

    Object.assign(iframe.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: SIDEBAR_FRAME_WIDTH + 'px',
      maxWidth: '100vw',
      height: '100dvh',
      maxHeight: '100dvh',
      display: 'block',
      border: 'none',
      zIndex: '2147483647',
      boxShadow: '-18px 0 50px rgba(10, 16, 28, 0.28)',
      background: 'transparent'
    });

    syncSidebarViewport(iframe);
    bindSidebarViewportSync(iframe);
    document.documentElement.appendChild(iframe);
    return iframe;
  }

  function getViewportMetrics() {
    const viewport = window.visualViewport;
    if (viewport) {
      return {
        top: Math.max(0, Math.round(viewport.offsetTop || 0)),
        rightInset: Math.max(0, Math.round(window.innerWidth - viewport.width - viewport.offsetLeft)),
        width: Math.max(320, Math.round(viewport.width || window.innerWidth || SIDEBAR_FRAME_WIDTH)),
        height: Math.max(0, Math.round(viewport.height || window.innerHeight || document.documentElement.clientHeight || 0))
      };
    }

    return {
      top: 0,
      rightInset: 0,
      width: Math.max(320, Math.round(window.innerWidth || document.documentElement.clientWidth || SIDEBAR_FRAME_WIDTH)),
      height: Math.max(0, Math.round(window.innerHeight || document.documentElement.clientHeight || 0))
    };
  }

  function syncSidebarViewport(iframe) {
    if (!iframe || !iframe.isConnected) return;
    const metrics = getViewportMetrics();
    iframe.style.top = metrics.top + 'px';
    iframe.style.right = metrics.rightInset + 'px';
    iframe.style.width = Math.min(SIDEBAR_FRAME_WIDTH, metrics.width) + 'px';
    iframe.style.maxWidth = metrics.width + 'px';
    iframe.style.height = metrics.height + 'px';
    iframe.style.maxHeight = metrics.height + 'px';
  }

  function bindSidebarViewportSync(iframe) {
    if (typeof detachViewportSync === 'function') {
      detachViewportSync();
    }

    let frameId = 0;
    const scheduleSync = () => {
      if (!iframe || !iframe.isConnected) return;
      if (frameId) return;
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        syncSidebarViewport(iframe);
      });
    };

    const viewport = window.visualViewport;
    window.addEventListener('resize', scheduleSync);
    viewport?.addEventListener('resize', scheduleSync);
    viewport?.addEventListener('scroll', scheduleSync);

    detachViewportSync = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
        frameId = 0;
      }
      window.removeEventListener('resize', scheduleSync);
      viewport?.removeEventListener('resize', scheduleSync);
      viewport?.removeEventListener('scroll', scheduleSync);
      detachViewportSync = null;
    };
  }

  function injectSidebar(payload) {
    currentPageKey = buildPageContextKey();
    activeSidebarPayloadType = String(payload?.type || '');
    const iframe = createSidebarFrame();
    iframe.onload = () => {
      syncSidebarViewport(iframe);
      iframe.contentWindow?.postMessage(payload, '*');
    };
  }

  function postToExistingSidebar(payload) {
    const iframe = document.getElementById(SIDEBAR_FRAME_ID);
    if (!iframe?.contentWindow) return false;

    activeSidebarPayloadType = String(payload?.type || activeSidebarPayloadType || '');
    syncSidebarViewport(iframe);
    iframe.contentWindow.postMessage(payload, '*');
    return true;
  }

  function removeSidebar() {
    if (navigationMutationTimer) {
      clearTimeout(navigationMutationTimer);
      navigationMutationTimer = 0;
    }
    if (typeof detachViewportSync === 'function') {
      detachViewportSync();
    }
    activeSidebarPayloadType = '';
    const iframe = document.getElementById(SIDEBAR_FRAME_ID);
    if (iframe) {
      iframe.remove();
    }
  }

  function shouldTrackPageContext() {
    return activeSidebarPayloadType === 'articleData' && !!document.getElementById(SIDEBAR_FRAME_ID);
  }

  function scheduleSidebarRefreshForNavigation() {
    if (!shouldTrackPageContext()) return;

    const article = extractArticleSnapshot();
    postToExistingSidebar({
      type: 'articleData',
      article,
      source: 'navigation',
      navigationPolicy: NAVIGATION_REFRESH_POLICY
    });
  }

  function handlePageContextChange() {
    if (!shouldTrackPageContext()) return;

    const nextPageKey = buildPageContextKey();
    if (nextPageKey === currentPageKey) return;
    currentPageKey = nextPageKey;

    if (activeSidebarPayloadType === 'articleData' && isDiscourseListingPage()) {
      removeSidebar();
      return;
    }

    scheduleSidebarRefreshForNavigation();
  }

  function schedulePageContextCheck() {
    if (!shouldTrackPageContext()) return;
    window.setTimeout(handlePageContextChange, 0);
    window.setTimeout(handlePageContextChange, Constants.NAVIGATION_REFRESH_DELAY_MS);
  }

  function schedulePageContextCheckFromMutation() {
    if (!shouldTrackPageContext()) return;
    if (navigationMutationTimer) return;
    navigationMutationTimer = window.setTimeout(() => {
      navigationMutationTimer = 0;
      handlePageContextChange();
    }, Constants.NAVIGATION_REFRESH_DELAY_MS);
  }

  function bindNavigationTracking() {
    const history = window.history;
    if (!history || history.__aiSummaryNavigationBound) return;
    history.__aiSummaryNavigationBound = true;

    const rawPushState = history.pushState;
    const rawReplaceState = history.replaceState;

    history.pushState = function (...args) {
      const result = rawPushState.apply(this, args);
      handlePageContextChange();
      return result;
    };

    history.replaceState = function (...args) {
      const result = rawReplaceState.apply(this, args);
      handlePageContextChange();
      return result;
    };

    window.addEventListener('popstate', handlePageContextChange);
    window.addEventListener('hashchange', handlePageContextChange);
    window.addEventListener('click', schedulePageContextCheck, true);

    if (!navigationMutationObserver && typeof MutationObserver !== 'undefined') {
      navigationMutationObserver = new MutationObserver(schedulePageContextCheckFromMutation);
      navigationMutationObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['content', 'href'],
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    navigationPollTimer = window.setInterval(handlePageContextChange, Constants.NAVIGATION_POLL_INTERVAL_MS);
  }

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'closeSidebar') {
      removeSidebar();
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
      sendResponse({ status: 'ok' });
      return true;
    }

    if (message.action === 'extractAndSummarize') {
      const article = extractArticleSnapshot();
      injectSidebar({ type: 'articleData', article });
      sendResponse({ status: 'ok', articleId: article.articleId });
      return true;
    }

    if (message.action === 'showHistory') {
      injectSidebar({ type: 'historyData' });
      sendResponse({ status: 'ok' });
      return true;
    }

    return false;
  });

  bindNavigationTracking();
}

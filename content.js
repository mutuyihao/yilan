if (!window.__aiSummaryInjected) {
  window.__aiSummaryInjected = true;

  const Domain = window.AISummaryDomain;
  const ArticleUtils = window.AISummaryArticle;
  const BilibiliSource = window.AISummaryBilibiliSource;
  const YoutubeSource = window.AISummaryYoutubeSource;
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
  // Random per-injection secret authorizing content->sidebar messages. The
  // host page shares the content script's window/origin, so origin checks
  // cannot separate them; only the value of this token can (pages cannot read
  // messages posted into the cross-origin sidebar iframe).
  let sidebarMessageToken = '';

  function createSidebarMessageToken() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (error) {
      console.warn('[Yilan] crypto.randomUUID unavailable, using fallback token.', error);
    }
    return 'tok_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function signSidebarPayload(payload) {
    return Object.assign({}, payload, { __yilanToken: sidebarMessageToken });
  }

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

  async function extractCurrentPageSnapshot() {
    if (YoutubeSource?.isYoutubeVideoUrl?.(location.href)) {
      try {
        let playerResponse = null;
        try {
          const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'getYoutubePlayerResponse' }, (res) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve(res);
              }
            });
          });
          if (response?.success && response.playerResponse) {
            playerResponse = response.playerResponse;
          }
        } catch (err) {
          console.warn('[Yilan] Failed to get player response from background:', err);
        }

        const source = await YoutubeSource.extractYoutubeVideoSource({
          document,
          url: location.href,
          playerResponse
        });

        if (source?.text) {
          return ArticleUtils.buildArticleSnapshot({
            title: source.title,
            text: source.text,
            excerpt: source.excerpt,
            sourceUrl: source.sourceUrl,
            meta: source.meta,
            sourceType: 'video',
            extractor: 'youtube_' + (source.sourceKind || 'fallback'),
            diagnostics: {
              videoSource: 'youtube',
              videoSourceKind: source.sourceKind || 'fallback',
              youtube: source.diagnostics || null
            },
            maxChars: 42000
          });
        }
      } catch (error) {
        console.warn('[Yilan] YouTube video extraction failed, falling back to page text.', error);
      }
    }

    if (BilibiliSource?.isBilibiliVideoUrl?.(location.href)) {
      try {
        const source = await BilibiliSource.extractBilibiliVideoSource({
          document,
          url: location.href
        });

        if (source?.text) {
          return ArticleUtils.buildArticleSnapshot({
            title: source.title,
            text: source.text,
            excerpt: source.excerpt,
            sourceUrl: source.sourceUrl,
            meta: source.meta,
            sourceType: 'video',
            extractor: 'bilibili_' + (source.sourceKind || 'fallback'),
            diagnostics: {
              videoSource: 'bilibili',
              videoSourceKind: source.sourceKind || 'fallback',
              bilibili: source.diagnostics || null
            },
            maxChars: 42000
          });
        }
      } catch (error) {
        console.warn('[Yilan] Bilibili video extraction failed, falling back to page text.', error);
      }
    }

    return extractArticleSnapshot();
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

    // Reuse a live sidebar instead of reloading it (saves re-executing the
    // whole iframe boot: ~280KB of libs, DB reconnect, settings reload). The
    // message token is minted once per iframe lifetime so the sidebar's
    // first-message lock keeps accepting signed payloads across reuses.
    const existing = document.getElementById(SIDEBAR_FRAME_ID);
    if (existing?.contentWindow && sidebarMessageToken) {
      syncSidebarViewport(existing);
      existing.contentWindow.postMessage(signSidebarPayload(payload), '*');
      startNavigationTrackingIfSidebarActive();
      return;
    }

    sidebarMessageToken = createSidebarMessageToken();
    const iframe = createSidebarFrame();
    iframe.onload = () => {
      syncSidebarViewport(iframe);
      iframe.contentWindow?.postMessage(signSidebarPayload(payload), '*');
    };
    // Only an open article sidebar needs SPA tracking; bind after the payload
    // type is known, and let removeSidebar()/teardown unwind everything.
    startNavigationTrackingIfSidebarActive();
  }

  function postToExistingSidebar(payload) {
    const iframe = document.getElementById(SIDEBAR_FRAME_ID);
    if (!iframe?.contentWindow) return false;

    activeSidebarPayloadType = String(payload?.type || activeSidebarPayloadType || '');
    syncSidebarViewport(iframe);
    iframe.contentWindow.postMessage(signSidebarPayload(payload), '*');
    return true;
  }

  function teardownNavigationTracking() {
    if (navigationMutationTimer) {
      clearTimeout(navigationMutationTimer);
      navigationMutationTimer = 0;
    }
    if (navigationPollTimer) {
      clearInterval(navigationPollTimer);
      navigationPollTimer = 0;
    }
    if (navigationMutationObserver) {
      navigationMutationObserver.disconnect();
      navigationMutationObserver = null;
    }
    unbindNavigationTracking();
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
    sidebarMessageToken = '';
    const iframe = document.getElementById(SIDEBAR_FRAME_ID);
    if (iframe) {
      iframe.remove();
    }
    teardownNavigationTracking();
  }

  function shouldTrackPageContext() {
    return activeSidebarPayloadType === 'articleData' && !!document.getElementById(SIDEBAR_FRAME_ID);
  }

  function startNavigationTrackingIfSidebarActive() {
    if (shouldTrackPageContext()) {
      bindNavigationTracking();
    }
  }

  async function scheduleSidebarRefreshForNavigation() {
    if (!shouldTrackPageContext()) return;

    const article = await extractCurrentPageSnapshot();
    if (!shouldTrackPageContext()) return;
    if (!postToExistingSidebar({
      type: 'articleData',
      article,
      source: 'navigation',
      navigationPolicy: NAVIGATION_REFRESH_POLICY
    })) {
      // Sidebar went away mid-extraction; unwind tracking with it.
      teardownNavigationTracking();
    }
  }

  function handlePageContextChange() {
    if (!shouldTrackPageContext()) {
      teardownNavigationTracking();
      return;
    }

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

  let rawPushState = null;
  let rawReplaceState = null;
  let boundNavigationListeners = null;

  function handleTrackedHistoryChange() {
    handlePageContextChange();
  }

  function patchedPushState(...args) {
    const result = rawPushState.apply(this, args);
    handleTrackedHistoryChange();
    return result;
  }

  function patchedReplaceState(...args) {
    const result = rawReplaceState.apply(this, args);
    handleTrackedHistoryChange();
    return result;
  }

  function unbindNavigationTracking() {
    if (!boundNavigationListeners) return;

    const history = window.history;
    window.removeEventListener('popstate', handleTrackedHistoryChange);
    window.removeEventListener('hashchange', handleTrackedHistoryChange);
    window.removeEventListener('click', schedulePageContextCheck, true);
    if (history && rawPushState) {
      history.pushState = rawPushState;
    }
    if (history && rawReplaceState) {
      history.replaceState = rawReplaceState;
    }

    boundNavigationListeners = null;
    rawPushState = null;
    rawReplaceState = null;
  }

  function bindNavigationTracking() {
    if (boundNavigationListeners) return;
    const history = window.history;
    if (!history) return;

    rawPushState = history.pushState;
    rawReplaceState = history.replaceState;

    history.pushState = patchedPushState;
    history.replaceState = patchedReplaceState;

    window.addEventListener('popstate', handleTrackedHistoryChange);
    window.addEventListener('hashchange', handleTrackedHistoryChange);
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
    boundNavigationListeners = true;
  }

  window.addEventListener('message', (event) => {
    // Only accept closeSidebar from the sidebar frame itself; the host page
    // could otherwise dismiss the UI at will (it can also remove the iframe
    // node directly, but this keeps the message channel semantically honest).
    if (event.data?.type !== 'closeSidebar') return;
    if (event.source !== document.getElementById(SIDEBAR_FRAME_ID)?.contentWindow) return;
    removeSidebar();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
      sendResponse({ status: 'ok' });
      return true;
    }

    if (message.action === 'extractAndSummarize') {
      extractCurrentPageSnapshot()
        .then((article) => {
          injectSidebar({ type: 'articleData', article });
          sendResponse({ status: 'ok', articleId: article.articleId });
        })
        .catch((error) => {
          const article = extractArticleSnapshot();
          injectSidebar({ type: 'articleData', article });
          sendResponse({
            status: 'fallback',
            articleId: article.articleId,
            error: error?.message || String(error)
          });
        });
      return true;
    }

    if (message.action === 'showHistory') {
      injectSidebar({ type: 'historyData' });
      sendResponse({ status: 'ok' });
      return true;
    }

    return false;
  });

  // Navigation tracking is wired lazily: it only runs while a sidebar that
  // received article content is open, and teardownNavigationTracking() (via
  // removeSidebar) fully unwinds observers, timers, and history patches so an
  // injected page returns to a clean state after the sidebar closes.
  startNavigationTrackingIfSidebarActive();
}
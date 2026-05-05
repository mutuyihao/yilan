(function initYilanSidebarState(global) {
  const SETTINGS_KEYS = [
    'providerPreset',
    'aiProvider',
    'endpointMode',
    'apiKey',
    'aiBaseURL',
    'modelName',
    'systemPrompt',
    'autoTranslate',
    'defaultLanguage',
    'themePreference',
    'themePalette',
    'privacyMode',
    'defaultAllowHistory',
    'defaultAllowShare',
    'entrypointAutoStart',
    'entrypointSimpleMode',
    'entrypointReuseHistory'
  ];

  const NAVIGATION_DURING_GENERATION = {
    DEFER: 'defer',
    REPLACE: 'replace',
    IGNORE: 'ignore'
  };

  const DEFAULT_NAVIGATION_POLICY = {
    autoStartOnNavigation: false,
    duringGeneration: NAVIGATION_DURING_GENERATION.DEFER
  };

  const ELEMENT_IDS = {
    articleTitle: 'articleTitle',
    sourceLink: 'sourceLink',
    hostBadge: 'hostBadge',
    siteTypeBadge: 'siteTypeBadge',
    strategyBadge: 'strategyBadge',
    modeBadge: 'modeBadge',
    authorValue: 'authorValue',
    publishedValue: 'publishedValue',
    lengthValue: 'lengthValue',
    chunkValue: 'chunkValue',
    warningList: 'warningList',
    trustTitle: 'trustTitle',
    trustSummary: 'trustSummary',
    trustModeBadge: 'trustModeBadge',
    trustHistoryBadge: 'trustHistoryBadge',
    trustShareBadge: 'trustShareBadge',
    trustSendValue: 'trustSendValue',
    trustSendNote: 'trustSendNote',
    trustHistoryValue: 'trustHistoryValue',
    trustHistoryNote: 'trustHistoryNote',
    trustShareValue: 'trustShareValue',
    trustShareNote: 'trustShareNote',
    privacyToggleBtn: 'privacyToggleBtn',
    summaryModeTrigger: 'summaryModeTrigger',
    summaryModeCurrentLabel: 'summaryModeCurrentLabel',
    summaryModeMenu: 'summaryModeMenu',
    summaryModeSelect: 'summaryModeSelect',
    regenerateBtn: 'regenerateBtn',
    cancelBtn: 'cancelBtn',
    favoriteBtn: 'favoriteBtn',
    copyBtn: 'copyBtn',
    shareBtn: 'shareBtn',
    exportBtn: 'exportBtn',
    contentPanel: 'content',
    summaryRoot: 'summaryRoot',
    diagnosticsBlock: 'diagnosticsBlock',
    diagnosticsToggle: 'diagnosticsToggle',
    diagnosticsPre: 'diagnosticsPre',
    statusText: 'statusText',
    statsText: 'statsText',
    historyPanel: 'historyPanel',
    readerBtn: 'readerBtn',
    historyBtn: 'historyBtn',
    themeBtn: 'themeBtn',
    historyCloseBtn: 'historyCloseBtn',
    historySearch: 'historySearch',
    favoritesOnly: 'favoritesOnly',
    historySiteFilters: 'historySiteFilters',
    historyList: 'historyList',
    closeBtn: 'closeBtn'
  };

  function createInitialState(options) {
    const trust = options?.trust;
    const defaultSettings = trust?.DEFAULT_SETTINGS || {};
    const buildTrustPolicy = trust?.buildTrustPolicy || (() => null);

    return {
      article: null,
      visibleRecord: null,
      visibleRecordUsesCurrentArticle: false,
      summaryMarkdown: '',
      generating: false,
      cancelRequested: false,
      runAbortController: null,
      activeRunIds: new Set(),
      activePort: null,
      activeStreamRunId: '',
      lastDiagnostics: null,
      historyQuery: '',
      favoritesOnly: false,
      selectedSiteHost: '',
      summaryModeMenuOpen: false,
      autoScroll: true,
      pendingNavigationPayload: null,
      settings: Object.assign({}, defaultSettings),
      trustPolicy: buildTrustPolicy(null, defaultSettings)
    };
  }

  function resolveElements(documentRef) {
    const doc = documentRef || global.document;
    const elements = {};
    Object.keys(ELEMENT_IDS).forEach((key) => {
      elements[key] = doc.getElementById(ELEMENT_IDS[key]);
    });
    return elements;
  }

  const api = {
    SETTINGS_KEYS,
    NAVIGATION_DURING_GENERATION,
    DEFAULT_NAVIGATION_POLICY,
    ELEMENT_IDS,
    createInitialState,
    resolveElements
  };

  global.YilanSidebarState = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

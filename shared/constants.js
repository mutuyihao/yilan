(function (global) {
  /**
   * Timing, settings and storage-key constants used across the extension.
   * Centralized to avoid magic numbers, keep storage keys in one registry,
   * and ensure consistency. Never rename existing storage keys: they are
   * part of the persisted user-data contract.
   */
  const Constants = {
    // Content script navigation timing
    NAVIGATION_REFRESH_DELAY_MS: 450,
    NAVIGATION_POLL_INTERVAL_MS: 500,

    // Popup autosave timing
    AUTOSAVE_DEBOUNCE_MS: 500,

    // Background request timing
    DEFAULT_REQUEST_TIMEOUT_MS: 90000,  // 90 seconds
    RETRY_BASE_DELAY_MS: 1000,          // 1 second
    RETRY_MAX_DELAY_MS: 8000,           // 8 seconds
    DEFAULT_MAX_RETRIES: 3,
    RETRY_AFTER_MAX_MS: 30000,          // clamp for server-provided Retry-After
    ENDPOINT_PROBE_TIMEOUT_MS: 20000,   // short timeout for auto-endpoint compatibility probes
    MODELS_REQUEST_TIMEOUT_MS: 15000,   // /models list request timeout

    // Streaming timing
    STREAM_IDLE_TIMEOUT_MS: 30000,      // abort a stream when no bytes arrive for this long
    STREAM_HEARTBEAT_INTERVAL_MS: 20000, // sidebar port ping to keep the MV3 worker alive
    STREAM_RAW_BODY_MAX_CHARS: 262144,  // cap raw SSE capture used for preview/fallback parsing
    STREAM_TOKEN_FLUSH_INTERVAL_MS: 50, // coalesce streamed deltas into one port message per tick

    // Chunked long-article runs
    CHUNK_REQUEST_CONCURRENCY: 2,       // parallel chunk summaries (results stay ordered)

    // chrome.storage.sync settings keys (schema is user-data; append only)
    SETTINGS_KEYS: [
      'providerPreset',
      'aiProvider',
      'endpointMode',
      'apiKey',
      'aiBaseURL',
      'modelName',
      'systemPrompt',
      'autoTranslate',
      'defaultLanguage',
      'uiLanguage',
      'chunkConcurrency',
      'themePreference',
      'themePalette',
      'sidebarCompactMode',
      'privacyMode',
      'defaultAllowHistory',
      'defaultAllowShare',
      'entrypointAutoStart',
      'entrypointSimpleMode',
      'entrypointReuseHistory'
    ],

    // chrome.storage.local cache keys
    MODELS_CACHE_STORAGE_KEY: 'yilanModelsCacheV1',
    AUTO_ENDPOINT_CACHE_STORAGE_KEY: 'yilanAutoEndpointModeCacheV1',

    // Reader session storage (chrome.storage.local)
    READER_SESSION_PREFIX: 'readerSession:',
    READER_SESSION_MAX_AGE_MS: 24 * 60 * 60 * 1000
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Constants;
  } else {
    (/** @type {any} */ (global)).AISummaryConstants = Constants;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : {});

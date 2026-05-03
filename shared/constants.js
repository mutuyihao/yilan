(function (global) {
  /**
   * Timing constants used across the extension.
   * Centralized to avoid magic numbers and ensure consistency.
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
    DEFAULT_MAX_RETRIES: 3
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Constants;
  } else {
    global.AISummaryConstants = Constants;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);

(function (global) {
  /**
   * Remove trailing slashes from a URL or path string.
   * @param {string} value - The URL or path to normalize
   * @returns {string} The normalized string without trailing slashes
   */
  function trimTrailingSlash(value) {
    return String(value || '').replace(/\/+$/, '');
  }

  const AdapterUtils = {
    trimTrailingSlash
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdapterUtils;
  } else {
    (/** @type {any} */ (global)).AISummaryAdapterUtils = AdapterUtils;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : {});

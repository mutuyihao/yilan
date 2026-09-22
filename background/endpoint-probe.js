(function initYilanEndpointProbe(global) {
  /**
   * Compatibility-switch decision logic for executeRun.
   *
   * Pure logic only: given a normalized error and the run's compatibility
   * budget, decide whether the request should be retried with a different
   * endpoint mode (auto mode probes responses -> chat_completions ->
   * legacy_completions), a toggled trailing /v1 on the base URL, or whether
   * the normal retry/failure path should proceed. background.js stays the
   * only place that resolves adapters, mutates run state, or touches storage;
   * this module never performs side effects so it is directly unit-testable.
   */
  const Errors = global.AISummaryErrors || (typeof require === 'function' ? require('../shared/errors.js') : null);
  const UrlUtils = global.AISummaryUrlUtils || (typeof require === 'function' ? require('../shared/url-utils.js') : null);

  // Ordered endpoint modes probed when endpointMode is 'auto'.
  const AUTO_ENDPOINT_CANDIDATES = ['responses', 'chat_completions', 'legacy_completions'];

  const normalizeUrlNoTrailingSlash = UrlUtils.normalizeUrlNoTrailingSlash;
  const looksLikeOpenAiEndpointUrl = UrlUtils.looksLikeOpenAiEndpointUrl;
  const toggleTrailingV1 = UrlUtils.toggleTrailingV1;

  // Gateways that do not support a probed URL shape answer with a route-style
  // error; those (and only those) authorize switching the URL/mode shape.
  function isCompatibilitySwitchError(errorLike) {
    const code = String(errorLike?.code || '');
    if (code === Errors.ERROR_CODES.ENDPOINT_NOT_SUPPORTED) return true;
    if (code === Errors.ERROR_CODES.UNSUPPORTED_RESPONSE_FORMAT) return true;
    if (code === Errors.ERROR_CODES.HTTP_ERROR) {
      const status = Number(errorLike?.httpStatus || errorLike?.status || 0);
      if (status === 404) return true;

      // Some gateways return 400/405 with a "route/path not found" style payload instead of 404.
      if (status === 400 || status === 405) {
        const detail = String(errorLike?.detail || errorLike?.message || '').toLowerCase();
        return [
          'unknown url',
          'unknown path',
          'no route matched',
          'route not found',
          'cannot post',
          'cannot get',
          'page not found'
        ].some((needle) => detail.includes(needle));
      }

      return false;
    }
    return false;
  }

  // Only bare-origin or /v1 base URLs are safe to auto-toggle: anything with
  // a deeper path already encodes the caller's intent.
  function canAutoToggleTrailingV1(value) {
    const normalized = normalizeUrlNoTrailingSlash(value);
    if (!normalized || looksLikeOpenAiEndpointUrl(normalized)) return false;

    try {
      const parsed = new URL(normalized);
      const path = String(parsed.pathname || '').replace(/\/+$/g, '');
      return path === '' || path === '/' || /^\/v1$/i.test(path);
    } catch {
      return /^(?:https?:\/\/[^/]+)(?:\/v1)?$/i.test(normalized);
    }
  }

  function createCompatibilityStateMachine(options) {
    const isOpenAiProvider = options.isOpenAiProvider === true;
    const wantsAutoEndpointMode = isOpenAiProvider && String(options.endpointMode || '').trim() === 'auto';
    const baseUrlInput = normalizeUrlNoTrailingSlash(options.baseUrl || '');
    const canTryV1Toggle = isOpenAiProvider && canAutoToggleTrailingV1(baseUrlInput);

    const autoEndpointTried = wantsAutoEndpointMode ? new Set() : null;
    const autoBaseUrlTried = canTryV1Toggle ? new Set([baseUrlInput]) : null;

    return {
      wantsAutoEndpointMode,
      canTryV1Toggle,
      autoEndpointTried,
      autoBaseUrlTried,
      baseUrlInput,

      // Resolve the mode a cached 'auto' result starts on; '' when unknown.
      applyCachedEndpointMode(cachedMode) {
        return typeof cachedMode === 'string' && cachedMode ? cachedMode : '';
      },

      // Called with the mode resolved by the adapter for the initial attempt.
      markEndpointModeTried(mode) {
        if (autoEndpointTried) autoEndpointTried.add(String(mode || ''));
      },

      // Decide the next compatibility attempt for a failed request.
      // `current.baseInput` is the user-facing aiBaseURL (NOT the adapter's
      // resolved endpoint URL): the /v1 toggle swaps the trailing segment of
      // that input. Returns null when the normal retry path should proceed.
      nextCompatibilityAttempt(errorLike, current) {
        if (!isCompatibilitySwitchError(errorLike)) return null;

        if (wantsAutoEndpointMode && autoEndpointTried) {
          const nextMode = AUTO_ENDPOINT_CANDIDATES.find((mode) => !autoEndpointTried.has(mode));
          if (nextMode) {
            return { kind: 'endpoint_mode', nextMode };
          }
        }

        if (canTryV1Toggle && autoBaseUrlTried) {
          const currentBase = normalizeUrlNoTrailingSlash(current?.baseInput || '');
          const nextBase = toggleTrailingV1(currentBase);
          if (nextBase && !autoBaseUrlTried.has(nextBase)) {
            return { kind: 'base_url_v1', nextBase };
          }
        }

        return null;
      },

      // Called after the adapter re-resolved for a switch attempt.
      // Endpoint-mode probes accumulate (each candidate is tried exactly
      // once); a /v1 base change resets the mode budget so every mode is
      // re-probed against the new URL shape, mirroring the run engine's
      // original behavior.
      applySwitch(switchDecision, nextRuntime) {
        const nextMode = String(nextRuntime?.endpointMode || '');
        if (switchDecision.kind === 'base_url_v1') {
          autoEndpointTried?.clear();
          autoEndpointTried?.add(nextMode);
          autoBaseUrlTried?.add(String(switchDecision.nextBase || ''));
        } else {
          autoEndpointTried?.add(nextMode);
        }
      }
    };
  }

  const api = {
    AUTO_ENDPOINT_CANDIDATES,
    isAutoEndpointNotSupportedError: isCompatibilitySwitchError,
    canAutoToggleTrailingV1,
    createCompatibilityStateMachine
  };

  global.YilanEndpointProbe = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);

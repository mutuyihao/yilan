(function (global) {
  const OpenAIAdapter = global.AISummaryOpenAIAdapter || (typeof require === 'function' ? require('./openai-adapter.js') : null);
  const AnthropicAdapter = global.AISummaryAnthropicAdapter || (typeof require === 'function' ? require('./anthropic-adapter.js') : null);

  const ADAPTERS = [OpenAIAdapter, AnthropicAdapter].filter(Boolean);

  function listAdapters() {
    return ADAPTERS.slice();
  }

  function getAdapter(settings) {
    const provider = String(settings?.aiProvider || 'openai').toLowerCase();
    return ADAPTERS.find((adapter) => adapter.provider === provider) || null;
  }

  function resolve(settings) {
    const adapter = getAdapter(settings);
    if (!adapter) return null;

    const snapshot = adapter.resolve(settings || {});
    return { adapter, snapshot };
  }

  const api = {
    listAdapters,
    getAdapter,
    resolve
  };

  global.AISummaryAdapterRegistry = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

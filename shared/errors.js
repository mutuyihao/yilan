(function (global) {
  const ERROR_CODES = {
    CONFIG_MISSING_API_KEY: 'CONFIG_MISSING_API_KEY',
    EXTRACTION_EMPTY: 'EXTRACTION_EMPTY',
    ADAPTER_NOT_FOUND: 'ADAPTER_NOT_FOUND',
    NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
    NETWORK_ERROR: 'NETWORK_ERROR',
    HTTP_ERROR: 'HTTP_ERROR',
    PARSE_ERROR: 'PARSE_ERROR',
    UNSUPPORTED_RESPONSE_FORMAT: 'UNSUPPORTED_RESPONSE_FORMAT',
    RUN_CANCELLED: 'RUN_CANCELLED',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
  };

  const ERROR_CATALOG = {
    [ERROR_CODES.CONFIG_MISSING_API_KEY]: {
      message: '请先在设置中配置 API Key。',
      retriable: false
    },
    [ERROR_CODES.EXTRACTION_EMPTY]: {
      message: '当前页面未提取到足够的正文内容。',
      retriable: false
    },
    [ERROR_CODES.ADAPTER_NOT_FOUND]: {
      message: '未找到可用的模型适配器。',
      retriable: false
    },
    [ERROR_CODES.NETWORK_TIMEOUT]: {
      message: '请求超时，请稍后重试。',
      retriable: true
    },
    [ERROR_CODES.NETWORK_ERROR]: {
      message: '网络请求失败，请检查网络或接口地址。',
      retriable: true
    },
    [ERROR_CODES.HTTP_ERROR]: {
      message: '接口返回错误状态码。',
      retriable: true
    },
    [ERROR_CODES.PARSE_ERROR]: {
      message: '模型响应解析失败。',
      retriable: true
    },
    [ERROR_CODES.UNSUPPORTED_RESPONSE_FORMAT]: {
      message: '接口响应格式无法识别。',
      retriable: true
    },
    [ERROR_CODES.RUN_CANCELLED]: {
      message: '本次生成已取消。',
      retriable: true
    },
    [ERROR_CODES.UNKNOWN_ERROR]: {
      message: '发生未知错误。',
      retriable: true
    }
  };

  const CORE_FIELDS = new Set([
    'code',
    'message',
    'retriable',
    'detail',
    'stage',
    'provider',
    'endpointMode'
  ]);

  function copyExtraFields(target, source) {
    Object.keys(source || {}).forEach((key) => {
      if (CORE_FIELDS.has(key)) return;
      if (typeof source[key] === 'undefined') return;
      target[key] = source[key];
    });
    return target;
  }

  function createError(code, overrides) {
    const base = ERROR_CATALOG[code] || ERROR_CATALOG[ERROR_CODES.UNKNOWN_ERROR];
    const extra = overrides || {};

    const error = {
      code,
      message: extra.message || base.message,
      retriable: typeof extra.retriable === 'boolean' ? extra.retriable : base.retriable,
      detail: extra.detail || '',
      stage: extra.stage || '',
      provider: extra.provider || '',
      endpointMode: extra.endpointMode || ''
    };

    return copyExtraFields(error, extra);
  }

  function normalizeError(input, fallbackCode, overrides) {
    if (input && typeof input === 'object' && input.code && input.message) {
      return createError(input.code, Object.assign({}, input, overrides));
    }

    const fallback = fallbackCode || ERROR_CODES.UNKNOWN_ERROR;
    const detail = input && input.message ? input.message : String(input || '');
    return createError(fallback, Object.assign({ detail }, overrides));
  }

  function createHttpError(status, body, overrides) {
    const detail = String(body || '').trim().slice(0, 300);
    const message = detail ? `接口返回 ${status}：${detail}` : `接口返回 ${status}`;
    return createError(ERROR_CODES.HTTP_ERROR, Object.assign({ message, detail }, overrides));
  }

  function getUserMessage(errorLike) {
    const error = normalizeError(errorLike);
    return error.message;
  }

  const api = {
    ERROR_CODES,
    ERROR_CATALOG,
    createError,
    normalizeError,
    createHttpError,
    getUserMessage
  };

  global.AISummaryErrors = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

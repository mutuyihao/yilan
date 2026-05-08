(function (global) {
  const OPENAI_ENDPOINT_MODES = ['auto', 'responses', 'chat_completions', 'legacy_completions'];
  const ANTHROPIC_ENDPOINT_MODES = ['messages'];

  const ENDPOINT_MODE_META = {
    auto: {
      label: '自动判断',
      description: '按 Base URL 试探最终接口；适合自建代理、OneAPI 类网关或暂未内置的兼容服务。'
    },
    responses: {
      label: 'Responses API',
      description: '优先使用新式 `/responses` 接口；适合 OpenAI 官方与部分新兼容网关。'
    },
    chat_completions: {
      label: 'Chat Completions',
      description: '兼容面最广；多数国产 OpenAI 兼容接口优先走 `/chat/completions`。'
    },
    legacy_completions: {
      label: 'Legacy Completions',
      description: '仅用于老式 `/completions` 接口；现代服务通常不建议默认使用。'
    },
    messages: {
      label: 'Messages API',
      description: '适用于 Anthropic / Claude 兼容接口，最终请求通常为 `/v1/messages`。'
    }
  };

  const GENERATED_AT = '2026-05-08T00:00:00.000Z';
  const VERIFIED_AT = '2026-05-08';

  const PROVIDERS = [
    {
      id: 'custom',
      label: '自定义兼容接口',
      hint: '适合自建代理、OneAPI 类网关或暂未内置的服务商。',
      sourceUrl: '',
      verifiedAt: VERIFIED_AT,
      routes: [
        {
          routeId: 'custom-openai',
          label: 'OpenAI 兼容',
          aiProvider: 'openai',
          baseUrl: '',
          endpointModes: OPENAI_ENDPOINT_MODES,
          defaultEndpointMode: 'auto',
          defaultModel: 'gpt-4o-mini',
          keyHint: '使用目标网关提供的 API Key。',
          hint: '填写网关根地址或完整 endpoint；连接测试会尽量识别可用接口。',
          isDefault: true
        },
        {
          routeId: 'custom-anthropic',
          label: 'Anthropic 兼容',
          aiProvider: 'anthropic',
          baseUrl: '',
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          defaultModel: 'claude-sonnet-4-20250514',
          keyHint: '使用目标 Claude 兼容网关提供的 API Key。',
          hint: '填写兼容网关根地址，插件会补成 `/v1/messages`。',
          isDefault: false
        }
      ]
    },
    {
      id: 'openai_official',
      label: 'OpenAI 官方',
      hint: '默认走 Responses API，也可在高级设置切到 Chat Completions 或 Legacy Completions。',
      sourceUrl: 'https://platform.openai.com/docs/api-reference',
      verifiedAt: VERIFIED_AT,
      routes: [
        {
          routeId: 'openai-official',
          label: 'OpenAI 官方 API',
          aiProvider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          endpointModes: ['responses', 'chat_completions', 'legacy_completions'],
          defaultEndpointMode: 'responses',
          defaultModel: 'gpt-4o-mini',
          keyHint: '使用 OpenAI API Key，通常以 `sk-` 开头。',
          hint: '填写根地址即可，插件会按 endpoint mode 补最终路径。',
          isDefault: true
        }
      ]
    },
    {
      id: 'anthropic_official',
      label: 'Anthropic 官方',
      hint: '使用 Claude 原生 Messages API，会自动保留官方 `anthropic-version` 头。',
      sourceUrl: 'https://docs.anthropic.com/en/api/messages',
      verifiedAt: VERIFIED_AT,
      routes: [
        {
          routeId: 'anthropic-official',
          label: 'Anthropic Messages API',
          aiProvider: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          defaultModel: 'claude-sonnet-4-20250514',
          keyHint: '使用 Anthropic API Key。',
          hint: '填写根地址即可，插件会自动补成 `/v1/messages`。',
          isDefault: true
        }
      ]
    },
    {
      id: 'deepseek',
      label: 'DeepSeek',
      hint: '兼容 OpenAI 与 Anthropic；默认使用 OpenAI Chat Completions。',
      sourceUrl: 'https://api-docs.deepseek.com/',
      verifiedAt: VERIFIED_AT,
      routes: [
        {
          routeId: 'deepseek-openai',
          label: 'OpenAI 兼容',
          aiProvider: 'openai',
          baseUrl: 'https://api.deepseek.com',
          endpointModes: ['chat_completions', 'legacy_completions'],
          defaultEndpointMode: 'chat_completions',
          defaultModel: 'deepseek-chat',
          keyHint: '使用 DeepSeek API Key。',
          hint: '聊天接口走 `/chat/completions`。',
          isDefault: true
        },
        {
          routeId: 'deepseek-anthropic',
          label: 'Anthropic 兼容',
          aiProvider: 'anthropic',
          baseUrl: 'https://api.deepseek.com/anthropic',
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          defaultModel: 'deepseek-chat',
          keyHint: '使用 DeepSeek API Key。',
          hint: 'Claude 兼容根地址为 `/anthropic`。',
          isDefault: false
        }
      ]
    },
    {
      id: 'gemini',
      label: 'Gemini / Google',
      hint: 'Gemini API 提供 OpenAI 兼容入口；默认走 Chat Completions。',
      sourceUrl: 'https://ai.google.dev/gemini-api/docs/openai',
      verifiedAt: VERIFIED_AT,
      routes: [
        {
          routeId: 'gemini-openai',
          label: 'OpenAI 兼容',
          aiProvider: 'openai',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          defaultModel: 'gemini-2.5-flash',
          keyHint: '使用 Google AI Studio 或 Gemini API Key。',
          hint: '官方 OpenAI 兼容根地址已包含 `/v1beta/openai`。',
          isDefault: true
        }
      ]
    },
    {
      id: 'qwen',
      label: 'Qwen / 百炼',
      hint: '支持 OpenAI 兼容与 Anthropic 兼容；默认使用 OpenAI 兼容入口。',
      sourceUrl: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
      verifiedAt: VERIFIED_AT,
      routes: [
        {
          routeId: 'qwen-openai',
          label: 'OpenAI 兼容',
          aiProvider: 'openai',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          defaultModel: 'qwen-plus',
          keyHint: '使用阿里云百炼 DashScope API Key。',
          hint: '最终请求会走 `/compatible-mode/v1/chat/completions`。',
          isDefault: true
        },
        {
          routeId: 'qwen-anthropic',
          label: 'Anthropic 兼容',
          aiProvider: 'anthropic',
          baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          defaultModel: 'qwen-plus',
          keyHint: '使用阿里云百炼 DashScope API Key。',
          hint: 'Anthropic 兼容根地址为 `/apps/anthropic`。',
          isDefault: false
        }
      ]
    },
    {
      id: 'glm',
      label: 'GLM / 智谱',
      hint: '同时提供 OpenAI 与 Claude 兼容接入；默认使用 OpenAI 兼容入口。',
      sourceUrl: 'https://docs.bigmodel.cn/cn/guide/start/compatible',
      verifiedAt: VERIFIED_AT,
      routes: [
        {
          routeId: 'glm-openai',
          label: 'OpenAI 兼容',
          aiProvider: 'openai',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          defaultModel: 'glm-5',
          keyHint: '使用智谱 API Key。',
          hint: '官方 OpenAI 兼容根地址是 `/api/paas/v4`。',
          isDefault: true
        },
        {
          routeId: 'glm-anthropic',
          label: 'Claude 兼容',
          aiProvider: 'anthropic',
          baseUrl: 'https://open.bigmodel.cn/api/anthropic',
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          defaultModel: 'glm-5',
          keyHint: '使用智谱 API Key。',
          hint: 'Claude 兼容根地址是 `/api/anthropic`。',
          isDefault: false
        }
      ]
    },
    {
      id: 'mimo',
      label: 'MiMo / 小米',
      hint: '提供按量 API 与 Token Plan 地域集群地址，API Key 前缀和地域需与地址匹配。',
      sourceUrl: 'https://platform.mimo.mi.com/docs',
      verifiedAt: VERIFIED_AT,
      routes: [
        {
          routeId: 'mimo-openai-metered',
          label: '按量 API · OpenAI 兼容',
          aiProvider: 'openai',
          baseUrl: 'https://api.xiaomimimo.com/v1',
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          defaultModel: 'mimo-v2.5-pro',
          keyHint: '按量 API Key 通常以 `sk-` 开头。',
          keyRule: {
            prefix: 'sk-',
            message: 'MiMo 按量 API 域名需要 `sk-` 开头的 API Key；Token Plan `tp-` 密钥不能混用。'
          },
          hint: '默认推荐路线，聊天接口走 `/chat/completions`。',
          isDefault: true
        },
        {
          routeId: 'mimo-openai-token-plan',
          label: 'Token Plan CN · OpenAI 兼容',
          aiProvider: 'openai',
          baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          defaultModel: 'mimo-v2.5-pro',
          keyHint: '使用 CN 地域 Token Plan API Key，通常以 `tp-` 开头；不同地域 Key 不通用。',
          keyRule: {
            prefix: 'tp-',
            message: 'MiMo Token Plan CN 域名需要对应地域的 `tp-` API Key；按量 `sk-` 密钥或其他地域 Key 不能混用。'
          },
          hint: '仅在使用 Token Plan Key 时选择。',
          isDefault: false
        },
        {
          routeId: 'mimo-openai-token-plan-sgp',
          label: 'Token Plan SGP · OpenAI 兼容',
          aiProvider: 'openai',
          baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          defaultModel: 'mimo-v2.5-pro',
          keyHint: '使用 SGP 地域 Token Plan API Key，通常以 `tp-` 开头；不同地域 Key 不通用。',
          keyRule: {
            prefix: 'tp-',
            message: 'MiMo Token Plan SGP 域名需要对应地域的 `tp-` API Key；按量 `sk-` 密钥或其他地域 Key 不能混用。'
          },
          hint: '新加坡地域 Token Plan OpenAI 兼容根地址。',
          isDefault: false
        },
        {
          routeId: 'mimo-openai-token-plan-ams',
          label: 'Token Plan AMS · OpenAI 兼容',
          aiProvider: 'openai',
          baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          defaultModel: 'mimo-v2.5-pro',
          keyHint: '使用 AMS 地域 Token Plan API Key，通常以 `tp-` 开头；不同地域 Key 不通用。',
          keyRule: {
            prefix: 'tp-',
            message: 'MiMo Token Plan AMS 域名需要对应地域的 `tp-` API Key；按量 `sk-` 密钥或其他地域 Key 不能混用。'
          },
          hint: '欧洲 AMS 地域 Token Plan OpenAI 兼容根地址。',
          isDefault: false
        },
        {
          routeId: 'mimo-anthropic-metered',
          label: '按量 API · Anthropic 兼容',
          aiProvider: 'anthropic',
          baseUrl: 'https://api.xiaomimimo.com/anthropic',
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          defaultModel: 'mimo-v2.5-pro',
          keyHint: '按量 API Key 通常以 `sk-` 开头。',
          keyRule: {
            prefix: 'sk-',
            message: 'MiMo 按量 API 域名需要 `sk-` 开头的 API Key；Token Plan `tp-` 密钥不能混用。'
          },
          hint: '最终端点为 `/v1/messages`。',
          isDefault: false
        },
        {
          routeId: 'mimo-anthropic-token-plan',
          label: 'Token Plan CN · Anthropic 兼容',
          aiProvider: 'anthropic',
          baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          defaultModel: 'mimo-v2.5-pro',
          keyHint: '使用 CN 地域 Token Plan API Key，通常以 `tp-` 开头；不同地域 Key 不通用。',
          keyRule: {
            prefix: 'tp-',
            message: 'MiMo Token Plan CN 域名需要对应地域的 `tp-` API Key；按量 `sk-` 密钥或其他地域 Key 不能混用。'
          },
          hint: '最终端点为 `/v1/messages`。',
          isDefault: false
        },
        {
          routeId: 'mimo-anthropic-token-plan-sgp',
          label: 'Token Plan SGP · Anthropic 兼容',
          aiProvider: 'anthropic',
          baseUrl: 'https://token-plan-sgp.xiaomimimo.com/anthropic',
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          defaultModel: 'mimo-v2.5-pro',
          keyHint: '使用 SGP 地域 Token Plan API Key，通常以 `tp-` 开头；不同地域 Key 不通用。',
          keyRule: {
            prefix: 'tp-',
            message: 'MiMo Token Plan SGP 域名需要对应地域的 `tp-` API Key；按量 `sk-` 密钥或其他地域 Key 不能混用。'
          },
          hint: '新加坡地域 Token Plan Anthropic 兼容根地址，最终端点为 `/v1/messages`。',
          isDefault: false
        },
        {
          routeId: 'mimo-anthropic-token-plan-ams',
          label: 'Token Plan AMS · Anthropic 兼容',
          aiProvider: 'anthropic',
          baseUrl: 'https://token-plan-ams.xiaomimimo.com/anthropic',
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          defaultModel: 'mimo-v2.5-pro',
          keyHint: '使用 AMS 地域 Token Plan API Key，通常以 `tp-` 开头；不同地域 Key 不通用。',
          keyRule: {
            prefix: 'tp-',
            message: 'MiMo Token Plan AMS 域名需要对应地域的 `tp-` API Key；按量 `sk-` 密钥或其他地域 Key 不能混用。'
          },
          hint: '欧洲 AMS 地域 Token Plan Anthropic 兼容根地址，最终端点为 `/v1/messages`。',
          isDefault: false
        }
      ]
    },
    {
      id: 'xai',
      label: 'xAI / Grok',
      hint: '同时提供 Chat Completions 与 Responses；默认使用 Responses API。',
      sourceUrl: 'https://docs.x.ai/docs/api-reference',
      verifiedAt: VERIFIED_AT,
      routes: [
        {
          routeId: 'xai-openai',
          label: 'OpenAI 兼容',
          aiProvider: 'openai',
          baseUrl: 'https://api.x.ai/v1',
          endpointModes: ['responses', 'chat_completions'],
          defaultEndpointMode: 'responses',
          defaultModel: 'grok-4-1-fast-reasoning',
          keyHint: '使用 xAI API Key。',
          hint: '官方 OpenAI 兼容根地址是 `https://api.x.ai/v1`。',
          isDefault: true
        }
      ]
    },
    {
      id: 'minimax',
      label: 'MiniMax',
      hint: '同时支持 OpenAI 与 Anthropic 兼容；默认使用 OpenAI 兼容入口。',
      sourceUrl: 'https://platform.minimaxi.com/document',
      verifiedAt: VERIFIED_AT,
      routes: [
        {
          routeId: 'minimax-openai',
          label: 'OpenAI 兼容',
          aiProvider: 'openai',
          baseUrl: 'https://api.minimaxi.com/v1',
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          defaultModel: 'MiniMax-M2.7',
          keyHint: '使用 MiniMax API Key。',
          hint: '国内默认根地址是 `https://api.minimaxi.com/v1`。',
          isDefault: true
        },
        {
          routeId: 'minimax-anthropic',
          label: 'Anthropic 兼容',
          aiProvider: 'anthropic',
          baseUrl: 'https://api.minimaxi.com/anthropic',
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          defaultModel: 'MiniMax-M2.7',
          keyHint: '使用 MiniMax API Key。',
          hint: 'Anthropic 兼容根地址是 `/anthropic`。',
          isDefault: false
        }
      ]
    },
    {
      id: 'doubao',
      label: 'Doubao / 火山方舟',
      hint: '提供 Chat、Responses 与 Anthropic 兼容；默认使用 OpenAI Chat Completions。',
      sourceUrl: 'https://www.volcengine.com/docs/82379',
      verifiedAt: VERIFIED_AT,
      routes: [
        {
          routeId: 'doubao-openai',
          label: 'OpenAI 兼容',
          aiProvider: 'openai',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
          endpointModes: ['responses', 'chat_completions'],
          defaultEndpointMode: 'chat_completions',
          defaultModel: 'doubao-seed-code-preview-251028',
          keyHint: '使用火山方舟 API Key。',
          hint: '按量接口 Chat / Responses 共用该根地址。',
          isDefault: true
        },
        {
          routeId: 'doubao-anthropic',
          label: 'Anthropic 兼容',
          aiProvider: 'anthropic',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/compatible',
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          defaultModel: 'doubao-seed-code-preview-251028',
          keyHint: '使用火山方舟 API Key。',
          hint: 'Anthropic 兼容根地址是 `/api/compatible`。',
          isDefault: false
        }
      ]
    },
    {
      id: 'hunyuan',
      label: 'Hunyuan / 腾讯混元',
      hint: '支持 OpenAI 与 Anthropic 兼容；默认使用 OpenAI 兼容入口。',
      sourceUrl: 'https://cloud.tencent.com/document/product/1729',
      verifiedAt: VERIFIED_AT,
      routes: [
        {
          routeId: 'hunyuan-openai',
          label: 'OpenAI 兼容',
          aiProvider: 'openai',
          baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          defaultModel: 'hunyuan-turbos-latest',
          keyHint: '使用腾讯混元 API Key。',
          hint: '官方 OpenAI 兼容根地址是 `https://api.hunyuan.cloud.tencent.com/v1`。',
          isDefault: true
        },
        {
          routeId: 'hunyuan-anthropic',
          label: 'Anthropic 兼容',
          aiProvider: 'anthropic',
          baseUrl: 'https://api.hunyuan.cloud.tencent.com/anthropic',
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          defaultModel: 'hunyuan-2.0-instruct-20251111',
          keyHint: '使用腾讯混元 API Key。',
          hint: '官方 Anthropic 兼容根地址是 `/anthropic`。',
          isDefault: false
        }
      ]
    }
  ];

  function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function listProviders() {
    return cloneValue(PROVIDERS);
  }

  function getProvider(id) {
    const key = String(id || '').trim();
    const provider = PROVIDERS.find((item) => item.id === key) || PROVIDERS[0];
    return cloneValue(provider);
  }

  const api = {
    generatedAt: GENERATED_AT,
    ENDPOINT_MODE_META: cloneValue(ENDPOINT_MODE_META),
    listProviders,
    getProvider
  };

  global.AISummaryProviderCatalog = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

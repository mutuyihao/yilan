(function (global) {
  const OPENAI_ENDPOINT_MODES = ['auto', 'responses', 'chat_completions', 'legacy_completions'];
  const ANTHROPIC_ENDPOINT_MODES = ['messages'];

  const ENDPOINT_MODE_META = {
    auto: {
      label: '自动判断',
      description: '按 Base URL 猜测最终接口；适合完全自定义的兼容网关。'
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

  const PRESETS = [
    {
      id: 'custom',
      label: '自定义兼容接口',
      hint: '自由填写 Base URL，适合自建代理、OneAPI 类网关或暂未内置的厂商。',
      defaultProvider: 'openai',
      providerProfiles: {
        openai: {
          endpointModes: OPENAI_ENDPOINT_MODES,
          defaultEndpointMode: 'auto',
          baseUrl: '',
          defaultModel: 'gpt-4o-mini',
          hint: '如果厂商文档给的是 SDK 根地址，建议同时显式选择 endpoint mode。'
        },
        anthropic: {
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          baseUrl: '',
          defaultModel: 'claude-sonnet-4-20250514',
          hint: '兼容 Anthropic 的第三方接口通常建议填写根地址，再由插件补成 `/v1/messages`。'
        }
      }
    },
    {
      id: 'openai_official',
      label: 'OpenAI 官方',
      hint: '默认推荐 `/responses`；也可切到 `/chat/completions` 或旧 `/completions`。',
      defaultProvider: 'openai',
      providerProfiles: {
        openai: {
          endpointModes: ['responses', 'chat_completions', 'legacy_completions'],
          defaultEndpointMode: 'responses',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-4o-mini',
          hint: '填写根地址即可，插件会按显式 endpoint mode 补最终路径。'
        }
      }
    },
    {
      id: 'anthropic_official',
      label: 'Anthropic 官方',
      hint: '使用 Claude 原生 Messages API，会自动保留官方 `anthropic-version` 头。',
      defaultProvider: 'anthropic',
      providerProfiles: {
        anthropic: {
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          baseUrl: 'https://api.anthropic.com',
          defaultModel: 'claude-sonnet-4-20250514',
          hint: '填写根地址即可，插件会自动补成 `/v1/messages`。'
        }
      }
    },
    {
      id: 'deepseek',
      label: 'DeepSeek',
      hint: '兼容 OpenAI 与 Anthropic；旧 OpenAI 生态优先推荐 Chat Completions。',
      defaultProvider: 'openai',
      providerProfiles: {
        openai: {
          endpointModes: ['chat_completions', 'legacy_completions'],
          defaultEndpointMode: 'chat_completions',
          baseUrl: 'https://api.deepseek.com',
          defaultModel: 'deepseek-chat',
          hint: '官方文档提供 `https://api.deepseek.com` 或 `/v1` 根地址，聊天接口走 `/chat/completions`。'
        },
        anthropic: {
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          baseUrl: 'https://api.deepseek.com/anthropic',
          defaultModel: 'deepseek-chat',
          hint: 'DeepSeek Anthropic 兼容根地址为 `/anthropic`。'
        }
      }
    },
    {
      id: 'gemini',
      label: 'Gemini / Google',
      hint: 'Gemini API 已提供 OpenAI 兼容入口；当前建议直接走 Chat Completions。',
      defaultProvider: 'openai',
      providerProfiles: {
        openai: {
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
          defaultModel: 'gemini-2.5-flash',
          hint: '官方 OpenAI 兼容根地址是 `https://generativelanguage.googleapis.com/v1beta/openai`。'
        }
      }
    },
    {
      id: 'qwen',
      label: 'Qwen / 百炼',
      hint: '支持 OpenAI 兼容与 Anthropic 兼容；Anthropic 兼容不建议带官方 Anthropic 版本头。',
      defaultProvider: 'openai',
      providerProfiles: {
        openai: {
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          defaultModel: 'qwen-plus',
          hint: '国内默认使用北京地域根地址；HTTP 最终端点为 `/compatible-mode/v1/chat/completions`。'
        },
        anthropic: {
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
          defaultModel: 'qwen-plus',
          hint: 'Anthropic 兼容根地址为 `/apps/anthropic`，最终端点为 `/v1/messages`。'
        }
      }
    },
    {
      id: 'glm',
      label: 'GLM / 智谱',
      hint: '同时提供 OpenAI 与 Claude 兼容接入，适合 Cline / Claude Code / 自定义插件统一配置。',
      defaultProvider: 'openai',
      providerProfiles: {
        openai: {
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          defaultModel: 'glm-5',
          hint: '官方 OpenAI 兼容根地址是 `/api/paas/v4`。'
        },
        anthropic: {
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          baseUrl: 'https://open.bigmodel.cn/api/anthropic',
          defaultModel: 'glm-5',
          hint: 'Claude 兼容根地址是 `/api/anthropic`。'
        }
      }
    },
    {
      id: 'xai',
      label: 'xAI / Grok',
      hint: 'xAI 同时提供 Chat Completions 与 Responses；官方更偏向新的 Responses API。',
      defaultProvider: 'openai',
      providerProfiles: {
        openai: {
          endpointModes: ['responses', 'chat_completions'],
          defaultEndpointMode: 'responses',
          baseUrl: 'https://api.x.ai/v1',
          defaultModel: 'grok-4-1-fast-reasoning',
          hint: '官方 OpenAI 兼容根地址是 `https://api.x.ai/v1`，建议默认走 `/responses`。'
        }
      }
    },
    {
      id: 'minimax',
      label: 'MiniMax',
      hint: '同时支持 OpenAI 与 Anthropic 兼容；官方文档更推荐 Anthropic 生态接入编码场景。',
      defaultProvider: 'openai',
      providerProfiles: {
        openai: {
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          baseUrl: 'https://api.minimaxi.com/v1',
          defaultModel: 'MiniMax-M2.7',
          hint: '国内默认根地址是 `https://api.minimaxi.com/v1`。'
        },
        anthropic: {
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          baseUrl: 'https://api.minimaxi.com/anthropic',
          defaultModel: 'MiniMax-M2.7',
          hint: 'Anthropic 兼容根地址是 `https://api.minimaxi.com/anthropic`。'
        }
      }
    },
    {
      id: 'doubao',
      label: 'Doubao / 火山方舟',
      hint: '火山方舟已提供 Chat、Responses 与 Anthropic 兼容，适合后续继续扩展编程模型与视觉模型。',
      defaultProvider: 'openai',
      providerProfiles: {
        openai: {
          endpointModes: ['responses', 'chat_completions'],
          defaultEndpointMode: 'chat_completions',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
          defaultModel: 'doubao-seed-code-preview-251028',
          hint: '按量接口 Chat / Responses 共用 `https://ark.cn-beijing.volces.com/api/v3` 根地址。'
        },
        anthropic: {
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/compatible',
          defaultModel: 'doubao-seed-code-preview-251028',
          hint: 'Anthropic 兼容根地址是 `https://ark.cn-beijing.volces.com/api/compatible`。'
        }
      }
    },
    {
      id: 'hunyuan',
      label: 'Hunyuan / 腾讯混元',
      hint: '支持 OpenAI 与 Anthropic 兼容；OpenAI 路线更通用，Anthropic 路线更适合 Claude 生态迁移。',
      defaultProvider: 'openai',
      providerProfiles: {
        openai: {
          endpointModes: ['chat_completions'],
          defaultEndpointMode: 'chat_completions',
          baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
          defaultModel: 'hunyuan-turbos-latest',
          hint: '官方 OpenAI 兼容根地址是 `https://api.hunyuan.cloud.tencent.com/v1`。'
        },
        anthropic: {
          endpointModes: ANTHROPIC_ENDPOINT_MODES,
          defaultEndpointMode: 'messages',
          baseUrl: 'https://api.hunyuan.cloud.tencent.com/anthropic',
          defaultModel: 'hunyuan-2.0-instruct-20251111',
          hint: '官方 Anthropic 兼容根地址是 `https://api.hunyuan.cloud.tencent.com/anthropic`。'
        }
      }
    }
  ];

  function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getPreset(id) {
    const key = String(id || '').trim();
    return PRESETS.find((item) => item.id === key) || PRESETS[0];
  }

  function listPresets() {
    return PRESETS.map((item) => cloneValue(item));
  }

  function getProviderProfile(presetId, provider) {
    const preset = getPreset(presetId);
    const providerId = String(provider || '').toLowerCase();
    const profile = preset.providerProfiles?.[providerId];
    return profile ? cloneValue(profile) : null;
  }

  function getProviderOptions(presetId) {
    const preset = getPreset(presetId);
    return Object.keys(preset.providerProfiles || {});
  }

  function normalizeProvider(provider, presetId) {
    const candidates = getProviderOptions(presetId);
    const normalized = String(provider || '').toLowerCase();
    return candidates.includes(normalized) ? normalized : (candidates[0] || 'openai');
  }

  function getEndpointModes(presetId, provider) {
    const normalizedProvider = normalizeProvider(provider, presetId);
    const profile = getProviderProfile(presetId, normalizedProvider);
    if (profile?.endpointModes?.length) {
      return profile.endpointModes.slice();
    }
    return normalizedProvider === 'anthropic' ? ANTHROPIC_ENDPOINT_MODES.slice() : OPENAI_ENDPOINT_MODES.slice();
  }

  function normalizeEndpointMode(mode, provider, presetId) {
    const candidates = getEndpointModes(presetId, provider);
    const normalized = String(mode || '').trim();
    if (candidates.includes(normalized)) {
      return normalized;
    }

    const profile = getProviderProfile(presetId, provider);
    if (profile?.defaultEndpointMode && candidates.includes(profile.defaultEndpointMode)) {
      return profile.defaultEndpointMode;
    }

    return candidates[0] || (String(provider || '').toLowerCase() === 'anthropic' ? 'messages' : 'auto');
  }

  function inferPresetFromSettings(settings) {
    const baseUrl = String(settings?.aiBaseURL || '').trim().toLowerCase();
    const provider = String(settings?.aiProvider || '').toLowerCase();
    const model = String(settings?.modelName || '').trim().toLowerCase();

    if (baseUrl.includes('api.anthropic.com')) return 'anthropic_official';
    if (baseUrl.includes('api.openai.com')) return 'openai_official';
    if (baseUrl.includes('api.deepseek.com')) return 'deepseek';
    if (baseUrl.includes('generativelanguage.googleapis.com')) return 'gemini';
    if (baseUrl.includes('dashscope.aliyuncs.com')) return 'qwen';
    if (baseUrl.includes('api.x.ai')) return 'xai';
    if (baseUrl.includes('open.bigmodel.cn')) return 'glm';
    if (baseUrl.includes('api.minimaxi.com') || baseUrl.includes('api.minimax.io')) return 'minimax';
    if (baseUrl.includes('ark.cn-beijing.volces.com')) return 'doubao';
    if (baseUrl.includes('api.hunyuan.cloud.tencent.com')) return 'hunyuan';

    if (provider === 'anthropic' && model.startsWith('claude')) return 'anthropic_official';
    if (provider === 'openai' && model.startsWith('gemini')) return 'gemini';
    if (provider === 'openai' && model.startsWith('grok')) return 'xai';
    if (provider === 'openai' && (model.startsWith('gpt-') || model.startsWith('o'))) return 'openai_official';
    if (provider === 'anthropic') return 'anthropic_official';
    if (provider === 'openai') return 'openai_official';
    return 'custom';
  }

  const api = {
    ENDPOINT_MODE_META: cloneValue(ENDPOINT_MODE_META),
    listPresets,
    getPreset,
    getProviderProfile,
    getProviderOptions,
    getEndpointModes,
    normalizeProvider,
    normalizeEndpointMode,
    inferPresetFromSettings
  };

  global.AISummaryProviderPresets = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

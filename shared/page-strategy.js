(function (global) {
  const SITE_STRATEGIES = {
    unknown: {
      strategyId: 'general_reader',
      label: '通用精读',
      description: '平衡提炼结构、关键事实、核心结论与后续价值。',
      promptFocus: '请优先提炼页面结构、关键事实、核心结论与可复用信息。',
      chunkPromptFocus: '请只保留当前分段的核心信息、事实和结论，避免跨段推测。',
      synthesisPromptFocus: '请把分段结果整合成一份结构清晰、适合快速回看的总结。',
      secondaryPromptFocus: '二次生成时请严格基于已有摘要，不补充摘要中不存在的事实。',
      preferredSummaryMode: 'medium',
      chunkMaxChars: 3600,
      minChunkChars: 1200,
      chunkingMode: 'paragraph_split'
    },
    news: {
      strategyId: 'news_briefing',
      label: '新闻速读',
      description: '优先时间线、事件主体、关键事实、直接影响与未决问题。',
      promptFocus: '请优先整理事件背景、关键时间线、涉及主体、重要事实、直接影响和后续观察点，避免无依据推测。',
      chunkPromptFocus: '请只总结当前分段中的事实、引用、时间点和影响，不要外推。',
      synthesisPromptFocus: '请整合成一份适合快速了解事件的简报，按背景、事实、影响、待观察问题组织。',
      secondaryPromptFocus: '二次生成时请把事实转成更便于复盘或执行的形式，但不要改变事实边界。',
      preferredSummaryMode: 'short',
      chunkMaxChars: 3800,
      minChunkChars: 1200,
      chunkingMode: 'timeline_split'
    },
    blog: {
      strategyId: 'blog_insight',
      label: '博客洞察',
      description: '优先作者观点、论证逻辑、案例与可迁移经验。',
      promptFocus: '请提炼作者的核心观点、论证过程、案例支撑、经验总结与适用边界。',
      chunkPromptFocus: '请抓住当前分段中的观点、论据、案例和作者判断。',
      synthesisPromptFocus: '请整合成一份有逻辑层次的观点总结，保留主要论证链路和启发。',
      secondaryPromptFocus: '二次生成时优先提炼方法、启发和适用条件。',
      preferredSummaryMode: 'medium',
      chunkMaxChars: 3600,
      minChunkChars: 1200,
      chunkingMode: 'paragraph_split'
    },
    doc: {
      strategyId: 'doc_reference',
      label: '文档精读',
      description: '优先目标、前置条件、步骤、接口、限制与示例。',
      promptFocus: '请优先整理目标、前置条件、关键步骤、接口或参数、限制、示例与注意事项，保留术语准确性。',
      chunkPromptFocus: '请只总结当前分段中出现的步骤、接口、参数、限制或示例，不要漏掉技术细节。',
      synthesisPromptFocus: '请按目标、前置条件、步骤、接口或参数、限制、示例整理成结构化结果。',
      secondaryPromptFocus: '二次生成时优先保留参数名、接口名、步骤顺序和注意事项。',
      preferredSummaryMode: 'long',
      chunkMaxChars: 3200,
      minChunkChars: 1000,
      chunkingMode: 'section_split'
    },
    forum: {
      strategyId: 'forum_distillation',
      label: '问答归纳',
      description: '优先问题背景、约束条件、候选方案、最佳答案与分歧。',
      promptFocus: '请整理提问背景、关键约束、主要回答、推荐方案、争议点和适用条件。',
      chunkPromptFocus: '请只保留当前分段中的问题、回答、建议或反例，明确是谁在表达什么。',
      synthesisPromptFocus: '请合成为一份问题导向的总结，按问题、候选方案、推荐方案、风险或争议组织。',
      secondaryPromptFocus: '二次生成时优先把结论转成问答卡片、风险清单或执行建议。',
      preferredSummaryMode: 'qa',
      chunkMaxChars: 3000,
      minChunkChars: 1000,
      chunkingMode: 'thread_split'
    },
    repo: {
      strategyId: 'repo_walkthrough',
      label: 'README 导读',
      description: '优先项目目标、安装方式、核心能力、使用路径与限制。',
      promptFocus: '请优先整理项目目标、安装方式、核心能力、使用路径、关键模块、约束与适用场景。',
      chunkPromptFocus: '请只总结当前分段中的安装、配置、使用、架构或限制信息。',
      synthesisPromptFocus: '请整合成一份便于快速上手的导读，按项目目标、安装、使用、结构、限制组织。',
      secondaryPromptFocus: '二次生成时优先输出上手步骤、关键概念和风险提醒。',
      preferredSummaryMode: 'key_points',
      chunkMaxChars: 3200,
      minChunkChars: 1000,
      chunkingMode: 'section_split'
    }
  };

  function cloneStrategy(sourceType, config) {
    return Object.assign({ sourceType: sourceType || 'unknown' }, config || SITE_STRATEGIES.unknown);
  }

  function resolveStrategy(input) {
    const sourceType = String(input?.sourceType || 'unknown');
    return cloneStrategy(sourceType, SITE_STRATEGIES[sourceType] || SITE_STRATEGIES.unknown);
  }

  const api = {
    SITE_STRATEGIES,
    resolveStrategy
  };

  global.AISummaryPageStrategy = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

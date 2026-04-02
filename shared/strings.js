(function (global) {
  const MARKDOWN_OUTPUT_RULES = [
    '请遵守以下 Markdown 输出要求：',
    '- 只输出 Markdown 正文，不要写“下面是总结”之类的前言或解释。',
    '- 不要把整篇答案包在 ```markdown``` 或其他代码块里。',
    '- 不要重复文章标题作为一级标题，优先从二级标题开始组织。',
    '- 优先使用简洁的标题和列表；每个列表项尽量只表达一个信息点。',
    '- 每个段落尽量控制在 1-2 句，避免形成大段文字墙。',
    '- 信息不足时宁可省略，也不要编造、外推或补全原文没有明确给出的事实。',
    '- 除非这个模式确实需要，否则不要使用表格；优先使用标题和列表。'
  ].join('\n');

  const SUMMARY_MODES = {
    short: {
      label: '简短总结',
      description: '适合快速扫读，输出 3-5 个重点。',
      prompt: '请将以下网页压缩成一份适合 30 秒内扫完的摘要，先给出一句话结论，再列出最值得记住的 3-5 个要点。优先保留结论、关键事实、数字、对象和判断，不要展开成大段分析。',
      formatHint: [
        '## 一句话结论',
        '用 1 句话概括全文最核心的信息。',
        '',
        '## 关键要点',
        '- 输出 3-5 条高信息密度要点。'
      ].join('\n')
    },
    medium: {
      label: '标准总结',
      description: '兼顾完整性与可读性。',
      prompt: '请输出一份兼顾完整性与可读性的结构化总结，覆盖主题、关键信息、论证或事实依据、最终结论和值得关注的细节。',
      formatHint: [
        '## 核心结论',
        '用 1-2 句概括全文主题与主要结论。',
        '',
        '## 关键信息',
        '- 归纳核心事实、观点、论据或步骤。',
        '',
        '## 值得关注',
        '- 提炼风险、限制、启发或后续观察点。'
      ].join('\n')
    },
    long: {
      label: '详细分析',
      description: '适合深入理解长文。',
      prompt: '请对以下网页做一份适合深入阅读和回顾的详细分析，说明背景、结构脉络、关键观点或步骤、重要事实或数据、结论与启发。',
      formatHint: [
        '## 背景与主题',
        '## 关键内容拆解',
        '## 重要事实 / 数据',
        '## 结论与启发'
      ].join('\n')
    },
    key_points: {
      label: '关键要点',
      description: '提取最值得记住的信息。',
      prompt: '请只提炼最值得记住和复用的高价值信息，宁少勿杂。优先保留结论、风险、反常识点、可迁移经验和关键判断。',
      formatHint: [
        '## 最重要的要点',
        '- 输出 5-8 条高价值要点。',
        '',
        '## 风险与提醒',
        '- 只有存在明确风险、限制或前提时再写。'
      ].join('\n')
    },
    action_items: {
      label: '行动项',
      description: '转成可执行清单。',
      prompt: '请把内容转成可直接执行的行动清单。每项都要明确动作、对象或产出；如果有前置依赖、优先级、风险，也一起点明。',
      formatHint: [
        '## 可立即执行',
        '1. 每项以动词开头，写清动作和产出。',
        '',
        '## 后续跟进',
        '1. 列出需要后续推进、观察或补充的信息。',
        '',
        '## 风险与注意事项',
        '- 只保留真正影响执行的限制或风险。'
      ].join('\n')
    },
    glossary: {
      label: '术语表',
      description: '整理概念与术语。',
      prompt: '请整理成便于速查的术语卡，不要用大表格，优先用短列表。每个术语都要包含简明定义和它在本文中的意义。',
      formatHint: [
        '## 核心术语',
        '- 术语：简明定义。补一句它在本文中的作用或上下文。',
        '',
        '## 易混点',
        '- 只有存在容易混淆的概念时再写。'
      ].join('\n')
    },
    qa: {
      label: '问答卡片',
      description: '转成便于复习的 Q&A。',
      prompt: '请整理成便于复习和转发的问答卡片。问题要短、答案要准，覆盖文章最重要的概念、结论、限制和细节。',
      formatHint: [
        '## Q1. 问题',
        'A: 用 1-3 句回答。',
        '',
        '## Q2. 问题',
        'A: 继续补充关键卡片，避免重复。'
      ].join('\n')
    }
  };

  const SECONDARY_MODE_KEYS = ['action_items', 'glossary', 'qa'];

  const SITE_TYPE_LABELS = {
    unknown: '通用网页',
    news: '新闻',
    blog: '博客',
    doc: '文档',
    forum: '社区问答',
    repo: '代码仓库'
  };

  const STATUS_TEXT = {
    idle: '就绪',
    loadingArticle: '正在提取网页内容...',
    generating: '正在生成总结...',
    chunking: '正在分段分析长文...',
    finalizing: '正在汇总最终结果...',
    cancelled: '已取消生成',
    completed: '生成完成',
    failed: '生成失败'
  };

  const api = {
    MARKDOWN_OUTPUT_RULES,
    SUMMARY_MODES,
    SECONDARY_MODE_KEYS,
    SITE_TYPE_LABELS,
    STATUS_TEXT
  };

  global.AISummaryStrings = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

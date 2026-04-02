(function (global) {
  const Domain = global.AISummaryDomain || (typeof require === 'function' ? require('./domain.js') : null);
  const Strings = global.AISummaryStrings || (typeof require === 'function' ? require('./strings.js') : null);
  const PageStrategy = global.AISummaryPageStrategy || (typeof require === 'function' ? require('./page-strategy.js') : null);

  const DEFAULT_MAX_CAPTURE_CHARS = 28000;
  const DEFAULT_CHUNK_SIZE = 3600;
  const DEFAULT_MIN_CHUNK_SIZE = 1400;

  function readMetaContent(doc, selectors) {
    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      if (!element) continue;
      const content = element.getAttribute('content') || element.textContent || '';
      if (String(content).trim()) {
        return String(content).trim();
      }
    }
    return '';
  }

  function splitLargeParagraph(paragraph, maxChars) {
    const sentences = paragraph.split(/(?<=[。！？.!?])\s+/);
    if (sentences.length <= 1) {
      const parts = [];
      let index = 0;
      while (index < paragraph.length) {
        parts.push(paragraph.slice(index, index + maxChars));
        index += maxChars;
      }
      return parts;
    }

    const output = [];
    let current = '';
    for (const sentence of sentences) {
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length > maxChars && current) {
        output.push(current.trim());
        current = sentence;
      } else {
        current = candidate;
      }
    }
    if (current.trim()) {
      output.push(current.trim());
    }
    return output;
  }

  function splitTextIntoChunks(text, options) {
    const normalized = Domain.normalizeWhitespace(text || '');
    if (!normalized) return [];

    const maxChars = options?.maxChars || DEFAULT_CHUNK_SIZE;
    const minChunkChars = options?.minChunkChars || DEFAULT_MIN_CHUNK_SIZE;
    const paragraphs = normalized
      .split(/\n\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .flatMap((paragraph) => (paragraph.length > maxChars ? splitLargeParagraph(paragraph, maxChars) : [paragraph]));

    const chunks = [];
    let buffer = [];
    let size = 0;

    function flush() {
      if (!buffer.length) return;
      const content = buffer.join('\n\n').trim();
      chunks.push({
        chunkId: Domain.createRuntimeId('chunk'),
        index: chunks.length,
        content,
        charLength: content.length
      });
      buffer = [];
      size = 0;
    }

    for (const paragraph of paragraphs) {
      const candidateSize = size ? size + paragraph.length + 2 : paragraph.length;
      if (candidateSize > maxChars && size >= minChunkChars) {
        flush();
      }
      buffer.push(paragraph);
      size = size ? size + paragraph.length + 2 : paragraph.length;
    }

    flush();

    return chunks.length ? chunks : [{
      chunkId: Domain.createRuntimeId('chunk'),
      index: 0,
      content: normalized,
      charLength: normalized.length
    }];
  }

  function computeWarnings(snapshot) {
    const warnings = [];
    if (!snapshot.title) warnings.push('missing_title');
    if (!snapshot.cleanText) warnings.push('empty_content');
    if (snapshot.cleanText && snapshot.cleanText.length < 200) warnings.push('very_short_content');
    if (snapshot.isTruncated) warnings.push('content_truncated');
    return warnings;
  }

  function computeQualityScore(snapshot) {
    let score = 100;
    if (!snapshot.title) score -= 10;
    if (!snapshot.cleanText) score -= 60;
    if (snapshot.cleanText.length < 500) score -= 20;
    if (snapshot.isTruncated) score -= 15;
    if (snapshot.sourceType === 'unknown') score -= 5;
    return Math.max(0, score);
  }

  function buildStrategyHints(article) {
    const strategy = article?.sourceStrategy || PageStrategy.resolveStrategy({ sourceType: article?.sourceType });
    return [
      `页面类型: ${(Strings.SITE_TYPE_LABELS[article?.sourceType] || article?.sourceType || '通用网页')}`,
      `页面策略: ${strategy.label}`,
      `策略说明: ${strategy.description}`,
      `来源站点: ${article?.siteName || article?.sourceHost || '未知'}`,
      article?.author ? `作者: ${article.author}` : '',
      article?.publishedAt ? `发布时间: ${article.publishedAt}` : ''
    ].filter(Boolean).join('\n');
  }

  function buildArticleSnapshot(input) {
    const sourceUrl = input.sourceUrl || '';
    const canonicalUrl = input.meta?.canonicalUrl || '';
    const normalizedUrl = Domain.normalizeUrl(canonicalUrl || sourceUrl);
    const sourceHost = Domain.getSourceHost(normalizedUrl || sourceUrl);
    const rawText = Domain.normalizeWhitespace(input.text || '');
    const captureLimit = input.maxChars || DEFAULT_MAX_CAPTURE_CHARS;

    let cleanText = rawText;
    let isTruncated = false;
    let truncationReason = '';
    if (cleanText.length > captureLimit) {
      cleanText = cleanText.slice(0, captureLimit);
      isTruncated = true;
      truncationReason = `capture_limit_${captureLimit}`;
    }
    cleanText = Domain.normalizeWhitespace(cleanText);

    const title = Domain.pickFirstNonEmpty([
      input.title,
      input.meta?.ogTitle,
      input.meta?.htmlTitle,
      sourceHost,
      '未命名页面'
    ]);
    const language = Domain.pickFirstNonEmpty([
      input.meta?.language,
      Domain.inferLanguage(cleanText, 'zh')
    ]);
    const sourceType = Domain.detectSiteType({
      url: normalizedUrl || sourceUrl,
      host: sourceHost,
      title,
      text: cleanText
    });
    const sourceStrategy = PageStrategy.resolveStrategy({
      sourceType,
      url: normalizedUrl || sourceUrl,
      host: sourceHost,
      title,
      text: cleanText
    });

    const contentHash = Domain.hashString(cleanText);
    const articleId = Domain.createDeterministicId('art', `${normalizedUrl}|${contentHash}`);
    const chunks = splitTextIntoChunks(cleanText, {
      maxChars: sourceStrategy.chunkMaxChars || DEFAULT_CHUNK_SIZE,
      minChunkChars: sourceStrategy.minChunkChars || DEFAULT_MIN_CHUNK_SIZE
    });

    const snapshot = {
      articleId,
      canonicalUrl,
      normalizedUrl,
      sourceUrl,
      sourceHost,
      sourceType,
      sourceStrategy,
      sourceStrategyId: sourceStrategy.strategyId,
      preferredSummaryMode: sourceStrategy.preferredSummaryMode || 'medium',
      title,
      subtitle: input.meta?.description || '',
      author: input.meta?.author || '',
      siteName: input.meta?.siteName || sourceHost,
      publishedAt: Domain.toIsoString(input.meta?.publishedAt),
      language,
      rawText,
      cleanText,
      content: cleanText,
      excerpt: input.excerpt || '',
      contentHash,
      extractor: input.extractor || 'body_fallback',
      extractedAt: new Date().toISOString(),
      contentLength: cleanText.length,
      isTruncated,
      truncationReason,
      chunkingStrategy: chunks.length > 1 ? (sourceStrategy.chunkingMode || 'paragraph_split') : 'none',
      chunkCount: chunks.length,
      chunks,
      allowHistory: true,
      allowShare: true,
      retentionHint: 'persistent',
      diagnostics: {
        rawLength: rawText.length,
        captureLimit,
        sourceType,
        sourceStrategyId: sourceStrategy.strategyId,
        strategyLabel: sourceStrategy.label,
        chunkMaxChars: sourceStrategy.chunkMaxChars,
        minChunkChars: sourceStrategy.minChunkChars
      }
    };

    snapshot.warnings = computeWarnings(snapshot);
    snapshot.qualityScore = computeQualityScore(snapshot);
    return snapshot;
  }

  function buildLanguageInstruction(targetLanguage) {
    if (!targetLanguage || targetLanguage === 'auto') return '';
    const map = {
      zh: '请使用中文输出。',
      en: 'Please answer in English.',
      ja: '日本語で出力してください。',
      ko: '한국어로 출력해 주세요.',
      fr: 'Veuillez répondre en français.'
    };
    return map[targetLanguage] || `请使用 ${targetLanguage} 输出。`;
  }

  function buildMarkdownOutputGuidance(mode, options) {
    const includeTemplate = options?.includeTemplate !== false;
    return [
      '# 输出格式要求',
      Strings.MARKDOWN_OUTPUT_RULES || '',
      includeTemplate && mode?.formatHint ? '# 推荐输出骨架\n' + mode.formatHint : ''
    ].filter(Boolean).join('\n\n');
  }

  function buildChunkOutputGuidance() {
    return [
      '# 分段输出要求',
      '请把当前分段压缩成便于后续汇总的中间结果。',
      '- 只保留当前分段中最重要的信息，不要补全其它分段内容。',
      '- 优先使用 3-6 条简洁要点；只有在确有必要时再加 1-2 个小标题。',
      '- 如果当前分段主要是背景、过渡或例子，请用更短篇幅概括，不要硬凑结构。',
      '- 不要重复文章标题，不要写前言，不要把整篇答案包在代码块里。'
    ].join('\n');
  }

  function buildPrimaryPrompt(options) {
    const modeKey = options.summaryMode || 'medium';
    const mode = Strings.SUMMARY_MODES[modeKey] || Strings.SUMMARY_MODES.medium;
    const article = options.article;
    const strategy = article?.sourceStrategy || PageStrategy.resolveStrategy({ sourceType: article?.sourceType });
    const languageInstruction = buildLanguageInstruction(options.targetLanguage);

    return [
      mode.prompt,
      languageInstruction,
      buildMarkdownOutputGuidance(mode),
      '请尽量保留文章的结构和关键事实，避免空泛表述。',
      strategy.promptFocus,
      '# 页面上下文\n' + buildStrategyHints(article),
      `# 标题\n${article.title}`,
      article.subtitle ? `# 摘要说明\n${article.subtitle}` : '',
      '# 正文\n' + (article.cleanText || article.content || '')
    ].filter(Boolean).join('\n\n');
  }

  function buildChunkPrompt(options) {
    const modeKey = options.summaryMode || 'medium';
    const mode = Strings.SUMMARY_MODES[modeKey] || Strings.SUMMARY_MODES.medium;
    const article = options.article;
    const chunk = options.chunk;
    const strategy = article?.sourceStrategy || PageStrategy.resolveStrategy({ sourceType: article?.sourceType });
    const languageInstruction = buildLanguageInstruction(options.targetLanguage);

    return [
      '你正在帮助总结一篇长网页，这是其中一个分段。',
      mode.prompt,
      languageInstruction,
      buildChunkOutputGuidance(),
      strategy.chunkPromptFocus,
      '请只总结当前分段，并保留该分段中最关键的信息，避免重复其它分段可能出现的背景信息。',
      `页面策略: ${strategy.label}`,
      `当前分段: ${chunk.index + 1}/${article.chunkCount}`,
      `文章标题: ${article.title}`,
      '# 当前分段正文\n' + chunk.content
    ].filter(Boolean).join('\n\n');
  }

  function buildSynthesisPrompt(options) {
    const modeKey = options.summaryMode || 'medium';
    const mode = Strings.SUMMARY_MODES[modeKey] || Strings.SUMMARY_MODES.medium;
    const article = options.article;
    const strategy = article?.sourceStrategy || PageStrategy.resolveStrategy({ sourceType: article?.sourceType });
    const languageInstruction = buildLanguageInstruction(options.targetLanguage);
    const partialSummaries = options.partialSummaries || [];

    return [
      '以下是同一篇长网页分段总结后的结果，请把它们合成为一份完整、去重、结构清晰的最终总结。',
      mode.prompt,
      languageInstruction,
      buildMarkdownOutputGuidance(mode),
      strategy.synthesisPromptFocus,
      '请消除重复，补齐上下文，并确保最终输出像直接总结整篇文章一样自然。',
      `页面策略: ${strategy.label}`,
      `文章标题: ${article.title}`,
      '# 分段总结\n' + partialSummaries.map((item, index) => `## 分段 ${index + 1}\n${item}`).join('\n\n')
    ].join('\n\n');
  }

  function buildSecondaryPrompt(options) {
    const modeKey = options.summaryMode || 'action_items';
    const mode = Strings.SUMMARY_MODES[modeKey] || Strings.SUMMARY_MODES.action_items;
    const article = options.article || {};
    const strategy = article?.sourceStrategy || PageStrategy.resolveStrategy({ sourceType: article?.sourceType });
    const languageInstruction = buildLanguageInstruction(options.targetLanguage);

    return [
      '以下是网页原始摘要，请基于摘要内容进行二次加工。必要时可参考文章标题和来源。',
      mode.prompt,
      languageInstruction,
      buildMarkdownOutputGuidance(mode),
      strategy.secondaryPromptFocus,
      article.title ? `文章标题: ${article.title}` : '',
      article.sourceHost ? `来源站点: ${article.sourceHost}` : '',
      strategy.label ? `页面策略: ${strategy.label}` : '',
      '# 原始摘要\n' + (options.summaryMarkdown || '')
    ].filter(Boolean).join('\n\n');
  }

  function getSummaryModeOptions() {
    return Object.entries(Strings.SUMMARY_MODES).map(([value, config]) => ({
      value,
      label: config.label,
      description: config.description
    }));
  }

  const api = {
    DEFAULT_MAX_CAPTURE_CHARS,
    readMetaContent,
    splitTextIntoChunks,
    buildArticleSnapshot,
    buildPrimaryPrompt,
    buildChunkPrompt,
    buildSynthesisPrompt,
    buildSecondaryPrompt,
    getSummaryModeOptions
  };

  global.AISummaryArticle = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

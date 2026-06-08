(function (global) {
  function formatDuration(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '0ms';
    if (ms < 1000) return ms + 'ms';
    if (ms < 60000) {
      return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's';
    }

    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return minutes + 'm ' + seconds + 's';
  }

  function getRunStageLabel(stage, options) {
    switch (stage) {
      case 'chunk':
        return '\u5206\u6bb5\u603b\u7ed3';
      case 'synthesis':
        return '\u6700\u7ec8\u6c47\u603b';
      case 'secondary':
        return options?.secondaryModeLabel ? options.secondaryModeLabel + ' \u751f\u6210' : '\u7ee7\u7eed\u751f\u6210';
      case 'primary':
      default:
        return '\u4e3b\u6458\u8981\u751f\u6210';
    }
  }

  function getRunStatusLabel(status) {
    switch (status) {
      case 'completed':
        return '\u5df2\u5b8c\u6210';
      case 'failed':
        return '\u5931\u8d25';
      case 'cancelled':
        return '\u5df2\u53d6\u6d88';
      case 'starting':
        return '\u51c6\u5907\u4e2d';
      case 'running':
      default:
        return '\u8fdb\u884c\u4e2d';
    }
  }

  function pickTerminalRun(finalRun, errorLike) {
    return finalRun || errorLike?.diagnostics || null;
  }

  function buildTerminalRecordPatch(baseRecord, diagnostics, status, overrides) {
    const normalizedStatus = status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'completed';
    const safeDiagnostics = diagnostics || null;
    const extra = Object.assign({}, overrides || {});
    const completedAt = extra.completedAt || new Date().toISOString();
    delete extra.completedAt;

    return Object.assign({
      status: normalizedStatus,
      completedAt,
      durationMs: typeof safeDiagnostics?.durationMs === 'number' ? safeDiagnostics.durationMs : (typeof baseRecord?.durationMs === 'number' ? baseRecord.durationMs : 0),
      retryCount: typeof safeDiagnostics?.retryCount === 'number' ? safeDiagnostics.retryCount : (typeof baseRecord?.retryCount === 'number' ? baseRecord.retryCount : 0),
      adapterId: safeDiagnostics?.adapterId || baseRecord?.adapterId || '',
      provider: safeDiagnostics?.provider || baseRecord?.provider || '',
      model: safeDiagnostics?.model || baseRecord?.model || '',
      endpointMode: safeDiagnostics?.endpointMode || baseRecord?.endpointMode || '',
      finishReason: normalizedStatus,
      diagnostics: safeDiagnostics
    }, extra);
  }

  function buildChunkProgressLabel(diagnostics) {
    const safeDiagnostics = diagnostics || {};
    const chunkRuns = Array.isArray(safeDiagnostics.chunkRuns) ? safeDiagnostics.chunkRuns.filter(Boolean) : [];
    const finalRun = safeDiagnostics.finalRun || safeDiagnostics.error?.diagnostics || null;
    const totalChunks = finalRun?.chunkCount || safeDiagnostics.article?.chunkCount || 0;

    if (totalChunks <= 1) return '';

    const completedChunks = chunkRuns.length;
    if (finalRun?.stage === 'chunk' && typeof finalRun.chunkIndex === 'number') {
      return '\u5df2\u5b8c\u6210 ' + completedChunks + '/' + totalChunks + ' \u4e2a\u5206\u6bb5\uff0c\u5f53\u524d\u505c\u5728\u7b2c ' + (finalRun.chunkIndex + 1) + ' \u6bb5\u3002';
    }

    if (finalRun?.stage === 'synthesis') {
      return '\u5df2\u5b8c\u6210 ' + completedChunks + '/' + totalChunks + ' \u4e2a\u5206\u6bb5\uff0c\u5df2\u8fdb\u5165\u6700\u7ec8\u6c47\u603b\u3002';
    }

    return '\u5df2\u5b8c\u6210 ' + completedChunks + '/' + totalChunks + ' \u4e2a\u5206\u6bb5\u3002';
  }

  function getBilibiliDiagnostics(diagnostics) {
    return diagnostics?.article?.diagnostics?.bilibili || null;
  }

  function getYoutubeDiagnostics(diagnostics) {
    return diagnostics?.article?.diagnostics?.youtube || null;
  }

  function getBilibiliSourceLabel(sourceKind) {
    switch (sourceKind) {
      case 'official_ai_summary':
        return 'B 站官方 AI 总结';
      case 'subtitle':
        return '字幕转写';
      case 'fallback':
        return '标题/简介 fallback';
      default:
        return sourceKind || '未知';
    }
  }

  function formatBilibiliStage(stage) {
    if (!stage) return '';
    const detail = [
      stage.code !== undefined ? 'code=' + stage.code : '',
      stage.dataCode !== undefined ? 'dataCode=' + stage.dataCode : '',
      stage.resultType !== undefined ? 'resultType=' + stage.resultType : '',
      stage.message ? 'message=' + stage.message : ''
    ].filter(Boolean).join(', ');
    return '- ' + (stage.name || 'unknown') + (detail ? ': ' + detail : '');
  }

  function buildBilibiliDebugSummary(diagnostics) {
    const bilibili = getBilibiliDiagnostics(diagnostics);
    if (!bilibili) return '';

    const debug = bilibili.debug || {};
    const official = debug.officialAiSummary || {};
    const subtitles = debug.subtitles || {};
    const lines = [
      '',
      'B 站视频提取调试',
      '来源: ' + getBilibiliSourceLabel(debug.selectedSource || bilibili.sourceKind || 'fallback')
    ];

    if (Array.isArray(bilibili.stages) && bilibili.stages.length) {
      lines.push('接口阶段:');
      bilibili.stages.map(formatBilibiliStage).filter(Boolean).forEach((line) => lines.push(line));
    }

    if (official.called || official.summary || official.error) {
      lines.push('');
      lines.push('--- B 站官方 AI 总结接口 ---');
      lines.push('调用: ' + (official.called ? '已调用' : '未调用'));
      const status = [
        official.rootCode !== undefined ? 'rootCode=' + official.rootCode : '',
        official.dataCode !== undefined ? 'dataCode=' + official.dataCode : '',
        official.resultType !== undefined ? 'resultType=' + official.resultType : '',
        official.stid ? 'stid=' + official.stid : ''
      ].filter(Boolean).join(', ');
      if (status) lines.push('状态: ' + status);
      if (official.rootMessage || official.dataMessage) {
        lines.push('消息: ' + [official.rootMessage, official.dataMessage].filter(Boolean).join(' / '));
      }
      if (official.error) lines.push('错误: ' + official.error);
      if (official.summary) {
        lines.push('summary:');
        lines.push(official.summary);
      } else if (official.summaryPreview) {
        lines.push('summary 预览（历史记录已裁剪）:');
        lines.push(official.summaryPreview);
      }
      if (Array.isArray(official.outline) && official.outline.length) {
        lines.push('outline:');
        official.outline.forEach((item) => {
          const prefix = item.time ? '[' + item.time + '] ' : '';
          lines.push('- ' + prefix + (item.title || ''));
        });
      }
    }

    if (subtitles || bilibili.debug) {
      lines.push('');
      lines.push('--- B 站字幕抓取 ---');
      lines.push('可用字幕数: ' + String(subtitles.availableCount || 0));
      if (subtitles.lan || subtitles.lanDoc || subtitles.selectedLan || subtitles.selectedLanDoc) {
        lines.push('选中字幕: ' + [
          subtitles.lan || subtitles.selectedLan || '',
          subtitles.lanDoc || subtitles.selectedLanDoc || ''
        ].filter(Boolean).join(' / '));
      }
      if (subtitles.lineCount !== undefined) {
        lines.push('字幕条数: ' + subtitles.lineCount + (subtitles.truncated ? '（展示已截断）' : ''));
      }
      if (subtitles.error) lines.push('错误: ' + subtitles.error);
      if (!subtitles.attempted && !subtitles.availableCount && !subtitles.text && !subtitles.textPreview) {
        lines.push('结果: 未发现可导出的字幕。');
      }
      if (subtitles.text) {
        lines.push('全部字幕:');
        lines.push(subtitles.text);
      } else if (subtitles.textPreview) {
        lines.push('字幕预览（历史记录已裁剪）:');
        lines.push(subtitles.textPreview);
      }
    }

    return lines.filter((line) => line !== null && line !== undefined).join('\n');
  }

  function getYoutubeSourceLabel(sourceKind) {
    switch (sourceKind) {
      case 'caption':
        return 'caption transcript';
      case 'fallback':
        return 'title/description fallback';
      default:
        return sourceKind || 'unknown';
    }
  }

  function formatYoutubeStage(stage) {
    if (!stage) return '';
    const detail = [
      stage.code !== undefined ? 'code=' + stage.code : '',
      stage.source ? 'source=' + stage.source : '',
      stage.languageCode ? 'languageCode=' + stage.languageCode : '',
      stage.languageName ? 'languageName=' + stage.languageName : '',
      stage.message ? 'message=' + stage.message : ''
    ].filter(Boolean).join(', ');
    return '- ' + (stage.name || 'unknown') + (detail ? ': ' + detail : '');
  }

  function buildYoutubeDebugSummary(diagnostics) {
    const youtube = getYoutubeDiagnostics(diagnostics);
    if (!youtube) return '';

    const debug = youtube.debug || {};
    const captions = debug.captions || {};
    const lines = [
      '',
      'YouTube video extraction debug',
      'Source: ' + getYoutubeSourceLabel(debug.selectedSource || youtube.sourceKind || 'fallback')
    ];

    if (debug.video) {
      lines.push('Video: ' + [
        debug.video.videoId || '',
        debug.video.title || '',
        debug.video.author || ''
      ].filter(Boolean).join(' / '));
    }

    if (Array.isArray(youtube.stages) && youtube.stages.length) {
      lines.push('Stages:');
      youtube.stages.map(formatYoutubeStage).filter(Boolean).forEach((line) => lines.push(line));
    }

    lines.push('');
    lines.push('--- YouTube captions ---');
    lines.push('Available captions: ' + String(captions.availableCount || 0));
    if (captions.selectedLanguageCode || captions.selectedLanguageName) {
      lines.push('Selected caption: ' + [
        captions.selectedLanguageCode || captions.languageCode || '',
        captions.selectedLanguageName || captions.languageName || ''
      ].filter(Boolean).join(' / '));
    }
    if (captions.lineCount !== undefined) {
      lines.push('Caption lines: ' + captions.lineCount + (captions.truncated ? ' (truncated)' : ''));
    }
    if (captions.error) lines.push('Error: ' + captions.error);
    if (!captions.attempted && !captions.availableCount && !captions.text && !captions.textPreview) {
      lines.push('Result: no exportable captions found.');
    }
    if (captions.text) {
      lines.push('Full captions:');
      lines.push(captions.text);
    } else if (captions.textPreview) {
      lines.push('Caption preview (history record was trimmed):');
      lines.push(captions.textPreview);
    }

    return lines.filter((line) => line !== null && line !== undefined).join('\n');
  }

  function clonePlainObject(value) {
    if (value === null || value === undefined) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  function buildTextPreview(value, maxChars) {
    const text = String(value || '');
    const limit = maxChars || 500;
    return {
      preview: text.length > limit ? text.slice(0, limit) + '...' : text,
      length: text.length
    };
  }

  function sanitizeBilibiliDebugForPersistence(debug, sourceKind) {
    const copy = clonePlainObject(debug || {}) || {};
    const selectedSource = copy.selectedSource || sourceKind || 'fallback';
    copy.selectedSource = selectedSource;
    copy.fullSourceDebugPersisted = false;

    if (copy.officialAiSummary) {
      const summaryInfo = buildTextPreview(copy.officialAiSummary.summary, 500);
      if (summaryInfo.length) {
        copy.officialAiSummary.summaryPreview = summaryInfo.preview;
        copy.officialAiSummary.summaryLength = summaryInfo.length;
        copy.officialAiSummary.fullSummaryInArticleContent = selectedSource === 'official_ai_summary';
      }
      delete copy.officialAiSummary.summary;
    }

    if (copy.subtitles) {
      const textInfo = buildTextPreview(copy.subtitles.text, 500);
      const jsonInfo = buildTextPreview(copy.subtitles.jsonText, 500);
      if (textInfo.length) {
        copy.subtitles.textPreview = textInfo.preview;
        copy.subtitles.textLength = copy.subtitles.originalTextLength || textInfo.length;
        copy.subtitles.fullTextInArticleContent = selectedSource === 'subtitle';
      }
      if (jsonInfo.length) {
        copy.subtitles.jsonPreview = jsonInfo.preview;
        copy.subtitles.jsonLength = copy.subtitles.jsonLength || jsonInfo.length;
      }
      delete copy.subtitles.text;
      delete copy.subtitles.jsonText;
      delete copy.subtitles.subtitleUrl;
    }

    return copy;
  }

  function sanitizeYoutubeDebugForPersistence(debug, sourceKind) {
    const copy = clonePlainObject(debug || {}) || {};
    const selectedSource = copy.selectedSource || sourceKind || 'fallback';
    copy.selectedSource = selectedSource;
    copy.fullSourceDebugPersisted = false;

    if (copy.captions) {
      const textInfo = buildTextPreview(copy.captions.text, 500);
      const jsonInfo = buildTextPreview(copy.captions.jsonText, 500);
      if (textInfo.length) {
        copy.captions.textPreview = textInfo.preview;
        copy.captions.textLength = copy.captions.originalTextLength || textInfo.length;
        copy.captions.fullTextInArticleContent = selectedSource === 'caption';
      }
      if (jsonInfo.length) {
        copy.captions.jsonPreview = jsonInfo.preview;
        copy.captions.jsonLength = copy.captions.jsonLength || jsonInfo.length;
      }
      delete copy.captions.text;
      delete copy.captions.jsonText;
      delete copy.captions.captionUrl;
      if (Array.isArray(copy.captions.candidates)) {
        copy.captions.candidates = copy.captions.candidates.map((candidate) => {
          const safeCandidate = clonePlainObject(candidate || {}) || {};
          delete safeCandidate.captionUrl;
          return safeCandidate;
        });
      }
    }

    return copy;
  }

  function sanitizeArticleDiagnosticsForPersistence(diagnostics) {
    const copy = clonePlainObject(diagnostics || null);
    if (!copy) return copy;

    if (copy.bilibili) {
      const sourceKind = copy.bilibili.sourceKind || copy.videoSourceKind || 'fallback';
      copy.bilibili.debug = sanitizeBilibiliDebugForPersistence(copy.bilibili.debug || {}, sourceKind);
    }

    if (copy.youtube) {
      const sourceKind = copy.youtube.sourceKind || copy.videoSourceKind || 'fallback';
      copy.youtube.debug = sanitizeYoutubeDebugForPersistence(copy.youtube.debug || {}, sourceKind);
    }

    return copy;
  }

  function sanitizeArticleSnapshotForPersistence(article) {
    const copy = clonePlainObject(article || null);
    if (!copy) return copy;
    copy.diagnostics = sanitizeArticleDiagnosticsForPersistence(copy.diagnostics);
    return copy;
  }

  function sanitizeDiagnosticsForPersistence(diagnostics) {
    const copy = clonePlainObject(diagnostics || null);
    if (!copy) return copy;
    if (copy.article?.diagnostics) {
      copy.article.diagnostics = sanitizeArticleDiagnosticsForPersistence(copy.article.diagnostics);
    }
    return copy;
  }

  function describeCancellation(diagnostics, options) {
    const safeDiagnostics = diagnostics || {};
    const finalRun = safeDiagnostics.finalRun || safeDiagnostics.error?.diagnostics || null;
    const stage = finalRun?.stage || safeDiagnostics.error?.stage || '';
    const stageLabel = getRunStageLabel(stage, options);
    const totalChunks = finalRun?.chunkCount || safeDiagnostics.article?.chunkCount || 0;
    const currentChunk = typeof finalRun?.chunkIndex === 'number' ? finalRun.chunkIndex + 1 : 0;
    const hasPartialContent = !!options?.hasPartialContent;
    const chunkProgress = buildChunkProgressLabel(safeDiagnostics);
    let detail = '\u672c\u6b21\u751f\u6210\u5df2\u6309\u4f60\u7684\u64cd\u4f5c\u505c\u6b62\u3002';

    if (stage === 'chunk') {
      detail = currentChunk && totalChunks
        ? '\u5df2\u5728\u7b2c ' + currentChunk + '/' + totalChunks + ' \u4e2a\u5206\u6bb5\u65f6\u505c\u6b62\u3002'
        : '\u5df2\u5728\u5206\u6bb5\u603b\u7ed3\u9636\u6bb5\u505c\u6b62\u3002';
    } else if (stage === 'synthesis') {
      detail = totalChunks > 1
        ? '\u5206\u6bb5\u6574\u7406\u5df2\u5b8c\u6210\uff0c\u5df2\u5728\u6700\u7ec8\u6c47\u603b\u9636\u6bb5\u505c\u6b62\u3002'
        : '\u5df2\u5728\u6700\u7ec8\u6c47\u603b\u9636\u6bb5\u505c\u6b62\u3002';
    } else if (stage === 'secondary') {
      detail = options?.secondaryModeLabel
        ? '\u5df2\u505c\u6b62' + options.secondaryModeLabel + '\u751f\u6210\u3002'
        : '\u5df2\u505c\u6b62\u7ee7\u7eed\u751f\u6210\u3002';
    } else {
      detail = '\u5df2\u505c\u6b62\u5f53\u524d\u6458\u8981\u751f\u6210\u3002';
    }

    return {
      title: '\u5df2\u53d6\u6d88\u751f\u6210',
      stage,
      stageLabel,
      detail,
      progress: chunkProgress,
      partial: hasPartialContent
        ? '\u5df2\u4fdd\u7559\u5f53\u524d\u5df2\u751f\u6210\u5185\u5bb9\uff0c\u53ef\u76f4\u63a5\u590d\u5236\u3001\u5bfc\u51fa\u6216\u91cd\u65b0\u751f\u6210\u3002'
        : '\u672c\u6b21\u672a\u4fdd\u7559\u53ef\u7528\u6458\u8981\u5185\u5bb9\u3002',
      hasPartialContent
    };
  }

  function buildDiagnosticsSummary(diagnostics, options) {
    const safeDiagnostics = diagnostics || null;
    if (!safeDiagnostics) return '\u7b49\u5f85\u672c\u6b21\u8fd0\u884c\u7684\u8bca\u65ad\u4fe1\u606f...';

    const finalRun = safeDiagnostics.finalRun || safeDiagnostics.error?.diagnostics || null;
    const error = safeDiagnostics.error || finalRun?.lastError || null;
    const status = finalRun?.status || (error?.code === 'RUN_CANCELLED' ? 'cancelled' : error ? 'failed' : 'completed');
    const stage = finalRun?.stage || error?.stage || '';
    const lines = [
      '\u72b6\u6001: ' + getRunStatusLabel(status),
      '\u9636\u6bb5: ' + getRunStageLabel(stage, options)
    ];

    if (status === 'cancelled') {
      const cancellation = describeCancellation(safeDiagnostics, options);
      if (cancellation.detail) {
        lines.push('\u8bf4\u660e: ' + cancellation.detail);
      }
      if (cancellation.progress) {
        lines.push('\u8fdb\u5ea6: ' + cancellation.progress);
      }
      lines.push('\u5185\u5bb9: ' + cancellation.partial);
    } else {
      const progress = buildChunkProgressLabel(safeDiagnostics);
      if (progress) {
        lines.push('\u8fdb\u5ea6: ' + progress);
      }
      if (options?.hasPartialContent && status !== 'completed') {
        lines.push('\u5185\u5bb9: \u5df2\u4fdd\u7559\u5f53\u524d\u5df2\u751f\u6210\u5185\u5bb9\u3002');
      }
    }

    if (safeDiagnostics.article) {
      const articleInfo = [
        safeDiagnostics.article.sourceHost || '',
        safeDiagnostics.article.sourceStrategyLabel || safeDiagnostics.article.sourceType || ''
      ].filter(Boolean).join(' / ');
      if (articleInfo) {
        lines.push('\u9875\u9762: ' + articleInfo);
      }
    }

    const bilibiliDebug = buildBilibiliDebugSummary(safeDiagnostics);
    if (bilibiliDebug) {
      lines.push(bilibiliDebug);
    }

    const youtubeDebug = buildYoutubeDebugSummary(safeDiagnostics);
    if (youtubeDebug) {
      lines.push(youtubeDebug);
    }

    const modelInfo = [safeDiagnostics.provider || '', safeDiagnostics.model || ''].filter(Boolean).join(' / ');
    if (modelInfo) {
      lines.push('\u6a21\u578b: ' + modelInfo);
    }

    const endpointInfo = [safeDiagnostics.endpointMode || '', safeDiagnostics.adapterId || ''].filter(Boolean).join(' / ');
    if (endpointInfo) {
      lines.push('\u63a5\u53e3: ' + endpointInfo);
    }

    lines.push('\u8017\u65f6: ' + formatDuration(typeof safeDiagnostics.durationMs === 'number' ? safeDiagnostics.durationMs : finalRun?.durationMs || 0));
    lines.push('\u91cd\u8bd5: ' + String(safeDiagnostics.retryCount || 0) + ' \u6b21');

    if (error?.code) {
      lines.push('\u9519\u8bef: ' + error.code + (error.message ? ' \u00b7 ' + error.message : ''));
    }

    if (safeDiagnostics.runId) {
      lines.push('\u8fd0\u884c ID: ' + safeDiagnostics.runId);
    }

    return lines.filter(Boolean).join('\n');
  }

  const api = {
    pickTerminalRun,
    buildTerminalRecordPatch,
    formatDuration,
    getRunStageLabel,
    getRunStatusLabel,
    buildChunkProgressLabel,
    buildBilibiliDebugSummary,
    buildYoutubeDebugSummary,
    sanitizeArticleDiagnosticsForPersistence,
    sanitizeArticleSnapshotForPersistence,
    sanitizeDiagnosticsForPersistence,
    describeCancellation,
    buildDiagnosticsSummary
  };

  global.AISummaryRunUtils = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

(function (global) {
  const DEFAULT_SETTINGS = {
    privacyMode: false,
    defaultAllowHistory: true,
    defaultAllowShare: true
  };

  function normalizeSettings(input) {
    const source = input || {};
    return {
      privacyMode: !!source.privacyMode,
      defaultAllowHistory: source.defaultAllowHistory !== false,
      defaultAllowShare: source.defaultAllowShare !== false
    };
  }

  function buildTrustPolicy(article, settings, overrides) {
    const normalizedSettings = normalizeSettings(settings);
    const extra = overrides || {};
    const hasArticle = !!article;
    const privacyMode = typeof extra.privacyMode === 'boolean' ? extra.privacyMode : normalizedSettings.privacyMode;
    const articleAllowsHistory = hasArticle ? article.allowHistory !== false : true;
    const articleAllowsShare = hasArticle ? article.allowShare !== false : true;
    const allowHistory = typeof extra.allowHistory === 'boolean'
      ? extra.allowHistory
      : (!privacyMode && articleAllowsHistory && normalizedSettings.defaultAllowHistory);
    const allowShare = typeof extra.allowShare === 'boolean'
      ? extra.allowShare
      : (articleAllowsShare && normalizedSettings.defaultAllowShare);
    const retentionHint = extra.retentionHint || (allowHistory ? 'persistent' : 'session_only');

    if (!hasArticle) {
      return {
        privacyMode,
        allowHistory,
        allowShare,
        retentionHint,
        willSendToModel: false,
        modeLabel: privacyMode ? '无痕模式' : '标准模式',
        historyLabel: allowHistory ? '写入历史' : '不写入历史',
        shareLabel: allowShare ? '允许分享' : '禁止分享',
        summary: '页面内容载入后，会按照当前策略决定是否写入历史和允许分享。',
        sendMessage: '等待当前页面内容载入后，才会发送标题、来源和正文到模型接口。',
        historyMessage: allowHistory
          ? '页面载入后，生成结果会写入本地历史记录。'
          : '页面载入后，生成结果只保留在当前侧栏，不写入本地历史。',
        shareMessage: allowShare
          ? '页面载入后，可生成带来源链接的分享卡。'
          : '页面载入后，长截图分享卡会保持关闭。'
      };
    }

    const historyMessage = allowHistory
      ? '下次生成当前页面时，结果会写入本地历史，可搜索、收藏和回看。'
      : privacyMode
        ? '已开启无痕模式，下次生成结果只保留在当前侧栏，不写入历史。'
        : '你已关闭默认历史写入，下次生成结果不会进入本地历史。';

    const shareMessage = allowShare
      ? '下次生成当前页面时，可导出带来源链接的长截图分享卡。'
      : '当前已关闭分享卡输出，下次生成结果不会提供长截图分享。';

    return {
      privacyMode,
      allowHistory,
      allowShare,
      retentionHint,
      willSendToModel: true,
      modeLabel: privacyMode ? '无痕模式' : '标准模式',
      historyLabel: allowHistory ? '写入历史' : '不写入历史',
      shareLabel: allowShare ? '允许分享' : '禁止分享',
      summary: allowHistory
        ? '当前页面会发送给模型，并在本地留下可回看的总结记录。'
        : '当前页面会发送给模型，但本次结果不会写入本地历史。',
      sendMessage: '下次生成时，会发送标题、来源信息和提取后的正文到模型接口进行处理。',
      historyMessage,
      shareMessage
    };
  }

  function applyPolicyToArticle(article, policy) {
    if (!article) return null;
    return Object.assign({}, article, {
      allowHistory: policy.allowHistory,
      allowShare: policy.allowShare,
      retentionHint: policy.retentionHint
    });
  }

  function applyPolicyToRecord(record, policy) {
    if (!record) return null;

    const nextRecord = Object.assign({}, record, {
      privacyMode: !!policy.privacyMode,
      allowHistory: policy.allowHistory,
      allowShare: policy.allowShare,
      retentionHint: policy.retentionHint
    });

    if (nextRecord.articleSnapshot) {
      nextRecord.articleSnapshot = applyPolicyToArticle(nextRecord.articleSnapshot, policy);
    }

    return nextRecord;
  }

  const api = {
    DEFAULT_SETTINGS,
    normalizeSettings,
    buildTrustPolicy,
    applyPolicyToArticle,
    applyPolicyToRecord
  };

  global.AISummaryTrust = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

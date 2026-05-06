(function (global) {
  const Domain = global.AISummaryDomain || (typeof require === 'function' ? require('./domain.js') : null);

  const BILIBILI_HOST_PATTERN = /(^|\.)bilibili\.com$/i;
  const BVID_PATTERN = /BV[0-9A-Za-z]{10}/;
  const DEFAULT_DEBUG_TEXT_LIMIT = 120000;
  const WBI_MIXIN_KEY_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32,
    15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19,
    29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61,
    26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63,
    57, 62, 11, 36, 20, 34, 44, 52
  ];

  function normalizeWhitespace(input) {
    return Domain?.normalizeWhitespace
      ? Domain.normalizeWhitespace(input || '')
      : String(input || '').replace(/\s+/g, ' ').trim();
  }

  function isBilibiliVideoUrl(url) {
    try {
      const parsed = new URL(url || global.location?.href || '');
      const host = parsed.hostname || '';
      return BILIBILI_HOST_PATTERN.test(host) && /^\/video\/BV[0-9A-Za-z]{10}/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function extractBvid(url) {
    const raw = String(url || global.location?.href || '');
    const match = raw.match(BVID_PATTERN);
    return match ? match[0] : '';
  }

  function removeUrlHash(url) {
    try {
      const parsed = new URL(url || '');
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return String(url || '');
    }
  }

  function getRequestedPageNumber(url) {
    try {
      const parsed = new URL(url || global.location?.href || '');
      const pageNumber = Number(parsed.searchParams.get('p') || 1);
      return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
    } catch {
      return 1;
    }
  }

  function buildCanonicalVideoUrl(video) {
    const baseUrl = 'https://www.bilibili.com/video/' + video.bvid;
    return video.pageNumber > 1 ? baseUrl + '?p=' + video.pageNumber : baseUrl;
  }

  function getFileStem(url) {
    const value = String(url || '').split('/').pop() || '';
    return value.replace(/\.(png|jpg|jpeg|webp)$/i, '');
  }

  function md5Add(x, y) {
    return (((x + y) & 0xFFFFFFFF) >>> 0);
  }

  function md5Rotate(value, shift) {
    return (value << shift) | (value >>> (32 - shift));
  }

  function md5Cmn(q, a, b, x, s, t) {
    return md5Add(md5Rotate(md5Add(md5Add(a, q), md5Add(x, t)), s), b);
  }

  function md5Ff(a, b, c, d, x, s, t) {
    return md5Cmn((b & c) | ((~b) & d), a, b, x, s, t);
  }

  function md5Gg(a, b, c, d, x, s, t) {
    return md5Cmn((b & d) | (c & (~d)), a, b, x, s, t);
  }

  function md5Hh(a, b, c, d, x, s, t) {
    return md5Cmn(b ^ c ^ d, a, b, x, s, t);
  }

  function md5Ii(a, b, c, d, x, s, t) {
    return md5Cmn(c ^ (b | (~d)), a, b, x, s, t);
  }

  function md5Bytes(input) {
    if (typeof TextEncoder !== 'undefined') {
      return Array.from(new TextEncoder().encode(String(input || '')));
    }
    return unescape(encodeURIComponent(String(input || '')))
      .split('')
      .map((char) => char.charCodeAt(0));
  }

  function wordsFromBytes(bytes) {
    const words = [];
    for (let i = 0; i < bytes.length; i += 1) {
      words[i >> 2] = (words[i >> 2] || 0) | (bytes[i] << ((i % 4) * 8));
    }
    return words;
  }

  function pureMd5(input) {
    const bytes = md5Bytes(input);
    const bitLength = bytes.length * 8;
    const words = wordsFromBytes(bytes);
    words[bitLength >> 5] = (words[bitLength >> 5] || 0) | (0x80 << (bitLength % 32));
    words[((((bitLength + 64) >>> 9) << 4) + 14)] = bitLength;

    let a = 1732584193;
    let b = -271733879;
    let c = -1732584194;
    let d = 271733878;

    for (let i = 0; i < words.length; i += 16) {
      const oldA = a;
      const oldB = b;
      const oldC = c;
      const oldD = d;

      a = md5Ff(a, b, c, d, words[i] || 0, 7, -680876936);
      d = md5Ff(d, a, b, c, words[i + 1] || 0, 12, -389564586);
      c = md5Ff(c, d, a, b, words[i + 2] || 0, 17, 606105819);
      b = md5Ff(b, c, d, a, words[i + 3] || 0, 22, -1044525330);
      a = md5Ff(a, b, c, d, words[i + 4] || 0, 7, -176418897);
      d = md5Ff(d, a, b, c, words[i + 5] || 0, 12, 1200080426);
      c = md5Ff(c, d, a, b, words[i + 6] || 0, 17, -1473231341);
      b = md5Ff(b, c, d, a, words[i + 7] || 0, 22, -45705983);
      a = md5Ff(a, b, c, d, words[i + 8] || 0, 7, 1770035416);
      d = md5Ff(d, a, b, c, words[i + 9] || 0, 12, -1958414417);
      c = md5Ff(c, d, a, b, words[i + 10] || 0, 17, -42063);
      b = md5Ff(b, c, d, a, words[i + 11] || 0, 22, -1990404162);
      a = md5Ff(a, b, c, d, words[i + 12] || 0, 7, 1804603682);
      d = md5Ff(d, a, b, c, words[i + 13] || 0, 12, -40341101);
      c = md5Ff(c, d, a, b, words[i + 14] || 0, 17, -1502002290);
      b = md5Ff(b, c, d, a, words[i + 15] || 0, 22, 1236535329);

      a = md5Gg(a, b, c, d, words[i + 1] || 0, 5, -165796510);
      d = md5Gg(d, a, b, c, words[i + 6] || 0, 9, -1069501632);
      c = md5Gg(c, d, a, b, words[i + 11] || 0, 14, 643717713);
      b = md5Gg(b, c, d, a, words[i] || 0, 20, -373897302);
      a = md5Gg(a, b, c, d, words[i + 5] || 0, 5, -701558691);
      d = md5Gg(d, a, b, c, words[i + 10] || 0, 9, 38016083);
      c = md5Gg(c, d, a, b, words[i + 15] || 0, 14, -660478335);
      b = md5Gg(b, c, d, a, words[i + 4] || 0, 20, -405537848);
      a = md5Gg(a, b, c, d, words[i + 9] || 0, 5, 568446438);
      d = md5Gg(d, a, b, c, words[i + 14] || 0, 9, -1019803690);
      c = md5Gg(c, d, a, b, words[i + 3] || 0, 14, -187363961);
      b = md5Gg(b, c, d, a, words[i + 8] || 0, 20, 1163531501);
      a = md5Gg(a, b, c, d, words[i + 13] || 0, 5, -1444681467);
      d = md5Gg(d, a, b, c, words[i + 2] || 0, 9, -51403784);
      c = md5Gg(c, d, a, b, words[i + 7] || 0, 14, 1735328473);
      b = md5Gg(b, c, d, a, words[i + 12] || 0, 20, -1926607734);

      a = md5Hh(a, b, c, d, words[i + 5] || 0, 4, -378558);
      d = md5Hh(d, a, b, c, words[i + 8] || 0, 11, -2022574463);
      c = md5Hh(c, d, a, b, words[i + 11] || 0, 16, 1839030562);
      b = md5Hh(b, c, d, a, words[i + 14] || 0, 23, -35309556);
      a = md5Hh(a, b, c, d, words[i + 1] || 0, 4, -1530992060);
      d = md5Hh(d, a, b, c, words[i + 4] || 0, 11, 1272893353);
      c = md5Hh(c, d, a, b, words[i + 7] || 0, 16, -155497632);
      b = md5Hh(b, c, d, a, words[i + 10] || 0, 23, -1094730640);
      a = md5Hh(a, b, c, d, words[i + 13] || 0, 4, 681279174);
      d = md5Hh(d, a, b, c, words[i] || 0, 11, -358537222);
      c = md5Hh(c, d, a, b, words[i + 3] || 0, 16, -722521979);
      b = md5Hh(b, c, d, a, words[i + 6] || 0, 23, 76029189);
      a = md5Hh(a, b, c, d, words[i + 9] || 0, 4, -640364487);
      d = md5Hh(d, a, b, c, words[i + 12] || 0, 11, -421815835);
      c = md5Hh(c, d, a, b, words[i + 15] || 0, 16, 530742520);
      b = md5Hh(b, c, d, a, words[i + 2] || 0, 23, -995338651);

      a = md5Ii(a, b, c, d, words[i] || 0, 6, -198630844);
      d = md5Ii(d, a, b, c, words[i + 7] || 0, 10, 1126891415);
      c = md5Ii(c, d, a, b, words[i + 14] || 0, 15, -1416354905);
      b = md5Ii(b, c, d, a, words[i + 5] || 0, 21, -57434055);
      a = md5Ii(a, b, c, d, words[i + 12] || 0, 6, 1700485571);
      d = md5Ii(d, a, b, c, words[i + 3] || 0, 10, -1894986606);
      c = md5Ii(c, d, a, b, words[i + 10] || 0, 15, -1051523);
      b = md5Ii(b, c, d, a, words[i + 1] || 0, 21, -2054922799);
      a = md5Ii(a, b, c, d, words[i + 8] || 0, 6, 1873313359);
      d = md5Ii(d, a, b, c, words[i + 15] || 0, 10, -30611744);
      c = md5Ii(c, d, a, b, words[i + 6] || 0, 15, -1560198380);
      b = md5Ii(b, c, d, a, words[i + 13] || 0, 21, 1309151649);
      a = md5Ii(a, b, c, d, words[i + 4] || 0, 6, -145523070);
      d = md5Ii(d, a, b, c, words[i + 11] || 0, 10, -1120210379);
      c = md5Ii(c, d, a, b, words[i + 2] || 0, 15, 718787259);
      b = md5Ii(b, c, d, a, words[i + 9] || 0, 21, -343485551);

      a = md5Add(a, oldA);
      b = md5Add(b, oldB);
      c = md5Add(c, oldC);
      d = md5Add(d, oldD);
    }

    return [a, b, c, d].map((word) => {
      let output = '';
      for (let i = 0; i < 4; i += 1) {
        output += ((word >> (i * 8)) & 0xFF).toString(16).padStart(2, '0');
      }
      return output;
    }).join('');
  }

  async function digestMd5(input) {
    if (typeof require === 'function') {
      const crypto = require('crypto');
      return crypto.createHash('md5').update(String(input || '')).digest('hex');
    }
    return pureMd5(input);
  }

  function getMixinKey(imgKey, subKey) {
    const raw = String(imgKey || '') + String(subKey || '');
    return WBI_MIXIN_KEY_ENC_TAB
      .map((index) => raw[index] || '')
      .join('')
      .slice(0, 32);
  }

  function encodeWbiValue(value) {
    return String(value ?? '').replace(/[!'()*]/g, '');
  }

  async function signWbiParams(params, wbiImg) {
    const imgKey = getFileStem(wbiImg?.img_url);
    const subKey = getFileStem(wbiImg?.sub_url);
    const mixinKey = getMixinKey(imgKey, subKey);
    const merged = Object.assign({}, params, {
      wts: Math.round(Date.now() / 1000)
    });

    const query = Object.keys(merged)
      .sort()
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(encodeWbiValue(merged[key]))}`)
      .join('&');
    const wRid = await digestMd5(query + mixinKey);
    return query + '&w_rid=' + wRid;
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, Object.assign({
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*'
      }
    }, options || {}));

    if (!response.ok) {
      throw new Error(`Bilibili request failed: HTTP ${response.status}`);
    }
    return response.json();
  }

  function buildApiUrl(path, query) {
    return 'https://api.bilibili.com' + path + (query ? '?' + query : '');
  }

  async function getVideoView(bvid) {
    return fetchJson(buildApiUrl('/x/web-interface/view', 'bvid=' + encodeURIComponent(bvid)), {
      referrer: 'https://www.bilibili.com/video/' + bvid
    });
  }

  async function getNavInfo() {
    return fetchJson(buildApiUrl('/x/web-interface/nav'));
  }

  async function getPlayerInfo(video) {
    const params = new URLSearchParams({
      aid: String(video.aid || ''),
      bvid: String(video.bvid || ''),
      cid: String(video.cid || '')
    });

    return fetchJson(buildApiUrl('/x/player/v2', params.toString()), {
      referrer: 'https://www.bilibili.com/video/' + video.bvid
    });
  }

  async function getAiConclusion(video, wbiImg) {
    const signed = await signWbiParams({
      bvid: video.bvid,
      cid: video.cid,
      up_mid: video.upMid || '',
      web_location: '333.788'
    }, wbiImg);

    return fetchJson(buildApiUrl('/x/web-interface/view/conclusion/get', signed), {
      referrer: 'https://www.bilibili.com/video/' + video.bvid
    });
  }

  async function getSubtitleBody(subtitleUrl, bvid) {
    const url = /^https?:\/\//i.test(subtitleUrl)
      ? subtitleUrl
      : 'https:' + subtitleUrl;
    const parsed = new URL(url);
    const host = parsed.hostname || '';
    if (!/(^|\.)hdslb\.com$/i.test(host) && !/(^|\.)bilibili\.com$/i.test(host)) {
      throw new Error('Unexpected Bilibili subtitle host: ' + host);
    }

    return fetchJson(parsed.toString(), {
      referrer: 'https://www.bilibili.com/video/' + bvid
    });
  }

  function readVideoMetaFromDom(doc) {
    const title = normalizeWhitespace(
      doc?.querySelector('h1.video-title')?.textContent ||
      doc?.querySelector('[data-title]')?.getAttribute('data-title') ||
      doc?.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
      doc?.title ||
      ''
    );
    const description = normalizeWhitespace(
      doc?.querySelector('meta[name="description"]')?.getAttribute('content') ||
      doc?.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      ''
    );
    const author = normalizeWhitespace(
      doc?.querySelector('.up-name')?.textContent ||
      doc?.querySelector('meta[name="author"]')?.getAttribute('content') ||
      ''
    );
    return { title, description, author };
  }

  function normalizeVideoPayload(viewJson, bvid, doc, url) {
    const data = viewJson?.data || {};
    const pages = Array.isArray(data.pages) ? data.pages : [];
    const requestedPageNumber = getRequestedPageNumber(url);
    const pageIndex = pages.length
      ? Math.min(Math.max(requestedPageNumber, 1), pages.length) - 1
      : 0;
    const pageNumber = pageIndex + 1;
    const page = pages[pageIndex] || {};
    const domMeta = readVideoMetaFromDom(doc || global.document);
    const baseTitle = normalizeWhitespace(data.title || domMeta.title || bvid);
    const partTitle = normalizeWhitespace(page.part || '');
    const title = pageNumber > 1 && partTitle && !baseTitle.includes(partTitle)
      ? `${baseTitle} - P${pageNumber} ${partTitle}`
      : normalizeWhitespace(baseTitle || partTitle || bvid);

    return {
      bvid: data.bvid || bvid,
      aid: data.aid || '',
      cid: page.cid || data.cid || '',
      upMid: data.owner?.mid || '',
      title,
      baseTitle,
      partTitle,
      pageNumber,
      pageCount: pages.length || 1,
      description: normalizeWhitespace(data.desc || data.desc_v2?.map((item) => item.raw_text).join('\n') || domMeta.description),
      author: normalizeWhitespace(data.owner?.name || domMeta.author),
      duration: Number(page.duration || data.duration || 0),
      pubdate: data.pubdate ? new Date(data.pubdate * 1000).toISOString() : '',
      pic: data.pic || '',
      pages,
      stats: data.stat || {},
      rawSubtitleList: data.subtitle?.list || []
    };
  }

  function formatSeconds(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours) {
      return [hours, minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
    }
    return [minutes, secs].map((value) => String(value).padStart(2, '0')).join(':');
  }

  function normalizeOutlineItems(items) {
    const output = [];
    if (!Array.isArray(items)) return output;

    items.forEach((item) => {
      const title = normalizeWhitespace(item?.title || item?.summary || item?.content || item?.text || '');
      const timestamp = item?.timestamp ?? item?.from ?? item?.start ?? item?.start_time ?? item?.time ?? null;
      if (title) {
        output.push({
          title,
          timestamp: Number.isFinite(Number(timestamp)) ? Number(timestamp) : null
        });
      }

      ['children', 'outline', 'part_outline', 'sub_outline'].forEach((key) => {
        normalizeOutlineItems(item?.[key]).forEach((child) => output.push(child));
      });
    });

    return output;
  }

  function normalizeAiResultPayload(json) {
    const data = json?.data || {};
    const modelResult = data.model_result || data.modelResult || {};
    const summary = normalizeWhitespace(modelResult.summary || data.summary || '');
    const outline = normalizeOutlineItems(
      modelResult.outline ||
      modelResult.part_outline ||
      modelResult.partOutline ||
      data.outline ||
      data.part_outline ||
      []
    );

    return {
      rootCode: json?.code,
      rootMessage: json?.message || '',
      dataCode: data.code,
      dataMessage: data.message || data.msg || '',
      resultType: modelResult.result_type || modelResult.resultType || 0,
      stid: data.stid || '',
      summary,
      outline,
      hasSummary: !!summary || outline.length > 0,
      raw: json
    };
  }

  function formatOfficialSummaryText(video, conclusion) {
    const lines = [
      '# Bilibili 视频信息',
      `标题：${video.title || video.bvid}`,
      video.author ? `UP 主：${video.author}` : '',
      video.duration ? `时长：${formatSeconds(video.duration)}` : '',
      video.description ? `简介：${video.description}` : '',
      '',
      '# Bilibili 官方 AI 总结',
      conclusion.summary || '',
      conclusion.outline.length ? '' : '',
      conclusion.outline.length ? '# 分段大纲' : '',
      ...conclusion.outline.map((item) => {
        const prefix = item.timestamp === null ? '' : `[${formatSeconds(item.timestamp)}] `;
        return `- ${prefix}${item.title}`;
      })
    ];

    return normalizeWhitespace(lines.filter(Boolean).join('\n'));
  }

  function collectSubtitleItems(playerJson, viewSubtitleList) {
    const fromPlayer = playerJson?.data?.subtitle?.subtitles || [];
    const fromView = viewSubtitleList || [];
    return [...fromPlayer, ...fromView].filter((item) => item && (item.subtitle_url || item.subtitleUrl));
  }

  function selectSubtitle(subtitles) {
    if (!Array.isArray(subtitles) || !subtitles.length) return null;
    return subtitles.find((item) => /^(zh|ai-zh|zh-Hans|zh-CN)/i.test(item.lan || item.lan_doc || '')) ||
      subtitles.find((item) => /zh|中文|汉语|普通话/i.test((item.lan || '') + ' ' + (item.lan_doc || ''))) ||
      subtitles[0];
  }

  function limitDebugText(text, maxChars) {
    const value = String(text || '');
    const limit = maxChars || DEFAULT_DEBUG_TEXT_LIMIT;
    if (value.length <= limit) {
      return {
        text: value,
        truncated: false,
        originalLength: value.length
      };
    }

    return {
      text: value.slice(0, limit) + `\n... 已截断：原始 ${value.length} 字符，仅显示前 ${limit} 字符 ...`,
      truncated: true,
      originalLength: value.length
    };
  }

  function collectSubtitleDebugLines(subtitleJson) {
    const body = Array.isArray(subtitleJson?.body) ? subtitleJson.body : [];
    return body
      .map((item) => {
        const text = normalizeWhitespace(item?.content || '');
        if (!text) return '';
        return `[${formatSeconds(item.from)}] ${text}`;
      })
      .filter(Boolean);
  }

  function buildOfficialSummaryDebug(conclusion) {
    return {
      called: true,
      rootCode: conclusion?.rootCode,
      rootMessage: conclusion?.rootMessage || '',
      dataCode: conclusion?.dataCode,
      dataMessage: conclusion?.dataMessage || '',
      resultType: conclusion?.resultType || 0,
      stid: conclusion?.stid || '',
      hasSummary: !!conclusion?.hasSummary,
      summary: conclusion?.summary || '',
      outline: (conclusion?.outline || []).map((item) => ({
        timestamp: item.timestamp,
        time: item.timestamp === null ? '' : formatSeconds(item.timestamp),
        title: item.title
      }))
    };
  }

  function buildSubtitleDebug(subtitleJson, subtitleMeta) {
    const lines = collectSubtitleDebugLines(subtitleJson);
    const limited = limitDebugText(lines.join('\n'));
    const jsonText = JSON.stringify(subtitleJson || {}, null, 2);
    return {
      attempted: true,
      lan: subtitleMeta?.lan || '',
      lanDoc: subtitleMeta?.lan_doc || '',
      subtitleUrl: subtitleMeta?.subtitle_url || subtitleMeta?.subtitleUrl || '',
      lineCount: lines.length,
      originalTextLength: limited.originalLength,
      truncated: limited.truncated,
      text: limited.text,
      jsonText,
      jsonLength: jsonText.length
    };
  }

  function formatSubtitleText(video, subtitleJson, subtitleMeta) {
    const subtitleLines = collectSubtitleDebugLines(subtitleJson);

    if (!subtitleLines.length) return '';

    return normalizeWhitespace([
      '# Bilibili 视频信息',
      `标题：${video.title || video.bvid}`,
      video.author ? `UP 主：${video.author}` : '',
      video.duration ? `时长：${formatSeconds(video.duration)}` : '',
      video.description ? `简介：${video.description}` : '',
      '',
      '# 字幕转写',
      subtitleMeta?.lan_doc ? `字幕语言：${subtitleMeta.lan_doc}` : '',
      ...subtitleLines
    ].filter(Boolean).join('\n'));
  }

  function buildFallbackText(video, conclusion, playerJson) {
    const dataCode = conclusion?.dataCode;
    const playerData = playerJson?.data || {};
    const reasons = [
      conclusion?.rootCode === -101 ? '当前 B 站登录态不可用或已失效。' : '',
      conclusion?.rootCode === -403 ? 'B 站官方 AI 总结接口返回权限不足。' : '',
      dataCode === -1 ? '该视频当前不支持 B 站官方 AI 总结。' : '',
      dataCode === 1 ? '该视频暂时没有可用的官方 AI 总结。' : '',
      playerData.need_login_subtitle ? '字幕接口提示需要登录。' : '',
      !collectSubtitleItems(playerJson, video.rawSubtitleList).length ? '未发现可下载字幕。' : ''
    ].filter(Boolean);

    return normalizeWhitespace([
      '# Bilibili 视频信息',
      `标题：${video.title || video.bvid}`,
      video.author ? `UP 主：${video.author}` : '',
      video.duration ? `时长：${formatSeconds(video.duration)}` : '',
      video.description ? `简介：${video.description}` : '',
      '',
      '# 提取状态',
      ...reasons.map((item) => `- ${item}`),
      '- 暂时只能基于标题、简介和页面可见信息生成概要。'
    ].filter(Boolean).join('\n'));
  }

  async function extractBilibiliVideoSource(options) {
    const doc = options?.document || global.document;
    const url = options?.url || global.location?.href || '';
    const bvid = extractBvid(url);
    if (!bvid || !isBilibiliVideoUrl(url)) return null;

    const diagnostics = {
      provider: 'bilibili',
      bvid,
      sourceKind: 'fallback',
      stages: [],
      debug: {
        selectedSource: 'fallback',
        officialAiSummary: {
          called: false
        },
        subtitles: {
          attempted: false
        }
      }
    };

    const viewJson = await getVideoView(bvid);
    diagnostics.stages.push({ name: 'view', code: viewJson?.code, message: viewJson?.message || '' });
    if (viewJson?.code !== 0) {
      throw new Error('Bilibili view API failed: ' + (viewJson?.message || viewJson?.code));
    }

    const video = normalizeVideoPayload(viewJson, bvid, doc, url);
    diagnostics.debug.video = {
      bvid: video.bvid,
      aid: video.aid,
      cid: video.cid,
      title: video.title,
      author: video.author,
      duration: video.duration,
      pageNumber: video.pageNumber,
      pageCount: video.pageCount,
      partTitle: video.partTitle
    };
    const [navSettled, playerSettled] = await Promise.allSettled([
      getNavInfo(),
      getPlayerInfo(video)
    ]);

    const navJson = navSettled.status === 'fulfilled' ? navSettled.value : null;
    const playerJson = playerSettled.status === 'fulfilled' ? playerSettled.value : null;
    diagnostics.stages.push({ name: 'nav', code: navJson?.code, message: navJson?.message || navSettled.reason?.message || '' });
    diagnostics.stages.push({ name: 'player', code: playerJson?.code, message: playerJson?.message || playerSettled.reason?.message || '' });

    let sourceText = '';
    let sourceKind = 'fallback';
    let conclusion = null;

    if (navJson?.data?.wbi_img) {
      try {
        const conclusionJson = await getAiConclusion(video, navJson.data.wbi_img);
        conclusion = normalizeAiResultPayload(conclusionJson);
        diagnostics.debug.officialAiSummary = buildOfficialSummaryDebug(conclusion);
        diagnostics.stages.push({
          name: 'official_ai_summary',
          code: conclusion.rootCode,
          dataCode: conclusion.dataCode,
          message: conclusion.rootMessage || conclusion.dataMessage || '',
          resultType: conclusion.resultType,
          stid: conclusion.stid
        });

        if (conclusion.hasSummary) {
          sourceText = formatOfficialSummaryText(video, conclusion);
          sourceKind = 'official_ai_summary';
          diagnostics.debug.selectedSource = sourceKind;
        }
      } catch (error) {
        diagnostics.debug.officialAiSummary = {
          called: true,
          error: error?.message || String(error)
        };
        diagnostics.stages.push({ name: 'official_ai_summary', code: 'error', message: error?.message || String(error) });
      }
    } else {
      diagnostics.debug.officialAiSummary = {
        called: false,
        error: 'missing_wbi_img'
      };
    }

    if (playerJson) {
      const subtitles = collectSubtitleItems(playerJson, video.rawSubtitleList);
      const subtitle = selectSubtitle(subtitles);
      diagnostics.debug.subtitles = {
        attempted: !!subtitle,
        availableCount: subtitles.length,
        selectedLan: subtitle?.lan || '',
        selectedLanDoc: subtitle?.lan_doc || '',
        usedAsSource: false
      };
      if (subtitle) {
        try {
          const subtitleJson = await getSubtitleBody(subtitle.subtitle_url || subtitle.subtitleUrl, video.bvid);
          const subtitleText = formatSubtitleText(video, subtitleJson, subtitle);
          diagnostics.debug.subtitles = Object.assign(
            {},
            diagnostics.debug.subtitles,
            buildSubtitleDebug(subtitleJson, subtitle),
            {
              usedAsSource: !sourceText && !!subtitleText
            }
          );
          diagnostics.stages.push({
            name: 'subtitle',
            code: 'ok',
            lan: subtitle.lan || '',
            lanDoc: subtitle.lan_doc || ''
          });
          if (!sourceText && subtitleText) {
            sourceText = subtitleText;
            sourceKind = 'subtitle';
            diagnostics.debug.selectedSource = sourceKind;
          }
        } catch (error) {
          diagnostics.debug.subtitles = Object.assign({}, diagnostics.debug.subtitles, {
            attempted: true,
            error: error?.message || String(error)
          });
          diagnostics.stages.push({ name: 'subtitle', code: 'error', message: error?.message || String(error) });
        }
      }
    }

    if (!sourceText) {
      sourceText = buildFallbackText(video, conclusion, playerJson);
    }

    diagnostics.sourceKind = sourceKind;
    diagnostics.debug.selectedSource = sourceKind;

    return {
      sourceKind,
      title: video.title,
      text: sourceText,
      excerpt: video.description,
      sourceUrl: removeUrlHash(url),
      meta: {
        canonicalUrl: buildCanonicalVideoUrl(video),
        ogTitle: video.title,
        htmlTitle: doc?.title || video.title,
        description: video.description,
        author: video.author,
        siteName: 'Bilibili',
        publishedAt: video.pubdate,
        language: 'zh'
      },
      video,
      diagnostics
    };
  }

  const api = {
    isBilibiliVideoUrl,
    extractBvid,
    signWbiParams,
    normalizeAiResultPayload,
    formatOfficialSummaryText,
    buildOfficialSummaryDebug,
    buildSubtitleDebug,
    formatSubtitleText,
    buildFallbackText,
    extractBilibiliVideoSource
  };

  global.AISummaryBilibiliSource = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

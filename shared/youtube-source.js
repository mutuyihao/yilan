(function (global) {
  const Domain = global.AISummaryDomain || (typeof require === 'function' ? require('./domain.js') : null);

  const YOUTUBE_HOST_PATTERN = /(^|\.)youtube(?:-nocookie)?\.com$/i;
  const YOUTU_BE_HOST_PATTERN = /(^|\.)youtu\.be$/i;
  const GOOGLEVIDEO_HOST_PATTERN = /(^|\.)googlevideo\.com$/i;
  const VIDEO_ID_PATTERN = /^[0-9A-Za-z_-]{11}$/;
  const DEFAULT_DEBUG_TEXT_LIMIT = 120000;
  const DEFAULT_FETCH_TIMEOUT_MS = 12000;
  const DEFAULT_MAX_CAPTION_ATTEMPTS = 3;

  function normalizeWhitespace(input) {
    return Domain?.normalizeWhitespace
      ? Domain.normalizeWhitespace(input || '')
      : String(input || '').replace(/\s+/g, ' ').trim();
  }

  function decodeTextEntities(input) {
    return String(input || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => decodeCodePoint(hex, 16))
      .replace(/&#(\d+);/g, (_, value) => decodeCodePoint(value, 10));
  }

  function decodeCodePoint(value, radix) {
    const codePoint = parseInt(value, radix);
    if (!Number.isFinite(codePoint)) return '';
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return '';
    }
  }

  function isValidVideoId(value) {
    return VIDEO_ID_PATTERN.test(String(value || ''));
  }

  function extractVideoId(url) {
    try {
      const parsed = new URL(url || global.location?.href || '');
      const host = parsed.hostname || '';
      const pathParts = parsed.pathname.split('/').filter(Boolean);

      if (YOUTU_BE_HOST_PATTERN.test(host)) {
        return isValidVideoId(pathParts[0]) ? pathParts[0] : '';
      }

      if (!YOUTUBE_HOST_PATTERN.test(host)) return '';

      if (parsed.pathname === '/watch') {
        const videoId = parsed.searchParams.get('v') || '';
        return isValidVideoId(videoId) ? videoId : '';
      }

      if (['shorts', 'embed', 'live'].includes(pathParts[0]) && isValidVideoId(pathParts[1])) {
        return pathParts[1];
      }

      return '';
    } catch {
      return '';
    }
  }

  function isYoutubeVideoUrl(url) {
    return !!extractVideoId(url);
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

  function buildCanonicalVideoUrl(video) {
    return 'https://www.youtube.com/watch?v=' + encodeURIComponent(video.videoId || '');
  }

  function stripYoutubeSuffix(title) {
    return normalizeWhitespace(String(title || '').replace(/\s+-\s+YouTube$/i, ''));
  }

  function readMetaContent(doc, selectors) {
    for (const selector of selectors) {
      const element = doc?.querySelector?.(selector);
      const value = element?.getAttribute?.('content') || element?.textContent || '';
      if (String(value).trim()) return String(value).trim();
    }
    return '';
  }

  function readVideoMetaFromDom(doc) {
    const title = stripYoutubeSuffix(readMetaContent(doc, [
      'meta[property="og:title"]',
      'meta[name="title"]',
      'meta[itemprop="name"]',
      'ytd-watch-metadata h1 yt-formatted-string',
      'ytd-watch-metadata h1',
      '#title h1 yt-formatted-string'
    ]) || doc?.title || '');
    const description = normalizeWhitespace(readMetaContent(doc, [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[itemprop="description"]'
    ]));
    const author = normalizeWhitespace(readMetaContent(doc, [
      'link[itemprop="name"]',
      'meta[name="author"]',
      'ytd-watch-metadata ytd-channel-name a',
      'ytd-video-owner-renderer ytd-channel-name a',
      '#owner #channel-name a'
    ]));
    return { title, description, author };
  }

  function getSimpleText(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value.simpleText === 'string') return value.simpleText;
    if (Array.isArray(value.runs)) {
      return value.runs.map((item) => item?.text || '').join('');
    }
    return '';
  }

  function extractBalancedJson(text, firstBraceIndex) {
    const source = String(text || '');
    let start = firstBraceIndex;
    while (start >= 0 && start < source.length && source[start] !== '{') start += 1;
    if (start < 0 || start >= source.length) return '';

    let depth = 0;
    let inString = false;
    let quote = '';
    let escaped = false;

    for (let index = start; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === quote) {
          inString = false;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        inString = true;
        quote = char;
        continue;
      }

      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return source.slice(start, index + 1);
        }
      }
    }

    return '';
  }

  function findJsonObjectAfterToken(text, token) {
    const source = String(text || '');
    const tokenIndex = source.indexOf(token);
    if (tokenIndex < 0) return null;

    const jsonText = extractBalancedJson(source, source.indexOf('{', tokenIndex + token.length));
    if (!jsonText) return null;

    try {
      return JSON.parse(jsonText);
    } catch {
      return null;
    }
  }

  function parsePlayerResponseFromText(text) {
    return findJsonObjectAfterToken(text, 'ytInitialPlayerResponse');
  }

  function readPlayerResponseFromDom(doc) {
    if (global.ytInitialPlayerResponse?.videoDetails) {
      return global.ytInitialPlayerResponse;
    }

    const scripts = Array.from(doc?.querySelectorAll?.('script') || []);
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text.includes('ytInitialPlayerResponse')) continue;

      const parsed = parsePlayerResponseFromText(text);
      if (parsed?.videoDetails) return parsed;
    }

    return null;
  }

  function buildWatchPageFetchUrl(videoId, sourceUrl) {
    const parsed = new URL('https://www.youtube.com/watch');
    parsed.searchParams.set('v', videoId);

    try {
      const current = new URL(sourceUrl || global.location?.href || '');
      ['hl', 'gl', 'persist_hl', 'persist_gl'].forEach((key) => {
        const value = current.searchParams.get(key);
        if (value) parsed.searchParams.set(key, value);
      });
    } catch {}

    return parsed.toString();
  }

  async function fetchWithTimeout(url, init, timeoutMs) {
    const timeout = Math.max(1000, Number(timeoutMs || DEFAULT_FETCH_TIMEOUT_MS));
    if (typeof AbortController === 'undefined') {
      return fetch(url, init);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('youtube_fetch_timeout'), timeout);
    try {
      return await fetch(url, Object.assign({}, init || {}, {
        signal: controller.signal
      }));
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchPlayerResponseFromWatchPage(videoId, sourceUrl, options) {
    const url = buildWatchPageFetchUrl(videoId, sourceUrl);
    const response = await fetchWithTimeout(url, {
      credentials: 'include',
      headers: {
        Accept: 'text/html,application/xhtml+xml'
      },
      referrer: sourceUrl || 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId || '')
    }, options?.watchPageTimeoutMs);

    if (!response.ok) {
      throw new Error(`YouTube watch page request failed: HTTP ${response.status}`);
    }

    const html = await response.text();
    const playerResponse = parsePlayerResponseFromText(html);
    return {
      url,
      htmlLength: html.length,
      playerResponse: playerResponse?.videoDetails ? playerResponse : null
    };
  }

  function normalizeVideoPayload(playerResponse, videoId, doc) {
    const details = playerResponse?.videoDetails || {};
    const microformat = playerResponse?.microformat?.playerMicroformatRenderer || {};
    const domMeta = readVideoMetaFromDom(doc || global.document);
    const title = stripYoutubeSuffix(
      details.title ||
      getSimpleText(microformat.title) ||
      domMeta.title ||
      videoId
    );

    return {
      videoId,
      title,
      author: normalizeWhitespace(details.author || microformat.ownerChannelName || domMeta.author),
      channelId: details.channelId || microformat.externalChannelId || '',
      duration: Number(details.lengthSeconds || microformat.lengthSeconds || 0),
      description: normalizeWhitespace(details.shortDescription || getSimpleText(microformat.description) || domMeta.description),
      publishedAt: microformat.publishDate || microformat.uploadDate || '',
      isLive: !!details.isLiveContent,
      keywords: Array.isArray(details.keywords) ? details.keywords.slice(0, 20) : [],
      thumbnails: details.thumbnail?.thumbnails || microformat.thumbnail?.thumbnails || []
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

  function normalizeCaptionTrack(track, index) {
    const languageCode = String(track?.languageCode || '').trim();
    const name = normalizeWhitespace(getSimpleText(track?.name) || languageCode);
    const baseUrl = decodeTextEntities(track?.baseUrl || '');
    const kind = String(track?.kind || '').trim();
    const vssId = String(track?.vssId || '').trim();
    return {
      index: Number.isFinite(Number(index)) ? Number(index) : 0,
      baseUrl,
      languageCode,
      name,
      kind,
      vssId,
      isAutomatic: kind === 'asr' || /^a\./i.test(vssId),
      isTranslatable: !!track?.isTranslatable,
      raw: track
    };
  }

  function collectCaptionTracks(playerResponse) {
    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!Array.isArray(tracks)) return [];
    return tracks
      .map(normalizeCaptionTrack)
      .filter((track) => track.baseUrl && track.languageCode);
  }

  function scoreLanguage(track, preferredLanguages) {
    const code = String(track?.languageCode || '').toLowerCase();
    const name = String(track?.name || '').toLowerCase();
    const preferred = (preferredLanguages || []).map((item) => String(item || '').toLowerCase()).filter(Boolean);
    let score = 0;

    preferred.forEach((language, index) => {
      const normalized = language.split('-')[0];
      if (code === language || code.startsWith(language + '-')) {
        score = Math.max(score, 1000 - index * 20);
      } else if (normalized && code.split('-')[0] === normalized) {
        score = Math.max(score, 900 - index * 20);
      }
    });

    if (/^zh/i.test(code) || /chinese|mandarin/i.test(name)) score = Math.max(score, 850);
    if (/^en/i.test(code) || /english/i.test(name)) score = Math.max(score, 800);
    if (!track?.isAutomatic) score += 40;
    return score;
  }

  function selectCaption(tracks, options) {
    return rankCaptionTracks(tracks, options)[0] || null;
  }

  function rankCaptionTracks(tracks, options) {
    if (!Array.isArray(tracks) || !tracks.length) return [];
    const navigatorLanguage = global.navigator?.language || '';
    const preferredLanguages = [
      ...(options?.preferredLanguages || []),
      navigatorLanguage,
      'zh-CN',
      'zh-Hans',
      'zh',
      'en'
    ].filter(Boolean);

    return tracks
      .slice()
      .sort((left, right) => {
        const scoreDiff = scoreLanguage(right, preferredLanguages) - scoreLanguage(left, preferredLanguages);
        if (scoreDiff) return scoreDiff;
        if (left.isAutomatic !== right.isAutomatic) return left.isAutomatic ? 1 : -1;
        return left.index - right.index;
      });
  }

  function isAllowedCaptionUrl(url) {
    try {
      const host = new URL(url).hostname || '';
      return YOUTUBE_HOST_PATTERN.test(host) || GOOGLEVIDEO_HOST_PATTERN.test(host);
    } catch {
      return false;
    }
  }

  function buildCaptionFetchUrl(track) {
    const parsed = new URL(track.baseUrl);
    parsed.searchParams.set('fmt', 'json3');
    return parsed.toString();
  }

  function parseJson3Caption(text) {
    const json = JSON.parse(text);
    const lines = (Array.isArray(json.events) ? json.events : [])
      .map((event) => {
        const content = normalizeWhitespace((event.segs || []).map((seg) => seg?.utf8 || '').join(''));
        if (!content) return null;
        return {
          startSeconds: Number(event.tStartMs || 0) / 1000,
          durationSeconds: Number(event.dDurationMs || 0) / 1000,
          text: content
        };
      })
      .filter(Boolean);

    return {
      format: 'json3',
      lines,
      rawText: text
    };
  }

  function readXmlAttr(attrs, name) {
    const match = String(attrs || '').match(new RegExp(name + '\\s*=\\s*([\'"])(.*?)\\1', 'i'));
    return match ? decodeTextEntities(match[2]) : '';
  }

  function parseXmlCaption(text) {
    const lines = [];
    const regex = /<text\b([^>]*)>([\s\S]*?)<\/text>/gi;
    let match;
    while ((match = regex.exec(String(text || '')))) {
      const attrs = match[1] || '';
      const content = normalizeWhitespace(decodeTextEntities(match[2] || ''));
      if (!content) continue;
      lines.push({
        startSeconds: Number(readXmlAttr(attrs, 'start') || 0),
        durationSeconds: Number(readXmlAttr(attrs, 'dur') || 0),
        text: content
      });
    }

    return {
      format: 'xml',
      lines,
      rawText: text
    };
  }

  function parseCaptionResponse(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      return { format: 'empty', lines: [], rawText: '' };
    }
    if (trimmed[0] === '{') {
      return parseJson3Caption(trimmed);
    }
    return parseXmlCaption(trimmed);
  }

  async function fetchCaptionBody(track, videoId, options) {
    const url = buildCaptionFetchUrl(track);
    if (!isAllowedCaptionUrl(url)) {
      throw new Error('Unexpected YouTube caption host: ' + new URL(url).hostname);
    }

    const response = await fetchWithTimeout(url, {
      credentials: 'include',
      headers: {
        Accept: 'application/json, text/plain, */*'
      },
      referrer: 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId || '')
    }, options?.captionTimeoutMs);

    if (!response.ok) {
      throw new Error(`YouTube caption request failed: HTTP ${response.status}`);
    }

    return parseCaptionResponse(await response.text());
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
      text: value.slice(0, limit) + `\n... truncated: original ${value.length} chars, showing first ${limit} chars ...`,
      truncated: true,
      originalLength: value.length
    };
  }

  function formatCaptionLines(lines) {
    return (lines || [])
      .map((line) => {
        const text = normalizeWhitespace(line?.text || '');
        if (!text) return '';
        return `[${formatSeconds(line.startSeconds)}] ${text}`;
      })
      .filter(Boolean);
  }

  function formatCaptionText(video, caption, track) {
    const captionLines = formatCaptionLines(caption?.lines || []);
    if (!captionLines.length) return '';

    return normalizeWhitespace([
      '# YouTube video information',
      `Title: ${video.title || video.videoId}`,
      video.author ? `Channel: ${video.author}` : '',
      video.duration ? `Duration: ${formatSeconds(video.duration)}` : '',
      video.description ? `Description: ${video.description}` : '',
      '',
      '# Transcript',
      track?.name || track?.languageCode ? `Caption language: ${[track.name, track.languageCode].filter(Boolean).join(' / ')}` : '',
      track?.isAutomatic ? 'Caption type: automatic captions' : 'Caption type: creator-provided captions',
      ...captionLines
    ].filter(Boolean).join('\n'));
  }

  function buildCaptionDebug(caption, track) {
    const lines = formatCaptionLines(caption?.lines || []);
    const textInfo = limitDebugText(lines.join('\n'));
    const jsonText = JSON.stringify({
      languageCode: track?.languageCode || '',
      languageName: track?.name || '',
      isAutomatic: !!track?.isAutomatic,
      format: caption?.format || '',
      lines: caption?.lines || []
    }, null, 2);

    return {
      attempted: true,
      languageCode: track?.languageCode || '',
      languageName: track?.name || '',
      kind: track?.kind || '',
      isAutomatic: !!track?.isAutomatic,
      isTranslatable: !!track?.isTranslatable,
      captionUrl: track?.baseUrl || '',
      lineCount: lines.length,
      originalTextLength: textInfo.originalLength,
      truncated: textInfo.truncated,
      text: textInfo.text,
      jsonText,
      jsonLength: jsonText.length
    };
  }

  function buildFallbackText(video, diagnostics) {
    const reasons = [];
    const captions = diagnostics?.debug?.captions || {};
    if (!diagnostics?.debug?.hasPlayerResponse) reasons.push('The YouTube player response was not found in the page.');
    if (!captions.availableCount) reasons.push('No accessible caption tracks were found.');
    if (captions.error) reasons.push('Caption extraction failed: ' + captions.error);

    return normalizeWhitespace([
      '# YouTube video information',
      `Title: ${video.title || video.videoId}`,
      video.author ? `Channel: ${video.author}` : '',
      video.duration ? `Duration: ${formatSeconds(video.duration)}` : '',
      video.description ? `Description: ${video.description}` : '',
      '',
      '# Extraction status',
      ...reasons.map((item) => `- ${item}`),
      '- Summary can only use title, description, and visible page information.'
    ].filter(Boolean).join('\n'));
  }

  async function extractYoutubeVideoSource(options) {
    const doc = options?.document || global.document;
    const url = options?.url || global.location?.href || '';
    const videoId = extractVideoId(url);
    if (!videoId || !isYoutubeVideoUrl(url)) return null;

    const diagnostics = {
      provider: 'youtube',
      videoId,
      sourceKind: 'fallback',
      stages: [],
      debug: {
        selectedSource: 'fallback',
        hasPlayerResponse: false,
        captions: {
          attempted: false,
          availableCount: 0,
          usedAsSource: false
        }
      }
    };

    let playerResponse = readPlayerResponseFromDom(doc);
    let playerResponseSource = playerResponse ? 'dom' : '';
    diagnostics.stages.push({
      name: 'player_response_dom',
      code: playerResponse ? 'ok' : 'missing',
      message: playerResponse ? '' : 'ytInitialPlayerResponse not found in current DOM'
    });

    if (!playerResponse && options?.fetchWatchPage !== false) {
      diagnostics.debug.watchHtml = {
        attempted: true,
        ok: false
      };
      try {
        const watchPayload = await fetchPlayerResponseFromWatchPage(videoId, url, options);
        diagnostics.debug.watchHtml = {
          attempted: true,
          ok: !!watchPayload.playerResponse,
          htmlLength: watchPayload.htmlLength,
          url: watchPayload.url
        };
        diagnostics.stages.push({
          name: 'watch_html_player_response',
          code: watchPayload.playerResponse ? 'ok' : 'missing',
          message: watchPayload.playerResponse ? '' : 'ytInitialPlayerResponse not found in fetched watch HTML'
        });
        if (watchPayload.playerResponse) {
          playerResponse = watchPayload.playerResponse;
          playerResponseSource = 'watch_html';
        }
      } catch (error) {
        const message = error?.message || String(error || '');
        diagnostics.debug.watchHtml = Object.assign({}, diagnostics.debug.watchHtml, {
          error: message
        });
        diagnostics.stages.push({
          name: 'watch_html_player_response',
          code: 'error',
          message
        });
      }
    } else {
      diagnostics.debug.watchHtml = {
        attempted: false,
        ok: false
      };
    }

    diagnostics.debug.hasPlayerResponse = !!playerResponse;
    diagnostics.debug.playerResponseSource = playerResponseSource || 'missing';
    diagnostics.stages.push({
      name: 'player_response',
      code: playerResponse ? 'ok' : 'missing',
      source: playerResponseSource || '',
      message: playerResponse ? '' : 'ytInitialPlayerResponse not found'
    });

    const video = normalizeVideoPayload(playerResponse || {}, videoId, doc);
    diagnostics.debug.video = {
      videoId: video.videoId,
      title: video.title,
      author: video.author,
      duration: video.duration,
      isLive: video.isLive
    };

    let sourceText = '';
    let sourceKind = 'fallback';
    let usedCaptionTrack = null;
    const captionTracks = collectCaptionTracks(playerResponse);
    const rankedCaptions = rankCaptionTracks(captionTracks, options);
    const selectedCaption = rankedCaptions[0] || null;
    const maxCaptionAttempts = Math.min(
      rankedCaptions.length,
      Math.max(1, Number(options?.maxCaptionAttempts || DEFAULT_MAX_CAPTION_ATTEMPTS))
    );
    diagnostics.debug.captions = {
      attempted: !!selectedCaption,
      availableCount: captionTracks.length,
      attemptLimit: maxCaptionAttempts,
      attemptedCount: 0,
      selectedLanguageCode: selectedCaption?.languageCode || '',
      selectedLanguageName: selectedCaption?.name || '',
      selectedKind: selectedCaption?.kind || '',
      usedAsSource: false,
      candidates: rankedCaptions.slice(0, 8).map((track) => ({
        languageCode: track.languageCode,
        languageName: track.name,
        kind: track.kind,
        isAutomatic: track.isAutomatic,
        isTranslatable: track.isTranslatable,
        captionUrl: track.baseUrl
      }))
    };

    if (rankedCaptions.length) {
      const errors = [];
      const attempts = rankedCaptions.slice(0, maxCaptionAttempts);
      for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
        const candidate = attempts[attemptIndex];
        diagnostics.debug.captions.attemptedCount = attemptIndex + 1;
        try {
          const caption = await fetchCaptionBody(candidate, video.videoId, options);
          const captionText = formatCaptionText(video, caption, candidate);
          diagnostics.stages.push({
            name: 'caption',
            code: captionText ? 'ok' : 'empty',
            languageCode: candidate.languageCode,
            languageName: candidate.name,
            isAutomatic: candidate.isAutomatic,
            attempt: attemptIndex + 1
          });

          if (!captionText) {
            errors.push(candidate.languageCode + ': empty caption response');
            continue;
          }

          sourceText = captionText;
          sourceKind = 'caption';
          usedCaptionTrack = candidate;
          diagnostics.debug.selectedSource = sourceKind;
          diagnostics.debug.captions.selectedLanguageCode = candidate.languageCode;
          diagnostics.debug.captions.selectedLanguageName = candidate.name;
          diagnostics.debug.captions.selectedKind = candidate.kind;
          diagnostics.debug.captions.errors = errors;
          diagnostics.debug.captions = Object.assign(
            {},
            diagnostics.debug.captions,
            buildCaptionDebug(caption, candidate),
            {
              usedAsSource: true,
              attemptedCount: attemptIndex + 1
            }
          );
          break;
        } catch (error) {
          const message = error?.message || String(error || '');
          errors.push(candidate.languageCode + ': ' + message);
          diagnostics.stages.push({
            name: 'caption',
            code: 'error',
            languageCode: candidate.languageCode,
            languageName: candidate.name,
            isAutomatic: candidate.isAutomatic,
            attempt: attemptIndex + 1,
            message
          });
        }
      }

      if (!sourceText && errors.length) {
        diagnostics.debug.captions = Object.assign(
          {},
          diagnostics.debug.captions,
          {
            attempted: true,
            errors,
            error: errors.join(' | ')
          }
        );
      }
    }

    if (!sourceText) {
      sourceText = buildFallbackText(video, diagnostics);
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
        siteName: 'YouTube',
        publishedAt: video.publishedAt,
        language: usedCaptionTrack?.languageCode || selectedCaption?.languageCode || ''
      },
      video,
      diagnostics
    };
  }

  const api = {
    isYoutubeVideoUrl,
    extractVideoId,
    parsePlayerResponseFromText,
    readPlayerResponseFromDom,
    fetchPlayerResponseFromWatchPage,
    normalizeVideoPayload,
    normalizeCaptionTrack,
    collectCaptionTracks,
    rankCaptionTracks,
    selectCaption,
    parseCaptionResponse,
    formatCaptionText,
    buildCaptionDebug,
    buildFallbackText,
    extractYoutubeVideoSource
  };

  global.AISummaryYoutubeSource = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

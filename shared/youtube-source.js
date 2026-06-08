(function (global) {
  const Domain = global.AISummaryDomain || (typeof require === 'function' ? require('./domain.js') : null);

  const YOUTUBE_HOST_PATTERN = /(^|\.)youtube(?:-nocookie)?\.com$/i;
  const YOUTU_BE_HOST_PATTERN = /(^|\.)youtu\.be$/i;
  const GOOGLEVIDEO_HOST_PATTERN = /(^|\.)googlevideo\.com$/i;
  const VIDEO_ID_PATTERN = /^[0-9A-Za-z_-]{11}$/;
  const DEFAULT_DEBUG_TEXT_LIMIT = 120000;
  const DEFAULT_FETCH_TIMEOUT_MS = 12000;
  const DEFAULT_MAX_CAPTION_ATTEMPTS = 3;
  const DEFAULT_CAPTION_FORMATS = ['json3', '', 'srv3', 'vtt'];
  const DEFAULT_MAX_TRANSLATION_TARGETS = 2;
  const DEFAULT_MAX_TRANSLATION_SOURCE_TRACKS = 2;
  const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player';
  const INNERTUBE_CONTEXT = {
    client: {
      clientName: 'WEB',
      clientVersion: '2.20240313'
    }
  };

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

  function extractInnertubeApiKeyFromText(text) {
    const match = String(text || '').match(/"INNERTUBE_API_KEY"\s*:\s*"([0-9A-Za-z_-]+)"/);
    return match?.[1] || '';
  }

  function readInnertubeApiKeyFromDom(doc) {
    const scripts = Array.from(doc?.querySelectorAll?.('script') || []);
    for (const script of scripts) {
      const text = script.textContent || '';
      if (!text.includes('INNERTUBE_API_KEY')) continue;
      const apiKey = extractInnertubeApiKeyFromText(text);
      if (apiKey) return apiKey;
    }
    return '';
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

  function getPlayerResponseVideoId(playerResponse) {
    const candidates = [
      playerResponse?.videoDetails?.videoId,
      playerResponse?.microformat?.playerMicroformatRenderer?.externalVideoId,
      playerResponse?.microformat?.playerMicroformatRenderer?.videoId
    ];
    return candidates.find((value) => isValidVideoId(value)) || '';
  }

  function getPlayerResponseMatch(playerResponse, expectedVideoId) {
    if (!playerResponse?.videoDetails) {
      return {
        actualVideoId: '',
        isStale: false,
        matches: false
      };
    }

    const actualVideoId = getPlayerResponseVideoId(playerResponse);
    const expected = isValidVideoId(expectedVideoId) ? expectedVideoId : '';
    const isStale = !!expected && !!actualVideoId && actualVideoId !== expected;
    return {
      actualVideoId,
      isStale,
      matches: !isStale
    };
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
    const apiKey = extractInnertubeApiKeyFromText(html);
    return {
      url,
      htmlLength: html.length,
      apiKey,
      playerResponse: playerResponse?.videoDetails ? playerResponse : null
    };
  }

  async function fetchPlayerResponseFromInnertube(videoId, apiKey, sourceUrl, options) {
    const parsed = new URL(INNERTUBE_API_URL);
    parsed.searchParams.set('key', apiKey);
    const response = await fetchWithTimeout(parsed.toString(), {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      referrer: sourceUrl || 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId || ''),
      body: JSON.stringify({
        context: INNERTUBE_CONTEXT,
        videoId
      })
    }, options?.innertubeTimeoutMs);

    if (!response.ok) {
      throw new Error(`YouTube InnerTube player request failed: HTTP ${response.status}`);
    }

    return response.json();
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

  function normalizeCaptionTrack(track, index, extra) {
    const languageCode = String(track?.languageCode || '').trim();
    const name = normalizeWhitespace(getSimpleText(track?.name) || languageCode);
    const baseUrl = decodeTextEntities(track?.baseUrl || '');
    const kind = String(track?.kind || '').trim();
    const vssId = String(track?.vssId || '').trim();
    return Object.assign({
      index: Number.isFinite(Number(index)) ? Number(index) : 0,
      baseUrl,
      languageCode,
      name,
      kind,
      vssId,
      isAutomatic: kind === 'asr' || /^a\./i.test(vssId),
      isTranslatable: track?.isTranslatable !== false,
      raw: track
    }, extra || {});
  }

  function collectCaptionTracks(playerResponse) {
    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!Array.isArray(tracks)) return [];
    return tracks
      .map(normalizeCaptionTrack)
      .filter((track) => track.baseUrl && track.languageCode);
  }

  function collectTranslationLanguages(playerResponse) {
    const languages = playerResponse?.captions?.playerCaptionsTracklistRenderer?.translationLanguages || [];
    if (!Array.isArray(languages)) return [];
    return languages
      .map((language, index) => ({
        index,
        languageCode: String(language?.languageCode || '').trim(),
        languageName: normalizeWhitespace(getSimpleText(language?.languageName) || language?.languageCode || '')
      }))
      .filter((language) => language.languageCode);
  }

  function normalizeLanguageCode(value) {
    return String(value || '').toLowerCase().replace(/_/g, '-');
  }

  function getLanguageBase(value) {
    return normalizeLanguageCode(value).split('-')[0];
  }

  function languageMatchesPreference(languageCode, preference) {
    const code = normalizeLanguageCode(languageCode);
    const preferred = normalizeLanguageCode(preference);
    if (!code || !preferred) return false;
    if (code === preferred || code.startsWith(preferred + '-')) return true;
    const codeBase = getLanguageBase(code);
    const preferredBase = getLanguageBase(preferred);
    if (codeBase !== preferredBase) return false;
    if (preferredBase !== 'zh') return true;
    if (/hans|cn|sg/.test(preferred)) return /hans|cn|sg/.test(code);
    if (/hant|tw|hk|mo/.test(preferred)) return /hant|tw|hk|mo/.test(code);
    return true;
  }

  function collectPreferredLanguages(options) {
    const navigatorLanguage = global.navigator?.language || '';
    return [
      ...(options?.preferredLanguages || []),
      navigatorLanguage,
      'zh-CN',
      'zh-Hans',
      'zh',
      'en'
    ].filter(Boolean);
  }

  function selectTranslationTargets(playerResponse, preferredLanguages, options) {
    if (options?.includeTranslatedCaptions === false) return [];
    const translationLanguages = collectTranslationLanguages(playerResponse);
    if (!translationLanguages.length) return [];

    const seen = new Set();
    const targets = [];
    const maxTargets = Math.max(0, Number(options?.maxTranslationTargets || DEFAULT_MAX_TRANSLATION_TARGETS));
    for (const preferredLanguage of preferredLanguages || []) {
      const matched = translationLanguages.find((language) => languageMatchesPreference(language.languageCode, preferredLanguage));
      if (!matched || seen.has(matched.languageCode)) continue;
      seen.add(matched.languageCode);
      targets.push(matched);
      if (targets.length >= maxTargets) break;
    }

    return targets;
  }

  function buildTranslatedCaptionUrl(sourceTrack, targetLanguage) {
    const parsed = new URL(sourceTrack.baseUrl);
    parsed.searchParams.set('tlang', targetLanguage.languageCode);
    return parsed.toString();
  }

  function buildTranslatedCaptionTrack(sourceTrack, targetLanguage, index) {
    const baseUrl = buildTranslatedCaptionUrl(sourceTrack, targetLanguage);
    return normalizeCaptionTrack({
      baseUrl,
      languageCode: targetLanguage.languageCode,
      name: { simpleText: targetLanguage.languageName || targetLanguage.languageCode },
      kind: sourceTrack.kind || '',
      vssId: sourceTrack.vssId || '',
      isTranslatable: false
    }, index, {
      isAutomatic: sourceTrack.isAutomatic,
      isTranslatable: false,
      isTranslated: true,
      sourceLanguageCode: sourceTrack.languageCode,
      sourceLanguageName: sourceTrack.name,
      translationLanguageCode: targetLanguage.languageCode,
      translationLanguageName: targetLanguage.languageName,
      sourceTrackIndex: sourceTrack.index,
      raw: sourceTrack.raw
    });
  }

  function collectCaptionCandidates(playerResponse, options) {
    const nativeTracks = collectCaptionTracks(playerResponse);
    if (!nativeTracks.length) return nativeTracks;

    const preferredLanguages = collectPreferredLanguages(options);
    const translationTargets = selectTranslationTargets(playerResponse, preferredLanguages, options);
    if (!translationTargets.length) return nativeTracks;

    const sourceLimit = Math.max(1, Number(options?.maxTranslationSourceTracks || DEFAULT_MAX_TRANSLATION_SOURCE_TRACKS));
    const sourceTracks = rankCaptionTracks(nativeTracks, Object.assign({}, options, {
      preferredLanguages: [
        ...(options?.sourceCaptionLanguages || []),
        ...preferredLanguages,
        'en'
      ]
    }))
      .filter((track) => track.isTranslatable)
      .slice(0, sourceLimit);

    const translatedTracks = [];
    sourceTracks.forEach((sourceTrack) => {
      translationTargets.forEach((targetLanguage) => {
        if (languageMatchesPreference(sourceTrack.languageCode, targetLanguage.languageCode)) return;
        translatedTracks.push(buildTranslatedCaptionTrack(
          sourceTrack,
          targetLanguage,
          nativeTracks.length + translatedTracks.length
        ));
      });
    });

    return nativeTracks.concat(translatedTracks);
  }

  function scoreLanguage(track, preferredLanguages) {
    const code = normalizeLanguageCode(track?.languageCode || track?.translationLanguageCode || '');
    const name = String(track?.name || '').toLowerCase();
    const preferred = (preferredLanguages || []).map(normalizeLanguageCode).filter(Boolean);
    let score = 0;

    preferred.forEach((language, index) => {
      if (code === language || code.startsWith(language + '-')) {
        score = Math.max(score, 1000 - index * 80);
      } else if (languageMatchesPreference(code, language)) {
        score = Math.max(score, 900 - index * 80);
      }
    });

    if (/^zh/i.test(code) || /chinese|mandarin/i.test(name)) score = Math.max(score, 850);
    if (/^en/i.test(code) || /english/i.test(name)) score = Math.max(score, 800);
    if (!track?.isAutomatic) score += 40;
    if (track?.isTranslated) score -= 80;
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

  function normalizeCaptionFormats(options) {
    const requested = Array.isArray(options?.captionFormats) && options.captionFormats.length
      ? options.captionFormats
      : DEFAULT_CAPTION_FORMATS;
    const seen = new Set();
    return requested
      .map((format) => String(format || '').trim())
      .filter((format) => {
        const key = format || 'default';
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function buildCaptionFetchUrl(track, format, options) {
    const parsed = new URL(track.baseUrl);
    if (format) {
      parsed.searchParams.set('fmt', format);
    } else {
      parsed.searchParams.delete('fmt');
    }
    if (options?.stripVariant) {
      parsed.searchParams.delete('variant');
    }
    return parsed.toString();
  }

  function buildCaptionFetchRequests(track, options) {
    const formats = normalizeCaptionFormats(options);
    const variants = [false];
    try {
      if (new URL(track.baseUrl).searchParams.has('variant')) {
        variants.push(true);
      }
    } catch {}

    return formats.flatMap((format) => variants.map((stripVariant) => ({
      format,
      stripVariant,
      url: buildCaptionFetchUrl(track, format, { stripVariant })
    })));
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

    if (lines.length) {
      return {
        format: 'xml',
        lines,
        rawText: text
      };
    }

    const srv3Regex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
    while ((match = srv3Regex.exec(String(text || '')))) {
      const attrs = match[1] || '';
      const content = normalizeWhitespace(decodeTextEntities(
        String(match[2] || '')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, '')
      ));
      if (!content) continue;
      const startMs = Number(readXmlAttr(attrs, 't') || 0);
      const durationMs = Number(readXmlAttr(attrs, 'd') || 0);
      lines.push({
        startSeconds: startMs / 1000,
        durationSeconds: durationMs / 1000,
        text: content
      });
    }

    return {
      format: lines.length ? 'srv3' : 'xml',
      lines,
      rawText: text
    };
  }

  function parseVttTimestamp(input) {
    const parts = String(input || '').trim().split(':');
    if (parts.length < 2) return 0;
    const secondsPart = Number(parts.pop() || 0);
    const minutes = Number(parts.pop() || 0);
    const hours = Number(parts.pop() || 0);
    return hours * 3600 + minutes * 60 + secondsPart;
  }

  function cleanVttCueText(input) {
    return normalizeWhitespace(decodeTextEntities(
      String(input || '')
        .replace(/<[^>]+>/g, '')
        .replace(/\{\\[^}]+\}/g, '')
    ));
  }

  function parseWebVttCaption(text) {
    const lines = [];
    const blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
    blocks.forEach((block) => {
      const cueLines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      if (!cueLines.length || /^WEBVTT/i.test(cueLines[0]) || /^NOTE\b/i.test(cueLines[0])) return;
      const timingIndex = cueLines.findIndex((line) => line.includes('-->'));
      if (timingIndex < 0) return;
      const timing = cueLines[timingIndex].split('-->');
      const startSeconds = parseVttTimestamp(timing[0]);
      const endSeconds = parseVttTimestamp(String(timing[1] || '').split(/\s+/)[0]);
      const content = cleanVttCueText(cueLines.slice(timingIndex + 1).join(' '));
      if (!content) return;
      lines.push({
        startSeconds,
        durationSeconds: Math.max(0, endSeconds - startSeconds),
        text: content
      });
    });

    return {
      format: 'vtt',
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
    if (/^WEBVTT\b/i.test(trimmed) || trimmed.includes('-->')) {
      return parseWebVttCaption(trimmed);
    }
    return parseXmlCaption(trimmed);
  }

  async function fetchCaptionBody(track, videoId, options) {
    const requests = buildCaptionFetchRequests(track, options);
    let emptyCaption = null;
    let lastError = null;

    for (const request of requests) {
      if (!isAllowedCaptionUrl(request.url)) {
        throw new Error('Unexpected YouTube caption host: ' + new URL(request.url).hostname);
      }

      try {
        const response = await fetchWithTimeout(request.url, {
          credentials: 'include',
          headers: {
            Accept: 'application/json, text/plain, */*'
          },
          referrer: 'https://www.youtube.com/watch?v=' + encodeURIComponent(videoId || '')
        }, options?.captionTimeoutMs);

        if (!response.ok) {
          lastError = new Error(`YouTube caption request failed: HTTP ${response.status}`);
          continue;
        }

        const parsed = Object.assign(parseCaptionResponse(await response.text()), {
          requestFormat: request.format || 'default',
          requestVariant: request.stripVariant ? 'without_variant' : 'as_provided'
        });
        if (parsed.lines?.length) return parsed;
        emptyCaption = emptyCaption || parsed;
        lastError = new Error(`empty caption response (${parsed.requestFormat}, ${parsed.requestVariant})`);
      } catch (error) {
        lastError = error;
      }
    }

    if (emptyCaption) return emptyCaption;
    throw lastError || new Error('empty caption response');
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
      isTranslated: !!track?.isTranslated,
      sourceLanguageCode: track?.sourceLanguageCode || '',
      sourceLanguageName: track?.sourceLanguageName || '',
      translationLanguageCode: track?.translationLanguageCode || '',
      translationLanguageName: track?.translationLanguageName || '',
      requestFormat: caption?.requestFormat || caption?.format || '',
      requestVariant: caption?.requestVariant || '',
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

    let playerResponse = options?.playerResponse || readPlayerResponseFromDom(doc);
    let playerResponseSource = options?.playerResponse ? 'options' : (playerResponse ? 'dom' : '');
    let innertubeApiKey = readInnertubeApiKeyFromDom(doc);
    let innertubeApiKeySource = innertubeApiKey ? 'dom' : '';
    const domResponseMatch = getPlayerResponseMatch(playerResponse, videoId);
    if (domResponseMatch.isStale) {
      diagnostics.debug.stalePlayerResponse = {
        expectedVideoId: videoId,
        actualVideoId: domResponseMatch.actualVideoId,
        source: options?.playerResponse ? 'options' : 'dom'
      };
      playerResponse = null;
      playerResponseSource = '';
    }
    diagnostics.stages.push({
      name: 'player_response_dom',
      code: domResponseMatch.isStale ? 'stale' : (playerResponse ? 'ok' : 'missing'),
      expectedVideoId: videoId,
      actualVideoId: domResponseMatch.actualVideoId,
      message: domResponseMatch.isStale
        ? `Current ${options?.playerResponse ? 'provided' : 'DOM'} playerResponse belongs to a previous YouTube video`
        : (playerResponse ? '' : 'playerResponse not found')
    });

    if (!playerResponse && options?.fetchWatchPage !== false) {
      diagnostics.debug.watchHtml = {
        attempted: true,
        ok: false
      };
      try {
        const watchPayload = await fetchPlayerResponseFromWatchPage(videoId, url, options);
        const watchResponseMatch = getPlayerResponseMatch(watchPayload.playerResponse, videoId);
        const matchedWatchPlayerResponse = watchResponseMatch.isStale ? null : watchPayload.playerResponse;
        diagnostics.debug.watchHtml = {
          attempted: true,
          ok: !!matchedWatchPlayerResponse,
          htmlLength: watchPayload.htmlLength,
          url: watchPayload.url,
          hasInnertubeApiKey: !!watchPayload.apiKey,
          actualVideoId: watchResponseMatch.actualVideoId
        };
        if (!innertubeApiKey && watchPayload.apiKey) {
          innertubeApiKey = watchPayload.apiKey;
          innertubeApiKeySource = 'watch_html';
        }
        if (watchResponseMatch.isStale) {
          diagnostics.debug.watchHtml.stalePlayerResponse = {
            expectedVideoId: videoId,
            actualVideoId: watchResponseMatch.actualVideoId
          };
        }
        diagnostics.stages.push({
          name: 'watch_html_player_response',
          code: watchResponseMatch.isStale ? 'stale' : (matchedWatchPlayerResponse ? 'ok' : 'missing'),
          expectedVideoId: videoId,
          actualVideoId: watchResponseMatch.actualVideoId,
          message: watchResponseMatch.isStale
            ? 'Fetched watch HTML ytInitialPlayerResponse belongs to a different YouTube video'
            : (matchedWatchPlayerResponse ? '' : 'ytInitialPlayerResponse not found in fetched watch HTML')
        });
        if (matchedWatchPlayerResponse) {
          playerResponse = matchedWatchPlayerResponse;
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

    if (
      options?.fetchWatchPage !== false &&
      !diagnostics.debug.watchHtml.attempted &&
      collectCaptionTracks(playerResponse).length === 0 &&
      !innertubeApiKey
    ) {
      diagnostics.debug.watchHtml = {
        attempted: true,
        ok: false,
        reason: 'caption_discovery'
      };
      try {
        const watchPayload = await fetchPlayerResponseFromWatchPage(videoId, url, options);
        const watchResponseMatch = getPlayerResponseMatch(watchPayload.playerResponse, videoId);
        const matchedWatchPlayerResponse = watchResponseMatch.isStale ? null : watchPayload.playerResponse;
        const watchCaptionTrackCount = collectCaptionTracks(matchedWatchPlayerResponse).length;
        diagnostics.debug.watchHtml = {
          attempted: true,
          ok: !!matchedWatchPlayerResponse,
          reason: 'caption_discovery',
          htmlLength: watchPayload.htmlLength,
          url: watchPayload.url,
          hasInnertubeApiKey: !!watchPayload.apiKey,
          captionTrackCount: watchCaptionTrackCount,
          actualVideoId: watchResponseMatch.actualVideoId
        };
        if (watchPayload.apiKey) {
          innertubeApiKey = watchPayload.apiKey;
          innertubeApiKeySource = 'watch_html';
        }
        diagnostics.stages.push({
          name: 'watch_html_player_response',
          code: watchResponseMatch.isStale ? 'stale' : (matchedWatchPlayerResponse ? 'ok' : 'missing'),
          expectedVideoId: videoId,
          actualVideoId: watchResponseMatch.actualVideoId,
          captionTrackCount: watchCaptionTrackCount,
          message: watchResponseMatch.isStale
            ? 'Fetched watch HTML ytInitialPlayerResponse belongs to a different YouTube video'
            : (matchedWatchPlayerResponse ? '' : 'ytInitialPlayerResponse not found in fetched watch HTML')
        });
        if (matchedWatchPlayerResponse && watchCaptionTrackCount > 0) {
          playerResponse = matchedWatchPlayerResponse;
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
    }

    if (
      options?.fetchInnertube !== false &&
      innertubeApiKey &&
      collectCaptionTracks(playerResponse).length === 0
    ) {
      diagnostics.debug.innertube = {
        attempted: true,
        ok: false,
        apiKeySource: innertubeApiKeySource
      };
      try {
        const innertubePlayerResponse = await fetchPlayerResponseFromInnertube(videoId, innertubeApiKey, url, options);
        const innertubeMatch = getPlayerResponseMatch(innertubePlayerResponse, videoId);
        const innertubeTrackCount = collectCaptionTracks(innertubePlayerResponse).length;
        const matchedInnertubePlayerResponse = innertubeMatch.isStale ? null : innertubePlayerResponse;
        diagnostics.debug.innertube = Object.assign({}, diagnostics.debug.innertube, {
          ok: !!matchedInnertubePlayerResponse && innertubeTrackCount > 0,
          captionTrackCount: innertubeTrackCount,
          actualVideoId: innertubeMatch.actualVideoId
        });
        diagnostics.stages.push({
          name: 'innertube_player_response',
          code: innertubeMatch.isStale ? 'stale' : (innertubeTrackCount ? 'ok' : 'missing_captions'),
          expectedVideoId: videoId,
          actualVideoId: innertubeMatch.actualVideoId,
          captionTrackCount: innertubeTrackCount,
          message: innertubeMatch.isStale
            ? 'InnerTube player response belongs to a different YouTube video'
            : (innertubeTrackCount ? '' : 'InnerTube player response did not include caption tracks')
        });
        if (matchedInnertubePlayerResponse && innertubeTrackCount > 0) {
          playerResponse = matchedInnertubePlayerResponse;
          playerResponseSource = 'innertube';
        }
      } catch (error) {
        const message = error?.message || String(error || '');
        diagnostics.debug.innertube = Object.assign({}, diagnostics.debug.innertube, {
          error: message
        });
        diagnostics.stages.push({
          name: 'innertube_player_response',
          code: 'error',
          message
        });
      }
    } else {
      diagnostics.debug.innertube = {
        attempted: false,
        ok: false,
        apiKeySource: innertubeApiKeySource || ''
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

    const metadataDocument = domResponseMatch.isStale ? null : doc;
    const video = normalizeVideoPayload(playerResponse || {}, videoId, metadataDocument);
    diagnostics.debug.video = {
      videoId: video.videoId,
      title: video.title,
      author: video.author,
      duration: video.duration,
      isLive: video.isLive
    };

    let sourceText = '';
    let sourceKind = 'fallback';
    let usedCaptionTrack = /** @type {{ languageCode?: string } | null} */ (null);
    let selectedCaption = /** @type {{ languageCode?: string } | null} */ (null);

    function buildCaptionState(currentPlayerResponse) {
      const captionTracks = collectCaptionTracks(currentPlayerResponse);
      const captionCandidates = collectCaptionCandidates(currentPlayerResponse, options);
      const rankedCaptions = rankCaptionTracks(captionCandidates, options);
      const maxCaptionAttempts = Math.min(
        rankedCaptions.length,
        Math.max(1, Number(options?.maxCaptionAttempts || DEFAULT_MAX_CAPTION_ATTEMPTS))
      );
      return {
        captionTracks,
        captionCandidates,
        rankedCaptions,
        selectedCaption: rankedCaptions[0] || null,
        maxCaptionAttempts
      };
    }

    function setCaptionDiagnostics(captionState, extra) {
      selectedCaption = captionState.selectedCaption;
      diagnostics.debug.captions = Object.assign({
        attempted: !!captionState.selectedCaption,
        availableCount: captionState.captionTracks.length,
        candidateCount: captionState.captionCandidates.length,
        translatedCandidateCount: captionState.captionCandidates.filter((track) => track.isTranslated).length,
        attemptLimit: captionState.maxCaptionAttempts,
        attemptedCount: 0,
        selectedLanguageCode: captionState.selectedCaption?.languageCode || '',
        selectedLanguageName: captionState.selectedCaption?.name || '',
        selectedKind: captionState.selectedCaption?.kind || '',
        usedAsSource: false,
        candidates: captionState.rankedCaptions.slice(0, 8).map((track) => ({
          languageCode: track.languageCode,
          languageName: track.name,
          kind: track.kind,
          isAutomatic: track.isAutomatic,
          isTranslatable: track.isTranslatable,
          isTranslated: !!track.isTranslated,
          sourceLanguageCode: track.sourceLanguageCode || '',
          sourceLanguageName: track.sourceLanguageName || '',
          translationLanguageCode: track.translationLanguageCode || '',
          translationLanguageName: track.translationLanguageName || '',
          captionUrl: track.baseUrl
        }))
      }, extra || {});
    }

    async function tryCaptionState(captionState, reason) {
      if (!captionState.rankedCaptions.length) return [];
      const errors = [];
      const attempts = captionState.rankedCaptions.slice(0, captionState.maxCaptionAttempts);
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
            isTranslated: !!candidate.isTranslated,
            sourceLanguageCode: candidate.sourceLanguageCode || '',
            attempt: attemptIndex + 1,
            reason: reason || ''
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
            isTranslated: !!candidate.isTranslated,
            sourceLanguageCode: candidate.sourceLanguageCode || '',
            attempt: attemptIndex + 1,
            reason: reason || '',
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

      return errors;
    }

    let captionState = buildCaptionState(playerResponse);
    setCaptionDiagnostics(captionState);
    await tryCaptionState(captionState);

    if (
      !sourceText &&
      options?.fetchInnertube !== false &&
      innertubeApiKey &&
      !diagnostics.debug.innertube?.attempted
    ) {
      const priorCaptionErrors = Array.isArray(diagnostics.debug.captions?.errors)
        ? diagnostics.debug.captions.errors.slice()
        : [];
      diagnostics.debug.innertube = {
        attempted: true,
        ok: false,
        apiKeySource: innertubeApiKeySource,
        reason: 'empty_caption_recovery'
      };
      try {
        const innertubePlayerResponse = await fetchPlayerResponseFromInnertube(videoId, innertubeApiKey, url, options);
        const innertubeMatch = getPlayerResponseMatch(innertubePlayerResponse, videoId);
        const innertubeTrackCount = collectCaptionTracks(innertubePlayerResponse).length;
        const matchedInnertubePlayerResponse = innertubeMatch.isStale ? null : innertubePlayerResponse;
        diagnostics.debug.innertube = Object.assign({}, diagnostics.debug.innertube, {
          ok: !!matchedInnertubePlayerResponse && innertubeTrackCount > 0,
          captionTrackCount: innertubeTrackCount,
          actualVideoId: innertubeMatch.actualVideoId
        });
        diagnostics.stages.push({
          name: 'innertube_player_response',
          code: innertubeMatch.isStale ? 'stale' : (innertubeTrackCount ? 'ok' : 'missing_captions'),
          expectedVideoId: videoId,
          actualVideoId: innertubeMatch.actualVideoId,
          captionTrackCount: innertubeTrackCount,
          reason: 'empty_caption_recovery',
          message: innertubeMatch.isStale
            ? 'InnerTube player response belongs to a different YouTube video'
            : (innertubeTrackCount ? '' : 'InnerTube player response did not include caption tracks')
        });
        if (matchedInnertubePlayerResponse && innertubeTrackCount > 0) {
          playerResponse = matchedInnertubePlayerResponse;
          playerResponseSource = 'innertube';
          diagnostics.debug.hasPlayerResponse = true;
          diagnostics.debug.playerResponseSource = playerResponseSource;
          captionState = buildCaptionState(playerResponse);
          setCaptionDiagnostics(captionState, {
            recoveryReason: 'empty_caption_recovery',
            priorErrors: priorCaptionErrors
          });
          await tryCaptionState(captionState, 'empty_caption_recovery');
        }
      } catch (error) {
        const message = error?.message || String(error || '');
        diagnostics.debug.innertube = Object.assign({}, diagnostics.debug.innertube, {
          error: message
        });
        diagnostics.stages.push({
          name: 'innertube_player_response',
          code: 'error',
          reason: 'empty_caption_recovery',
          message
        });
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
        htmlTitle: metadataDocument?.title || video.title,
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
    getPlayerResponseVideoId,
    fetchPlayerResponseFromWatchPage,
    normalizeVideoPayload,
    normalizeCaptionTrack,
    collectCaptionTracks,
    collectCaptionCandidates,
    collectTranslationLanguages,
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

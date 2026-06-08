const { test, assert, freshRequire } = require('./harness');

test('sidebar export helpers sanitize filenames and build bounded source quotes', [
  'export.markdown',
  'export.share_card'
], () => {
  const SidebarExport = freshRequire('sidebar/export.js');

  assert.strictEqual(SidebarExport.sanitizeFilename(' a/b:c* d?e "f" <g> | h '), 'a_b_c_ d_e _f_ _g_ _ h');
  assert.strictEqual(SidebarExport.sanitizeFilename('   '), 'summary');
  assert.strictEqual(SidebarExport.sanitizeFilename('x'.repeat(80)), 'x'.repeat(60));

  const normalized = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  assert.strictEqual(SidebarExport.buildShareQuoteSnippet({
    excerpt: 'Short',
    cleanText: 'This body has enough useful words to be selected when the excerpt is too short.'
  }, 120, { normalizeWhitespace: normalized }), 'This body has enough useful words to be selected when the excerpt is too short.');

  assert.strictEqual(SidebarExport.buildShareQuoteSnippet({
    excerpt: 'This excerpt is deliberately long enough to be preferred over body text.',
    cleanText: 'Body text should not win.'
  }, 48, { normalizeWhitespace: normalized }), 'This excerpt is deliberately long enough to be p...');

  assert.strictEqual(
    SidebarExport.resolveShareModelLabel({ provider: 'openai', model: 'gpt-4.1-mini' }, { model: 'fallback' }, {}),
    '模型：gpt-4.1-mini'
  );
  assert.strictEqual(
    SidebarExport.resolveShareModelLabel({}, { finalRun: { model: 'claude-sonnet-4' } }, { modelName: 'fallback' }),
    '模型：claude-sonnet-4'
  );
  assert.strictEqual(
    SidebarExport.resolveShareModelLabel({}, {}, { modelName: 'custom-model' }),
    '模型：custom-model'
  );
});

test('sidebar export controller resolves current video subtitle artifacts generically', [
  'export.bilibili_subtitle',
  'export.video_subtitle',
  'content.youtube_source'
], async () => {
  const SidebarExport = freshRequire('sidebar/export.js');
  const subtitleTrackSelect = { value: '' };
  let state = {
    article: {
      sourceType: 'video',
      title: 'YouTube clip',
      diagnostics: {
        videoSource: 'youtube',
        youtube: {
          debug: {
            captions: {
              attempted: true,
              textPreview: '[00:01] trimmed only'
            }
          }
        }
      }
    },
    lastDiagnostics: {
      article: {
        diagnostics: {
          youtube: {
            debug: {
              captions: {
                languageCode: 'en',
                languageName: 'English',
                isAutomatic: true,
                text: '[00:01] trimmed only'
              }
            }
          },
          bilibili: {
            debug: {
              subtitles: {
                text: '[00:01] stale subtitle'
              }
            }
          }
        }
      }
    },
    summaryMarkdown: ''
  };
  const controller = SidebarExport.createExportController({
    getState: () => state,
    getElements: () => ({ summaryModeSelect: { value: 'medium' }, subtitleTrackSelect }),
    getCurrentArticle: () => state.article,
    getCurrentRecord: () => null,
    createArticleFromRecord: () => null,
    getShareCardThemePalette: () => ({}),
    sanitizeMarkdownToHtml: (value) => value,
    getStrategyLabel: () => '',
    getModeLabel: () => '',
    formatDateTime: () => '',
    escapeHtml: (value) => String(value || ''),
    setStatus: () => {},
    wait: async () => {}
  });

  assert.strictEqual(controller.hasVideoSubtitleArtifact(), true);
  assert.deepStrictEqual(
    controller.getVideoSubtitleOptions().map((option) => option.key),
    ['youtube-current']
  );

  state = {
    article: {
      sourceType: 'video',
      title: 'YouTube clip without captions',
      diagnostics: {
        videoSource: 'youtube',
        youtube: {
          debug: {
            captions: {
              attempted: false
            }
          }
        }
      }
    },
    lastDiagnostics: {
      article: {
        diagnostics: {
          bilibili: {
            debug: {
              subtitles: {
                text: '[00:01] stale subtitle'
              }
            }
          }
        }
      }
    },
    summaryMarkdown: ''
  };

  assert.strictEqual(controller.hasVideoSubtitleArtifact(), false);

  state = {
    article: {
      sourceType: 'video',
      title: 'YouTube translated track',
      sourceUrl: 'https://www.youtube.com/watch?v=demo',
      diagnostics: {
        videoSource: 'youtube',
        youtube: {
          debug: {
            captions: {
              attempted: true,
              languageCode: 'zh-Hans',
              languageName: 'Chinese',
              isAutomatic: true,
              isTranslated: true,
              sourceLanguageCode: 'en',
              sourceLanguageName: 'English',
              translationLanguageCode: 'zh-Hans',
              translationLanguageName: 'Chinese',
              text: '[00:02] summary-used caption',
              jsonText: '{"lines":[{"startSeconds":2,"text":"summary-used caption"}]}'
            }
          }
        }
      }
    },
    summaryMarkdown: ''
  };
  subtitleTrackSelect.value = 'stale-option';
  const originalDocumentForSingle = global.document;
  const originalFetchForSingle = global.fetch;
  const originalCreateObjectURLForSingle = global.URL.createObjectURL;
  const originalRevokeObjectURLForSingle = global.URL.revokeObjectURL;
  const singleDownloads = [];
  let singleBlob = null;
  global.document = {
    body: {
      appendChild() {}
    },
    createElement() {
      return {
        href: '',
        download: '',
        click() {
          singleDownloads.push(this.download);
        },
        remove() {}
      };
    }
  };
  global.URL.createObjectURL = (blob) => {
    singleBlob = blob;
    return 'blob:single';
  };
  global.URL.revokeObjectURL = () => {};
  global.fetch = async () => {
    throw new Error('subtitle export should not fetch YouTube again');
  };

  try {
    assert.deepStrictEqual(
      controller.getVideoSubtitleOptions().map((option) => option.key),
      ['youtube-current']
    );
    await controller.exportVideoSubtitle();
    assert.strictEqual(singleDownloads.length, 1);
    assert.ok(singleDownloads[0].endsWith('-subtitle-zh-Hans.txt'));
    const singleText = await singleBlob.text();
    assert.strictEqual(singleText, '[00:02] summary-used caption');
  } finally {
    global.document = originalDocumentForSingle;
    global.fetch = originalFetchForSingle;
    global.URL.createObjectURL = originalCreateObjectURLForSingle;
    global.URL.revokeObjectURL = originalRevokeObjectURLForSingle;
  }
});

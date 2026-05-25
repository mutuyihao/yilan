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
                jsonText: '{"languageCode":"en","lines":[]}',
                candidates: [
                  {
                    languageCode: 'zh-CN',
                    languageName: 'Chinese',
                    isAutomatic: false,
                    captionUrl: 'https://www.youtube.com/api/timedtext?v=demo&lang=zh-CN'
                  },
                  {
                    languageCode: 'en',
                    languageName: 'English',
                    isAutomatic: true,
                    kind: 'asr',
                    captionUrl: 'https://www.youtube.com/api/timedtext?v=demo&lang=en'
                  }
                ]
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
    ['youtube-current', 'youtube-track-0', 'youtube-track-1', 'youtube-all']
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
      title: 'YouTube clip',
      sourceUrl: 'https://www.youtube.com/watch?v=demo',
      diagnostics: {
        videoSource: 'youtube',
        youtube: {
          debug: {
            captions: {
              attempted: true
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
                candidates: [
                  {
                    languageCode: 'zh-CN',
                    languageName: 'Chinese',
                    isAutomatic: false,
                    captionUrl: 'https://www.youtube.com/api/timedtext?v=demo&lang=zh-CN'
                  },
                  {
                    languageCode: 'en',
                    languageName: 'English',
                    isAutomatic: true,
                    kind: 'asr',
                    captionUrl: 'https://www.youtube.com/api/timedtext?v=demo&lang=en'
                  }
                ]
              }
            }
          }
        }
      }
    },
    summaryMarkdown: ''
  };
  subtitleTrackSelect.value = 'youtube-all';

  const originalDocument = global.document;
  const originalFetch = global.fetch;
  const originalCreateObjectURL = global.URL.createObjectURL;
  const originalRevokeObjectURL = global.URL.revokeObjectURL;
  const downloads = [];
  let exportedBlob = null;
  global.document = {
    createElement() {
      return {
        href: '',
        download: '',
        click() {
          downloads.push(this.download);
        }
      };
    }
  };
  global.URL.createObjectURL = (blob) => {
    exportedBlob = blob;
    return 'blob:test';
  };
  global.URL.revokeObjectURL = () => {};
  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      url: String(url),
      events: [{ tStartMs: 1000, segs: [{ utf8: 'caption' }] }]
    })
  });

  try {
    await controller.exportVideoSubtitle();
    assert.strictEqual(downloads.length, 1);
    assert.ok(downloads[0].endsWith('-all-subtitles.json'));
    const exported = JSON.parse(await exportedBlob.text());
    assert.strictEqual(exported.provider, 'youtube');
    assert.strictEqual(exported.tracks.length, 2);
    assert.strictEqual(exported.tracks[0].languageCode, 'zh-CN');
    assert.strictEqual(exported.tracks[1].languageCode, 'en');
    assert.ok(exported.tracks.every((track) => track.ok));
    assert.ok(exported.tracks[0].text.includes('[00:01] caption'));
  } finally {
    global.document = originalDocument;
    global.fetch = originalFetch;
    global.URL.createObjectURL = originalCreateObjectURL;
    global.URL.revokeObjectURL = originalRevokeObjectURL;
  }

  state = {
    article: {
      sourceType: 'video',
      title: 'YouTube single track',
      sourceUrl: 'https://www.youtube.com/watch?v=demo',
      diagnostics: {
        videoSource: 'youtube',
        youtube: { debug: { captions: { attempted: true } } }
      }
    },
    lastDiagnostics: {
      article: {
        diagnostics: {
          youtube: {
            debug: {
              captions: {
                candidates: [
                  {
                    languageCode: 'en',
                    languageName: 'English',
                    isAutomatic: true,
                    kind: 'asr',
                    captionUrl: 'https://www.youtube.com/api/timedtext?v=demo&lang=en'
                  }
                ]
              }
            }
          }
        }
      }
    },
    summaryMarkdown: ''
  };
  subtitleTrackSelect.value = 'youtube-track-0';
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
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      events: [{ tStartMs: 2000, segs: [{ utf8: 'single track caption' }] }]
    })
  });

  try {
    await controller.exportVideoSubtitle();
    assert.strictEqual(singleDownloads.length, 1);
    assert.ok(singleDownloads[0].endsWith('-subtitle-en.txt'));
    const singleText = await singleBlob.text();
    assert.ok(singleText.includes('Language: English / en'));
    assert.ok(singleText.includes('[00:02] single track caption'));
  } finally {
    global.document = originalDocumentForSingle;
    global.fetch = originalFetchForSingle;
    global.URL.createObjectURL = originalCreateObjectURLForSingle;
    global.URL.revokeObjectURL = originalRevokeObjectURLForSingle;
  }
});

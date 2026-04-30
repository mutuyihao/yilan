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
});

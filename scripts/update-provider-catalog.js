const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outputPath = path.join(projectRoot, 'shared', 'provider-catalog.generated.js');
const currentCatalog = require('../shared/provider-catalog.generated.js');

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = String(parsed.pathname || '').replace(/\/+$/, '') || '/';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

function extractBaseUrls(text) {
  const input = String(text || '');
  const matches = input.match(/https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s"'<>`)\\]*)?/gi) || [];
  const seen = new Set();
  const urls = [];

  matches.forEach((match) => {
    const normalized = normalizeUrl(match.replace(/[.,，。)）\]]+$/g, ''));
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    urls.push(normalized);
  });

  return urls;
}

function scoreUrlForRoute(url, route) {
  if (!route?.baseUrl) return 0;

  try {
    const expected = new URL(route.baseUrl);
    const candidate = new URL(url);
    if (expected.host !== candidate.host) return 0;

    const expectedPath = expected.pathname.replace(/\/+$/, '') || '/';
    const candidatePath = candidate.pathname.replace(/\/+$/, '') || '/';
    if (candidatePath === expectedPath) return 100;
    if (candidatePath.startsWith(expectedPath + '/')) return 80;
    if (expectedPath.startsWith(candidatePath + '/')) return 60;
    return 20;
  } catch {
    return 0;
  }
}

function pickUrlForRoute(urls, route) {
  let best = '';
  let bestScore = 0;

  urls.forEach((url) => {
    const score = scoreUrlForRoute(url, route);
    if (score > bestScore) {
      best = url;
      bestScore = score;
    }
  });

  if (best && route?.baseUrl) {
    const routeUrl = normalizeUrl(route.baseUrl);
    const bestUrl = normalizeUrl(best);
    if (routeUrl && bestUrl.startsWith(routeUrl + '/')) {
      return route.baseUrl;
    }
  }

  return best || route.baseUrl || '';
}

function buildCatalogFromDocuments(baseCatalog, documents, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const verifiedAt = options.verifiedAt || todayIsoDate();
  const providers = (baseCatalog?.listProviders ? baseCatalog.listProviders() : []).map((provider) => {
    const documentText = documents?.[provider.id] || documents?.[provider.sourceUrl] || '';
    const urls = extractBaseUrls(documentText);
    const routes = (provider.routes || []).map((route) => {
      if (!urls.length || !route.baseUrl) return route;
      return Object.assign({}, route, {
        baseUrl: pickUrlForRoute(urls, route)
      });
    });

    return Object.assign({}, provider, {
      verifiedAt: documentText ? verifiedAt : provider.verifiedAt,
      routes
    });
  });

  return {
    generatedAt,
    endpointModeMeta: baseCatalog.ENDPOINT_MODE_META,
    providers
  };
}

function renderGeneratedCatalog(catalog) {
  const endpointMeta = JSON.stringify(catalog.endpointModeMeta || {}, null, 2);
  const providers = JSON.stringify(catalog.providers || [], null, 2);

  return `(function (global) {
  const ENDPOINT_MODE_META = ${endpointMeta};
  const GENERATED_AT = ${JSON.stringify(catalog.generatedAt)};
  const PROVIDERS = ${providers};

  function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function listProviders() {
    return cloneValue(PROVIDERS);
  }

  function getProvider(id) {
    const key = String(id || '').trim();
    const provider = PROVIDERS.find((item) => item.id === key) || PROVIDERS[0];
    return cloneValue(provider);
  }

  const api = {
    generatedAt: GENERATED_AT,
    ENDPOINT_MODE_META: cloneValue(ENDPOINT_MODE_META),
    listProviders,
    getProvider
  };

  global.AISummaryProviderCatalog = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
`;
}

async function loadDocumentsFromNetwork(providers) {
  const documents = {};
  for (const provider of providers) {
    if (!provider.sourceUrl) continue;
    const response = await fetch(provider.sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${provider.id}: HTTP ${response.status}`);
    }
    documents[provider.id] = await response.text();
  }
  return documents;
}

function loadFixture(fixturePath) {
  const absolutePath = path.resolve(projectRoot, fixturePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

async function main(argv = process.argv.slice(2)) {
  const fixtureIndex = argv.indexOf('--fixture');
  const dryRun = argv.includes('--dry-run');
  const fixturePath = fixtureIndex >= 0 ? argv[fixtureIndex + 1] : '';
  const documents = fixturePath
    ? loadFixture(fixturePath)
    : await loadDocumentsFromNetwork(currentCatalog.listProviders());
  const catalog = buildCatalogFromDocuments(currentCatalog, documents);
  const output = renderGeneratedCatalog(catalog);

  if (dryRun) {
    process.stdout.write(output);
    return;
  }

  fs.writeFileSync(outputPath, output, 'utf8');
  process.stdout.write(`Updated ${path.relative(projectRoot, outputPath)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  extractBaseUrls,
  buildCatalogFromDocuments,
  renderGeneratedCatalog,
  main
};

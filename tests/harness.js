const assert = require('assert');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const tests = [];
const coveredFeatures = new Set();

function normalizeFeatureIds(featureIds) {
  if (!featureIds) return [];
  return Array.isArray(featureIds) ? featureIds : [featureIds];
}

function test(name, featureIds, fn) {
  if (typeof featureIds === 'function') {
    fn = featureIds;
    featureIds = [];
  }

  tests.push({
    name,
    featureIds: normalizeFeatureIds(featureIds),
    fn
  });
}

function cover(featureIds) {
  normalizeFeatureIds(featureIds).forEach((id) => coveredFeatures.add(id));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function listFirstPartyJsFiles() {
  const roots = [
    '.',
    'background',
    'shared',
    'adapters',
    'tests',
    'e2e'
  ];
  const files = [];

  roots.forEach((root) => {
    const absoluteRoot = path.join(projectRoot, root);
    fs.readdirSync(absoluteRoot, { withFileTypes: true }).forEach((entry) => {
      if (!entry.isFile()) return;
      if (!entry.name.endsWith('.js')) return;
      files.push(path.relative(projectRoot, path.join(absoluteRoot, entry.name)).replace(/\\/g, '/'));
    });
  });

  return files
    .filter((file) => !file.startsWith('libs/'))
    .sort();
}

function freshRequire(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  delete require.cache[require.resolve(absolutePath)];
  return require(absolutePath);
}

async function run(featureMatrix) {
  let passed = 0;

  for (const entry of tests) {
    try {
      await entry.fn({ assert, cover });
      entry.featureIds.forEach((id) => coveredFeatures.add(id));
      passed += 1;
      console.log('ok - ' + entry.name);
    } catch (error) {
      console.error('not ok - ' + entry.name);
      console.error(error);
      process.exitCode = 1;
      return;
    }
  }

  const declaredFeatures = featureMatrix || [];
  const missing = declaredFeatures
    .map((feature) => feature.id)
    .filter((id) => !coveredFeatures.has(id));

  const coverage = declaredFeatures.length
    ? (coveredFeatures.size / declaredFeatures.length) * 100
    : 100;

  if (missing.length) {
    console.error('Feature coverage failed: ' + coverage.toFixed(2) + '%');
    missing.forEach((id) => console.error('missing feature: ' + id));
    process.exitCode = 1;
    return;
  }

  console.log('All tests passed.');
  console.log('Test cases: ' + passed);
  console.log('Feature coverage: 100% (' + coveredFeatures.size + '/' + declaredFeatures.length + ')');
}

module.exports = {
  assert,
  test,
  cover,
  run,
  readText,
  readJson,
  projectRoot,
  listFirstPartyJsFiles,
  freshRequire
};

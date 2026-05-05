const fs = require('fs/promises');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const releaseRoot = path.join(root, 'release');

const runtimeFiles = [
  'manifest.json',
  'background.js',
  'content.js',
  'db.js',
  'popup.html',
  'popup.js',
  'sidebar.html',
  'sidebar.js',
  'reader.html',
  'reader.js',
  'style.css',
  'reset.css',
  'design-tokens.css',
  'typography.css',
  'components.css',
  'popup-premium.css',
  'sidebar-premium.css',
  'reader-premium.css'
];

const runtimeDirs = [
  'adapters',
  'background',
  'icon',
  'libs',
  'shared',
  'sidebar'
];

const forbiddenPathFragments = [
  '.git',
  '.publish-private',
  '.playwright-user-data',
  'dist',
  'node_modules',
  'playwright-report',
  'release',
  'test-results',
  'tests',
  'e2e',
  'docs',
  'landing-page'
];

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectory(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db') continue;

    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function collectFiles(dir, base = dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(base, absolute).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolute, base));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }

  return files.sort();
}

function assertCleanPackage(files) {
  const offenders = files.filter((file) => {
    const parts = file.split('/');
    return parts.some((part) => forbiddenPathFragments.includes(part));
  });

  if (offenders.length) {
    throw new Error('Release package contains forbidden files: ' + offenders.join(', '));
  }
}

function quotePowerShell(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

async function createZip(stagingDir, zipPath) {
  await fs.rm(zipPath, { force: true });

  if (process.platform === 'win32') {
    const command = [
      '$ErrorActionPreference = "Stop"',
      '$staging = ' + quotePowerShell(stagingDir),
      '$zip = ' + quotePowerShell(zipPath),
      'if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }',
      'Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zip -CompressionLevel Optimal'
    ].join('; ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('Compress-Archive failed.');
    return;
  }

  const result = spawnSync('zip', ['-qr', zipPath, '.'], { cwd: stagingDir, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('zip command failed.');
}

async function main() {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  const version = manifest.version;
  const packageName = `yilan-${version}`;
  const stagingDir = path.join(releaseRoot, packageName);
  const zipPath = path.join(releaseRoot, `${packageName}-extension.zip`);
  const manifestPath = path.join(releaseRoot, `${packageName}-package-manifest.json`);

  await fs.rm(stagingDir, { recursive: true, force: true });
  await fs.mkdir(stagingDir, { recursive: true });

  for (const file of runtimeFiles) {
    const source = path.join(root, file);
    if (!await pathExists(source)) {
      throw new Error('Missing runtime file: ' + file);
    }
    const target = path.join(stagingDir, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
  }

  for (const dir of runtimeDirs) {
    const source = path.join(root, dir);
    if (!await pathExists(source)) {
      throw new Error('Missing runtime directory: ' + dir);
    }
    await copyDirectory(source, path.join(stagingDir, dir));
  }

  const files = await collectFiles(stagingDir);
  assertCleanPackage(files);
  await fs.mkdir(releaseRoot, { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify({
    name: manifest.name,
    version,
    zip: path.basename(zipPath),
    fileCount: files.length,
    files
  }, null, 2) + '\n');
  await createZip(stagingDir, zipPath);

  console.log(`Release package staged at ${path.relative(root, stagingDir)}`);
  console.log(`Release zip written to ${path.relative(root, zipPath)}`);
  console.log(`Package manifest written to ${path.relative(root, manifestPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

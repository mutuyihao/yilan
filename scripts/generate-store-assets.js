const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('@playwright/test');

const root = path.resolve(__dirname, '..');
const screenDir = path.join(root, 'landing-page', 'assets', 'screens');
const outputDir = path.join(root, 'store-assets', 'chrome-web-store');
const iconPath = path.join(root, 'icon', 'action128.png');

const BRAND = {
  primary: '#10937f',
  primaryDeep: '#0a6d60',
  ink: '#163046',
  softInk: '#52657a',
  border: 'rgba(24, 58, 78, 0.12)',
  card: '#ffffff',
  chip: '#eef8f5',
  chipText: '#117f6f',
  bgA: '#f3efe7',
  bgB: '#e6f1ec',
  bgC: '#dcefee'
};

const SCREEN_ASSETS = [
  {
    output: 'screenshot-01-summary-workspace.jpg',
    width: 1280,
    height: 800,
    titleSize: 54,
    title: '把当前网页整理成可回看的资料',
    subtitle: '提取正文、保留来源、生成结构化总结，并在侧栏里继续加工。',
    chips: ['网页摘要', '继续生成', '本地历史'],
    image: 'hero-main-light.png',
    imageMode: 'wide',
    imagePosition: '59% 50%'
  },
  {
    output: 'screenshot-02-follow-up-modes.jpg',
    width: 1280,
    height: 800,
    titleSize: 48,
    title: '继续生成行动项、术语表和问答卡片',
    subtitle: '在同一个侧栏里切换模式、追问重点，再复制、导出或分享。',
    chips: ['模式切换', '复制导出', '分享卡片'],
    image: 'workflow-summary-light.png',
    imageMode: 'wide',
    imagePosition: '59% 50%'
  },
  {
    output: 'screenshot-03-history-favorites.jpg',
    width: 1280,
    height: 800,
    titleSize: 52,
    title: '历史、收藏与站点聚合回看',
    subtitle: '按站点、标题、模式和模型快速检索，把总结沉淀成可复用资料。',
    chips: ['收藏', '搜索', 'Reader'],
    image: 'history-reader-light.png',
    imageMode: 'tall',
    imagePosition: '50% 0%'
  },
  {
    output: 'screenshot-04-provider-setup.jpg',
    width: 1280,
    height: 800,
    titleSize: 50,
    title: '用自己的模型接口，保持连接可控',
    subtitle: '支持厂商预设、端点模式、模型刷新和连接测试，适配自建或兼容网关。',
    chips: ['BYOK', '连接诊断', 'HTTPS'],
    image: 'settings-panel-light.png',
    imageMode: 'tall',
    imagePosition: '50% 0%'
  },
  {
    output: 'screenshot-05-theme-modes.jpg',
    width: 1280,
    height: 800,
    titleSize: 48,
    title: '浅色、深色与多套配色主题',
    subtitle: '支持系统跟随与四套色板，让长时间阅读、整理和回看都保持舒适层次。',
    chips: ['浅色 / 深色', '系统跟随', '四色板'],
    image: 'hero-main-dark.png',
    imageMode: 'wide',
    imagePosition: '59% 50%'
  }
];

const PROMO_ASSETS = [
  {
    output: 'promo-small.jpg',
    width: 440,
    height: 280,
    kind: 'small'
  },
  {
    output: 'promo-marquee.jpg',
    width: 1400,
    height: 560,
    kind: 'marquee'
  }
];

function mimeFromName(name) {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  throw new Error('Unsupported image type: ' + name);
}

async function readDataUri(filePath) {
  const bytes = await fs.readFile(filePath);
  return `data:${mimeFromName(filePath)};base64,${bytes.toString('base64')}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildScreenHtml(asset, imageUri, iconUri) {
  const chips = asset.chips
    .map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`)
    .join('');

  const imageCardClass = asset.imageMode === 'tall' ? 'image-card image-card-tall' : 'image-card image-card-wide';
  const imageClass = asset.imageMode === 'tall' ? 'shot shot-tall' : 'shot shot-wide';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    html, body {
      width: ${asset.width}px;
      height: ${asset.height}px;
      margin: 0;
      overflow: hidden;
      background: linear-gradient(135deg, ${BRAND.bgA} 0%, ${BRAND.bgB} 52%, ${BRAND.bgC} 100%);
      color: ${BRAND.ink};
      font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
    }
    body::before,
    body::after {
      content: "";
      position: absolute;
      border-radius: 999px;
      filter: blur(2px);
      opacity: 0.95;
    }
    body::before {
      width: 420px;
      height: 420px;
      left: -120px;
      top: -120px;
      background: radial-gradient(circle, rgba(44, 189, 166, 0.25) 0%, rgba(44, 189, 166, 0) 70%);
    }
    body::after {
      width: 360px;
      height: 360px;
      right: -80px;
      bottom: -80px;
      background: radial-gradient(circle, rgba(64, 188, 176, 0.18) 0%, rgba(64, 188, 176, 0) 72%);
    }
    .layout {
      position: relative;
      display: grid;
      grid-template-columns: 1.03fr 0.97fr;
      gap: 36px;
      width: 100%;
      height: 100%;
      padding: 56px 58px 52px;
    }
    .copy {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding-right: 8px;
    }
    .brand-row {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 28px;
    }
    .brand-mark {
      width: 58px;
      height: 58px;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.76);
      box-shadow: 0 20px 40px rgba(16, 61, 72, 0.10);
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
    }
    .brand-mark img {
      width: 46px;
      height: 46px;
      display: block;
    }
    .brand-text {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .brand-text strong {
      font-size: 30px;
      line-height: 1.05;
      letter-spacing: 0.02em;
    }
    .brand-text span {
      font-size: 15px;
      color: ${BRAND.softInk};
      letter-spacing: 0.04em;
    }
    h1 {
      margin: 0 0 16px;
      font-size: ${asset.titleSize || 54}px;
      line-height: 1.14;
      letter-spacing: -0.03em;
      max-width: 560px;
    }
    .subtitle {
      max-width: 500px;
      margin: 0 0 22px;
      color: ${BRAND.softInk};
      font-size: 21px;
      line-height: 1.65;
    }
    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 42px;
      padding: 0 18px;
      border-radius: 999px;
      background: ${BRAND.chip};
      color: ${BRAND.chipText};
      border: 1px solid rgba(16, 147, 127, 0.12);
      font-size: 18px;
      font-weight: 700;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7);
    }
    .visual {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .visual::before {
      content: "";
      position: absolute;
      inset: 28px 0 28px 10px;
      border-radius: 34px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0.12) 100%);
      border: 1px solid rgba(255, 255, 255, 0.28);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.48);
      backdrop-filter: blur(10px);
    }
    .image-card {
      position: relative;
      z-index: 1;
      overflow: hidden;
      border-radius: 28px;
      border: 1px solid rgba(14, 59, 70, 0.10);
      background: rgba(255, 255, 255, 0.70);
      box-shadow:
        0 36px 70px rgba(20, 54, 66, 0.18),
        0 8px 20px rgba(17, 77, 73, 0.08);
    }
    .image-card-wide {
      width: 620px;
      height: 688px;
    }
    .image-card-tall {
      width: 480px;
      height: 688px;
    }
    .shot {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
      object-position: ${asset.imagePosition};
    }
  </style>
</head>
<body>
  <div class="layout">
    <section class="copy">
      <div class="brand-row">
        <div class="brand-mark"><img alt="" src="${iconUri}"></div>
        <div class="brand-text">
          <strong>一览</strong>
          <span>Yilan · AI Reading Workspace</span>
        </div>
      </div>
      <h1>${escapeHtml(asset.title)}</h1>
      <p class="subtitle">${escapeHtml(asset.subtitle)}</p>
      <div class="chip-row">${chips}</div>
    </section>
    <section class="visual">
      <div class="${imageCardClass}">
        <img class="${imageClass}" alt="" src="${imageUri}">
      </div>
    </section>
  </div>
</body>
</html>`;
}

function buildPromoHtml(asset, heroUri, workflowUri, iconUri) {
  const isSmall = asset.kind === 'small';
  const width = asset.width;
  const height = asset.height;
  const markSize = isSmall ? 58 : 96;
  const labelSize = isSmall ? 24 : 52;
  const subSize = isSmall ? 0 : 22;
  const padX = isSmall ? 26 : 48;
  const padY = isSmall ? 22 : 34;
  const cardWidth = isSmall ? 190 : 470;
  const cardHeight = isSmall ? 216 : 504;
  const cardLeft = isSmall ? 226 : 820;
  const cardTop = isSmall ? 28 : 34;
  const card2Width = isSmall ? 126 : 284;
  const card2Height = isSmall ? 154 : 336;
  const card2Left = isSmall ? 186 : 680;
  const card2Top = isSmall ? 88 : 140;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; }
    html, body {
      width: ${width}px;
      height: ${height}px;
      margin: 0;
      overflow: hidden;
      background:
        radial-gradient(circle at 12% 18%, rgba(30, 201, 175, 0.24), transparent 26%),
        radial-gradient(circle at 84% 76%, rgba(38, 150, 143, 0.18), transparent 28%),
        linear-gradient(135deg, #f3efe7 0%, #e4f0ec 46%, #d6ecea 100%);
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
      color: ${BRAND.ink};
    }
    .orb {
      position: absolute;
      border-radius: 999px;
      filter: blur(10px);
      opacity: 0.75;
    }
    .orb-a {
      width: ${isSmall ? 170 : 360}px;
      height: ${isSmall ? 170 : 360}px;
      left: ${isSmall ? -38 : -120}px;
      top: ${isSmall ? -42 : -120}px;
      background: radial-gradient(circle, rgba(44, 189, 166, 0.30), rgba(44, 189, 166, 0) 70%);
    }
    .orb-b {
      width: ${isSmall ? 150 : 320}px;
      height: ${isSmall ? 150 : 320}px;
      right: ${isSmall ? -30 : -90}px;
      bottom: ${isSmall ? -26 : -90}px;
      background: radial-gradient(circle, rgba(57, 152, 166, 0.22), rgba(57, 152, 166, 0) 72%);
    }
    .header {
      position: absolute;
      left: ${padX}px;
      top: ${padY}px;
      display: flex;
      align-items: center;
      gap: ${isSmall ? 14 : 18}px;
    }
    .mark {
      width: ${markSize}px;
      height: ${markSize}px;
      border-radius: ${isSmall ? 18 : 28}px;
      background: rgba(255, 255, 255, 0.74);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 ${isSmall ? 12 : 20}px ${isSmall ? 22 : 40}px rgba(16, 58, 76, 0.12);
    }
    .mark img {
      width: ${isSmall ? 42 : 72}px;
      height: ${isSmall ? 42 : 72}px;
      display: block;
    }
    .brand {
      display: flex;
      flex-direction: column;
      gap: ${isSmall ? 2 : 6}px;
    }
    .brand strong {
      font-size: ${labelSize}px;
      line-height: 1;
      letter-spacing: ${isSmall ? '0.01em' : '-0.03em'};
    }
    .brand span {
      font-size: ${subSize}px;
      color: ${BRAND.softInk};
      letter-spacing: 0.06em;
    }
    .card {
      position: absolute;
      overflow: hidden;
      border-radius: ${isSmall ? 22 : 30}px;
      background: rgba(255, 255, 255, 0.78);
      border: 1px solid rgba(15, 58, 75, 0.10);
      box-shadow:
        0 ${isSmall ? 22 : 34}px ${isSmall ? 40 : 74}px rgba(20, 54, 66, 0.18),
        0 8px 20px rgba(17, 77, 73, 0.08);
    }
    .card-main {
      left: ${cardLeft}px;
      top: ${cardTop}px;
      width: ${cardWidth}px;
      height: ${cardHeight}px;
      transform: rotate(${isSmall ? '-2.6deg' : '-2deg'});
      z-index: 2;
    }
    .card-sub {
      left: ${card2Left}px;
      top: ${card2Top}px;
      width: ${card2Width}px;
      height: ${card2Height}px;
      transform: rotate(${isSmall ? '5deg' : '4deg'});
      opacity: 0.98;
      z-index: 1;
    }
    .card img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: cover;
    }
    .card-main img {
      object-position: 59% 48%;
    }
    .card-sub img {
      object-position: 59% 50%;
    }
  </style>
</head>
<body>
  <div class="orb orb-a"></div>
  <div class="orb orb-b"></div>
  <div class="header">
    <div class="mark"><img alt="" src="${iconUri}"></div>
    <div class="brand">
      <strong>Yilan</strong>
      ${isSmall ? '' : '<span>AI Reading Workspace</span>'}
    </div>
  </div>
  <div class="card card-sub">
    <img alt="" src="${workflowUri}">
  </div>
  <div class="card card-main">
    <img alt="" src="${heroUri}">
  </div>
</body>
</html>`;
}

async function renderJpeg(page, html, outputPath, width, height) {
  await page.setViewportSize({ width, height });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.screenshot({
    path: outputPath,
    type: 'jpeg',
    quality: 92,
    animations: 'disabled'
  });
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const iconUri = await readDataUri(iconPath);
  const sources = {};
  for (const fileName of [
    'hero-main-light.png',
    'hero-main-dark.png',
    'workflow-summary-light.png',
    'history-reader-light.png',
    'settings-panel-light.png'
  ]) {
    sources[fileName] = await readDataUri(path.join(screenDir, fileName));
  }

  const browser = await chromium.launch({
    channel: 'chromium',
    headless: true
  });

  try {
    const page = await browser.newPage();

    for (const asset of SCREEN_ASSETS) {
      const html = buildScreenHtml(asset, sources[asset.image], iconUri);
      await renderJpeg(page, html, path.join(outputDir, asset.output), asset.width, asset.height);
    }

    for (const asset of PROMO_ASSETS) {
      const html = buildPromoHtml(asset, sources['hero-main-light.png'], sources['workflow-summary-light.png'], iconUri);
      await renderJpeg(page, html, path.join(outputDir, asset.output), asset.width, asset.height);
    }

    await page.close();
  } finally {
    await browser.close();
  }

  console.log('Chrome Web Store assets written to ' + path.relative(root, outputDir));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

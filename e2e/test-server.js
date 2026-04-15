const http = require('http');

function createBasicArticleHtml(origin) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Playwright Basic Article</title>
  <meta name="author" content="Fixture Author">
  <meta name="description" content="A fixture article used by Playwright extension tests.">
  <meta property="og:site_name" content="Fixture Site">
  <meta property="article:published_time" content="2026-04-15T09:30:00+08:00">
  <link rel="canonical" href="${origin}/article-basic">
</head>
<body>
  <article>
    <h1>Playwright Basic Article</h1>
    <p>${'这是一个用于浏览器插件端到端测试的基础页面。'.repeat(40)}</p>
    <p>${'它包含足够长的正文，用来触发 Readability 与正文抽取逻辑。'.repeat(30)}</p>
  </article>
</body>
</html>`;
}

function createLongArticleHtml(origin) {
  const paragraphs = Array.from({ length: 8 }).map((_, index) => {
    return `<p>第 ${index + 1} 段。${'长文测试段落内容，用于触发分段总结与最终汇总。'.repeat(80)}</p>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Playwright Long Article</title>
  <meta name="author" content="Long Fixture Author">
  <meta name="description" content="A long fixture article for chunking tests.">
  <meta property="og:site_name" content="Fixture Site">
  <link rel="canonical" href="${origin}/article-long">
</head>
<body>
  <article>
    <h1>Playwright Long Article</h1>
    ${paragraphs}
  </article>
</body>
</html>`;
}

function createSlowArticleHtml(origin) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Playwright Slow Article</title>
  <meta name="author" content="Slow Fixture Author">
  <meta name="description" content="A slow fixture article for cancel tests.">
  <meta property="og:site_name" content="Fixture Site">
  <link rel="canonical" href="${origin}/article-slow">
</head>
<body>
  <article>
    <h1>Playwright Slow Article</h1>
    <p>${'这是一个用于取消生成链路测试的慢速页面。'.repeat(60)}</p>
    <p>${'服务端会故意延迟流式输出，方便在浏览器里点击取消。'.repeat(40)}</p>
  </article>
</body>
</html>`;
}

function parseBody(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractPrompt(body) {
  if (!body || typeof body !== 'object') return '';
  if (typeof body.input === 'string') return body.input;
  if (typeof body.prompt === 'string') return body.prompt;
  if (Array.isArray(body.messages)) {
    return body.messages
      .map((message) => {
        if (typeof message?.content === 'string') return message.content;
        if (Array.isArray(message?.content)) {
          return message.content.map((item) => item?.text || item?.content || '').join('');
        }
        return '';
      })
      .join('\n');
  }
  return '';
}

function buildMockText(prompt) {
  if (prompt.includes('Please reply with OK only.')) {
    return 'OK';
  }

  if (prompt.includes('Playwright Slow Article')) {
    return [
      '## 核心结论',
      '- 这是一个用于取消测试的慢速模拟摘要。',
      '',
      '## 关键信息',
      '- ' + '慢速 token 输出。'.repeat(24)
    ].join('\n');
  }

  if (prompt.includes('以下是网页原始摘要，请基于摘要内容进行二次加工。')) {
    if (prompt.includes('行动清单') || prompt.includes('可立即执行')) {
      return [
        '## 可立即执行',
        '1. 完成第一项模拟操作。',
        '',
        '## 后续跟进',
        '1. 跟进第二项模拟操作。'
      ].join('\n');
    }

    if (prompt.includes('术语表') || prompt.includes('术语卡')) {
      return [
        '## 核心术语',
        '- Mock Summary：用于端到端测试的模拟摘要。'
      ].join('\n');
    }

    if (prompt.includes('问答卡片')) {
      return [
        '## Q1. 这篇文章讲了什么？',
        'A: 这是一篇用于浏览器插件自动化测试的模拟文章。'
      ].join('\n');
    }
  }

  if (prompt.includes('你正在帮助总结一篇长网页，这是其中一个分段。')) {
    const match = prompt.match(/当前分段:\s*(\d+)\/(\d+)/);
    const chunkIndex = match ? Number(match[1]) : 1;
    return [
      `## 分段 ${chunkIndex}`,
      `- 这是第 ${chunkIndex} 段的模拟要点。`
    ].join('\n');
  }

  if (prompt.includes('以下是同一篇长网页分段总结后的结果')) {
    return [
      '## 最终汇总',
      '- 这是长文汇总后的模拟结果。'
    ].join('\n');
  }

  return [
    '## 核心结论',
    '- 这是模拟摘要。',
    '',
    '## 关键信息',
    '- 这是主链路的模拟结果。'
  ].join('\n');
}

function chunkText(text, size = 8) {
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + size));
    cursor += size;
  }
  return chunks.length ? chunks : [''];
}

function getResponseOptions(prompt) {
  if (prompt.includes('Playwright Slow Article')) {
    return { delayMs: 220 };
  }
  return { delayMs: 0 };
}

async function readRequestBody(request) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function writeSseResponse(response, text, options) {
  const delayMs = Number(options?.delayMs || 0);
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });

  for (const token of chunkText(text)) {
    if (response.writableEnded || response.destroyed) return;
    response.write(`event: response.output_text.delta\n`);
    response.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: token })}\n\n`);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  if (response.writableEnded || response.destroyed) return;
  response.write(`data: ${JSON.stringify({ usage: { input_tokens: 12, output_tokens: text.length } })}\n\n`);
  response.write('data: [DONE]\n\n');
  response.end();
}

async function startTestServer() {
  const requests = [];
  let origin = '';

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, origin || 'http://127.0.0.1');

    if (request.method === 'GET' && url.pathname === '/article-basic') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(createBasicArticleHtml(origin));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/article-long') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(createLongArticleHtml(origin));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/article-slow') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(createSlowArticleHtml(origin));
      return;
    }

    if (request.method === 'POST' && (
      url.pathname.endsWith('/responses') ||
      url.pathname.endsWith('/chat/completions') ||
      url.pathname.endsWith('/v1/messages')
    )) {
      const rawBody = await readRequestBody(request);
      const body = parseBody(rawBody);
      const prompt = extractPrompt(body);
      const text = buildMockText(prompt);
      const responseOptions = getResponseOptions(prompt);
      const entry = {
        method: request.method,
        pathname: url.pathname,
        headers: request.headers,
        body,
        prompt,
        stream: !!body?.stream,
        text,
        responseOptions
      };
      requests.push(entry);

      if (url.pathname.includes('/v1-error/')) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not Found');
        return;
      }

      if (body?.stream) {
        await writeSseResponse(response, text, responseOptions);
        return;
      }

      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        output_text: text,
        usage: {
          input_tokens: 12,
          output_tokens: text.length
        }
      }));
      return;
    }

    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found');
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    getRequests() {
      return requests.slice();
    },
    clearRequests() {
      requests.length = 0;
    },
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  };
}

module.exports = {
  startTestServer
};

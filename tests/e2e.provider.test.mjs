#!/usr/bin/env node
/**
 * 端到端测试：Bing provider 的双通道行为。
 *
 * 与 `parse.smoke.test.cjs` 的区别：这里**直接 import 真实的
 * `BingFreeSearchProvider`**（不复制解析逻辑），用桩 `fetch` 驱动两种传输，
 * 因此走的是与运行时完全相同的代码路径 —— RSS 优先、HTML 兜底、取消传播、
 * 错误类型，全部被测。
 *
 * 默认**离线**运行（确定性，可进 CI）。加 `--live` 则额外真实请求
 * cn.bing.com，验证线上行为（需要网络）。
 *
 * 运行前提：`lib/index.js` 会 import `@deepseek-ai/schemastery` 与
 * `@deepseek-ai/dsh-web`。若本目录没有 `node_modules`，先执行：
 *
 *     npm install          # 安装 devDependencies 里的官方包
 *
 * 用法：
 *     node tests/e2e.provider.test.mjs            # 离线（默认）
 *     node tests/e2e.provider.test.mjs --live     # 离线 + 真实网络
 */

// `lib/index.js` 会 import 官方包，所以用动态 import 以便给出人类可读的安装
// 提示，而不是抛一句 "Cannot find package ..."。
let BingFreeSearchProvider;
let DEFAULT_ENDPOINT;
let PROVIDER_ID;

try {
  ({ BingFreeSearchProvider, DEFAULT_ENDPOINT, PROVIDER_ID } = await import('../lib/index.js'));
} catch (error) {
  console.error('');
  console.error('✗ 无法加载 ../lib/index.js');
  console.error('  ' + String(error.message).split('\n')[0]);
  console.error('');
  console.error('原因：插件运行时 import 了官方包（@deepseek-ai/schemastery、');
  console.error('      @deepseek-ai/dsh-web），而本目录还没有 node_modules。');
  console.error('');
  console.error('解决：在本目录执行');
  console.error('      npm install');
  console.error('');
  process.exit(1);
}

const LIVE = process.argv.includes('--live');
// ---------------------------------------------------------------- 迷你断言器

let passed = 0;
const failures = [];

function check(name, condition, extra) {
  if (condition) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failures.push(name + (extra === undefined ? '' : `  (${extra})`));
    console.log(`  FAIL ${name}${extra === undefined ? '' : `  → ${extra}`}`);
  }
}

function eq(name, actual, expected) {
  check(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

function group(title) {
  console.log(`\n== ${title} ==`);
}

// ---------------------------------------------------------------- 桩 fetch

const realFetch = globalThis.fetch;

/** 本次测试中 fetch 收到的 URL 列表。 */
let calls = [];

/**
 * 用给定处理函数替换全局 fetch，并记录每次请求的 URL。
 * 处理函数签名 `(url, init) => response`，response 需含 `ok` / `status` / `text()`。
 */
function stubFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return handler(String(url), init);
  };
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

/** 构造一个成功的文本响应。 */
function textResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  };
}

/** 构造一个 HTTP 错误响应。 */
function errorResponse(status) {
  return {
    ok: false,
    status,
    text: async () => ''
  };
}

// ---------------------------------------------------------------- 测试样本

/** 典型 RSS feed：一条英文 pubDate（可原生解析）、一条中文 pubDate（需手工组装）。 */
const SAMPLE_RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <title>测试 - Bing</title>
  <item>
    <title>标题一</title>
    <link>https://example.com/a</link>
    <description>摘要一，完整段落。</description>
    <pubDate>Wed, 30 Sep 2026 13:24:00 GMT</pubDate>
  </item>
  <item>
    <title>标题二 &amp; 实体</title>
    <link>https://example.com/b</link>
    <description>摘要二 &ensp; 带实体 &middot; 分隔</description>
    <pubDate>周三, 30 9月 2026 13:31:00 GMT</pubDate>
  </item>
</channel></rss>`;

/** 无 `<item>` 的响应 —— 模拟 Bing 忽略 format=rss 直接返回 HTML。 */
const NOT_A_FEED = `<!DOCTYPE html><html><head><title>Bing</title></head><body>
<ol id="b_results">
  <li class="b_algo">
    <h2><a href="https://example.com/h1">HTML 标题一</a></h2>
    <p class="b_lineclamp4">HTML 摘要一，正文内容 &amp; 实体…</p>
  </li>
  <li class="b_algo">
    <h2><a href="https://example.com/h2">HTML 标题二</a></h2>
    <p class="b_lineclamp4">HTML 摘要二。</p>
  </li>
</ol>
</body></html>`;

/** captcha / 风控页。 */
const BLOCKED_PAGE = `<!DOCTYPE html><html><body>
<div id="captcha">Verify you are human — unusual traffic detected</div>
</body></html>`;

/** 构造 provider，默认中文、20 条、RSS 优先。 */
function makeProvider(overrides = {}) {
  return new BingFreeSearchProvider(
    overrides.endpoint ?? DEFAULT_ENDPOINT,
    overrides.maxResults ?? 20,
    overrides.ensearch ?? 0,
    overrides.preferRss ?? true
  );
}

// ---------------------------------------------------------------- 用例

async function testRssPreferred() {
  group('RSS 优先（默认路径）');
  stubFetch(async () => textResponse(SAMPLE_RSS));
  const result = await makeProvider().search({ query: '测试查询' });

  eq('只发出一次请求（未回退到 HTML）', calls.length, 1);
  check('请求 URL 带 format=rss', calls[0].includes('format=rss'), calls[0]);
  check('请求 URL 带 q=', calls[0].includes('q='), calls[0]);
  eq('返回 2 条结果', result.sources.length, 2);
  eq('truncated 为 false', result.truncated, false);
  eq('标题正确', result.sources[0].title, '标题一');
  eq('摘要取 description', result.sources[0].snippet, '摘要一，完整段落。');
  eq('英文 pubDate 解析为 ISO', result.sources[0].publishedAt, '2026-09-30T13:24:00.000Z');
  check('中文 pubDate 也被解析（非 undefined）', typeof result.sources[1].publishedAt === 'string', String(result.sources[1].publishedAt));
  eq('XML 实体已解码', result.sources[1].title, '标题二 & 实体');
  eq('摘要中的命名实体已解码（连续空白折叠为单个空格）', result.sources[1].snippet, '摘要二 带实体 · 分隔');
  restoreFetch();
}

async function testForceHtml() {
  group('强制 HTML（preferRss=false）');
  stubFetch(async () => textResponse(NOT_A_FEED));
  const result = await makeProvider({ preferRss: false }).search({ query: '测试查询' });

  eq('只发出一次请求', calls.length, 1);
  check('请求 URL 不含 format=rss', !calls[0].includes('format=rss'), calls[0]);
  eq('HTML 解析出 2 条', result.sources.length, 2);
  eq('HTML 标题正确', result.sources[0].title, 'HTML 标题一');
  eq('HTML 摘要去掉了省略号', result.sources[0].snippet, 'HTML 摘要一，正文内容 & 实体');
  eq('HTML 通道没有 publishedAt', result.sources[0].publishedAt, undefined);
  restoreFetch();
}

async function testRssNonFeedFallback() {
  group('RSS 返回非 feed → 回退 HTML');
  stubFetch(async (url) => {
    // RSS 请求拿到 HTML（没有 <item>）；HTML 请求拿到正常结果页
    return textResponse(NOT_A_FEED);
  });
  const result = await makeProvider().search({ query: '测试查询' });

  eq('共发出两次请求（RSS + HTML）', calls.length, 2);
  check('第一次带 format=rss', calls[0].includes('format=rss'), calls[0]);
  check('第二次不带 format=rss', !calls[1].includes('format=rss'), calls[1]);
  eq('最终使用 HTML 结果', result.sources[0].title, 'HTML 标题一');
  eq('返回 2 条', result.sources.length, 2);
  restoreFetch();
}

async function testRssErrorFallback() {
  group('RSS 请求失败（HTTP 500）→ 回退 HTML');
  stubFetch(async (url) => {
    if (url.includes('format=rss')) return errorResponse(500);
    return textResponse(NOT_A_FEED);
  });
  const result = await makeProvider().search({ query: '测试查询' });

  eq('共发出两次请求', calls.length, 2);
  eq('回退后拿到 HTML 结果', result.sources.length, 2);
  eq('truncated 为 false', result.truncated, false);
  restoreFetch();
}

async function testBothTransportsFail() {
  group('两种通道都失败 → 抛结构化错误');
  stubFetch(async () => errorResponse(503));
  let error;
  try {
    await makeProvider().search({ query: '测试查询' });
  } catch (e) {
    error = e;
  }
  check('抛出了错误', error !== undefined);
  eq('错误码为 WEB_PROVIDER_ERROR', error && error.code, 'WEB_PROVIDER_ERROR');
  eq('共尝试两次（RSS + HTML）', calls.length, 2);
  restoreFetch();
}

async function testAbortNotSwallowed() {
  group('取消信号不被兜底吞掉');
  const controller = new AbortController();
  controller.abort();

  stubFetch(async (url, init) => {
    // 模拟真实 fetch 在已取消时的行为
    if (init && init.signal && init.signal.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    return textResponse(NOT_A_FEED);
  });

  let error;
  try {
    await makeProvider().search({ query: '测试查询' }, controller.signal);
  } catch (e) {
    error = e;
  }
  check('抛出了错误', error !== undefined);
  eq('错误码为 WEB_ABORTED', error && error.code, 'WEB_ABORTED');
  eq('取消后没有继续回退 HTML（只请求一次）', calls.length, 1);
  restoreFetch();
}

async function testEmptyQuery() {
  group('空 query');
  stubFetch(async () => textResponse(SAMPLE_RSS));

  let error;
  try {
    await makeProvider().search({ query: '   ' });
  } catch (e) {
    error = e;
  }
  check('抛出了错误', error !== undefined);
  eq('错误码为 WEB_PROVIDER_ERROR', error && error.code, 'WEB_PROVIDER_ERROR');
  eq('没有发起任何网络请求', calls.length, 0);
  restoreFetch();
}

async function testMaxResultsCap() {
  group('maxResults 截断');
  stubFetch(async () => textResponse(SAMPLE_RSS));
  const result = await makeProvider({ maxResults: 1 }).search({ query: '测试查询' });
  eq('截断到 1 条', result.sources.length, 1);
  restoreFetch();
}

async function testBlockedPage() {
  group('captcha / 风控页 → 结构化错误（不伪装成无结果）');
  stubFetch(async (url) => {
    if (url.includes('format=rss')) return textResponse(NOT_A_FEED.replace('b_algo', 'nothing')); // 空 feed
    return textResponse(BLOCKED_PAGE);
  });
  let error;
  try {
    await makeProvider().search({ query: '测试查询' });
  } catch (e) {
    error = e;
  }
  check('抛出了错误', error !== undefined);
  eq('错误码为 WEB_PROVIDER_ERROR', error && error.code, 'WEB_PROVIDER_ERROR');
  check('错误信息提到 captcha', /captcha/i.test(error && error.message), error && error.message);
  restoreFetch();
}

async function testProviderMetadata() {
  group('provider 元数据');
  eq('provider id 正确', PROVIDER_ID, 'bing-free');
  eq('available() 恒为 true', makeProvider().available(), true);
  eq("默认端点指向 cn.bing.com", DEFAULT_ENDPOINT, 'https://cn.bing.com/search');
}

// ---------------------------------------------------------------- 真实网络（--live）

async function testLive() {
  group('真实网络（--live）');
  const provider = makeProvider({ maxResults: 10 });

  let rssResult;
  try {
    rssResult = await provider.search({ query: 'DeepSeek Harness' });
  } catch (e) {
    check('真实请求成功', false, e.message);
    return;
  }
  check('真实请求返回了结果', rssResult.sources.length > 0, `${rssResult.sources.length} 条`);
  check('每条都有 url', rssResult.sources.every(s => /^https?:\/\//.test(s.url)));
  check('至少一条有标题', rssResult.sources.some(s => s.title && s.title.length > 0));
  const titles = rssResult.sources.map(s => s.title || '').join(' | ');
  check('标题中没有残留 HTML 实体', !/&(?:amp|ensp|nbsp|middot|lt|gt);/.test(titles), titles.slice(0, 120));

  // 强制 HTML 通道，验证两条通道都能工作
  const htmlProvider = makeProvider({ maxResults: 10, preferRss: false });
  try {
    const htmlResult = await htmlProvider.search({ query: 'DeepSeek Harness' });
    check('强制 HTML 通道也返回结果', htmlResult.sources.length > 0, `${htmlResult.sources.length} 条`);
    const htmlTitles = htmlResult.sources.map(s => s.title || '').join(' | ');
    check('HTML 标题中无残留实体', !/&(?:amp|ensp|nbsp|middot);/.test(htmlTitles), htmlTitles.slice(0, 120));
    const snippets = htmlResult.sources.map(s => s.snippet || '').join(' | ');
    check('HTML 摘要已剥离「阅读更多」', !/阅读更多|Read more/.test(snippets));
  } catch (e) {
    check('强制 HTML 通道也返回结果', false, e.message);
  }
}

// ---------------------------------------------------------------- 主流程

(async () => {
  console.log('端到端测试：Bing provider 双通道');
  console.log('（直接 import 真实 BingFreeSearchProvider，用桩 fetch 驱动）');

  await testProviderMetadata();
  await testRssPreferred();
  await testForceHtml();
  await testRssNonFeedFallback();
  await testRssErrorFallback();
  await testBothTransportsFail();
  await testAbortNotSwallowed();
  await testEmptyQuery();
  await testMaxResultsCap();
  await testBlockedPage();

  if (LIVE) {
    await testLive();
  } else {
    console.log('\n（跳过真实网络测试；加 --live 可启用）');
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.log('\n失败项：');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})();

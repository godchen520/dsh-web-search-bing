// Standalone test for the Bing HTML parsing logic.
// Mirrors the pure parsing helpers from lib/index.js against a realistic slice
// of cn.bing.com/search HTML output.

const NAMED_ENTITIES = {
  quot: '"', amp: "&", lt: "<", gt: ">", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  middot: "·", hellip: "…", mdash: "—", ndash: "–", lsquo: "\u2018", rsquo: "\u2019",
  ldquo: "\u201c", rdquo: "\u201d", bull: "•", times: "×", copy: "©", reg: "®", trade: "™",
  deg: "°", laquo: "«", raquo: "»", sect: "§", para: "¶", dagger: "†", permil: "‰",
  euro: "€", pound: "£", yen: "¥", cent: "¢", larr: "←", rarr: "→", harr: "↔"
};

function decodeHtml(value) {
  if (value == null) return "";
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name) => NAMED_ENTITIES[name] ?? match)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSnippet(text) {
  return text
    .replace(/\s*(?:阅读更多|Read\s?more)\s*$/iu, "")
    .replace(/(?:\s*(?:…|\.{3}))+\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBingResultBlock(blockHtml) {
  const titleMatch = /<h2[^>]*>\s*<a[^>]*href\s*=\s*["']([^'"]+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(blockHtml);
  if (titleMatch == null) return null;
  const href = decodeHtml(titleMatch[1].trim());
  const title = decodeHtml(titleMatch[2]);
  let url;
  try {
    if (href.startsWith("//")) url = `https:${href}`;
    else if (href.startsWith("/")) url = `https://cn.bing.com${href}`;
    else url = new URL(href).href;
  } catch { url = href; }
  if (!(url.startsWith("https://") || url.startsWith("http://"))) return null;
  let snippet = "";
  const snippetPatterns = [
    /<p[^>]*class\s*=\s*["'][^"']*\bb_lineclamp[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
    /<div[^>]*class\s*=\s*["'][^"']*\bcaption\b[^"']*["'][^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/i,
    /<p[^>]*class\s*=\s*["'][^"']*\bb_algoSlug\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
    /<div[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>\s*<\/div>/i
  ];
  for (const pat of snippetPatterns) {
    const m = pat.exec(blockHtml);
    if (m == null) continue;
    const candidate = cleanSnippet(decodeHtml(m[1]));
    if (candidate.length > snippet.length) snippet = candidate;
  }
  return { url, title, snippet };
}

function parseBingHtml(html, maxResults) {
  const sources = [];
  const seen = new Set();
  const blocks = html.split(/<li\s+class\s*=\s*["']?\s*b_algo\b/i);
  for (let i = 1; i < blocks.length && (maxResults == null || sources.length < maxResults); i++) {
    const block = blocks[i].split(/<\/li>/i)[0] ?? blocks[i];
    const parsed = parseBingResultBlock(block);
    if (parsed == null || seen.has(parsed.url)) continue;
    seen.add(parsed.url);
    sources.push({
      url: parsed.url,
      ...(parsed.title.length > 0 ? { title: parsed.title } : {}),
      ...(parsed.snippet.length > 0 ? { snippet: parsed.snippet } : {})
    });
  }
  return sources;
}

function looksBlocked(html) {
  const lower = html.slice(0, 20000).toLowerCase();
  return /(captcha|verify you are human|are you a robot|unusual traffic|access denied|challenge-platform)/.test(lower);
}

// ---- RSS transport helpers (mirror of lib/index.js) ----
const MONTH_PREFIXES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

function monthNumber(token) {
  const numeric = /^(\d{1,2})\s*月?$/.exec(token);
  if (numeric != null) {
    const n = Number(numeric[1]);
    return n >= 1 && n <= 12 ? n : undefined;
  }
  return MONTH_PREFIXES[token.slice(0, 3).toLowerCase()];
}

function pad2(value) { return String(value).padStart(2, "0"); }

function parseRssDate(raw) {
  if (raw == null) return undefined;
  const text = raw.trim();
  if (text.length === 0) return undefined;
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const m = /(\d{1,2})\s+(\S+?)\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(GMT|UTC|Z|([+-])(\d{2}):?(\d{2}))?/i.exec(text);
  if (m == null) return undefined;
  const month = monthNumber(m[2]);
  if (month === undefined) return undefined;
  const zone = m[8] === undefined ? "Z" : `${m[8]}${m[9]}:${m[10]}`;
  const parsed = new Date(`${Number(m[3])}-${pad2(month)}-${pad2(Number(m[1]))}T${pad2(Number(m[4]))}:${pad2(Number(m[5]))}:${pad2(m[6] === undefined ? 0 : Number(m[6]))}${zone}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function xmlField(block, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (m == null) return "";
  return decodeHtml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

function parseRssFeed(xml, maxResults) {
  const sources = [];
  const seen = new Set();
  const itemRe = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRe.exec(xml)) !== null && (maxResults == null || sources.length < maxResults)) {
    const block = match[1];
    const url = xmlField(block, "link");
    if (url.length === 0 || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const title = xmlField(block, "title");
    const description = xmlField(block, "description");
    const publishedAt = parseRssDate(xmlField(block, "pubDate"));
    sources.push({
      url,
      ...(title.length > 0 ? { title } : {}),
      ...(description.length > 0 ? { snippet: description } : {}),
      ...(publishedAt !== undefined ? { publishedAt } : {})
    });
  }
  return sources;
}

// ---- Test data ----
const sample = `<!DOCTYPE html><html><body>
<ol>
  <li class="b_algo">
    <h2><a href="https://example.com/page?a=1&amp;b=2" title="Example">Example &amp; Co — a &quot;quoted&quot; title</a></h2>
    <div class="b_caption"><p>This is the <b>snippet</b> &amp; it has entities.</p></div>
  </li>
  <li class="b_algo">
    <h2><a href="https://second.example.org/doc">Second title</a></h2>
    <p class="b_lineclamp2">Second snippet text</p>
  </li>
  <li class="b_algo">
    <h2><a href="https://third.example.net/x">Third</a></h2>
    <p class="b_algoSlug">Third snippet &amp; more</p>
  </li>
</ol>
<div class="no-results">No results found for <strong>xyz</strong></div>
</body></html>`;

let pass = 0, fail = 0;
function check(label, condition) {
  if (condition) { pass++; console.log("  PASS " + label); }
  else { fail++; console.error("  FAIL " + label); }
}

console.log("== parse results (no cap) ==");
const all = parseBingHtml(sample, null);
check("3 sources parsed", all.length === 3);
check("URL decoded from &amp;", all[0].url === "https://example.com/page?a=1&b=2");
check("title decoded", all[0].title === "Example & Co — a \"quoted\" title");
check("snippet decoded + stripped", all[0].snippet === "This is the snippet & it has entities.");
check("absolute URL passthrough", all[1].url === "https://second.example.org/doc");
check("b_lineclamp snippet", all[1].snippet === "Second snippet text");
check("b_algoSlug snippet", all[2].snippet === "Third snippet & more");
check("publishedAt absent", all[0].publishedAt === undefined);

console.log("== maxResults cap ==");
const capped = parseBingHtml(sample, 2);
check("capped to 2", capped.length === 2);

console.log("== dedupe ==");
const dupHtml = sample + '<li class="b_algo"><h2><a href="https://second.example.org/doc">dup</a></h2></li>';
const deduped = parseBingHtml(dupHtml, null);
check("duplicate URL dropped", deduped.length === 3);

console.log("== blocked detection ==");
check("captcha detected", looksBlocked("<html>Captcha verify you are human</html>") === true);
check("normal page not blocked", looksBlocked(sample) === false);

console.log("== empty/no-results page ==");
const none = parseBingHtml('<div class="no-results">No results</div>', null);
check("no sources on miss", none.length === 0);

console.log("== live-Bing named entities (&ensp; / &middot;, seen in real pages) ==");
const liveHtml = `<ol><li class="b_algo"><h2><a href="https://example.com/live">Live</a></h2>
<p class="b_lineclamp2">2026年8月27日&ensp;·&ensp;DeepSeek Harness is now available&nbsp;&mdash;&nbsp;preview</p></li></ol>`;
const live = parseBingHtml(liveHtml, null);
check("live: 1 source", live.length === 1);
check("live: ensp/nbsp collapsed", !live[0].snippet.includes("&ensp;") && !live[0].snippet.includes("&nbsp;"));
check("live: mdash decoded", live[0].snippet.includes("—"));
check("live: middot decoded", live[0].snippet.includes("·"));
check("live: no leftover entities", !/&[a-zA-Z]+;/.test(live[0].snippet));
check("live: snippet exact", live[0].snippet === "2026年8月27日 · DeepSeek Harness is now available — preview");

console.log("== double-encoded &amp;lt; is not double-decoded ==");
check("no double decode", decodeHtml("&amp;lt;") === "&lt;");

console.log("== Bing '阅读更多' UI chrome is stripped ==");
const chromeHtml = `<ol>
<li class="b_algo"><h2><a href="https://example.com/x">X</a></h2>
<p class="b_lineclamp2">DeepSeek Harness is now available to developers worldwide, with …阅读更多</p></li>
<li class="b_algo"><h2><a href="https://example.com/y">Y</a></h2>
<p class="b_lineclamp2">An English result that ends with a label Read more</p></li>
<li class="b_algo"><h2><a href="https://example.com/z">Z</a></h2>
<p class="b_lineclamp2">This sentence ends with a real period.</p></li>
</ol>`;
const chrome = parseBingHtml(chromeHtml, null);
check("chrome: 3 sources", chrome.length === 3);
check("chrome: 阅读更多 removed", !chrome[0].snippet.includes("阅读更多"));
check("chrome: trailing ellipsis removed", chrome[0].snippet === "DeepSeek Harness is now available to developers worldwide, with");
check("chrome: Read more removed", chrome[1].snippet === "An English result that ends with a label");
check("chrome: real period preserved", chrome[2].snippet === "This sentence ends with a real period.");

console.log("== RSS transport: feed parsing ==");
const rssSample = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel><title>必应：亚运会金牌</title>
<item>
  <title>奖牌榜_第20届亚运会_体育_央视网 (cctv.com)</title>
  <link>https://yayun.cctv.com/2026/medal_list/index.shtml</link>
  <description>第20届亚运会将于2026年9月19日至10月4日在日本爱知·名古屋举行，央视网搭建亚运会全端专题。</description>
  <pubDate>周三, 30 9月 2026 13:31:00 GMT</pubDate>
</item>
<item>
  <title><![CDATA[English item & more]]></title>
  <link><![CDATA[https://www.olympics.com/zh/news/medal-table]]></link>
  <description>Plain English description.</description>
  <pubDate>Wed, 30 Sep 2026 13:24:00 GMT</pubDate>
</item>
<item>
  <title>No link item</title>
  <description>should be skipped</description>
</item>
</channel></rss>`;
const feed = parseRssFeed(rssSample, null);
check("rss: 2 sources (linkless skipped)", feed.length === 2);
check("rss: title parsed", feed[0].title === "奖牌榜_第20届亚运会_体育_央视网 (cctv.com)");
check("rss: link parsed", feed[0].url === "https://yayun.cctv.com/2026/medal_list/index.shtml");
check("rss: description -> snippet", feed[0].snippet.startsWith("第20届亚运会将于2026年9月19日"));
check("rss: CDATA title unwrapped", feed[1].title === "English item & more");
check("rss: CDATA link unwrapped", feed[1].url === "https://www.olympics.com/zh/news/medal-table");
check("rss: publishedAt present", typeof feed[0].publishedAt === "string");
check("rss: cap honored", parseRssFeed(rssSample, 1).length === 1);
check("rss: non-feed body -> empty", parseRssFeed("<html>captcha</html>", null).length === 0);

console.log("== RSS transport: localized pubDate ==");
check("rss: Chinese weekday/month parsed", parseRssDate("周三, 30 9月 2026 13:31:00 GMT") === "2026-09-30T13:31:00.000Z");
check("rss: English RFC-822 parsed", parseRssDate("Wed, 30 Sep 2026 13:24:00 GMT") === "2026-09-30T13:24:00.000Z");
check("rss: Chinese 1-digit month", parseRssDate("周一, 5 1月 2026 08:05:00 GMT") === "2026-01-05T08:05:00.000Z");
check("rss: native Date() would fail on Chinese form", Number.isNaN(new Date("周三, 30 9月 2026 13:31:00 GMT").getTime()));
check("rss: garbage -> undefined", parseRssDate("not a date") === undefined);
check("rss: empty -> undefined", parseRssDate("") === undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

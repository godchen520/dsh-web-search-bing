import z from "@deepseek-ai/schemastery";
import { WebError } from "@deepseek-ai/dsh-web";

/**
 * #region provider
 * Bing-backed free web search provider for the `ctx.web` seam.
 *
 * It needs NO API key and makes NO model call, so the `web_search` tool works
 * here without spending DeepSeek (or any LLM) search quota. The default
 * endpoint is `cn.bing.com`, reachable from mainland China where DuckDuckGo is
 * not.
 *
 * ## Two transports, RSS first
 *
 * Bing serves the same ranking two ways, and this provider prefers the cleaner
 * one:
 *
 * 1. **RSS** (`&format=rss`) — ~4 KB of structured XML with `<title>`, `<link>`,
 *    `<description>` and `<pubDate>` per item. No HTML to scrape, so the
 *    entity-decoding and UI-chrome pitfalls that HTML parsing needs cannot
 *    arise, and `<pubDate>` maps straight onto `publishedAt`.
 * 2. **HTML** (`<li class="b_algo">`) — the fallback. Used when RSS yields no
 *    items or fails outright, so a change to Bing's feed can never take the
 *    provider down.
 *
 * RSS does not change relevance: both transports return the same ranking. The
 * gain is robustness, payload size, and excerpt quality.
 *
 * ## Configuration model (DSH >= 0.1.7 / 0.2.x)
 *
 * The old `installSettingsSection(ctx, ns, Config, …)` registration is gone:
 * the host generates a plugin's settings form from the exported {@link Config}
 * schema, and runtime values arrive through the `config` argument. A field
 * marked `.volatile()` is a live accessor read with `.get()`; an unmarked field
 * is a plain value. {@link readField} accepts both, so the provider also works
 * with a plain object config (tests, older compositions).
 *
 * @module dsh-web-search-bing/provider
 */

/** Stable id this provider registers under. */
const PROVIDER_ID = "bing-free";

/** Default endpoint: Bing China, Chinese results. `q=` is appended at call time. */
const DEFAULT_ENDPOINT = "https://cn.bing.com/search";

/** Default `ensearch` param: `0` = Chinese results, `1` = English. */
const DEFAULT_ENSEARCH = 0;

/** Default upper bound on results parsed per page. */
const DEFAULT_MAX_RESULTS = 10;

/** Whether the RSS transport is tried before the HTML one. */
const DEFAULT_PREFER_RSS = true;

/**
 * Browser-ish User-Agent. Bing may reject bare Node/undici agents; a
 * conservative desktop UA keeps it serving normal result pages.
 */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Named HTML/XML entities Bing emits in titles and snippets. `&ensp;`/`&emsp;`
 * are the ones that actually showed up in live HTML result pages; the rest
 * cover common punctuation and symbols so text reads cleanly. `apos` is the
 * XML-only one the RSS feed can carry.
 */
const NAMED_ENTITIES = {
  quot: '"',
  amp: "&",
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  middot: "·",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  bull: "•",
  times: "×",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  laquo: "«",
  raquo: "»",
  sect: "§",
  para: "¶",
  dagger: "†",
  permil: "‰",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  larr: "←",
  rarr: "→",
  harr: "↔"
};

/**
 * Decode entities and strip markup. Handles numeric (`&#xNN;` / `&#NNN;`) and
 * named (`&ensp;`, `&middot;`, `&apos;`) entities, then removes any residual
 * tags and collapses whitespace. `&amp;` resolves in the same single pass as
 * every other named entity, so a double-encoded `&amp;lt;` yields a literal
 * `&lt;` rather than `<`.
 *
 * @param value - the raw string to decode.
 * @returns the decoded string.
 */
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

/**
 * Strip Bing's HTML snippet UI chrome. Every HTML result snippet ends with
 * Bing's "read more" affordance (a `阅读更多` / `Read more` link inside the same
 * `<p>`), usually preceded by a line-clamp ellipsis. Neither is page content, so
 * the model gets cleaner excerpts without them. Only a TRAILING label and
 * ellipsis are removed — a period ending a real sentence stays.
 *
 * The RSS transport never needs this: its `<description>` is already the clean
 * excerpt.
 *
 * @param text - the decoded snippet text.
 * @returns the snippet without the trailing UI affordance.
 */
function cleanSnippet(text) {
  return text
    .replace(/\s*(?:阅读更多|Read\s?more)\s*$/iu, "")
    .replace(/(?:\s*(?:…|\.{3}))+\s*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse one `<li class="b_algo">` block from Bing's HTML into a source.
 *
 * @param blockHtml - the inner HTML of one result `<li>`.
 * @returns `{ url, title, snippet }` or `null` when the block has no usable link.
 */
function parseBingResultBlock(blockHtml) {
  // Title + URL: <h2><a href="URL" ...>Title</a></h2>
  const titleMatch = /<h2[^>]*>\s*<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(blockHtml);
  if (titleMatch == null) return null;
  const href = decodeHtml(titleMatch[1].trim());
  const title = decodeHtml(titleMatch[2]);
  // Resolve URL — Bing sometimes uses relative or redirect URLs.
  let url;
  try {
    if (href.startsWith("//")) url = `https:${href}`;
    else if (href.startsWith("/")) url = `https://cn.bing.com${href}`;
    else url = new URL(href).href;
  } catch {
    url = href;
  }
  if (!(url.startsWith("https://") || url.startsWith("http://"))) return null;
  // Snippet: try multiple selectors Bing uses across versions.
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

/**
 * Parse Bing's HTML results page into source objects.
 *
 * Bing renders organic results as `<li class="b_algo">` inside an `<ol>`.
 * Parsing is tolerant: it extracts every `<li class="b_algo">` block, parses
 * title + URL + snippet from each, and dedupes by URL.
 *
 * @param html - the raw result page body.
 * @param maxResults - parsed source cap; unset means parse the whole page.
 * @returns the normalized sources.
 */
function parseBingHtml(html, maxResults) {
  const sources = [];
  const seen = new Set();
  // Split on <li class="b_algo"> boundaries — each block is one result.
  const blocks = html.split(/<li\s+class\s*=\s*["']?\s*b_algo\b/i);
  // Skip the first element (everything before the first result).
  for (let i = 1; i < blocks.length && (maxResults == null || sources.length < maxResults); i++) {
    // Trim to the next </li> to avoid parsing across blocks.
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

/** English month prefixes, for the RFC-822 dates Bing's feed emits. */
const MONTH_PREFIXES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

/**
 * Resolve an RFC-822 month token to its number. Bing localizes the feed, so the
 * token is either an English abbreviation (`Sep`) or `<n>月`.
 *
 * @param token - the month token.
 * @returns the 1-based month, or `undefined` when unrecognized.
 */
function monthNumber(token) {
  const numeric = /^(\d{1,2})\s*月?$/.exec(token);
  if (numeric != null) {
    const n = Number(numeric[1]);
    return n >= 1 && n <= 12 ? n : undefined;
  }
  return MONTH_PREFIXES[token.slice(0, 3).toLowerCase()];
}

/** Zero-pad a date/time component to two digits. */
function pad2(value) {
  return String(value).padStart(2, "0");
}

/**
 * Parse a feed `<pubDate>` into an ISO-8601 timestamp the seam can carry as
 * `publishedAt`.
 *
 * Bing localizes the weekday and month (`周一, 28 9月 2026 21:19:00 GMT`), which
 * `new Date()` cannot read — verified as `Invalid Date`. The English form
 * (`Wed, 30 Sep 2026 13:24:00 GMT`) parses natively, so that is tried first and
 * the localized form is assembled by hand.
 *
 * @param raw - the raw `<pubDate>` text.
 * @returns the ISO-8601 timestamp, or `undefined` when unparseable.
 */
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
  const year = Number(m[3]);
  const day = Number(m[1]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const zone = m[8] === undefined ? "Z" : `${m[8]}${m[9]}:${m[10]}`;
  const parsed = new Date(
    `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}${zone}`
  );
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * Read one XML element's text from an `<item>` block, unwrapping CDATA and
 * decoding entities.
 *
 * @param block - the `<item>` inner XML.
 * @param tag - the element name.
 * @returns the decoded text, or `""` when absent.
 */
function xmlField(block, tag) {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  if (m == null) return "";
  return decodeHtml(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

/**
 * Parse Bing's RSS feed into source objects.
 *
 * Every `<item>` carries `<title>`, `<link>`, `<description>` and `<pubDate>`,
 * so the mapping is direct and needs no HTML heuristics. Items without a usable
 * link are skipped and duplicates are dropped.
 *
 * @param xml - the raw feed body.
 * @param maxResults - parsed source cap; unset means parse the whole feed.
 * @returns the normalized sources (empty when the body is not a feed).
 */
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

/**
 * True when an otherwise-2xx Bing page is actually a captcha/bot gate rather
 * than a result page.
 *
 * @param html - the response body.
 * @returns whether the page looks like a block/captcha gate.
 */
function looksBlocked(html) {
  const lower = html.slice(0, 20000).toLowerCase();
  return /(captcha|verify you are human|are you a robot|unusual traffic|access denied|challenge-platform)/.test(lower);
}

/**
 * Build a fetch error that the seam surfaces as a structured provider failure.
 *
 * @param message - the human-readable failure.
 * @param cause - the underlying error, when any.
 * @returns a {@link WebError} with code `WEB_PROVIDER_ERROR`.
 */
function providerError(message, cause) {
  return new WebError(message, "WEB_PROVIDER_ERROR", cause === void 0 ? {} : { cause });
}

/**
 * Read one config field across both config shapes DSH hands a plugin: a
 * `.volatile()` field is a live accessor (`{ get() }`), a plain field is the
 * value itself. Missing/nullish values fall back to the schema default.
 *
 * @param field - the accessor, the plain value, or `undefined`.
 * @param fallback - the value to use when the field is absent or nullish.
 * @returns the resolved value.
 */
function readField(field, fallback) {
  if (field === void 0 || field === null) return fallback;
  if (typeof field.get === "function") {
    const live = field.get();
    return live === void 0 || live === null ? fallback : live;
  }
  return field;
}

/** Rethrow an abort as the provider's stable cancellation error; ignore anything else. */
function rethrowIfAborted(error, signal) {
  if (signal?.aborted === true) throw new WebError("Bing free search aborted", "WEB_ABORTED", { cause: signal.reason });
  if (error instanceof WebError && error.code === "WEB_ABORTED") throw error;
}

/**
 * The Bing-backed free search provider. `available()` is trivially `true`: the
 * provider needs no key, credential, or environment setup.
 *
 * Each search tries the RSS transport first (when `preferRss`), falling back to
 * the HTML transport when the feed yields no items or fails. Cancellation is
 * never swallowed by the fallback.
 */
class BingFreeSearchProvider {
  id = PROVIDER_ID;

  constructor(endpoint, maxResults, ensearch, preferRss) {
    this.endpoint = endpoint;
    this.maxResults = maxResults;
    this.ensearch = ensearch;
    this.preferRss = preferRss;
  }

  available() {
    return true;
  }

  /**
   * Run one search: RSS first, HTML as the fallback.
   *
   * @param request - the seam's search request.
   * @param signal - optional cancellation signal.
   * @returns the normalized result.
   */
  async search(request, signal) {
    const query = (request.query ?? "").trim();
    if (query.length === 0) throw providerError("Bing free search requires a non-empty query");
    if (this.preferRss !== false) {
      let rssFailure;
      try {
        const sources = await this.searchViaRss(query, signal);
        // A non-empty feed is authoritative; an empty one falls through to HTML
        // so a feed-format change cannot silently produce "no results".
        if (sources.length > 0) return { sources, truncated: false };
      } catch (error) {
        rethrowIfAborted(error, signal);
        rssFailure = error;
      }
      try {
        const sources = await this.searchViaHtml(query, signal);
        return { sources, truncated: false };
      } catch (error) {
        rethrowIfAborted(error, signal);
        // Report the RSS failure when the fallback failed too and RSS said
        // something specific; otherwise the fallback's own error is clearer.
        throw rssFailure ?? error;
      }
    }
    return { sources: await this.searchViaHtml(query, signal), truncated: false };
  }

  /** GET one URL as text, mapping network/HTTP failures to `WEB_PROVIDER_ERROR`. */
  async getText(url, signal) {
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
        },
        ...(signal !== void 0 ? { signal } : {})
      });
    } catch (error) {
      if (signal?.aborted === true) throw new WebError("Bing free search aborted", "WEB_ABORTED", { cause: signal.reason });
      throw providerError(`Bing search request failed: ${String(error)}`, error);
    }
    if (!response.ok) throw providerError(`Bing search returned HTTP ${response.status}`);
    try {
      return await response.text();
    } catch (error) {
      if (signal?.aborted === true) throw new WebError("Bing free search aborted", "WEB_ABORTED", { cause: signal.reason });
      throw providerError(`Bing returned an unreadable response body: ${String(error)}`, error);
    }
  }

  /** Build the request URL for one transport. */
  buildUrl(query, rss) {
    const params = new URLSearchParams({ q: query, ensearch: String(this.ensearch) });
    if (rss) params.set("format", "rss");
    return `${this.endpoint}?${params.toString()}`;
  }

  /**
   * Search through Bing's RSS feed — the clean, structured transport.
   *
   * @param query - the search query.
   * @param signal - optional cancellation signal.
   * @returns the normalized sources (empty when the feed carries no items).
   */
  async searchViaRss(query, signal) {
    const xml = await this.getText(this.buildUrl(query, true), signal);
    return parseRssFeed(xml, this.maxResults);
  }

  /**
   * Search by scraping Bing's HTML result page — the fallback transport.
   *
   * @param query - the search query.
   * @param signal - optional cancellation signal.
   * @returns the normalized sources.
   */
  async searchViaHtml(query, signal) {
    const html = await this.getText(this.buildUrl(query, false), signal);
    if (looksBlocked(html)) {
      throw providerError(
        "Bing answered with a captcha/gate instead of results. Retry later, or switch the searchProvider to another backend."
      );
    }
    return parseBingHtml(html, this.maxResults);
  }
}

/**
 * #endregion
 * #region index
 * Register a free Bing-backed provider in `ctx.web`. It calls Bing's public
 * search endpoints and needs no API key, so `web_search` runs without any
 * DeepSeek/model search quota. The provider id is `bing-free`; the bundle's
 * `cordis.patch.yml` sets `web.searchProvider` to it.
 *
 * The config fields are `.volatile()`, so the host-generated settings form edits
 * them live: a saved change reaches the next search without reloading this
 * plugin.
 * @module dsh-web-search-bing
 */

/** Cordis plugin name used by loader diagnostics. */
const name = "web-search-bing";

/** The web seam this provider registers into. */
const inject = ["web"];

const Config = z.object({
  endpoint: z.string().default(DEFAULT_ENDPOINT).volatile(),
  maxResults: z.number().step(1).min(1).default(DEFAULT_MAX_RESULTS).volatile(),
  ensearch: z.number().step(1).min(0).max(1).default(DEFAULT_ENSEARCH).volatile(),
  preferRss: z.boolean().default(DEFAULT_PREFER_RSS).volatile()
});

/**
 * Settings namespace this provider's page is filed under. In DSH >= 0.1.7 the
 * namespace is the loader entry id, which this bundle names `web-search-bing`;
 * the constant is exported for documentation/UI parity with the shipped
 * provider rather than for registration.
 */
const WEB_SEARCH_BING_SETTINGS_NAMESPACE = "web-search-bing";

/**
 * Register the free Bing search provider with `ctx.web`.
 *
 * `config` is the schema-validated configuration for this plugin entry. The
 * thunk re-reads it per search, so a live settings edit applies to the next
 * `web_search` call while the registered provider object stays the same.
 */
function apply(ctx, config) {
  const resolve = () => ({
    endpoint: readField(config?.endpoint, DEFAULT_ENDPOINT),
    maxResults: readField(config?.maxResults, DEFAULT_MAX_RESULTS),
    ensearch: readField(config?.ensearch, DEFAULT_ENSEARCH),
    preferRss: readField(config?.preferRss, DEFAULT_PREFER_RSS)
  });
  ctx.web.registerSearchProvider({
    id: PROVIDER_ID,
    available: () => true,
    search: (request, signal) => {
      const { endpoint, maxResults, ensearch, preferRss } = resolve();
      return new BingFreeSearchProvider(endpoint, maxResults, ensearch, preferRss).search(request, signal);
    }
  });
}

export {
  Config,
  DEFAULT_ENDPOINT,
  DEFAULT_ENSEARCH,
  DEFAULT_MAX_RESULTS,
  DEFAULT_PREFER_RSS,
  PROVIDER_ID,
  BingFreeSearchProvider,
  WEB_SEARCH_BING_SETTINGS_NAMESPACE,
  apply,
  inject,
  name
};

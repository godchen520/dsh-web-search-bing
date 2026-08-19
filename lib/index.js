import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { WebError } from "@deepseek-ai/dsh-web";

/**
 * #region provider
 * Bing-backed free web search provider for the `ctx.web` seam.
 *
 * This provider performs a plain HTTPS GET against Bing's public HTML search
 * page (cn.bing.com for Chinese results, or any Bing endpoint you configure)
 * and parses the result blocks it returns. It needs NO API key and makes NO
 * model call, so the `web_search` tool works here without spending DeepSeek
 * (or any LLM) search quota.
 *
 * cn.bing.com is accessible from mainland China, making this a practical
 * default for domestic DSH deployments where DuckDuckGo is blocked.
 *
 * The endpoint is fully configurable via the `web-search-duckduckgo` settings
 * section (in the Settings → Plugins page) or the cordis config, so you can
 * switch to any search engine that serves an HTML results page.
 * @module dsh-web-search-duckduckgo/provider
 */

/** Stable id this provider registers under. */
const PROVIDER_ID = "bing-free";

/** Default endpoint: Bing China, Chinese results. `q=` is appended at call time. */
const DEFAULT_ENDPOINT = "https://cn.bing.com/search";

/** Default `ensearch` param: `0` = Chinese results, `1` = English. */
const DEFAULT_ENSEARCH = 0;

/** Default upper bound on results parsed per page. */
const DEFAULT_MAX_RESULTS = 20;

/**
 * Browser-ish User-Agent. Bing may reject bare Node/undici agents; a
 * conservative desktop UA keeps it serving normal result pages.
 */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * HTML-decode an attribute/value minus markup. Bing escapes `&amp;`, `&lt;`
 * etc. and may include `&#xNN;` or `&#NNN;` entities; decoding keeps titles
 * and snippets human-readable.
 *
 * @param value - the raw string to decode.
 * @returns the decoded string.
 */
function decodeHtml(value) {
  if (value == null) return "";
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]*>/g, "")
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
    if (m != null && m[1].length > snippet.length) snippet = decodeHtml(m[1]);
  }
  return { url, title, snippet };
}

/**
 * Parse Bing's HTML results page into source objects.
 *
 * Bing renders organic results as `<li class="b_algo">` inside an `<ol>`.
 * Parsing is tolerant: it extracts every `<li class="b_algo">` block,
 * parses title + URL + snippet from each, and dedupes by URL.
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

/**
 * True when an otherwise-2xx Bing page is actually a captcha/bot gate.
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
 * The Bing-backed free search provider. `available()` is trivially `true`:
 * the provider needs no key, credential, or environment setup.
 */
class BingFreeSearchProvider {
  id = PROVIDER_ID;

  constructor(endpoint, maxResults, ensearch) {
    this.endpoint = endpoint;
    this.maxResults = maxResults;
    this.ensearch = ensearch;
  }

  available() {
    return true;
  }

  async search(request, signal) {
    const query = (request.query ?? "").trim();
    if (query.length === 0) throw providerError("Bing free search requires a non-empty query");
    const params = new URLSearchParams({ q: query, ensearch: String(this.ensearch) });
    const url = `${this.endpoint}?${params.toString()}`;
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8"
        },
        ...(signal !== void 0 ? { signal } : {})
      });
    } catch (error) {
      if (signal?.aborted === true) throw new WebError("Bing free search aborted", "WEB_ABORTED", { cause: signal.reason });
      throw providerError(`Bing free search request failed: ${String(error)}`, error);
    }
    if (!response.ok) {
      throw providerError(`Bing search returned HTTP ${response.status}`);
    }
    let html;
    try {
      html = await response.text();
    } catch (error) {
      if (signal?.aborted === true) throw new WebError("Bing free search aborted", "WEB_ABORTED", { cause: signal.reason });
      throw providerError(`Bing returned an unreadable response body: ${String(error)}`, error);
    }
    if (looksBlocked(html)) {
      throw providerError(
        "Bing answered with a captcha/gate instead of results. Retry later, or switch the searchProvider to another backend."
      );
    }
    const sources = parseBingHtml(html, this.maxResults);
    return { sources, truncated: false };
  }
}

/**
 * #endregion
 * #region index
 * Register a free Bing-backed provider in `ctx.web`. It calls Bing's public
 * HTML endpoint and needs no API key, so `web_search` runs without any
 * DeepSeek/model search quota. The provider id is `bing-free`; the bundle's
 * `cordis.patch.yml` sets `web.searchProvider` to it.
 *
 * Optional settings expose the endpoint, language mode, and parse cap for
 * deployments that need a different mirror, language, or page budget.
 * @module dsh-web-search-bing
 */

/** Cordis plugin name used by loader diagnostics. */
const name = "web-search-bing";

/** The web seam this provider registers into. */
const inject = ["web"];

const Config = z.object({
  endpoint: z.string().default(DEFAULT_ENDPOINT),
  maxResults: z.number().step(1).min(1).default(DEFAULT_MAX_RESULTS),
  ensearch: z.number().step(1).min(0).max(1).default(DEFAULT_ENSEARCH)
});

/** Settings namespace carrying this provider's endpoint and parse cap. */
const WEB_SEARCH_BING_SETTINGS_NAMESPACE = settingsNamespace("web-search-bing");

/** Register the free Bing search provider with `ctx.web`. */
function apply(ctx, config) {
  let current = () => config;
  installSettingsSection(ctx, WEB_SEARCH_BING_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source;
    },
    onChange: () => {}
  });
  const resolve = () => {
    const section = current();
    return {
      endpoint: section.endpoint ?? DEFAULT_ENDPOINT,
      maxResults: section.maxResults ?? DEFAULT_MAX_RESULTS,
      ensearch: section.ensearch ?? DEFAULT_ENSEARCH
    };
  };
  ctx.web.registerSearchProvider({
    id: PROVIDER_ID,
    available: () => true,
    search: (request, signal) => {
      const { endpoint, maxResults, ensearch } = resolve();
      return new BingFreeSearchProvider(endpoint, maxResults, ensearch).search(request, signal);
    }
  });
}

export {
  Config,
  DEFAULT_ENDPOINT,
  DEFAULT_ENSEARCH,
  DEFAULT_MAX_RESULTS,
  PROVIDER_ID,
  BingFreeSearchProvider,
  WEB_SEARCH_BING_SETTINGS_NAMESPACE,
  apply,
  inject,
  name
};

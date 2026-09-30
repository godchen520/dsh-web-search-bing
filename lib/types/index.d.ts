/**
 * Types for the Bing-backed free web search provider bundle.
 *
 * Targets DSH 0.2.x: the plugin exports a schemastery `Config` schema and the
 * host generates its settings form from it. Every field is `.volatile()`, so at
 * runtime each arrives as a live accessor (`{ get(): T }`); an unmarked or
 * plain object config supplies the bare value instead. `apply` accepts both.
 *
 * @module dsh-web-search-bing
 */
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';

/** Stable provider id registered with `ctx.web` (`bing-free`). */
export declare const PROVIDER_ID: string;
/** Default public HTML search endpoint (`https://cn.bing.com/search`). */
export declare const DEFAULT_ENDPOINT: string;
/** Default `ensearch` param (`0` = Chinese results, `1` = English). */
export declare const DEFAULT_ENSEARCH: number;
/** Default upper bound on results parsed per page. */
export declare const DEFAULT_MAX_RESULTS: number;

/**
 * Settings namespace this provider's form is filed under. In DSH >= 0.1.7 the
 * namespace is the loader entry id (`web-search-bing`), so this constant is
 * documentation/UI parity rather than a registration handle.
 */
export declare const WEB_SEARCH_BING_SETTINGS_NAMESPACE: string;

/** One config value as the host hands it to `apply`: a live accessor or a plain value. */
export type ConfigField<T> = T | { get(): T } | undefined;

/** The validated plugin configuration DSH passes to {@link apply}. */
export interface BingSearchConfig {
    /** Public search endpoint (mirror/proxy allowed). */
    readonly endpoint?: ConfigField<string>;
    /** Upper bound on parsed results per page. */
    readonly maxResults?: ConfigField<number>;
    /** `ensearch` query param: `0` = Chinese results, `1` = English. */
    readonly ensearch?: ConfigField<number>;
    /** Try the RSS transport before the HTML one (default `true`). */
    readonly preferRss?: ConfigField<boolean>;
}

/**
 * The Bing-backed free provider, satisfying {@link WebSearchProvider}.
 * `available()` is always `true` (no key, credential, or environment needed).
 *
 * Each search prefers Bing's RSS feed (structured XML, carries `publishedAt`)
 * and falls back to scraping the HTML result page when the feed is empty or
 * fails. Cancellation is never swallowed by the fallback.
 */
export declare class BingFreeSearchProvider implements WebSearchProvider {
    readonly id: string;
    constructor(endpoint?: string, maxResults?: number, ensearch?: number, preferRss?: boolean);
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}

/** Default for {@link BingSearchConfig.preferRss}. */
export declare const DEFAULT_PREFER_RSS: boolean;

/** Cordis plugin name (loader diagnostics). */
export declare const name: string;
/** Services injected by this plugin. */
export declare const inject: string[];
/** Schemastery schema for this plugin's settings form (all fields `.volatile()`). */
export declare const Config: unknown;
/** Cordis plugin apply entry: registers the provider with `ctx.web`. */
export declare function apply(ctx: any, config?: BingSearchConfig): void;

/**
 * Types for the Bing-backed free web search provider bundle.
 * @module dsh-web-search-duckduckgo
 */
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web';
/** Stable provider id (bing-free). */
export declare const PROVIDER_ID: string;
/** Default public HTML search endpoint (cn.bing.com/search). */
export declare const DEFAULT_ENDPOINT: string;
/** Default ensearch param (0 = Chinese results). */
export declare const DEFAULT_ENSEARCH: number;
/** Default upper bound on parsed results per page. */
export declare const DEFAULT_MAX_RESULTS: number;
/** Settings namespace for this provider. */
export declare const WEB_SEARCH_DUCKDUCKGO_SETTINGS_NAMESPACE: unknown;
/**
 * The Bing-backed free provider, satisfying {@link WebSearchProvider}.
 * `available()` is always `true` (no key or environment needed).
 */
export declare class BingFreeSearchProvider implements WebSearchProvider {
    readonly id: string;
    constructor(endpoint?: string, maxResults?: number, ensearch?: number);
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
/** Cordis plugin name. */
export declare const name: string;
/** Services injected by this plugin. */
export declare const inject: string[];
/** Schema for the config / settings section. */
export declare const Config: unknown;
/** Cordis plugin apply entry: registers the provider with `ctx.web`. */
export declare function apply(ctx: any, config: any): void;

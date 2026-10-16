import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import type { ResolvedConfig } from "./config.js"

export const VERSION = "0.1.1"
export const PROVIDER_ID = "searxng"
export const PROVIDER_NAME = "SearXNG"

/** Tolerant SearXNG `/search?format=json` item shape. Extra fields are ignored. */
export const SearxngItem = Schema.Struct({
  url: Schema.String,
  title: Schema.NullOr(Schema.String).pipe(Schema.optional),
  content: Schema.NullOr(Schema.String).pipe(Schema.optional),
  publishedDate: Schema.NullOr(Schema.String).pipe(Schema.optional),
  pubdate: Schema.NullOr(Schema.String).pipe(Schema.optional),
  engine: Schema.NullOr(Schema.String).pipe(Schema.optional),
})
export type SearxngItem = typeof SearxngItem.Type

export const SearxngResponse = Schema.Struct({
  query: Schema.String.pipe(Schema.optional),
  results: Schema.Array(SearxngItem),
})
export type SearxngResponse = typeof SearxngResponse.Type

export interface SearchParams {
  readonly query: string
  readonly categories?: string | undefined
  readonly engines?: string | undefined
  readonly language?: string | undefined
  readonly time_range?: string | undefined
  readonly safesearch?: number | undefined
  readonly pageno?: number | undefined
}

export interface WebSearchResult {
  readonly url: string
  readonly title?: string | undefined
  readonly content?: string | undefined
  readonly time: { readonly published?: number | undefined }
}

export function parsePublished(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Map one SearXNG result row to opencode `WebSearch.Result`. Returns undefined when unusable. */
export function mapItem(item: SearxngItem): WebSearchResult | undefined {
  const url = item.url?.trim()
  if (!url) return undefined
  const title = item.title?.trim() ? item.title.trim() : undefined
  const content = item.content?.trim() ? item.content.trim() : undefined
  const published = parsePublished(item.publishedDate ?? item.pubdate ?? undefined)
  return {
    url,
    ...(title ? { title } : {}),
    ...(content ? { content } : {}),
    time: { ...(published !== undefined ? { published } : {}) },
  }
}

export function mapResults(items: readonly SearxngItem[], maxResults: number): readonly WebSearchResult[] {
  const out: WebSearchResult[] = []
  for (const item of items) {
    if (out.length >= maxResults) break
    const mapped = mapItem(item)
    if (mapped) out.push(mapped)
  }
  return out
}

export function buildSearchUrl(baseUrl: string, params: SearchParams, defaults: ResolvedConfig): string {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/search`)
  url.searchParams.set("q", params.query)
  url.searchParams.set("format", "json")
  const categories = params.categories ?? defaults.categories
  if (categories) url.searchParams.set("categories", categories)
  const engines = params.engines ?? defaults.engines
  if (engines) url.searchParams.set("engines", engines)
  const language = params.language ?? defaults.language
  if (language) url.searchParams.set("language", language)
  const timeRange = params.time_range ?? defaults.timeRange
  if (timeRange) url.searchParams.set("time_range", timeRange)
  const safesearch = params.safesearch ?? defaults.safesearch
  url.searchParams.set("safesearch", String(safesearch))
  url.searchParams.set("pageno", String(params.pageno ?? 1))
  return url.toString()
}

export function userAgent(app: { readonly name: string; readonly version: string; readonly channel: string }): string {
  return `opencode/${app.channel}/${app.version}/${app.name} opencode-searxng/${VERSION}`
}

export function hintForStatus(status: number): string {
  if (status === 403)
    return "SearXNG returned 403. Enable JSON output on the server: search.formats must include 'json' in settings.yml."
  if (status === 429) return "SearXNG rate limited (HTTP 429). Retry later or raise server limiter settings."
  if (status === 401 || status === 403)
    return `SearXNG authentication failed (HTTP ${status}). Check reverse-proxy auth / bearer token.`
  return `SearXNG request failed (HTTP ${status})`
}

/**
 * Execute a SearXNG search and return opencode-shaped results.
 * Query string is forwarded verbatim so `!engine !category :lang` syntax keeps working per-query.
 */
export const search = (
  http: HttpClient.HttpClient,
  app: { readonly name: string; readonly version: string; readonly channel: string },
  config: ResolvedConfig,
  params: SearchParams,
  maxResults?: number,
): Effect.Effect<readonly WebSearchResult[], unknown> =>
  Effect.gen(function* () {
    const url = buildSearchUrl(config.baseUrl, params, config)
    const limit = Math.min(20, Math.max(1, maxResults ?? config.maxResults))
    const request = HttpClientRequest.get(url).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeaders({
        "User-Agent": userAgent(app),
        Accept: "application/json",
        ...(config.bearerToken ? { Authorization: `Bearer ${config.bearerToken}` } : {}),
      }),
    )
    const response = yield* HttpClient.withScope(HttpClient.filterStatusOk(http))
      .execute(request)
      .pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(SearxngResponse)),
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: Duration.millis(config.timeoutMs),
          orElse: () => Effect.fail(new Error(`SearXNG request timed out after ${config.timeoutMs}ms`)),
        }),
        Effect.mapError((cause) => {
          const status =
            typeof cause === "object" && cause !== null && "response" in cause
              ? (cause as { response?: { status?: number } }).response?.status
              : undefined
          if (status !== undefined) return new Error(hintForStatus(status))
          return cause
        }),
      )
    return mapResults(response.results, limit)
  })

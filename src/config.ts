import { Schema } from "effect"

/** Plugin options as supplied via opencode.json `plugins: [{package, options}]`. */
export interface RawOptions {
  readonly baseUrl?: unknown
  readonly categories?: unknown
  readonly engines?: unknown
  readonly language?: unknown
  readonly safesearch?: unknown
  readonly timeRange?: unknown
  readonly maxResults?: unknown
  readonly timeoutMs?: unknown
  readonly bearerToken?: unknown
}

export interface ResolvedConfig {
  readonly baseUrl: string
  readonly categories: string
  readonly engines: string | undefined
  readonly language: string
  readonly safesearch: 0 | 1 | 2
  readonly timeRange: string | undefined
  readonly maxResults: number
  readonly timeoutMs: number
  readonly bearerToken: string | undefined
}

const TIME_RANGES = new Set(["", "day", "week", "month", "year"])

function env(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

function asInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isInteger(parsed)) return parsed
  }
  return undefined
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "")
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(`Invalid SearXNG baseUrl: ${JSON.stringify(raw)} (expected http(s)://host[:port][/subpath])`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid SearXNG baseUrl protocol: ${url.protocol} (expected http: or https:)`)
  }
  return trimmed
}

export const ConfigError = (message: string) => new Error(`[opencode-searxng] ${message}`)

/** Resolve plugin options + env. Throws on invalid required config. */
export function resolveConfig(options: Record<string, unknown> = {}): ResolvedConfig {
  const raw = options as RawOptions

  const baseUrlRaw =
    asString(raw.baseUrl) ?? env("SEARXNG_BASE_URL") ?? asString((options as { url?: unknown }).url)
  if (!baseUrlRaw) {
    throw ConfigError(
      `missing baseUrl. Set plugin options { "baseUrl": "http://localhost:8888" } or env SEARXNG_BASE_URL.`,
    )
  }
  const baseUrl = normalizeBaseUrl(baseUrlRaw)

  const categories = asString(raw.categories) ?? env("SEARXNG_CATEGORIES") ?? "general"
  const engines = asString(raw.engines) ?? env("SEARXNG_ENGINES") ?? undefined
  const language = asString(raw.language) ?? env("SEARXNG_LANGUAGE") ?? "all"

  const safesearchRaw = asInt(raw.safesearch) ?? (env("SEARXNG_SAFESEARCH") ? asInt(env("SEARXNG_SAFESEARCH")) : undefined) ?? 1
  const safesearch = safesearchRaw === 0 || safesearchRaw === 1 || safesearchRaw === 2 ? safesearchRaw : 1

  const timeRangeRaw = asString(raw.timeRange) ?? env("SEARXNG_TIME_RANGE") ?? undefined
  if (timeRangeRaw !== undefined && !TIME_RANGES.has(timeRangeRaw)) {
    throw ConfigError(`invalid timeRange ${JSON.stringify(timeRangeRaw)} (expected one of: day, week, month, year)`)
  }
  const timeRange = timeRangeRaw === "" ? undefined : timeRangeRaw

  const maxResultsRaw =
    asInt(raw.maxResults) ?? (env("SEARXNG_MAX_RESULTS") ? asInt(env("SEARXNG_MAX_RESULTS")) : undefined) ?? 8
  const maxResults = Math.min(20, Math.max(1, maxResultsRaw))

  const timeoutRaw =
    asInt(raw.timeoutMs) ?? (env("SEARXNG_TIMEOUT_MS") ? asInt(env("SEARXNG_TIMEOUT_MS")) : undefined) ?? 25_000
  const timeoutMs = Math.min(120_000, Math.max(1_000, timeoutRaw))

  const bearerToken =
    asString(raw.bearerToken) ?? env("SEARXNG_BEARER_TOKEN") ?? env("SEARXNG_AUTH_BEARER") ?? undefined

  return { baseUrl, categories, engines, language, safesearch, timeRange, maxResults, timeoutMs, bearerToken }
}

/** Effect Schema for the companion `searxng` tool input (structured per-query overrides). */
export const ToolInput = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query. Supports SearXNG syntax: !engine !category :language (e.g. '!wikipedia :de effect hooks')" }),
  categories: Schema.optional(Schema.String).annotate({
    description: "Comma-separated SearXNG categories (e.g. 'general,images,news'). Defaults to plugin config.",
  }),
  engines: Schema.optional(Schema.String).annotate({
    description: "Comma-separated SearXNG engines (e.g. 'wikipedia,duckduckgo'). Defaults to plugin config / server default.",
  }),
  language: Schema.optional(Schema.String).annotate({ description: "Result language (e.g. 'all', 'en', 'de'). Defaults to plugin config." }),
  time_range: Schema.optional(Schema.Literals(["day", "week", "month", "year"])).annotate({
    description: "Limit results by age. Defaults to plugin config.",
  }),
  safesearch: Schema.optional(Schema.Literals([0, 1, 2])).annotate({
    description: "Safe search level. Defaults to plugin config.",
  }),
  pageno: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(10)))).annotate({
    description: "Result page (1-10). Default 1.",
  }),
  maxResults: Schema.optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(20)))).annotate({
    description: "Max results to return. Defaults to plugin config.",
  }),
})
export type ToolInput = typeof ToolInput.Type

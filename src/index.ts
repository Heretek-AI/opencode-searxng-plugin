import { define } from "@opencode/plugin/effect/plugin"
import { Tool } from "@opencode/schema/tool"
import { Duration, Effect, Schema, Scope } from "effect"
import { HttpClient } from "effect/http"
import { resolveConfig, ToolInput } from "./config.js"
import { PROVIDER_ID, PROVIDER_NAME, search } from "./searxng.js"

const ToolOutput = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      url: Schema.String,
      title: Schema.String.pipe(Schema.optional),
      content: Schema.String.pipe(Schema.optional),
    }),
  ),
})

const TOOL_DESCRIPTION = [
  "Search the web via self-hosted SearXNG with explicit per-query control.",
  "Supports SearXNG syntax in `query` (!engine !category :language, e.g. '!wikipedia :de effect hooks').",
  "Explicit `engines`/`categories`/`language` fields override plugin defaults for this call only.",
].join(" ")

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "heretek-ai.websearch.searxng",
  effect: Effect.fn("SearxngPlugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    let config: ReturnType<typeof resolveConfig>
    try {
      config = resolveConfig(ctx.options ?? {})
    } catch (error) {
      yield* Effect.logWarning("opencode-searxng disabled: invalid configuration", {
        error: error instanceof Error ? error.message : String(error),
      })
      return
    }

    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: PROVIDER_ID,
        name: PROVIDER_NAME,
        execute: (input) =>
          search(http, ctx.app, config, { query: input.query }).pipe(
            Effect.timeoutOrElse({
              duration: Duration.millis(config.timeoutMs + 5_000),
              orElse: () => Effect.fail(new Error(`SearXNG request timed out after ${config.timeoutMs}ms`)),
            }),
          ),
      })
      // Intentionally no editor.default.set(): user opts in via
      // opencode.json { "websearch": { "provider": "searxng" } }.
    })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name: PROVIDER_ID,
          options: { codemode: false },
          description: TOOL_DESCRIPTION,
          input: ToolInput,
          output: ToolOutput,
          execute: (input) =>
            Effect.gen(function* () {
              const results = yield* search(
                http,
                ctx.app,
                config,
                {
                  query: input.query,
                  categories: input.categories,
                  engines: input.engines,
                  language: input.language,
                  time_range: input.time_range,
                  safesearch: input.safesearch,
                  pageno: input.pageno ?? 1,
                },
                input.maxResults ?? config.maxResults,
              )
              const output = {
                results: results.map((item) => ({
                  url: item.url,
                  ...(item.title ? { title: item.title } : {}),
                  ...(item.content ? { content: item.content } : {}),
                })),
              }
              const content =
                output.results.length === 0
                  ? "No search results found. Please try a different query."
                  : output.results
                      .map((item) => {
                        const title = item.title ?? item.url
                        return `## [${title}](${item.url})${item.content ? `\n\n${item.content}` : ""}`
                      })
                      .join("\n\n")
              return { output, content, metadata: { provider: PROVIDER_ID } }
            }).pipe(
              Effect.mapError(
                (error) =>
                  new Tool.Error({
                    message: `Unable to search SearXNG for ${input.query}`,
                    error,
                  }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
})

export default Plugin

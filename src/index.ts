import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Schema } from "effect"
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

export const Plugin = define({
  id: "heretek-ai.websearch.searxng",
  effect: Effect.fn("SearxngPlugin")(function* (ctx) {
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
          search(ctx.app, config, { query: input.query }).pipe(
            Effect.map(({ results }) => results),
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
          // Note: failures are returned as content (never channel) on purpose.
          // The host remaps `effect` and `@opencode/plugin` imports to its own
          // runtime copies, but nothing else — importing e.g. `@opencode/schema`
          // for Tool.Error breaks loading because production installs omit
          // devDependencies. Likewise only Scope is provided, so the HttpClient
          // service is unavailable and HTTP goes through global fetch.
          // So this tool never fails; it reports errors as text.
          execute: (input) =>
            search(
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
            ).pipe(
              Effect.map(({ results, unresponsive }) => {
                const output = {
                  results: results.map((item) => ({
                    url: item.url,
                    ...(item.title ? { title: item.title } : {}),
                    ...(item.content ? { content: item.content } : {}),
                  })),
                }
                const body =
                  output.results.length === 0
                    ? "No search results found. Please try a different query."
                    : output.results
                        .map((item) => {
                          const title = item.title ?? item.url
                          return `## [${title}](${item.url})${item.content ? `\n\n${item.content}` : ""}`
                        })
                        .join("\n\n")
                const content =
                  unresponsive.length === 0
                    ? body
                    : `${body}\n\nNote: ${unresponsive.join(", ")} ${unresponsive.length === 1 ? "engine is" : "engines are"} suspended or unresponsive — results may be partial.`
                return { output, content, metadata: { provider: PROVIDER_ID } }
              }),
              Effect.catch((cause: unknown) =>
                Effect.succeed({
                  output: { results: [] },
                  content: `SearXNG search failed for ${input.query}: ${cause instanceof Error ? cause.message : String(cause)}`,
                  metadata: { provider: PROVIDER_ID, error: true },
                }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
})

export default Plugin

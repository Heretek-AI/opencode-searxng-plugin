import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildSearchUrl, mapItem, mapResults, parsePublished } from "../dist/searxng.js"
import { resolveConfig } from "../dist/config.js"

const defaults = resolveConfig({ baseUrl: "http://localhost:8888" })

describe("parsePublished", () => {
  it("parses ISO dates", () => {
    assert.equal(parsePublished("2024-05-01T12:00:00+00:00"), Date.parse("2024-05-01T12:00:00+00:00"))
  })
  it("returns undefined for missing/garbage", () => {
    assert.equal(parsePublished(undefined), undefined)
    assert.equal(parsePublished(null), undefined)
    assert.equal(parsePublished("not a date"), undefined)
  })
})

describe("mapItem", () => {
  it("maps full row", () => {
    const out = mapItem({
      url: "https://example.com/a",
      title: " Title ",
      content: " Body ",
      publishedDate: "2024-05-01T00:00:00Z",
    })
    assert.deepEqual(out, {
      url: "https://example.com/a",
      title: "Title",
      content: "Body",
      time: { published: Date.parse("2024-05-01T00:00:00Z") },
    })
  })
  it("drops empty url", () => {
    assert.equal(mapItem({ url: "  " }), undefined)
  })
  it("omits blank title/content and bad date", () => {
    const out = mapItem({ url: "https://example.com", title: "  ", content: "", publishedDate: "xx" })
    assert.deepEqual(out, { url: "https://example.com", time: {} })
  })
  it("falls back to pubdate", () => {
    const out = mapItem({ url: "https://example.com", pubdate: "2023-01-02" })
    assert.deepEqual(out, { url: "https://example.com", time: { published: Date.parse("2023-01-02") } })
  })
})

describe("mapResults", () => {
  it("filters bad rows and caps maxResults", () => {
    const out = mapResults(
      [{ url: "https://a.example" }, { url: "" }, { url: "https://b.example" }],
      1,
    )
    assert.equal(out.length, 1)
    assert.equal(out[0]?.url, "https://a.example")
  })
})

describe("buildSearchUrl", () => {
  it("builds json url with defaults", () => {
    const url = new URL(buildSearchUrl("http://localhost:8888/", { query: "hello world" }, defaults))
    assert.equal(url.origin + url.pathname, "http://localhost:8888/search")
    assert.equal(url.searchParams.get("q"), "hello world")
    assert.equal(url.searchParams.get("format"), "json")
    assert.equal(url.searchParams.get("categories"), "general")
    assert.equal(url.searchParams.get("language"), "all")
    assert.equal(url.searchParams.get("safesearch"), "1")
    assert.equal(url.searchParams.get("pageno"), "1")
  })
  it("per-query overrides win and bang syntax survives", () => {
    const url = new URL(
      buildSearchUrl(
        "http://localhost:8888",
        { query: "!wikipedia :de effect", engines: "wikipedia", language: "de", pageno: 2 },
        defaults,
      ),
    )
    assert.equal(url.searchParams.get("q"), "!wikipedia :de effect")
    assert.equal(url.searchParams.get("engines"), "wikipedia")
    assert.equal(url.searchParams.get("language"), "de")
    assert.equal(url.searchParams.get("pageno"), "2")
  })
  it("preserves base subpath", () => {
    const url = new URL(buildSearchUrl("https://example.com/searxng", { query: "x" }, defaults))
    assert.equal(url.origin + url.pathname, "https://example.com/searxng/search")
  })
})

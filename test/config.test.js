import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { normalizeBaseUrl, resolveConfig } from "../dist/config.js"

describe("normalizeBaseUrl", () => {
  it("trims trailing slashes", () => {
    assert.equal(normalizeBaseUrl("http://localhost:8888///"), "http://localhost:8888")
  })
  it("keeps subpaths", () => {
    assert.equal(normalizeBaseUrl("https://example.com/searxng/"), "https://example.com/searxng")
  })
  it("rejects non-http", () => {
    assert.throws(() => normalizeBaseUrl("ftp://example.com"), /protocol/)
  })
  it("rejects garbage", () => {
    assert.throws(() => normalizeBaseUrl("not a url"), /Invalid SearXNG baseUrl/)
  })
})

describe("resolveConfig", () => {
  it("throws without baseUrl", () => {
    const prev = process.env.SEARXNG_BASE_URL
    delete process.env.SEARXNG_BASE_URL
    try {
      assert.throws(() => resolveConfig({}), /missing baseUrl/)
    } finally {
      if (prev !== undefined) process.env.SEARXNG_BASE_URL = prev
    }
  })
  it("applies defaults and clamps", () => {
    const cfg = resolveConfig({ baseUrl: "http://localhost:8888/", maxResults: 99, timeoutMs: 1 })
    assert.equal(cfg.baseUrl, "http://localhost:8888")
    assert.equal(cfg.categories, "general")
    assert.equal(cfg.language, "all")
    assert.equal(cfg.safesearch, 1)
    assert.equal(cfg.maxResults, 20)
    assert.equal(cfg.timeoutMs, 1000)
  })
  it("reads env fallback", () => {
    process.env.SEARXNG_BASE_URL = "http://searxng:8888"
    try {
      const cfg = resolveConfig({})
      assert.equal(cfg.baseUrl, "http://searxng:8888")
    } finally {
      delete process.env.SEARXNG_BASE_URL
    }
  })
  it("rejects bad timeRange", () => {
    assert.throws(() => resolveConfig({ baseUrl: "http://x", timeRange: "hour" }), /timeRange/)
  })
})

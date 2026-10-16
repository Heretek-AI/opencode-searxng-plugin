import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { unresponsiveEngines } from "../dist/searxng.js"

describe("unresponsiveEngines", () => {
  it("extracts names from [engine, message] pairs", () => {
    assert.deepEqual(unresponsiveEngines({ results: [], unresponsive_engines: [["github", "Suspended: access denied"]] }), [
      "github",
    ])
  })
  it("handles strings, dicts, dedupes, and junk", () => {
    assert.deepEqual(
      unresponsiveEngines({
        results: [],
        unresponsive_engines: ["brave", ["brave", "x"], { engine: "github" }, 42, null, ["ok", "y"], { nope: 1 }],
      }),
      ["brave", "github", "ok"],
    )
  })
  it("returns [] when absent", () => {
    assert.deepEqual(unresponsiveEngines({ results: [] }), [])
  })
})

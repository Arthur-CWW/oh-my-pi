import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { search } from "../src/search"
import { fetchContent } from "../src/fetch"
import { readCookies } from "../src/cookies"
import { storeSearch, storeFetch, getStored } from "../src/store"

// Helper to run effects that have `unknown` requirements at test time
function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

describe("search", () => {
  it("rejects empty query", async () => {
    try {
      await run(search("  "))
      expect.unreachable()
    } catch (e) {
      expect(String(e)).toContain("Empty")
    }
  })
})

describe("fetch content", () => {
  it("rejects non-HTTP URLs", async () => {
    const result = await run(fetchContent(["/local/file"]))
    expect(result[0]?.error).toBe("Only HTTP(S) URLs")
  })

  it("returns empty for empty urls", async () => {
    const result = await run(fetchContent([]))
    expect(result).toEqual([])
  })
})

describe("cookies", () => {
  it("returns a result without throwing", async () => {
    const res = await run(readCookies())
    expect(res).toHaveProperty("cookies")
    expect(res).toHaveProperty("source")
  })
})

describe("stored", () => {
  it("stores and retrieves fetch results", async () => {
    const id = await run(storeFetch([{ url: "https://example.com", title: "Test", content: "hello", error: null }]))
    expect(typeof id).toBe("string")

    const data = await run(getStored(id))
    expect(data).not.toBeNull()
    expect(data!.type).toBe("fetch")
    if (data && data.type === "fetch") expect(data.urls[0]!.url).toBe("https://example.com")
  })

  it("stores and retrieves search results", async () => {
    const id = await run(storeSearch("answer text", [{ title: "T", url: "https://x.com", snippet: "" }]))
    expect(typeof id).toBe("string")

    const data = await run(getStored(id))
    expect(data!.type).toBe("search")
    if (data && data.type === "search") expect(data.queries[0]!.answer).toBe("answer text")
  })

  it("returns null for missing id", async () => {
    expect(await run(getStored("nonexistent"))).toBeNull()
  })
})

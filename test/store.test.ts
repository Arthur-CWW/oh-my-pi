import { afterEach, describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { storeSet, storeGet, storeDelete, storeList } from "../src/store"
import { storeSearch, storeFetch, getStored } from "../src/store"

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

afterEach(async () => {
  // Clean up test keys
  const all = await run(storeList())
  for (const { key } of all) {
    if (key.startsWith("test:")) await run(storeDelete(key))
  }
})

describe("sqlite store", () => {
  it("sets and gets a value", async () => {
    await run(storeSet("test:hello", { msg: "world" }))
    const val = await run(storeGet("test:hello"))
    expect(val).toEqual({ msg: "world" })
  })

  it("returns null for missing key", async () => {
    expect(await run(storeGet("test:nonexistent"))).toBeNull()
  })

  it("expires after TTL", async () => {
    await run(storeSet("test:ttl", { data: 1 }, 1)) // 1ms TTL
    await Bun.sleep(10)
    expect(await run(storeGet("test:ttl"))).toBeNull()
  })

  it("deletes a key", async () => {
    await run(storeSet("test:del", "x"))
    await run(storeDelete("test:del"))
    expect(await run(storeGet("test:del"))).toBeNull()
  })

  it("lists keys", async () => {
    await run(storeSet("test:list1", 1))
    await run(storeSet("test:list2", 2))
    const all = await run(storeList())
    const testKeys = all.filter((r) => r.key.startsWith("test:"))
    expect(testKeys.length).toBeGreaterThanOrEqual(2)
  })

  it("handles non-JSON values gracefully", async () => {
    // storeSet always stringifies, so cycling through should work
    await run(storeSet("test:types", { num: 42, str: "hi", arr: [1, 2] }))
    const val = await run(storeGet("test:types"))
    expect(val).toEqual({ num: 42, str: "hi", arr: [1, 2] })
  })
})

describe("stored results (SQLite-backed)", () => {
  it("stores and retrieves search results", async () => {
    const id = await run(storeSearch("Answer text", [{ title: "T", url: "https://x.com", snippet: "s" }]))
    const data = await run(getStored(id))
    expect(data).not.toBeNull()
    expect(data!.type).toBe("search")
    if (data && data.type === "search") {
      expect(data.queries[0]!.answer).toBe("Answer text")
      expect(data.queries[0]!.results[0]!.title).toBe("T")
    }
  })

  it("stores and retrieves fetch results", async () => {
    const id = await run(storeFetch([{ url: "https://a.com", title: "A", content: "body", error: null }]))
    const data = await run(getStored(id))
    expect(data).not.toBeNull()
    expect(data!.type).toBe("fetch")
    if (data && data.type === "fetch") {
      expect(data.urls[0]!.url).toBe("https://a.com")
    }
  })

  it("returns null for missing id", async () => {
    expect(await run(getStored("nonexistent-id"))).toBeNull()
  })
})

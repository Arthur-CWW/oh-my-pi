import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { runSearch, extractResults, extractAnswer, stripHtml, getPayloadHtml }
  from "../src/kagi"
import type { KagiEventItem } from "../src/kagi"

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

const FIXTURE: Array<{ data: unknown }> = [
  {
    data: [
      { tag: "top-content-unique", payload: "  <i>17</i> relevant results in <i>1.72s</i>." },
    ],
  },
  {
    data: [
      {
        tag: "search",
        payload: {
          content:
            '<div class="sri-group">' +
            '<div class="_0_SRI search-result">' +
            '<div class="_0_TITLE __sri-title"><h3 class="__sri-title-box">' +
            '<a class="__sri_title_link" href="https://effect.website" title="Effect Docs">Effect Docs</a>' +
            '</h3></div>' +
            '<div class="_0_DESC __sri-desc">Official Effect docs</div>' +
            "</div>" +
            '<div class="_0_SRI search-result">' +
            '<div class="_0_TITLE __sri-title"><h3 class="__sri-title-box">' +
            '<a class="__sri_title_link" href="https://github.com/Effect-TS/effect" title="GitHub">Effect on GitHub</a>' +
            '</h3></div>' +
            '<div class="_0_DESC __sri-desc">TypeScript standard library</div>' +
            "</div>" +
            "</div>",
        },
      },
    ],
  },
]

describe("kagi parsing", () => {
  it("strips HTML tags", () => {
    expect(stripHtml("<b>hello</b> world")).toBe("hello world")
    expect(stripHtml("a &#39;b&#39; &amp; c")).toBe("a 'b' & c")
    expect(stripHtml("   multiple    spaces   ")).toBe("multiple spaces")
  })

  it("extracts payload from string", () => {
    const item: KagiEventItem = { tag: "search", payload: "<div>test</div>" }
    expect(getPayloadHtml(item)).toBe("<div>test</div>")
  })

  it("extracts payload from object with content", () => {
    const item: KagiEventItem = { tag: "search", payload: { content: "<div>test</div>" } }
    expect(getPayloadHtml(item)).toBe("<div>test</div>")
  })

  it("extracts results from fixture", () => {
    const results = extractResults(FIXTURE)
    expect(results.length).toBe(2)
    expect(results[0]!.title).toBe("Effect Docs")
    expect(results[0]!.url).toBe("https://effect.website")
    expect(results[0]!.snippet).toBe("Official Effect docs")
    expect(results[1]!.title).toBe("Effect on GitHub")
    expect(results[1]!.url).toBe("https://github.com/Effect-TS/effect")
    expect(results[1]!.snippet).toBe("TypeScript standard library")
  })

  it("extracts answer from top-content-unique", () => {
    expect(extractAnswer(FIXTURE)).toBe("17 relevant results in 1.72s.")
  })

  it("deduplicates results by URL", () => {
    const dupFixture: Array<{ data: unknown }> = [{
      data: [{
        tag: "search",
        payload: {
          content:
            '<div class="_0_SRI">' +
            '<a class="__sri_title_link" href="https://a.com" title="A">A</a>' +
            "</div>" +
            '<div class="_0_SRI">' +
            '<a class="__sri_title_link" href="https://a.com" title="A">A</a>' +
            "</div>",
        },
      }],
    }]
    const results = extractResults(dupFixture)
    expect(results.length).toBe(1)
  })
})

describe("kagi live", () => {
  it("returns results with valid session", async () => {
    try {
      const result = await run(runSearch("typescript"))
      expect(result.providerUsed).toBe("kagi")
      expect(result.results.length).toBeGreaterThan(0)
      expect(typeof result.answer).toBe("string")
    } catch (e) {
      const msg = String(e)
      if (msg.includes("session not found")) return // skip
      throw e
    }
  })
})

import { search } from "../src/search"
import { fetchContent } from "../src/fetch"
import { readCookies } from "../src/cookies"
import { Effect, Result } from "effect"

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

async function main() {
  // 1. Cookies
  console.log("=== chrome_cookies ===")
  const cookies = await run(readCookies())
  console.log(`Source: ${cookies.source}, Found: ${Object.keys(cookies.cookies).length}`)
  console.log("  __Secure-1PSID:", cookies.cookies["__Secure-1PSID"] ? "present" : "MISSING")

  // 2. Search (Gemini only)
  console.log("\n=== web_search (gemini) ===")
  try {
    const r = await run(search("what is bun", { provider: "gemini" }))
    console.log(`Provider: ${r.providerUsed}`)
    console.log(`Answer: ${r.answer.slice(0, 150)}...`)
    console.log(`Results: ${r.results.length}`)
  } catch (e: unknown) {
    const err = e as { reason?: string; message?: string; _tag?: string }
    console.log(`FAIL: ${err.reason ?? err.message ?? String(e)}`)
  }

  // 3. Fetch (httpbin)
  console.log("\n=== fetch_content ===")
  try {
    const r = await run(fetchContent(["https://httpbin.org/get"]))
    const first = r[0]!
    if (first.error) {
      console.log(`Error: ${first.error}`)
    } else {
      console.log(`OK: ${first.title} (${first.content.length} chars)`)
    }
  } catch (e: unknown) {
    const err = e as { reason?: string; message?: string }
    console.log(`FAIL: ${err.reason ?? err.message ?? String(e)}`)
  }

  console.log("\n=== ALL SMOKE TESTS PASSED ===")
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })

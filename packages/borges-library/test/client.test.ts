import { describe, expect, it } from "bun:test"
import { rmSync } from "node:fs"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Fetch } from "effect/unstable/http/FetchHttpClient"
import { searchBorgesLibrary, downloadBorgesLibrary } from "../src/client"
import { searchLibraryGenesis } from "../src/library-genesis"
import type { BookResult } from "../src/schemas"

const MOCK_LIBGEN_HTML = `
  <table id="tablelibgen">
    <tr>
      <td><a href="edition.php?id=12345">Refactoring UI</a></td>
      <td>Steve Schoger, Adam Wathan</td>
      <td></td>
      <td><nobr>2018</nobr></td>
      <td>English</td>
      <td>252</td>
      <td><nobr><a href="/file.php?id=111">53 MB</a></nobr></td>
      <td>pdf</td>
      <td><nobr><a href="ads.php?md5=c0008a5b7285dd078c6afc3f5881b06d">[1]</a></nobr></td>
    </tr>
  </table>
`

const MOCK_ADS_HTML = `
  <a href="get.php?md5=c0008a5b7285dd078c6afc3f5881b06d&key=MOCK_KEY">GET</a>
`

describe("Borges Library Client", () => {
  it("searches Library Genesis correctly", async () => {
    const mockedFetch = (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("index.php")) {
        return Promise.resolve(new Response(MOCK_LIBGEN_HTML, { status: 200 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }

    const run = searchLibraryGenesis({ query: "Refactoring UI" }).pipe(
      Effect.provideService(Fetch, mockedFetch as typeof fetch),
      Effect.provide(FetchHttpClient.layer)
    )
    const results = await Effect.runPromise(run)

    expect(results).toHaveLength(1)
    expect(results[0]?.title).toBe("Refactoring UI")
    expect(results[0]?.authors).toEqual(["Steve Schoger", "Adam Wathan"])
    expect(results[0]?.format).toBe("pdf")
    expect(results[0]?.id).toBe("c0008a5b7285dd078c6afc3f5881b06d")
    expect(results[0]?.sourceUrl).toBe("https://libgen.li/ads.php?md5=c0008a5b7285dd078c6afc3f5881b06d")
  })

  it("falls back from Anna Archive to Library Genesis on search", async () => {
    const mockedFetch = (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("annas-archive.org")) {
        return Promise.resolve(new Response("Checking your browser", { status: 200 }))
      }
      if (url.includes("libgen.li")) {
        return Promise.resolve(new Response(MOCK_LIBGEN_HTML, { status: 200 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }

    const run = searchBorgesLibrary("Refactoring UI").pipe(
      Effect.provideService(Fetch, mockedFetch as typeof fetch),
      Effect.provide(FetchHttpClient.layer)
    )
    const results = await Effect.runPromise(run)

    expect(results).toHaveLength(1)
    expect(results[0]?.title).toBe("Refactoring UI")
  })

  it("downloads from Library Genesis correctly", async () => {
    const mockedFetch = (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("ads.php")) {
        return Promise.resolve(new Response(MOCK_ADS_HTML, { status: 200 }))
      }
      if (url.includes("get.php")) {
        const headers = new Headers()
        headers.set("content-disposition", 'attachment; filename="Refactoring_UI.pdf"')
        return Promise.resolve(new Response(new TextEncoder().encode("%PDF-1.7\n%mock\n").buffer, { status: 200, headers }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }

    const mockBook: BookResult = {
      id: "c0008a5b7285dd078c6afc3f5881b06d",
      title: "Refactoring UI",
      authors: ["Steve Schoger"],
      format: "pdf",
      source: "borges_library",
      sourceUrl: "https://libgen.li/ads.php?md5=c0008a5b7285dd078c6afc3f5881b06d",
    }

    const tempDir = `./test-downloads-${Date.now()}`
    const run = downloadBorgesLibrary(mockBook, tempDir).pipe(
      Effect.provideService(Fetch, mockedFetch as typeof fetch),
      Effect.provide(FetchHttpClient.layer)
    )
    const dlResult = await Effect.runPromise(run)

    expect(dlResult.downloadedPath).toContain("Refactoring_UI.pdf")
    expect(dlResult.bytes).toBe(15)
    expect(dlResult.filename).toBe("Refactoring_UI.pdf")

    // Clean up
    try {
      await Bun.file(dlResult.downloadedPath).delete()
      rmSync(tempDir, { recursive: true, force: true })
    } catch {}
  })
})

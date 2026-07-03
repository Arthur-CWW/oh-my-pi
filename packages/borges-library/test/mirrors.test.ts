import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Fetch } from "effect/unstable/http/FetchHttpClient"
import {
  extractOpenSlumMirrors,
  isChallengeOrErrorHtml,
  parseOpenSlumPreloadData,
  rankMirrorCandidates,
  type MirrorCandidate,
} from "../src/mirrors"
import { searchLibraryGenesis } from "../src/library-genesis"

const OPEN_SLUM_HTML = `
  <script>
    window.preloadData = {'publicGroupList':[
      {'name':'Anna\\xA0Archive','monitorList':[
        {'name':'Anna GD','url':'https://annas-archive.gd/','validCert':true,'certExpiryDaysRemaining':57}
      ]},
      {'name':'Library Genesis+ (beware of popups)','monitorList':[
        {'name':'Libgen LA','url':'https://libgen.la/','validCert':true,'certExpiryDaysRemaining':63},
        {'name':'Libgen Old','url':'http://libgen.old/','validCert':false,'certExpiryDaysRemaining':1},
        {'name':'Duplicate LA','url':'https://libgen.la','validCert':true,'certExpiryDaysRemaining':12}
      ]}
    ]};
  </script>
`

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

describe("OpenSLUM mirror discovery", () => {
  it("parses preload data and ranks HTTPS valid-cert mirrors", () => {
    const mirrors = extractOpenSlumMirrors(parseOpenSlumPreloadData(OPEN_SLUM_HTML))

    expect(mirrors.map((mirror) => mirror.url)).toContain("https://annas-archive.gd")
    expect(mirrors.map((mirror) => mirror.url)).toContain("https://libgen.la")
    expect(mirrors.map((mirror) => mirror.url)).toContain("http://libgen.old")
    expect(mirrors.indexOf(mirrors.find((mirror) => mirror.url === "https://libgen.la")!)).toBeLessThan(
      mirrors.indexOf(mirrors.find((mirror) => mirror.url === "http://libgen.old")!),
    )
    expect(mirrors.find((mirror) => mirror.url === "https://libgen.la")?.group).toBe("libgen")
  })

  it("can restrict extracted mirrors to a requested group", () => {
    const mirrors = extractOpenSlumMirrors(parseOpenSlumPreloadData(OPEN_SLUM_HTML), ["libgen"])

    expect(mirrors).toHaveLength(2)
    expect(mirrors.every((mirror) => mirror.group === "libgen")).toBe(true)
  })

  it("orders HTTPS valid-cert mirrors by certificate strength before weaker candidates", () => {
    const candidates: MirrorCandidate[] = [
      { group: "libgen", name: "HTTP valid", url: "http://valid.example", validCert: true, certExpiryDaysRemaining: 365, source: "open-slum" },
      { group: "libgen", name: "HTTPS invalid", url: "https://invalid.example", validCert: false, certExpiryDaysRemaining: 365, source: "open-slum" },
      { group: "libgen", name: "HTTPS valid short", url: "https://valid-short.example", validCert: true, certExpiryDaysRemaining: 5, source: "open-slum" },
      { group: "libgen", name: "HTTPS valid long", url: "https://valid-long.example", validCert: true, certExpiryDaysRemaining: 90, source: "open-slum" },
    ]

    expect(rankMirrorCandidates(candidates).map((candidate) => candidate.name)).toEqual([
      "HTTPS valid long",
      "HTTPS valid short",
      "HTTPS invalid",
      "HTTP valid",
    ])
  })

  it("detects CAPTCHA/challenge and error pages without browser bypass", () => {
    expect(isChallengeOrErrorHtml("<title>Checking your browser before accessing</title>")).toBe(true)
    expect(isChallengeOrErrorHtml("<html><body>Access denied</body></html>", 403)).toBe(true)
    expect(isChallengeOrErrorHtml("<table id=\"tablelibgen\"><tr><td>Book</td></tr></table>", 200)).toBe(false)
  })

  it("fails over from a challenge page to an OpenSLUM-discovered LibGen mirror", async () => {
    const mockedFetch = (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "https://open-slum.org/") {
        return Promise.resolve(new Response(OPEN_SLUM_HTML, { status: 200 }))
      }
      if (url.startsWith("https://libgen.li/")) {
        return Promise.resolve(new Response("<html>Checking your browser cf-browser-verify</html>", { status: 200 }))
      }
      if (url.startsWith("https://libgen.la/")) {
        return Promise.resolve(new Response(MOCK_LIBGEN_HTML, { status: 200 }))
      }
      return Promise.resolve(new Response("", { status: 404 }))
    }

    const run = searchLibraryGenesis({ query: "Refactoring UI", mirrorDiscovery: true, retries: 0 }).pipe(
      Effect.provideService(Fetch, mockedFetch as typeof fetch),
      Effect.provide(FetchHttpClient.layer),
    )
    const results = await Effect.runPromise(run)

    expect(results).toHaveLength(1)
    expect(results[0]?.sourceUrl).toBe("https://libgen.la/ads.php?md5=c0008a5b7285dd078c6afc3f5881b06d")
  })
})

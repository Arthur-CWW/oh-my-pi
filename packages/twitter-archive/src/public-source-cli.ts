import {
  PublicSourceCache,
  createApiSource,
  createNitterSource,
  createRssSource,
  createSyndicationSource,
  seedPublicSourceHandles,
  syncPublicSources,
  type PublicSourceAdapter,
  type PublicSourceTier,
} from "./public-source"

interface ParsedArgs { command: string; flags: ReadonlyMap<string, string | boolean> }
const DEFAULT_DB_PATH = "data/twitter-public-sources.sqlite"

async function main(): Promise<void> {
  const { command, flags } = parseArgs(Bun.argv.slice(2))
  const cache = new PublicSourceCache(stringFlag(flags, "db") ?? DEFAULT_DB_PATH)
  try {
    if (command === "sync") await runSync(cache, flags)
    else if (command === "import") await runImport(cache, flags)
    else if (command === "search") runSearch(cache, flags)
    else if (command === "analyze" || command === "report") runAnalysis(cache, flags)
    else throw new Error("Usage: public-source <sync|import|search|analyze|report> [--db path] [flags]")
  } finally { cache.close() }
}

async function runSync(cache: PublicSourceCache, flags: ReadonlyMap<string, string | boolean>): Promise<void> {
  const adapters = sourceAdapters(flags)
  if (!adapters.length) throw new Error("sync requires at least one --rss, --nitter, --syndication, or --api endpoint")
  const result = await syncPublicSources(cache, adapters, {
    handles: seedPublicSourceHandles(csvFlag(flags, "handles")), cadence: flags.get("daily") ? "daily" : "hourly",
    force: flags.get("force") === true,
  })
  console.log(JSON.stringify(result, null, 2))
}

async function runImport(cache: PublicSourceCache, flags: ReadonlyMap<string, string | boolean>): Promise<void> {
  const file = stringFlag(flags, "file")
  if (!file) throw new Error("import requires --file <records.json>")
  const inserted = cache.importJson(await Bun.file(file).text(), stringFlag(flags, "source-url") ?? `file:${file}`)
  console.log(JSON.stringify({ inserted }))
}

function runSearch(cache: PublicSourceCache, flags: ReadonlyMap<string, string | boolean>): void {
  const records = cache.search({
    handles: csvFlag(flags, "handles"), handle: stringFlag(flags, "handle"), query: stringFlag(flags, "query") ?? stringFlag(flags, "q"),
    since: stringFlag(flags, "since"), until: stringFlag(flags, "until"), limit: numberFlag(flags, "limit"),
  })
  console.log(JSON.stringify(records, null, 2))
}

function runAnalysis(cache: PublicSourceCache, flags: ReadonlyMap<string, string | boolean>): void {
  const rows = cache.analyze({ handles: seedPublicSourceHandles(csvFlag(flags, "handles")), query: stringFlag(flags, "query") ?? stringFlag(flags, "q"), since: stringFlag(flags, "since"), until: stringFlag(flags, "until") })
  if (flags.get("json") === true) { console.log(JSON.stringify(rows, null, 2)); return }
  const tiers: PublicSourceTier[] = ["Primary", "Topic lists", "Archive/mute candidates"]
  for (const tier of tiers) {
    console.log(`\n${tier}`)
    for (const row of rows.filter(item => item.tier === tier)) console.log(`@${row.handle}\t${row.recordCount} records\t${row.activeDays} active days\tlatest ${row.latestTimestamp ?? "never"}`)
  }
}

function sourceAdapters(flags: ReadonlyMap<string, string | boolean>): PublicSourceAdapter[] {
  const adapters: PublicSourceAdapter[] = []
  const rss = stringFlag(flags, "rss"); if (rss) adapters.push(createRssSource("rss", rss))
  const nitter = stringFlag(flags, "nitter"); if (nitter) adapters.push(createNitterSource("nitter", nitter))
  const syndication = stringFlag(flags, "syndication"); if (syndication) adapters.push(createSyndicationSource("syndication", syndication))
  const api = stringFlag(flags, "api"); if (api) adapters.push(createApiSource("api", api))
  return adapters
}
function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command = "", ...rest] = argv.filter(arg => arg !== "--"); const flags = new Map<string, string | boolean>()
  for (let index = 0; index < rest.length; index++) { const token = rest[index]; if (!token?.startsWith("--")) continue; const next = rest[index + 1]; if (!next || next.startsWith("--")) flags.set(token.slice(2), true); else { flags.set(token.slice(2), next); index++ } }
  return { command, flags }
}
function stringFlag(flags: ReadonlyMap<string, string | boolean>, name: string): string | undefined { const value = flags.get(name); return typeof value === "string" && value.length ? value : undefined }
function csvFlag(flags: ReadonlyMap<string, string | boolean>, name: string): string[] { return (stringFlag(flags, name) ?? "").split(",").map(value => value.trim()).filter(Boolean) }
function numberFlag(flags: ReadonlyMap<string, string | boolean>, name: string): number | undefined { const parsed = Number(stringFlag(flags, name)); return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined }

main().catch((error: Error) => { console.error(error.message); process.exitCode = 1 })

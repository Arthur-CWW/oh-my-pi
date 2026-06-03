#!/usr/bin/env bun
import { Effect } from "effect"
import { runSearch as kagiSearch, refreshSession } from "./kagi"
import { search } from "./search"
import { type SearchResponse, toErrorMessage } from "./schemas"

type Provider = "kagi" | "gemini" | "fallback"

interface CliOptions {
  provider: Provider
  json: boolean
  limit: number
  refreshSession: boolean
  query: string
}

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

function printHelp(): void {
  console.log(`Usage: pi-web-search [options] <query>

Search using Kagi from your local Firefox session by default.

Options:
  -p, --provider <kagi|gemini|fallback>  Search provider (default: kagi)
      --refresh-session                  Re-read and cache the Kagi token first
      --json                             Print JSON
  -n, --limit <number>                   Max results to print (default: 10)
  -h, --help                             Show this help

Examples:
  pi-web-search "typescript effect docs"
  pi-web-search --refresh-session "latest bun release"
  bun run kagi-search "typescript effect docs"
  bun run search -- --provider fallback "latest bun release"`)
}

function parseArgs(argv: string[]): CliOptions {
  let provider: Provider = "kagi"
  let json = false
  let limit = 10
  let shouldRefreshSession = false
  const queryParts: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--") {
      queryParts.push(...argv.slice(i + 1))
      break
    }
    if (arg === "-h" || arg === "--help") {
      printHelp()
      process.exit(0)
    }
    if (arg === "--json") {
      json = true
      continue
    }
    if (arg === "--refresh-session") {
      shouldRefreshSession = true
      continue
    }
    if (arg === "-p" || arg === "--provider") {
      const value = argv[++i]
      if (value !== "kagi" && value !== "gemini" && value !== "fallback") {
        throw new Error("--provider must be one of: kagi, gemini, fallback")
      }
      provider = value
      continue
    }
    if (arg.startsWith("--provider=")) {
      const value = arg.slice("--provider=".length)
      if (value !== "kagi" && value !== "gemini" && value !== "fallback") {
        throw new Error("--provider must be one of: kagi, gemini, fallback")
      }
      provider = value
      continue
    }
    if (arg === "-n" || arg === "--limit") {
      const value = Number(argv[++i])
      if (!Number.isFinite(value) || value < 1) throw new Error("--limit must be a positive number")
      limit = Math.floor(value)
      continue
    }
    if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length))
      if (!Number.isFinite(value) || value < 1) throw new Error("--limit must be a positive number")
      limit = Math.floor(value)
      continue
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`)
    queryParts.push(arg)
  }

  return {
    provider,
    json,
    limit,
    refreshSession: shouldRefreshSession,
    query: queryParts.join(" ").trim(),
  }
}

async function executeSearch(opts: CliOptions): Promise<SearchResponse> {
  if (opts.refreshSession) {
    const path = await refreshSession()
    console.error(`Refreshed Kagi session: ${path}`)
  }

  if (opts.provider === "kagi") return run(kagiSearch(opts.query))
  if (opts.provider === "gemini") return run(search(opts.query, { provider: "gemini" }))
  return run(search(opts.query))
}

function printText(result: SearchResponse, query: string, limit: number): void {
  console.log(`# ${query}\n`)
  console.log(`Provider: ${result.providerUsed}\n`)
  if (result.answer) console.log(`${result.answer}\n`)

  const results = result.results.slice(0, limit)
  if (!results.length) {
    console.log("No results.")
    return
  }

  console.log("## Results\n")
  for (const [index, item] of results.entries()) {
    console.log(`${index + 1}. ${item.title}`)
    console.log(`   ${item.url}`)
    if (item.snippet) console.log(`   ${item.snippet}`)
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.query) {
    printHelp()
    process.exit(1)
  }

  const result = await executeSearch(opts)
  if (opts.json) {
    console.log(JSON.stringify({ ...result, results: result.results.slice(0, opts.limit) }, null, 2))
  } else {
    printText(result, opts.query, opts.limit)
  }
}

main().catch((err) => {
  console.error(`Search failed: ${toErrorMessage(err)}`)
  process.exit(1)
})

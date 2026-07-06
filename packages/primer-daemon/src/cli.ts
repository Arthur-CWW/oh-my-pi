import { askEvidence, recentEvidence, searchEvidence, SUBSTRATES, type EvidenceSet } from "./evidence"
import { runCardCommand, runNoteCommand, runProgressCommand } from "./ledger-cli"
import { resolveDaemonPaths, type DaemonPaths } from "./paths"
import type { EvidenceHit, EvidenceSource } from "./schema"

export const USAGE = `Usage:
  primer search <terms...> [--limit N] [--source browser|twitter|reader|cards] [--json]
  primer ask "<question>" [--limit N] [--json]
  primer recent [--days N] [--limit N] [--json]
  primer note <add|list> [options]
  primer card <add|list> [options]
  primer progress <add|list> [options]
`

const DEFAULT_SEARCH_LIMIT = 30
const DEFAULT_RECENT_DAYS = 2
const DEFAULT_RECENT_LIMIT = 25

const STOPWORDS: Partial<Record<string, true>> = {
  a: true,
  about: true,
  above: true,
  after: true,
  again: true,
  against: true,
  all: true,
  am: true,
  an: true,
  and: true,
  any: true,
  are: true,
  aren: true,
  around: true,
  as: true,
  ask: true,
  at: true,
  be: true,
  because: true,
  been: true,
  before: true,
  being: true,
  below: true,
  between: true,
  both: true,
  but: true,
  by: true,
  can: true,
  could: true,
  dare: true,
  did: true,
  do: true,
  does: true,
  doing: true,
  don: true,
  down: true,
  during: true,
  each: true,
  few: true,
  for: true,
  from: true,
  further: true,
  had: true,
  has: true,
  have: true,
  having: true,
  he: true,
  her: true,
  here: true,
  hers: true,
  herself: true,
  him: true,
  himself: true,
  his: true,
  how: true,
  i: true,
  if: true,
  in: true,
  into: true,
  is: true,
  it: true,
  its: true,
  itself: true,
  just: true,
  let: true,
  may: true,
  me: true,
  might: true,
  more: true,
  most: true,
  must: true,
  my: true,
  myself: true,
  need: true,
  no: true,
  nor: true,
  not: true,
  now: true,
  of: true,
  off: true,
  on: true,
  once: true,
  only: true,
  or: true,
  other: true,
  ought: true,
  our: true,
  ours: true,
  ourselves: true,
  out: true,
  over: true,
  own: true,
  read: true,
  reading: true,
  reads: true,
  s: true,
  same: true,
  shall: true,
  she: true,
  should: true,
  so: true,
  some: true,
  such: true,
  t: true,
  tell: true,
  than: true,
  that: true,
  the: true,
  their: true,
  theirs: true,
  them: true,
  themselves: true,
  then: true,
  there: true,
  these: true,
  they: true,
  this: true,
  those: true,
  through: true,
  to: true,
  too: true,
  under: true,
  until: true,
  up: true,
  very: true,
  was: true,
  we: true,
  were: true,
  what: true,
  when: true,
  where: true,
  which: true,
  while: true,
  who: true,
  whom: true,
  why: true,
  will: true,
  with: true,
  would: true,
  you: true,
  your: true,
  yours: true,
  yourself: true,
  yourselves: true,
}

type FlagKind = "boolean" | "value"
type FlagValue = string | true

interface ParsedArgs {
  positionals: string[]
  flags: Map<string, FlagValue>
}


export function extractTerms(question: string): string[] {
  const terms: string[] = []
  let cursor = 0
  let unquoted = ""
  const phrasePattern = /"([^"]+)"|'([^']+)'/g

  for (const match of question.matchAll(phrasePattern)) {
    const index = match.index ?? cursor
    unquoted += question.slice(cursor, index)
    const phrase = normalizePhrase(match[1] ?? match[2] ?? "")
    if (phrase.length >= 3) pushUnique(terms, phrase)
    cursor = index + match[0].length
  }

  unquoted += question.slice(cursor)
  for (const token of normalizeUnquoted(unquoted)) {
    if (token.length >= 3 && STOPWORDS[token] !== true) pushUnique(terms, token)
  }

  return terms
}

export async function runCli(argv: readonly string[], env: Record<string, string | undefined> = process.env): Promise<number> {
  const command = argv[0]
  const paths = resolveDaemonPaths(env)

  if (command === "search") return runSearchCommand(argv.slice(1), paths)
  if (command === "ask") return runAskCommand(argv.slice(1), paths)
  if (command === "recent") return runRecentCommand(argv.slice(1), paths)
  if (command === "note") return runNoteCommand(argv.slice(1), paths)
  if (command === "card") return runCardCommand(argv.slice(1), paths)
  if (command === "progress") return runProgressCommand(argv.slice(1), paths)

  process.stderr.write(USAGE)
  return 2
}

function runSearchCommand(argv: readonly string[], paths: DaemonPaths): number {
  const parsed = parseArgs(argv, { limit: "value", source: "value", json: "boolean" })
  if (parsed === null || parsed.positionals.length === 0) return usageError()

  const limit = parsePositiveInteger(parsed.flags.get("limit"), DEFAULT_SEARCH_LIMIT)
  const source = parseSource(parsed.flags.get("source"))
  if (limit === null || source === null) return usageError()

  const evidence = searchEvidence(paths, parsed.positionals, source, limit)
  writeSkipped(evidence.skipped)
  if (parsed.flags.has("json")) {
    writeJson(evidence.hits)
  } else {
    writeHumanHits(evidence.hits)
  }
  return 0
}

function runAskCommand(argv: readonly string[], paths: DaemonPaths): number {
  const parsed = parseArgs(argv, { limit: "value", json: "boolean" })
  if (parsed === null || parsed.positionals.length === 0) return usageError()

  const limit = parsePositiveInteger(parsed.flags.get("limit"), DEFAULT_SEARCH_LIMIT)
  if (limit === null) return usageError()

  const question = parsed.positionals.join(" ")
  const terms = extractTerms(question)
  if (terms.length === 0) return usageError()

  const evidence = askEvidence(paths, terms, limit)
  if (parsed.flags.has("json")) {
    writeSkipped(evidence.skipped)
    writeJson(evidence.hits)
  } else {
    writeEvidencePack(question, terms, evidence)
  }
  return 0
}

function runRecentCommand(argv: readonly string[], paths: DaemonPaths): number {
  const parsed = parseArgs(argv, { days: "value", limit: "value", json: "boolean" })
  if (parsed === null || parsed.positionals.length > 0) return usageError()

  const days = parsePositiveInteger(parsed.flags.get("days"), DEFAULT_RECENT_DAYS)
  const limit = parsePositiveInteger(parsed.flags.get("limit"), DEFAULT_RECENT_LIMIT)
  if (days === null || limit === null) return usageError()

  const evidence = recentEvidence(paths, days, limit)
  writeSkipped(evidence.skipped)
  if (parsed.flags.has("json")) {
    writeJson(evidence.hits)
  } else {
    writeHumanHits(evidence.hits)
  }
  return 0
}


function parseArgs(argv: readonly string[], spec: Record<string, FlagKind>): ParsedArgs | null {
  const positionals: string[] = []
  const flags = new Map<string, FlagValue>()

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }

    const equalsIndex = arg.indexOf("=")
    const name = equalsIndex === -1 ? arg.slice(2) : arg.slice(2, equalsIndex)
    const kind = spec[name]
    if (kind === undefined || name.length === 0) return null

    if (kind === "boolean") {
      if (equalsIndex !== -1) return null
      flags.set(name, true)
      continue
    }

    if (equalsIndex !== -1) {
      const value = arg.slice(equalsIndex + 1)
      if (value.length === 0) return null
      flags.set(name, value)
      continue
    }

    const value = argv[index + 1]
    if (value === undefined || value.startsWith("--")) return null
    flags.set(name, value)
    index += 1
  }

  return { positionals, flags }
}

function parsePositiveInteger(value: FlagValue | undefined, fallback: number): number | null {
  if (value === undefined) return fallback
  if (value === true) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return null
  return parsed
}

function parseSource(value: FlagValue | undefined): EvidenceSource | undefined | null {
  if (value === undefined) return undefined
  if (value === true) return null
  if (value === "browser" || value === "twitter" || value === "reader" || value === "cards") return value
  return null
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeUnquoted(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0)
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value)
}


function writeHumanHits(hits: readonly EvidenceHit[]): void {
  if (hits.length === 0) {
    process.stdout.write("No hits.\n")
    return
  }

  for (const hit of hits) {
    process.stdout.write(formatHitLine(hit))
    if (hit.snippet !== null && hit.snippet.length > 0) process.stdout.write(`\n  ${hit.snippet}`)
    process.stdout.write("\n")
  }
}

function writeEvidencePack(question: string, terms: readonly string[], evidence: EvidenceSet): void {
  const lines: string[] = [
    "# EVIDENCE PACK",
    "",
    `Question: ${question}`,
    `Terms: ${terms.join(", ")}`,
    "",
  ]

  if (evidence.hits.length === 0) {
    lines.push("No evidence hits.", "")
  } else {
    for (const substrate of SUBSTRATES) {
      const hits = evidence.hits.filter((hit) => hit.source === substrate)
      if (hits.length === 0) continue
      lines.push(`### ${substrate}`, "")
      for (const hit of hits) {
        lines.push(`- **${hit.ref}** — ${hit.title} — ${hit.url ?? ""} (${hit.timestamp ?? ""})`)
        if (hit.snippet !== null && hit.snippet.length > 0) lines.push(`  ${hit.snippet}`)
      }
      lines.push("")
    }
  }

  if (evidence.skipped.length > 0) {
    lines.push("### Skipped substrates", "")
    for (const skipped of evidence.skipped) lines.push(`- ${skipped}`)
    lines.push("")
  }

  lines.push(`Rerun: \`bun packages/primer-daemon/src/cli.ts ask "${escapeDoubleQuoted(question)}"\``)
  process.stdout.write(`${lines.join("\n")}\n`)
}

function formatHitLine(hit: EvidenceHit): string {
  return `[${hit.source}/${hit.kind}] ${hit.title} — ${hit.url ?? ""} (${hit.timestamp ?? ""}) ${hit.ref}`
}

function writeSkipped(skipped: readonly string[]): void {
  for (const entry of skipped) process.stderr.write(`Skipped: ${entry}\n`)
}

function writeJson(hits: readonly EvidenceHit[]): void {
  process.stdout.write(`${JSON.stringify(hits, null, 2)}\n`)
}

function usageError(): number {
  process.stderr.write(USAGE)
  return 2
}


function escapeDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

if (import.meta.main) {
  const exitCode = await runCli(process.argv.slice(2))
  process.exit(exitCode)
}

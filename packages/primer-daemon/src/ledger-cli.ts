import type { DaemonPaths } from "./paths"
import { addCard, addNote, addProgress, listCards, listNotes, listProgress, openLedger, type CardInput, type NoteInput, type ProgressInput } from "./ledger"

type FlagValue = string | boolean | string[]

interface ParsedArgs {
  positionals: string[]
  flags: Record<string, FlagValue>
}

const NOTE_COMMAND_USAGE = "Usage: primer note <add|list> [options]"
const NOTE_ADD_USAGE = "Usage: primer note add --question Q --body B [--source ref|url|title]..."
const NOTE_LIST_USAGE = "Usage: primer note list [--limit N] [--json]"
const CARD_COMMAND_USAGE = "Usage: primer card <add|list> [options]"
const CARD_ADD_USAGE = "Usage: primer card add --front F --back B [--source-ref R] [--url U]"
const CARD_LIST_USAGE = "Usage: primer card list [--limit N] [--json]"
const PROGRESS_COMMAND_USAGE = "Usage: primer progress <add|list> [options]"
const PROGRESS_ADD_USAGE = "Usage: primer progress add --kind K --title T [--body B] [--ref R]..."
const PROGRESS_LIST_USAGE = "Usage: primer progress list [--limit N] [--json]"
const DEFAULT_LIMIT = 20

const NOTE_ADD_FLAGS: Record<string, true> = { question: true, body: true, source: true }
const NOTE_LIST_FLAGS: Record<string, true> = { limit: true, json: true }
const CARD_ADD_FLAGS: Record<string, true> = { front: true, back: true, "source-ref": true, url: true }
const CARD_LIST_FLAGS: Record<string, true> = { limit: true, json: true }
const PROGRESS_ADD_FLAGS: Record<string, true> = { kind: true, title: true, body: true, ref: true }
const PROGRESS_LIST_FLAGS: Record<string, true> = { limit: true, json: true }

export async function runNoteCommand(argv: string[], paths: DaemonPaths): Promise<number> {
  const parsed = parseArgs(argv)
  const subcommand = parsed.positionals[0]
  if (subcommand === "add") {
    if (parsed.positionals.length !== 1 || !hasOnlyAllowedFlags(parsed.flags, NOTE_ADD_FLAGS)) {
      process.stderr.write(`${NOTE_ADD_USAGE}\n`)
      return 2
    }

    const questionValue = parsed.flags.question
    const bodyValue = parsed.flags.body
    if (typeof questionValue !== "string" || typeof bodyValue !== "string") {
      process.stderr.write(`${NOTE_ADD_USAGE}\n`)
      return 2
    }

    const sourceValues = repeatedStringFlag(parsed.flags.source)
    if (sourceValues === null) {
      process.stderr.write(`${NOTE_ADD_USAGE}\n`)
      return 2
    }
    const sources: NoteInput["sources"] = []
    for (const value of sourceValues) {
      const source = parseNoteSource(value)
      if (!source) {
        process.stderr.write(`${NOTE_ADD_USAGE}\n`)
        return 2
      }
      sources.push(source)
    }

    const db = openLedger(paths.ledgerDb)
    try {
      const result = addNote(db, { question: questionValue, body: bodyValue, sources })
      process.stdout.write(`note ${result.id}\n`)
      return 0
    } finally {
      db.close()
    }
  }

  if (subcommand === "list") {
    if (parsed.positionals.length !== 1 || !hasOnlyAllowedFlags(parsed.flags, NOTE_LIST_FLAGS) || (parsed.flags.json !== undefined && parsed.flags.json !== true)) {
      process.stderr.write(`${NOTE_LIST_USAGE}\n`)
      return 2
    }

    const limit = parseLimitFlag(parsed.flags.limit)
    if (limit === null) {
      process.stderr.write(`${NOTE_LIST_USAGE}\n`)
      return 2
    }

    const db = openLedger(paths.ledgerDb)
    try {
      const rows = listNotes(db, limit)
      if (parsed.flags.json === true) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
        return 0
      }
      for (const row of rows) {
        process.stdout.write(`#${row.id} ${row.question} — ${row.body} (${row.sources.length} sources)\n`)
      }
      return 0
    } finally {
      db.close()
    }
  }

  process.stderr.write(`${NOTE_COMMAND_USAGE}\n`)
  return 2
}

export async function runCardCommand(argv: string[], paths: DaemonPaths): Promise<number> {
  const parsed = parseArgs(argv)
  const subcommand = parsed.positionals[0]
  if (subcommand === "add") {
    if (parsed.positionals.length !== 1 || !hasOnlyAllowedFlags(parsed.flags, CARD_ADD_FLAGS)) {
      process.stderr.write(`${CARD_ADD_USAGE}\n`)
      return 2
    }

    const frontValue = parsed.flags.front
    const backValue = parsed.flags.back
    const sourceRefValue = parsed.flags["source-ref"]
    const urlValue = parsed.flags.url
    if (
      typeof frontValue !== "string" ||
      typeof backValue !== "string" ||
      (sourceRefValue !== undefined && typeof sourceRefValue !== "string") ||
      (urlValue !== undefined && typeof urlValue !== "string")
    ) {
      process.stderr.write(`${CARD_ADD_USAGE}\n`)
      return 2
    }

    const input: CardInput = { front: frontValue, back: backValue }
    if (typeof sourceRefValue === "string") input.sourceRef = sourceRefValue
    if (typeof urlValue === "string") input.url = urlValue

    const db = openLedger(paths.ledgerDb)
    try {
      const result = addCard(db, input)
      process.stdout.write(`card ${result.id}\n`)
      return 0
    } finally {
      db.close()
    }
  }

  if (subcommand === "list") {
    if (parsed.positionals.length !== 1 || !hasOnlyAllowedFlags(parsed.flags, CARD_LIST_FLAGS) || (parsed.flags.json !== undefined && parsed.flags.json !== true)) {
      process.stderr.write(`${CARD_LIST_USAGE}\n`)
      return 2
    }

    const limit = parseLimitFlag(parsed.flags.limit)
    if (limit === null) {
      process.stderr.write(`${CARD_LIST_USAGE}\n`)
      return 2
    }

    const db = openLedger(paths.ledgerDb)
    try {
      const rows = listCards(db, limit)
      if (parsed.flags.json === true) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
        return 0
      }
      for (const row of rows) {
        process.stdout.write(`#${row.id} [${row.status}] ${row.front} — ${row.back}\n`)
      }
      return 0
    } finally {
      db.close()
    }
  }

  process.stderr.write(`${CARD_COMMAND_USAGE}\n`)
  return 2
}

export async function runProgressCommand(argv: string[], paths: DaemonPaths): Promise<number> {
  const parsed = parseArgs(argv)
  const subcommand = parsed.positionals[0]
  if (subcommand === "add") {
    if (parsed.positionals.length !== 1 || !hasOnlyAllowedFlags(parsed.flags, PROGRESS_ADD_FLAGS)) {
      process.stderr.write(`${PROGRESS_ADD_USAGE}\n`)
      return 2
    }

    const kindValue = parsed.flags.kind
    const titleValue = parsed.flags.title
    const bodyValue = parsed.flags.body
    if (
      typeof kindValue !== "string" ||
      typeof titleValue !== "string" ||
      (bodyValue !== undefined && typeof bodyValue !== "string")
    ) {
      process.stderr.write(`${PROGRESS_ADD_USAGE}\n`)
      return 2
    }

    const refs = repeatedStringFlag(parsed.flags.ref)
    if (refs === null) {
      process.stderr.write(`${PROGRESS_ADD_USAGE}\n`)
      return 2
    }

    const input: ProgressInput = { kind: kindValue, title: titleValue }
    if (typeof bodyValue === "string") input.body = bodyValue
    if (refs.length > 0) input.refs = refs

    const db = openLedger(paths.ledgerDb)
    try {
      const row = addProgress(db, input)
      process.stdout.write(`progress ${row.id}\n`)
      return 0
    } finally {
      db.close()
    }
  }

  if (subcommand === "list") {
    if (parsed.positionals.length !== 1 || !hasOnlyAllowedFlags(parsed.flags, PROGRESS_LIST_FLAGS) || (parsed.flags.json !== undefined && parsed.flags.json !== true)) {
      process.stderr.write(`${PROGRESS_LIST_USAGE}\n`)
      return 2
    }

    const limit = parseLimitFlag(parsed.flags.limit)
    if (limit === null) {
      process.stderr.write(`${PROGRESS_LIST_USAGE}\n`)
      return 2
    }

    const db = openLedger(paths.ledgerDb)
    try {
      const rows = listProgress(db, limit)
      if (parsed.flags.json === true) {
        process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`)
        return 0
      }
      for (const row of rows) {
        const body = row.body === null ? "" : ` — ${row.body}`
        const refs = row.refs.length === 0 ? "" : ` (${row.refs.join(", ")})`
        process.stdout.write(`#${row.id} [${row.kind}] ${row.title}${body}${refs}\n`)
      }
      return 0
    } finally {
      db.close()
    }
  }

  process.stderr.write(`${PROGRESS_COMMAND_USAGE}\n`)
  return 2
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, FlagValue> = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!
    if (!token.startsWith("--")) {
      positionals.push(token)
      continue
    }

    const withoutPrefix = token.slice(2)
    const equals = withoutPrefix.indexOf("=")
    if (equals >= 0) {
      setFlag(flags, withoutPrefix.slice(0, equals), withoutPrefix.slice(equals + 1))
      continue
    }

    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      setFlag(flags, withoutPrefix, next)
      index += 1
      continue
    }

    setFlag(flags, withoutPrefix, true)
  }

  return { positionals, flags }
}

function setFlag(flags: Record<string, FlagValue>, key: string, value: string | boolean): void {
  const previous = flags[key]
  if (typeof value === "string") {
    if (Array.isArray(previous)) {
      previous.push(value)
      return
    }
    if (typeof previous === "string") {
      flags[key] = [previous, value]
      return
    }
  }
  flags[key] = value
}

function hasOnlyAllowedFlags(flags: Record<string, FlagValue>, allowed: Record<string, true>): boolean {
  for (const key of Object.keys(flags)) {
    if (!allowed[key]) return false
  }
  return true
}

function repeatedStringFlag(value: FlagValue | undefined): string[] | null {
  if (value === undefined) return []
  if (typeof value === "string") return [value]
  if (!Array.isArray(value)) return null

  const values: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") return null
    values.push(entry)
  }
  return values
}

function parseNoteSource(value: string): NoteInput["sources"][number] | null {
  const fields = value.split("|")
  if (fields.length > 3) return null

  const [ref, url, title] = fields
  if (!ref) return null

  const source: NoteInput["sources"][number] = { ref }
  if (url) source.url = url
  if (title) source.title = title
  return source
}

function parseLimitFlag(value: FlagValue | undefined): number | null {
  if (value === undefined) return DEFAULT_LIMIT
  if (typeof value !== "string") return null

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1 || !Number.isInteger(parsed)) return null
  return parsed
}

#!/usr/bin/env bun
import {
  formatSessionList,
  formatSummary,
  getCockpitSummary,
  importZellijSnapshot,
  initCockpitDb,
  listEvents,
  listSessions,
  publishSession,
  recordEvent,
  saveWorkgroup,
  type CockpitSessionInput,
} from "./agent-cockpit"

interface ParsedArgs {
  flags: Record<string, string | boolean>
  positionals: string[]
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {}
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=")
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1)
        continue
      }
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith("--")) {
        flags[key] = next
        i += 1
      } else {
        flags[key] = true
      }
      continue
    }
    positionals.push(arg)
  }
  return { flags, positionals }
}

function flagString(flags: Record<string, string | boolean>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = flags[name]
    if (typeof value === "string") return value
  }
  return undefined
}

function flagNumber(flags: Record<string, string | boolean>, ...names: string[]): number | undefined {
  const raw = flagString(flags, ...names)
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}

function flagBool(flags: Record<string, string | boolean>, ...names: string[]): boolean {
  return names.some((name) => flags[name] === true || flags[name] === "true" || flags[name] === "1")
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const values = value.split(",").map((part) => part.trim()).filter(Boolean)
  return values.length ? values : undefined
}

function printHelp(): void {
  console.log(`pi-cockpit — local Pi/agent session cockpit prototype

Usage:
  pi-cockpit init [--db PATH]
  pi-cockpit publish [--id ID] [--title TEXT] [--status STATUS] [--workgroup ID]
                     [--role ROLE] [--objective TEXT] [--summary TEXT]
                     [--cwd PATH] [--session-file PATH] [--pane-id ID]
  pi-cockpit heartbeat [ID] [--status STATUS]
  pi-cockpit list [--json] [--all] [--workgroup ID] [--limit N]
  pi-cockpit summary [--json]
  pi-cockpit event TYPE [--session-id ID] [--workgroup ID] [--payload JSON]
  pi-cockpit workgroup ID [--title TEXT] [--objective TEXT] [--status STATUS]
  pi-cockpit zellij-snapshot [--session NAME] [--json]

Environment:
  PI_COCKPIT_DB       Override SQLite path

Default DB:
  ~/.local/share/pi-cockpit/cockpit.sqlite
`)
}

function commonOptions(flags: Record<string, string | boolean>): { dbPath?: string } {
  return { dbPath: flagString(flags, "db", "database") }
}

function inputFromFlags(flags: Record<string, string | boolean>): CockpitSessionInput {
  return {
    artifacts: splitCsv(flagString(flags, "artifacts")),
    branch: flagString(flags, "branch"),
    cwd: flagString(flags, "cwd"),
    id: flagString(flags, "id", "session-id"),
    kind: flagString(flags, "kind"),
    objective: flagString(flags, "objective"),
    paneId: flagString(flags, "pane-id"),
    paneTitle: flagString(flags, "pane-title"),
    pid: flagNumber(flags, "pid"),
    repo: flagString(flags, "repo"),
    role: flagString(flags, "role"),
    sessionFile: flagString(flags, "session-file"),
    status: flagString(flags, "status"),
    statusIcon: flagString(flags, "icon", "status-icon"),
    summary: flagString(flags, "summary"),
    tabId: flagString(flags, "tab-id"),
    tabName: flagString(flags, "tab-name"),
    tags: splitCsv(flagString(flags, "tags")),
    terminalBackend: flagString(flags, "terminal", "terminal-backend"),
    terminalSession: flagString(flags, "terminal-session"),
    title: flagString(flags, "title", "name"),
    transcriptPath: flagString(flags, "transcript", "transcript-path"),
    workgroupId: flagString(flags, "workgroup", "workgroup-id"),
    workgroupTitle: flagString(flags, "workgroup-title"),
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { flags, positionals } = parseArgs(argv)
  const command = positionals[0] ?? "help"
  const options = commonOptions(flags)

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp()
    return
  }

  if (command === "init") {
    const path = await initCockpitDb(options)
    console.log(path)
    return
  }

  if (command === "publish") {
    const record = await publishSession(inputFromFlags(flags), options)
    if (flagBool(flags, "json")) console.log(JSON.stringify(record, null, 2))
    else console.log(`${record.id} ${record.status} ${record.title}`)
    return
  }

  if (command === "heartbeat") {
    const id = positionals[1] ?? flagString(flags, "id", "session-id")
    if (!id) throw new Error("heartbeat requires an ID")
    const record = await publishSession({ id, status: flagString(flags, "status") }, options)
    if (flagBool(flags, "json")) console.log(JSON.stringify(record, null, 2))
    else console.log(`${record.id} ${record.status}`)
    return
  }

  if (command === "list" || command === "ls") {
    const sessions = await listSessions({
      ...options,
      includeExpired: flagBool(flags, "all", "include-expired"),
      limit: flagNumber(flags, "limit"),
      workgroupId: flagString(flags, "workgroup", "workgroup-id"),
    })
    if (flagBool(flags, "json")) console.log(JSON.stringify(sessions, null, 2))
    else console.log(formatSessionList(sessions))
    return
  }

  if (command === "summary") {
    const summary = await getCockpitSummary(options)
    if (flagBool(flags, "json")) console.log(JSON.stringify(summary, null, 2))
    else console.log(formatSummary(summary))
    return
  }

  if (command === "event") {
    const type = positionals[1]
    if (!type) throw new Error("event requires a TYPE")
    const payloadRaw = flagString(flags, "payload")
    const event = await recordEvent({
      payload: payloadRaw ? JSON.parse(payloadRaw) : {},
      sessionId: flagString(flags, "session", "session-id") ?? null,
      type,
      workgroupId: flagString(flags, "workgroup", "workgroup-id") ?? null,
    }, options)
    if (flagBool(flags, "json")) console.log(JSON.stringify(event, null, 2))
    else console.log(`${event.id} ${event.type}`)
    return
  }

  if (command === "events") {
    const events = await listEvents({
      ...options,
      limit: flagNumber(flags, "limit"),
      sessionId: flagString(flags, "session", "session-id"),
      workgroupId: flagString(flags, "workgroup", "workgroup-id"),
    })
    console.log(JSON.stringify(events, null, 2))
    return
  }

  if (command === "workgroup" || command === "wg") {
    const id = positionals[1] ?? flagString(flags, "id")
    if (!id) throw new Error("workgroup requires an ID")
    const workgroup = await saveWorkgroup({
      id,
      objective: flagString(flags, "objective"),
      status: flagString(flags, "status"),
      title: flagString(flags, "title", "name"),
    }, options)
    if (flagBool(flags, "json")) console.log(JSON.stringify(workgroup, null, 2))
    else console.log(`${workgroup.id} ${workgroup.title}`)
    return
  }

  if (command === "zellij-snapshot" || (command === "zellij" && positionals[1] === "snapshot")) {
    const snapshot = await importZellijSnapshot({
      ...options,
      session: flagString(flags, "session"),
      zellijBin: flagString(flags, "zellij-bin"),
    })
    if (flagBool(flags, "json")) console.log(JSON.stringify(snapshot, null, 2))
    else console.log(`saved ${snapshot.tabs.length} tab(s), ${snapshot.panes.length} pane(s)`)
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}

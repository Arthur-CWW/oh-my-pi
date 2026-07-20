import { mkdir, mkdtemp, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildLabelCommand,
  buildOverviewCommand,
  buildSummaryCommand,
  compressExcerpt,
  parseOverviewJson,
  parseSummaryOutput,
  parkIdleHoursFromEnv,
  renderIndex,
  renderStateDoc,
  runObserverPass,
  shouldObserve,
  type CommandResult,
  type ObserverPaths,
} from "../src/observe"

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "fleet-observer-test-"))
}

function pathsAt(root: string): ObserverPaths {
  const stateDocsDir = join(root, "state-docs")
  return {
    cursorPath: join(root, "data", "cursors.json"),
    errorLogPath: join(root, "data", "errors.log"),
    heartbeatPath: join(root, "data", "heartbeat"),
    stateDocsDir,
    indexPath: join(stateDocsDir, "INDEX.md"),
  }
}

function result(stdout = "", exitCode = 0, stderr = ""): CommandResult {
  return { stdout, stderr, exitCode }
}

describe("observer thresholds and cursors", () => {
  test("observes growth at the threshold, skips smaller growth, and observes a new peer without a summary", () => {
    const previous = { byteSize: 100, mtimeMs: 10 }
    expect(shouldObserve({ summary: "already summarized" }, previous, { byteSize: 200, mtimeMs: 20 }, 100)).toBe(true)
    expect(shouldObserve({ summary: "already summarized" }, previous, { byteSize: 199, mtimeMs: 20 }, 100)).toBe(false)
    expect(shouldObserve({ summary: "" }, undefined, { byteSize: 1, mtimeMs: 1 }, 65_536)).toBe(true)
  })

  test("does not call the LLM below threshold", async () => {
    const root = await tempRoot()
    const paths = pathsAt(root)
    const journal = join(root, "peer.jsonl")
    await writeFile(journal, '{"type":"message","message":{"role":"user","content":"unchanged"}}\n')
    const journalStat = await stat(journal)
    await mkdir(join(root, "data"), { recursive: true })
    await writeFile(paths.cursorPath, JSON.stringify({ peer: { byteSize: journalStat.size, mtimeMs: journalStat.mtimeMs } }))
    const mutableCalls: string[][] = []
    const runner = async (argv: readonly string[]): Promise<CommandResult> => {
      mutableCalls.push([...argv])
      if (argv.includes("overview")) {
        return result(JSON.stringify([{ session_id: "019f2783-4f07-7000-ac94-347ad8de223d", state: "working", session_journal: journal, summary: "stable", name: "Peer" }]))
      }
      throw new Error("LLM should not run")
    }
    const pass = await runObserverPass({ paths, thresholdBytes: 65_536, runCommand: runner })
    expect(pass.skipped).toBe(1)
    expect(mutableCalls).toHaveLength(1)
  })
})

test("compresses the last JSONL records into role/text lines and skips a truncated first line", () => {
  const excerpt = compressExcerpt([
    '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"finish the implementation"},{"type":"toolCall","name":"read","arguments":{"payload":"secret"}}]}}',
    '{"type":"message","message":{"role":"user","content":"please check the tests"}}',
    '{"type":"message","message":{"role":"assistant","content":"done"}',
  ])
  expect(excerpt).toContain("assistant: finish the implementation")
  expect(excerpt).toContain("user: please check the tests")
  expect(excerpt).not.toContain("secret")
  expect(excerpt).not.toContain("done")
})
test("keeps the newest compressed records when the excerpt exceeds its character budget", () => {
  const lines = [
    ...Array.from({ length: 40 }, (_, index) =>
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: `${index === 0 ? "head-marker" : `middle-${index}`} ${"x".repeat(300)}` },
      }),
    ),
    JSON.stringify({ type: "message", message: { role: "assistant", content: "tail-marker" } }),
  ]
  const excerpt = compressExcerpt(lines, 400)
  expect(excerpt).toContain("tail-marker")
  expect(excerpt).not.toContain("head-marker")
})


test("renders compact state docs and one-line index records", () => {
  const doc = renderStateDoc({
    sessionId: "peer-1",
    name: "Fleet Observer",
    state: "working",
    workstream: "harness",
    summary: "Refreshing fleet labels",
    journalPath: "/tmp/peer-1.jsonl",
    stamp: "2026-07-18T12:00:00.000Z",
  })
  expect(doc).toContain("What/why: Refreshing fleet labels")
  expect(doc).toContain("Status: working · Fresh: 2026-07-18T12:00:00.000Z")
  expect(doc).toContain("- History: history://peer-1")
  expect(doc.split("\n").filter(line => line.startsWith("Current") || line.startsWith("Recent") || line.startsWith("Next")).length).toBeLessThanOrEqual(15)
  const index = renderIndex([{ sessionId: "peer-1", name: "Fleet Observer", workstream: "harness", stamp: "2026-07-18T12:00:00.000Z" }])
  expect(index).toBe("- peer-1\tFleet Observer\tharness\t2026-07-18T12:00:00.000Z\n\n## Park candidates\n— none\n")
})

test("keeps journal layers distinct and adds decision and artifact sections", () => {
  const doc = renderStateDoc({
    sessionId: "peer-2",
    name: "Fleet Observer",
    state: "working",
    workstream: "harness",
    summary: "One shared summary",
    layers: {
      whatWhy: "One shared summary",
      approach: "Use the live fleet row",
      recent: "One shared summary",
      next: "Refresh the state document",
      decision: "Use the live fleet row",
      deferredWhy: "Awaiting review",
      blocker: "Awaiting review",
      revivalTrigger: "New journal evidence",
      artifacts: ["/tmp/proof.txt", "/tmp/proof.txt"],
    },
    journalPath: "/tmp/peer-2.jsonl",
    stamp: "2026-07-18T12:00:00.000Z",
  })
  expect(doc.match(/One shared summary/g)).toHaveLength(1)
  expect(doc).toContain("## L2 Decisions")
  expect(doc).toContain("## L3 Artifacts")
  expect(doc).toContain("  - /tmp/proof.txt")
  expect(doc).toContain("- Blocker: — none")
})
test("renders fixture layers once with live identity and L2/L3 fallbacks", async () => {
  const root = await tempRoot()
  const paths = pathsAt(root)
  const journal = join(root, "peer.jsonl")
  await writeFile(journal, '{"type":"message","message":{"role":"assistant","content":"fixture evidence"}}\n')
  const sessionId = "019f2b27-15f1-7000-8aa8-679d94ad06b1"
  const runner = async (argv: readonly string[]): Promise<CommandResult> => {
    if (argv.includes("overview")) {
      return result(JSON.stringify([{
        session_id: sessionId,
        name: "ambient-name",
        label: "Build Interactive Rig Comparison",
        workstream: "harness",
        state: "working",
        cwd: process.cwd(),
        session_journal: journal,
        summary: "",
      }]))
    }
    if (argv.includes("-p")) {
      return result([
        "SUMMARY: one evidence",
        "NAME: summarizer title must be ignored",
        "WORKSTREAM: stale",
        "WHAT_WHY: one evidence",
        "APPROACH: one evidence",
        "RECENT: one evidence",
        "NEXT: one evidence",
        "DECISION: one evidence",
        "DEFERRED_WHY:",
        "BLOCKER:",
        "REVIVAL_TRIGGER:",
        "ARTIFACTS:",
      ].join("\n"))
    }
    return result()
  }
  const pass = await runObserverPass({ paths, model: "fixture-model", thresholdBytes: 0, runCommand: runner })
  expect(pass.observed).toBe(1)
  const doc = await readFile(join(paths.stateDocsDir, `${sessionId}.md`), "utf8")
  expect(doc).toContain("# Build Interactive Rig Comparison")
  expect(doc).toContain("Workstream: harness")
  expect(doc.match(/one evidence/g)).toHaveLength(1)
  expect(doc).toContain("## L2 Decisions")
  expect(doc).toContain("- Last meaningful decision: — none")
  expect(doc).toContain("- Deferred because: — none")
  expect(doc).toContain("- Blocker: — none")
  expect(doc).toContain("- Revival trigger: — none")
  expect(doc).toContain("## L3 Artifacts")
  expect(doc).toContain("  - — none")
})


test("constructs overview, summary, and label argv arrays", () => {
  expect(buildOverviewCommand("omp-fixture")).toEqual(["omp-fixture", "fleet", "overview", "--json"])
  expect(buildSummaryCommand("assistant: text", "openai-codex/gpt-5.6-luna:xhigh", "omp-fixture").slice(0, 4)).toEqual([
    "omp-fixture",
    "-p",
    "--model",
    "openai-codex/gpt-5.6-luna:xhigh",
  ])
  expect(buildLabelCommand("peer-1", { summary: "short", name: "Doing Work", workstream: "harness" }, "omp-fixture")).toEqual([
    "omp-fixture",
    "fleet",
    "label",
    "peer-1",
    "--summary",
    "short",
    "--name",
    "Doing Work",
    "--workstream",
    "harness",
  ])
  expect(parseSummaryOutput("SUMMARY: A short line\nNAME: Doing Work\nWORKSTREAM: Harness")).toEqual({
    summary: "A short line",
    name: "Doing Work",
    workstream: "harness",
  })
  expect(parseSummaryOutput(
    [
      "SUMMARY: fallback",
      "NAME: ignored",
      "WORKSTREAM: stale",
      "WHAT_WHY: Why this exists",
      "APPROACH: Current method",
      "RECENT: Latest result",
      "NEXT: Next action",
      "DECISION: Keep the live identity",
      "DEFERRED_WHY: Waiting for review",
      "BLOCKER: Credentials unavailable",
      "REVIVAL_TRIGGER: New journal entry",
      "ARTIFACTS: /tmp/proof.txt, https://example.test/proof",
    ].join("\n"),
  )).toEqual({
    summary: "fallback",
    name: "ignored",
    workstream: "stale",
    layers: {
      whatWhy: "Why this exists",
      approach: "Current method",
      recent: "Latest result",
      next: "Next action",
      decision: "Keep the live identity",
      deferredWhy: "Waiting for review",
      blocker: "Credentials unavailable",
      revivalTrigger: "New journal entry",
      artifacts: ["/tmp/proof.txt", "https://example.test/proof"],
    },
  })
})

test("writes labels, state doc, index, and cursor after a successful observation", async () => {
  const root = await tempRoot()
  const paths = pathsAt(root)
  const journal = join(root, "peer.jsonl")
  await writeFile(journal, '{"type":"message","message":{"role":"assistant","content":"implementing observer"}}\n')
  const calls: string[][] = []
  const runner = async (argv: readonly string[]): Promise<CommandResult> => {
    calls.push([...argv])
    if (argv.includes("-p")) return result("SUMMARY: Implementing observer\nNAME: Observer Work\nWORKSTREAM: harness")
    if (argv.includes("overview")) {
      return result(JSON.stringify([
        { session_id: "019f2b27-15f1-7000-8aa8-679d94ad06b1", state: "working", session_journal: journal, summary: "", name: "Live Fleet Identity", workstream: "harness" },
      ]))
    }
    return result()
  }
  const pass = await runObserverPass({ paths, model: "fixture-model", runCommand: runner })
  expect(pass.observed).toBe(1)
  expect(calls.some(argv => argv.includes("label") && argv.includes("019f2b27-15f1-7000-8aa8-679d94ad06b1"))).toBe(true)
  expect(await readFile(join(paths.stateDocsDir, "019f2b27-15f1-7000-8aa8-679d94ad06b1.md"), "utf8")).toContain("Implementing observer")
  expect(await readFile(paths.indexPath, "utf8")).toContain("019f2b27-15f1-7000-8aa8-679d94ad06b1\tLive Fleet Identity\tharness")
  expect(await readFile(paths.cursorPath, "utf8")).toContain("019f2b27-15f1-7000-8aa8-679d94ad06b1")
})

test("refreshes stale identity from the live fleet row even below threshold", async () => {
  const root = await tempRoot()
  const paths = pathsAt(root)
  const sessionId = "019f2b27-15f1-7000-8aa8-679d94ad06b1"
  const journal = join(root, "peer.jsonl")
  await writeFile(journal, '{"type":"message","message":{"role":"assistant","content":"unchanged"}}\n')
  const journalStat = await stat(journal)
  await mkdir(paths.stateDocsDir, { recursive: true })
  await writeFile(
    join(paths.stateDocsDir, `${sessionId}.md`),
    [
      "# Stale Name",
      "## L0",
      "What/why: Existing evidence",
      "Status: idle · Fresh: 2026-07-18T12:00:00.000Z",
      "",
      "## L1 Overview",
      "Current approach: Existing approach",
      "Recent: Existing recent",
      "Next: Continue the current work in stale-workstream.",
      "",
      "## L5 Depth",
      "- Journal: /tmp/peer.jsonl",
      "- History: history://019f2b27-15f1-7000-8aa8-679d94ad06b1",
      "",
    ].join("\n"),
  )
  await writeFile(paths.indexPath, `- ${sessionId}\tStale Name\tstale-workstream\t2026-07-18T12:00:00.000Z\n`)
  await mkdir(join(root, "data"), { recursive: true })
  await writeFile(paths.cursorPath, JSON.stringify({ [sessionId]: journalStat }))
  const pass = await runObserverPass({
    paths,
    thresholdBytes: 65_536,
    now: () => new Date("2026-07-19T03:00:00.000Z"),
    runCommand: async argv =>
      argv.includes("overview")
        ? result(JSON.stringify([{
            session_id: sessionId,
            name: "Live Name",
            workstream: "harness",
            state: "working",
            cwd: process.cwd(),
            session_journal: journal,
            summary: "stable",
          }]))
        : result(),
  })
  expect(pass.skippedReasons["below-threshold"]).toBe(1)
  const doc = await readFile(join(paths.stateDocsDir, `${sessionId}.md`), "utf8")
  expect(doc).toContain("# Live Name")
  expect(doc).toContain("Next: Continue the current work in harness.")
  expect(doc).toContain("Workstream: harness")
  expect(await readFile(paths.indexPath, "utf8")).toContain(`${sessionId}\tLive Name\tharness`)
})

test("appends one peer failure and continues the pass", async () => {
  const root = await tempRoot()
  const paths = pathsAt(root)
  const journal = join(root, "peer.jsonl")
  await writeFile(journal, '{"type":"message","message":{"role":"user","content":"trigger"}}\n')
  const calls: string[][] = []
  const runner = async (argv: readonly string[]): Promise<CommandResult> => {
    calls.push([...argv])
    if (argv.includes("overview")) {
      return result(JSON.stringify([
        { session_id: "019f365a-59d0-7000-b5bb-9931cc9e51c0", state: "working", session_journal: journal, summary: "", name: "Peer" },
      ]))
    }
    if (argv.includes("-p")) return result("provider failure", 1, "simulated model failure")
    return result()
  }
  const pass = await runObserverPass({ paths, model: "fixture-model", runCommand: runner })
  expect(pass.ran).toBe(true)
  expect(pass.failed).toBe(1)
  expect(calls.some(argv => argv.includes("-p"))).toBe(true)
  const errors = await readFile(paths.errorLogPath, "utf8")
  expect(errors).toContain("019f365a-59d0-7000-b5bb-9931cc9e51c0")
  expect(errors).toContain("simulated model failure")
})

test("parses overview aliases used by fleet JSON", () => {
  expect(parseOverviewJson(JSON.stringify([{ session_id: "s", spawn_name: "origin", session_journal: "/tmp/s", state: "idle", summary: "x", name: "S", label: "Display S", workstream: "harness" }]))).toEqual([
    { sessionId: "s", spawnName: "origin", sessionJournal: "/tmp/s", state: "idle", summary: "x", name: "S", label: "Display S", workstream: "harness", cwd: "" },
  ])
})

test("skips phantom rows before stat and threshold without writing docs or errors", async () => {
  const root = await tempRoot()
  const paths = pathsAt(root)
  const journal = join(root, "peer.jsonl")
  await writeFile(journal, '{"type":"message","message":{"role":"user","content":"phantom"}}\n')
  const cwd = process.cwd()
  const valid = "019f2783-4f07-7000-ac94-347ad8de223d"
  const rows = [
    { session_id: "019f2b27-15f1-7000-8aa8-679d94ad06b1", state: "working", session_journal: "", cwd },
    { session_id: "019f365a-59d0-7000-b5bb-9931cc9e51c0", state: "working", session_journal: join(root, "missing.jsonl"), cwd },
    { session_id: "legacy-cwd:1234", state: "working", session_journal: journal, cwd },
    { session_id: "legacy-cwd-1234", state: "working", session_journal: journal, cwd },
    { session_id: "019f5e2f-cdaa-7000-a7a3-eedec7f1ea52", state: "working", session_journal: journal, cwd: tmpdir() },
    { session_id: `${valid}:escape`, state: "working", session_journal: journal, cwd },
  ]
  const pass = await runObserverPass({
    paths,
    runCommand: async argv => (argv.includes("overview") ? result(JSON.stringify(rows)) : result()),
  })
  expect(pass.observed).toBe(0)
  expect(pass.failed).toBe(0)
  expect(pass.skipped).toBe(rows.length)
  expect(pass.skippedReasons).toEqual({
    "missing-session-journal": 1,
    "missing-journal-file": 1,
    "invalid-session-id": 1,
    "tmp-cwd": 1,
    "unsafe-session-id": 2,
  })
  expect(await readdir(paths.stateDocsDir)).toEqual(["INDEX.md"])
  await expect(stat(paths.errorLogPath)).rejects.toThrow()
})

test("regenerates the index from current surviving docs", async () => {
  const root = await tempRoot()
  const paths = pathsAt(root)
  const journal = join(root, "peer.jsonl")
  const current = "019f6047-a362-7000-9218-6bc3b3946cf0"
  await writeFile(journal, '{"type":"message","message":{"role":"user","content":"unchanged"}}\n')
  const journalStat = await stat(journal)
  await mkdir(paths.stateDocsDir, { recursive: true })
  await writeFile(
    join(paths.stateDocsDir, `${current}.md`),
    renderStateDoc({
      sessionId: current,
      name: "Current",
      state: "working",
      workstream: "harness",
      summary: "Still current",
      journalPath: journal,
      stamp: "2026-07-18T12:00:00.000Z",
    }),
  )
  await writeFile(
    paths.indexPath,
    [
      "- dead-session\tDead\tharness\t2026-07-18T11:00:00.000Z",
      `- ${current}\tCurrent\tharness\t2026-07-18T12:00:00.000Z`,
      "",
    ].join("\n"),
  )
  await mkdir(join(root, "data"), { recursive: true })
  await writeFile(paths.cursorPath, JSON.stringify({ [current]: journalStat }))
  const pass = await runObserverPass({
    paths,
    runCommand: async argv =>
      argv.includes("overview")
        ? result(JSON.stringify([{ session_id: current, state: "working", session_journal: journal, cwd: process.cwd(), summary: "stable" }]))
        : result(),
  })
  expect(pass.skipped).toBe(1)
  const index = await readFile(paths.indexPath, "utf8")
  expect(index).toContain(current)
  expect(index).not.toContain("dead-session")
})
test("reports only idle peers with a fresh digest", async () => {
  const root = await tempRoot()
  const paths = pathsAt(root)
  const now = new Date("2026-07-18T12:00:00.000Z")
  const hour = 60 * 60 * 1_000
  const peers = [
    {
      sessionId: "019f6047-a362-7000-9218-6bc3b3946cf0",
      name: "Fresh Peer",
      journalAge: 24 * hour,
      stateAge: 23 * hour,
    },
    {
      sessionId: "019f6047-a362-7000-9218-6bc3b3946cf1",
      name: "Stale Peer",
      journalAge: 24 * hour,
      stateAge: 25 * hour,
    },
    {
      sessionId: "019f6047-a362-7000-9218-6bc3b3946cf2",
      name: "Active Peer",
      journalAge: hour,
      stateAge: 30 * 60 * 1_000,
    },
  ]
  const records = []
  const cursors: Record<string, { byteSize: number; mtimeMs: number }> = {}
  for (const peer of peers) {
    const journalPath = join(root, `${peer.sessionId}.jsonl`)
    const journalMtime = new Date(now.getTime() - peer.journalAge)
    const stateMtime = new Date(now.getTime() - peer.stateAge)
    await writeFile(journalPath, '{"type":"message","message":{"role":"user","content":"unchanged"}}\n')
    await utimes(journalPath, journalMtime, journalMtime)
    const journalStat = await stat(journalPath)
    await mkdir(paths.stateDocsDir, { recursive: true })
    const statePath = join(paths.stateDocsDir, `${peer.sessionId}.md`)
    await writeFile(
      statePath,
      renderStateDoc({
        sessionId: peer.sessionId,
        name: peer.name,
        state: "idle",
        workstream: "harness",
        summary: "Unchanged",
        journalPath,
        stamp: now.toISOString(),
      }),
    )
    await utimes(statePath, stateMtime, stateMtime)
    records.push({ sessionId: peer.sessionId, name: peer.name, workstream: "harness", stamp: now.toISOString() })
    cursors[peer.sessionId] = { byteSize: journalStat.size, mtimeMs: journalStat.mtimeMs }
  }
  await writeFile(paths.indexPath, renderIndex(records))
  await mkdir(join(root, "data"), { recursive: true })
  await writeFile(paths.cursorPath, JSON.stringify(cursors))

  const previousIdleHours = process.env.OBSERVER_PARK_IDLE_HOURS
  process.env.OBSERVER_PARK_IDLE_HOURS = "12"
  try {
    const pass = await runObserverPass({
      paths,
      now: () => now,
      runCommand: async argv =>
        argv.includes("overview")
          ? result(JSON.stringify(peers.map(peer => ({
              session_id: peer.sessionId,
              state: "idle",
              session_journal: join(root, `${peer.sessionId}.jsonl`),
              cwd: process.cwd(),
              summary: "stable",
            }))))
          : result(),
    })
    expect(pass.parkCandidates).toBe(1)
    const index = await readFile(paths.indexPath, "utf8")
    expect(index).toContain("## Park candidates\n- Fresh Peer — idle 24h — [state doc](./019f6047-a362-7000-9218-6bc3b3946cf0.md)")
    expect(index).not.toContain("- Stale Peer — idle")
    expect(index).not.toContain("- Active Peer — idle")
  } finally {
    if (previousIdleHours === undefined) delete process.env.OBSERVER_PARK_IDLE_HOURS
    else process.env.OBSERVER_PARK_IDLE_HOURS = previousIdleHours
  }
})

test("respects the park idle-hour environment threshold", async () => {
  const root = await tempRoot()
  const paths = pathsAt(root)
  const now = new Date("2026-07-18T12:00:00.000Z")
  const journalPath = join(root, "threshold-peer.jsonl")
  const journalMtime = new Date(now.getTime() - 13 * 60 * 60 * 1_000)
  const stateMtime = new Date(now.getTime() - 12 * 60 * 60 * 1_000)
  const sessionId = "019f6047-a362-7000-9218-6bc3b3946cf3"
  await writeFile(journalPath, '{"type":"message","message":{"role":"user","content":"unchanged"}}\n')
  await utimes(journalPath, journalMtime, journalMtime)
  const journalStat = await stat(journalPath)
  await mkdir(paths.stateDocsDir, { recursive: true })
  const statePath = join(paths.stateDocsDir, `${sessionId}.md`)
  await writeFile(
    statePath,
    renderStateDoc({
      sessionId,
      name: "Threshold Peer",
      state: "idle",
      workstream: "harness",
      summary: "Unchanged",
      journalPath,
      stamp: now.toISOString(),
    }),
  )
  await utimes(statePath, stateMtime, stateMtime)
  await writeFile(paths.indexPath, renderIndex([{ sessionId, name: "Threshold Peer", workstream: "harness", stamp: now.toISOString() }]))
  await mkdir(join(root, "data"), { recursive: true })
  await writeFile(paths.cursorPath, JSON.stringify({ [sessionId]: journalStat }))

  const previousIdleHours = process.env.OBSERVER_PARK_IDLE_HOURS
  const runner = async (argv: readonly string[]): Promise<CommandResult> =>
    argv.includes("overview")
      ? result(JSON.stringify([{ session_id: sessionId, state: "idle", session_journal: journalPath, cwd: process.cwd(), summary: "stable" }]))
      : result()
  try {
    process.env.OBSERVER_PARK_IDLE_HOURS = "24"
    expect(parkIdleHoursFromEnv()).toBe(24)
    expect((await runObserverPass({ paths, now: () => now, runCommand: runner })).parkCandidates).toBe(0)
    process.env.OBSERVER_PARK_IDLE_HOURS = "12"
    expect(parkIdleHoursFromEnv()).toBe(12)
    expect((await runObserverPass({ paths, now: () => now, runCommand: runner })).parkCandidates).toBe(1)
  } finally {
    if (previousIdleHours === undefined) delete process.env.OBSERVER_PARK_IDLE_HOURS
    else process.env.OBSERVER_PARK_IDLE_HOURS = previousIdleHours
  }
})

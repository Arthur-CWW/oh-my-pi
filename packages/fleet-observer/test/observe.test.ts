import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
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
        return result(JSON.stringify([{ session_id: "peer", state: "working", session_journal: journal, summary: "stable", name: "Peer" }]))
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
  expect(index).toBe("- peer-1\tFleet Observer\tharness\t2026-07-18T12:00:00.000Z\n")
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
        { session_id: "peer-success", state: "working", session_journal: journal, summary: "", name: "Peer" },
      ]))
    }
    return result()
  }
  const pass = await runObserverPass({ paths, model: "fixture-model", runCommand: runner })
  expect(pass.observed).toBe(1)
  expect(calls.some(argv => argv.includes("label") && argv.includes("peer-success"))).toBe(true)
  expect(await readFile(join(paths.stateDocsDir, "peer-success.md"), "utf8")).toContain("Implementing observer")
  expect(await readFile(paths.indexPath, "utf8")).toContain("peer-success\tObserver Work\tharness")
  expect(await readFile(paths.cursorPath, "utf8")).toContain("peer-success")
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
        { session_id: "peer-failing", state: "working", session_journal: journal, summary: "", name: "Peer" },
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
  expect(errors).toContain("peer-failing")
  expect(errors).toContain("simulated model failure")
})

test("parses overview aliases used by fleet JSON", () => {
  expect(parseOverviewJson(JSON.stringify([{ session_id: "s", spawn_name: "origin", session_journal: "/tmp/s", state: "idle", summary: "x", name: "S", workstream: "harness" }]))).toEqual([
    { sessionId: "s", spawnName: "origin", sessionJournal: "/tmp/s", state: "idle", summary: "x", name: "S", workstream: "harness" },
  ])
})

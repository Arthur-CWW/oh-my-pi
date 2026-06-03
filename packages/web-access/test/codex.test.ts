import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import {
  buildCodexResumeContext,
  listCodexSessions,
  parseCodexResumeArgs,
  resolveCodexSession,
} from "../src/codex"

const tempRoots: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempRoots.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of tempRoots.splice(0)) {
    await rm(dir, { force: true, recursive: true })
  }
})

function jsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + "\n"
}

async function writeSession(codexHome: string, input: {
  cwd: string
  id: string
  offsetMs?: number
  title: string
}): Promise<string> {
  const dir = join(codexHome, "sessions", "2026", "06", "03")
  await mkdir(dir, { recursive: true })
  const file = join(dir, `rollout-2026-06-03T00-00-00-${input.id}.jsonl`)
  await writeFile(file, jsonl([
    {
      timestamp: "2026-06-03T00:00:00.000Z",
      type: "session_meta",
      payload: { id: input.id, timestamp: "2026-06-03T00:00:00.000Z", cwd: input.cwd },
    },
    {
      timestamp: "2026-06-03T00:00:01.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: input.title, images: [] },
    },
    {
      timestamp: "2026-06-03T00:00:02.000Z",
      type: "response_item",
      payload: { type: "function_call", name: "exec_command", call_id: "call_1", arguments: JSON.stringify({ cmd: "rg TODO", workdir: input.cwd }) },
    },
    {
      timestamp: "2026-06-03T00:00:03.000Z",
      type: "response_item",
      payload: { type: "function_call_output", call_id: "call_1", output: "Authorization: Bearer sk-testsecretsecretsecretsecret\nraw sk-testsecretsecretsecretsecret\ntoken=supersecretvalue" },
    },
    {
      timestamp: "2026-06-03T00:00:04.000Z",
      type: "event_msg",
      payload: { type: "agent_message", phase: "final", message: "Done with the scan." },
    },
  ]))
  const date = new Date(Date.now() + (input.offsetMs ?? 0))
  await utimes(file, date, date)
  return file
}

describe("codex session discovery", () => {
  it("lists only sessions for the current cwd by default", async () => {
    const codexHome = await tempDir("codex-home-")
    const cwd = await tempDir("codex-cwd-")
    const otherCwd = await tempDir("codex-other-")

    const first = await writeSession(codexHome, { cwd, id: "11111111-1111-4111-8111-111111111111", title: "Continue repo task" })
    await writeSession(codexHome, { cwd: otherCwd, id: "22222222-2222-4222-8222-222222222222", offsetMs: 1_000, title: "Other repo task" })

    const sessions = await listCodexSessions({ codexHome, cwd, limit: 10 })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.file).toBe(first)
    expect(sessions[0]?.title).toBe("Continue repo task")
  })

  it("resolves latest and builds redacted resume context", async () => {
    const codexHome = await tempDir("codex-home-")
    const cwd = await tempDir("codex-cwd-")
    const file = await writeSession(codexHome, { cwd, id: "33333333-3333-4333-8333-333333333333", title: "Resume this Codex work" })

    const session = await resolveCodexSession({ codexHome, cwd })
    expect(session?.file).toBe(file)

    const resume = await buildCodexResumeContext(session!, { maxChars: 20_000 })
    expect(resume.context).toContain("Imported Codex CLI session")
    expect(resume.context).toContain("Resume this Codex work")
    expect(resume.context).toContain("TOOL CALL exec_command")
    expect(resume.context).toContain("[REDACTED_OPENAI_KEY]")
    expect(resume.context).toContain("token=[REDACTED]")
    expect(resume.context).not.toContain("sk-testsecretsecretsecretsecret")
    expect(resume.entryCount).toBe(4)
  })
})

describe("codex resume args", () => {
  it("parses command flags", () => {
    expect(parseCodexResumeArgs("abc --all --pick --no-send --max-chars 12000")).toEqual({
      all: true,
      help: false,
      maxChars: 12_000,
      noSend: true,
      pick: true,
      ref: "abc",
    })
  })
})

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import {
  findRepoRoot,
  parseSymphonyxOpenArgs,
  runSymphonyxOpen,
  type SymphonyxOpenArgs,
} from "../src/symphonyx-open"

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

function expectArgs(input: string, expected: Partial<SymphonyxOpenArgs>): void {
  expect(parseSymphonyxOpenArgs(input)).toEqual(expect.objectContaining(expected))
}

describe("parseSymphonyxOpenArgs", () => {
  it("defaults to agent kind", () => {
    expectArgs("abc", { kind: "agent", agentId: "abc", help: false })
  })

  it("parses agent with --root", () => {
    expectArgs("agent abc --root /tmp/sym", {
      kind: "agent",
      agentId: "abc",
      root: "/tmp/sym",
      help: false,
    })
  })

  it("parses agent with --root=value", () => {
    expectArgs("agent abc --root=/tmp/sym", {
      kind: "agent",
      agentId: "abc",
      root: "/tmp/sym",
      help: false,
    })
  })

  it("parses session provider and id", () => {
    expectArgs("session codex sess-1", {
      kind: "session",
      provider: "codex",
      sessionId: "sess-1",
      help: false,
    })
  })

  it("parses session with --root", () => {
    expectArgs("session codex sess-1 --root /tmp/sym", {
      kind: "session",
      provider: "codex",
      sessionId: "sess-1",
      root: "/tmp/sym",
      help: false,
    })
  })

  it("detects help flag", () => {
    expectArgs("--help", { kind: "agent", help: true })
    expectArgs("agent abc --help", { kind: "agent", agentId: "abc", help: true })
  })

  it("ignores extra tokens after required positional args", () => {
    expectArgs("agent abc extra", {
      kind: "agent",
      agentId: "abc",
      help: false,
    })
  })
})

describe("findRepoRoot", () => {
  it("finds repo root by packages/symphony-lite-rs/Cargo.toml", async () => {
    const repo = await tempDir("symx-repo-")
    const cargo = join(repo, "packages", "symphony-lite-rs", "Cargo.toml")
    await mkdir(dirname(cargo), { recursive: true })
    await writeFile(cargo, "[package]\n")

    expect(findRepoRoot(join(repo, "sub", "dir"))).toBe(repo)
    expect(findRepoRoot(repo)).toBe(repo)
  })

  it("falls back to .git directory", async () => {
    const repo = await tempDir("symx-git-")
    await mkdir(join(repo, ".git"), { recursive: true })

    expect(findRepoRoot(join(repo, "src"))).toBe(repo)
  })

  it("returns undefined outside any repo", async () => {
    const dir = await tempDir("symx-orphan-")
    expect(findRepoRoot(dir)).toBeUndefined()
  })
})

describe("runSymphonyxOpen", () => {
  it("returns usage error for missing agent id", async () => {
    const cwd = await tempDir("symx-cwd-")
    await expect(runSymphonyxOpen("agent", { cwd })).rejects.toThrow("Missing agent id")
  })

  it("returns usage error for missing session provider or id", async () => {
    const cwd = await tempDir("symx-cwd-")
    await expect(runSymphonyxOpen("session codex", { cwd })).rejects.toThrow("Missing session provider or id")
  })

  it("uses an explicit symphonyx command and opener", async () => {
    const repo = await tempDir("symx-repo-")
    const cargo = join(repo, "packages", "symphony-lite-rs", "Cargo.toml")
    await mkdir(dirname(cargo), { recursive: true })
    await writeFile(cargo, "[package]\n")

    const openedTargets: string[] = []
    const executed: Array<{ command: string; args: string[]; cwd?: string }> = []
    const { result, commandUsed, openedByOmp } = await runSymphonyxOpen("agent agent-1", {
      cwd: repo,
      symphonyxCommand: "/tmp/symphonyx",
      openTarget: (target) => openedTargets.push(target),
      execCommand: async (command, args, options) => {
        executed.push({ command, args, cwd: options.cwd })
        return {
          stdout: '{"ok":true,"data":{"kind":"agent","id":"agent-1","target":"/tmp/target","opened":false}}',
          stderr: "",
        }
      },
    })
    expect(result.target).toBe("/tmp/target")
    expect(openedTargets).toEqual(["/tmp/target"])
    expect(openedByOmp).toBe(true)
    expect(commandUsed).toContain("/tmp/symphonyx")
    expect(executed).toEqual([
      {
        command: "/tmp/symphonyx",
        args: ["--root", join(repo, "data/symphonyx"), "open", "agent", "agent-1", "--json"],
        cwd: repo,
      },
    ])
  })
})

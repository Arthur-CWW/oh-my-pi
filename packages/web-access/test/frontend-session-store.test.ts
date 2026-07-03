import { execFile } from "node:child_process"
import { afterEach, describe, expect, it } from "bun:test"
import {
  frontendSessionDbPath,
  listFrontendProjects,
  listFrontendSessions,
  resolveFrontendProject,
  resolveFrontendSession,
  saveFrontendProject,
  saveFrontendSession,
} from "../src/frontend-session-store"

function runSql(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile("sqlite3", [frontendSessionDbPath()], (err, _stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || String(err)))
      else resolve()
    })
    child.stdin?.end(script)
  })
}

afterEach(async () => {
  await runSql(`
DELETE FROM frontend_sessions WHERE id LIKE 'test-%' OR project_key LIKE 'test-%';
DELETE FROM frontend_projects WHERE key LIKE 'test-%';
`)
})

describe("frontend session store", () => {
  it("saves and resolves project aliases", async () => {
    const key = `test-project-${Date.now()}`
    const saved = await saveFrontendProject({
      key,
      provider: "chatgpt",
      title: "Test Project",
      url: "https://chatgpt.com/project/test-project",
    })

    expect(saved.key).toBe(key)

    const resolved = await resolveFrontendProject("chatgpt", key)
    expect(resolved?.url).toBe("https://chatgpt.com/project/test-project")

    const projects = await listFrontendProjects("chatgpt")
    expect(projects.some((project) => project.key === key)).toBe(true)
  })

  it("saves sessions and resolves latest by project", async () => {
    const key = `test-session-project-${Date.now()}`
    await saveFrontendProject({
      key,
      provider: "chatgpt",
      title: "Test Session Project",
      url: "https://chatgpt.com/project/test-session-project",
    })
    const first = await saveFrontendSession({
      conversationUrl: "https://chatgpt.com/c/test-first",
      id: `test-first-${Date.now()}`,
      projectKey: key,
      projectUrl: "https://chatgpt.com/project/test-session-project",
      prompt: "first prompt",
      provider: "chatgpt",
      responseText: "first response",
      title: "First",
    })
    await Bun.sleep(2)
    const second = await saveFrontendSession({
      conversationUrl: "https://chatgpt.com/c/test-second",
      id: `test-second-${Date.now()}`,
      projectKey: key,
      projectUrl: "https://chatgpt.com/project/test-session-project",
      prompt: "second prompt",
      provider: "chatgpt",
      responseText: "second response",
      title: "Second",
    })

    const sessions = await listFrontendSessions({ project: key, provider: "chatgpt" })
    expect(sessions.map((session) => session.id)).toContain(first.id)
    expect(sessions[0]?.id).toBe(second.id)

    const latest = await resolveFrontendSession("latest", { project: key, provider: "chatgpt" })
    expect(latest?.conversationUrl).toBe("https://chatgpt.com/c/test-second")
  })

  it("lists persisted output paths and Grok recovery metadata", async () => {
    const id = `test-grok-blocked-${Date.now()}`
    await saveFrontendSession({
      blockerReason: "Grok login needs human approval. Run recovery.",
      conversationUrl: "https://grok.com/share/test-blocked",
      id,
      outputPath: "data/research/grok-output.md",
      prompt: "recover this blocked Grok prompt",
      provider: "grok",
      recoveryStep: "pi-llm-browser wait --provider grok --session latest --output-file data/research/grok-output.md",
      responseText: "",
      title: "Blocked Grok Prompt",
    })

    const [listed] = await listFrontendSessions({ provider: "grok", limit: 1 })
    expect(listed?.id).toBe(id)
    expect(listed?.outputPath).toBe("data/research/grok-output.md")
    expect(listed?.blockerReason).toContain("human approval")
    expect(listed?.recoveryStep).toContain("--output-file data/research/grok-output.md")

    await saveFrontendSession({
      conversationUrl: listed?.conversationUrl,
      id,
      outputPath: listed?.outputPath,
      prompt: listed?.prompt ?? "recover this blocked Grok prompt",
      provider: "grok",
      responseText: "collected response",
      title: listed?.title,
    })
    const resolved = await resolveFrontendSession(id, { provider: "grok" })
    expect(resolved?.outputPath).toBe("data/research/grok-output.md")
    expect(resolved?.responseText).toBe("collected response")
  })
})

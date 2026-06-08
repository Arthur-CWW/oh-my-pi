import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import {
  formatSessionList,
  getCockpitSummary,
  initCockpitDb,
  listEvents,
  listSessions,
  listTerminalPanes,
  publishSession,
  saveTerminalSnapshot,
} from "../src/agent-cockpit"

const tempRoots: string[] = []

function hasSqlite3(): boolean {
  try {
    execFileSync("sqlite3", ["--version"], { stdio: "ignore", timeout: 3000 })
    return true
  } catch {
    return false
  }
}

async function tempDb(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-cockpit-"))
  tempRoots.push(dir)
  return join(dir, "cockpit.sqlite")
}

afterEach(async () => {
  for (const dir of tempRoots.splice(0)) {
    await rm(dir, { force: true, recursive: true })
  }
})

const describeIfSqlite = hasSqlite3() ? describe : describe.skip

describeIfSqlite("agent cockpit store", () => {
  it("initializes and publishes sessions", async () => {
    const dbPath = await tempDb()
    await initCockpitDb({ dbPath, now: 1000 })

    const record = await publishSession({
      cwd: "/tmp/project-a",
      id: "test-session-1",
      objective: "Implement cockpit metadata",
      role: "worker",
      status: "running",
      tags: ["pilot", "sqlite"],
      title: "Cockpit worker",
      workgroupId: "Control Plane",
    }, { dbPath, now: 2000 })

    expect(record.id).toBe("test-session-1")
    expect(record.workgroupId).toBe("control-plane")
    expect(record.tags).toEqual(["pilot", "sqlite"])

    const sessions = await listSessions({ dbPath, now: 3000 })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.title).toBe("Cockpit worker")
    expect(sessions[0]?.objective).toBe("Implement cockpit metadata")

    const text = formatSessionList(sessions, { now: 3000 })
    expect(text).toContain("Cockpit worker")
    expect(text).toContain("control-plane")
  })

  it("preserves semantic metadata across heartbeat updates", async () => {
    const dbPath = await tempDb()
    await publishSession({
      cwd: "/tmp/project-b",
      id: "test-session-2",
      objective: "Keep this objective",
      role: "reviewer",
      status: "running",
      title: "Reviewer",
      workgroupId: "review",
    }, { dbPath, now: 1000 })

    await publishSession({ id: "test-session-2", status: "idle" }, { dbPath, now: 5000 })

    const [session] = await listSessions({ dbPath, now: 6000 })
    expect(session?.status).toBe("idle")
    expect(session?.title).toBe("Reviewer")
    expect(session?.objective).toBe("Keep this objective")
    expect(session?.role).toBe("reviewer")
    expect(session?.workgroupId).toBe("review")
    expect(session?.lastHeartbeatAt).toBe(5000)
  })

  it("records events and summarizes status/workgroups", async () => {
    const dbPath = await tempDb()
    await publishSession({ id: "a", status: "running", title: "A", workgroupId: "wg-a" }, { dbPath, now: 1000 })
    await publishSession({ id: "b", status: "blocked", title: "B", workgroupId: "wg-a" }, { dbPath, now: 2000 })
    await publishSession({ id: "c", status: "idle", title: "C" }, { dbPath, now: 3000 })

    const events = await listEvents({ dbPath, limit: 10 })
    expect(events.length).toBeGreaterThanOrEqual(3)

    const summary = await getCockpitSummary({ dbPath, now: 10_000, staleAfterMs: 1_000 })
    expect(summary.totalSessions).toBe(3)
    expect(summary.sessionsByStatus.running).toBe(1)
    expect(summary.sessionsByStatus.blocked).toBe(1)
    expect(summary.sessionsByWorkgroup["wg-a"]).toBe(2)
    expect(summary.sessionsByWorkgroup.ungrouped).toBe(1)
    expect(summary.staleSessions).toBe(3)
  })

  it("normalizes Zellij-style terminal snapshots", async () => {
    const dbPath = await tempDb()
    const snapshot = await saveTerminalSnapshot({
      backend: "zellij",
      terminalSession: "cockpit-test",
      tabs: [
        { active: true, name: "agents", position: 1, tab_id: 7 },
      ],
      panes: [
        {
          exited: false,
          id: 12,
          is_floating: false,
          is_focused: true,
          pane_columns: 100,
          pane_command: "pi",
          pane_cwd: "/tmp/project",
          pane_rows: 40,
          pane_x: 0,
          pane_y: 0,
          tab_id: 7,
          tab_name: "agents",
          title: "worker",
        },
      ],
    }, { dbPath, now: 4000 })

    expect(snapshot.tabs[0]?.tabId).toBe("7")
    expect(snapshot.panes[0]?.paneId).toBe("12")
    expect(snapshot.panes[0]?.focused).toBe(true)
    expect(snapshot.panes[0]?.command).toBe("pi")

    const panes = await listTerminalPanes({ dbPath, backend: "zellij", terminalSession: "cockpit-test" })
    expect(panes).toHaveLength(1)
    expect(panes[0]?.geometry).toEqual({ columns: 100, rows: 40, x: 0, y: 0 })
  })
})

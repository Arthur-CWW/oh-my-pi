import { describe, expect, test } from "bun:test"
import {
  cardToIssue,
  fleetRowToIssue,
  mapCardRows,
  mapFleetRows,
  markErrorReported,
  registerStatusToStatus,
  sessionStateToStatus,
  shouldReportError,
} from "../ui/src/data/fleet-adapter"

describe("fleet adapter session fixture matrix", () => {
  const fixture = [
    { session_id: "agent://waiting-123456789", state: "waiting_input", summary: "Needs a decision", workstream: "ui", version: "16.0.1", versionSkew: true, last_seen: "2026-07-18T12:00:00.000Z" },
    { session_id: "working-1", state: "working", objective: "Build adapter", name: "Builder", workstream: "data" },
    { session_id: "idle-1", state: "idle", objective: "Complete adapter", name: "Finisher" },
    { session_id: "held-1", state: "held", objective: "Deferred adapter", name: "Holder" },
  ]

  test("maps all live states and preserves title fallback order", () => {
    const issues = mapFleetRows(fixture)
    expect(issues).toHaveLength(4)
    expect(issues.map((issue) => issue.status.id)).toEqual(["to-do", "in-progress", "completed", "paused"])
    expect(issues.map((issue) => issue.title)).toEqual(["Needs a decision", "Build adapter", "Complete adapter", "Deferred adapter"])
    expect(issues[0]?.identifier).toBe("waiting-")
    expect(issues[0]?.labels).toEqual([{ id: "version-skew", name: "Version skew: 16.0.1", color: "red" }])
    expect(issues[1]?.labels).toEqual([])
    expect(issues[1]?.assignee?.name).toBe("data")
    expect(issues[0]?.id).toBe("agent://waiting-123456789")
  })
  test("maps every recognized session state alias", () => {
    const states = [
      "waiting_input",
      "waiting for input",
      "awaiting-input",
      "working",
      "running",
      "active",
      "in progress",
      "idle",
      "implemented",
      "done",
      "completed",
      "success",
      "held",
    ]
    expect(states.map((state) => sessionStateToStatus(state).id)).toEqual([
      "to-do",
      "to-do",
      "to-do",
      "in-progress",
      "in-progress",
      "in-progress",
      "in-progress",
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "paused",
    ])
    expect(fleetRowToIssue({ session_id: "name-only", name: "Named session" })?.title).toBe("Named session")
  })

  test("skips malformed rows without throwing", () => {
    expect(mapFleetRows([null, 3, {}, { session_id: 7 }, { session_id: "ok", state: "working", summary: "valid" }])).toHaveLength(1)
    expect(fleetRowToIssue({ session_id: "ok", summary: "valid" })?.status.id).toBe("paused")
  })
})

describe("register adapter status matrix", () => {
  test("maps every board status word", () => {
    const statuses = ["REQUESTED", "awaiting review", "IN PROGRESS — v1", "WORKING", "IMPLEMENTED", "DONE", "HELD", "DEFERRED"]
    expect(statuses.map((value) => registerStatusToStatus(value).id)).toEqual([
      "to-do",
      "to-do",
      "in-progress",
      "in-progress",
      "completed",
      "completed",
      "paused",
      "paused",
    ])
  })

  test("maps HR id, intent, and phase priority while skipping malformed cards", () => {
    expect(mapCardRows([
      { id: "HR-200", intent: "Implement adapter", status: "IN PROGRESS", phase: "P1/P2" },
      { id: "HR-201", intent: "Ship adapter", status: "IMPLEMENTED", phase: "P0" },
      { id: "HR-202", intent: "Cleanup adapter", status: "REQUESTED", phase: "P3" },
      { id: "HR-203", intent: "No phase", status: "UNKNOWN", phase: "" },
      { id: "HR-204", status: "REQUESTED" },
      null,
    ]).map((issue) => ({ id: issue.identifier, status: issue.status.id, priority: issue.priority?.id }))).toEqual([
      { id: "HR-200", status: "in-progress", priority: "high" },
      { id: "HR-201", status: "completed", priority: "urgent" },
      { id: "HR-202", status: "to-do", priority: "low" },
      { id: "HR-203", status: "paused", priority: "no-priority" },
    ])
    expect(cardToIssue({ id: "HR-205", intent: "Fallback title", status: "REQUESTED" })?.title).toBe("Fallback title")
  })
})

describe("client error throttle", () => {
  test("allows first report, blocks within one minute, and allows the next window", () => {
    const first = {}
    expect(shouldReportError("HttpError", 100_000, first)).toBe(true)
    const afterFirst = markErrorReported("HttpError", 100_000, first)
    expect(shouldReportError("HttpError", 159_999, afterFirst)).toBe(false)
    expect(shouldReportError("HttpError", 160_000, afterFirst)).toBe(true)
    expect(shouldReportError("TypeError", 100_001, afterFirst)).toBe(true)
  })
})

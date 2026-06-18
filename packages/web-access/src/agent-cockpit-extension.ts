import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import {
  formatSessionList,
  formatSummary,
  getCockpitSummary,
  importZellijSnapshot,
  inferCockpitSessionId,
  listEvents,
  listSessions,
  publishSession,
  recordEvent,
  saveWorkgroup,
  type CockpitSessionInput,
} from "./agent-cockpit"

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
  return out.length ? out : undefined
}

function safeSessionFile(ctx: unknown): string | null {
  const record = asRecord(ctx)
  const manager = asRecord(record.sessionManager)
  const getter = manager.getSessionFile
  if (typeof getter !== "function") return null
  try {
    const value = getter.call(manager)
    return typeof value === "string" && value.trim() ? value : null
  } catch { return null }
}

function safeCwd(ctx: unknown): string | null {
  const value = asRecord(ctx).cwd
  return typeof value === "string" && value.trim() ? value : null
}

function safeSessionName(pi: ExtensionAPI): string | null {
  const maybe = pi as unknown as { getSessionName?: () => string | null | undefined }
  if (typeof maybe.getSessionName !== "function") return null
  try {
    const value = maybe.getSessionName()
    return typeof value === "string" && value.trim() ? value : null
  } catch { return null }
}

function baseInputFromContext(pi: ExtensionAPI, ctx: unknown): CockpitSessionInput {
  const cwd = safeCwd(ctx)
  const sessionFile = safeSessionFile(ctx)
  const title = safeSessionName(pi)
  return {
    cwd,
    id: inferCockpitSessionId({ cwd, sessionFile }),
    kind: "pi",
    sessionFile,
    title,
  }
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1))}…`
}

function inputFromParams(rawParams: unknown): CockpitSessionInput {
  const params = asRecord(rawParams)
  return {
    artifacts: stringArray(params.artifacts),
    branch: str(params.branch),
    cwd: str(params.cwd),
    id: str(params.sessionId) ?? str(params.id),
    kind: str(params.kind),
    objective: str(params.objective),
    paneId: str(params.paneId),
    paneTitle: str(params.paneTitle),
    pid: num(params.pid),
    repo: str(params.repo),
    role: str(params.role),
    sessionFile: str(params.sessionFile),
    status: str(params.status),
    statusIcon: str(params.statusIcon),
    summary: str(params.summary),
    tabId: str(params.tabId),
    tabName: str(params.tabName),
    tags: stringArray(params.tags),
    terminalBackend: str(params.terminalBackend),
    terminalSession: str(params.terminalSession),
    title: str(params.title),
    transcriptPath: str(params.transcriptPath),
    workgroupId: str(params.workgroup),
    workgroupTitle: str(params.workgroupTitle),
  }
}

export function registerAgentCockpit(pi: ExtensionAPI): void {
  const anyPi = pi as unknown as { on?: (event: string, handler: (...args: unknown[]) => unknown) => void }
  let currentSessionId: string | null = null

  const publishFromEvent = (ctx: unknown, input: CockpitSessionInput) => {
    const base = baseInputFromContext(pi, ctx)
    currentSessionId = input.id ?? base.id ?? currentSessionId
    void publishSession({ ...base, ...input, id: currentSessionId ?? base.id }).catch(() => {})
  }

  anyPi.on?.("session_start", (event: unknown, ctx: unknown) => {
    const reason = str(asRecord(event).reason) ?? "startup"
    publishFromEvent(ctx, { status: "idle", summary: `session ${reason}` })
  })

  anyPi.on?.("agent_start", (event: unknown, ctx: unknown) => {
    const prompt = truncate(str(asRecord(event).prompt), 180)
    publishFromEvent(ctx, { objective: prompt, status: "running", summary: prompt ? "agent started" : "agent running" })
  })

  anyPi.on?.("turn_start", (_event: unknown, ctx: unknown) => {
    publishFromEvent(ctx, { status: "thinking", summary: "LLM turn in progress" })
  })

  anyPi.on?.("tool_call", (event: unknown, ctx: unknown) => {
    const toolName = str(asRecord(event).toolName)
    publishFromEvent(ctx, { status: "tool", summary: toolName ? `tool: ${toolName}` : "tool running" })
  })

  anyPi.on?.("tool_result", (event: unknown, ctx: unknown) => {
    const toolName = str(asRecord(event).toolName)
    const isError = asRecord(event).isError === true
    publishFromEvent(ctx, { status: isError ? "blocked" : "running", summary: toolName ? `tool result: ${toolName}` : "tool result" })
  })

  anyPi.on?.("agent_end", (_event: unknown, ctx: unknown) => {
    publishFromEvent(ctx, { status: "idle", summary: "agent idle" })
  })

  anyPi.on?.("session_shutdown", (event: unknown, ctx: unknown) => {
    const reason = str(asRecord(event).reason) ?? "shutdown"
    publishFromEvent(ctx, { expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, status: "offline", summary: `session ${reason}` })
  })

  pi.registerTool({
    name: "agent_cockpit",
    label: "Agent Cockpit",
    description: "Publish/list local Pi agent cockpit metadata stored in ~/.local/share/pi-cockpit/cockpit.sqlite.",
    parameters: Type.Object({
      action: Type.Optional(Type.String({ description: "publish, heartbeat, list, summary, events, workgroup, zellij-snapshot (default: list)" })),
      activeWithinMs: Type.Optional(Type.Number({ description: "Only list sessions with heartbeat within this many milliseconds" })),
      artifacts: Type.Optional(Type.Array(Type.String())),
      branch: Type.Optional(Type.String()),
      cwd: Type.Optional(Type.String()),
      dbPath: Type.Optional(Type.String({ description: "Override SQLite DB path" })),
      id: Type.Optional(Type.String({ description: "Alias for sessionId" })),
      includeExpired: Type.Optional(Type.Boolean()),
      json: Type.Optional(Type.Boolean({ description: "Render JSON instead of a compact text table" })),
      kind: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Number()),
      objective: Type.Optional(Type.String()),
      paneId: Type.Optional(Type.String()),
      paneTitle: Type.Optional(Type.String()),
      payload: Type.Optional(Type.Any({ description: "Event payload for action=events/event" })),
      pid: Type.Optional(Type.Number()),
      repo: Type.Optional(Type.String()),
      role: Type.Optional(Type.String()),
      sessionFile: Type.Optional(Type.String()),
      sessionId: Type.Optional(Type.String()),
      status: Type.Optional(Type.String()),
      statusIcon: Type.Optional(Type.String()),
      summary: Type.Optional(Type.String()),
      tabId: Type.Optional(Type.String()),
      tabName: Type.Optional(Type.String()),
      tags: Type.Optional(Type.Array(Type.String())),
      terminalBackend: Type.Optional(Type.String()),
      terminalSession: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      transcriptPath: Type.Optional(Type.String()),
      type: Type.Optional(Type.String({ description: "Event type for action=event" })),
      workgroup: Type.Optional(Type.String()),
      workgroupTitle: Type.Optional(Type.String()),
      zellijBin: Type.Optional(Type.String()),
      zellijSession: Type.Optional(Type.String()),
    }),
    async execute(_callId, rawParams, _signal, _onUpdate, ctx) {
      const params = asRecord(rawParams)
      const action = str(params.action) ?? "list"
      const options = { dbPath: str(params.dbPath) }

      try {
        if (action === "publish" || action === "heartbeat") {
          const contextInput = ctx ? baseInputFromContext(pi, ctx) : {}
          const record = await publishSession({ ...contextInput, ...inputFromParams(params) }, options)
          currentSessionId = record.id
          return {
            content: [{ type: "text", text: params.json ? JSON.stringify(record, null, 2) : `${record.id} ${record.status} ${record.title}` }],
            details: { record },
          }
        }

        if (action === "list") {
          const sessions = await listSessions({
            ...options,
            activeWithinMs: num(params.activeWithinMs),
            includeExpired: bool(params.includeExpired),
            limit: num(params.limit),
            workgroupId: str(params.workgroup),
          })
          return {
            content: [{ type: "text", text: params.json ? JSON.stringify(sessions, null, 2) : formatSessionList(sessions) }],
            details: { sessions },
          }
        }

        if (action === "summary") {
          const summaryData = await getCockpitSummary(options)
          return {
            content: [{ type: "text", text: params.json ? JSON.stringify(summaryData, null, 2) : formatSummary(summaryData) }],
            details: { summary: summaryData },
          }
        }

        if (action === "events") {
          const events = await listEvents({
            ...options,
            limit: num(params.limit),
            sessionId: str(params.sessionId) ?? str(params.id),
            workgroupId: str(params.workgroup),
          })
          return {
            content: [{ type: "text", text: JSON.stringify(events, null, 2) }],
            details: { events },
          }
        }

        if (action === "event") {
          const event = await recordEvent({
            payload: params.payload ?? {},
            sessionId: str(params.sessionId) ?? str(params.id) ?? currentSessionId,
            type: str(params.type) ?? "agent.note",
            workgroupId: str(params.workgroup) ?? null,
          }, options)
          return {
            content: [{ type: "text", text: params.json ? JSON.stringify(event, null, 2) : `${event.id} ${event.type}` }],
            details: { event },
          }
        }

        if (action === "workgroup") {
          const id = str(params.workgroup) ?? str(params.id)
          if (!id) throw new Error("workgroup or id is required for action=workgroup")
          const workgroup = await saveWorkgroup({
            id,
            objective: str(params.objective),
            status: str(params.status),
            title: str(params.title) ?? str(params.workgroupTitle),
          }, options)
          return {
            content: [{ type: "text", text: params.json ? JSON.stringify(workgroup, null, 2) : `${workgroup.id} ${workgroup.title}` }],
            details: { workgroup },
          }
        }

        if (action === "zellij-snapshot") {
          const snapshot = await importZellijSnapshot({
            ...options,
            session: str(params.zellijSession),
            zellijBin: str(params.zellijBin),
          })
          return {
            content: [{ type: "text", text: params.json ? JSON.stringify(snapshot, null, 2) : `saved ${snapshot.tabs.length} tab(s), ${snapshot.panes.length} pane(s)` }],
            details: { snapshot },
          }
        }

        return {
          content: [{ type: "text", text: `Error: unknown action ${action}` }],
          details: { error: `unknown action ${action}` },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { error: message },
        }
      }
    },
  })
}

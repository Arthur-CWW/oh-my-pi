import { Schema } from "effect"
import type { CuaDriverOptions, CuaDriverResult, JsonValue } from "./cua-driver"
export class ComputerUseError extends Schema.TaggedErrorClass<ComputerUseError>()("ComputerUseError", {
  reason: Schema.String,
}) {}

// ─── Typed Action Schemas ───────────────────────────────────────────

export const StatusAction = Schema.Struct({
  type: Schema.Literal("status"),
})
export type StatusAction = typeof StatusAction.Type

export const ListAppsAction = Schema.Struct({
  type: Schema.Literal("list_apps"),
})
export type ListAppsAction = typeof ListAppsAction.Type

export const GetAppStateAction = Schema.Struct({
  type: Schema.Literal("get_app_state"),
  pid: Schema.optional(Schema.Number),
  bundleId: Schema.optional(Schema.String),
  appName: Schema.optional(Schema.String),
})
export type GetAppStateAction = typeof GetAppStateAction.Type

export const CaptureAction = Schema.Struct({
  type: Schema.Literal("capture"),
  windowId: Schema.optional(Schema.Number),
  pid: Schema.optional(Schema.Number),
  appName: Schema.optional(Schema.String),
  bundleId: Schema.optional(Schema.String),
  captureMode: Schema.optional(Schema.Union([Schema.Literal("ax"), Schema.Literal("screencapture")])),
})
export type CaptureAction = typeof CaptureAction.Type

export const ClickAction = Schema.Struct({
  type: Schema.Literal("click"),
  x: Schema.optional(Schema.Number),
  y: Schema.optional(Schema.Number),
  elementIndex: Schema.optional(Schema.Number),
  button: Schema.optional(Schema.Union([Schema.Literal("left"), Schema.Literal("right"), Schema.Literal("double")])),
  windowId: Schema.optional(Schema.Number),
})
export type ClickAction = typeof ClickAction.Type

export const TypeAction = Schema.Struct({
  type: Schema.Literal("type"),
  text: Schema.String,
  elementIndex: Schema.optional(Schema.Number),
})
export type TypeAction = typeof TypeAction.Type

export const KeyAction = Schema.Struct({
  type: Schema.Literal("key"),
  key: Schema.String,
  elementIndex: Schema.optional(Schema.Number),
})
export type KeyAction = typeof KeyAction.Type

export const ComputerUseAction = Schema.Union([
  StatusAction,
  ListAppsAction,
  GetAppStateAction,
  CaptureAction,
  ClickAction,
  TypeAction,
  KeyAction,
])
export type ComputerUseAction = typeof ComputerUseAction.Type

// ─── Policy Classifier State ──────────────────────────────────────────

export interface PolicyState {
  hasFreshCapture: boolean
  lastCaptureTime?: number
  lastCapturedApp?: string
  lastCapturedWindowId?: number
}

// ─── Global State Manager (for Pi extension tool integration) ──────────

let globalPolicyState: PolicyState = {
  hasFreshCapture: false,
}

export function getGlobalPolicyState(): PolicyState {
  return globalPolicyState
}

export function setGlobalPolicyState(state: PolicyState): void {
  globalPolicyState = state
}

export function resetGlobalPolicyState(): void {
  globalPolicyState = {
    hasFreshCapture: false,
  }
}

// ─── Helper: Identify Indexed Actions ──────────────────────────────────

export function isIndexedAction(action: ComputerUseAction): boolean {
  if (action.type === "click" || action.type === "type" || action.type === "key") {
    return action.elementIndex !== undefined
  }
  return false
}

// ─── Helper: Policy Classifier & Blocklist ─────────────────────────────

export function isBlockedAction(action: ComputerUseAction): { blocked: boolean; reason?: string } {
  // 1. Blocked surfaces/applications check
  if (action.type === "get_app_state" || action.type === "capture") {
    const app = (action.appName || "").toLowerCase()
    const bundle = (action.bundleId || "").toLowerCase()

    const blockedApps = [
      "terminal",
      "iterm",
      "iterm2",
      "alacritty",
      "warp",
      "kitty",
      "hyper",
      "system settings",
      "system preferences",
      "keychain access",
      "activity monitor",
      "1password",
      "lastpass",
      "bitwarden",
      "dashlane",
    ]
    const blockedBundles = [
      "com.apple.terminal",
      "com.googlecode.iterm2",
      "com.apple.systempreferences",
      "com.apple.keychainaccess",
      "com.apple.activitymonitor",
    ]

    if (blockedApps.some((blocked) => app.includes(blocked))) {
      return { blocked: true, reason: `Policy violation: Target application "${action.appName}" is on the blocklist.` }
    }
    if (blockedBundles.some((blocked) => bundle.includes(blocked))) {
      return { blocked: true, reason: `Policy violation: Target bundle "${action.bundleId}" is on the blocklist.` }
    }
  }

  // 2. Blocked destructive actions in type inputs
  if (action.type === "type") {
    const text = action.text
    const dangerousPatterns = [
      /rm\s+-rf/,
      /\bsudo\b/,
      /\bshutdown\b/,
      /\breboot\b/,
      /kill\s+-9/,
      /\bmkfs\b/,
      /\bdd\s+if=/,
      /\bchown\b/,
      /\bchmod\b/,
    ]
    for (const pattern of dangerousPatterns) {
      if (pattern.test(text)) {
        return { blocked: true, reason: `Policy violation: Input text contains blocked/destructive pattern: "${text}"` }
      }
    }
  }

  // 3. Blocked hotkeys/keys
  if (action.type === "key") {
    const key = action.key.toLowerCase().replace(/\s+/g, "")
    const blockedKeys = [
      "cmd+q",
      "command+q",
      "cmd+alt+esc",
      "cmd+opt+esc",
      "command+option+escape",
      "ctrl+alt+delete",
      "control+option+delete",
      "power",
      "sleep",
    ]
    if (blockedKeys.some((blocked) => key.includes(blocked))) {
      return { blocked: true, reason: `Policy violation: Key combination "${action.key}" is blocked.` }
    }
  }

  return { blocked: false }
}

export function checkPolicy(action: ComputerUseAction, state: PolicyState): { allowed: boolean; reason?: string } {
  // Check blocklist first
  const blockCheck = isBlockedAction(action)
  if (blockCheck.blocked) {
    return { allowed: false, reason: blockCheck.reason }
  }

  // Require fresh capture for indexed actions
  if (isIndexedAction(action) && !state.hasFreshCapture) {
    return { allowed: false, reason: "Policy violation: Indexed actions require a fresh capture beforehand." }
  }

  return { allowed: true }
}

export function updatePolicyState(action: ComputerUseAction, state: PolicyState): PolicyState {
  if (action.type === "capture") {
    return {
      hasFreshCapture: true,
      lastCaptureTime: Date.now(),
      lastCapturedApp: action.appName,
      lastCapturedWindowId: action.windowId,
    }
  }
  if (isIndexedAction(action)) {
    // Consume the fresh capture so that the next indexed action requires another capture
    return {
      ...state,
      hasFreshCapture: false,
    }
  }
  return state
}

// ─── CuaDriver Mapping ──────────────────────────────────────────────

export function mapToCuaDriver(action: ComputerUseAction): CuaDriverOptions {
  switch (action.type) {
    case "status":
      return { action: "status" }
    case "list_apps":
      return { action: "list_apps" }
    case "get_app_state": {
      const args: Record<string, JsonValue> = {}
      if (action.pid !== undefined) args.pid = action.pid
      if (action.bundleId !== undefined) args.bundle_id = action.bundleId
      if (action.appName !== undefined) args.app_name = action.appName
      return { action: "get_window_state", args }
    }
    case "capture": {
      const args: Record<string, JsonValue> = {}
      if (action.windowId !== undefined) args.window_id = action.windowId
      if (action.pid !== undefined) args.pid = action.pid
      if (action.appName !== undefined) args.app_name = action.appName
      if (action.bundleId !== undefined) args.bundle_id = action.bundleId
      if (action.captureMode !== undefined) args.capture_mode = action.captureMode
      return { action: "capture", args }
    }
    case "click": {
      const actionName =
        action.button === "right"
          ? "right_click"
          : action.button === "double"
          ? "double_click"
          : "click"
      const args: Record<string, JsonValue> = {}
      if (action.x !== undefined) args.x = action.x
      if (action.y !== undefined) args.y = action.y
      if (action.elementIndex !== undefined) args.element_index = action.elementIndex
      if (action.windowId !== undefined) args.window_id = action.windowId
      return { action: actionName, args }
    }
    case "type": {
      const args: Record<string, JsonValue> = { text: action.text }
      if (action.elementIndex !== undefined) args.element_index = action.elementIndex
      return { action: "type_text", args }
    }
    case "key": {
      const args: Record<string, JsonValue> = { key: action.key }
      if (action.elementIndex !== undefined) args.element_index = action.elementIndex
      return { action: "press_key", args }
    }
  }
}

// ─── Pipeline Executor ──────────────────────────────────────────────

export function executeComputerUseAction(
  rawAction: unknown,
  state: PolicyState = globalPolicyState
): {
  allowed: boolean
  reason?: string
  mappedAction?: CuaDriverOptions
  updatedState?: PolicyState
} {
  let action: ComputerUseAction
  try {
    action = Schema.decodeUnknownSync(ComputerUseAction)(rawAction)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      allowed: false,
      reason: `Malformed action rejection: ${reason}`,
    }
  }

  const policy = checkPolicy(action, state)
  if (!policy.allowed) {
    return {
      allowed: false,
      reason: policy.reason,
    }
  }

  const mappedAction = mapToCuaDriver(action)
  const updatedState = updatePolicyState(action, state)

  return {
    allowed: true,
    mappedAction,
    updatedState,
  }
}

export interface RunComputerUseResult {
  allowed: boolean
  reason?: string
  mappedAction?: CuaDriverOptions
  updatedState?: PolicyState
  output?: CuaDriverResult
  error?: string
}

export async function runComputerUseAction<T>(
  rawAction: T,
  state: PolicyState,
  runner: (options: CuaDriverOptions) => Promise<CuaDriverResult>
): Promise<RunComputerUseResult> {
  const result = executeComputerUseAction(rawAction, state)
  if (!result.allowed) {
    return {
      allowed: false,
      reason: result.reason,
      updatedState: state,
    }
  }

  try {
    const output = await runner(result.mappedAction!)
    return {
      allowed: true,
      mappedAction: result.mappedAction,
      updatedState: result.updatedState,
      output,
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    return {
      allowed: true,
      mappedAction: result.mappedAction,
      updatedState: state,
      error: errorMsg,
    }
  }
}


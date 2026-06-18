import { execFile } from "node:child_process"
import { Effect } from "effect"
import { CuaDriverError, toErrorMessage } from "./schemas"

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type CuaDriverAction =
  | "status"
  | "permissions"
  | "list_apps"
  | "list_windows"
  | "launch_app"
  | "capture"
  | "get_window_state"
  | "click"
  | "double_click"
  | "right_click"
  | "type_text"
  | "press_key"
  | "hotkey"
  | "scroll"
  | "drag"
  | "set_value"
  | "page"
  | "zoom"
  | "start_recording"
  | "stop_recording"

export interface CuaDriverOptions {
  action: CuaDriverAction
  args?: JsonValue
  executable?: string
  timeoutMs?: number
}

export interface CuaDriverCommand {
  args: string[]
  file: string
  tool: string | null
}

export interface CuaDriverResult {
  action: CuaDriverAction
  command: string
  json: JsonValue | null
  text: string
}

const DEFAULT_CUA_DRIVER = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver"

const CALL_ACTIONS: Record<string, string> = {
  capture: "get_window_state",
  click: "click",
  double_click: "double_click",
  drag: "drag",
  get_window_state: "get_window_state",
  hotkey: "hotkey",
  launch_app: "launch_app",
  list_apps: "list_apps",
  list_windows: "list_windows",
  page: "page",
  permissions: "check_permissions",
  press_key: "press_key",
  right_click: "right_click",
  scroll: "scroll",
  set_value: "set_value",
  start_recording: "start_recording",
  stop_recording: "stop_recording",
  type_text: "type_text",
  zoom: "zoom",
}

export function isCuaDriverAction(value: string): value is CuaDriverAction {
  return value === "status" || Object.hasOwn(CALL_ACTIONS, value)
}

function cuaDriverExecutable(explicit?: string): string {
  return explicit?.trim()
    || process.env.CUA_DRIVER?.trim()
    || DEFAULT_CUA_DRIVER
}

function isJsonObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function commandText(command: CuaDriverCommand): string {
  return [command.file, ...command.args].map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(" ")
}

export function buildCuaDriverCommand(options: CuaDriverOptions): CuaDriverCommand {
  if (!isCuaDriverAction(options.action)) {
    throw new CuaDriverError({ reason: `Unsupported CuaDriver action: ${String(options.action)}` })
  }

  const file = cuaDriverExecutable(options.executable)
  if (options.action === "status") return { args: ["status"], file, tool: null }

  const tool = CALL_ACTIONS[options.action]
  if (!tool) throw new CuaDriverError({ reason: `Unsupported CuaDriver action: ${options.action}` })

  const args = isJsonObject(options.args) ? options.args : {}
  if (options.action === "permissions" && args.prompt === undefined) args.prompt = false
  return {
    args: ["call", tool, JSON.stringify(args)],
    file,
    tool,
  }
}

function execFileText(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeoutMs,
    }, (err, stdout, stderr) => {
      if (err) {
        reject(new CuaDriverError({ reason: stderr.trim() || toErrorMessage(err) }))
        return
      }
      resolve(stdout.trim())
    })
  })
}

function parseJson(text: string): JsonValue | null {
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return null
  }
}

async function runCuaDriverPromise(options: CuaDriverOptions): Promise<CuaDriverResult> {
  const command = buildCuaDriverCommand(options)
  const text = await execFileText(command.file, command.args, options.timeoutMs ?? 30_000)
  return {
    action: options.action,
    command: commandText(command),
    json: parseJson(text),
    text,
  }
}

export const runCuaDriver = Effect.fn("runCuaDriver")(function* (
  options: CuaDriverOptions,
) {
  return yield* Effect.tryPromise({
    try: () => runCuaDriverPromise(options),
    catch: (err) => err instanceof CuaDriverError
      ? err
      : new CuaDriverError({ reason: toErrorMessage(err) }),
  })
})

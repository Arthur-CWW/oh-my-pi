import { describe, expect, it } from "bun:test"
import { CuaDriverError } from "../src/schemas"
import { buildCuaDriverCommand, isCuaDriverAction } from "../src/cua-driver"

describe("cua-driver wrapper", () => {
  it("builds status command without shelling through the call adapter", () => {
    expect(buildCuaDriverCommand({
      action: "status",
      executable: "/tmp/cua-driver",
    })).toEqual({
      args: ["status"],
      file: "/tmp/cua-driver",
      tool: null,
    })
  })

  it("maps permissions to check_permissions with prompt disabled by default", () => {
    expect(buildCuaDriverCommand({
      action: "permissions",
      executable: "/tmp/cua-driver",
    })).toEqual({
      args: ["call", "check_permissions", "{\"prompt\":false}"],
      file: "/tmp/cua-driver",
      tool: "check_permissions",
    })
  })

  it("maps capture to get_window_state", () => {
    expect(buildCuaDriverCommand({
      action: "capture",
      args: { capture_mode: "ax", pid: 123, window_id: 456 },
      executable: "/tmp/cua-driver",
    })).toEqual({
      args: ["call", "get_window_state", "{\"capture_mode\":\"ax\",\"pid\":123,\"window_id\":456}"],
      file: "/tmp/cua-driver",
      tool: "get_window_state",
    })
  })

  it("rejects foreground and destructive CuaDriver tools", () => {
    expect(isCuaDriverAction("bring_to_front")).toBe(false)
    expect(isCuaDriverAction("kill_app")).toBe(false)
    expect(() => buildCuaDriverCommand({
      action: "bring_to_front" as "status",
      executable: "/tmp/cua-driver",
    })).toThrow(CuaDriverError)
  })
})

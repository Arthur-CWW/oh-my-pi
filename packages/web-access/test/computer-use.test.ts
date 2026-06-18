import { describe, expect, it } from "bun:test"
import {
  executeComputerUseAction,
  isBlockedAction,
  isIndexedAction,
  mapToCuaDriver,
  runComputerUseAction,
  updatePolicyState,
  type PolicyState,
} from "../src/computer-use"
import type { CuaDriverOptions } from "../src/cua-driver"

describe("computer_use prototype layer", () => {
  describe("Malformed action rejection", () => {
    it("rejects unknown action types", () => {
      const result = executeComputerUseAction({ type: "invalid_action" })
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("Malformed action rejection")
    })

    it("rejects invalid types for known actions", () => {
      const result = executeComputerUseAction({
        type: "click",
        elementIndex: "first", // elementIndex should be a number, not a string
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("Malformed action rejection")
    })

    it("rejects actions missing required fields", () => {
      const result = executeComputerUseAction({
        type: "type", // missing text
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("Malformed action rejection")
    })
  })

  describe("Safe mapping to CuaDriver", () => {
    it("maps status correctly", () => {
      const action = { type: "status" as const }
      const mapped = mapToCuaDriver(action)
      expect(mapped).toEqual({ action: "status" })
    })

    it("maps list_apps correctly", () => {
      const action = { type: "list_apps" as const }
      const mapped = mapToCuaDriver(action)
      expect(mapped).toEqual({ action: "list_apps" })
    })

    it("maps get_app_state correctly", () => {
      const action = { type: "get_app_state" as const, pid: 456, bundleId: "com.test.app" }
      const mapped = mapToCuaDriver(action)
      expect(mapped).toEqual({
        action: "get_window_state",
        args: { pid: 456, bundle_id: "com.test.app" },
      })
    })

    it("maps capture correctly", () => {
      const action = { type: "capture" as const, windowId: 789, captureMode: "ax" as const, bundleId: "com.test.app" }
      const mapped = mapToCuaDriver(action)
      expect(mapped).toEqual({
        action: "capture",
        args: { window_id: 789, capture_mode: "ax", bundle_id: "com.test.app" },
      })
    })

    it("maps click correctly", () => {
      // default left click
      expect(mapToCuaDriver({ type: "click" as const, x: 10, y: 20 })).toEqual({
        action: "click",
        args: { x: 10, y: 20 },
      })

      // right click
      expect(mapToCuaDriver({ type: "click" as const, button: "right" as const, elementIndex: 5 })).toEqual({
        action: "right_click",
        args: { element_index: 5 },
      })

      // double click
      expect(mapToCuaDriver({ type: "click" as const, button: "double" as const, windowId: 1 })).toEqual({
        action: "double_click",
        args: { window_id: 1 },
      })
    })

    it("maps type correctly", () => {
      expect(mapToCuaDriver({ type: "type" as const, text: "hello world", elementIndex: 12 })).toEqual({
        action: "type_text",
        args: { text: "hello world", element_index: 12 },
      })
    })

    it("maps key correctly", () => {
      expect(mapToCuaDriver({ type: "key" as const, key: "enter" })).toEqual({
        action: "press_key",
        args: { key: "enter" },
      })
    })
  })

  describe("Fresh-capture requirement", () => {
    it("correctly identifies indexed actions", () => {
      expect(isIndexedAction({ type: "status" })).toBe(false)
      expect(isIndexedAction({ type: "click", x: 10, y: 20 })).toBe(false)
      expect(isIndexedAction({ type: "click", elementIndex: 1 })).toBe(true)
      expect(isIndexedAction({ type: "type", text: "hello" })).toBe(false)
      expect(isIndexedAction({ type: "type", text: "hello", elementIndex: 2 })).toBe(true)
      expect(isIndexedAction({ type: "key", key: "enter" })).toBe(false)
      expect(isIndexedAction({ type: "key", key: "enter", elementIndex: 3 })).toBe(true)
    })

    it("blocks indexed action if there is no fresh capture", () => {
      const state: PolicyState = { hasFreshCapture: false }
      const action = { type: "click" as const, elementIndex: 1 }

      const result = executeComputerUseAction(action, state)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("Indexed actions require a fresh capture beforehand")
    })

    it("allows indexed action if capture was performed first, and consumes freshness", () => {
      let state: PolicyState = { hasFreshCapture: false }

      // 1. Perform capture
      const captureAction = { type: "capture" as const, appName: "Safari" }
      const captureResult = executeComputerUseAction(captureAction, state)
      expect(captureResult.allowed).toBe(true)
      expect(captureResult.updatedState?.hasFreshCapture).toBe(true)
      state = captureResult.updatedState!

      // 2. Perform click with elementIndex
      const clickAction = { type: "click" as const, elementIndex: 42 }
      const clickResult = executeComputerUseAction(clickAction, state)
      expect(clickResult.allowed).toBe(true)
      // Check that it mapped to CuaDriver
      expect(clickResult.mappedAction?.action).toBe("click")
      expect(clickResult.mappedAction?.args).toEqual({ element_index: 42 })
      // Check that the freshness is consumed
      expect(clickResult.updatedState?.hasFreshCapture).toBe(false)
    })
  })

  describe("Blocked destructive actions & foreground applications", () => {
    it("blocks dangerous apps in capture and get_app_state", () => {
      const dangerousApps = ["Terminal.app", "iTerm2", "warp", "System Settings", "Keychain Access", "Activity Monitor", "1Password", "Bitwarden"]
      for (const app of dangerousApps) {
        expect(isBlockedAction({ type: "capture", appName: app }).blocked).toBe(true)
        expect(isBlockedAction({ type: "get_app_state", appName: app }).blocked).toBe(true)
      }

      const dangerousBundles = ["com.apple.terminal", "com.googlecode.iterm2", "com.apple.systempreferences", "com.apple.keychainaccess"]
      for (const bundle of dangerousBundles) {
        expect(isBlockedAction({ type: "capture", bundleId: bundle }).blocked).toBe(true)
        expect(isBlockedAction({ type: "get_app_state", bundleId: bundle }).blocked).toBe(true)
      }

      // Safe app should not be blocked
      expect(isBlockedAction({ type: "capture", appName: "Safari" }).blocked).toBe(false)
      expect(isBlockedAction({ type: "get_app_state", bundleId: "com.apple.Safari" }).blocked).toBe(false)
    })

    it("blocks destructive command patterns in type actions", () => {
      const destructiveTexts = [
        "rm -rf /",
        "sudo apt-get install",
        "shutdown -h now",
        "reboot",
        "kill -9 1234",
        "dd if=/dev/zero of=/dev/sda",
        "chown -R root:root /",
        "chmod 777 /bin",
      ]
      for (const text of destructiveTexts) {
        expect(isBlockedAction({ type: "type", text }).blocked).toBe(true)
      }

      // Safe text should not be blocked
      expect(isBlockedAction({ type: "type", text: "hello world" }).blocked).toBe(false)
      expect(isBlockedAction({ type: "type", text: "sudoer is a word" }).blocked).toBe(false)
    })

    it("blocks dangerous keys/combinations", () => {
      const dangerousKeys = ["cmd+q", "command+q", "cmd+opt+esc", "ctrl+alt+delete", "power", "sleep"]
      for (const key of dangerousKeys) {
        expect(isBlockedAction({ type: "key", key }).blocked).toBe(true)
      }

      // Safe keys should not be blocked
      expect(isBlockedAction({ type: "key", key: "enter" }).blocked).toBe(false)
      expect(isBlockedAction({ type: "key", key: "cmd+c" }).blocked).toBe(false)
    })
  })
  describe("Execution boundary with mock runner", () => {
    it("does not invoke runner if action is blocked by policy", async () => {
      const state: PolicyState = { hasFreshCapture: false }
      // Click with elementIndex requires fresh capture, so it's blocked here
      const action = { type: "click" as const, elementIndex: 5 }
      let runnerCalled = false
      const runner = async () => {
        runnerCalled = true
        return { action: "click" as const, command: "mock", json: null, text: "" }
      }

      const result = await runComputerUseAction(action, state, runner)
      expect(result.allowed).toBe(false)
      expect(result.reason).toContain("Policy violation")
      expect(runnerCalled).toBe(false)
    })

    it("invokes runner with mapped options if allowed", async () => {
      const state: PolicyState = { hasFreshCapture: true }
      const action = { type: "click" as const, elementIndex: 5 }
      const passedOptions: CuaDriverOptions[] = []
      const runner = async (options: CuaDriverOptions) => {
        passedOptions.push(options)
        return { action: "click" as const, command: "mock", json: { success: true }, text: "ok" }
      }

      const result = await runComputerUseAction(action, state, runner)
      expect(result.allowed).toBe(true)
      expect(passedOptions).toEqual([
        {
          action: "click",
          args: { element_index: 5 },
        },
      ])
      expect(result.output).toEqual({
        action: "click",
        command: "mock",
        json: { success: true },
        text: "ok",
      })
      expect(result.error).toBeUndefined()
    })

    it("captures runner errors safely", async () => {
      const state: PolicyState = { hasFreshCapture: false }
      const action = { type: "status" as const }
      const runner = async () => {
        throw new Error("CuaDriver execution failed")
      }

      const result = await runComputerUseAction(action, state, runner)
      expect(result.allowed).toBe(true)
      expect(result.error).toBe("CuaDriver execution failed")
      expect(result.output).toBeUndefined()
    })

    it("runner failure after indexed action leaves hasFreshCapture true", async () => {
      const state: PolicyState = { hasFreshCapture: true }
      const action = { type: "click" as const, elementIndex: 5 }
      const runner = async () => {
        throw new Error("CuaDriver execution failed")
      }

      const result = await runComputerUseAction(action, state, runner)
      expect(result.allowed).toBe(true)
      expect(result.error).toBe("CuaDriver execution failed")
      expect(result.updatedState?.hasFreshCapture).toBe(true)
    })

    it("successful indexed action consumes hasFreshCapture", async () => {
      const state: PolicyState = { hasFreshCapture: true }
      const action = { type: "click" as const, elementIndex: 5 }
      const runner = async () => {
        return { action: "click" as const, command: "mock", json: { success: true }, text: "ok" }
      }

      const result = await runComputerUseAction(action, state, runner)
      expect(result.allowed).toBe(true)
      expect(result.error).toBeUndefined()
      expect(result.updatedState?.hasFreshCapture).toBe(false)
    })
  })
})

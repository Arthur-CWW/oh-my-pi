# Hermes Agent Computer Use / CuaDriver Notes

Date: 2026-06-09

## What Hermes is doing

Hermes Agent does **not** reimplement the low-level macOS Computer Use stack. It wraps upstream `trycua/cua-driver` behind a model-friendly `computer_use` tool and an agent skill.

Evidence:

- Hermes' backend docstring says it speaks MCP over stdio to `cua-driver`, installed via upstream `trycua/cua` install script, and notes the private SkyLight / AX SPIs used underneath: [`tools/computer_use/cua_backend.py`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/tools/computer_use/cua_backend.py#L1-L12).
- Hermes launches `cua-driver mcp` via the Python MCP SDK using `StdioServerParameters`: [`cua_backend.py`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/tools/computer_use/cua_backend.py#L271-L283).
- The public tool registration is a single tool named `computer_use`: [`tools/computer_use_tool.py`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/tools/computer_use_tool.py#L19-L31).
- The user-facing schema tells models to `capture(mode='som')` first, then click by `element` index: [`tools/computer_use/schema.py`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/tools/computer_use/schema.py#L16-L27).

## Hermes wrapper shape

Hermes deliberately hides CuaDriver's lower-level `(pid, window_id, element_index)` API from the model.

- `capture(mode, app)` calls CuaDriver `list_windows`, chooses a target window, stores `_active_pid` / `_active_window_id`, then calls `get_window_state` for SOM/AX or `screenshot` for vision: [`cua_backend.py`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/tools/computer_use/cua_backend.py#L425-L515).
- Later actions reuse that cached active pid/window id and translate `element=N` into CuaDriver `element_index=N`: [`cua_backend.py`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/tools/computer_use/cua_backend.py#L548-L590).
- `focus_app` is intentionally a window selector, not a foreground operation; `raise_window=True` is ignored by the backend to preserve background behavior: [`cua_backend.py`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/tools/computer_use/cua_backend.py#L714-L766).
- `capture_after=True` performs a follow-up SOM capture against the last app context, avoiding accidental fallback to the human's frontmost app: [`tools/computer_use/tool.py`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/tools/computer_use/tool.py#L674-L692).

## Safety / policy layer

Hermes adds a modest policy layer around CuaDriver:

- Read-only actions are `capture`, `wait`, and `list_apps`; mutating actions include click/type/key/scroll/drag/set_value/focus_app: [`tools/computer_use/tool.py`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/tools/computer_use/tool.py#L72-L78).
- It hard-blocks destructive shortcuts like lock screen, logout, and empty trash: [`tool.py`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/tools/computer_use/tool.py#L82-L89).
- It hard-blocks dangerous text patterns such as `curl | bash`, `wget | sh`, `sudo rm -rf`, and fork bombs: [`tool.py`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/tools/computer_use/tool.py#L100-L108).
- Destructive actions flow through an approval callback when one is registered: [`tool.py`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/tools/computer_use/tool.py#L243-L280).

## Installation / enablement

Hermes exposes CuaDriver as a tool category named “Computer Use (macOS)” with provider “cua-driver (background)”: [`hermes_cli/tools_config.py`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/hermes_cli/tools_config.py#L519-L536).

Both `hermes tools` and `hermes computer-use install` route to the upstream installer:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"
```

Evidence: [`install_cua_driver`](https://github.com/NousResearch/hermes-agent/blob/b5f8996ccc2163ef06b4265d0882019fc24b0682/hermes_cli/tools_config.py#L700-L829).

## What CuaDriver itself provides

CuaDriver is the native macOS implementation layer.

- README: “Background computer-use driver for any agents. Speaks MCP over stdio; drives native macOS apps without stealing focus”: [`libs/cua-driver/README.md`](https://github.com/trycua/cua/blob/2925b491c20595ae850e3e4a05d6fea188e8f40a/libs/cua-driver/README.md#L1-L3).
- Tool registry includes `list_apps`, `list_windows`, `launch_app`, `screenshot`, `scroll`, `type_text`, `press_key`, `hotkey`, `get_window_state`, `click`, `double_click`, `right_click`, `drag`, `set_value`, `page`, and config/recording tools: [`ToolRegistry.swift`](https://github.com/trycua/cua/blob/2925b491c20595ae850e3e4a05d6fea188e8f40a/libs/cua-driver/swift/Sources/CuaDriverServer/ToolRegistry.swift#L231-L259).
- `get_window_state` walks the AX tree, tags actionable elements with `element_index`, returns screenshot as a native MCP image block, and requires `(pid, window_id)`: [`GetWindowStateTool.swift`](https://github.com/trycua/cua/blob/2925b491c20595ae850e3e4a05d6fea188e8f40a/libs/cua-driver/swift/Sources/CuaDriverServer/Tools/GetWindowStateTool.swift#L12-L65).
- `click` has two modes: AX `element_index + window_id` or pixel `(x, y)`, with element-indexed clicks preferred because they are pure AX RPC and work in background/hidden windows: [`ClickTool.swift`](https://github.com/trycua/cua/blob/2925b491c20595ae850e3e4a05d6fea188e8f40a/libs/cua-driver/swift/Sources/CuaDriverServer/Tools/ClickTool.swift#L11-L65).
- `launch_app` uses `NSWorkspace.OpenConfiguration.activates = false` plus focus-steal suppression to launch in the background and return windows: [`LaunchAppTool.swift`](https://github.com/trycua/cua/blob/2925b491c20595ae850e3e4a05d6fea188e8f40a/libs/cua-driver/swift/Sources/CuaDriverServer/Tools/LaunchAppTool.swift#L6-L18).
- Low-level background input relies on private SkyLight paths like `SLEventPostToPid`, raw field stamping, and `SLPSPostEventRecordTo`: [`SkyLightEventPost.swift`](https://github.com/trycua/cua/blob/2925b491c20595ae850e3e4a05d6fea188e8f40a/libs/cua-driver/swift/Sources/CuaDriverCore/Input/SkyLightEventPost.swift#L6-L27), [`FocusWithoutRaise.swift`](https://github.com/trycua/cua/blob/2925b491c20595ae850e3e4a05d6fea188e8f40a/libs/cua-driver/swift/Sources/CuaDriverCore/Input/FocusWithoutRaise.swift#L1-L43).

## Practical takeaways for Pi / VoiceInk

1. **Do not rebuild the native layer first.** For unlocked/background macOS UI loops, wrap installed `cua-driver` and spend effort on Pi-side policy, prompts, and artifact handling.
2. **Expose a Hermes-style ergonomic tool first.** A single `computer_use` action-discriminator tool is much easier for models than CuaDriver's raw tool set.
3. **Keep CuaDriver's invariant:** inspect (`get_window_state`/SOM) immediately before element-indexed mutation; never reuse stale element indices after a new snapshot or UI shift.
4. **Prefer app/window-scoped capture.** It reduces token cost and avoids leaking unrelated windows.
5. **For VoiceInk smoke tests:** keep direct binary launch with `VOICEINK_CUA_SMOKE=1` / `VOICEINK_SUPPRESS_FOREGROUND=1`, then use CuaDriver to inspect/click settings/history without foregrounding the app.
6. **Locked-use remains separate.** CuaDriver solves unlocked same-session background control; it does not remove the need for a separately reviewed helper/authorization design if Pi ever needs lock-screen operation.

## Suggested Pi implementation path

- Phase 0: add a Pi skill documenting the CuaDriver workflow and no-foreground rules.
- Phase 1: add a thin Pi `computer_use` wrapper that shells to `cua-driver` CLI or speaks MCP over stdio.
- Phase 2: add policy/approval: allowed bundle IDs, deny terminal/security/password/payment surfaces, fresh snapshot before write, short per-task lease.
- Phase 3: add artifact handling: optional `screenshot_out_file`, frontmost-app sampling, and run summaries for app smoke tests.
- Phase 4: only later, revisit a signed native helper / locked-use mode if CuaDriver is insufficient.

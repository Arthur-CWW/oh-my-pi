---
name: "codex-plugin-build-macos-apps"
description: "Build, run, test, debug, instrument, and implement local macOS apps using Xcode, SwiftUI, AppKit interop, unified logging, and shell-first desktop workflows."
---

# Build macOS Apps (Codex plugin router)

This is a Pi router skill for a vendored OpenAI Codex plugin. Use it when the task matches the plugin description, then load the most relevant detailed skill below with the `read` tool. Do not assume all subskills are in context.

## How to use

1. Pick the narrowest subskill that matches the user task.
2. Read that subskill's `SKILL.md` before acting.
3. Resolve relative references against that subskill directory.
4. If no subskill fits, use the plugin-level description as general guidance and say what is missing.

## Subskills

- `appkit-interop` — Bridge macOS SwiftUI into AppKit narrowly. Use when implementing representables, reaching NSWindow or panels, handling menus, or using the responder chain.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-macos-apps/skills/appkit-interop/SKILL.md`
- `build-run-debug` — Build, run, and debug macOS apps with shell-first Xcode and Swift workflows. Use when launching apps or diagnosing build, startup, or runtime failures.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-macos-apps/skills/build-run-debug/SKILL.md`
- `liquid-glass` — Implement and review macOS SwiftUI Liquid Glass UI. Use when adopting system glass, removing conflicting custom chrome, or building glass surfaces.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-macos-apps/skills/liquid-glass/SKILL.md`
- `packaging-notarization` — Prepare macOS packaging and notarization workflows. Use when archiving apps, validating bundles, or explaining distribution-only failures.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-macos-apps/skills/packaging-notarization/SKILL.md`
- `signing-entitlements` — Inspect macOS signing, entitlements, and Gatekeeper issues. Use when diagnosing code signing, sandbox, hardened runtime, or trust failures.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-macos-apps/skills/signing-entitlements/SKILL.md`
- `swiftpm-macos` — Build, run, and test SwiftPM macOS packages and executables. Use when the repo is package-first or has no Xcode project.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-macos-apps/skills/swiftpm-macos/SKILL.md`
- `swiftui-patterns` — Build macOS SwiftUI scenes and components with desktop patterns. Use when shaping windows, commands, toolbars, settings, split views, or inspectors.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-macos-apps/skills/swiftui-patterns/SKILL.md`
- `telemetry` — Add and verify lightweight macOS runtime telemetry. Use when wiring Logger events or inspecting logs for windows, sidebars, menus, and actions.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-macos-apps/skills/telemetry/SKILL.md`
- `test-triage` — Triage macOS tests across Xcode and SwiftPM. Use when narrowing failures, explaining assertions or crashes, or separating setup from regressions.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-macos-apps/skills/test-triage/SKILL.md`
- `view-refactor` — Refactor macOS SwiftUI views and scenes into stable structure. Use when splitting large views, tightening scene state, or narrowing AppKit escapes.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-macos-apps/skills/view-refactor/SKILL.md`
- `window-management` — Customize macOS SwiftUI windows and scene behavior. Use when tuning window chrome, drag regions, placement, restoration, launch behavior, or borderless windows.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-macos-apps/skills/window-management/SKILL.md`

## Plugin source

- Vendored plugin: `vendor/openai/codex-plugin-cache/plugins/build-macos-apps`
- Direct Pi-compatible generated subskills, if enabled in all-skills mode: `vendor/openai/codex-pi-skills/build-macos-apps`

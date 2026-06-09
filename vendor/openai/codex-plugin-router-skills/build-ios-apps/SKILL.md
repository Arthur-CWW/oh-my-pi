---
name: "codex-plugin-build-ios-apps"
description: "Build iOS apps with workflows for App Intents, SwiftUI UI work, Simulator mirroring, performance profiling, leak investigation, and simulator debugging."
---

# Build iOS Apps (Codex plugin router)

This is a Pi router skill for a vendored OpenAI Codex plugin. Use it when the task matches the plugin description, then load the most relevant detailed skill below with the `read` tool. Do not assume all subskills are in context.

## How to use

1. Pick the narrowest subskill that matches the user task.
2. Read that subskill's `SKILL.md` before acting.
3. Resolve relative references against that subskill directory.
4. If no subskill fits, use the plugin-level description as general guidance and say what is missing.

## Subskills

- `ios-app-intents` — Design App Intents, app entities, and App Shortcuts for iOS system surfaces. Use when exposing app actions or content to Shortcuts, Siri, Spotlight, widgets, or controls.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-ios-apps/skills/ios-app-intents/SKILL.md`
- `ios-debugger-agent` — Build, run, and debug iOS apps on Simulator with XcodeBuildMCP. Use when launching an app, inspecting simulator UI or logs, or diagnosing runtime behavior.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-ios-apps/skills/ios-debugger-agent/SKILL.md`
- `ios-ettrace-performance` — Capture and interpret iOS Simulator ETTrace profiles. Use when profiling launch or runtime latency, comparing traces, or finding CPU-heavy stacks.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-ios-apps/skills/ios-ettrace-performance/SKILL.md`
- `ios-memgraph-leaks` — Capture and inspect iOS leaks and memgraphs. Use when debugging leaked objects, retain cycles, memory growth, or before/after leak evidence.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-ios-apps/skills/ios-memgraph-leaks/SKILL.md`
- `ios-simulator-browser` — Mirror an iOS Simulator into the Codex in-app browser and render SwiftUI previews from importable Swift packages in that simulator with hot reload. Use when a user wants to watch or interact with an iOS app in the browser, see a SwiftUI preview outside Xcode Canvas, iterate live on a preview, or capture browser-visible simulator proof.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-ios-apps/skills/ios-simulator-browser/SKILL.md`
- `swiftui-liquid-glass` — Implement and review iOS 26+ SwiftUI Liquid Glass UI. Use when adopting Liquid Glass or checking its correctness, performance, and design fit.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-ios-apps/skills/swiftui-liquid-glass/SKILL.md`
- `swiftui-performance-audit` — Audit SwiftUI runtime performance from code first. Use when diagnosing slow rendering, janky scrolling, expensive updates, or profiling needs.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-ios-apps/skills/swiftui-performance-audit/SKILL.md`
- `swiftui-ui-patterns` — Build and refactor SwiftUI UI with component patterns and examples. Use when shaping navigation, state, layouts, controls, or screen composition.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-ios-apps/skills/swiftui-ui-patterns/SKILL.md`
- `swiftui-view-refactor` — Refactor SwiftUI view files into stable, testable structure. Use when splitting large views, tightening data flow, or cleaning Observation ownership.
  - Path: `vendor/openai/codex-plugin-cache/plugins/build-ios-apps/skills/swiftui-view-refactor/SKILL.md`

## Plugin source

- Vendored plugin: `vendor/openai/codex-plugin-cache/plugins/build-ios-apps`
- Direct Pi-compatible generated subskills, if enabled in all-skills mode: `vendor/openai/codex-pi-skills/build-ios-apps`

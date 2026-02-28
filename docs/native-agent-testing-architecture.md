# Native Testing Agent Architecture (Native-First, Minimal Abstraction)

## Goal

Design a **powerful local testing agent** for native applications with two operating modes:

Related deep comparison:
- `docs/native-agent-tooling-comparison.md` (detailed ecosystem/tooling comparison, features, usage examples, health snapshot)

1. **Black-box mode (no source code access)**
   - Test/automate third-party native apps
   - Debug automations, reproduce behavior, inspect workflows
2. **White-box mode (source code access)**
   - Live-debug app under development
   - Run E2E, interaction, and regression tests while iterating

Primary constraint:
- Keep the stack **native-first** with **minimal abstraction** so debugging focuses on app/OS behavior, not framework quirks.

---

## Guiding Principles

1. **Native APIs first**
   - Use OS-native accessibility, input, screenshot, and debug tooling directly.
2. **Thin orchestration only**
   - Shared layer should handle scheduling, trace logging, replay, retry, and policy.
   - Avoid thick cross-platform “unified UI object model.”
3. **Capability-aware execution**
   - Runtime detects available capabilities and chooses best strategy.
4. **Deterministic observability**
   - Every step is recorded (before/after screenshot, accessibility tree, action payload, result).
5. **Fallback over fantasy**
   - Prefer semantic automation; fallback to vision; fallback to input injection.

---

## Approach Taxonomy

### A) Accessibility-tree automation (semantic)
- macOS: AX / Accessibility APIs
- Windows: UI Automation (UIA)
- Linux: AT-SPI

Pros:
- Robust selectors (role/name/state)
- Better resilience to layout shifts

Cons:
- Limited by app accessibility quality

### B) Native input injection
- Mouse/keyboard/window interactions via OS APIs

Pros:
- Broad compatibility

Cons:
- Flakier due to timing/focus/resolution/state

### C) Vision-grounded automation
- Screenshot + OCR + detector/LLM for grounding

Pros:
- Works when accessibility metadata is poor/missing

Cons:
- Most brittle unless paired with strict verification/retry

### D) In-app native test frameworks (white-box)
- macOS XCTest/XCUITest, platform-native harnesses

Pros:
- Highest determinism for owned app

Cons:
- Not usable for closed third-party apps

### E) VM/live environment visual checks
- Controlled VM/session + screenshot diff assertions

Pros:
- Reproducible, CI-friendly

Cons:
- Slower and infra-heavy

---

## Recommended System Design

## 1) Shared thin orchestration layer

The only shared contract should be an **event/action envelope**:

```json
{
  "sessionId": "...",
  "stepId": 12,
  "backend": "mac_ax",
  "action": "performAction",
  "payload": {"native": "fields"},
  "result": {"ok": true, "nativeError": null}
}
```

Keep payload backend-native; do not over-normalize.

Core responsibilities:
- planner loop
- capability routing
- trace store + replay
- retry/fallback policy
- assertion engine

Not responsible for:
- re-modeling platform-specific semantics into a synthetic API

---

## 2) Black-box mode (no source access)

### Execution policy
1. Accessibility action attempt
2. Vision-grounded fallback
3. Raw coordinate/input fallback
4. Post-action verification
5. Recovery (retry with different strategy)

### Required components
- **Sensors**
  - screenshot capture
  - OCR/detection
  - accessibility snapshot
  - active window/process metadata
- **Action backends**
  - semantic actions (role/name/path)
  - raw input actions (click/type/hotkey)
- **Verifier**
  - expected UI state checks (text present, dialog dismissed, tab switched)
- **Recovery engine**
  - timeout handling
  - focus restoration
  - modal/dialog interruption handlers
- **Trace/replay**
  - full step timeline for debugging

### Why this works
Semantic first = robustness; vision/input fallback = coverage.

---

## 3) White-box mode (source access)

### Execution policy
- Run fast deterministic tests first (unit/native integration)
- Run agent E2E flows second (user-like behavior)
- On failure: inspect logs/stack/snapshots, patch, rebuild, rerun targeted tests

### Required components
- **Debug hooks** (dev-only)
  - structured app logs
  - optional internal state probes
  - crash/stack capture
- **Build/run/test loop**
  - focused test execution
  - automatic rerun after patch
- **E2E runner**
  - same interaction model as black-box mode
  - plus stable app-provided selectors/IDs where available

### Why this works
You get deterministic correctness + realistic interaction coverage.

---

## Platform Backends (Native Capability Targets)

## macOS
- Accessibility: AXUIElement
- Input: CGEvent
- Screen capture: ScreenCaptureKit / Quartz
- Owned-app UI tests: XCTest/XCUITest
- Debug: LLDB / Instruments

## Windows
- Accessibility: UIA (COM)
- Input: SendInput
- Screen capture: Desktop Duplication API
- Debug/telemetry: ETW + WinDbg/cdb

## Linux
- Accessibility: AT-SPI
- Input: XTest (X11), compositor-limited on Wayland
- Screen capture: compositor-specific paths
- Recommendation: controlled VM/compositor for reproducibility

---

## Robustness Model

Each action should include:
- `preconditions`
- `primary locator`
- `fallback locators`
- `verification predicates`
- `recovery strategy`

Example flow:
1. locate target by accessibility role+name
2. click
3. verify state transition
4. if failed: relocate using OCR text region
5. click by coordinates
6. verify again

---

## Known Hard Limits

Some surfaces remain constrained by OS/security policy:
- permission prompts / secure input
- protected windows/fields
- anti-automation controls
- Wayland restrictions

Design must include capability detection + graceful degradation.

---

## Security & Safety Guardrails

- Explicit user confirmation for destructive actions
- Secret/PII redaction in traces
- Allowlist-based app/process scope
- Strict local-only execution by default
- Audit log for all actions

---

## Suggested MVP Phases

1. **Phase 1: Native backends + trace store**
   - Accessibility + screenshot + input + replay
2. **Phase 2: Verification + recovery**
   - State assertions, retries, interruption handling
3. **Phase 3: Vision fallback**
   - OCR/detection integrated into locator pipeline
4. **Phase 4: White-box dev loop**
   - patch/build/test automation + debug hooks
5. **Phase 5: CI reproducibility**
   - VM sessions + golden screenshot checks

---

## CLI-First (Hacker-Mode) Operating Model

To match a Puppeteer-like developer experience, the system should ship as a **real-time CLI tool**, not only a test runner.

Design target:
- Fast local feedback loops
- Pipe-friendly output
- One-liners and shell scripts
- Optional JS/TS scripting without hiding native details

### Runtime shape

- `native-agentd` (local daemon): owns OS permissions, sessions, event stream, device backends
- `na` (CLI client): interactive and non-interactive control over `native-agentd`
- `@native-agent/client` (Node/Bun client): thin SDK over the same CLI/IPC protocol

This keeps one execution engine with multiple frontends.

### CLI interaction styles

1. **One-shot command mode**

```bash
na app ls
na session start --app "Calculator"
na tree snapshot --backend mac_ax --json
na act click --role button --name "="
na assert text --contains "42"
```

2. **Interactive REPL mode**

```bash
na repl
na> attach "com.apple.calculator"
na> tree.find role=button name="7"
na> click role=button name="7"
na> key "+"
na> key "3"
na> key "="
na> assert text~"10"
```

3. **Streaming mode (JSONL events)**

```bash
na run script.na --stream jsonl | jq 'select(.type=="action_result")'
```

4. **Shell-pipeline mode**

```bash
na tree snapshot --json | jq '.nodes[] | select(.role=="AXButton")'
```

### Command philosophy

Prefer low-level, explicit commands that mirror native capabilities:
- `tree snapshot` (raw AX/UIA/AT-SPI)
- `screen shot` / `screen ocr`
- `input click/move/type/key`
- `act perform` (native accessibility action)
- `assert` (postcondition checks)
- `trace` (inspect/replay)
- `debug attach` (white-box mode)

Avoid high-level synthetic commands that hide backend behavior.

---

## Scriptability Model

Use a tiny line-oriented command language (`.na`) with minimal syntax and deterministic behavior:

```txt
attach "com.apple.finder"
wait window name~"Finder"
click role=AXButton name="New Folder"
type "demo\n"
assert exists role=AXStaticText name="demo"
```

And equivalent JS/TS scripting for Node/Bun:

```ts
import { createClient } from "@native-agent/client";

const na = await createClient();
await na.attachApp({ bundleId: "com.apple.calculator" });
await na.click({ backend: "mac_ax", role: "AXButton", name: "7" });
await na.key({ text: "+3=" });
await na.assertText({ contains: "10" });
```

Key requirement: JS client is thin transport + helpers only; do not re-abstract native semantics.

---

## Black-box CLI Workflow (No Source)

Typical workflow:
1. Attach app/window
2. Inspect raw accessibility tree and screenshot
3. Execute native action
4. Verify
5. Retry/fallback (vision/input)
6. Save trace

Example:

```bash
na attach --app "Slack"
na tree snapshot --backend win_uia --out tree.json
na act click --backend win_uia --role Button --name "New message"
na input type "hello from native agent"
na assert exists --text "hello from native agent"
na trace save --out traces/slack-message-1
```

---

## White-box CLI Workflow (Source Available)

Typical workflow:
1. Start debug session
2. Run targeted test(s)
3. Reproduce interactively if failing
4. Patch + rebuild
5. Re-run targeted checks

Example:

```bash
na dev attach --cwd .
na dev test --filter "ThemeTests::testSwitchingSystemTheme"
na debug tail-logs --follow
na debug breakpoint --symbol "ThemeManager.apply"
na dev patch --file src/theme.ts --apply ./fix.patch
na dev test --filter "ThemeTests::testSwitchingSystemTheme"
```

---

## Output and Observability (Must-Have)

Every command should support:
- `--json` for machine-readable output
- `--stream jsonl` for real-time event processing
- `--trace-id` and `--session-id`
- reproducible replay: `na trace replay <id>`

Event record minimum:
- timestamp
- backend
- command/action
- native payload
- before/after screenshot refs
- before/after tree refs
- result/error

This is critical for debugging automation failures quickly.

---

## Suggested CLI MVP Commands

- `na app ls`
- `na session start|stop|list`
- `na attach`
- `na tree snapshot`
- `na screen shot|ocr`
- `na act click|press|set-value`
- `na input click|move|type|key|scroll`
- `na assert exists|text|state`
- `na trace save|show|replay`
- `na repl`
- `na dev attach|test|build|patch|logs`

---

## Decision Summary

For a truly powerful agent with minimal framework friction:
- Use **native platform APIs directly**
- Keep only a **thin orchestration and trace layer**
- Implement **semantic → vision → input fallback**
- Provide a **CLI-first, real-time, scriptable interface** (REPL + one-shot + JSONL stream)
- Split operation into **black-box** and **white-box** modes with shared observability

This maximizes control, debuggability, and feature coverage while minimizing abstraction-induced blind spots and preserving a hacker-friendly workflow.

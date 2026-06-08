# Pi Computer Use + Locked macOS Mode Plan

Origin Pi session ID: `019e905c-dd8e-7a36-801d-5663bf67ee54`

## Goal

Design a safe, clean-room Pi equivalent of Codex Computer Use, with an optional macOS locked-use mode that can continue a narrowly scoped desktop task after the Mac locks.

Locked-use mode is **not** a TypeScript-only Pi extension. It requires a reviewed, signed native macOS helper and installer because it participates in Screen Recording, Accessibility, lock-screen behavior, and the macOS authorization flow.

## Non-goals

- Do not copy proprietary Codex code.
- Do not install or modify macOS authorization mechanisms from an agent session.
- Do not build a general remote-unlock mechanism.
- Do not allow automating Pi itself, terminal apps, admin authentication, security prompts, password managers, payment/account settings, or arbitrary apps without approval.

## Existing repo assets

- `packages/browser-use/` already provides clean-room CDP browser automation for Pi.
- `codex-decomp/docs/computer-use-findings.md` records high-level architecture observations for reference only.
- `packages/web-access/src/index.ts` shows how this repo registers Pi extension tools.

## Architecture

```txt
Pi extension tools
  -> local policy/approval/session manager
  -> native macOS Computer Use helper API (XPC or Unix socket)
     -> ScreenCaptureKit/CoreGraphics screenshots
     -> Accessibility tree/actions
     -> synthetic input
     -> optional lock-screen guardian + authorization plugin
```

### 1. Pi extension package

Add a new package, likely `packages/computer-use`, with tools:

- `computer_status` — helper installed/running, permissions, locked-use availability.
- `computer_list_apps` — visible/running apps and approval status.
- `computer_get_app_state` — screenshot + accessibility tree for an approved app. Required before write actions each turn.
- `computer_click` — click by AX element id or screen coordinates.
- `computer_type_text` — type literal text.
- `computer_press_key` — press key/chord.
- `computer_set_value` — set value on AX text controls when possible.
- `computer_scroll` — scroll AX element or coordinates.
- `computer_stop` — end task, clear session token, relock if needed.

Pi-side rules:

- Require app approval before operating a bundle id.
- Require a fresh `computer_get_app_state` before mutating actions.
- Show screenshot/app metadata in tool results.
- Keep a per-task allowlist: app bundle ids, optional URL allow/deny rules, max duration, and whether locked-use is allowed.
- Persist only non-sensitive audit metadata; never persist screenshots by default unless explicitly requested.

### 2. Native helper MVP, unlocked only

Build a signed macOS helper app/service that exposes a minimal local API:

- health/status
- permission checks for Screen Recording and Accessibility
- list apps/windows
- capture screenshot for target app/window
- read Accessibility tree
- click/type/key/scroll via AX where possible, synthetic events where necessary

Suggested implementation choices:

- Language: Swift.
- API: Unix domain socket for MVP; XPC later for code-signing identity checks.
- Capture: ScreenCaptureKit where available, CoreGraphics fallback.
- AX: `AXUIElement` APIs for tree and actions.
- Input: AX actions first; `CGEvent` fallback for coordinates/key input.

MVP should support only active/unlocked macOS sessions. This gives Pi useful desktop app testing without touching lock-screen mechanisms.

### 3. Permission and safety model

Use explicit, narrow approvals:

- App approval: bundle id + display name + path + timestamp.
- Task approval: current Pi session id, task id, allowed apps, expiration, locked-use flag.
- Sensitive-action confirmation: form submit, account/security/privacy/payment/credential settings, deleting data, sending messages, or external network changes.

Hard blocks:

- Terminal/iTerm/Ghostty/Alacritty and Pi/Codex process windows.
- System Settings privacy/security panes.
- Login prompts, password fields, admin authorization dialogs.
- Password managers and private key/certificate apps.
- Browser pages matching configured denylist.

### 4. Optional locked-use mode

Locked-use mode should be a separate installer and disabled by default.

Components:

- `Pi Computer Use.app` — canonical signed helper bundle.
- `PiComputerUseAuthorizationPlugin.bundle` — Apple Authorization Plugin installed only with explicit admin approval.
- `PiLockScreenGuardian.app` / LaunchAgent — monitors lock state, covers displays while temporary unlock is active, detects local input, and relocks.
- Short-lived authorization socket/token — created only during an active approved computer-use turn.

Required safeguards:

- Authorization window is short-lived and scoped to one task/unlock attempt.
- Unlock permitted only when Pi helper validates an active task token signed by the same trusted helper identity.
- Cover every display while temporarily unlocked.
- Relock immediately on local keyboard/pointer input.
- Refuse admin auth/security prompts.
- Full audit log: start, app approvals, lock transitions, actions, stop/relock.
- Human-facing installer explains exactly what will be installed and how to remove it.

### 5. Implementation phases

#### Phase A — Design/spec only

- Finalize tool schemas for `packages/computer-use`.
- Write helper API protocol spec.
- Define approval store format and denylist.
- Add threat model and uninstall procedure docs.

Deliverable: docs + stub Pi extension tools returning “helper not installed”.

#### Phase B — Unlocked helper MVP

- Create Swift helper project.
- Implement status, permissions, app/window listing.
- Implement screenshot + AX tree capture.
- Implement basic click/type/key/scroll.
- Add Pi tools that call the helper.
- Test against Calculator, Finder, a simple local GUI app, and a non-sensitive browser page.

Deliverable: Pi can visually inspect and operate approved apps while the Mac is unlocked.

#### Phase C — Policy hardening

- Add per-task approvals and app allowlist UI in Pi.
- Add denylist and sensitive-action confirmation hooks.
- Add audit logs.
- Add “fresh app state before write action” enforcement.
- Add integration tests with mocked helper responses.

Deliverable: safe default unlocked Computer Use package.

#### Phase D — Locked-use prototype, local lab only

- Prototype Authorization Plugin in a separate repo/package.
- Implement lock-screen guardian overlay and local-input detection.
- Implement short-lived token validation.
- Write manual test checklist on a non-primary/lab machine.
- Do not ship or auto-install.

Deliverable: reviewed prototype with explicit manual install/uninstall steps.

#### Phase E — Production locked-use installer

- Sign/notarize helper and installer.
- Add installer UI + uninstall tool.
- Add identity checks between Pi extension, helper, guardian, and auth plugin.
- Add update/rollback strategy.
- Run security review before enabling in normal workflows.

Deliverable: opt-in locked-use support with admin-reviewed installation.

## Testing checklist

- Helper refuses actions without Screen Recording/Accessibility permissions.
- Pi refuses mutating actions without fresh app state.
- App allowlist prevents wrong-window interaction.
- Denylist blocks terminal apps, Pi itself, admin/security prompts, and password fields.
- Locked-use relocks on local input.
- Locked-use authorization expires and cannot be reused.
- Uninstaller restores macOS authorization mechanisms and removes LaunchAgents/helpers.

## First concrete next step

Create `packages/computer-use` as a Pi package with stub tools and a protocol spec. Keep locked-use as documentation/prototype only until the unlocked helper and policy layer are solid.

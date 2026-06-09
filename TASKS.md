# Task Index

Canonical top-level task tracker for this repo. Agents should read this near the start of substantial work, update statuses as work changes, and add stable task IDs for new multi-step work.

Status values: `active`, `next`, `blocked`, `done`, `parked`.

## Active

| ID | Task | Owner | Notes |
|---|---|---|---|
| T-2026-06-09-003 | Keep task tracking and durable preferences synchronized | Codex | Root tracker exists; update this file when opening, blocking, finishing, or parking work. |

## Next

| ID | Task | Source | Notes |
|---|---|---|---|
| T-2026-06-09-004 | Design async frontend LLM daemon/queue | Conversation | SQLite metadata, TOML/JSON config, max 3 workers, async submit/poll/notify, provider default ChatGPT, no long blocking request path. |
| T-2026-06-09-005 | Split `packages/web-access` into focused packages | `docs/plans/repo-open-tasks-and-cleanup.md` | Suggested packages: frontend LLM browser, pi editor tools, pi cockpit, computer-use wrapper. |
| T-2026-06-09-006 | Decide fate of `scripts/imagegen-observe.py` | `docs/plans/repo-open-tasks-and-cleanup.md` | Move to `packages/ugc-cli`, diagnostics scripts, or delete. Existing untracked file predates this Cua/Grok pass. |
| T-2026-06-09-007 | Remove stale skill symlinks/checkouts | `docs/plans/repo-open-tasks-and-cleanup.md` | `pi-skills` symlink, ignored `chrome-devtools-mcp/`, empty scratch dirs if truly unused. |
| T-2026-06-09-008 | Add UI snapshot tests when React UI tests are added or materially changed | Arthur preference | Prefer component/render snapshots alongside behavior tests when useful. |
| T-2026-06-09-015 | Add writable Slotok annotations and dry-run action endpoints | `docs/plans/slotok-workbench.md` | Read-only annotation decoding exists; next step is POST/PUT persistence and explicit rerun job/action endpoints. |
| T-2026-06-09-022 | Plan niche research and winning-template mining | Conversation | Later workstream: research a niche, find successful profiles/campaigns/templates, and convert them into clean-room abstract format templates. No live scraping until approved. |
| T-2026-06-09-023 | Implement reference-profile archive and pose/template extraction | `docs/plans/ugc-studio-workstreams.md` | Future implementation: capture public or rights-cleared profile samples, extract pose/timing/caption/hook mechanics, and keep source-media/identity guardrails explicit. |

## Blocked

| ID | Task | Blocker | Next action |
|---|---|---|---|
| T-2026-06-09-002 | Verify Grok Twitter search through `llm_frontend_browser` | Dedicated Helium profile at `~/.pi/pi-web-access/helium-grok-profile` is still logged out on `grok.com`; visible controls include `Sign in` / `Sign up`. | Manually log into Grok in that Helium profile, then retry `pi-llm-browser prompt --provider grok --no-wait ...`. |

## Done

| ID | Task | Date | Notes |
|---|---|---|---|
| T-2026-06-09-001 | Finish CuaDriver-first browser/computer-use migration | 2026-06-09 | Cua-first skills/docs updated, AeroSpace PID guard disabled, and `cua_driver` Pi wrapper added. |
| T-2026-06-09-010 | Archive CuaDriver technical writeup | 2026-06-09 | Saved under `docs/research/macos-background-computer-use/`. |
| T-2026-06-09-011 | Record CuaDriver-first preference | 2026-06-09 | Added to `AGENTS.md` and `docs/state/agent-tooling-preferences.md`. |
| T-2026-06-09-012 | Disable old AeroSpace PID guard hooks | 2026-06-09 | Removed active callbacks from `/Users/arthur/dotfiles/shell/dot-aerospace.toml`; scripts/docs marked deprecated. |
| T-2026-06-09-013 | Add CuaDriver Pi wrapper | 2026-06-09 | Added `cua_driver` tool backed by installed CuaDriver CLI, unit tests, README/skill docs, and live permissions smoke. |
| T-2026-06-09-014 | Continue Slotok eval viewer MVP surfaces | 2026-06-09 | Added shortcut-specific review panels for runs, DAG, metrics, artifacts, notes, logs, terminal draft, and generated views; annotation JSON is decoded read-only; visual QA passed 23/0. |
| T-2026-06-09-016 | Add Slotok video proof artifact to visual QA | 2026-06-09 | `visual:qa` now records `artifacts/slotok-visual-qa/latest/videos/reviewer-walkthrough.webm`; Slotok QA commands documented. |
| T-2026-06-09-017 | Formalize reviewer-saving proof-of-work QA workflow | 2026-06-09 | Added `proof-of-work-qa` skill, QA README, PR template, package skill manifest entry, and durable preference note. |
| T-2026-06-09-018 | Implement UGC Studio Figma-like demo route | 2026-06-09 | Added `/ugc-studio/` with open canvas, floating prompt, modal secondary menus, vertical ad artboards, layer timeline, snapshot coverage, and QA screenshots in `docs/qa/ugc-studio-figma-demo.md`. |
| T-2026-06-09-019 | Reframe UGC Studio around persona/profile exploration branches | 2026-06-09 | Captured the product model in state/docs: creative search across personas, batches, branches, CTA/non-CTA campaigns, final editor, and developer graph. |
| T-2026-06-09-020 | Implement UGC Studio multi-view workspace | 2026-06-09 | Replaced the older single-view demo with Persona Atlas, Exploration Board, Batch Review, Campaign Map, Reference Remix, Final Editor, Developer Graph, persistent command bar, better sidebar/inspector, snapshots, screenshots, and walkthrough video. |
| T-2026-06-09-021 | Model reference-profile remix workflow | 2026-06-09 | Added typed JSON-first workspace fixture with reference profiles, preserved/swapped/blocked remix fields, public research target guardrails, faceless template pack, and a Reference Profile Remix UI view/spec. |

## Related Planning Docs

- `docs/plans/repo-open-tasks-and-cleanup.md`
- `docs/plans/pi-agent-control-plane.md`
- `docs/plans/symphony-lite-rust-runner.md`
- `docs/plans/slotok-workbench.md`
- `docs/state/agent-tooling-preferences.md`

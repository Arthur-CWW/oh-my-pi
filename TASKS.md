# Task Index

Canonical top-level task tracker for this repo. Agents should read this near the start of substantial work, update statuses as work changes, and add stable task IDs for new multi-step work.

Status values: `active`, `next`, `blocked`, `done`, `parked`.

## Active

| ID | Task | Owner | Notes |
|---|---|---|---|
| T-2026-06-09-003 | Keep task tracking and durable preferences synchronized | Codex | Root tracker exists; update this file when opening, blocking, finishing, or parking work. |
| T-2026-06-09-024 | Reverse/catalog useful Jimeng GenAI frontend APIs | Codex | Build a reusable background-browser/session-refresh proxy plus direct-client support for image, video, reference, persona/subject, character, canvas, asset, voice, and template-mining APIs. Current slices support workbench text-to-image submit + asset-list polling, non-generating config probes, built-in voice library replay, direct TTS MP3 generation, upload-token retrieval, local ImageX image upload to provider URI, and local-upload-backed first-frame image-to-video with MP4 proof. |

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
| T-2026-06-09-025 | Capture Jimeng reference/persona/video/canvas API flows | Conversation | Use `jimeng-browser-proxy` skill and passive CDP captures for end-frame/multi-frame image-to-video, image-to-image, subject/persona create/update/generate_voice, voice clone submit/query, pose/style/depth/canny reference controls, multimodal video, lip sync generation, VOD upload, canvas edits, asset library, and explore/template APIs. |
| T-2026-06-09-030 | Build local-first UGC workspace store | `docs/plans/ugc-studio-workstreams.md` | Add a versioned JSON object store plus optional SQLite indexes under `data/ugc-studio/**` for workspaces, personas, campaigns, branches, candidates, notes, provider jobs, assets, and exports. |
| T-2026-06-09-031 | Bind React UGC Studio to daemon-backed workspace data | `docs/plans/ugc-studio-workstreams.md` | Replace static renderer fixtures with local workspace load/save endpoints while preserving the current React layout and interaction model. |
| T-2026-06-09-032 | Implement editable persona/profile bibles | `docs/plans/ugc-studio-workstreams.md` | Persist appearance, voice, accent, niche, interests, posting strategy, continuity JSON, samples, and notes for whole TikTok-profile-like personas. |
| T-2026-06-09-033 | Persist branch snapshots and review notes | `docs/plans/ugc-studio-workstreams.md` | Make campaign branches, dead-end markers, fork decisions, selected-set notes, and snapshot metadata persistent and navigable. |
| T-2026-06-09-034 | Implement provider job queue and artifact cache | `docs/plans/ugc-studio-workstreams.md` | Turn KIE/Jimeng calls into local dry-run/live-capped jobs with request/response JSON, polling, spend metadata, generated media, and cached artifacts. |
| T-2026-06-09-035 | Persist final editor timeline and export manifests | `docs/plans/ugc-studio-workstreams.md` | Save captions, voice, b-roll, product-demo, CTA, scene layers, export metadata, and rendered file references locally. |

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
| T-2026-06-09-026 | Wire React/shadcn UGC route and frugal KIE provider proxy | 2026-06-09 | Added a React/Tailwind/shadcn comparison route, KIE dry-run/live-capped CLI adapter, local daemon KIE endpoints, spend-guard tests, and QA artifacts for stack comparison. |
| T-2026-06-09-027 | Decide React vs Solid UGC Studio stack from side-by-side QA | 2026-06-09 | React/shadcn/Tailwind is the maintained UGC Studio stack. Solid UGC routes should be removed rather than maintained as a parallel implementation. |
| T-2026-06-09-028 | Rebuild React UGC views from canonical generated workspace refs | 2026-06-09 | Refined the React route against the saved workspace-view references, fixed small-desktop sizing/layout issues across Atlas, Exploration, Review, Campaign Map, Final Editor, and KIE Proxy, and saved QA screenshots under `docs/qa/ugc-studio-react-refinement/`. |
| T-2026-06-09-029 | Add Jimeng voice catalog and TTS CLI support | 2026-06-09 | Added non-generating catalog probes, signed built-in voice library replay, direct `/mweb/v1/tts_generate` MP3 generation, `catalog`/`voices`/`tts`/`sample-voices` CLI commands, tests, and QA docs. Full current library sample run generated 142/142 MP3s under ignored `data/**`. |
| T-2026-06-09-030 | Add Jimeng upload-token CLI support | 2026-06-09 | Added `/mweb/v1/get_upload_token` helper and `upload-token` CLI command; live-proved scenes `1`, `2`, and `3`. Scene `2` returns ImageX token metadata for reference-image upload; byte upload-to-URI remains the next task. |
| T-2026-06-09-036 | Add Jimeng ImageX local image upload CLI support | 2026-06-09 | Added frontend-compatible AWS4 ImageX signer, `ApplyImageUpload`/direct byte upload/`CommitImageUpload` helpers, `upload-image` CLI command, tests, docs, and live proof bundle under `data/jimeng-lab/proof-20260609-image-upload/`. |
| T-2026-06-09-037 | Add Jimeng local-upload image-to-video CLI support | 2026-06-09 | Added `jimeng-browser-proxy image2video` with local first-frame upload, provider URI injection, useful video flags, tests/docs, and live MP4 proof under `data/jimeng-lab/proof-20260609-image2video-live/`. |

## Related Planning Docs

- `docs/plans/repo-open-tasks-and-cleanup.md`
- `docs/plans/pi-agent-control-plane.md`
- `docs/plans/symphony-lite-rust-runner.md`
- `docs/plans/slotok-workbench.md`
- `docs/state/agent-tooling-preferences.md`

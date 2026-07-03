# Fable Atlas — locator map

Pure locator: where things live. No policy (that's [`charter.md`](charter.md)). Retrieve sections as needed; don't preload.

## Streams (session roots)

`streams/<x>/` is each sharded session's home: `GOAL.md` (ownership + NFRs + open questions), `INDEX.md` (tracked index), `repos/`+`inspiration/`+`feedstock/` (gitignored symlinks/material, originals logged in INDEX.md). Sharding rules: [`handoff.md`](handoff.md).

**Repo topology.** Polyrepo with a shared spine: `~/agents` = harness + Primer substrate + incubator. Products graduate to their own repos (under `~/products`) when they stop being testbeds, taking their `inspiration/`/`feedstock/` along. Shared TS libraries live in `packages/` and get published under the `@wirebabel` npm scope when a graduated repo consumes them (`bun link` for local dev). Cross-repo context registry: `catalog/workspaces.yml`.

## Code by stream

| Stream | Code | Live docs |
|---|---|---|
| Companion | `apps/ai-companion-rtc/`, `packages/spatial-audio-renderer/` | `apps/ai-companion-rtc/docs/goal.md` |
| Playground | `apps/slotok-workbench/`, `packages/{hyperframes-renderer,remotion-renderer,jimeng-client,ugc-cli}/`, `workflows/tiktok-recreate/` | `docs/state/video-creative-direction.md`, `docs/state/ugc-studio-style-direction.md`, `docs/state/creative-framing.md` |
| Primer | `packages/{twitter-archive,borges-library}/`, `browser-extensions/extensions/twitter-archive-firefox/`; external: `~/apps/mochi-lite`, `~/apps/hsk-deck`, `~/apps/japanese-vocab`, `~/vault`, `~/github/hashcards` | `docs/twitter-archive-plan.md`, `docs/plans/twitter-archive-goal.md` |
| Harness | `oh-my-pi/`, `packages/{web-access,dynamic-workflows}/`, `.omp/`, `skills/` | [`harness-brief.md`](harness-brief.md), [`harness-slimming.md`](harness-slimming.md) |

Historical plans (banner-marked, reference only): `docs/plans/slotok-workbench.md` (retired Solid stack), `docs/plans/symphony-lite-rust-runner.md` (Elixir won), `docs/plans/asmr-companion-overnight-goals.md`.

## Artifacts / material (`data/`, ~8.2 GB)

| Path | What | Scale |
|---|---|---|
| `data/tiktok-catalogue/` | Downloaded TikToks + metadata + thumbnails | 1.2 GB, ~1,493 files |
| `data/assets/` | Generated brainrot props (preview.mp4/alpha.mov/PNG) | 891 media files |
| `data/jimeng-lab/` | Jimeng generations, proof packets, audit SQLite | 259 MB, 1,566 files |
| `data/video-recreation/` | Reference decompositions, plates, TTS | 223 MB |
| `data/ugc-studio/` | Workspace state (`workspaces/<id>/{state.json,workspace.sqlite,assets/**}`) | 327 files |
| `data/twitter-archive/` | Tweet SQLite + images | 130 MB |
| `data/youtube-liked-asmr-refs/` + `data/asmr-companion/` | ASMR reference audio + companion proofs | ~926 MB |
| `data/computer-enhance/` | Lecture audio | 3.5 GB |
| `data/source-archives/` | Archived source/reference dumps | 1.5 GB |
| `data/workflow-runs/`, `data/dreamina/`, `data/jimeng-captures/`, `data/open-design/` | Run manifests, caches, captures | small |
| `data/fable-prep/` | Session corpus summary + records JSON | 2 files |

## External material (outside `~/agents`, inventoried 2026-07-03)

| Stream | Paths |
|---|---|
| Companion | `~/github/airi` (4.7G companion project), `~/github/Open-LLM-VTuber`, `~/github/VRCFaceTracking`, `~/github/aiavatarkit`, `~/github/SillyTavern-Launcher`, `~/github/grok-tools` |
| Playground | `~/ComfyUI` (1.1G runtime), `~/Downloads/_Organized/Images_Media` (1.1G) |
| Primer | `~/apps/{mochi-lite,hsk-deck,japanese-vocab,minimal-srs,ultimate-chinese,yomitan}`, `~/github/hashcards`, `~/Zotero` (1.2G), `~/Documents/{mochi,algorithms,papers}`, `~/Downloads/_Organized/Books_Papers_Research` (3.3G: 221 PDFs/23 EPUBs), `~/vault/{library,Clippings,books,notes}`, `~/archives/{gay-primer,youtube-transcripts}` |
| Harness | `~/vault/prompts` (prompt library), `~/github/pi-personal-core-skills`, `~/archives/claude-code-decomp` |
| Unsorted dumps worth triage | `~/Downloads/_Organized/{Archives 8.1G, Courses_Datasets_Libraries 9.8G, Web_Saves, Other_Review}`, `~/archives/{newsletters 6.3G, tweets}`, `~/Documents/usb-archive` |

Full inventory with sizes: [`external-inventory.md`](external-inventory.md). Notable: `~/exploratory/systems/wrapped-commentary-reader` (754M — annotation reader + saved transcript/podcast artifacts from a prior session, Primer feedstock).

## Sessions and memory

| What | Where |
|---|---|
| Session index (read first) | [`session-index.md`](session-index.md) — labels: keep `chatbot_rtc`, `ugc_video`, `twitter_archive`+`learning_memory`, high-score `agent_harness`; skip `menial_ops`, `uncategorized`, `security_exclude` |
| Corpus summary / records | `data/fable-prep/session-corpus-summary.md`, `data/fable-prep/session-records.json` (683 sessions: OMP + Pi + Codex) |
| OMP / Pi / Codex sessions | `~/.omp/agent/sessions/`, `~/.pi/agent/sessions/`, `~/.codex/{sessions,archived_sessions}/` |
| Transcription aliases | [`transcription-notes.md`](transcription-notes.md) |
| Active tasks | `TASKS.md` |
| Plan / state / QA indexes | `docs/plans/README.md`, `docs/state/README.md`, `docs/qa/README.md` |

## Harness config map

| Layer | File | Notes |
|---|---|---|
| Global OMP | `~/.omp/agent/config.yml` | modelRoles incl. `slow: claude-fable-5` (trap: built-in `reviewer` binds `pi/slow`; without the overlay the fable-guard degrades it to Kimi), `advisor: deepseek` enabled — both overridden by the overlay |
| Workspace | `.omp/config.yml` | Kagi search, apfs isolation, soft budget 40 |
| Fable overlay | `.omp/fable-config.yml` | advisor off, `slow/complex/plan → gpt-5.5`, `designer → opus-4-6`, autolearn off. Launch: `omp --config ./.omp/fable-config.yml --model <fable-model-id>` |
| Skill manifest | `package.json` `pi.skills` | Slim 20-skill profile; ledger + restore steps in [`harness-slimming.md`](harness-slimming.md) |
| Custom agents | `.omp/agents/` | jimeng-gemini-worker, jimeng-kimi-worker, prose-deepseek-v4-pro, prose-glm-5-2; built-ins (reviewer/designer/explore/plan/…) live in `oh-my-pi/packages/coding-agent/src/prompts/agents/` |
| Fable-subagent guard | `oh-my-pi/packages/coding-agent/src/config/model-resolver.ts` | Blocks subagent selectors containing `fable` |
| Auth / quotas | `omp auth-broker`, `omp token <provider>`, `omp usage`, `OMP_PROFILE` | Reuse; never invent token storage |

## Repo topology & ownership

**Polyrepo with a spine.** `~/agents` = harness + Primer substrate + incubator. Products graduate to their own repos (under `~/products`) when they become products — taking their `streams/<x>/` charter and inspiration with them. Shared TypeScript libs live in `~/agents/packages/*`; when a graduated repo consumes one, publish it under the existing `@wirebabel` npm scope (`bun link` for local dev — Bun workspaces don't span repos, npm does). Registry: `catalog/workspaces.yml`.

| Stream | Contract | Owner paths (summary) |
|---|---|---|
| Companion | `streams/companion/GOAL.md` | `apps/ai-companion-rtc`, `packages/spatial-audio-renderer`, `data/{asmr-companion,youtube-liked-asmr-refs}` |
| Playground | `streams/playground/GOAL.md` | `apps/slotok-workbench`, `packages/{hyperframes,remotion}-renderer`, `packages/{jimeng-client,ugc-cli}`, `workflows/tiktok-recreate`, UGC `data/` buckets |
| Primer | `streams/primer/GOAL.md` | `packages/{twitter-archive,borges-library}`, `browser-extensions/…/twitter-archive-firefox`, `data/twitter-archive`, primer docs |
| Harness | `streams/harness/GOAL.md` | `oh-my-pi`, `packages/{web-access,dynamic-workflows}`, `.omp`, `skills`, `docs/fable`, `catalog/workspaces.yml` |

## Cleanup ledgers (historical)

[`claude-omp-cleanup.md`](claude-omp-cleanup.md) — MCP/hook clutter removal record. [`git-cleanup-plan.md`](git-cleanup-plan.md) — pre-Fable commit plan.

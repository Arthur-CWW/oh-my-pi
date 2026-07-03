# Fable Session Index

> Generated from: `data/fable-prep/session-corpus-summary.md` (2026-07-03), `data/fable-prep/session-records.json`, `TASKS.md`, `docs/plans/README.md`.
> Raw session JSONL paths are absolute on the source machine. Secrets/keys are excluded.

---

## Quick Lookup

### Workstream → label → where to look

| Workstream | Label | Key paths |
|---|---|---|
| AI companion / RTC | `chatbot_rtc` | [`apps/ai-companion-rtc/docs/goal.md`](../../apps/ai-companion-rtc/docs/goal.md) |
| UGC / creative playground | `ugc_video` | [`docs/state/video-creative-direction.md`](../state/video-creative-direction.md), [`docs/plans/ugc-studio-workstreams.md`](../plans/ugc-studio-workstreams.md) |
| Personal second-brain / shared context | `twitter_archive` + `learning_memory` | [`docs/fable/atlas.md`](atlas.md), [`docs/twitter-archive-plan.md`](../twitter-archive-plan.md), `~/apps/mochi-lite`, `~/apps/hsk-deck`, `~/vault`, `~/github/hashcards` |
| Agent harness | `agent_harness` | [`docs/plans/symphony-lite-goal.md`](../plans/symphony-lite-goal.md), [`docs/state/symphony-lite-direction.md`](../state/symphony-lite-direction.md) |
| _Noise / skip_ | `menial_ops`, `uncategorized`, `security_exclude` | — |

### Filtering rule

- `chatbot_rtc`, `ugc_video`, combined `twitter_archive` + `learning_memory` → high-value; read top-scored sessions
- `agent_harness` → scan only deep-selected sessions with alpha > 2000
- `menial_ops`, `uncategorized`, `security_exclude` → skip

Note: session transcripts are often speech-to-text via VoiceInk; uncommon words and names may be mis-transcribed. Preserve likely aliases and don't overfit typos.

---

## Corpus Scope

| Metric | Value |
|--------|-------|
| Total session files | 683 |
| Total size | 5,243.3 MB |
| Total JSONL lines | 323,044 |
| Source DB | `/Users/arthur/.local/share/pi-cockpit/cockpit.sqlite` + JSONL headers |
| Source kinds | cockpit (Pi sessions), codex (Codex rolls), omp (OMP agent sessions) |

**Label distribution** (from `session-records.json`):

| Label | Count |
|-------|-------|
| `agent_harness` | 553 |
| `menial_ops` | 223 |
| `ugc_video` | 145 |
| `uncategorized` | 84 |
| `twitter_archive` | 52 |
| `trading_market` | 48 |
| `security_exclude` | 45 |
| `learning_memory` | 42 |
| `chatbot_rtc` | 31 |

**Top workspaces by session count**: `/Users/arthur/agents` (305), `/Users/arthur/apps` (86), `/Users/arthur/agents/web-access` (47), `/Users/arthur/vault` (38), `/Users/arthur/projects/pi-web-access` (30), `/Users/arthur/dotfiles` (27), `/Users/arthur/github/VoiceInk` (22).

---

## Primary Useful Workstreams

### 1. AI Companion / VRM / RTC → `chatbot_rtc`

**31 sessions.** ASMR AI girlfriend pipeline, real-time voice/avatar streaming, 3D binaural audio, MiniMax TTS integration, lip-sync talking-head research.

Key source docs:
- `docs/plans/asmr-companion-overnight-goals.md`
- `TASKS.md` rows `T-2026-06-24-001`

Highest-value JSONLs (see corpus summary for full `chatbot_rtc` candidate list):
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-24T10-00-13-246Z_019ef912-b4be-7000-b9d6-0faca667ce4c.jsonl` (score 27.0, 2466 lines)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-20T23-51-56-016Z_019ee772-b970-7000-b655-51b21d5723f5/MinimaxLane.jsonl` (score 23.0)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-20T23-51-56-016Z_019ee772-b970-7000-b655-51b21d5723f5/WorkflowAudioWiring.jsonl` (score 23.0)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-20T23-51-56-016Z_019ee772-b970-7000-b655-51b21d5723f5/TtsScriptFix.jsonl` (score 23.0)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-20T23-51-56-016Z_019ee772-b970-7000-b655-51b21d5723f5.jsonl` ("Set Up Minimax TTS", score 20.0, 1356 lines)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-24T10-00-13-246Z_019ef912-b4be-7000-b9d6-0faca667ce4c/ASMR3DAudio.jsonl` (score 20.0)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-24T10-00-13-246Z_019ef912-b4be-7000-b9d6-0faca667ce4c/goal3spatialResume.jsonl` (score 20.0)

### 2. UGC / TikTok / Video Asset Pipeline → `ugc_video`

**145 sessions.** TikTok video download → Gemini decomposition → Remotion recreation pipeline. Slotok workbench, hyperframes renderer, Pleometric brainrot workflow analysis, ComfyUI research, MiniMax TTS, Jimeng/Seedance video generation, commercial avatar SaaS scouting.

Key source docs:
- `docs/plans/ugc-studio-workstreams.md`
- `docs/plans/layered-video-graph.md`
- `docs/state/video-creative-direction.md`
- `docs/qa/tiktok-recreate-bootstrap-20260620.md`
- `TASKS.md` rows under UGC/Slotok

Highest-value JSONLs:
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-24T10-00-13-246Z_019ef912-b4be-7000-b9d6-0faca667ce4c.jsonl` (score 27.0, 2466 lines)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-21T02-49-30-171Z_019ee815-4b3b-7000-a705-3a4e5a5ea72d.jsonl` ("Research Video Generation Workflows", score 22.0, 1196 lines)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-20T23-51-56-016Z_019ee772-b970-7000-b655-51b21d5723f5.jsonl` ("Set Up Minimax TTS", score 20.0, 1356 lines)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-24T05-37-21-467Z_019ef822-0c3b-7000-a871-a041048785a1.jsonl` ("Find Pleometric Tweets And GitHub URLs", score 19.0, 140 lines)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-24T07-39-40-178Z_019ef892-0712-7000-9868-89bf031f14b3.jsonl` ("Find Commercial Alternatives To Sonic Repo", score 19.0, 105 lines)
- `/Users/arthur/.codex/sessions/2026/02/18/rollout-2026-02-18T16-20-30-019c6f31-5869-7131-addf-6be7be7e8920.jsonl` (top-23 deep, alpha 1011.4, 1339 lines, slotok/main)
- `/Users/arthur/.codex/sessions/2026/02/18/rollout-2026-02-18T17-33-47-019c6f74-6fa8-77f3-8691-13479a9c1ee1.jsonl` (slotok/main, alpha 53.5)

### 3. Twitter/X Inspiration Archive → `twitter_archive`

**52 sessions.** Local tweet archive mining (SQLite + JSONL), Pleometric tweet → GitHub/workflow extraction, X search scraping for discourse research (hyperframes, remotion, market commentary), reference profile archiving, GPT-oracle video prompt research.

Key source docs:
- `docs/plans/twitter-archive-goal.md`
- `docs/twitter-archive-workstreams.md`

Highest-value JSONLs:
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-24T10-00-13-246Z_019ef912-b4be-7000-b9d6-0faca667ce4c.jsonl` (score 27.0, 2466 lines)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-21T02-49-30-171Z_019ee815-4b3b-7000-a705-3a4e5a5ea72d.jsonl` (score 22.0, 1196 lines)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-24T05-37-21-467Z_019ef822-0c3b-7000-a871-a041048785a1.jsonl` (score 19.0, 140 lines)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-23T09-33-20-143Z_019ef3d3-bb8f-7000-a25d-e953a404f6dd.jsonl` ("Scrape X User Tweets For Market Commentary", score 18.0, 82 lines)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-18T07-35-20-865Z_019ed9a7-ea21-7000-bae0-4a0a062354b1.jsonl` ("Continue Slotok Video Analysis Project", score 17.0, 3356 lines)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-21T23-48-59-899Z_019eec96-657b-7000-b103-e5bcd5166ec7.jsonl` ("Set Up GPT Oracle With Video", score 18.0)

### 4. Agent Harness / Cyborgism / OMP Orchestration → `agent_harness`

**553 sessions.** The largest category. Covers: Pi agent sessions, Codex rolls, OMP agent orchestration, Symphony architecture research, tmux/CMUX session management, repo reorganization, boundary scripts, workflow skills, lint gates, CI integration.

Key source docs:
- `docs/plans/symphony-lite-goal.md`
- `docs/plans/skill-inventory-and-rationalization.md`
- `docs/plans/omp-design-qa-workflow.md`

Highest-value JSONLs (deep-selected by alpha):
- `/Users/arthur/.codex/sessions/2026/06/05/rollout-2026-06-05T09-35-10-019e94fd-a014-76a2-8288-734a545a4be7.jsonl` (top-2 deep, alpha 12100.3, 45,375 lines, agents/web-access)
- `/Users/arthur/.codex/archived_sessions/rollout-2026-06-11T08-31-24-019eb3a9-6a35-74e0-bd69-11490ff9eb6b.jsonl` (top-4 deep, alpha 6661.4, 26,158 lines)
- `/Users/arthur/.codex/sessions/2026/06/11/rollout-2026-06-11T08-27-40-019eb3a5-fbaf-7f30-ac3f-69cdb3600726.jsonl` (top-5 deep, alpha 6657.9, 26,089 lines)
- `/Users/arthur/.codex/sessions/2026/06/12/rollout-2026-06-12T16-56-41-019eba9e-5dc5-78e2-9e93-3483aef7b770.jsonl` (top-7 deep, alpha 4286.6, 14,674 lines)
- `/Users/arthur/.codex/sessions/2026/06/11/rollout-2026-06-11T08-28-48-019eb3a7-078f-74b3-a0bf-184917645bea.jsonl` (top-8 deep, alpha 3427.0, 753 lines)
- `/Users/arthur/.codex/sessions/2026/06/09/rollout-2026-06-09T19-57-45-019eabd1-0ebf-7580-9564-82a57283a615.jsonl` (top-11 deep, alpha 2572.0, 6,706 lines)
- `/Users/arthur/.codex/sessions/2026/06/02/rollout-2026-06-02T21-46-18-019e8827-eb66-7100-a036-8740290d47f2.jsonl` (top-13 deep, alpha 1626.7, 2,813 lines)
- `/Users/arthur/.omp/agent/sessions/--private-tmp--/2026-06-16T01-29-42-575Z_019ece0c-71af-7000-806f-cf94b657eff3.jsonl` (/tmp, "Index and reorganize repos", score 15.0, 812 lines)

Also: 30 `pi-web-access` sessions under `/Users/arthur/projects/pi-web-access` and `/Users/arthur/.pi/agent/sessions/--Users-arthur-projects-pi-web-access--/`.

### 5. Learning / Obsidian / Anki / Frontier Cards → `learning_memory` (SECOND-BRAIN)

**42 sessions.** A main Fable stream, not optional. Covers Mochi-lite flashcard app, HSK Chinese vocabulary deck, Japanese vocab deck, Obsidian vault knowledge management, spaced-repetition review pipelines, safe docs/test contracts.

Key source docs:
- `data/fable-prep/session-corpus-summary.md` sections under `learning_memory`
- `/Users/arthur/apps/mochi-lite`, `/Users/arthur/apps/hsk-deck`, `/Users/arthur/apps/japanese-vocab`

Highest-value JSONLs:
- `/Users/arthur/.codex/sessions/2026/06/10/rollout-2026-06-10T15-38-28-019eb00a-095e-7f22-9118-5f2379f9f6db.jsonl` (top-1 deep, alpha 14945.4, 61,980 lines, mochi-lite)
- `/Users/arthur/.codex/sessions/2026/06/11/rollout-2026-06-11T15-38-27-019eb530-630d-76d1-aae9-7a80b597eb2f.jsonl` (top-3 deep, alpha 6806.8, 1,683 lines, mochi-lite)
- `/Users/arthur/.codex/sessions/2026/06/09/rollout-2026-06-09T23-36-30-019eac99-5584-7742-8c27-d77a59132fde.jsonl` (top-6 deep, alpha 5074.4, 18,438 lines, mochi-lite)
- `/Users/arthur/.codex/sessions/2026/06/11/rollout-2026-06-11T11-20-28-019eb444-321d-7050-9ad5-df8b65359dfb.jsonl` (top-9 deep, alpha 3417.6, 830 lines, mochi-lite)
- `/Users/arthur/.omp/agent/sessions/-apps/2026-06-24T23-29-31-126Z_019efbf7-a3f6-7000-95cb-82227d737ae3/ReviewHskSafeDocsTest.jsonl` (score 17.0)
- `/Users/arthur/.omp/agent/sessions/-apps/2026-06-24T23-29-31-126Z_019efbf7-a3f6-7000-95cb-82227d737ae3/ImplHskSafeDocsTest.jsonl` (score 16.0)

### 6. Trading / Market Research → `trading_market`

**48 sessions.** Crypto/market research discussion sessions, X-scraped market commentary, trading analysis. Most trading sessions are embedded within larger multi-label sessions (co-tagged with `agent_harness`, `twitter_archive`).

Key source docs: scattered across `docs/plans/README.md`.

Highest-value JSONLs (from corpus summary `trading_market` candidates):
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-24T10-00-13-246Z_019ef912-b4be-7000-b9d6-0faca667ce4c.jsonl` (score 27.0, 2466 lines)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-21T02-49-30-171Z_019ee815-4b3b-7000-a705-3a4e5a5ea72d.jsonl` (score 22.0)
- `/Users/arthur/.omp/agent/sessions/-agents/2026-06-21T23-48-59-899Z_019eec96-657b-7000-b103-e5bcd5166ec7.jsonl` ("Set Up GPT Oracle With Video", score 18.0)

---

## Menial / Noise Buckets

### `menial_ops` (223 sessions)

Tagged alongside `agent_harness` in most cases. Characterized by: repo cleanup, file moves, lint fix loops, CI gate passes, dependency bumps, tmux session close/reopen, disk-space management, `brew` maintenance. Low to negative usefulness scores (some as low as -2.0). These sessions are **not worth deep analysis** but may contain incidental infrastructure context.

Key representative paths:
- Top-12 deep (alpha 2100.5, `menial_ops` only, 504 lines): `/Users/arthur/.codex/sessions/2026/06/08/...` (see `session-records.json` for exact path)
- Various cockpit sessions under `/Users/arthur/.pi/agent/sessions/--Users-arthur-github--/` (tagged `menial_ops`)
- Various OMP sessions under `/Users/arthur/.omp/agent/sessions/` tagged `menial_ops`

### `uncategorized` (84 sessions)

Codex sessions with empty `first_user` and no label assignment. Most are in `/Users/arthur/apps/mochi-lite`, `/Users/arthur/agents/web-access`, and `/Users/arthur/vault`. Several high-alpha deep selections (top-1, top-3, top-6, top-9, top-10) fall here — these were manually reclassified above under `learning_memory` based on their `cwd`.

---

## Fable-Excluded Sessions

### `security_exclude` (45 sessions)

**NEVER include in Fable training data.** Covers:
- **Cybersecurity / reveng**: Apple PCC (Private Cloud Compute) inspection, vphone-cli iOS virtualization, security research on `security-pcc` repo
- **Anti-detection / proxy**: session annotation indicates browser-fingerprint, proxy, and anti-detection topics
- **Vphone / iOS agent lab**: virtual iPhone, simple iOS app for LLM-agent workflows (parked for later)

Key excluded paths:
- `/Users/arthur/.pi/agent/sessions/--Users-arthur-github--/2026-06-06T00-18-20-333Z_019e9a4b-822d-70e8-ba3b-0c424a8fb84f.jsonl` (tags: `security_exclude`, `agent_harness`, `menial_ops`; top-27 deep, alpha 930.5)
- Various cockpit sessions under `/Users/arthur/github` and `/Users/arthur/vault` tagged `security_exclude`
- `/Users/arthur/.cache/checkouts/github.com/apple/security-pcc` (inspected, not to be analyzed)

---

## Deep-Selected Sessions (Top 30 by Alpha)

Full table of the 30 sessions selected for deep extraction by the `self-improve-20260624-dag` run. Included for cross-reference; classified per workstream above.

| Rank | Alpha | Lines | CWD / Workstream | Labels |
|------|-------|-------|------------------|--------|
| 1 | 14945.4 | 61,980 | `apps/mochi-lite` → learning_memory | uncategorized |
| 2 | 12100.3 | 45,375 | `agents/web-access` → agent_harness | agent_harness |
| 3 | 6806.8 | 1,683 | `apps/mochi-lite` → learning_memory | uncategorized |
| 4 | 6661.4 | 26,158 | `agents/web-access` → agent_harness | agent_harness |
| 5 | 6657.9 | 26,089 | `agents/web-access` → agent_harness | agent_harness |
| 6 | 5074.4 | 18,438 | `apps/mochi-lite` → learning_memory | uncategorized |
| 7 | 4286.6 | 14,674 | `agents/web-access` → agent_harness | agent_harness |
| 8 | 3427.0 | 753 | `agents/web-access` → agent_harness | agent_harness |
| 9 | 3417.6 | 830 | `apps/mochi-lite` → learning_memory | uncategorized |
| 10 | 2679.6 | 758 | `/Users/arthur` → general | uncategorized |
| 11 | 2572.0 | 6,706 | `agents/web-access` → agent_harness | agent_harness |
| 12 | 2100.5 | 504 | menial_ops | menial_ops |
| 13 | 1626.7 | 2,813 | `agents/web-access` → agent_harness | agent_harness |
| 14 | 1593.3 | — | (see session-records.json) | — |
| 15 | 1541.5 | — | (see session-records.json) | — |
| 16 | 1500.8 | — | (see session-records.json) | — |
| 17 | 1499.6 | — | (see session-records.json) | — |
| 18 | 1373.7 | — | (see session-records.json) | — |
| 19 | 1366.2 | — | (see session-records.json) | — |
| 20 | 1351.3 | — | (see session-records.json) | — |
| 21 | 1047.1 | — | (see session-records.json) | — |
| 22 | 1043.5 | — | (see session-records.json) | — |
| 23 | 1011.4 | 1,339 | `products/slotok/main` → ugc_video | ugc_video |
| 24 | 995.5 | 2,254 | `/Users/arthur` → general | uncategorized |
| 25 | 967.5 | — | (see session-records.json) | — |
| 26 | 942.1 | — | (see session-records.json) | — |
| 27 | 930.5 | 1,021 | `github` → EXCLUDED | security_exclude, agent_harness, menial_ops |
| 28 | 894.4 | — | (see session-records.json) | — |
| 29 | 857.9 | — | (see session-records.json) | — |
| 30 | 841.8 | — | (see session-records.json) | — |

---

## Source Documents

- **Corpus summary**: `data/fable-prep/session-corpus-summary.md` — full candidate session listings grouped by label with scores and first-user snippets
- **Session records**: `data/fable-prep/session-records.json` — machine-readable JSON array of all 683 session entries (26,425 lines)
- **Task index**: `TASKS.md` — maps workstream task IDs to session dates and plans
- **Plans directory**: `docs/plans/README.md` — plan index with workstream-to-doc references

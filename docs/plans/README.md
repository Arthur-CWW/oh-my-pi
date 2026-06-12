# Parallel Workstream Plans

This directory splits the current Jimeng/Dreamina + TTS/lipsync + Pleometric archive work into lanes that can run in parallel in a single working tree, without git worktrees.

Before starting creative/video or orchestration work, read the state docs and relevant review personas:

```txt
docs/state/README.md
docs/state/video-creative-direction.md
docs/state/symphony-lite-direction.md
docs/review-agents/README.md
```

`video-creative-direction.md` is the living taste ledger / vibe bible / creative north-star for the project. Keep it synchronized with durable preferences Arthur states during sessions.

## Current lanes

| Lane | Plan doc | Primary owner paths | Runtime output paths |
|---|---|---|---|
| Pipeline serialization | [`pipeline-serialization-format.md`](./pipeline-serialization-format.md) | `docs/plans/pipeline-serialization-format.md`; later `packages/video-pipeline/**` if created | `data/workflow-runs/**` |
| Layered graph / creative state | [`layered-video-graph.md`](./layered-video-graph.md), [`../state/video-creative-direction.md`](../state/video-creative-direction.md) | `docs/plans/layered-video-graph.md`, `docs/state/video-creative-direction.md` | `data/workflow-runs/**` |
| Asset catalog / brainrot assets | [`video-asset-library.md`](./video-asset-library.md), [`../schemas/video-asset-catalog-v0.sql`](../schemas/video-asset-catalog-v0.sql) | `docs/plans/video-asset-library.md`, `docs/schemas/**`; later catalog tooling | `data/asset-catalog/**`, `data/assets/**` |
| Jimeng/Dreamina frontend API reversal | [`jimeng-frontend-api-reversal.md`](./jimeng-frontend-api-reversal.md), [`jimeng-dreamina-cli-goal.md`](./jimeng-dreamina-cli-goal.md), [`jimeng-fast-contract-extraction.md`](./jimeng-fast-contract-extraction.md) | `packages/jimeng-client/**`, `docs/provider/**`, this lane doc | `data/jimeng-captures/**`, `data/jimeng-lab/**` |
| TTS + lipsync research/bench | [`tts-lipsync-research.md`](./tts-lipsync-research.md) | this lane doc; optional future `packages/video-pipeline/**` only after coordinator approval | `data/research/**`, `data/tts-lipsync-bench/**` |
| Pleometric archive | [`pleometric-archive.md`](./pleometric-archive.md) | `packages/twitter-archive/**`, `apps/tweet-viewer/**`, `docs/twitter-archive-plan.md`, this lane doc | `data/twitter-archive/**` |
| AI UGC format mining | [`ai-ugc-format-mining.md`](./ai-ugc-format-mining.md) | this lane doc; later `packages/twitter-archive/**` or `packages/video-pipeline/**` after handoff | `data/ai-ugc-format-mining/**`, `data/twitter-archive/ugc-sources/**` |
| UGC Studio workspace | [`ugc-studio-workstreams.md`](./ugc-studio-workstreams.md) | `apps/slotok-workbench/src/renderer/**`, `docs/design/ugc-studio/**`, `docs/state/ugc-studio-style-direction.md` | `docs/qa/**`, later `data/ugc-studio/**` |
| Machine/run coordination | [`coordination-runbook.md`](./coordination-runbook.md), [`machine-roles.md`](./machine-roles.md), [`session-prompts.md`](./session-prompts.md) | coordination docs only | `data/coordination/**` |
| Pi agent control plane / cockpit | [`pi-agent-control-plane.md`](./pi-agent-control-plane.md) | control-plane/cockpit planning docs now; later `packages/control-plane/**`, `packages/tmux-cockpit/**`, and Pi extension glue | TBD |
| Symphony Lite meta-orchestration | [`symphony-lite.md`](./symphony-lite.md), [`../state/symphony-lite-direction.md`](../state/symphony-lite-direction.md) | workflow/orchestration planning docs now; later `packages/symphony-lite/**`, `packages/dynamic-workflows/**`, and cockpit glue | `data/symphony-lite/**`, cockpit DB |

## No-worktree coordination rules

Because all agents share one checkout:

1. **One lane edits one path family.** Do not edit another lane's owner paths without an explicit handoff.
2. **Do not edit `package.json`, root configs, or shared docs from worker lanes.** Ask the coordinator lane first.
3. **Generated/captured artifacts go under ignored `data/`.** Do not commit cookies, raw private captures, generated media, API keys, or browser profile data.
4. **Use dry-runs before quota-consuming generation.** Jimeng/Dreamina live generation stays concurrency `1` and stops on risk-control errors.
5. **Use status files under `data/coordination/` for handoff notes.** Suggested files:
   - `data/coordination/serialization.status.md`
   - `data/coordination/jimeng-reversal.status.md`
   - `data/coordination/tts-lipsync.status.md`
   - `data/coordination/pleometric-archive.status.md`
   - `data/coordination/ai-ugc-format-mining.status.md`
   - `data/coordination/desktop-gpu.status.md`
6. **Before edits, check:**
   ```bash
   git status --short
   git diff --name-only
   ```
7. **After edits, report:** changed files, commands run, and any runtime artifacts created.
8. **Only the coordinator commits.** Worker lanes should leave clean, reviewable diffs in their owned paths.

## Suggested tmux layout

Use isolated agent tmux socket, not personal tmux state:

```bash
export CLAUDE_TMUX_SOCKET_DIR="${TMPDIR:-/tmp}/claude-tmux-sockets"
mkdir -p "$CLAUDE_TMUX_SOCKET_DIR"
export SOCKET="$CLAUDE_TMUX_SOCKET_DIR/claude.sock"

# Examples; start only the lanes you need.
tmux -S "$SOCKET" new -d -s jimeng-reversal -n shell 'cd /Users/arthur/projects/pi-web-access && exec bash'
tmux -S "$SOCKET" new -d -s tts-lipsync -n shell 'cd /Users/arthur/projects/pi-web-access && exec bash'
tmux -S "$SOCKET" new -d -s pleometric-archive -n shell 'cd /Users/arthur/projects/pi-web-access && exec bash'
```

Monitor a session:

```bash
tmux -S "$SOCKET" attach -t jimeng-reversal
# or capture once:
tmux -S "$SOCKET" capture-pane -p -J -t jimeng-reversal:0.0 -S -200
```

## Recommended execution order

These can start in parallel:

1. **Creative state + serialization lane** defines the editable graph model and preserves Arthur's taste/vibe preferences.
2. **Asset catalog lane** creates reusable brainrot/UGC primitives and records prompts/tags/vibes in SQLite.
3. **TTS/lipsync lane** runs GPT-Pro/web research and collects benchmark candidates.
4. **Pleometric/UGC archive lane** starts low-risk metadata/media archival planning and dry-run tooling.
5. **Jimeng lane** first performs safe CLI/help inspection, then background-CDP capture of real frontend flows.
6. **Desktop GPU lane** evaluates whether the 3090 ComfyUI setup can generate useful local assets.

Merge point: after lanes report initial findings, implement a small pipeline runner/schema package that can call the best provider stack and register outputs in the asset catalog.

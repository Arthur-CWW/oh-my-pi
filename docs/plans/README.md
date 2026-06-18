# Parallel Workstream Plans

This directory is the repo-level ownership ledger for parallel work. Use it to decide which agent may edit which path family before launching implementation workers.

Before starting creative/video or orchestration work, read the state docs and relevant review personas:

```txt
docs/state/README.md
docs/state/video-creative-direction.md
docs/state/symphony-lite-direction.md
docs/review-agents/README.md
```

`video-creative-direction.md` is the living taste ledger / vibe bible / creative north-star for the project. Keep it synchronized with durable preferences Arthur states during sessions.

## Current lanes and owner paths

Coordinator-owned globals: `TASKS.md`, `AGENTS.md`, `package.json`, `.omp/**`, `.github/**`, `docs/state/**`, and this file. Worker lanes should not edit them unless their assignment names them explicitly.

| Lane | Plan doc | Primary owner paths | Runtime output paths | Package-local checks |
|---|---|---|---|---|
| Slotok / UGC workbench | [`slotok-workbench.md`](./slotok-workbench.md), [`ugc-studio-workstreams.md`](./ugc-studio-workstreams.md) | `apps/slotok-workbench/**`, `docs/design/ugc-studio/**`, Slotok/UGC QA notes | `data/ugc-studio/**`, `artifacts/slotok-visual-qa/**` | `bun run slotok:typecheck`, `bun run slotok:test`, `bun run slotok:build`, `cd apps/slotok-workbench && bun run visual:qa` |
| Web access core | [`repo-open-tasks-and-cleanup.md`](./repo-open-tasks-and-cleanup.md) | `packages/web-access/src/{search,fetch,cookies,youtube,config,store}.ts`, web-access tests/docs | package-local fixtures only | `cd packages/web-access && bun run typecheck && bun run test` |
| Frontend LLM browser | [`repo-open-tasks-and-cleanup.md`](./repo-open-tasks-and-cleanup.md) | `packages/web-access/src/frontend-browser*`, `packages/web-access/skills/llm-frontend-browser/**` until split | browser profiles under `~/.pi/**`, ignored proof artifacts | `cd packages/web-access && bun run typecheck && bun run test` |
| Computer-use / CuaDriver | [`repo-open-tasks-and-cleanup.md`](./repo-open-tasks-and-cleanup.md), [`pi-computer-use-locked-mode.md`](./pi-computer-use-locked-mode.md) | `packages/web-access/src/cua-driver.ts`, `packages/web-access/skills/macos-computer-use/**`, Cua/browser automation docs | local GUI proof artifacts under ignored `artifacts/**` | `cd packages/web-access && bun run typecheck && bun run test` |
| Browser-use prototype | package README | `packages/browser-use/**`, `scripts/browser-use-helium-background.sh` | dedicated Helium/CDP profile data | package help/smoke from `packages/browser-use` |
| Mermaid preview | package README | `packages/mermaid-preview/**` | none | `cd packages/mermaid-preview && bun run typecheck && bun run test` |
| Dynamic workflows | package README | `packages/dynamic-workflows/**`, workflow prompt templates | workflow fixtures/proofs | `bun run dynamic-workflows:typecheck`, `bun run dynamic-workflows:test` |
| UGC CLI | package README | `packages/ugc-cli/**`; possible future home for media diagnostic scripts | UGC proof artifacts under ignored `data/**`/`artifacts/**` | `bun run ugc:typecheck`, `bun run ugc:test` |
| Twitter archive / tweet viewer | [`../twitter-archive-plan.md`](../twitter-archive-plan.md) | `packages/twitter-archive/**`, `apps/tweet-viewer/**` | `data/twitter-archive/**` | `bun run twitter-archive:typecheck`, `bun run twitter-archive:test` |
| Jimeng/Dreamina frontend API reversal | [`jimeng-dreamina-cli-goal.md`](./jimeng-dreamina-cli-goal.md), [`jimeng-fast-contract-extraction.md`](./jimeng-fast-contract-extraction.md) | `packages/jimeng-client/**`, `docs/provider/**`, Jimeng-specific plans/QA notes | `data/jimeng-captures/**`, `data/jimeng-lab/**` | `bun run jimeng:typecheck`, `bun run jimeng:test` |
| Pipeline serialization | [`pipeline-serialization-format.md`](./pipeline-serialization-format.md) | `docs/plans/pipeline-serialization-format.md`; later `packages/video-pipeline/**` if created | `data/workflow-runs/**` | TBD package-local checks |
| Layered graph / creative state | [`layered-video-graph.md`](./layered-video-graph.md), [`../state/video-creative-direction.md`](../state/video-creative-direction.md) | `docs/plans/layered-video-graph.md`, `docs/state/video-creative-direction.md` | `data/workflow-runs/**` | docs/proof review |
| Asset catalog / brainrot assets | [`video-asset-library.md`](./video-asset-library.md), [`../schemas/video-asset-catalog-v0.sql`](../schemas/video-asset-catalog-v0.sql) | `docs/plans/video-asset-library.md`, `docs/schemas/**`; later catalog tooling | `data/asset-catalog/**`, `data/assets/**` | TBD package-local checks |
| Machine/run coordination | [`coordination-runbook.md`](./coordination-runbook.md), [`machine-roles.md`](./machine-roles.md), [`session-prompts.md`](./session-prompts.md) | coordination docs only unless explicitly assigned implementation | `data/coordination/**` | docs/proof review |
| Pi agent control plane / cockpit | [`pi-agent-control-plane.md`](./pi-agent-control-plane.md) | control-plane/cockpit planning docs now; `packages/web-access/src/agent-cockpit*` until split | cockpit SQLite DB | focused web-access tests |
| Symphony Lite meta-orchestration | [`symphony-lite.md`](./symphony-lite.md), [`../state/symphony-lite-direction.md`](../state/symphony-lite-direction.md) | `packages/dynamic-workflows/**`, Symphony planning docs, future `packages/symphony-lite/**` | `data/symphony-lite/**`, cockpit DB | dynamic-workflows package checks |

## Parallel coordination rules

Agents usually share one checkout, but `.omp/config.yml` enables APFS task isolation for OMP workers. Prefer isolated write workers for implementation slices; read-only scouts can stay in the shared checkout.

1. **One worker owns one path family.** Do not edit another lane's owner paths without an explicit handoff.
2. **Coordinator-owned globals stay coordinator-owned.** Root manifests/configs, `TASKS.md`, `AGENTS.md`, `.omp/**`, `.github/**`, and `docs/state/**` are shared surfaces.
3. **Dirty files are user/agent work.** Do not stage, revert, or rewrite unrelated dirty paths. Report unrelated dirty chunks in the handoff.
4. **Task packets beat broad prompts.** Assign exact owner paths, excluded paths, non-goals, fixtures/artifacts, package-local validation commands, and expected handoff.
5. **Generated/captured artifacts go under ignored `data/` or `artifacts/`.** Do not commit cookies, raw private captures, generated media, API keys, or browser profile data.
6. **Use dry-runs before quota-consuming generation.** Jimeng/Dreamina live generation stays concurrency `1` and stops on risk-control errors.
7. **Workers do not run project-wide gates.** Workers return recommended focused checks; the coordinator runs validation from the integrated tree.
8. **Only the coordinator commits.** Worker lanes leave reviewable diffs in their owned paths.

## Suggested tmux layout

Use isolated agent tmux socket, not personal tmux state:

```bash
export CLAUDE_TMUX_SOCKET_DIR="${TMPDIR:-/tmp}/claude-tmux-sockets"
mkdir -p "$CLAUDE_TMUX_SOCKET_DIR"
export SOCKET="$CLAUDE_TMUX_SOCKET_DIR/claude.sock"

# Examples; start only the lanes you need.
tmux -S "$SOCKET" new -d -s jimeng-reversal -n shell 'cd /Users/arthur/agents/web-access && exec bash'
tmux -S "$SOCKET" new -d -s tts-lipsync -n shell 'cd /Users/arthur/agents/web-access && exec bash'
tmux -S "$SOCKET" new -d -s pleometric-archive -n shell 'cd /Users/arthur/agents/web-access && exec bash'
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

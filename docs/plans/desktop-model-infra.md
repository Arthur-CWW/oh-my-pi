# Desktop model-pipeline infrastructure — consolidation proposal

*Status: PROPOSAL (playground orchestrator, 2026-07-16). Requires buy-in from companion (queue owner) and fleet Main before implementation. Arthur asked for consolidation of all model-pipeline work on the RTX desktop now that GPU/network issues are fixed.*

## Ground truth (2026-07-16)

- RTX 3090 24GB, driver 570.172.08, GPU/network healthy.
- **Disk: 99% full (9.4G free of 854G).** `~/.cache` 168G (129G HF hub), old research dirs ~300G (`verifiers-fork` 151G, `dual-search-rl` 41G, `zed` 33G, `mojo-gpu-puzzles` 22G, `ComfyUI` 19G…), playground lanes 44G (`sonic-lab` 23G — lane now PARKED, `tts-lab` 12G, `latwalk-lab` 8.8G).
- **The queue kernel already exists and is proven**: companion's `~/projects/model-bench/queue/` — durable file-backed, atomic claim, serialized GPU execution, per-job nvidia-smi sampling, crash recovery, fail-closed licensed lanes, Mac CLI `scripts/gpu-queue.ts` (submit/status/logs/cancel). Proofs in `streams/companion/notes/gpu-queue.md`.
- Companion routing policy (adopt fleet-wide): **Mac = realtime authority** (voice capture/playback, interactive renderers, dev servers); **desktop = all batch/model compute**, tmux + durable manifest + log.
- Current sprawl: each stream provisions ad-hoc venvs in `~` (`tts-lab`, `sonic-lab`, `latwalk-lab`, `companion-batch`, ComfyUI…), some with private weight downloads duplicating the HF cache, no torch pins (the Kokoro venv silently drifted to an incompatible torch TWICE in 24h).

## Design: extend the queue, don't reinvent

One GPU → one serialized queue → one integration contract. Four layers on top of the existing kernel:

### Layer 0 — disk as a managed budget
- **Shared weights**: every env sets `HF_HOME=~/.cache/huggingface` (it already holds 129G); private weight dirs get migrated or symlinked. New model downloads land in the shared cache by default.
- **Triage ledger**: `~/projects/model-bench/DISK.md` — one row per >5G directory: owner stream, purpose, last-used, verdict (keep/archive/delete). Seeded from the du audit above; Arthur adjudicates the old research dirs (~300G — not agents' call). Immediate agent-reclaimable: `sonic-lab` 23G once Arthur confirms the parked verdict.
- **Floor**: keep ≥100G free; any job kind that downloads >5G declares it in its manifest.

### Layer 1 — environment registry (fixes the torch-drift failure class)
- `~/projects/model-bench/envs/<name>/`: uv venv + `MANIFEST.json` (owner stream, model family, torch/CUDA pins, weights refs into HF cache, `proof` command) + `preflight.sh` (imports torch, asserts `cuda.is_available()`, checks weight paths — same pattern as the existing `preflight-licensed.sh`).
- Existing venvs migrate in place first (symlink into the registry + add manifest), physical moves later. Pinned lockfiles (`uv pip freeze`) committed to the manifest dir so a broken env is rebuildable in one command.

### Layer 2 — namespaced queue kinds (the integration contract)
- `kinds.sh` grows namespaced kinds: `companion.gpu-pose-batch`, `companion.gvhmr-mesh`, `companion.wilor-3d` (renames of existing), `playground.tts-kokoro`, `playground.tts-clone-qwen3`, `playground.latwalk`, `shared.whisper-transcribe`, `shared.ffprobe-batch`. Each kind = env ref + argv template + preflight gate. `generic` stays for ad-hoc.
- Streams add kinds by PR-style edits to `kinds.sh` coordinated through fleet Main; companion reviews (they own the kernel). A kind addition never edits `runner.sh`/`submit.sh`/`control.sh`.
- Agents STOP doing ad-hoc `ssh desktop` + tmux for GPU work once their kind exists — submit through the queue; serialization replaces the fragile "check nvidia-smi and hope" dance.

### Layer 3 — persistent services (distinct from batch)
- Some consumers want a hot endpoint (e.g. TTS HTTP for interactive use, future ComfyUI). These are NOT queue jobs: `~/projects/model-bench/services.yml` (name, env, cmd, healthz URL, owner) run in tmux windows under one `desktop-services` session, mirroring the Mac-side `services.yml`/OPERATIONS.md pattern. Realtime-latency services stay on the Mac per routing policy.

### Layer 4 — artifact return
- Results land under `~/projects/model-bench/results/<kind>/<job-id>/`. Add `gpu-queue.ts fetch JOB_ID [dest]` (rsync pull by job id) so Mac-side agents never hand-roll scp paths.

## Ownership and coordination

| Piece | Owner | Change protocol |
|---|---|---|
| Queue kernel (runner/submit/control) | companion | companion orchestrator only |
| `kinds.sh` entries, envs, manifests | each stream for its namespace | announce via fleet Main; companion sanity-checks |
| `DISK.md` ledger | shared | update whenever adding >5G; Arthur adjudicates non-agent dirs |
| `gpu-queue.ts` Mac CLI | companion (playground contributes `fetch`) | PR-style |
| desktop-services.yml | shared | announce via fleet Main |

## Migration order (each step independently useful)

1. **Disk triage ledger + Arthur's adjudication list** (unblocks everything; zero risk).
2. Env registry manifests over existing venvs (tts-lab first — it broke twice).
3. Playground kinds: `playground.tts-kokoro`, `playground.tts-clone-qwen3` (+ `shared.whisper-transcribe`).
4. `fetch` subcommand.
5. Namespace the existing companion kinds (rename with back-compat aliases).
6. Desktop services registry when the first hot endpoint is actually needed.

## Non-goals

- No scheduler beyond the serialized queue (one GPU; FIFO is correct until proven otherwise).
- No containers/k8s — uv venvs + manifests are sufficient and match fleet practice.
- No Mac-side realtime moves to the desktop (routing policy stands).
- No sudo anywhere in this plan.

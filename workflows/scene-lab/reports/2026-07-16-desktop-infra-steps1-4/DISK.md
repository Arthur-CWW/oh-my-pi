# Desktop disk ledger

Audit: 2026-07-17 02:02–02:07 AEST (`desktop`). Sizes are fresh `du -sh`/depth-1 `du` measurements except where marked. `last-used` is the directory mtime heuristic, not proof that every child is live. Nothing was deleted.

| directory | size | owner | purpose | last-used (mtime) | verdict |
|---|---:|---|---|---|---|
| `~/projects` | 23G | companion | Active model-bench queue/results plus GVHMR and face-identity projects | 2026-07-14 | keep |
| `~/simple-rl-env` | 7.9G | arthur-research | Older RL/PufferLib/ViZDoom development environment | 2025-08-09 | ARTHUR-ADJUDICATE |
| `~/flash-attention-minimal` | 5.1G | arthur-research | FlashAttention experiment checkout and venv | 2025-04-21 | ARTHUR-ADJUDICATE |
| `~/verifiers-fork` | 151G | arthur-research | Verifiers/GRPO research checkout, venv, model outputs and logs | 2025-04-05 | ARTHUR-ADJUDICATE |
| `~/tts-lab` | 12G | playground | Active Kokoro and Qwen3-TTS environments, weights references and render evidence | 2026-07-16 | keep |
| `~/latwalk-lab` | 8.8G | playground | Latent/image walk, FILM and faster-whisper workflow artifacts | 2026-07-09 | keep |
| `~/ESFT` | 8.2G | arthur-research | Older ESFT model research checkout and venv | 2025-04-06 | ARTHUR-ADJUDICATE |
| `~/dual-search-rl` | 41G* | arthur-research | Dual-search RL research checkout, venv and Postgres data | 2025-05-23 | ARTHUR-ADJUDICATE |
| `~/.vscode-server` | 5.0G | unknown | Remote VS Code server builds and extensions | 2025-12-11 | reclaim-candidate |
| `~/HSK-deck` | 7.6G | arthur-research | HSK deck corpus, generated audio and project venv | 2026-05-29 | ARTHUR-ADJUDICATE |
| `~/RAGEN` | 5.9G | arthur-research | Older RAGEN research checkout and environment | 2025-05-28 | ARTHUR-ADJUDICATE |
| `~/.cache` | 297G | unknown | Aggregate package/model/tool caches; large children itemized below | 2026-07-14 | keep |
| `~/sonic-lab` | 17G | playground | Parked Sonic talking-head lane, checkpoints and render evidence | 2026-07-17 | reclaim-candidate |
| `~/.local` | 21G | unknown | User-space tools and application data (`share`, `bin`, `state`) | 2025-04-21 | ARTHUR-ADJUDICATE |
| `~/manifold-env` | 9.8G | arthur-research | Older manifold research checkout and venv | 2025-06-12 | ARTHUR-ADJUDICATE |
| `~/zed` | 33G | arthur-research | Zed source/build checkout and Rust build artifacts | 2025-06-08 | ARTHUR-ADJUDICATE |
| `~/ComfyUI` | 9.3G | arthur-research | ComfyUI checkout, venv, models and workflow state | 2026-07-14 | ARTHUR-ADJUDICATE |
| `~/.cache/uv` | 133G | unknown | uv wheels/source/build cache shared by many environments | 2026-07-17 | reclaim-candidate |
| `~/.cache/huggingface` | 129G | playground | Shared Hugging Face hub weights, including Kokoro, Qwen3-TTS and whisper | 2026-07-15 | keep |
| `~/.cache/rattler` | 15G | unknown | Conda/rattler package cache | 2025-06-16 | reclaim-candidate |
| `~/.cache/pip` | 9.7G | unknown | pip download/wheel cache | 2026-07-06 | reclaim-candidate |
| `~/.cache/vscode-cpptools` | 5.2G | unknown | VS Code C/C++ extension cache | 2025-08-05 | reclaim-candidate |
| `~/companion-batch` | 2.1G | companion | Active companion batch environment/worktree | 2026-07-15 | keep |
| `~/projects/model-bench/results/gpu-pose-batch` | 627M | companion | Companion GPU pose batch evidence-of-record | 2026-07-16 | keep |

\* `~/dual-search-rl` reused the plan audit size because fresh `du` could not read its root-owned `postgres-data`; no sudo was used.

## Arthur adjudication — one glance

| directory | size | best guess at disposability |
|---|---:|---|
| `~/sonic-lab` | 17G | Likely disposable after Arthur confirms the parked lane and retained report artifacts are sufficient. |
| `~/.cache/uv` | 133G | Usually reproducible; strong reclaim candidate, but active environments may incur rebuild/download cost. |
| `~/.cache/rattler` | 15G | Usually reproducible package cache; likely disposable if no active offline workflow depends on it. |
| `~/.cache/pip` | 9.7G | Usually reproducible package cache; likely disposable. |
| `~/.cache/vscode-cpptools` | 5.2G | Likely disposable extension cache. |
| `~/.vscode-server` | 5.0G | Old server builds likely disposable; retain current remote-server version if needed. |
| `~/verifiers-fork` | 151G | Potentially large win, but model outputs may be unique research evidence; inspect before deciding. |
| `~/dual-search-rl` | 41G | Probably old, but Postgres data may be unique and is root-owned; adjudicate, do not agent-delete. |
| `~/zed` | 33G | Build artifacts likely reproducible; source/worktree state may not be. |
| `~/.local` | 21G | Mixed live user tooling and data; inspect `share` before any reclamation. |
| `~/ComfyUI` | 9.3G | Recent use suggests keep unless superseded; models may overlap HF cache. |
| `~/manifold-env` | 9.8G | Appears old/reproducible, but research state needs Arthur's call. |
| `~/ESFT` | 8.2G | Appears old; research outputs may be unique. |
| `~/simple-rl-env` | 7.9G | Appears old; environment likely reproducible, project state needs review. |
| `~/HSK-deck` | 7.6G | Likely contains unique generated audio/corpus; archive rather than delete if retired. |
| `~/RAGEN` | 5.9G | Appears old/reproducible, subject to research-state review. |
| `~/flash-attention-minimal` | 5.1G | Appears old; venv/build artifacts likely reproducible. |

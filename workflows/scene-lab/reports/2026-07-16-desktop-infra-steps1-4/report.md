---
date: 2026-07-16
status: complete
scope: desktop-model-infra-steps-1-4
desktop: desktop
---

# Desktop model infrastructure steps 1–4

This report records the exact implementation commands and observed outputs for the disk ledger, environment registry, queue kinds, and artifact fetch command.


## Step 1 — disk ledger

Commands:

```sh
ssh desktop 'du -sh ~/.cache ~/companion-batch ~/sonic-lab ~/tts-lab ~/latwalk-lab ~/verifiers-fork ~/dual-search-rl ~/zed ~/mojo-gpu-puzzles ~/ComfyUI ~/projects/model-bench/results/gpu-pose-batch'
ssh desktop 'du -x -B1 --max-depth=1 ~; du -x -B1 --max-depth=1 ~/.cache'
rsync -a workflows/scene-lab/reports/2026-07-16-desktop-infra-steps1-4/DISK.md desktop:projects/model-bench/DISK.md
ssh desktop 'test -s ~/projects/model-bench/DISK.md && wc -l ~/projects/model-bench/DISK.md'
```

Observed:

```text
/dev/nvme0n1p5  854G  801G  9.4G  99% /
297G ~/.cache
17G  ~/sonic-lab
12G  ~/tts-lab
8.8G ~/latwalk-lab
151G ~/verifiers-fork
41G  ~/dual-search-rl (plan audit reused: fresh du could not read root-owned postgres-data)
33G  ~/zed
9.3G ~/ComfyUI
54 ~/projects/model-bench/DISK.md
```

`DISK.md` is present both at `~/projects/model-bench/DISK.md` on the desktop and beside this report. It includes all depth-1 directories over 5 GB under `~` and `~/.cache`, the binding below-threshold companion evidence rows, and Arthur's one-glance adjudication table. No files were deleted.

## Step 2 — environment registry

Registry creation and lock commands:

```sh
rsync -a /tmp/infra-env-registry/ desktop:projects/model-bench/envs/
ssh desktop 'ln -sfn ~/tts-lab/.venv ~/projects/model-bench/envs/playground-kokoro/env'
ssh desktop 'ln -sfn ~/tts-lab/fish/.venv ~/projects/model-bench/envs/playground-qwen3-tts/env'
ssh desktop 'ln -sfn ~/latwalk-lab/venv ~/projects/model-bench/envs/playground-latwalk/env'
ssh desktop 'for name in playground-kokoro playground-qwen3-tts playground-latwalk; do uv pip freeze --python ~/projects/model-bench/envs/$name/env/bin/python > ~/projects/model-bench/envs/$name/requirements.lock; done'
bun scripts/gpu-queue.ts submit --kind generic -- /home/arthur/projects/model-bench/envs/playground-kokoro/preflight.sh
bun scripts/gpu-queue.ts submit --kind generic -- /home/arthur/projects/model-bench/envs/playground-qwen3-tts/preflight.sh
bun scripts/gpu-queue.ts submit --kind generic -- /home/arthur/projects/model-bench/envs/playground-latwalk/preflight.sh
```

Observed symlinks and locks:

```text
playground-kokoro/env -> /home/arthur/tts-lab/.venv
playground-qwen3-tts/env -> /home/arthur/tts-lab/fish/.venv
playground-latwalk/env -> /home/arthur/latwalk-lab/venv
125 playground-kokoro/requirements.lock
121 playground-qwen3-tts/requirements.lock
116 playground-latwalk/requirements.lock
```

Preflight jobs and exact outputs:

```text
20260716T161026-cb6521  done exit=0
READY playground-kokoro python torch=2.9.1+cu128 cuda=12.8 gpu=NVIDIA GeForce RTX 3090

20260716T161027-4756b6  done exit=0
READY playground-qwen3-tts python torch=2.9.1+cu128 cuda=12.8 gpu=NVIDIA GeForce RTX 3090

20260716T161027-e30526  done exit=0
READY playground-latwalk python torch=2.5.1+cu124 cuda=12.4 gpu=NVIDIA GeForce RTX 3090
```

Each directory contains `MANIFEST.json`, `preflight.sh`, `requirements.lock`, and the in-place `env` symlink. Every manifest records its live pins, weight locations, proof command, and a pending HF_HOME-unification TODO. No venv or weight was moved.

## Step 3 — append-only playground/shared queue kinds

Pre-append daemon canary:

```sh
bun scripts/gpu-queue.ts submit --kind generic -- python3 -c 'print("pre-append canary")'
# 20260716T160436-866eaa
bun scripts/gpu-queue.ts logs 20260716T160436-866eaa
```

```text
[2026-07-16T16:04:39Z] claimed id=20260716T160436-866eaa
[2026-07-16T16:04:39Z] nvidia-smi compute apps:
<none>
pre-append canary
state=done exit=0
```

Append and structural checks:

```sh
ssh desktop 'wc -lc ~/projects/model-bench/queue/kinds.sh; sha256sum ~/projects/model-bench/queue/kinds.sh'
# 117 lines, 4676 bytes
# 7d29c08348dc5108ae2ba4e546de21847f8d1eabddca92857835ad70dc5c669b
rsync -a /tmp/kinds.append.sh desktop:/tmp/kinds.append.sh
# Remote Python opened kinds.sh in binary append mode and wrote only /tmp/kinds.append.sh.
ssh desktop 'bash -n ~/projects/model-bench/queue/kinds.sh'
```

Post-append prefix proof:

```text
prefix-bytes 4676
prefix-sha256 7d29c08348dc5108ae2ba4e546de21847f8d1eabddca92857835ad70dc5c669b
total-bytes 7990
```

The pre-existing 4,676 bytes are byte-for-byte unchanged. The append adds:

- `playground.tts-kokoro`: `playground-kokoro` preflight, then `~/tts-lab/generate_kokoro.py`; requires `--scripts` and `--output-dir`.
- `playground.tts-clone-qwen3`: `playground-qwen3-tts` preflight, then the existing `~/tts-lab/fish/generate_clones.py` through a guard that clamps `max_new_tokens=1024` and rejects any output over 90 seconds before publishing it.
- `shared.whisper-transcribe`: `playground-latwalk` preflight and its already-installed faster-whisper 1.2.1 / large-v3-turbo weights; requires `--input` and `--output-dir`.

Real queue proof:

```sh
ssh desktop 'exec ~/projects/model-bench/queue/submit.sh --kind playground.tts-kokoro --scripts ~/projects/model-bench/proofs/kokoro-short.json --output-dir ~/projects/model-bench/results/playground.tts-kokoro/infra-proof-20260716 --voice am_michael --comparison-voice am_fenrir --speed 0.9'
# 20260716T161312-364d51
bun scripts/gpu-queue.ts logs 20260716T161312-364d51
```

```text
READY playground-kokoro python torch=2.9.1+cu128 cuda=12.8 gpu=NVIDIA GeForce RTX 3090
[2026-07-16T16:13:18Z] runner nvidia-smi gpu: 2026/07/17 02:13:18.744, 0 %, 4 MiB, 33.87 W, 47
[2026-07-16T16:13:20Z] runner nvidia-smi gpu: 2026/07/17 02:13:20.785, 26 %, 1128 MiB, 130.59 W, 53
exitCode 0
generation-metrics.json 839 bytes
the-number-with-no-name-am_fenrir.wav 270044 bytes
the-number-with-no-name-am_michael.wav 307244 bytes
```

Post-append daemon canary:

```sh
bun scripts/gpu-queue.ts submit --kind generic -- python3 -c 'print("post-append canary")'
# 20260716T161345-138ade
bun scripts/gpu-queue.ts logs 20260716T161345-138ade
```

```text
[2026-07-16T16:13:45Z] claimed id=20260716T161345-138ade
[2026-07-16T16:13:45Z] nvidia-smi compute apps:
<none>
post-append canary
exitCode 0
```

## Step 4 — Mac-side `fetch`

Implementation scope in `scripts/gpu-queue.ts`:

- one usage line: `fetch JOB_ID [dest]`
- one `case "fetch"` branch
- no queue kernel, submitter, runner, control, or kind-renaming changes

The branch searches both the current `done/` and `failed/` manifest directories by job id. It reads `--output-dir` values from the stored command array; jobs without one fall back to their stored `logFile`. Therefore pre-namespacing job manifests remain resolvable without a results-path migration.

Proof-job fetch using the default destination:

```sh
bun scripts/gpu-queue.ts fetch 20260716T161312-364d51
```

Observed local files:

```text
gpu-queue-fetch/20260716T161312-364d51/infra-proof-20260716/generation-metrics.json
gpu-queue-fetch/20260716T161312-364d51/infra-proof-20260716/the-number-with-no-name-am_fenrir.wav
gpu-queue-fetch/20260716T161312-364d51/infra-proof-20260716/the-number-with-no-name-am_michael.wav
```

Local and desktop SHA-256 values matched:

```text
fd216829a1532608ba8a6910a74c533a5d853c2ffcdc2662094fd459cfb345ef  generation-metrics.json
bb69eb30bb0cf9ac1c318547c711a12e69e7ea3b52bb49cdef3556d534a888f4  the-number-with-no-name-am_fenrir.wav
244c196c0bb3d0f4b2af554138d0a42963fe0066347692c8ca25394c7dd48b18  the-number-with-no-name-am_michael.wav
```

Pre-namespacing data-continuity proof:

```sh
bun scripts/gpu-queue.ts fetch 20260715T130731-825e6e /tmp/legacy-fetch-proof
```

```text
/tmp/legacy-fetch-proof/gpu-queue-proof-real/7202062507735928107.jsonl
/tmp/legacy-fetch-proof/gpu-queue-proof-real/7201654498715159854.jsonl
/tmp/legacy-fetch-proof/gpu-queue-proof-real/7200911766728002858.jsonl
/tmp/legacy-fetch-proof/gpu-queue-proof-real/manifest.json
```

Failed-manifest/log fallback proof:

```sh
bun scripts/gpu-queue.ts fetch 20260715T131505-dcfc79 /tmp/failed-fetch-proof
```

```text
/tmp/failed-fetch-proof/gpu-queue-20260715T131505-dcfc79.log
```

Focused compile:

```sh
bun build scripts/gpu-queue.ts --target=bun --outfile=/tmp/gpu-queue-cli.js
```

```text
gpu-queue-cli.js  5.20 KB  (entry point)
```

Remote helper syntax checks:

```sh
bash -n ~/projects/model-bench/envs/playground-kokoro/run-kokoro.sh ~/projects/model-bench/envs/*/preflight.sh
~/projects/model-bench/envs/playground-qwen3-tts/env/bin/python -m py_compile ~/projects/model-bench/envs/playground-qwen3-tts/run-guarded-clone.py
~/projects/model-bench/envs/playground-latwalk/env/bin/python -m py_compile ~/projects/model-bench/envs/playground-latwalk/transcribe.py
```

```text
queue helper syntax: PASS
```

## Final state

All four requested steps are complete. The queue daemon remained healthy across the append, the real Kokoro proof ran only through the serialized queue and produced runner GPU samples, existing result paths were not migrated, and no files or weights were deleted or moved.

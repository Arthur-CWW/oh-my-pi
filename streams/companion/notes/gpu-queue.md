# GPU job queue

The RTX desktop runs a durable, file-backed queue from `~/projects/model-bench/queue/`. It serializes jobs because one `runner.sh` loop claims and waits for one process at a time.

## Layout

```text
~/projects/model-bench/
├── queue/
│   ├── pending/       # submitted JSON jobs
│   ├── running/       # atomically claimed job
│   ├── done/          # exitCode 0
│   ├── failed/        # nonzero, canceled, or crash-recovered
│   ├── runner.sh      # single worker loop
│   ├── kinds.sh       # kind → argv translation
│   ├── submit.sh      # atomic JSON submission
│   └── control.sh     # status, logs, cancellation
└── logs/
    ├── gpu-queue-daemon.log
    └── gpu-queue-<job-id>.log
```

Each job is inspectable JSON with `id`, `createdAt`, `kind`, an argv-array `command`, `cwd`, `logFile`, and optional `env`. The runner adds `startedAt`, `pid`, `finishedAt`, and `exitCode`. It appends the pre-run `nvidia-smi --query-compute-apps` result to the job log, waits while another compute process exists, and executes with plain stdout/stderr redirection (never a `tee` pipeline).

The daemon lives in the desktop tmux session `gpu-queue`. Inspect it without touching other sessions:

```bash
ssh -x -o BatchMode=yes desktop "bash -lc 'tmux has-session -t =gpu-queue'"
```

## Mac CLI

Run from the outer `~/agents` repository. SSH uses host `desktop` by default, `BatchMode=yes`, and a remote `bash -lc` wrapper. Override only the SSH alias with `GPU_QUEUE_HOST`.

```bash
bun scripts/gpu-queue.ts submit --kind gpu-pose-batch \
  --input-dir /home/arthur/projects/model-bench/data/sico \
  --output-dir /home/arthur/projects/model-bench/results/gpu-pose-batch/new-run \
  --limit 3 --overwrite

bun scripts/gpu-queue.ts submit --kind generic -- python3 -c 'print("hello")'
bun scripts/gpu-queue.ts status
bun scripts/gpu-queue.ts logs <job-id>
bun scripts/gpu-queue.ts logs <job-id> --follow
bun scripts/gpu-queue.ts cancel <job-id>
bun scripts/gpu-queue.ts cancel <job-id> --force
```

Normal cancellation is pending-only and moves the job to `failed/` with a cancellation note. A running job is untouched unless `--force` is explicit. Forced cancellation targets only the recorded process group: TERM, a 10-second grace period, then KILL if it still exists.

## Adding GVHMR mesh generation

GVHMR remains unavailable until Arthur's licensed SMPL model files exist on the desktop. Once they do, add a `gvhmr-mesh-gen)` case to `kinds.sh` that validates its flags and fills `JOB_CWD`, `JOB_COMMAND` (argv array), and optional `JOB_ENV`. Then allow that kind in the Mac CLI. The runner requires no change because it executes the translated argv recorded in the same job schema.

## Crash recovery

Submission writes a temporary file and atomically renames it into `pending/`; claiming atomically renames the oldest job into `running/`. On daemon startup, any JSON left in `running/` is treated as an interrupted process: the runner adds `finishedAt`, a `recoveryNote`, and `exitCode: null`, then moves it to `failed/`. Jobs are not retried automatically. Completed and failed JSON plus logs remain in place for inspection.

## Post-handoff fixes (orchestrator, 2026-07-15)

- `kinds.sh` pointed gpu-pose-batch at the wrong venv (`.venvs/rtmpose-body`, no cuDNN extras) → CPU fallback at 5 fps. Fixed to `models/gpu-pose-batch/.venv/bin/python` + explicit `LD_LIBRARY_PATH` over the venv's vendored `nvidia/*/lib` dirs via `JOB_ENV`.
- `runner.sh` executed `env "${JOB_ENV[@]}" -- cmd`; GNU env stops option parsing after the first `NAME=VALUE`, so `--` became the command (exit 127). Separator removed.
- Daemon relaunch shape: `tmux new-session -d -s gpu-queue 'bash -lc "~/projects/model-bench/queue/runner.sh >> ~/projects/model-bench/logs/gpu-queue-runner.log 2>&1"'`.
- CUDA proof through the queue: job `20260715T135941-6f71a7` — 3 clips / 840 frames / 24.6s, 40 fps inference, GPU 76-78% util, NVDEC decode, exit 0.

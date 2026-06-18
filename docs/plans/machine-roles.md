# Machine Roles and Tool Inventory

## Goal

Use the main Mac, Framework laptop, and desktop GPU box in parallel without source collisions or account-risky behavior.

## Current discovered machines

### Main Mac

Role:

- source-of-truth checkout at `/Users/arthur/agents/web-access`
- logged-in browser profiles for Jimeng/Dreamina/X/ChatGPT/Gemini frontend work
- Dreamina CLI and Chrome/Firefox cookie access
- Gemini CLI video analysis
- final code edits and commits

Use for:

- Jimeng frontend API capture via background CDP
- official `dreamina` CLI experiments
- ChatGPT Pro/Gemini research
- source edits and coordination

Avoid:

- long uncontrolled media downloads while also using browser sessions
- foreground browser automation unless explicitly requested

### Desktop GPU box

Discovered via SSH alias `desktop`:

```txt
OS: Ubuntu Linux x86_64
GPU: NVIDIA GeForce RTX 3090, 24576 MiB VRAM, driver 570.172.08
Home/root disk: ~89G free at check time, so avoid huge model downloads without cleanup/storage plan
ffmpeg: installed
python3: installed
node: installed
git: installed
tmux: installed
bun: missing
yt-dlp: missing
gallery-dl: missing
uv: missing
ComfyUI: /home/arthur/ComfyUI exists
ComfyUI venv: /home/arthur/ComfyUI/.venv works
ComfyUI torch: 2.8.0+cu128, CUDA available
Current ComfyUI models: ~7.5G checkpoints, mostly waiNSFWIllustrious_v140.safetensors; minimal ControlNet
ComfyUI repo dirty/untracked from previous setup attempts
```

Role recommendation:

- GPU/local-model experimentation worker
- ComfyUI rehab only if useful for composable asset generation
- local/open-source TTS/lipsync benchmarks
- procedural/render-heavy asset pack generation

Use for:

- `data/assets/**`
- `data/tts-lipsync-bench/**`
- `data/comfyui-experiments/**`
- `data/models/**` only if disk budget allows

Avoid initially:

- source edits in this repo unless synced/approved
- huge model downloads without checking disk
- X/Twitter logged-in capture; keep account-risky work on main Mac or controlled account

### Framework laptop

Discovered via SSH alias `framework`:

```txt
OS: Ubuntu Linux x86_64
Home disk: ~742G free on /home at check time
ffmpeg: installed
yt-dlp: installed at ~/.local/bin/yt-dlp
tmux: installed
python3: installed
node: installed
git: installed
uv: installed
bun: missing
gallery-dl: missing
```

Role recommendation:

- runtime/data worker first, not source-editing worker
- long-running archive downloads
- media preprocessing/transcoding
- local/open-source TTS/lipsync/model experiments if GPU/CPU performance is acceptable

Use for:

- `data/twitter-archive/**`
- `data/tts-lipsync-bench/**`
- `data/models/**` if needed
- detached tmux jobs

Avoid initially:

- editing tracked source files
- logged-in X scraping until a safer account/session strategy is chosen
- high-volume Twitter/X requests

## Desktop setup gaps

Needed before full use:

- decide whether to clean or preserve the dirty `/home/arthur/ComfyUI` checkout
- install `uv`/`yt-dlp`/`gallery-dl` only if needed
- identify a larger storage path if model downloads exceed current free space
- create a clear project/data directory, e.g. `/home/arthur/projects/pi-workflows-runtime`
- decide whether to use ComfyUI directly or simpler Python/ffmpeg/procedural generators first

## Framework setup gaps

Needed before full use:

- clone or rsync this repo to a clear work path, e.g. `/home/arthur/projects/pi-workflows`
- install `gallery-dl` if chosen
- install `bun` only if source/package tooling is needed there
- decide whether X cookies should be present on Framework; safer default is no

## Safe remote tmux convention

On Framework:

```bash
export CLAUDE_TMUX_SOCKET_DIR="${TMPDIR:-/tmp}/claude-tmux-sockets"
mkdir -p "$CLAUDE_TMUX_SOCKET_DIR"
export SOCKET="$CLAUDE_TMUX_SOCKET_DIR/claude.sock"

tmux -S "$SOCKET" new -d -s pleometric-archive -n archive 'cd /home/arthur/projects/pi-workflows && exec bash'
```

Monitor:

```bash
ssh framework 'tmux -S "${TMPDIR:-/tmp}/claude-tmux-sockets/claude.sock" capture-pane -p -J -t pleometric-archive:0.0 -S -200'
```

Attach interactively:

```bash
ssh -t framework 'tmux -S "${TMPDIR:-/tmp}/claude-tmux-sockets/claude.sock" attach -t pleometric-archive'
```

## Sync strategy without worktrees

Recommended:

1. Main Mac remains authoritative source checkout.
2. Framework/desktop receive code snapshots via git clone/pull or `rsync`, but write only ignored `data/**` outputs.
3. Bring remote artifacts back with `rsync` into main Mac `data/**` when needed.
4. Only main Mac produces tracked diffs/commits.

Example artifact sync from Framework to Mac, run on Mac:

```bash
mkdir -p data/twitter-archive
rsync -av --partial --progress framework:/home/arthur/projects/pi-workflows/data/twitter-archive/ data/twitter-archive/
```

Example artifact sync from desktop GPU to Mac:

```bash
mkdir -p data/assets data/tts-lipsync-bench
rsync -av --partial --progress desktop:/home/arthur/projects/pi-workflows-runtime/data/assets/ data/assets/
rsync -av --partial --progress desktop:/home/arthur/projects/pi-workflows-runtime/data/tts-lipsync-bench/ data/tts-lipsync-bench/
```

## X/Twitter risk posture

- Prefer public metadata/media capture with low request volume.
- Use alternate/login-isolated account before logged-in archival if possible.
- Do not scrape likes/bookmarks.
- Do not bypass challenges or rate limits.
- Use cache and download archives to avoid repeated fetches.
- Start with small bounded runs and inspect status before expanding.

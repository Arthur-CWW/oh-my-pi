# Coordination Runbook

## Purpose

Keep multiple agents/jobs moving in parallel in one checkout, without git worktrees and without stepping on each other.

## Source-of-truth checkout

Main Mac:

```txt
/Users/arthur/projects/pi-web-access
```

Only this checkout should produce tracked commits unless explicitly changed.

## Current workstream docs

Read these first:

1. `docs/state/README.md`
2. `docs/state/video-creative-direction.md` for video/creative/UGC work
3. `docs/plans/README.md`
4. `docs/plans/layered-video-graph.md`
5. lane-specific doc:
   - `docs/plans/pipeline-serialization-format.md`
   - `docs/plans/jimeng-frontend-api-reversal.md`
   - `docs/plans/tts-lipsync-research.md`
   - `docs/plans/pleometric-archive.md`
   - `docs/plans/ai-ugc-format-mining.md`
   - `docs/plans/machine-roles.md`

## Start-of-lane checklist

```bash
cd /Users/arthur/projects/pi-web-access
git status --short
git diff --name-only
mkdir -p data/coordination
```

If Arthur gives durable new preferences/direction during the lane, update the relevant `docs/state/**` file before handing off.

Create/update one status file:

```txt
data/coordination/<lane>.status.md
```

Recommended lane slugs:

- `serialization`
- `jimeng-reversal`
- `tts-lipsync`
- `pleometric-archive`
- `ai-ugc-format-mining`
- `desktop-gpu`

## Worker lane rules

- Edit only the lane's owner paths.
- Write captures/downloads/renders under ignored `data/**`.
- Do not commit.
- Do not edit root `package.json`, root configs, or other lanes' docs/code without handoff.
- Do not consume paid quota or trigger live generation unless the run is explicitly approved.
- Stop on auth challenges, CAPTCHAs, account-risk messages, or Jimeng risk-control errors.

## Main Mac tmux sessions

```bash
export CLAUDE_TMUX_SOCKET_DIR="${TMPDIR:-/tmp}/claude-tmux-sockets"
mkdir -p "$CLAUDE_TMUX_SOCKET_DIR"
export SOCKET="$CLAUDE_TMUX_SOCKET_DIR/claude.sock"

tmux -S "$SOCKET" new -d -s serialization -n shell 'cd /Users/arthur/projects/pi-web-access && exec bash'
tmux -S "$SOCKET" new -d -s jimeng-reversal -n shell 'cd /Users/arthur/projects/pi-web-access && exec bash'
tmux -S "$SOCKET" new -d -s tts-lipsync -n shell 'cd /Users/arthur/projects/pi-web-access && exec bash'
tmux -S "$SOCKET" new -d -s pleometric-archive -n shell 'cd /Users/arthur/projects/pi-web-access && exec bash'
```

Monitor:

```bash
tmux -S "$SOCKET" capture-pane -p -J -t jimeng-reversal:0.0 -S -200
```

Attach:

```bash
tmux -S "$SOCKET" attach -t jimeng-reversal
```

## Remote desktop / Framework tmux sessions

Desktop GPU worker:

```bash
ssh desktop 'export CLAUDE_TMUX_SOCKET_DIR="${TMPDIR:-/tmp}/claude-tmux-sockets"; mkdir -p "$CLAUDE_TMUX_SOCKET_DIR"; tmux -S "$CLAUDE_TMUX_SOCKET_DIR/claude.sock" new -d -s desktop-gpu -n gpu "cd /home/arthur && exec bash"'
```

Framework archive worker:

```bash
ssh framework 'export CLAUDE_TMUX_SOCKET_DIR="${TMPDIR:-/tmp}/claude-tmux-sockets"; mkdir -p "$CLAUDE_TMUX_SOCKET_DIR"; tmux -S "$CLAUDE_TMUX_SOCKET_DIR/claude.sock" new -d -s pleometric-archive -n archive "cd /home/arthur && exec bash"'
```

Monitor remote:

```bash
ssh desktop 'tmux -S "${TMPDIR:-/tmp}/claude-tmux-sockets/claude.sock" capture-pane -p -J -t desktop-gpu:0.0 -S -200'
ssh framework 'tmux -S "${TMPDIR:-/tmp}/claude-tmux-sockets/claude.sock" capture-pane -p -J -t pleometric-archive:0.0 -S -200'
```

## Status file template

```md
# <Lane> Status

## Current objective

## Last command/run

## Findings

## Artifacts created

## Blockers / needs coordinator

## Next safe action
```

## Merge-point checklist

Before coordinator integrates lane output:

```bash
git status --short
git diff --stat
git diff --name-only
bun run check  # if code changed and local deps are available
```

Then summarize:

- tracked files changed
- ignored artifacts created
- commands run
- paid/live provider usage, if any
- risks or account-impacting events

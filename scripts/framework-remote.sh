#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

HOST="${FRAMEWORK_HOST:-framework-laptop.tail5eda3b.ts.net}"
USER_NAME="${FRAMEWORK_USER:-arthur}"
REMOTE="${USER_NAME}@${HOST}"
REMOTE_PROJECT_DIR="${FRAMEWORK_PROJECT_DIR:-/home/${USER_NAME}/projects/pi-web-access}"
TMUX_SESSION="${FRAMEWORK_TMUX_SESSION:-pi-remote}"
BROWSER_TMUX_SESSION="${FRAMEWORK_BROWSER_TMUX_SESSION:-browser-remote}"
SESSION_GLOB="${FRAMEWORK_SESSION_GLOB:-\$HOME/.pi/agent/sessions/--Users-arthur-projects-pi-web-access--/*.jsonl}"

SSH_OPTS=(
  -o ConnectTimeout=8
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=2
)

usage() {
  cat <<EOF
Framework remote helper

Usage:
  scripts/framework-remote.sh status
  scripts/framework-remote.sh sync
  scripts/framework-remote.sh start
  scripts/framework-remote.sh attach
  scripts/framework-remote.sh capture [lines]
  scripts/framework-remote.sh stop
  scripts/framework-remote.sh browser:start
  scripts/framework-remote.sh browser:stop
  scripts/framework-remote.sh up        # status + sync + start

Environment overrides:
  FRAMEWORK_HOST                (default: ${HOST})
  FRAMEWORK_USER                (default: ${USER_NAME})
  FRAMEWORK_PROJECT_DIR         (default: ${REMOTE_PROJECT_DIR})
  FRAMEWORK_TMUX_SESSION        (default: ${TMUX_SESSION})
  FRAMEWORK_BROWSER_TMUX_SESSION(default: ${BROWSER_TMUX_SESSION})
  FRAMEWORK_SESSION_GLOB        (default: ${SESSION_GLOB})

Notes:
  - sync copies repo worktree + ~/.pi (including auth/session tokens)
  - start reopens the newest matching pi session in tmux on the remote host
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "missing required command: $cmd" >&2
    exit 1
  fi
}

status() {
  require_cmd tailscale
  require_cmd ssh

  echo "== tailscale ping: ${HOST} =="
  if ! tailscale ping -c 1 "$HOST"; then
    echo "Remote host is unreachable over tailscale." >&2
    return 1
  fi

  echo
  echo "== ssh probe: ${REMOTE} =="
  if ! ssh "${SSH_OPTS[@]}" "$REMOTE" 'echo ssh-ok && hostname && whoami'; then
    echo "SSH probe failed for ${REMOTE}." >&2
    return 1
  fi
}

sync_repo() {
  echo "== syncing repo to ${REMOTE}:${REMOTE_PROJECT_DIR} =="
  ssh "${SSH_OPTS[@]}" "$REMOTE" "mkdir -p '$REMOTE_PROJECT_DIR'"

  rsync -az --delete \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude 'test-output/' \
    --exclude '.DS_Store' \
    "$PROJECT_DIR/" "$REMOTE:$REMOTE_PROJECT_DIR/"
}

sync_pi() {
  echo "== syncing ~/.pi (includes auth/session tokens) to ${REMOTE}:~/.pi =="
  rsync -az --delete "$HOME/.pi/" "$REMOTE:~/.pi/"

  ssh "${SSH_OPTS[@]}" "$REMOTE" '
    chmod 700 "$HOME/.pi" || true
    chmod 700 "$HOME/.pi/agent" || true
    if [ -f "$HOME/.pi/agent/auth.json" ]; then
      chmod 600 "$HOME/.pi/agent/auth.json"
    fi
  '
}

sync_all() {
  sync_repo
  sync_pi
}

start_tmux_session() {
  echo "== starting tmux session ${TMUX_SESSION} on ${REMOTE} =="
  ssh "${SSH_OPTS[@]}" "$REMOTE" \
    "REMOTE_PROJECT_DIR='$REMOTE_PROJECT_DIR' TMUX_SESSION='$TMUX_SESSION' SESSION_GLOB='$SESSION_GLOB' bash -s" <<'EOF'
set -euo pipefail

mkdir -p "$REMOTE_PROJECT_DIR"
LATEST_SESSION=""
shopt -s nullglob
for file in $SESSION_GLOB; do
  LATEST_SESSION="$file"
  break
done
if [ -z "$LATEST_SESSION" ]; then
  LATEST_SESSION="$(ls -1t "$HOME/.pi/agent/sessions"/*/*.jsonl 2>/dev/null | head -1 || true)"
fi

if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
  tmux kill-session -t "$TMUX_SESSION"
fi

tmux new-session -d -s "$TMUX_SESSION" -x 120 -y 40
if [ -n "$LATEST_SESSION" ]; then
  CMD="cd '$REMOTE_PROJECT_DIR' && pi --session '$LATEST_SESSION'"
else
  CMD="cd '$REMOTE_PROJECT_DIR' && pi"
fi
tmux send-keys -t "$TMUX_SESSION" "$CMD" Enter
sleep 2
tmux capture-pane -t "$TMUX_SESSION" -p | tail -n 80
EOF
}

attach_tmux() {
  echo "== attaching to ${TMUX_SESSION} on ${REMOTE} =="
  ssh -t "${SSH_OPTS[@]}" "$REMOTE" "tmux attach -t '$TMUX_SESSION'"
}

capture_tmux() {
  local lines="${1:-120}"
  ssh "${SSH_OPTS[@]}" "$REMOTE" "tmux capture-pane -t '$TMUX_SESSION' -p | tail -n '$lines'"
}

stop_tmux() {
  ssh "${SSH_OPTS[@]}" "$REMOTE" "tmux kill-session -t '$TMUX_SESSION'"
}

browser_start() {
  echo "== starting headless browser tmux session ${BROWSER_TMUX_SESSION} on ${REMOTE} =="
  ssh "${SSH_OPTS[@]}" "$REMOTE" \
    "BROWSER_TMUX_SESSION='$BROWSER_TMUX_SESSION' bash -s" <<'EOF'
set -euo pipefail

BIN=""
for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
  if command -v "$candidate" >/dev/null 2>&1; then
    BIN="$candidate"
    break
  fi
done

if [ -z "$BIN" ]; then
  echo "No Chrome/Chromium binary found on remote host." >&2
  exit 1
fi

if tmux has-session -t "$BROWSER_TMUX_SESSION" 2>/dev/null; then
  tmux kill-session -t "$BROWSER_TMUX_SESSION"
fi

tmux new-session -d -s "$BROWSER_TMUX_SESSION" -x 120 -y 30
CMD="$BIN --headless=new --remote-debugging-port=9222 --user-data-dir=$HOME/.config/chrome-pi --no-first-run --no-default-browser-check about:blank"
tmux send-keys -t "$BROWSER_TMUX_SESSION" "$CMD" Enter
sleep 1
tmux capture-pane -t "$BROWSER_TMUX_SESSION" -p | tail -n 60
EOF
}

browser_stop() {
  ssh "${SSH_OPTS[@]}" "$REMOTE" "tmux kill-session -t '$BROWSER_TMUX_SESSION'"
}

cmd="${1:-help}"
case "$cmd" in
  status)
    status
    ;;
  sync)
    status
    sync_all
    ;;
  start)
    status
    start_tmux_session
    ;;
  attach)
    attach_tmux
    ;;
  capture)
    capture_tmux "${2:-120}"
    ;;
  stop)
    stop_tmux
    ;;
  browser:start)
    status
    browser_start
    ;;
  browser:stop)
    browser_stop
    ;;
  up)
    status
    sync_all
    start_tmux_session
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac

#!/usr/bin/env bash
# roboomp Apple Container launcher.
#
# Compose-free replacement for `docker compose --project-directory python/robomp`
# using the macOS `container` CLI. Keeps the PAT boundary intact: GITHUB_TOKEN
# only ever flows into the gh-proxy container; robomp talks to it over the
# internal-only `robomp_internal` network via a discovered IP address.
#
# Usage:
#   scripts/robomp-apple.sh build      # build oh-my-pi/pi:dev + robomp:dev
#   scripts/robomp-apple.sh up         # start gh-proxy, then robomp
#   scripts/robomp-apple.sh down       # stop and remove both containers
#   scripts/robomp-apple.sh logs       # tail robomp logs
#   scripts/robomp-apple.sh status     # show robomp + gh-proxy state
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/python/robomp/.env}"
DATA_DIR="${ROBOMP_APPLE_DATA_DIR:-${HOME}/.local/share/robomp-apple/data}"

PI_IMAGE="${PI_IMAGE:-oh-my-pi/pi:dev}"
ROBOMP_IMAGE="${ROBOMP_IMAGE:-robomp:dev}"
ROBOMP_CONTAINER="${ROBOMP_CONTAINER:-robomp}"
GH_PROXY_CONTAINER="${GH_PROXY_CONTAINER:-gh-proxy}"
NETWORK_NAME="${ROBOMP_INTERNAL_NETWORK:-robomp_internal}"
HOST_PORT="${ROBOMP_HOST_PORT:-6543}"

# Optional host-side source checkout (defaults to this repo).
PI_ROOT="${PI_ROOT:-${REPO_ROOT}}"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

load_env() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck source=/dev/null
    . "$ENV_FILE"
    set +a
  fi
}

ensure_command() {
  if ! command -v container >/dev/null 2>&1; then
    echo "roboomp-apple: 'container' CLI not found (install Apple Container tools)." >&2
    exit 1
  fi
}

ensure_data_dir() {
  mkdir -p "$DATA_DIR"
}

ensure_network() {
  local exists
  exists=$(container network list --format json 2>/dev/null \
    | python3 -c "import json,sys; nets=[n.get('configuration',{}).get('name') or n.get('id') for n in json.load(sys.stdin)]; print('yes' if '${NETWORK_NAME}' in nets else 'no')")
  if [ "$exists" != "yes" ]; then
    container network create --internal "$NETWORK_NAME"
  fi
}

require_file() {
  local path="$1" label="$2"
  if [ ! -e "$path" ]; then
    echo "roboomp-apple: missing ${label}: ${path}" >&2
    exit 1
  fi
}

# Required by both services in docker-compose.yml.
require_shared_env() {
  : "${GITHUB_WEBHOOK_SECRET:?GITHUB_WEBHOOK_SECRET must be set in .env or environment}"
  : "${ROBOMP_BOT_LOGIN:?ROBOMP_BOT_LOGIN must be set in .env or environment}"
  : "${ROBOMP_GIT_AUTHOR_EMAIL:?ROBOMP_GIT_AUTHOR_EMAIL must be set in .env or environment}"
  : "${ROBOMP_REPO_ALLOWLIST:?ROBOMP_REPO_ALLOWLIST must be set in .env or environment}"
  : "${ROBOMP_GH_PROXY_HMAC_KEY:?ROBOMP_GH_PROXY_HMAC_KEY must be set in .env or environment}"
}

gh_proxy_ip() {
  local ip=""
  local attempt=0
  while [ "$attempt" -lt 30 ]; do
    ip=$(container inspect "$GH_PROXY_CONTAINER" 2>/dev/null \
      | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    for net in d[0].get('status', {}).get('networks', []):
        if net.get('network') == '${NETWORK_NAME}':
            print(net.get('ipv4Address', '').split('/')[0])
            break
except Exception:
    pass
" || true)
    [ -n "$ip" ] && break
    sleep 1
    attempt=$((attempt + 1))
  done
  if [ -z "$ip" ]; then
    echo "roboomp-apple: could not determine ${GH_PROXY_CONTAINER} IP on ${NETWORK_NAME}" >&2
    return 1
  fi
  echo "$ip"
}

# -----------------------------------------------------------------------------
# Build
# -----------------------------------------------------------------------------

cmd_build_base() {
  container build -t "$PI_IMAGE" "$REPO_ROOT"
}

cmd_build_robomp() {
  container build \
    -f "$REPO_ROOT/Dockerfile.robomp" \
    -t "$ROBOMP_IMAGE" \
    --build-arg "PI_BASE=${PI_BASE:-$PI_IMAGE}" \
    "$REPO_ROOT"
}

cmd_build() {
  cmd_build_base
  cmd_build_robomp
}

# -----------------------------------------------------------------------------
# Up
# -----------------------------------------------------------------------------

cmd_up() {
  load_env
  require_shared_env
  : "${GITHUB_TOKEN:?GITHUB_TOKEN must be set in .env or environment}"

  # Validate host-side inputs that compose would bind-mount.
  require_file "$PI_ROOT/packages/coding-agent" "PI_ROOT pi checkout"
  require_file "$HOME/.omp/agent/models.container.yml" "models.container.yml"
  require_file "$HOME/.agent/AGENT.md" "AGENT.md"
  require_file "$HOME/.agent/rules" ".agent/rules directory"

  ensure_command
  ensure_network
  ensure_data_dir

  # Recreate both containers so `up` is idempotent and picks up image/env changes.
  container stop -t 30 "$ROBOMP_CONTAINER" >/dev/null 2>&1 || true
  container rm -f "$ROBOMP_CONTAINER" >/dev/null 2>&1 || true
  container stop -t 30 "$GH_PROXY_CONTAINER" >/dev/null 2>&1 || true
  container rm -f "$GH_PROXY_CONTAINER" >/dev/null 2>&1 || true

  # --- gh-proxy: the only container that ever sees GITHUB_TOKEN ---
  container run -d --name "$GH_PROXY_CONTAINER" \
    --network default \
    --network "$NETWORK_NAME" \
    -v "$DATA_DIR:/data" \
    -e "GITHUB_TOKEN=${GITHUB_TOKEN:?GITHUB_TOKEN must be set in .env or environment}" \
    -e "ROBOMP_GH_PROXY_HMAC_KEY=${ROBOMP_GH_PROXY_HMAC_KEY:?ROBOMP_GH_PROXY_HMAC_KEY must be set in .env or environment}" \
    -e "ROBOMP_WORKSPACE_ROOT=/data/workspaces" \
    -e "ROBOMP_SQLITE_PATH=/data/robomp.sqlite" \
    -e "ROBOMP_LOG_DIR=/data/logs" \
    -e "ROBOMP_GH_PROXY_BIND_HOST=0.0.0.0" \
    -e "ROBOMP_GH_PROXY_BIND_PORT=8081" \
    -e "GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET:?GITHUB_WEBHOOK_SECRET must be set in .env or environment}" \
    -e "ROBOMP_BOT_LOGIN=${ROBOMP_BOT_LOGIN:?ROBOMP_BOT_LOGIN must be set in .env or environment}" \
    -e "ROBOMP_GIT_AUTHOR_EMAIL=${ROBOMP_GIT_AUTHOR_EMAIL:?ROBOMP_GIT_AUTHOR_EMAIL must be set in .env or environment}" \
    -e "ROBOMP_REPO_ALLOWLIST=${ROBOMP_REPO_ALLOWLIST:?ROBOMP_REPO_ALLOWLIST must be set in .env or environment}" \
    "$ROBOMP_IMAGE" \
    python -m robomp.proxy serve

  local proxy_ip
  proxy_ip=$(gh_proxy_ip)
  echo "roboomp-apple: gh-proxy internal IP is ${proxy_ip}"

  # --- robomp: no GITHUB_TOKEN here ---
  container run -d --name "$ROBOMP_CONTAINER" \
    --network default \
    --network "$NETWORK_NAME" \
    -p "${HOST_PORT}:8080" \
    -v "$PI_ROOT:/work/pi:ro" \
    -v "$DATA_DIR:/data" \
    -v "$HOME/.omp/agent/models.container.yml:/srv/agent-home-stage/.omp/agent/models.yml:ro" \
    -v "$HOME/.agent/AGENT.md:/srv/agent-home-stage/.agent/AGENTS.md:ro" \
    -v "$HOME/.agent/rules:/srv/agent-home-stage/.agent/rules:ro" \
    -e "ROBOMP_GH_PROXY_URL=http://${proxy_ip}:8081" \
    -e "ROBOMP_GH_PROXY_HMAC_KEY=${ROBOMP_GH_PROXY_HMAC_KEY:?ROBOMP_GH_PROXY_HMAC_KEY must be set in .env or environment}" \
    -e "GITHUB_WEBHOOK_SECRET=${GITHUB_WEBHOOK_SECRET:?GITHUB_WEBHOOK_SECRET must be set in .env or environment}" \
    -e "ROBOMP_BOT_LOGIN=${ROBOMP_BOT_LOGIN:?ROBOMP_BOT_LOGIN must be set in .env or environment}" \
    -e "ROBOMP_GIT_AUTHOR_NAME=${ROBOMP_GIT_AUTHOR_NAME:-}" \
    -e "ROBOMP_GIT_AUTHOR_EMAIL=${ROBOMP_GIT_AUTHOR_EMAIL:?ROBOMP_GIT_AUTHOR_EMAIL must be set in .env or environment}" \
    -e "ROBOMP_REPO_ALLOWLIST=${ROBOMP_REPO_ALLOWLIST:?ROBOMP_REPO_ALLOWLIST must be set in .env or environment}" \
    -e "ROBOMP_MAINTAINER_LOGINS=${ROBOMP_MAINTAINER_LOGINS:-}" \
    -e "ROBOMP_REVIEWER_BOTS=${ROBOMP_REVIEWER_BOTS:-}" \
    -e "ROBOMP_MODEL=${ROBOMP_MODEL:-anthropic/claude-sonnet-4-6}" \
    -e "ROBOMP_PROVIDER=${ROBOMP_PROVIDER:-}" \
    -e "ROBOMP_THINKING=${ROBOMP_THINKING:-high}" \
    -e "ROBOMP_MAX_CONCURRENCY=${ROBOMP_MAX_CONCURRENCY:-8}" \
    -e "ROBOMP_TASK_TIMEOUT_SECONDS=${ROBOMP_TASK_TIMEOUT_SECONDS:-2400}" \
    -e "ROBOMP_TASK_TIMEOUT_HARD_GRACE_SECONDS=${ROBOMP_TASK_TIMEOUT_HARD_GRACE_SECONDS:-60}" \
    -e "ROBOMP_REQUEST_TIMEOUT_SECONDS=${ROBOMP_REQUEST_TIMEOUT_SECONDS:-120}" \
    -e "ROBOMP_RATE_LIMIT_WINDOW_SECONDS=${ROBOMP_RATE_LIMIT_WINDOW_SECONDS:-3600}" \
    -e "ROBOMP_RATE_LIMIT_DEFAULT=${ROBOMP_RATE_LIMIT_DEFAULT:-3}" \
    -e "ROBOMP_RATE_LIMIT_CONTRIBUTOR=${ROBOMP_RATE_LIMIT_CONTRIBUTOR:-10}" \
    -e "ROBOMP_RATE_LIMIT_UNLIMITED=${ROBOMP_RATE_LIMIT_UNLIMITED:-}" \
    -e "ROBOMP_QUESTION_AUTOCLOSE_ENABLED=${ROBOMP_QUESTION_AUTOCLOSE_ENABLED:-true}" \
    -e "ROBOMP_QUESTION_AUTOCLOSE_HOURS=${ROBOMP_QUESTION_AUTOCLOSE_HOURS:-4}" \
    -e "ROBOMP_QUESTION_AUTOCLOSE_SCAN_SECONDS=${ROBOMP_QUESTION_AUTOCLOSE_SCAN_SECONDS:-60}" \
    -e "ROBOMP_REPLAY_TOKEN=${ROBOMP_REPLAY_TOKEN:-}" \
    -e "ROBOMP_OMP_COMMAND=omp" \
    -e "ROBOMP_WORKSPACE_ROOT=/data/workspaces" \
    -e "ROBOMP_SQLITE_PATH=/data/robomp.sqlite" \
    -e "ROBOMP_LOG_DIR=/data/logs" \
    -e "ROBOMP_BIND_HOST=${ROBOMP_BIND_HOST:-0.0.0.0}" \
    -e "ROBOMP_BIND_PORT=${ROBOMP_BIND_PORT:-8080}" \
    -e "PI_ROOT=/work/pi" \
    "$ROBOMP_IMAGE"

  echo "roboomp-apple: robomp published on host port ${HOST_PORT}"
}

# -----------------------------------------------------------------------------
# Down / logs / status
# -----------------------------------------------------------------------------

cmd_down() {
  ensure_command
  container stop -t 30 "$ROBOMP_CONTAINER" >/dev/null 2>&1 || true
  container rm -f "$ROBOMP_CONTAINER" >/dev/null 2>&1 || true
  container stop -t 30 "$GH_PROXY_CONTAINER" >/dev/null 2>&1 || true
  container rm -f "$GH_PROXY_CONTAINER" >/dev/null 2>&1 || true
  container network rm "$NETWORK_NAME" >/dev/null 2>&1 || true
  echo "roboomp-apple: stopped and removed ${ROBOMP_CONTAINER}, ${GH_PROXY_CONTAINER}, and ${NETWORK_NAME}"
}

cmd_logs() {
  ensure_command
  container logs -f "$ROBOMP_CONTAINER"
}

cmd_status() {
  ensure_command
  container list --all
}

# -----------------------------------------------------------------------------
# Entrypoint
# -----------------------------------------------------------------------------

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") {build|up|down|logs|status}

Environment:
  ENV_FILE                 path to .env (default: ${ENV_FILE})
  ROBOMP_APPLE_DATA_DIR    host data directory fallback (default: ${DATA_DIR})
  PI_IMAGE                 base image tag (default: ${PI_IMAGE})
  ROBOMP_IMAGE             robomp image tag (default: ${ROBOMP_IMAGE})
  ROBOMP_HOST_PORT         host port for robomp (default: ${HOST_PORT})
  PI_ROOT                  host pi checkout to mount (default: repo root)
EOF
}

main() {
  case "${1:-}" in
    build)
      cmd_build
      ;;
    build-base)
      cmd_build_base
      ;;
    build-robomp)
      cmd_build_robomp
      ;;
    up)
      cmd_up
      ;;
    down)
      cmd_down
      ;;
    logs)
      cmd_logs
      ;;
    status)
      cmd_status
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"

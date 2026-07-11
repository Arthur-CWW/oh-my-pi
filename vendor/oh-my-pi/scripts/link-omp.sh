#!/usr/bin/env bash
# Link the development launcher separately from the promoted standalone binary.
set -euo pipefail

usage() {
	printf 'usage: %s {dev|stable <candidate>|rollback}\n' "${0##*/}" >&2
	exit 64
}

has_path() {
	[ -e "$1" ] || [ -L "$1" ]
}

reject_unsafe_bin_dir() {
	case "$1" in
		"" | / | /bin | /sbin | /usr | /usr/bin | /usr/sbin | /usr/local | /usr/local/bin)
			printf 'link-omp: refusing unsafe global bin directory: %s\n' "${1:-<empty>}" >&2
			exit 1
			;;
	esac
}

resolve_global_bin() {
	local bin_dir
	bin_dir="${OMP_LINK_GLOBAL_BIN:-}"
	if [ -z "$bin_dir" ]; then
		bin_dir="$(bun pm -g bin 2>/dev/null || true)"
	fi
	if [ -z "$bin_dir" ]; then
		if [ -n "${BUN_INSTALL:-}" ]; then
			bin_dir="$BUN_INSTALL/bin"
		elif [ -n "${HOME:-}" ]; then
			bin_dir="$HOME/.bun/bin"
		else
			printf 'link-omp: cannot determine Bun global bin without HOME or BUN_INSTALL\n' >&2
			exit 1
		fi
	fi

	reject_unsafe_bin_dir "$bin_dir"
	mkdir -p "$bin_dir"
	bin_dir="$(CDPATH= cd -- "$bin_dir" && pwd -P)"
	reject_unsafe_bin_dir "$bin_dir"
	printf '%s\n' "$bin_dir"
}

atomic_symlink() {
	local target="$1"
	local destination="$2"
	local temporary
	temporary="$(mktemp "${destination}.tmp.XXXXXX")"
	rm -f "$temporary"
	ln -s "$target" "$temporary"
	mv -f "$temporary" "$destination"
}

copy_backup() {
	local source="$1"
	local backup="$2"
	local temporary
	temporary="$(mktemp "${backup}.tmp.XXXXXX")"
	rm -f "$temporary"
	cp -P "$source" "$temporary"
	mv -f "$temporary" "$backup"
}

repo_root="${OMP_LINK_REPO_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)}"
global_bin="$(resolve_global_bin)"
stable="$global_bin/omp"
previous="$global_bin/omp.previous"
failed="$global_bin/omp.failed"

cmd_dev() {
	local target="$repo_root/packages/coding-agent/scripts/omp"
	if [ ! -f "$target" ] || [ ! -x "$target" ]; then
		printf 'link-omp: development launcher not found or not executable: %s\n' "$target" >&2
		exit 1
	fi
	atomic_symlink "$target" "$global_bin/omp-dev"
	printf 'link-omp: linked %s -> %s\n' "$global_bin/omp-dev" "$target"
}

validate_candidate() {
	local requested="$1"
	local candidate_dir
	local candidate

	if [ ! -e "$requested" ]; then
		printf 'link-omp: candidate does not exist: %s\n' "$requested" >&2
		exit 1
	fi
	candidate_dir="$(CDPATH= cd -- "$(dirname -- "$requested")" && pwd -P)"
	candidate="$candidate_dir/$(basename -- "$requested")"
	if [ ! -f "$candidate" ] || [ ! -x "$candidate" ]; then
		printf 'link-omp: candidate is not an executable file: %s\n' "$requested" >&2
		exit 1
	fi
	printf '%s\n' "$candidate"
}

smoke_candidate() {
	local candidate="$1"
	local isolated_root
	isolated_root="$(mktemp -d "${TMPDIR:-/tmp}/omp-promote.XXXXXX")"
	mkdir -p "$isolated_root/home" "$isolated_root/data" "$isolated_root/state" "$isolated_root/cache" "$isolated_root/config" "$isolated_root/profile" "$isolated_root/session" "$isolated_root/bun"
	if ! (
		export HOME="$isolated_root/home"
		export XDG_DATA_HOME="$isolated_root/data"
		export XDG_STATE_HOME="$isolated_root/state"
		export XDG_CACHE_HOME="$isolated_root/cache"
		export XDG_CONFIG_HOME="$isolated_root/config"
		export OMP_PROFILE="candidate-smoke"
		export OMP_SESSION_DIR="$isolated_root/session"
		export PI_CONFIG_DIR="$isolated_root/config/pi"
		export PI_SESSION_DIR="$isolated_root/session/pi"
		export BUN_INSTALL="$isolated_root/bun"
		"$candidate" --version || exit $?
		"$candidate" --help || exit $?
		"$candidate" --smoke-test || exit $?
	); then
		rm -rf "$isolated_root"
		return 1
	fi
	rm -rf "$isolated_root"
}

cmd_stable() {
	if [ "$#" -ne 1 ]; then
		printf 'link-omp: stable promotion requires an executable candidate path\n' >&2
		usage
	fi
	local candidate
	candidate="$(validate_candidate "$1")"
	smoke_candidate "$candidate"
	if has_path "$stable"; then
		copy_backup "$stable" "$previous"
	fi
	atomic_symlink "$candidate" "$stable"
	printf 'link-omp: promoted %s -> %s\n' "$stable" "$candidate"
}

cmd_rollback() {
	if ! has_path "$previous"; then
		printf 'link-omp: no previous stable command to restore: %s\n' "$previous" >&2
		exit 1
	fi
	if has_path "$stable"; then
		mv -f "$stable" "$failed"
	fi
	mv -f "$previous" "$stable"
	printf 'link-omp: restored %s from %s\n' "$stable" "$previous"
}

case "${1:-}" in
	dev)
		[ "$#" -eq 1 ] || usage
		cmd_dev
		;;
	stable)
		shift
		cmd_stable "$@"
		;;
	rollback)
		[ "$#" -eq 1 ] || usage
		cmd_rollback
		;;
	*)
		usage
		;;
esac

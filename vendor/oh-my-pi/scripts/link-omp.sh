#!/usr/bin/env bash
# Link the development launcher separately from immutable promoted binaries.
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

sha256() {
	shasum -a 256 "$1" | awk '{print $1}'
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

validate_release() {
	local release="$1"
	local expected_sha="$2"
	local actual_sha

	if [ -L "$release" ] || [ ! -f "$release" ] || [ ! -x "$release" ]; then
		return 1
	fi
	actual_sha="$(sha256 "$release")"
	[ "$actual_sha" = "$expected_sha" ]
}

immutable_target_from_link() {
	local link="$1"
	local target
	local filename
	local expected_sha

	[ -L "$link" ] || return 1
	target="$(readlink "$link")" || return 1
	case "$target" in
		"$releases"/omp-*) ;;
		*) return 1 ;;
	esac
	filename="$(basename -- "$target")"
	expected_sha="${filename#omp-}"
	case "$expected_sha" in
		"" | *[!0123456789abcdef]*) return 1 ;;
	esac
	validate_release "$target" "$expected_sha" || return 1
	printf '%s\n' "$target"
}

repo_root="${OMP_LINK_REPO_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)}"
global_bin="$(resolve_global_bin)"
releases="$global_bin/.omp-releases"
stable="$global_bin/omp"
previous="$global_bin/omp.previous"
failed="$global_bin/omp.failed"
stage=""

cleanup_stage() {
	if [ -n "$stage" ]; then
		rm -f "$stage"
	fi
}

trap cleanup_stage EXIT

cmd_dev() {
	local target="$repo_root/packages/coding-agent/scripts/omp"
	if [ ! -f "$target" ] || [ ! -x "$target" ]; then
		printf 'link-omp: development launcher not found or not executable: %s\n' "$target" >&2
		exit 1
	fi
	atomic_symlink "$target" "$global_bin/omp-dev"
	printf 'link-omp: linked %s -> %s\n' "$global_bin/omp-dev" "$target"
}

cmd_stable() {
	if [ "$#" -ne 1 ]; then
		printf 'link-omp: stable promotion requires an executable candidate path\n' >&2
		usage
	fi
	local candidate
	local digest
	local release
	local staged_digest
	local prior=""
	candidate="$(validate_candidate "$1")"
	digest="$(sha256 "$candidate")"
	release="$releases/omp-$digest"
	mkdir -p "$releases"

	if has_path "$release"; then
		if ! validate_release "$release" "$digest"; then
			printf 'link-omp: existing release is invalid or collides with candidate digest: %s\n' "$release" >&2
			exit 1
		fi
	else
		stage="$(mktemp "$releases/.omp-$digest.tmp.XXXXXX")"
		cp "$candidate" "$stage"
		chmod 755 "$stage"
		validate_candidate "$stage" >/dev/null
		staged_digest="$(sha256 "$stage")"
		if [ "$staged_digest" != "$digest" ]; then
			printf 'link-omp: candidate changed while being promoted: %s\n' "$candidate" >&2
			exit 1
		fi
		if ! smoke_candidate "$stage"; then
			printf 'link-omp: staged candidate failed validation: %s\n' "$candidate" >&2
			exit 1
		fi
		mv "$stage" "$release"
		stage=""
	fi

	if has_path "$stable"; then
		if ! prior="$(immutable_target_from_link "$stable")"; then
			printf 'link-omp: active stable command is not a valid immutable release: %s\n' "$stable" >&2
			exit 1
		fi
		if [ "$prior" = "$release" ]; then
			printf 'link-omp: stable release already active: %s\n' "$release"
			return
		fi
		atomic_symlink "$prior" "$previous"
	else
		rm -f "$previous"
	fi
	atomic_symlink "$release" "$stable"
	printf 'link-omp: promoted %s -> %s\n' "$stable" "$release"
}

cmd_rollback() {
	local prior
	local current
	if ! prior="$(immutable_target_from_link "$previous")"; then
		printf 'link-omp: no valid immutable previous command to restore: %s\n' "$previous" >&2
		exit 1
	fi
	if ! current="$(immutable_target_from_link "$stable")"; then
		printf 'link-omp: active stable command is not a valid immutable release: %s\n' "$stable" >&2
		exit 1
	fi
	atomic_symlink "$current" "$failed"
	atomic_symlink "$prior" "$stable"
	rm -f "$previous"
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

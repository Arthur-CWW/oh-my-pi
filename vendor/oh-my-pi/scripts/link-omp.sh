#!/usr/bin/env bash
# Two-step immutable release selection. Registry/symlink changes select future
# invocations only; they do not stop, release, acquire, or otherwise hand off a
# live session. Bless reruns runner-canary-readiness.ts independently against
# OMP_LINK_READINESS_FIXTURE_ROOT; the supplied receipt is validated as input,
# never treated as the authority or stored as the blessed receipt digest.
set -euo pipefail

usage() {
	printf 'usage: %s {dev|candidate <binary>|bless <digest> <readiness-receipt>|rollback}\n' "${0##*/}" >&2
	exit 64
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
	local bin_dir="${OMP_LINK_GLOBAL_BIN:-}"
	if [ -z "$bin_dir" ]; then bin_dir="$(bun pm -g bin 2>/dev/null || true)"; fi
	if [ -z "$bin_dir" ]; then
		if [ -n "${BUN_INSTALL:-}" ]; then bin_dir="$BUN_INSTALL/bin"
		elif [ -n "${HOME:-}" ]; then bin_dir="$HOME/.bun/bin"
		else printf 'link-omp: cannot determine Bun global bin without HOME or BUN_INSTALL\n' >&2; exit 1
		fi
	fi
	reject_unsafe_bin_dir "$bin_dir"
	mkdir -p "$bin_dir"
	bin_dir="$(CDPATH= cd -- "$bin_dir" && pwd -P)"
	reject_unsafe_bin_dir "$bin_dir"
	printf '%s\n' "$bin_dir"
}

atomic_symlink() {
	local target="$1" destination="$2" temporary
	temporary="$(mktemp "${destination}.tmp.XXXXXX")"
	rm -f "$temporary"
	ln -s "$target" "$temporary"
	mv -f "$temporary" "$destination"
}

repo_root="${OMP_LINK_REPO_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)}"
global_bin="$(resolve_global_bin)"
helper="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/link-omp-registry.py"

case "${1:-}" in
	dev)
		[ "$#" -eq 1 ] || usage
		target="$repo_root/packages/coding-agent/scripts/omp"
		[ -f "$target" ] && [ -x "$target" ] || { printf 'link-omp: development launcher not found or not executable: %s\n' "$target" >&2; exit 1; }
		atomic_symlink "$target" "$global_bin/omp-dev"
		printf 'link-omp: linked %s -> %s\n' "$global_bin/omp-dev" "$target"
		;;
	candidate)
		[ "$#" -eq 2 ] || usage
		digest="$(python3 "$helper" candidate "$global_bin" "$2")"
		printf 'link-omp: materialized candidate %s (stable unchanged)\n' "$digest"
		;;
	bless)
		[ "$#" -eq 3 ] || usage
		digest="$(python3 "$helper" bless "$global_bin" "$2" "$3")"
		printf 'link-omp: blessed %s for future invocations; no live session was handed off\n' "$digest"
		;;
	rollback)
		[ "$#" -eq 1 ] || usage
		digest="$(python3 "$helper" rollback "$global_bin")"
		printf 'link-omp: selected previous release %s for future invocations; nothing was launched\n' "$digest"
		;;
	stable)
		printf 'link-omp: direct stable promotion was removed; use candidate then readiness-validated bless\n' >&2
		exit 64
		;;
	*) usage ;;
esac

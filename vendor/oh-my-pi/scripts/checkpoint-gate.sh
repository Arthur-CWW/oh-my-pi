#!/usr/bin/env bash
# Verify the staged snapshot, never the dirty working tree.
#
# Usage: scripts/checkpoint-gate.sh [--] [focused-test-command [args...]]
# Example: scripts/checkpoint-gate.sh -- bun test packages/agent/test/session.test.ts
#
# The gate materializes the index as a temporary detached worktree, runs
# `bun run check:types` in every staged `packages/<name>` package that defines
# it, then runs the optional command from the snapshot root. The caller's index
# and working tree are never modified; cleanup runs on success, failure, or a
# terminating signal.
set -uo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P) || exit $?
if [[ $(pwd -P) != "$project_root" ]]; then
	printf 'checkpoint-gate: run from the repository root: %s\n' "$project_root" >&2
	exit 2
fi
git_prefix=$(git rev-parse --show-prefix) || exit $?
git_common_dir=$(git rev-parse --path-format=absolute --git-common-dir) || exit $?

if [[ ${1-} == -- ]]; then
	shift
fi

index_tree=$(git write-tree) || exit $?
snapshot_commit=$(printf 'checkpoint-gate staged snapshot\n' | git commit-tree "$index_tree" -p HEAD) || exit $?
worktree=$(mktemp -d "$git_common_dir/checkpoint-gate.XXXXXX") || exit $?
worktree_added=0

cleanup() {
	local status=$?
	trap - EXIT HUP INT TERM
	if (( worktree_added )); then
		git worktree remove --force "$worktree" >/dev/null
	else
		rmdir "$worktree" 2>/dev/null || true
	fi
	exit "$status"
}
on_signal() {
	local signal=$1
	trap - "$signal"
	kill -s "$signal" "$$"
}
trap cleanup EXIT
trap 'on_signal HUP' HUP
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

git worktree add --quiet --detach "$worktree" "$snapshot_commit" || exit $?
worktree_added=1
snapshot_root="$worktree/${git_prefix%/}"
if [[ -d $project_root/node_modules && ! -e $snapshot_root/node_modules ]]; then
	ln -s "$project_root/node_modules" "$snapshot_root/node_modules"
fi

packages=()
while IFS= read -r path; do
	[[ $path == "$git_prefix"packages/*/* ]] || continue
	package=${path#"$git_prefix"packages/}
	package=${package%%/*}
	seen=0
	for existing in "${packages[@]-}"; do
		if [[ $existing == "$package" ]]; then
			seen=1
			break
		fi
	done
	(( seen )) || packages+=("$package")
done < <(git diff --cached --name-only --diff-filter=ACDMRTUXB)

for package in "${packages[@]-}"; do
	package_json="$snapshot_root/packages/$package/package.json"
	[[ -f $package_json ]] || continue
	if bun -e 'const p = await Bun.file(process.argv[1]).json(); process.exit(p.scripts?.["check:types"] ? 0 : 1)' "$package_json"; then
		bun --cwd="$snapshot_root/packages/$package" run check:types || exit $?
	fi
done

if (( $# )); then
	(cd "$snapshot_root" && "$@") || exit $?
fi

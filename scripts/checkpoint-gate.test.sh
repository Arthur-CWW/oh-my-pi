#!/usr/bin/env bash
# Focused integration test for checkpoint-gate.sh.
set -euo pipefail

source_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
fixture=$(mktemp -d "${TMPDIR:-/tmp}/checkpoint-gate-test.XXXXXX")
cleanup() { rm -rf "$fixture"; }
trap cleanup EXIT HUP INT TERM

mkdir -p "$fixture/scripts"
cp "$source_root/scripts/checkpoint-gate.sh" "$fixture/scripts/checkpoint-gate.sh"
cd "$fixture"
git init --quiet
git config user.email checkpoint-gate@example.invalid
git config user.name checkpoint-gate-test
mkdir -p packages/example
cat > packages/example/package.json <<'JSON'
{
  "name": "checkpoint-gate-fixture",
  "private": true,
  "scripts": {
    "check:types": "test \"$(cat value.txt)\" = good"
  }
}
JSON
printf 'good\n' > packages/example/value.txt
git add scripts/checkpoint-gate.sh packages/example
git commit --quiet -m initial

snapshot_hash() {
	{
		git status --porcelain=v2 --untracked-files=all
		git diff --binary
		git diff --cached --binary
		find . -path ./.git -prune -o -type f -print0 |
			sort -z |
			xargs -0 shasum -a 256
	} | shasum -a 256 | cut -d ' ' -f 1
}

# The staged snapshot is broken, but the working tree has a passing repair.
printf 'bad\n' > packages/example/value.txt
git add packages/example/value.txt
printf 'good\n' > packages/example/value.txt
bun --cwd=packages/example run check:types >/dev/null
before=$(snapshot_hash)
set +e
./scripts/checkpoint-gate.sh >/dev/null 2>&1
status=$?
set -e
[[ $status -ne 0 ]] || { printf 'expected staged-only breakage to fail\n' >&2; exit 1; }
[[ $(snapshot_hash) == "$before" ]] || { printf 'gate changed the caller tree\n' >&2; exit 1; }

# A named focused command's exact non-zero status must propagate too.
printf 'good\n' > packages/example/value.txt
git add packages/example/value.txt
printf 'dirty-untracked\n' > untracked.txt
before=$(snapshot_hash)
set +e
./scripts/checkpoint-gate.sh -- bash -c 'exit 23' >/dev/null 2>&1
status=$?
set -e
[[ $status -eq 23 ]] || { printf 'expected status 23, got %s\n' "$status" >&2; exit 1; }
[[ $(snapshot_hash) == "$before" ]] || { printf 'gate changed the caller tree after command failure\n' >&2; exit 1; }

printf 'checkpoint-gate integration test passed\n'

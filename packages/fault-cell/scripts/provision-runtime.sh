#!/usr/bin/env bash
# Materialise this package's node_modules from pinned, hash-verified npm tarballs.
#
# Why not `bun install`: the execution host deliberately has no workspace node_modules, and a
# workspace-wide install pulls gigabytes of unrelated dependencies. This fetches only the
# runner's own closure (~15 MB), verifies every tarball against the sha512 integrity recorded
# in runtime-deps.json, and never touches the workspace lockfile.
#
# Usage: bash scripts/provision-runtime.sh [--force]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deps_file="$here/runtime-deps.json"
modules="$here/node_modules"
cache="${FAULT_CELL_DEP_CACHE:-$here/.dep-cache}"
force="${1:-}"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v tar >/dev/null || { echo "tar is required" >&2; exit 1; }
command -v nix >/dev/null || { echo "nix is required (used for sha512 SRI verification)" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

mkdir -p "$modules" "$cache"

count=$(jq 'length' "$deps_file")
for index in $(seq 0 $((count - 1))); do
  name=$(jq -r ".[$index].name" "$deps_file")
  version=$(jq -r ".[$index].version" "$deps_file")
  integrity=$(jq -r ".[$index].integrity" "$deps_file")
  url=$(jq -r ".[$index].url" "$deps_file")
  target="$modules/$name"

  if [ -d "$target" ] && [ "$force" != "--force" ]; then
    echo "ok      $name@$version (already present)"
    continue
  fi

  tarball="$cache/$(echo "$name" | tr '/' '_')-$version.tgz"
  if [ ! -f "$tarball" ]; then
    curl -fsSL "$url" -o "$tarball"
  fi

  actual=$(nix hash file --type sha512 --sri "$tarball")
  if [ "$actual" != "$integrity" ]; then
    echo "INTEGRITY MISMATCH for $name@$version" >&2
    echo "  expected $integrity" >&2
    echo "  actual   $actual" >&2
    rm -f "$tarball"
    exit 1
  fi

  rm -rf "$target"
  mkdir -p "$target"
  tar -xzf "$tarball" -C "$target" --strip-components=1
  echo "fetched $name@$version"
done

echo
echo "provisioned $(jq 'length' "$deps_file") package(s) into $modules"
echo "run:  cd $here && bun run check"

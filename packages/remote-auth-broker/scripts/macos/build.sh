#!/bin/bash
set -euo pipefail

umask 077

readonly script_dir="$(cd "$(/usr/bin/dirname "$0")" && /bin/pwd -P)"
readonly package_root="$(cd "$script_dir/../.." && /bin/pwd -P)"
readonly output_root="$package_root/dist/macos/unsigned"

pointer_tmp=""

publish_latest() {
  local root="$1"
  local digest="$2"
  local latest="$root/latest"

  if [[ ! -d "$root" || -L "$root" ]]; then
    printf 'error: latest parent is not a lexical directory: %s\n' "$root" >&2
    exit 65
  fi
  if [[ (-e "$latest" || -L "$latest") && ! -L "$latest" ]]; then
    printf 'error: latest entry is not a symbolic link: %s\n' "$latest" >&2
    exit 65
  fi

  pointer_tmp="$root/${stage##*/}.latest"
  /bin/ln -s "$digest" "$pointer_tmp"
  /bin/mv -fh -- "$pointer_tmp" "$latest"
  pointer_tmp=""

  if [[ -x /usr/bin/fsync ]]; then
    /usr/bin/fsync "$root"
  elif [[ -x /bin/fsync ]]; then
    /bin/fsync "$root"
  fi
}

stage=""
cleanup() {
  if [[ -n "$pointer_tmp" && -L "$pointer_tmp" ]]; then
    /bin/rm -f -- "$pointer_tmp"
  fi
  if [[ -n "$stage" ]]; then
    /bin/rm -rf -- "$stage"
  fi
}
trap cleanup EXIT HUP INT TERM

if [[ $# -ne 0 ]]; then
  printf 'usage: %s\n' "$0" >&2
  exit 64
fi
if [[ "$(/usr/bin/uname -s)" != "Darwin" ]]; then
  printf 'error: macOS is required\n' >&2
  exit 69
fi
if [[ "$(/usr/bin/uname -m)" != "arm64" ]]; then
  printf 'error: the reviewed release target is arm64\n' >&2
  exit 69
fi

for directory in "$package_root/dist" "$package_root/dist/macos" "$output_root"; do
  if [[ -L "$directory" ]]; then
    printf 'error: output path component is a symbolic link: %s\n' "$directory" >&2
    exit 65
  fi
  /bin/mkdir -p -- "$directory"
  if [[ ! -d "$directory" || -L "$directory" ]]; then
    printf 'error: output path component is not a lexical directory: %s\n' "$directory" >&2
    exit 65
  fi
done
/bin/chmod 0700 "$package_root/dist" "$package_root/dist/macos" "$output_root"
stage="$(/usr/bin/mktemp -d "$output_root/.build.XXXXXX")"
readonly scratch="$stage/scratch"
readonly payload="$stage/payload"
/bin/mkdir -m 0700 -- "$scratch" "$payload" "$payload/bin"

readonly swift="$(/usr/bin/xcrun --find swift)"
for product in remote-authd remote-authctl; do
  /usr/bin/env \
    LC_ALL=C \
    LANG=C \
    TZ=UTC \
    SOURCE_DATE_EPOCH=0 \
    ZERO_AR_DATE=1 \
    "$swift" build \
      --configuration release \
      --product "$product" \
      --package-path "$package_root" \
      --scratch-path "$scratch"
done

readonly bin_path="$(/usr/bin/env LC_ALL=C LANG=C TZ=UTC "$swift" build --configuration release --package-path "$package_root" --scratch-path "$scratch" --show-bin-path)"
for product in remote-authd remote-authctl; do
  source_binary="$bin_path/$product"
  if [[ ! -f "$source_binary" || -L "$source_binary" ]]; then
    printf 'error: expected regular Swift product is missing: %s\n' "$product" >&2
    exit 66
  fi
  /usr/bin/install -m 0555 "$source_binary" "$payload/bin/$product"
done

readonly daemon_digest="$(/usr/bin/shasum -a 256 "$payload/bin/remote-authd" | /usr/bin/awk '{print $1}')"
readonly ctl_digest="$(/usr/bin/shasum -a 256 "$payload/bin/remote-authctl" | /usr/bin/awk '{print $1}')"
printf '%s  bin/remote-authd\n%s  bin/remote-authctl\n' "$daemon_digest" "$ctl_digest" > "$payload/manifest.sha256"
/bin/chmod 0444 "$payload/manifest.sha256"
readonly build_digest="$(/usr/bin/shasum -a 256 "$payload/manifest.sha256" | /usr/bin/awk '{print $1}')"
printf '%s\n' "$build_digest" > "$payload/build-digest"
/bin/chmod 0444 "$payload/build-digest"

readonly destination="$output_root/$build_digest"
if [[ -e "$destination" || -L "$destination" ]]; then
  if [[ ! -d "$destination" || -L "$destination" ]] || \
     ! /usr/bin/cmp -s "$payload/manifest.sha256" "$destination/manifest.sha256" || \
     ! /usr/bin/cmp -s "$payload/bin/remote-authd" "$destination/bin/remote-authd" || \
     ! /usr/bin/cmp -s "$payload/bin/remote-authctl" "$destination/bin/remote-authctl" || \
     ! /usr/bin/cmp -s "$payload/build-digest" "$destination/build-digest"; then
    printf 'error: immutable build digest collision: %s\n' "$build_digest" >&2
    exit 74
  fi
else
  /bin/mv -- "$payload" "$destination"
fi
/bin/chmod 0555 "$destination/bin" "$destination"

publish_latest "$output_root" "$build_digest"

printf 'Built unsigned macOS release %s (policy remains DESIGN/INACTIVE).\n' "$build_digest"

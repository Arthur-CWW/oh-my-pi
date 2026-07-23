#!/bin/bash
set -euo pipefail

umask 077

readonly script_dir="$(cd "$(/usr/bin/dirname "$0")" && /bin/pwd -P)"
readonly package_root="$(cd "$script_dir/../.." && /bin/pwd -P)"
readonly unsigned_root="$package_root/dist/macos/unsigned"
readonly signed_root="$package_root/dist/macos/signed"

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

if [[ $# -ne 1 || -z "$1" || "$1" == *$'\n'* || "$1" == *$'\r'* ]]; then
  printf 'usage: %s SIGNING_IDENTITY\n' "$0" >&2
  exit 64
fi
if [[ "$(/usr/bin/uname -s)" != "Darwin" ]]; then
  printf 'error: macOS is required\n' >&2
  exit 69
fi
readonly signing_identity="$1"

if [[ "$signing_identity" != "-" ]] && ! /usr/bin/security find-identity -v -p codesigning | /usr/bin/awk -v identity="$signing_identity" '
  index($0, "\"" identity "\"") { found = 1 }
  END { exit(found ? 0 : 1) }
'; then
  printf 'error: the requested signing identity is not an existing valid code-signing identity\n' >&2
  exit 77
fi

for directory in "$package_root/dist" "$package_root/dist/macos" "$unsigned_root"; do
  if [[ ! -d "$directory" || -L "$directory" ]]; then
    printf 'error: unsigned output path component is not a lexical directory: %s\n' "$directory" >&2
    exit 65
  fi
done

if [[ ! -L "$unsigned_root/latest" ]]; then
  printf 'error: build.sh has not published an unsigned build\n' >&2
  exit 66
fi
readonly unsigned_name="$(/usr/bin/readlink "$unsigned_root/latest")"
if [[ ! "$unsigned_name" =~ ^[0-9a-f]{64}$ ]]; then
  printf 'error: unsigned latest pointer is invalid\n' >&2
  exit 65
fi
readonly unsigned="$unsigned_root/$unsigned_name"
if [[ ! -d "$unsigned" || -L "$unsigned" ]]; then
  printf 'error: unsigned build directory is invalid\n' >&2
  exit 65
fi

for product in remote-authd remote-authctl; do
  if [[ ! -f "$unsigned/bin/$product" || -L "$unsigned/bin/$product" ]]; then
    printf 'error: unsigned product is not a regular file: %s\n' "$product" >&2
    exit 66
  fi
done
readonly daemon_unsigned_digest="$(/usr/bin/shasum -a 256 "$unsigned/bin/remote-authd" | /usr/bin/awk '{print $1}')"
readonly ctl_unsigned_digest="$(/usr/bin/shasum -a 256 "$unsigned/bin/remote-authctl" | /usr/bin/awk '{print $1}')"
readonly expected_manifest="${daemon_unsigned_digest}  bin/remote-authd
${ctl_unsigned_digest}  bin/remote-authctl"
if [[ "$(<"$unsigned/manifest.sha256")" != "$expected_manifest" ]] || \
   [[ "$(<"$unsigned/build-digest")" != "$unsigned_name" ]] || \
   [[ "$(/usr/bin/shasum -a 256 "$unsigned/manifest.sha256" | /usr/bin/awk '{print $1}')" != "$unsigned_name" ]]; then
  printf 'error: unsigned build digest verification failed\n' >&2
  exit 65
fi

if [[ -L "$signed_root" ]]; then
  printf 'error: signed output root is a symbolic link: %s\n' "$signed_root" >&2
  exit 65
fi
/bin/mkdir -p -- "$signed_root"
if [[ ! -d "$signed_root" || -L "$signed_root" ]]; then
  printf 'error: signed output root is not a lexical directory: %s\n' "$signed_root" >&2
  exit 65
fi
/bin/chmod 0700 "$signed_root"
stage="$(/usr/bin/mktemp -d "$signed_root/.sign.XXXXXX")"
readonly payload="$stage/payload"
/bin/mkdir -m 0700 -- "$payload" "$payload/bin" "$payload/requirements"
/usr/bin/install -m 0555 "$unsigned/bin/remote-authd" "$payload/bin/remote-authd"
/usr/bin/install -m 0555 "$unsigned/bin/remote-authctl" "$payload/bin/remote-authctl"

for product in remote-authd remote-authctl; do
  binary="$payload/bin/$product"
  if [[ "$signing_identity" == "-" ]]; then
    /usr/bin/codesign --force --sign - --identifier "dev.arthur.remote-auth-broker.${product}" "$binary"
  else
    /usr/bin/codesign --force --sign "$signing_identity" --options runtime --timestamp "$binary"
  fi
  /usr/bin/codesign --verify --strict --verbose=2 "$binary"

  requirement_output="$stage/$product.requirements-output"
  /usr/bin/codesign --display --requirements - "$binary" &> "$requirement_output"
  requirement=""
  while IFS= read -r line; do
    case "$line" in
      'designated => '*) requirement="${line#designated => }" ;;
      '# designated => '*) requirement="${line#\# designated => }" ;;
    esac
  done < "$requirement_output"
  if [[ -z "$requirement" || "$requirement" == *$'\n'* || "$requirement" == *$'\r'* ]]; then
    printf 'error: codesign did not emit one designated requirement for %s\n' "$product" >&2
    exit 65
  fi
  /usr/bin/codesign --verify --strict --verbose=2 -R="$requirement" "$binary"
  printf '%s\n' "$requirement" > "$payload/requirements/$product.designated-requirement"
  /bin/chmod 0444 "$payload/requirements/$product.designated-requirement"
done

printf '%s\n' "$unsigned_name" > "$payload/source-build-digest"
/bin/chmod 0444 "$payload/source-build-digest"
readonly daemon_digest="$(/usr/bin/shasum -a 256 "$payload/bin/remote-authd" | /usr/bin/awk '{print $1}')"
readonly ctl_digest="$(/usr/bin/shasum -a 256 "$payload/bin/remote-authctl" | /usr/bin/awk '{print $1}')"
readonly daemon_requirement_digest="$(/usr/bin/shasum -a 256 "$payload/requirements/remote-authd.designated-requirement" | /usr/bin/awk '{print $1}')"
readonly ctl_requirement_digest="$(/usr/bin/shasum -a 256 "$payload/requirements/remote-authctl.designated-requirement" | /usr/bin/awk '{print $1}')"
readonly source_build_digest="$(/usr/bin/shasum -a 256 "$payload/source-build-digest" | /usr/bin/awk '{print $1}')"
printf '%s  bin/remote-authd\n%s  bin/remote-authctl\n%s  requirements/remote-authd.designated-requirement\n%s  requirements/remote-authctl.designated-requirement\n%s  source-build-digest\n' \
  "$daemon_digest" "$ctl_digest" "$daemon_requirement_digest" "$ctl_requirement_digest" "$source_build_digest" > "$payload/manifest.sha256"
/bin/chmod 0444 "$payload/manifest.sha256"
readonly release_digest="$(/usr/bin/shasum -a 256 "$payload/manifest.sha256" | /usr/bin/awk '{print $1}')"
printf '%s\n' "$release_digest" > "$payload/release-digest"
/bin/chmod 0444 "$payload/release-digest"

readonly destination="$signed_root/$release_digest"
if [[ -e "$destination" || -L "$destination" ]]; then
  if [[ ! -d "$destination" || -L "$destination" ]] || \
     ! /usr/bin/cmp -s "$payload/manifest.sha256" "$destination/manifest.sha256" || \
     ! /usr/bin/cmp -s "$payload/bin/remote-authd" "$destination/bin/remote-authd" || \
     ! /usr/bin/cmp -s "$payload/bin/remote-authctl" "$destination/bin/remote-authctl" || \
     ! /usr/bin/cmp -s "$payload/requirements/remote-authd.designated-requirement" "$destination/requirements/remote-authd.designated-requirement" || \
     ! /usr/bin/cmp -s "$payload/requirements/remote-authctl.designated-requirement" "$destination/requirements/remote-authctl.designated-requirement" || \
     ! /usr/bin/cmp -s "$payload/source-build-digest" "$destination/source-build-digest" || \
     ! /usr/bin/cmp -s "$payload/release-digest" "$destination/release-digest"; then
    printf 'error: immutable signed-release digest collision: %s\n' "$release_digest" >&2
    exit 74
  fi
else
  /bin/mv -- "$payload" "$destination"
fi
/bin/chmod 0555 "$destination/bin" "$destination/requirements" "$destination"

publish_latest "$signed_root" "$release_digest"

printf 'Signed and verified macOS release %s (policy remains DESIGN/INACTIVE).\n' "$release_digest"

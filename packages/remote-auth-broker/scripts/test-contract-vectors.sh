#!/bin/sh
set -eu
umask 077

if [ "$#" -ne 0 ]; then
    printf '%s\n' 'test-contract-vectors.sh accepts no arguments' >&2
    exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
cd "$PACKAGE_ROOT"

bun test extension/test/protocol.test.ts
swift test --filter RemoteAuthProtocolTests
cargo test --manifest-path ubuntu/Cargo.toml -p remote-auth-broker-protocol

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../vendor/oh-my-pi/packages/coding-agent"
bun run check:types
bun test \
  test/**/*mvu*.test.ts \
  test/*mvu*.test.ts \
  test/agent-hub-*.test.ts \
  test/input-controller-escape.test.ts \
  test/mvu-*.test.ts \
  test/keymap-registry-conflicts.test.ts \
  test/modes/components/error-selector.test.ts \
  test/modes/components/errors-panel.test.ts \
  test/modes/components/primitives-inspector-state.test.ts \
  test/tree-preview-adapters.test.ts \
  test/setup-wizard*.test.ts \
  test/modes/components/overlay-route-cutover.test.ts \
  test/modes/components/plugin-list-marketplace.test.ts \
  test/modes/components/settings-selector-memory-refresh.test.ts \
  test/hook-input-timeout.test.ts \
  test/hook-editor.test.ts \
  test/modes/components/plan-review-overlay.test.ts \
  test/modes/components/model-selector-mvu.test.ts

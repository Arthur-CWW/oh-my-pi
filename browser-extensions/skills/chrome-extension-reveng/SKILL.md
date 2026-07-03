---
name: chrome-extension-reveng
description: Analyze unpacked Chrome extensions by reading manifests, entrypoints, permissions, content scripts, service workers, web-accessible resources, and network/API surfaces. Use when analyzing extension behavior, porting extension logic, or converting legacy extension research into TypeScript packages.
---

# Chrome Extension RevEng

Use this skill when the task is to inspect an unpacked Chrome extension or turn extension behavior into reusable TypeScript.

## Workflow

1. Read `manifest.json` first and identify manifest version, permissions, host permissions, content scripts, background scripts/service workers, extension pages, commands, declarative rules, and web-accessible resources.
2. Build an entrypoint map before reading implementation files.
3. Follow message passing paths next: `chrome.runtime.sendMessage`, `chrome.runtime.onMessage`, `chrome.tabs.sendMessage`, ports, service-worker events, and content-script DOM injection.
4. Separate product behavior from browser API plumbing.
5. Move reusable logic into TypeScript packages under `packages/`; keep source-extension case studies under `reveng/`.

## Analyzer

Run the TypeScript analyzer from the monorepo root:

```bash
pnpm skill:reverse-engineer
```

Or point it at a specific unpacked extension:

```bash
pnpm --filter chrome-extension-reveng analyze reveng/vidiq-vision
```

The analyzer prints a compact manifest summary and the files that deserve first-pass review.

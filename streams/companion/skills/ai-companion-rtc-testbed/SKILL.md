---
name: ai-companion-rtc-testbed
description: "Work on the clean-room local-first AI companion RTC testbed under apps/ai-companion-rtc, including verification and latency proof."
---

# AI Companion RTC Testbed

Use for `apps/ai-companion-rtc` work.

## Boundary

- Keep the stack clean-room and local-first.
- Use Grok/iPhone/PlayCover observations only as behavioral references.
- Do not copy proprietary code, models, weights, SDK internals, or assets.
- Do not handle login credentials, passcodes, 2FA, or secrets.

## Core invariant

Every realtime path should preserve latency timestamps for:

1. input capture/commit
2. server receive
3. response start
4. avatar frame emit
5. browser render

Prefer proof that reports these segments, not just visual success.

## Current verification ladder

From `apps/ai-companion-rtc`:

```bash
bun run typecheck
bun test
AI_COMPANION_PORT=4901 bun run dev
```

Then run a WebSocket smoke that joins `/ws`, sends a `prompt`, and requires `session`, `delta`, `avatar_frame`, and `audio_delta` with a populated frame `latencyTrace`.

For UI proof, open `http://127.0.0.1:<port>/`, send a text prompt, verify status returns to `idle`, transcript contains user and assistant text, and the latency overlay shows input/server/start/avatar/render segments. Save screenshots under `artifacts/ai-companion-rtc/` and summarize in `apps/ai-companion-rtc/docs/qa-smoke.md`.

## Git

`apps/ai-companion-rtc` is a nested git repo. Commit app progress there after typecheck, tests, and smoke pass. Root `TASKS.md` tracks the broader workstream separately.

# OMP upstream patch ideas

Status: parked as design notes. Do not apply as Bun `patchedDependencies` or runtime-rebuild hooks.

## Current decision

- Remove repo-managed OMP patching from this project.
- Treat OMP as an installed tool, not a package rewritten on every launch.
- Keep these ideas here for a future upstream PR or fork.

## Kagi browser-session search

Status in local OMP 16.0.1: implemented upstream.

Desired behavior:

- Search uses the signed-in browser Kagi session instead of `KAGI_API_KEY`.
- Session capture can use existing Chrome/Firefox cookies or cached Kagi session metadata.
- Request target is `https://kagi.com/socket/search?q=...`.
- Request headers include `X-Kagi-Authorization` and browser-like context headers.
- If no session exists, fail clearly: sign into `kagi.com` in a browser.

Original patch touched:

- `src/web/kagi.ts`
- `src/web/search/providers/kagi.ts`
- `src/web/search/types.ts`
- generated type files under `dist/types/web/*`

Local source of the same behavior remains in:

- `packages/web-access/src/kagi.ts`

## OAuth-only subagent credential policy

Status: proposal only. Not active after patch removal.

Problem:

- Subagents can inherit environment/config/API-key credential paths.
- For subscription-backed accounts, this can silently route work to a paid API key lane instead of OAuth/subscription auth.

Desired behavior:

- Add a setting like `task.subagentAuthMode: inherit | oauthOnly`.
- `inherit` keeps current OMP behavior.
- `oauthOnly` gives task subagents a restricted `AuthStorage` and `ModelRegistry` view.
- Restricted auth should allow stored OAuth credentials only.
- Restricted auth should deny runtime overrides, config API keys, stored API keys, env keys, fallback resolvers, and API-key auth headers.

Original patch touched:

- `@oh-my-pi/pi-ai/src/auth-storage.ts`
- `@oh-my-pi/pi-coding-agent/src/config/model-registry.ts`
- `@oh-my-pi/pi-coding-agent/src/config/settings-schema.ts`
- `@oh-my-pi/pi-coding-agent/src/session/auth-storage.ts`
- `@oh-my-pi/pi-coding-agent/src/task/executor.ts`

Upstream PR shape:

1. Add typed credential-source policy to `AuthStorage`.
2. Add a fork/restricted-view method instead of mutating the parent session auth.
3. Add `ModelRegistry` header/API-key sanitization for restricted mode.
4. Add `task.subagentAuthMode` setting.
5. In task executor, fork auth/model registry only for subagents when setting is `oauthOnly`.
6. Add tests proving env/config/runtime API keys are invisible to subagents while OAuth credentials still resolve.

## Removed local mechanisms

Removed because they were update-fragile:

- Bun `patchedDependencies` entries for OMP packages.
- `scripts/apply-omp-kagi-browser-session-patch.ts` runtime patch/rebuild script.
- `/Users/arthur/.local/bin/omp` launch-time patch guard.

The wrapper may still normalize Bun path handling for CMUX/mise, but it must not rewrite OMP packages.

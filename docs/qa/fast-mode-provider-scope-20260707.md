# Fast Mode Provider Scope — QA Report (2026-07-07)

## Slice 1 — `src/session/agent-session.ts` (L6713–6759)

**File:** `packages/coding-agent/src/session/agent-session.ts`

- **L6713:** `setFastMode(enabled: boolean, scope?: "openai" | "claude" | "both")` extends the session API with an optional provider scope.
- **L6714–6728:** `scope === undefined` preserves the existing behavior: early-return when enabling while already enabled, `setServiceTier(undefined)` on disable, and `fastModeScope` setting mapping on enable.
- **L6730–6752:** Scoped calls decompose the current `serviceTier` into OpenAI/Claude booleans, union on enable, subtract on disable, then map back through `setServiceTier`.
- **L6744–6752:** The final mapping is `{openai, claude}` → `"priority"`, `{openai}` → `"openai-only"`, `{claude}` → `"claude-only"`, empty → `undefined`; `setServiceTier` keeps the existing Anthropic fast-mode re-arm behavior.
- **L6755–6759:** `toggleFastMode()` remains unchanged and still calls scope-less `setFastMode(enabled)`.

## Slice 2 — `src/slash-commands/builtin-registry.ts` (L66–133, L452–515)

**File:** `packages/coding-agent/src/slash-commands/builtin-registry.ts`

- **L66–72:** Adds the shared `FastModeScope` and `ParsedFastModeCommand` parser types.
- **L74:** Defines the required usage string: `Usage: /fast [on|off|status] [gpt|claude|both]`.
- **L76–93:** Adds the shared scope alias resolver.
- **L95–120:** Adds one shared parser used by both ACP/text and TUI handlers. It accepts bare `/fast` as toggle, bare scope as scoped enable, bare `on|off|status|toggle`, and `on|off` with scope; all other shapes return usage.
- **L453–459:** Updates `/fast` description, ACP input hint, and `on`/`off` subcommand usage hints.
- **L462–483:** ACP/text handler dispatches through the shared parser. Scoped `on`/`off` calls `setFastMode(enabled, scope)` and formats the resulting state via `formatFastModeStatus`; bare commands keep their prior wording.
- **L485–514:** TUI handler uses the same parser and preserves `refreshStatusLine(runtime.ctx)` plus `editor.setText("")` conventions.

### Final grammar

```text
/fast
/fast toggle
/fast status
/fast on [scope]
/fast off [scope]
/fast <scope>  ≡  /fast on <scope>
```

Unknown token usage:

```text
Usage: /fast [on|off|status] [gpt|claude|both]
```

### Scope aliases

| Aliases | Resolves to |
|---|---|
| `gpt`, `openai`, `oai`, `codex` | `"openai"` |
| `claude`, `anthropic`, `opus` | `"claude"` |
| `both`, `all` | `"both"` |

## Tests

### `test/fast-mode-scope.test.ts`

Existing regression tests left unmodified (L62–104):

1. `scopes enabled fast mode to OpenAI when configured`
2. `scopes enabled fast mode to Claude when configured`
3. `defaults enabled fast mode to priority for both providers`
4. `clears the service tier when disabled`
5. `does not broaden an already enabled scoped tier`

New scoped tests (L106–156):

1. `enables fast mode for only OpenAI when scoped from off`
2. `adds Claude to an OpenAI-only fast mode scope`
3. `removes Claude from a both-provider fast mode scope`
4. `turns fast mode off when removing the only Claude scope`
5. `enables fast mode for both providers when scoped to both from off`
6. `adds OpenAI while scoped fast mode is already enabled for Claude`

### `test/acp-builtins.test.ts`

- **L15–29, L55–105:** Fake ACP session now carries `serviceTier` and implements scoped `setFastMode` set semantics so command output can assert the resulting provider scope.
- Existing regression test retained: `consumes fast status without returning prompt text` (L208–215).
- New command-level tests (L217–255):
  1. `enables OpenAI-scoped fast mode from /fast on gpt`
  2. `removes Claude from scoped fast mode with /fast off claude`
  3. `treats bare /fast gpt as OpenAI-scoped enable`
  4. `prints scoped fast mode usage for unknown tokens`

## Targeted test output / blocker

Not run by this subagent. Blocking instruction from assignment context: `Do not run tests, typecheck, lint, formatters, package managers, git commands, provider tools, or project-wide commands. The parent orchestrator owns verification.`

Recommended parent validation from `vendor/oh-my-pi/packages/coding-agent/`:

```text
bun test test/fast-mode-scope.test.ts
bun test test/acp-builtins.test.ts
```

# AGENTS.md

## Project

`agents` is a monorepo for the local agent control plane: Pi extensions, skills, browser tooling, local archives, OMP/runtime work, and AI/video workflows.

Current packages and absorbed tool repos:

- `packages/web-access` — published active extension/tool bundle (`@wirebabel/pi-web-access`) for web search, content fetching, YouTube transcripts, Chrome cookies, Codex session import, frontend LLM browser sessions, and the `vim-lite` Pi input editor. This package name is kept for npm compatibility pending a future package split.
- `packages/dynamic-workflows` — vendored `pi-dynamic-workflows` source/tests plus local adversarial-review prompt template; the released `npm:pi-dynamic-workflows` package is installed project-locally for the active workflow tool.
- `packages/browser-use` — clean-room CDP browser-use extension prototype.
- `packages/twitter-archive` — local-first Twitter/X archive schema and future capture/search helpers.
- `packages/jimeng-client` — Jimeng/Dreamina direct API helpers ported from Slotok reverse engineering.
- `apps/tweet-viewer` — future local archive viewer.
- `browser-extensions`, `kimi-code-usage`, and `oh-my-pi` — absorbed self-contained tool/runtime repos; keep their internal layouts and package managers intact.
- `skills/` — first-party passive OMP/Pi skills, grouped by immediate discovery parents (`core`, `browser`, `provider`, `research`, `design`, `media`). Vendored/imported skills stay under `vendor/<source>/...` and are only loaded by explicit config.
- `docs/research/kagi` — archived Kagi reverse-engineering capture; active Kagi client code lives in `packages/web-access/src/kagi.ts`.
- `workflows/*` — future archive/analyze/generate shortform-video workflows.
- `catalog/workspaces.yml` — YAML registry for workspace ownership, ad hoc context roots, capability discovery parents, packet policy, and session path-alias conventions. Update this before moving cross-workspace work.

The repo root is also a Pi package. `.pi/settings.json` points at `..` and `npm:pi-dynamic-workflows`. The root `package.json` `pi` manifest loads `packages/web-access/src/index.ts`, concrete grouped `skills/...` paths, selected vendored skill roots such as `vendor/badlogic/pi-skills`, and the local dynamic-workflows prompt templates. OMP custom skill discovery must point at each immediate skill parent because OMP scans one level deep. For ad hoc sibling-folder context, add an absolute path or packet reference to `catalog/workspaces.yml` instead of moving the folder into this repo.

Top-level task tracking lives in `TASKS.md`. For substantial multi-step work, read it early and update it when task status changes.

## Commands

```bash
pi --help                         # verify project Pi package loads
bun run typecheck                 # delegates to packages/web-access
bun run test                      # delegates to packages/web-access
bun run check                     # typecheck + tests + lint
bun run lint                      # all repo lint guardrails
bun run lint:unsafe-types         # ratcheted no any/unknown/Any lint
bun run jimeng:test               # Jimeng direct-client unit tests
bun run web-access:smoke          # live tool smoke test
bun run web-access:help           # verify extension directly
bun run dynamic-workflows:test     # dynamic workflow parser/runtime tests
```

## Files

```txt
packages/web-access/
  src/
    index.ts      Pi extension entrypoint (tools + commands)
    schemas.ts    Effect Schema types + errors
    config.ts     ~/.pi/web-search.json reader
    store.ts      JSON file KV store with TTL
    cookies.ts    Chrome cookie extraction (macOS Keychain + CDP)
    cua-driver.ts CuaDriver CLI wrapper for background macOS GUI/app automation
    gemini.ts     Gemini API + Web client
    kagi.ts       Kagi search (Firefox cookies or Chrome CDP)
    search.ts     web_search (Kagi-first, Gemini fallback)
    fetch.ts      fetch_content (HTTP/Readability → Jina → background Chrome → Gemini)
    youtube.ts    YouTube transcript extraction (yt-dlp)
    codex.ts      Codex CLI session listing/import and `/codex-resume`
    vim-lite.ts   Vim-like modal Pi input editor registered as `/vim-lite`
    frontend-browser.ts  frontend LLM browser automation
  test/            package tests, including `vim-lite.test.ts` + snapshots
  vendor/kagi-chrome-extension/   Official Kagi extension (submodule)

packages/dynamic-workflows/       Vendored workflow source/tests plus adversarial-review prompt
packages/twitter-archive/         Local archive schema/capture package skeleton
packages/jimeng-client/           Jimeng/Dreamina direct API helpers
apps/tweet-viewer/                Local archive viewer skeleton
docs/twitter-archive-plan.md      Twitter/X archive and shortform pipeline plan
```

## Pi vim-lite editor extension

- Source: `packages/web-access/src/vim-lite.ts`; registered from `packages/web-access/src/index.ts` with `registerVimLite(pi)` and loaded by the root `package.json` Pi manifest.
- Command: `/vim-lite` enables it, `/vim-lite off|disable` restores Pi's stock editor, `/vim-lite help` shows in-TUI help, `/vim-lite hide` hides that help.
- Clipboard behavior: plain Vim yanks (`y`, `yy`, `Y`, visual `y`) write to the system clipboard by default; `"+p` pastes from the system clipboard. Deletes/changes only update the internal register unless an explicit register is used.
- Tests: `packages/web-access/test/vim-lite.test.ts` and `packages/web-access/test/__snapshots__/vim-lite-visual.snap.txt`.

## Effect v4 patterns

- `Effect.fn` for effectful functions (no `Return` annotation, let inference work)
- `Schema.TaggedErrorClass` for typed errors
- `Effect.retry(Schedule.recurs(1))` for retry
- `Result.isSuccess()` / `.success` for result handling
- Only `Effect.runPromise` at Pi harness boundary (`index.ts`)

- Prefer Effect Schema for external JSON/file/process/API boundaries. Avoid raw `JSON.parse` in core code; parse at the edge and decode before passing data inward.
- Prefer Effect CLI for new command surfaces and substantial CLI refactors. Hand-written parsers are acceptable only for tiny legacy surfaces or when converting would distract from the requested change.

## Persistent Preferences

- Durable docs, skills, and artifacts should avoid moralizing, legalistic, or cover-my-ass labels. State concrete scope, authorization basis, provenance, and proof requirements instead.
- For video/creative/AI UGC work, read and maintain `docs/state/README.md` and `docs/state/video-creative-direction.md`; when Arthur gives new durable preferences or direction in a session, update the relevant state doc so it stays synchronized.
- For local macOS GUI/browser automation, interpret “cooler driver”, “cuadriver”, and “C-U-A driver” as `cua-driver` / CuaDriver. Prefer CuaDriver for background native app control and visual browser automation before Computer Use, foreground browser control, or reactive AeroSpace focus guards. Keep CDP/Playwright/Puppeteer for DOM, network, cookies, and protocol-level browser work.
- Do not use the Orca orchestration skill for normal repo coordination in this workspace. Use OMP's built-in `task`/IRC orchestration, and use `cua-driver` for computer-use / GUI automation when DOM/CDP tools are not the better fit.
- Keep `TASKS.md` synchronized for multi-step repo work so active, next, blocked, and done work stays easy to discover.
- For React UI work, do not unit-test owned components by rendering raw HTML strings or snapshotting full markup. Test pre-render state/view models and interaction behavior; use snapshots for stable normalized data/contracts or focused component variants when they protect a real invariant; use visual/browser QA for rendered UI.
- For substantial implementation work, use the `proof-of-work-qa` skill before final handoff. Make the reviewer’s proof artifact obvious and rerunnable: UI/UX changes should usually include visual QA screenshots plus a short walkthrough video; APIs/providers/benchmarks should include contract tests, fixtures/snapshots, saved logs, CSV/JSON, or markdown tables as appropriate.
- For multi-agent work, generalize the Jimeng packet workflow: coordinator defines owner paths, excluded paths, validation commands, and handoff format; workers stay inside those boundaries; parent runs integrated validation.
- When composing Pi/LLM handoff prompts, use `@path/to/file` references where supported to auto-include maintained context docs instead of copying them manually.
- For subagents, prefer `gemini-3.5-flash` for bounded non-core implementation/review work. Use GPT-5.5/main-oracle fallback for important fallback work while subscription impact is acceptable; use Kimi only when explicitly chosen or when Gemini/GPT fallback is unavailable.
- `moduleResolution: "bundler"` — no `.js` import extensions
- `bun-types` in package typecheck configs for tests
- Cross-runtime: avoid native modules unless deliberately isolated
- Do not introduce explicit TypeScript `any`/`unknown` or Python `Any` outside typed boundary modules; use `bun run lint:unsafe-types`.
- External API/process/file data should be decoded at the boundary with a schema/parser before entering core code; DB access should use generated/inferred row types or decode rows in the repository layer.
- Kagi auth: `X-Kagi-Authorization` header (matching official extension)
- Tests close to source in package `test/` directories
- No colocated `*.test.ts` beside impl files
- Twitter/X capture should be respectful: low concurrency, jitter/backoff, disk cache/entity dedupe, no private/locked content
- Browser-based Twitter/X scraping should inspect only the main content/tweet column plus search input; ignore sidebars/trends/DMs/navigation chrome
- Jimeng/Dreamina API work is value-first: prioritize the highest-value UGC workflows before speed/ease/no-spend. Arthur may pronounce or dictate it as “Gming”; treat that as `J-I-M-E-N-G`. Paid or mutating live/direct runs need explicit approval with exact commands and artifact paths; keep generation concurrency 1 and stop on risk-control (`1019` / `shark not pass`) errors.
- Sudo: NEVER run `sudo` without Arthur's explicit approval. Use `ask` with: exact command, cwd, why needed, what it changes, whether reversible. See `docs/prompts/sudo-approval.md` for the full protocol. Arthur authenticates via fingerprint — approval is the gate.
- vphone-cli AMFI: NEVER recommend or set global `amfi_get_out_of_my_way=1` on Arthur's daily-driver Mac by default. It destabilized VoiceInk, Karabiner, Firefox/TCC/HID flows after SIP changes. Prefer targeted `make amfidont_allow_vphone` / `amfidont --path ~/agents/vphone-cli` with explicit approval; use global AMFI boot-args only as a last-resort, time-boxed experiment with a rollback command (`sudo nvram -d boot-args && sudo reboot`) stated up front.

# Primer dashboard — live review surface (proof)

The dæmon's face: a Bun server + single dark dashboard page where Arthur reviews what agents produce instead of reading code. Built 2026-07-03; all runs against live substrates.

## Run it

```bash
cd packages/primer-daemon && bun run dev   # → http://primer.localhost:1355 (portless)
# or without the proxy:
cd packages/primer-daemon && bun run dashboard   # → http://localhost:4177
```

Already running in the background of this session — open `http://primer.localhost:1355` in any pane. Server log: `/tmp/primer-dev.log`.

## What it is

- **Ask the dæmon** — question → `POST /api/ask` → evidence pack grouped by substrate, every hit with ref chip, source link, relative timestamp.
- **Card candidates** — approve/reject buttons → `POST /api/cards/status`, persisted to the ledger. This is Arthur's taste-input loop: agents propose cards, Arthur flips status.
- **Progress feed** — `progress` ledger table, polled every 3s; agents append milestones/proofs as they finish work (`bun run cli progress add --kind milestone --title ... --ref docs/qa/...`). The shared "what is Fable doing" pane.
- **Proofs** — lists `docs/qa/*.md` (the per-task review contracts) and renders them in-page. Finished task = proof doc here = reviewable without reading code.
- **Notes** — dæmon write-back annotations with provenance sources.
- **Status strip** — substrate freshness (browser/twitter/reader mtimes) + ledger counts.

## E2E QA (2026-07-03, headless browser against http://primer.localhost:1355)

- Ask "what have I been reading about spaced repetition and flashcards?" → live evidence pack: Matuschak prompts essay, hashcards, Memory Machines site + both eval tweets, terms chips rendered. PASS
- Card #1 Approve click → `/api/cards` shows `approved`, persisted across reload; reverted to `candidate` via API so the real review is Arthur's. PASS
- Progress feed shows seeded milestones; proofs panel lists and renders `docs/qa` docs incl. first-answers proof. PASS
- Status strip: browser 59m / twitter 2d / reader 4d + `1n · 1c · 4p`. PASS
- Screenshot: [`primer-dashboard/dashboard-full.png`](primer-dashboard/dashboard-full.png)
- Gate: in-package `bun run check` — typecheck clean, 24 tests / 86 assertions green (dashboard suite uses env-isolated temp fixture DBs; never touches real substrates or the real ledger).

## Architecture notes

- `src/dashboard.ts` — Bun.serve, Effect Schema request decoding, allowlisted proof serving, honors portless-injected `PORT` (fallback 4177).
- `src/dashboard-page.ts` — single self-contained HTML document (inline CSS/JS, zero external requests), designed by the Opus lane.
- `src/evidence.ts` — retrieval seam shared by CLI and dashboard (extracted from cli.ts, behavior unchanged).
- Substrate DBs remain read-only; the ledger (`data/primer/daemon-ledger.sqlite`, gitignored) is the only writable surface and now also carries the `progress` table.
- Package is fully self-contained per 2026-07-03 decision: no root package.json scripts; root chain additions reverted (`docs/state/agent-tooling-preferences.md`).

## Conventions this establishes

1. Finish a task → write `docs/qa/<task>.md` proof (the review contract) → it appears in the Proofs panel automatically.
2. Append a `progress` entry (`kind: milestone|proof|commit|info`) referencing the proof — the feed is the glanceable session state.
3. Card candidates accumulate for Arthur's approve/reject; approved cards are the future mochi-export queue.

## v2 — after Arthur's first review (2026-07-03)

Feedback addressed: "I don't know what I'm looking at" / "what can I ask?" / "what model?" / other streams' proofs leaking in / half-pane viewport / vim navigation.

- **Ask now answers with a model.** Retrieval (deterministic, local) feeds an LLM synthesis step running on Arthur's subscriptions via OMP oneshot: default `google-antigravity/gemini-3.5-flash` (`PRIMER_ASK_MODEL` to override, `PRIMER_ASK_SYNTHESIS=0` to disable). Code-level guard refuses fable/mythos model ids — the orchestrator model can never be called from the product. Answer renders with inline [ref] citation chips, model chip, elapsed time; evidence collapsed beneath. Graceful retrieval-only mode when the lane is down.
- **Orientation**: header one-liner, per-panel captions, explanatory empty states, three example-question chips, "answers via <model>" attribution by the input.
- **Proofs scoped to primer**: only `docs/qa/primer-*.md` is listed/served (convention recorded in agent-tooling-preferences.md: `docs/qa/<stream>-<task>.md`).
- **Vim keys**: j/k items, [/] panels, Enter open, a/r approve/reject cards, g/G, Esc/q close, ? keymap overlay. Keys inert while typing.
- **Narrow-first**: single column ≤1199px tuned for the cmux half-pane (~650–900px); proof viewer becomes a full overlay at narrow widths.

QA (headless, 720px): UI ask "Nick Land and Meltdown" → synthesized answer citing browser events AND reader annotations (11/13/15/35), model chip + 3.3s; ? overlay, panel cycling, j/k focus ring all exercised. Screenshot: [`primer-dashboard/dashboard-v2-ask.png`](primer-dashboard/dashboard-v2-ask.png). Gate: in-package `bun run check` — typecheck clean, 28 tests / 107 assertions.

Queued preference (not yet built): migrate chat components to shadcn/chatcn when the page graduates to a build step; Opus lane owns UI.

## v3 — React + shadcn rebuild (2026-07-06)

Arthur's call: "UI is kinda shit, use Opus, shadcn as base." The zero-build constraint was retired.

- **Stack**: Vite + React + TS + Tailwind v4 + shadcn (dark zinc, vendored primitives) in `packages/primer-daemon/web/`; UI designed and implemented by the Opus lane. Bun server unchanged except static serving of `web/dist` (`PRIMER_WEB_DIST` override; 503 JSON when unbuilt). Old inline `dashboard-page.ts` deleted — clean cutover.
- **Design**: warm-amber accent doubling as the vim focus ring, bookish local serif for answer prose, staleness-colored substrate dots, 4px rhythm, single column narrow-first (≤1199px), workbench + reference-rail grid ≥1200px via display:contents so DOM/vim order is stable.
- **Vim nav**: useVimNav hook + panel registry (j/k, [/], Enter, a/r, g/G, Esc/q, ?), inert while typing.
- QA (760px headless): example chip → serif answer with 5 inline citation chips, model badge `google-antigravity/gemini-3.5-flash` + 5.5s, evidence (5) collapsed; ? keymap overlay, panel cycling + focus ring, proof overlay open/close via Enter/Esc — all exercised live. Screenshot: [`primer-dashboard/dashboard-v3-ask.png`](primer-dashboard/dashboard-v3-ask.png).
- Gate: in-package `bun run check` = typecheck (src + web) + vite build + 29 tests — green.
- Dev: `bun run dev` (build + portless) → http://primer.localhost:1355; UI iteration: `bun run web:dev` (HMR, /api proxied).

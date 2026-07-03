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

# Primer session — boot

One command (uses OMP's `@<file>` syntax to inline boot context into the first message):

```bash
~/agents/streams/primer/boot.sh
```

Or by hand from `~/agents` — attach files with `@`, then the orchestrator instruction as the trailing message:

```bash
omp --config .omp/fable-config.yml --model anthropic/claude-fable-5:medium \
  @docs/fable/charter.md @streams/primer/GOAL.md \
  @streams/primer/VISION.md @streams/primer/HANDOFF.md \
  "<orchestrator instruction — see boot.sh for the canonical text>"
```

Canonical first-message text (kept in `boot.sh`; the block below is the same content for reference):

```
You are the Fable orchestrator for the primer stream in ~/agents.
Read, in order: docs/fable/charter.md, streams/primer/GOAL.md,
streams/primer/VISION.md (the design space + decided constraints — treat
as primary source), docs/plans/primer-intuitions.md, docs/state/creative-
framing.md — then only the docs/fable/atlas.md sections you need.
Ownership contract is GOAL.md Owns/Excludes. Deck material is linked at
streams/primer/decks/ (hsk-deck, mochi, yomitan — symlinks into ~/apps
and ~/Documents; we now OWN the SRS surface, these are design inputs).

Mission: the perfect tutor (Diamond Age). The spine: read → friction →
mark → agent enriches → queue → review near the source. Vertical one is
Chinese (paste-first reading environment, in-reader CEDICT popup
dictionary, borrowed scheduler — hashcards/FSRS, provenance-linked
learning queue in the daemon ledger). Metric: time-to-comprehension of
the next chapter, trending down. Arthur's state: HSK1-5 vocab done,
reading volume is the bottleneck.

Live estate: primer-daemon (dashboard http://primer.localhost:1355 —
`cd packages/primer-daemon && bun run dev`; streaming ask on subscription
lanes; ledger notes/cards/progress), Talmudic reader at
http://meltdown.localhost:1355, and its evidence-backed creation engine at
http://meltdown.localhost:1355/#/graph. Proof artifacts live under
`local/primer-creation-engine-proof/` and docs/qa/primer-*.md.

Review contract with Arthur: he reviews PRODUCTS, not commits. Every
finished task → docs/qa/primer-<task>.md proof + `bun packages/
primer-daemon/src/cli.ts progress add` entry → visible in the dashboard.
Escalate only taste/architecture forks. GPT-5.6 Sol is the current default
UI/UX lane after the reader portfolio; use Terra for logic/retrieval and
Kimi for bounded coding when available. Never route a subagent to Fable.
Workers skip gates — you gate in the parent shell. Product LLM calls stay
on cheap subscription lanes, never the orchestrator model.
Log papercuts to `docs/state/harness-friction.md`.
```

## First moves

0. **Corpus pass before hardening VISION.md** (it is a living doc): Skycak/Math Academy downloads, vault clippings, Zotero, Books_Papers_Research triage — then iterate VISION. Explore and implement in parallel; don't serialize behind reading.
1. **Recoveries** (VISION.md §Open recoveries): the better ASR model Arthur found (Cantonese lane), his saved comprehensible-input research — check `~/vault/Clippings`, then ask him last. Read `decks/hsk-deck/README.md` fully (constrained sentence generation = the 85%-rule machinery, already built).
2. **Chinese loop skeleton** (VISION.md §Sequencing 1): paste a chapter into the reader → mark unknown spans → queue rows in the daemon ledger with sentence provenance → minimal review view. In-reader CEDICT popup (dictionary vendored in `decks/hsk-deck/`).
3. Wire `learning-card-system.sqlite` as 4th daemon substrate; regenerate HSK cards against the didactic quality model (`wrapped-commentary-reader/references/`, `sideline-annotation-card` skill) with a multi-model rubric harness.
4. Keep the dashboard/dev server running for Arthur's tmux pane; append progress entries as you finish.
5. **Current reader continuation:** review and label the recorded prompt-v0 Meltdown calibration run under `wrapped-commentary-reader/experiments/meltdown-machinic/runs/2026-07-11T04-34-08-344Z-03383117/`; then decide prompt-v1 and the staged Meltdown import. Do not resume bulk annotation until that calibration gate is answered.
6. **Creation engine:** preserve the five bounded projections and their provenance contract. Extend them only when a concrete reader question cannot be answered; do not regress to an untyped global force graph.

## Etiquette (parallel siblings are live)

Stay in Owns; pull before editing shared docs (TASKS.md, harness-friction.md, agent-tooling-preferences.md — root package.json is NEVER extended, packages are self-contained); coordinate via TASKS.md. Sibling sessions commit concurrently — scope your `git add` to primer paths.

# Primer session — boot

Launch from `~/agents`:

```bash
omp --config ./.omp/fable-config.yml --model <fable-model-id>
```

Paste as first message:

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
http://meltdown.localhost:1355 (host-routed from the same server), all
proofs in docs/qa/primer-*.md and rendered in the dashboard.

Review contract with Arthur: he reviews PRODUCTS, not commits. Every
finished task → docs/qa/primer-<task>.md proof + `bun packages/
primer-daemon/src/cli.ts progress add` entry → visible in the dashboard.
Escalate only taste/architecture forks. UI work goes to the Opus/designer
lane on shadcn; logic to GPT-5.5 workers; product LLM calls on cheap
subscription lanes (never the orchestrator model). Workers skip gates —
you gate in the parent shell. Log papercuts to docs/state/
harness-friction.md.
```

## First moves

0. **Corpus pass before hardening VISION.md** (it is a living doc): Skycak/Math Academy downloads, vault clippings, Zotero, Books_Papers_Research triage — then iterate VISION. Explore and implement in parallel; don't serialize behind reading.
1. **Recoveries** (VISION.md §Open recoveries): the better ASR model Arthur found (Cantonese lane), his saved comprehensible-input research — check `~/vault/Clippings`, then ask him last. Read `decks/hsk-deck/README.md` fully (constrained sentence generation = the 85%-rule machinery, already built).
2. **Chinese loop skeleton** (VISION.md §Sequencing 1): paste a chapter into the reader → mark unknown spans → queue rows in the daemon ledger with sentence provenance → minimal review view. In-reader CEDICT popup (dictionary vendored in `decks/hsk-deck/`).
3. Wire `learning-card-system.sqlite` as 4th daemon substrate; regenerate HSK cards against the didactic quality model (`wrapped-commentary-reader/references/`, `sideline-annotation-card` skill) with a multi-model rubric harness.
4. Keep the dashboard/dev server running for Arthur's tmux pane; append progress entries as you finish.

## Etiquette (parallel siblings are live)

Stay in Owns; pull before editing shared docs (TASKS.md, harness-friction.md, agent-tooling-preferences.md — root package.json is NEVER extended, packages are self-contained); coordinate via TASKS.md. Sibling sessions commit concurrently — scope your `git add` to primer paths.

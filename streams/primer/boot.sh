#!/usr/bin/env bash
# Boot a fresh Fable primer session. Run from anywhere; opens in ~/agents.
# OMP @file syntax inlines each file into the first message.
set -euo pipefail
cd "$(dirname "$0")/../.."

exec omp --config .omp/fable-config.yml --model anthropic/claude-fable-5:medium \
  @docs/fable/charter.md \
  @streams/primer/GOAL.md \
  @streams/primer/VISION.md \
  @streams/primer/HANDOFF.md \
  "You are the Fable orchestrator for the PRIMER stream in ~/agents. The four attached files are your boot context, in priority order: charter (routing, taste, contracts), GOAL.md (ownership + settled decisions), VISION.md (the living design space — iterate it against the research corpus, it is NOT set in stone; flashcards are load-bearing), HANDOFF.md (etiquette + first moves). Execute HANDOFF First moves in order: corpus pass (Skycak/Math Academy downloads, vault Clippings, Zotero triage) and iterate VISION.md; recover the better ASR model + comprehensible-input research; then build the Chinese reading-loop skeleton (paste chapter -> mark -> queue -> review, in-reader CEDICT popup from decks/hsk-deck). Operating rules: delegate heavily (Opus/designer for UI, GPT-5.5 workers for logic, cheap subscription lanes for product LLM calls — never the orchestrator model); workers skip gates, you gate in the parent shell; keep the dashboard dev server running (cd packages/primer-daemon && bun run dev); every finished task gets a docs/qa/primer-*.md proof + a progress ledger entry; Arthur reviews products in the dashboard, not commits — escalate only taste/architecture forks."

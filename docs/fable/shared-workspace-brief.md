# Shared-workspace rendering brief — 2026-07-13 rant extraction

Source: Arthur voice rant (VoiceInk), 2026-07-13. Papercuts extracted to `../state/harness-friction.md` Open rows dated 2026-07-13. This doc holds the durable design ideas so no future session makes Arthur repeat them.

## The core ontology (Arthur's words, distilled)

**OMP is a shared workspace between Arthur and the agent.** The agent's view is the transcript (truth). Arthur's view is a *prettified rendering* of that same transcript — switchable, augmentable. The agent should be able to add components to its own stream that help Arthur understand the work: not decoration, instruments.

This is doctrine-compatible by construction: the journal stays the API; every rendering is a bounded projection; a view never becomes a second writer. The browser layer is *not* a new architecture — collab v2 (runner snapshots/events over an encrypted transport, capability-fenced commands, `collab-web` guest client) already ships the transport. What's missing is only the **component layer** on top of the guest client.

## The rendering-component model

- Transcript entries (and tool results/artifacts) can carry a **view hint**: `{ kind, payload | artifact-ref }`. The TUI renders its plain fallback; the browser guest resolves kind → component.
- Components are hot-swappable and generatable on the fly (React/SolidJS; the agent may *write* a component as part of a turn — "their responsibility for the rendering").
- Multiple renderings per entry; user switches views per-entry or per-kind. No canonical component — a registry with defaults.

**Component examples** (Arthur's + Fable's additions):
audio waveform/player for voice work · inline GIF/animation/SVG playback · mermaid/graph render · interactive HTML/React table to *play with* a result · Blender model turntable · Jimeng/image-video asset grid with previews (spend-gated) · side-by-side sub-agent run comparison (prompt diff + route + outcome) · prompt diff view across orchestrator styles · session timeline scrubber (turns, tool calls, spawns, errors) · agent-tree topology with live status · live test-run matrix (case × pass/fail, click → trace) · latency/token histograms · schema/DB row explorer over a ledger query · file-diff cards with expand-in-place · queue/obligation inspector.

## Interactive validation as a first-class loop (the second rant)

"How can we visually/intuitively/interactively validate different implementations?" — generalize the Bret Victor rule from review surfaces into the *implementation contract*: a slice's proof is a **playable artifact**, not a log. The existing artifact-viewer/dashboard pattern (AGENTS.md review surfaces) is the seed; the component layer above makes it cheap: implementers emit a view-hinted artifact (interactive fixture, before/after scrubber, live parameter knobs) instead of a screenshot. Validation = Arthur manipulates the behavior itself in one click. Applies to: TUI changes (render harness with knobs), providers (asset grid), perf (live counter dashboards), parsers (paste-your-own-input probes).

## TUI-side decisions extracted

1. **`:` command mode (vim-style)** for TUI-manipulation commands (view switches, layout, settings) — keybindings stay for the hot path; the long tail goes behind `:` with completion. Distinct from messages-to-agent.
2. **Widescreen half (>160 cols):** stop double-wide transcript; right half becomes an inspector column (current tool call detail, artifact preview, spawn packet, route provenance — the dual-lane Hub pattern generalized to the main thread).
3. **Post-hoc forensics UX:** compare sub-agent runs and orchestrator prompt styles; work backwards from a failure. Substrate exists (session JSONL, control-plane ledger, HTML export); missing is the comparison view — a strong first browser-component consumer.
4. **Not everything lives in OMP:** prefer coupling with the terminal/mux layer over reimplementing (cmux origin/main reportedly gained Chromium panes — verify; Zellij default keys rejected; Ghostty/libghostty stays).

## Cross-session repetition (the "I keep repeating myself" problem)

Arthur runs several orchestrators in parallel cmux tabs and re-explains context. Direction: **context packets** — durable, addressable briefs (this doc is one) that any session loads by path; plus a capture affordance ("save this rant/spec as a context doc" as a one-step command). Sibling *querying* beats sibling messaging for metadata ("ask their server"): runner snapshots + `history://` already expose transcript/metadata; a `session metadata` query surface should be preferred over IRC for lookups.

## Open questions for Arthur

1. Browser shell: extend `collab-web` (existing guest client) vs. new viewer app? (Recommendation: extend collab-web.)
2. Component authoring: agent-generated on the fly from day one, or registry-of-prebuilt first with generation later? (Recommendation: registry first, generation as the babble phase.)
3. Does the inspector column (widescreen half) live in the TUI, or is widescreen the moment to open the browser view instead?
4. Post-hoc run comparison: TUI view or first browser component? (Recommendation: browser — it wants tables, diffs, scrubbing.)

## Addendum — 2026-07-13 second rant (nav grammar, groups, validation epistemics)

### Subagent navigation grammar ("tmux for OMP subagents")

- Keep `[` / `]` sibling cycling — Arthur confirms useful.
- **Normal-mode-first everywhere:** every agent page opens in normal mode (nav keys live); typing inserts ONLY after `i` (or focusing the input). No nested modal stacks — one global vim grammar: normal is the default on every surface, `i` enters insert, `Esc` exits exactly one level, `?` teaches, `:` commands.
- `:gd <agent>` goto-agent by name (with completion), complementing click.
- **Agent mentions are links:** any `subagent → subagent` coms line in a transcript renders as an OSC8 hyperlink; Ctrl+click (or `gd` on cursor) jumps to that agent's page.
- Glanceable per-agent stats (most important only): status glyph, lane, live tok/s, ctx %, cost, current tool, unread IRC, last-activity age.
- **Subagent groups** (wave/batch): aggregate row showing n running/idle/done/failed, summed tok/s (is the wave alive?), cost burn, median duration, newest error one-liner, shared-file collision count. 3–5 numbers max; expand for detail.
- **Nested spawn tree (Arthur, 2026-07-13, fourth rant):** subagents that spawn subagents nest under their parent in the roster, file-browser style — indent + expand/collapse, `└ •` guides; collapse hides the subtree but the parent's aggregate row still reflects it (counts/tok-s roll up). Parent linkage already exists in the registry/journal; this is a roster-projection change, not a data change. Queued behind the current agent-hub.ts owner to avoid same-file collision.
- Widescreen (>80/160 col): the right half is a **peripheral field**, not an inspector (Arthur, third rant, pointing at Matuschak). Grammar source: `streams/primer/research/inquiry-world/ATLAS-LIVING-FIELD.md` + `sources/andy-matuschak-*.md` — peripheral text stays legible without focus; relations bloom around the current focus; attention shifts emphasis without re-layout; movement leaves faint residue.
  - **Handles, not detail:** thought-sized objects (short title + glyph + one stat), position-stable, no scrolling, no paragraphs. Every handle is inspectable (`Enter`/`gd` jumps focus to it); detail always renders in the focus pane.
  - **Focus-following bloom:** contents derive from what the main pane focuses — a tool call blooms its target files/artifacts; a subagent blooms parent/siblings/packet/route; an error blooms prior occurrences and related friction rows.
  - **Preattentive change:** state changes register as brightness/color pulses, not text churn; a wave's summed tok/s reads as an ambient pulse (alive vs stalled) before any number is read.
  - **Residue trail:** last N focused things linger as dimmed handles for jump-back.
  - **"What wants me" field:** pending `ask` calls, children blocked on input, review-ready proofs — the attention-request class gets a stable region.
  - Candidate steady instruments: queue depth, memory watermark, cost burn, group health. Exact composition deliberately open — babble several layouts and let Arthur prune.

### Slash-command rendering taxonomy

Three classes, each visually distinct and consistent: (1) ephemeral TUI-only (never persisted, dimmed overlay), (2) session-visible non-model annotations, (3) queued model input (rendered like input, with queue position). Friction row filed 2026-07-13; `/usage` cited as ambiguous today.

### Validating nondeterministic / high-dim / intuitive behavior

Beyond dimensionality reduction, the toolkit (each maps to an existing doctrine hook):
1. **Distributions, not runs** — N seeds per candidate, render the outcome distribution (violin/histogram); a single trace is never evidence for stochastic behavior.
2. **Forced-choice tournaments** — taste is a discriminator (priors §6): pairwise A/B of playable candidates → Bradley-Terry/Elo ranking. Reduces high-dim judgment to one-bit decisions, which Arthur is best at.
3. **Metamorphic properties** — assert relations between runs, not absolute outputs: "if input gains X, output should move Y-ward"; robust when exact outputs are unstable.
4. **Fixed probe sets** — small pinned instrument inputs with known qualitative behavior; run per change; regression-by-feel with stable instruments (refusal-lab pattern generalized).
5. **Declared-axis forks** — vary ONE axis with a recorded context manifest (priors §11); observational correlations stay leads, never evidence.
6. **Embedding maps with brushing** — project outputs to 2D, interactive select→inspect; outliers and mode collapse become visible instead of statistical.
7. **Failure clustering** — auto-cluster bad cases (taxonomy-miner pattern) so the high-dim space is explored where it actually breaks.
8. **DST/seeded simulation** — for concurrency/lifecycle behavior, seeds + history checking (HR-080 prototype) turn "flaky" into "reproducible under seed".
All eight want the same substrate: the component layer (distribution views, tournament UI, probe dashboards are components over artifacts).

### Triaged for later (Arthur: ignore for now)

- IRC nodal/group-chat visualization (paxos-visualizer aesthetic, group chats above nodes). Revisit when the component layer exists; run-comparison and tournaments rank higher.

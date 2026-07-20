# Shared-workspace rendering brief — 2026-07-13 rant extraction

Source: Arthur voice rant (VoiceInk), 2026-07-13. Papercuts extracted to `../state/harness-friction.md` Open rows dated 2026-07-13. This doc holds the durable design ideas so no future session makes Arthur repeat them.

> **Authority note (2026-07-22).** Current architecture authority for the shared workspace /
> control plane is [`federated-control-plane.md`](federated-control-plane.md) — one control-plane
> app with stream-scoped routes and components-over-artifacts (§4), and cmux Neovim/OMP/WebView
> surfaces as projections (§10). This file is **dated 2026-07-13 UX evidence**
> ([epistemics](epistemics.md): weigh by date and provenance, never read as current policy). Its
> rendering-component model, interactive-validation loop, TUI navigation grammar, and validation
> epistemics remain **live design input**; specific **browser-shell/transport and cmux-surface
> architecture claims are superseded** by the federated doc where they conflict and are marked
> inline below. Arthur's earlier observations are preserved and dated, not rewritten.

## The core ontology (Arthur's words, distilled)

**OMP is a shared workspace between Arthur and the agent.** The agent's view is the transcript (truth). Arthur's view is a *prettified rendering* of that same transcript — switchable, augmentable. The agent should be able to add components to its own stream that help Arthur understand the work: not decoration, instruments.

This is doctrine-compatible by construction: the journal stays the API; every rendering is a bounded projection; a view never becomes a second writer. The browser layer is *not* a new architecture — collab v2 (runner snapshots/events over an encrypted transport, capability-fenced commands, `collab-web` guest client) already ships the transport. What's missing is only the **component layer** on top of the guest client.

> _[2026-07-22] Superseded architecture detail: the concrete "extend the `collab-web` guest client"
> shell choice is now the single portless control-plane app with stream-scoped routes and a unified
> WebView viewer ([federated-control-plane.md](federated-control-plane.md) §4, §10). The
> component-layer insight above stands; the specific transport/shell binding does not._

## The rendering-component model

- Transcript entries (and tool results/artifacts) can carry a **view hint**: `{ kind, payload | artifact-ref }`. The TUI renders its plain fallback; the browser guest resolves kind → component.
- Components are hot-swappable and generatable on the fly (React/SolidJS; the agent may *write* a component as part of a turn — "their responsibility for the rendering").
- Multiple renderings per entry; user switches views per-entry or per-kind. No canonical component — a registry with defaults.

**Component examples** (Arthur's + Fable's additions):
audio waveform/player for voice work · inline GIF/animation/SVG playback · mermaid/graph render · interactive HTML/React table to *play with* a result · Blender model turntable · Jimeng/image-video asset grid with previews (spend-gated) · side-by-side sub-agent run comparison (prompt diff + route + outcome) · prompt diff view across orchestrator styles · session timeline scrubber (turns, tool calls, spawns, errors) · agent-tree topology with live status · live test-run matrix (case × pass/fail, click → trace) · latency/token histograms · schema/DB row explorer over a ledger query · file-diff cards with expand-in-place · queue/obligation inspector.

## Interactive validation as a first-class loop (the second rant)

"How can we visually/intuitively/interactively validate different implementations?" — generalize the Bret Victor rule from review surfaces into the *implementation contract*: a slice's proof is a **playable artifact**, not a log. The existing artifact-viewer/dashboard pattern (AGENTS.md review surfaces) is the seed; the component layer above makes it cheap: implementers emit a view-hinted artifact (interactive fixture, before/after scrubber, live parameter knobs) instead of a screenshot. Validation = Arthur manipulates the behavior itself in one click. Applies to: TUI changes (render harness with knobs), providers (asset grid), perf (live counter dashboards), parsers (paste-your-own-input probes).

## TUI-side decisions extracted

1. **Colon is the TUI/view-local namespace** for projection commands and shortcuts: `:commands`, `:wrap`, `:rich`, `:version`, and future view-only actions use the registry-backed popup. It is distinct from messages-to-agent.
2. **Slash is the durable/mixed namespace** for session, runtime, model, queue, and other actions that may persist, mutate, or enter the transcript. Its rendering class must be explicit.
3. **The command popup is a projection, not a second authority:** completion/help metadata comes from one interaction registry; the journal remains truth.
4. **Widescreen half (>160 cols):** stop double-wide transcript; right half becomes an inspector/peripheral field (current tool call detail, artifact preview, spawn packet, route provenance — the dual-lane Hub pattern generalized to the main thread).
5. **Post-hoc forensics UX:** compare sub-agent runs and orchestrator prompt styles; work backwards from a failure. Substrate exists (session JSONL, control-plane ledger, HTML export); missing is the comparison view — a strong first browser-component consumer.
6. **Not everything lives in OMP:** prefer coupling with the terminal/mux layer over reimplementing (cmux origin/main reportedly gained Chromium panes — verify; Zellij default keys rejected; Ghostty/libghostty stays).
   > _[2026-07-22] Settled in [federated-control-plane.md](federated-control-plane.md) §10: the right
   > helper pane holds the unified WebView viewer (one portless app, stream-scoped routes) — Neovim is
   > the editor surface, OMP the agent surface, WebView the review/artifact surface. The "cmux
   > reportedly gained Chromium panes — verify" note is superseded by that settled surface contract._

## Cross-session repetition (the "I keep repeating myself" problem)

Arthur runs several orchestrators in parallel cmux tabs and re-explains context. Direction: **context packets** — durable, addressable briefs (this doc is one) that any session loads by path; plus a capture affordance ("save this rant/spec as a context doc" as a one-step command). Sibling *querying* beats sibling messaging for metadata ("ask their server"): runner snapshots + `history://` already expose transcript/metadata; a `session metadata` query surface should be preferred over IRC for lookups.

## Open questions for Arthur

1. Browser shell: extend `collab-web` (existing guest client) vs. new viewer app? (Recommendation: extend collab-web.)
   > _[2026-07-22] Resolved by [federated-control-plane.md](federated-control-plane.md) §4/§10: one
   > portless control-plane app with stream-scoped routes, with the unified WebView viewer as the
   > review/artifact surface. Closed as settled, not answered here._
2. Component authoring: agent-generated on the fly from day one, or registry-of-prebuilt first with generation later? (Recommendation: registry first, generation as the babble phase.)
3. Does the inspector column (widescreen half) live in the TUI, or is widescreen the moment to open the browser view instead?
4. Post-hoc run comparison: TUI view or first browser component? (Recommendation: browser — it wants tables, diffs, scrubbing.)

## Addendum — 2026-07-13 second rant (nav grammar, groups, validation epistemics)

### Subagent navigation grammar ("tmux for OMP subagents")

- Keep `[` / `]` sibling cycling — Arthur confirms useful.
- **Normal-mode-first on viewer surfaces:** agent pages open in normal mode. Writable full-TUI/editor surfaces use `i` for insert; `Esc` exits exactly one layer; `j`/`k` move one line, `J`/`K` move five lines, `g`/`G` jump to ends, `za` folds, `/` searches, `?` teaches, and `:` opens the local command popup.
- **Strict read-only Hub preview:** the preview accepts no message input or follow-up—no `i`, `Ctrl-Enter`, or queued follow-up. `j`/`k` move one line; `J`/`K` move five lines; `u`/`d` and `Ctrl-U`/`Ctrl-D` move half a page; `PgUp`/`PgDn` move a full page. `Enter` attaches the selected session in the full TUI.
- **Hub surface exceptions are explicit:** `n`/`p` select roster rows; `h`/`l` switch lanes; `H`/`L` switch root groups; `.` toggles historical rows; `v` toggles rich/plain; `[`/`]` cycle siblings; `R` revives; `x` aborts. These are viewer-local projections; message input belongs to the attached full TUI.
- **Agent mentions are links:** any `subagent → subagent` comms line in a transcript renders as an OSC8 hyperlink; Ctrl+click (or `gd` on cursor) jumps to that agent's page.
- Glanceable per-agent stats (most important only): status glyph, lane, live tok/s, ctx %, cost, current tool, unread IRC, last-activity age.
- **Subagent groups** (wave/batch): aggregate row showing n running/idle/done/failed, summed tok/s (is the wave alive?), cost burn, median duration, newest error one-liner, shared-file collision count. 3–5 numbers max; expand for detail.
- **Nested spawn tree:** subagents that spawn subagents nest under their parent in the roster, file-browser style — indent + expand/collapse, `└ •` guides; collapse hides the subtree but the parent's aggregate row still reflects it (counts/tok-s roll up). Parent linkage comes from the registry/journal; this is a roster projection, not a data change.
- Widescreen (>80/160 col): the right half is a **peripheral field**, not an inspector (Arthur, third rant, pointing at Matuschak). Peripheral text stays legible without focus; relations bloom around the current focus; attention shifts emphasis without re-layout; movement leaves faint residue.
  - **Handles, not detail:** thought-sized objects (short title + glyph + one stat), position-stable, no scrolling, no paragraphs. Every handle is inspectable (`Enter`/`gd` jumps focus to it); detail always renders in the focus pane.
  - **Focus-following bloom:** contents derive from what the main pane focuses — a tool call blooms its target files/artifacts; a subagent blooms parent/siblings/packet/route; an error blooms prior occurrences and related friction rows.
  - **Preattentive change:** state changes register as brightness/color pulses, not text churn; a wave's summed tok/s reads as an ambient pulse (alive vs stalled) before any number is read.
  - **Residue trail:** last N focused things linger as dimmed handles for jump-back.
  - **"What wants me" field:** pending `ask` calls, children blocked on input, review-ready proofs — the attention-request class gets a stable region.
  - Candidate steady instruments: queue depth, memory watermark, cost burn, group health. Exact composition deliberately open — babble several layouts and let Arthur prune.
- **`za` pill folding:** in normal mode, toggles the `[Paste #N]` pill under cursor between collapsed and expanded-editable; expansion is re-collapsible and preserves edits.
- **`:commands` and command popup:** `:commands` autocompletes from the shared interaction registry; descriptions, selection, focus restoration, and unknown-command feedback come from that one registry. `:wrap` now soft-wraps IRC communication and tool-result bodies while preserving bounded receipt/error/metadata/roster rows; `:rich` switches rich/plain rendering across assistant, user, IRC, and tool-result bodies.
- **Hub preview state:** the selected child's in-flight assistant tail streams as a byte-bounded projection, with selected turn status and rollout phases journaled separately from the transcript authority.
- **Vendor auto-sync:** automation may update only explicit `policy: track` entries after exact upstream/remote/branch checks and clean fast-forward proof; `policy: pin` entries, especially `vendor/oh-my-pi`, remain no-I/O. The current manifest has 21 entries (NCode removed), and typed daily `--apply` is active: the latest live apply updated codex, plugins, cua, chrome-devtools, and whisper, left cmux blocked by a dirty tree, and left pins untouched. Unit Git fixtures remain blocked by Bun-test EBADF.
- **Native video:** roles, providers, models, and APIs stay distinct; inline video is accepted only on the Antigravity native lane (`google-antigravity/gemini-3.5-flash`) under strict `<100MB` validation, with oversized/unsupported input failing explicitly.

### Slash-command rendering taxonomy

Slash actions remain visually distinct by effect: (1) ephemeral TUI-only projections (never persisted, dimmed overlay), (2) session-visible non-model annotations, and (3) queued model input (rendered like input, with queue position). Colon commands are not a fourth persistence channel; they are view-local projection controls. The journal remains the durable truth.

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

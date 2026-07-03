title: Studio v2 wave: editor, labeler, provenance, portless
date: 2026-07-03
agent: Fable
status: shipped

The playground grew from a viewer into an editor, and the review loop you asked for is now structural.

**Studio v2** (Opus lane, GPT + Kimi reviewed): four-region editor — scene tree with add/remove/reorder, inspector with drag-scrubbers for every spec field (position/rotation/scale/opacity/clone/camera/pass params, live re-init ~150ms debounce with generation guard), SVG timeline with beat grid + draggable keyframes + moving playhead, CodeMirror source tab with two-way sync. Vim keymap throughout (j/k, g/G, Space, x, ?, [/]) as a pure tested module. Design tokens extracted from a live Open Design boot (62 vars; doc at `docs/state/scene-studio-design-language.md`).

**Corpus labeler** (LABEL nav item): yazi-style three-pane triage over the Pleometric corpus — groups with digit keys, visual-mode range select, focused-cell autoplay. The loop is `j j v j j 3`: three items into group 3, focus advances, zero mouse. Labels in SQLite; every label op is a human-provenance row. Corpus now 35 items + a graphics/shader lead list from pleometric's following (`data/inspiration/pleometric/leads.json`).

**Provenance ledger**: every spec/report edit lands in `data/scene-lab/ledger.sqlite` marked human (UI writes) or agent (direct file writes), hash-chained with byte deltas — the entropy-tracking substrate for future edit prediction.

**Review loop, exercised**: GPT-5.5 code review found 1 blocker (`javascript:` hrefs in report markdown — fixed) + 5 majors (spec-mutation clamps, re-init race, watcher provenance losses — all fixed). Kimi live QA found 3 behavioral defects (static playhead, dead position scrubber, Escape-proof help overlay — all fixed; delta re-QA in flight).

**Ops**: app now runs portless at http://scene.localhost:1355 behind a supervised `dev:up` loop (auto-restart, `bun --watch`, `/healthz`); backend + browser errors unify into `data/scene-lab/errors.log` (`/api/errors`). Conventions promoted to AGENTS.md.

**Queued elsewhere**: speech-to-speech testbed packet → companion stream (`docs/plans/speech-to-speech-testbed.md`); Codex-refresh conservation (save for 5.6, two-account balancing) → harness friction log, high severity.

**Next**: you label the corpus; style extraction from your "interesting" groups seeds the two-layer (person/hook) creative framework and the pose-transfer persona pipeline.

# Slotok Future Backlog

This file captures UI/features intentionally removed from the active V1-local surface because they were dummy, fake, or not backed by real state/actions yet.

## Screenshot evidence

Current post-cleanup screenshots exist in:

```txt
artifacts/slotok-visual-qa/latest/
  01-persona-atlas.png
  02-exploration-board.png
  03-batch-review.png
  04-campaign-map.png
  05-reference-archive.png
  06-final-editor.png
  07-developer-graph.png
  08-kie-proxy.png
```

Pre-cleanup screenshots were not preserved before the shell cleanup. Use this document as the authoritative backlog capture for removed dummy surfaces.

## Removed from active V1-local shell

These were removed because they were misleading chrome, not real product behavior.

### Sidebar shell

- fake Campaigns list
  - `Summer Skincare`
  - `Protein Bar Ads`
  - `Hydration Boost`
  - `Coffee Brand`
  - `Archived`
- fake Review Queues counts
  - `Needs My Review`
  - `Starred`
  - `Approved`
  - `Rejected`
- fake account/footer identity badge
  - `Arthur`
  - `Pro`
- read-only search box
- `New Command` shell button
- fake window-control dots / workspace switcher chrome

### Topbar shell

- fake notifications/history/avatar buttons
- fake `Preview` / `Export` top-right actions
- static lane chips when not backed by state
- hardcoded `Summer Skincare / creative search graph` breadcrumb copy

### View toolbar shell

- no-op `Board`
- no-op `Table`
- no-op `Graph`
- no-op `Filter`
- no-op `Sort`

### Inspector / command chrome

- fake `Creative` / `JSON` inspector toggle
- fake command-bar actions
  - `Add context`
  - `Targets`
  - `Agent`

## Backlog candidates to reify later

These should only come back when backed by real state, routes, and proof.

### 1. Real campaign switching

Bring back a campaign list only when Slotok supports multiple persisted campaign/workspace contexts and switching them is a real daemon-backed action.

Needed:
- campaign/workspace list route
- persisted selected campaign/workspace
- real counts and reload-safe switching
- smoke proof that switching changes visible state

### 2. Real review queue shortcuts

Bring back Review Queue shell controls only when the queue counts derive from real saved filters or review inboxes.

Needed:
- saved review queries or queue entities
- real counts from state
- click action changes the active filtered surface

### 3. Real command targeting

Bring back `Add context`, `Targets`, and `Agent` only when the command bar can target actual workflow definitions/personas/agents.

Needed:
- structured command target model
- daemon-backed workflow launch contract
- visible result in workflow telemetry

### 4. Real final editor mode controls

The toolbar labels `Select`, `Crop`, `Text`, `Captions`, `Audio`, `JSON` should return only when they switch actual editor modes or panels.

Needed:
- persisted selected editor mode
- mode-specific editing affordances
- end-to-end smoke proving mode change affects UI/state

### 5. Real Persona Atlas generation

`Generate 12 persona directions` should return only when it creates real local persona draft records or workflow runs.

Needed:
- draft persona generation route/workflow
- resulting persona records or workflow outputs
- reload-safe persistence

### 6. Real Exploration Board suggestion engine

Any auto-suggested product/format/script/CTA rows should come from current workspace/reference/provider/workflow data rather than hardcoded demo rows.

Needed:
- real derivation from local state or workflow output
- visible provenance / lane alignment
- smoke proof that suggestions change when inputs change

## Policy

A future surface returns only if it satisfies all three:

1. real state or route behind it
2. reload-safe persistence when relevant
3. automated smoke or visual proof that it does something useful

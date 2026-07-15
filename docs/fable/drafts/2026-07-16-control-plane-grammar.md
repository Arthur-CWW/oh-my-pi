# HR-125 Control Plane grammar — veto draft

Status: proposal only; no bindings or UI are changed. Scope is the Control Plane roster, selected-agent detail/transcript, and docks. “Orchestrator” means a root/Main-level group, not every descendant.

## 1. Navigation and action matrix

Flags: **KEEP** preserves behavior; **BREAK** intentionally reassigns a current key; **NEW** adds a binding; **RESERVE** names a future surface without installing a dead key.

| Context / key | Current behavior | Proposed behavior | Flag |
|---|---|---|---|
| roster `j` / `k` | scroll active transcript/inspector one line | select next / previous visible row; never page-scroll | **BREAK** |
| roster `↓` / `↑` | scroll active transcript/inspector one line | mirror `j` / `k` (subject to Q1) | **BREAK** |
| roster `n` / `p` | select next / previous visible row | jump to next / previous orchestrator root, wrapping | **BREAK** |
| detail `d` or `Ctrl-D`; `u` or `Ctrl-U` | half-page down / up | half-page the focused detail/transcript lane | **KEEP** |
| detail `J` / `K` | five lines down / up | same | **KEEP** |
| detail `PgDn` / `PgUp` | full page down / up | same | **KEEP** |
| `gg`; `G` | top / bottom of focused viewer | first / last item in focused lane (roster row or detail line) | **KEEP** |
| detail `gj` / `gk` | one display row down / up | same; these coexist in the `g` namespace | **KEEP** |
| roster `h` / `l`, `←` / `→` | collapse/expand tree; otherwise focus inspector/roster | same | **KEEP** |
| roster `[` / `]` | previous/next sibling; otherwise inspector section | same | **KEEP** |
| roster `H` / `L` | previous/next root group | remove after one release; `p`/`n` own this meaning | **BREAK** |
| roster `za` | toggle selected fold | same | **KEEP** |
| `/`; filter text; `Enter`; `Backspace`; `Esc` | enter/edit/finish/delete/cancel filter | same; while filtering, all grammar keys are literal except filter controls | **KEEP** |
| filtered `n` / `N` | next / previous match (table or chat) | same only while a completed search is active | **KEEP** |
| `?` | toggle shortcut legend | selected-agent metadata sheet: identity, state, prompt/source, route provenance, model, version/fork, rollout/error, then full contextual keys | **BREAK** |
| roster `.` | toggle archived/history rows | same | **KEEP** |
| roster/chat `v` | rich/plain preview | same | **KEEP** |
| roster `y` | copy child identity/history URL | same | **KEEP** |
| roster `Enter` | attach/focus live agent; open parked/external/archive transcript | same | **KEEP** |
| roster `r` / `R` in chat | revive selected parked agent | same | **KEEP** |
| roster `x` | kill selected agent | same, with existing confirmation policy | **KEEP** |
| roster `P` | reconcile stale/orphan selected agent | same, but expose only in `?` under operator actions | **KEEP** |
| chat `h`/`Backspace`; `q`; `Esc` | return to roster; close Control Plane; clear search then return | same | **KEEP** |
| chat `[` / `]`; `Ctrl-S n/p`; double `←` | adjacent agent; adjacent prefix; parent | retain `[`/`]` and double-`←`; retire redundant `Ctrl-S n/p` | **BREAK** |
| configured expand key(s) | expand/collapse transcript tool detail | same | **KEEP** |
| configured Hub/observe key | close the already-open overlay | same toggle behavior | **KEEP** |

Rule: selection motions affect the roster; scroll motions affect only the explicitly focused detail/transcript lane. No key silently changes both selection and scroll.

**Implementation cost: M.** Reorder table dispatch, make focus semantics explicit, migrate help registry/tests, and retain filter-mode capture; no new data projection.

## 2. `g` chord namespace

`g` means “go to/open a Control Plane surface”; the second letter names the noun/action. One shared prefix state must serve `gg`, `gj`, `gk`, and the pane chords—never independent parsers.

| Chord | Proposal and mnemonic | Surface reality / cost |
|---|---|---|
| `gx` | Go to e**x**ceptions: open/focus the existing docked HR-113 errors projection, scoped to selected agent when possible, otherwise fleet-wide | Existing dock; **S–M** wiring |
| `gm` | Go to **m**essages: open the selected agent’s existing in-Hub transcript (live, parked, external, or archived) | Existing transcript; **S** |
| `gt` | Go to **t**odos | No Control Plane todo projection exists yet; **RESERVE**, do not bind or advertise until HR-118 supplies it; later **M–L** |
| `gr` | Go **r**efresh: reread roster, rollout, error, and transcript projections without mutating lifecycle | Projection refresh exists internally, no key; **S** |
| `gs` | Go **s**end: for a live internal agent, attach/focus its existing main composer; for external show the existing `omp irc send …` hint; disabled with reason for archived/read-only rows | No inline Hub composer is invented; **M** |
| `gg`, `gj`, `gk` | Vim-compatible first item / display-row down / display-row up | Existing motions; parser merge **M** |

Unknown `g?` cancels the prefix, shows `unknown Control Plane chord: g?` briefly, and does not replay the second key. `Esc` cancels silently. No `gt` handler exists until its surface exists.

**Implementation cost: M overall.** `gx/gm/gr` are small adapters; `gs` needs focus/target validation; `gt` is excluded from HR-125 implementation.

## 3. Live status, rollout, and errors

- Roster state column: replace the static dot only for genuinely live transitions with one shared low-rate spinner frame: running/working, retry delay, and rollout `requested → acknowledged → applied`. Idle, waiting-input, parked, aborted, recovered, skipped, and failed stay static and readable without animation.
- Selected-agent header: a persistent one-line status rail immediately below identity and above prompt/transcript. Priority is `ERROR` > `NEEDS INPUT` > active rollout > activity. It must not disappear when detail scrolls.
- Rollout text shows phase, target version + 12-char digest, age, and failure/skip reason. Preserve all journal phases: planned, requested, acknowledged, applied/awaiting recovery, recovered, skipped, failed. Failed must be visible rather than omitted.
- Error summary remains inline on the selected-agent rail; `gx` opens durable details in the dock. A rollout failure links the same projected error record rather than creating a second error store.
- Animation runs only while at least one visible row is animated, uses a shared timer, stops when hidden/terminal, and never changes column width.

**Implementation cost: M.** HR-115 rollout and HR-113 error data already exist; work is projection/placement, a shared animation clock, and focused rendering tests.

## 4. Taste questions (Arthur decides)

1. **Arrow parity:** recommend **Yes**—`↑/↓` mirror `k/j` selection in the roster; detail scroll requires detail focus. No keeps arrows as detail scroll.
2. **Chord timeout:** recommend **Yes**—keep the existing 750 ms `g` timeout, show a transient `g…` cue, and make timeout cancel silently. No means choose 500 ms or wait indefinitely.
3. **`?` versus `:help`:** recommend **Yes**—`?` is the contextual metadata+keys sheet; `:help` remains global command documentation and links back to `?`. No means `?` metadata only, duplicating keys in `:help`.

**Implementation cost: S** once the choices are fixed; changing timeout/help ownership later is cheap, but arrow semantics alter muscle memory and tests.

## Veto checklist (mark Yes or No)

- Navigation/action matrix, including `j/k`, `n/p`, and retirement of `H/L` + `Ctrl-S n/p`: **Yes / No**
- `g` namespace (`gx`, `gm`, reserved `gt`, `gr`, `gs`, existing `gg/gj/gk`): **Yes / No**
- Live-status spinner, fixed selected-agent rail, and rollout/error placement: **Yes / No**
- Q1 recommendation—arrow parity with `j/k`: **Yes / No**
- Q2 recommendation—750 ms chord timeout with `g…` cue: **Yes / No**
- Q3 recommendation—`?` contextual metadata+keys; `:help` global: **Yes / No**

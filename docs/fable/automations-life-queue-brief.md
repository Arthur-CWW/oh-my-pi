# Automations + life-queue brief — 2026-07-13 rant extraction

Source: Arthur voice rant. This doc is the context packet for the build wave; future sessions load it instead of making Arthur repeat himself.

## The unifying observation

Every asked-for system — bookmark categorizer, email triage, refund pursuit, todo-for-everything, vault triage, abandoned-session recovery, tab renamer — is one pipeline: **capture → triage → queue → scheduled/background pursuit → glanceable review**. ADHD is not the bug to fix; the bug is that capture, memory, and resumption live in Arthur's head. Externalize all three; agents do the pursuing, Arthur does the deciding.

## Two missing primitives (everything else is an adapter)

1. **Automations** — background agents not owned by any session: registered {name, schedule, lane, packet, workspace}, run headless on a scheduler (Codex-automations-shaped; cron + UI), journaled like any session, **attachable/resumable** from the Hub (external-peer surface already exists), results into a ledger. Cheap lanes by default (Luna-mini-class; test which is enough per job).
2. **Life queue** — one durable queue over `packages/control-plane`: {title, intent, priority, source, context-packet path, status, owning-agent, resumable-session}. Many intakes, one queue. Agents pick items up and pursue; every item carries enough packet context to resume without re-explanation.

## Intakes (thin adapters over existing substrate — build incrementally)

| Intake | Substrate that already exists |
|---|---|
| Twitter bookmarks → categorized intents | browser-extensions x-bookmark-sync + twitter-archive store + feeds registry |
| Abandoned OMP sessions → resumable queue items | sessions dir + control-plane ledger + Hub sibling cockpit; "UI/UX for continuing is bad" is the friction to fix |
| Obsidian vault triage | `vault://` (GTD-ish clarify/organize pass, agent-assisted) |
| Email | gmcli skill; **general email triage explicitly deferred by Arthur** |
| Voice rants | already flowing (this doc pipeline) |
| Chrome/Firefox tab triage | **deferred by Arthur** |

## Named first jobs

1. **cmux tab renamer** (wanted now): searchable cmux tab names that track the task. Investigate first whether OMP/Pi/Codex tabs fail to rename because the TUI never emits OSC title updates — a one-line fork fix may beat an automation. Otherwise: Luna-mini automation watching sessions → renaming tabs via agent-mux/cmux API.
2. **OpenAI Pro refund pursuit** (context-isolation REQUIRED): account was wrongly ToS-banned, reinstated, but the $200 Pro subscription was never re-enabled; support tickets + forum posts already filed (see prior sessions' Gmail context; rescued `openai-appeal/account-handoff` docs are flagged personal — private store). Arthur's explicit instruction: **all case context lives in a Sol subagent, never in the Fable orchestrator** (classifier risk). Shape: one-shot Sol investigation assembles a case file (email chain, ticket numbers, timeline, next escalation step) → registered as a daily automation that pursues until refunded, reporting status to the queue.

## Routing notes from the same rant

- Observed partial order among cheap lanes: Luna > other weak lanes (Kimi, Opus, Gemini) — subscriptions bought, use-them-up economics apply, not set in stone.
- Gemini 3.5 Pro/Flash (via Antigravity): reserve for **video understanding/decomposition** — the parked playground task (video → decomposed assets) will want it.
- Tiny intelligence-injection daemons: try Luna-mini-class first; measure, don't assume.

## Build order (proposed default)

1. Automations primitive in the fork (Sol — core, everything builds on it): registry + scheduler daemon + headless run + Hub attach/resume + ledger. Minimal v0; no UI beyond Hub visibility + CLI.
2. cmux tab renamer: OSC-title fork probe first, then automation fallback (Luna).
3. Life queue v0 on control-plane + `/queue` surface; first intakes: manual add + abandoned-session scan.
4. Refund one-shot Sol case file (context-isolated) → becomes automation #2.
5. Bookmarks categorizer once queue exists (it needs somewhere to put its output).
Deferred by Arthur: browser tab triage, general email triage.

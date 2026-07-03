# Fable → Next Session Handoff

Quick checklist for starting the next Fable OMP session in `~/agents`.

## Read first

1. This doc.
2. [`docs/fable/context.md`](context.md) — what Fable is optimizing, ignoring, and routing.
3. [`docs/fable/preferences.md`](preferences.md) — working style, model routing, and subagent policy.
4. [`docs/fable/session-index.md`](session-index.md) — how to find valuable sessions without reading everything.
5. [`docs/fable/workstream-map.md`](workstream-map.md) — where repos/folders/sessions live.
6. [`docs/fable/transcription-notes.md`](transcription-notes.md) — likely dictation corrections and unresolved aliases.

## Orient

- Active tasks and next actions: [`TASKS.md`](../../TASKS.md)
- Durable state / taste: [`docs/state/README.md`](../state/README.md) and the relevant state docs listed there.
- Plans and lane ownership: [`docs/plans/README.md`](../plans/README.md)
- QA / proof / review findings: [`docs/qa/README.md`](../qa/README.md) and [`docs/review-agents/README.md`](../review-agents/README.md)

## Resume a workstream

- **AI companion / RTC testbed**: [`apps/ai-companion-rtc/docs/goal.md`](../../apps/ai-companion-rtc/docs/goal.md)
- **UGC / creative playground**: [`docs/state/video-creative-direction.md`](../state/video-creative-direction.md), [`docs/plans/ugc-studio-workstreams.md`](../plans/ugc-studio-workstreams.md), [`docs/plans/slotok-workbench.md`](../plans/slotok-workbench.md)
- **Personal second-brain / shared context**: [`docs/fable/workstream-map.md`](workstream-map.md), [`docs/twitter-archive-plan.md`](../twitter-archive-plan.md), [`docs/plans/twitter-archive-goal.md`](../plans/twitter-archive-goal.md), `packages/borges-library`, `~/apps/mochi-lite`, `~/apps/hsk-deck`, `~/vault`, `~/github/hashcards`.
- **Agent harness**: [`docs/plans/symphony-lite-goal.md`](../plans/symphony-lite-goal.md), [`docs/state/symphony-lite-direction.md`](../state/symphony-lite-direction.md)

## Find previous sessions

- Start with [`data/fable-prep/session-corpus-summary.md`](../../data/fable-prep/session-corpus-summary.md) for per-label candidate listings and scores.
- Use [`data/fable-prep/session-records.json`](../../data/fable-prep/session-records.json) for full metadata and filtering.
- Filter: prioritize `chatbot_rtc`, `ugc_video`, combined `twitter_archive` + `learning_memory`, and high-score `agent_harness`; skip `menial_ops`, `security_exclude`, and most `uncategorized`.

## Delegate, don't duplicate

- Do not spawn Fable subagents. Use `task` subagents with explicit, bounded assignments.
- Prefer `kimi-implementer`, `gpt-implementer`, or `gemini-3.5-flash` workers for implementation; `explore` for read-only scouts; `reviewer` for adversarial passes.
- See [`docs/fable/preferences.md`](preferences.md) for model/subscription routing.

## Exclusions

- Do not route cybersecurity, reverse-engineering, vphone, proxy, or anti-detection work through Fable.
- Do not work on the built-in `autolearn` system; it is a non-goal (possible future replacement, but not now).
- Do not run project-wide formatters, linters, or test suites unless the task explicitly asks for it.
- Do not edit secrets, `~/.claude`, or `package.json` unless the assignment says so.

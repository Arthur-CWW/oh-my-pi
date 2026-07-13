# Refusal observability and rerouting

## Incident

A Fable-backed turn asked to write the local architecture document `docs/fable/gateway-brief.md`. The provider stopped with `Refusal (cyber)` before producing a tool call. The terminal showed the refusal, and progress resumed only after a manual model switch.

This is treated as a provider-classification event, not a tool failure. A refusal that arrives after any tool-call block is not safe to replay automatically.

## Canonical evidence

Control-plane schema version 11 stores `RefusalRecord` rows in `refusal_records`. Each record includes:

- timestamp; provider, model, and role
- provider category, code, and bounded/redacted message
- tool and action when known
- session, turn, and correlation identifiers when known
- SHA-256 fingerprint of the redacted prompt and a redacted excerpt capped at 160 characters
- retry and reroute outcomes
- context-source filenames when available; paths are reduced to `[path]/basename`
- redaction policy identifier

`insertRefusalRecord()` normalizes before persistence. `queryRecentRefusals()` returns a bounded newest-first report. `queryRefusalCounts()` groups by `model`, `category`, `tool`, or `action`. The report deliberately does not retain complete prompt bodies, authorization headers, tokens, passwords, or full context paths.

The OpenAI-compatible completions adapter also normalizes streamed `delta.refusal` text into a structured `stopDetails.type = "refusal"` error rather than counting it only as stream progress.

## Rerouting policy

Automatic rerouting is a conservative exception, not a general refusal retry:

1. The provider must return the explicit classifier stop type `refusal`. `sensitive` is never eligible.
2. The latest user request must unambiguously describe an allowlisted local operation: writing/editing documentation or tests, formatting, typechecking, or building.
3. Requests mentioning credentials, authentication bypass, exploitation, malware, weapons, exfiltration, or remote mutation/posting/upload/deployment are ineligible even when they also mention an allowlisted verb.
4. The refused response must contain no tool-call block and no stream-interrupted-after-content marker. Tool-granularity replay is unsafe because a provider refusal normally occurs before a tool request exists, while replay after a tool call could duplicate a side effect.
5. The existing full-turn fallback chain may select one configured fallback model. The fallback is pinned for the refusal turn; a second refusal is surfaced and never advances farther through the chain.
6. The visible fallback notice includes `[rerouted after provider refusal]`.

Anything outside this narrow policy remains visible for manual retry/model switching and is still eligible for evidence capture.

## Context sources and trigger cleanup

Possible context sources should be recorded as redacted filenames when the session knows them: system prompt fragments, `AGENTS.md`/`CLAUDE.md`, enabled skill descriptors or bodies, explicit file mentions/reads, queued custom messages, and compaction summaries. A filename is correlation evidence, not proof that its contents caused a classifier result.

Conservative quarantine candidates identified in this workspace:

- `local/openai-account-handoff.md` — contains enforcement history and repeated high-trigger language about cyber abuse, jailbreaking, cookies, sessions, scraping, and account changes; it is private case evidence, not normal coding context.
- `local/openai-appeal-handoff.md` — contains the same trigger vocabulary plus personal/account/billing details; it should be private evidence loaded only for the appeal workflow.
- `local/openai-cyber-abuse-cases/README.md` and its screenshots — a research corpus dominated by cyber-abuse enforcement, tokens, cards, account flags, and agent-automation language; it should be opt-in source material rather than ambient workspace context.
- Any reinstalled `godmode`/jailbreak skill (formerly referenced by `packages/web-access/CHANGELOG.md`) — skill metadata can enter default skill discovery even when the task is unrelated. Keep such a skill disabled or install it under an explicit opt-in/private profile.

Recommendation: move the three `local/` evidence sets to a private evidence root outside default workspace discovery, or expose them through a narrowly scoped opt-in skill that is disabled by default. Do not move the iOS detection research or ordinary security tests merely because they contain terms such as “jailbreak”; those are legitimate package-local sources and are not loaded unless the task targets them. No files are moved automatically: provenance from several refusal records should be reviewed before quarantine.

## Regression evidence

Focused coverage includes the observed Fable `Refusal (cyber)` fixture for `docs/fable/gateway-brief.md`, redaction and excerpt limits, grouped and recent queries, one-reroute/no-loop behavior, refusal-after-tool-call non-replay, sensitive/ambiguous request rejection, and streamed OpenAI refusal normalization.
The verified local laboratory checkpoint is [`2f54cb1d`](../../vendor/oh-my-pi/packages/coding-agent/src/session/refusal-corpus.ts), with an 8-pass staged gate. Its append-only corpus implementation and real CLI coverage are in [`refusal-corpus.test.ts`](../../vendor/oh-my-pi/packages/coding-agent/test/refusal-corpus.test.ts) and [`refusals-cli.test.ts`](../../vendor/oh-my-pi/packages/coding-agent/test/refusals-cli.test.ts).

The shipped behavior is deliberately concrete:

- `RefusalCorpus.appendCase()` normalizes and appends one redacted JSON object per line, using `~/.omp/agent/refusals.jsonl` by default or the `OMP_REFUSALS_PATH` override. It caps prompt excerpts at 160 characters, fingerprints the redacted prompt with SHA-256, and stores context basenames rather than full paths.
- `omp refusals list [--json]`, `show <id>`, and `stats [--json]` read bounded cases and grouped counts; `mark <id> --verdict ... --note ...` appends an updated record, preserving the original line.
- `omp refusals replay <id>` and `replay --false-positives` submit only the stored redacted prompt/context envelope with an empty tool list, append replay history, and record `passed`, `refused`, or `error`. Cases requiring tools are rejected before replay because this laboratory never replays side effects.

These commands are the local evidence surface; the control-plane `RefusalRecord` schema remains the broader correlation/query surface.

## Corpus workflow

Use the coding-agent-local append-only corpus (`~/.omp/agent/refusals.jsonl`, or
`OMP_REFUSALS_PATH` for an isolated test corpus) to keep replay-safe evidence
close to the agent rather than depending on the shared control plane:

1. **Classify** — record the provider/model/version/role, category, action,
   redacted prompt fingerprint and excerpt, context-source filenames, and the
   reroute outcome.
2. **Remediate/quarantine recommendation** — mark the case with
   `omp refusals mark <id> --verdict ... --note ...`. Recommendations are
   review-only; no files are moved automatically.
3. **Replay the corpus** — use `omp refusals replay <id>` or
   `omp refusals replay --false-positives`. Replay submits only the stored
   redacted prompt/context envelope with no tools. Cases requiring tools are
   refused by the CLI; replay never retries a provider refusal.
4. **Close/regress** — inspect `omp refusals stats`, record the replay result,
   and keep the fixture/test for future regressions. The observed architecture
   refusal is represented by a sanitized fixture, not a private full prompt.

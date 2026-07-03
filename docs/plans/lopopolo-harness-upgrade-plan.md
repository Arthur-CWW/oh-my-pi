# Lopopolo-style harness upgrades for this repo

Research source: `docs/research/lopopolo-agent-material/README.md`

Purpose: adapt Ryan Lopopolo's public harness-engineering patterns to `pi-workflows` without copying OpenAI's internal setup or adding heavyweight process.

## Current state

What already matches the pattern:

- Root `AGENTS.md` is short and mostly acts as a table of contents.
- Project commands are explicit (`bun run typecheck`, `bun run test`, `bun run check`, smoke/help commands).
- Durable preferences are separated from research docs (`docs/state/` vs `docs/research/`).
- Skills and tools are first-class (`skills/`, Pi extension tools, dynamic workflows).
- Browser automation has safety guidance and background-safe defaults.

Main gaps:

- We do not yet have a single "agent operating model" doc that tells agents how to plan, prove work, update docs, and report results.
- Validation is mostly package-level; there are few repo-owned guardrails that check docs/source-of-truth drift.
- Review-agent prompts exist in dynamic workflow templates, but are not yet wired into a standard PR/change workflow for this repo.
- Browser/network permissions are convention-based; there is no codified "safe egress / approval" policy for agents beyond instructions.
- For long-horizon tasks, proof artifacts are inconsistent: commands, screenshots, logs, transcript/session links, and decisions are not always stored in a predictable place.

## Upgrade principles

1. **AGENTS.md stays a map, not a manual.** Keep it concise; move detailed operating rules into versioned docs.
2. **Docs are the system of record.** If behavior, architecture, or durable preference changes, update the relevant doc in the same change.
3. **Mechanical guardrails beat reminders.** Prefer tests, linters, schemas, and scripts with remediation messages over long prose instructions.
4. **Every task should produce proof.** Commands, outputs, screenshots, videos, logs, source URLs, or session URLs should be reported and, when useful, saved under `docs/research/`, `docs/plans/`, or ignored `data/`.
5. **Reviewer agents are lenses, not blockers by default.** Use focused review prompts for security, reliability, UX, docs drift, and agent-legibility.
6. **Safe autonomy needs boundaries.** Prefer sandboxed/background browser sessions, allowlisted network access, and explicit paid-quota warnings over YOLO-style permissions.

## Proposed repo additions

### 1. Agent operating model

Add `docs/agent-operating-model.md` and optionally link it from `AGENTS.md`.

Minimum contents:

- Discover source of truth: read `AGENTS.md`, package README, relevant `docs/state/` or `docs/plans/`.
- Plan before broad edits; use short execution plans for multi-file work.
- Keep docs synchronized with behavior.
- Prove changes with narrow commands first, then broader checks.
- Report exact commands run and key outputs.
- For external research, save source URLs and expensive model session notes.
- For browser/network/live quota tasks, use dry-runs and risk notes first.

### 2. Proof-of-work checklist

Add `docs/checklists/proof-of-work.md`.

For code changes:

- [ ] Source-of-truth docs consulted.
- [ ] Tests/typecheck/lint run or reason not run.
- [ ] Behavior/docs updated together.
- [ ] Risky live/quota actions avoided or explicitly approved.
- [ ] Follow-up guardrail proposed if a mistake was caught manually.

For research:

- [ ] Primary source URLs recorded.
- [ ] Mirrors vs primary sources labeled.
- [ ] Gaps and uncertainty documented.
- [ ] Expensive/Pro session URL or prompt saved if useful.

### 3. Reviewer-agent lenses

Create prompt templates under `docs/review-agents/` or integrate with `packages/dynamic-workflows`:

- `docs-reviewer.md`: checks whether changed behavior is reflected in docs.
- `security-reviewer.md`: checks secrets, cookies, paid quota, browser automation, and filesystem/network risk.
- `reliability-reviewer.md`: checks retries, timeouts, backoff, cleanup, and observability.
- `agent-legibility-reviewer.md`: checks whether future agents can discover commands, source-of-truth docs, schemas, and failure modes.
- `ux-output-reviewer.md`: checks final user-facing answers for paths, commands, caveats, and overclaiming.

### 4. Mechanical docs/metadata guardrails

Small, high-leverage scripts/tests to consider:

- Validate `docs/research/**/source-urls.txt` exists for research directories that claim source digests.
- Validate no committed docs include obvious secrets/cookies/API keys.
- Validate package docs mention commands present in root `package.json` for that package.
- Validate `docs/state/README.md` points to all durable state docs.
- Validate generated workflow recipes/manifests against existing JSON schemas.

### 5. Safer autonomy defaults

Inspired by Ryan's Auto-review + egress-proxy note:

- Keep using `llm_frontend_browser` in background mode by default.
- Add a local "network/egress policy" doc for agents: what domains/tools are expected, what requires approval, what is never allowed.
- For Jimeng/Dreamina and other paid/quota workflows, standardize dry-run first, concurrency 1, stop conditions, and proof logs.
- For Codex/Pi browser tasks, prefer explicit allowlists and domain-scoped browser access over blanket/full-access behavior.

## Near-term implementation plan

1. **Document the operating loop**
   - Add `docs/agent-operating-model.md` and `docs/checklists/proof-of-work.md`.
   - Add one line to `AGENTS.md` pointing agents there.

2. **Codify review lenses**
   - Add review prompt docs.
   - Expose one dynamic workflow that runs 3-5 reviewer lenses on a diff or plan.

3. **Add lightweight guardrail scripts**
   - Start with docs/source URL and secret-scan checks.
   - Add to `bun run check` only after false positives are low.

4. **Build a local corpus pack**
   - Use `docs/research/lopopolo-agent-material/README.md` as the source map.
   - For future high-context agent work, prompt with `@docs/research/lopopolo-agent-material/README.md` plus the relevant local docs instead of pasting full transcripts.

5. **Pilot on one package**
   - Use `packages/web-access` first because it already has tools, tests, skills, browser automation, and security-sensitive behavior.
   - Add package-level source-of-truth docs for browser/network permissions and proof artifacts.

## Ready-to-use prompt

```text
You are improving the agent harness for this repo using Ryan Lopopolo's public harness-engineering patterns.
Read @AGENTS.md, @docs/research/lopopolo-agent-material/README.md, and @docs/plans/lopopolo-harness-upgrade-plan.md.

Task: propose the smallest change that improves future-agent output for <area>.
Requirements:
- Keep root AGENTS.md concise.
- Prefer docs-as-map plus mechanical checks over long reminders.
- Add proof-of-work expectations.
- Avoid unsafe YOLO/full-access assumptions; call out browser/network/paid-quota risk.
- Provide exact files changed and commands to validate.
```

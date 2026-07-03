# Git cleanup plan for Fable onboarding

Current dirty tree (as of this plan):

- 169 tracked modifications
- 122 untracked files
- `git diff --stat` ≈ **+10,465 / -9,384** lines

Goal: split the work into **two practical commits** — one that directly onboards Anthropic Fable, and one that syncs the rest of the pre‑Fable worktree — while leaving risky/runtime/secret stuff untouched.

No staging, committing, or editing is done here; this is the exact command set the parent can run.

---

## Commit 1: Fable prep (today)

Scope: everything that directly sets up Fable as a high‑level advisor/orchestrator with a slim, safe default context.

Includes:

- `docs/fable/` — `session-index.md`, `context.md`, `preferences.md`, `harness-slimming.md`, `model-routing.md`, `claude-omp-cleanup.md`, and this plan.
- Root orientation docs: `AGENTS.md`, `README.md`, `TASKS.md`, `TECH_DEBT.md`.
- Harness/tooling config: `.gitignore`, `.mise.toml`, `.omp/config.yml`, plus the new `.omp/agent/`, `.omp/agents/`, `.omp/bin/`, `.omp/mcp.json`, `.omp/patches/` files.
- Default skill profile: `package.json` (manifest), `skills-lock.json`, and the kept first‑party skill groups (`skills/browser/`, `skills/core/`, `skills/design/`, `skills/media/`, `skills/provider/`).
- The harness‑slimming deletions: old `packages/web-access/skills/*`, `skills/emusks-research/`, and the entire `skills/pi-skills/` tree.

Commands:

```bash
git add docs/fable/ \
  .omp/agent/ .omp/agents/ .omp/bin/ .omp/mcp.json .omp/patches/ .omp/config.yml \
  .gitignore .mise.toml \
  AGENTS.md README.md TASKS.md TECH_DEBT.md \
  package.json \
  skills/browser/ skills/core/ skills/design/ skills/media/ skills/provider/ \
  skills-lock.json \
  packages/web-access/skills/ skills/emusks-research/ skills/pi-skills/

git status --short
git diff --stat --cached
git commit -m "fable: onboard Anthropic Fable advisor context and default skill profile"
```

Manual call‑outs before committing:

- `skills/design/impeccable-design-review/` exists on disk but is listed as **Removed** in `docs/fable/harness-slimming.md`. Decide whether to keep it in the commit (available but not loaded) or leave it untracked.
- `skills/research/` (`reverse-engineering/`, `emusks-research/`, `used-hardware-buying-research/`) is intentionally **not** added here; it is excluded from the Fable default profile.
- `.omp/mcp.archived-porkbun.json` is **not** included because it looks like archived credentials.

---

## Commit 2: Bulk pre‑Fable worktree sync

Scope: safe implementation work, docs, packages, and scripts that accumulated before this Fable session but should not be mixed with the Fable onboarding commit.

Includes:

- UGC / video pipeline: `apps/slotok-workbench/`, `packages/hyperframes-renderer/`, `packages/market-lab/`, plus TikTok scripts and `workflows/tiktok-recreate/`.
- Twitter / X archive: `browser-extensions/`, `packages/twitter-archive/`.
- Agent harness / runtime: `oh-my-pi/`, `packages/symphony-lite-rs/`, `packages/symphony-lite-elixir/`, `packages/ast-grep-guard/`.
- Library / research: `packages/borges-library/`, `docs/` (plans, QA, state, research, reference).
- Misc safe files: `tools/`, `scripts/`, `sgconfig.yml`, `catalog/workspaces.yml`, `cooking-with-openai-research-chief-mark-chen-transcript.md`.

Commands:

```bash
git add apps/slotok-workbench/ browser-extensions/ docs/ oh-my-pi/ \
  packages/ast-grep-guard/ packages/borges-library/ packages/hyperframes-renderer/ \
  packages/market-lab/ packages/symphony-lite-rs/ packages/symphony-lite-elixir/ \
  packages/twitter-archive/ packages/web-access/ scripts/ tools/ workflows/ \
  catalog/workspaces.yml sgconfig.yml \
  cooking-with-openai-research-chief-mark-chen-transcript.md \
  ':(exclude)packages/ios-control/' \
  ':(exclude)packages/spatial-audio-renderer/test-output/' \
  ':(exclude)packages/web-access/src/discord-agent-server*' \
  ':(exclude)packages/web-access/src/godmode.ts' \
  ':(exclude)packages/web-access/src/slack-agent-server*' \
  ':(exclude)packages/web-access/src/telegram-agent-server*' \
  ':(exclude)packages/web-access/src/wise-statements.ts' \
  ':(exclude)packages/web-access/test/discord-agent-server.test.ts' \
  ':(exclude)packages/web-access/test/slack-agent-server.test.ts' \
  ':(exclude)packages/web-access/test/telegram-agent-server.test.ts' \
  ':(exclude)packages/web-access/test/wise-statements.test.ts' \
  ':(exclude)docs/qa/vphone-red-blue-20260625.md' \
  ':(exclude)docs/plans/vphone-red-blue-goal.md' \
  ':(exclude)docs/plans/vphone-red-blue-workstreams.md' \
  ':(exclude)docs/research/ios-automation-system-plan.md' \
  ':(exclude)docs/research/vibe_re_xsql.pdf'

git status --short
git diff --stat --cached
git commit -m "sync: bulk pre-Fable implementation, docs, and packages"
```

Manual review items in this commit:

- `docs/plans/reverse-engineering-lab.md` and `docs/plans/residential-proxy-sourcing.md` touch excluded domains. Decide whether to keep them in the bulk commit or leave them untracked.
- `docs/research/vibe_re_xsql.md` and `docs/research/vibe_re_xsql.gemini-flash-url.md` are reverse‑engineering research notes. Same manual decision.
- `cooking-with-openai-research-chief-mark-chen-transcript.md` is a raw transcript; include it only if you want it in the repo.

---

## Leave untracked / ignored

These should **not** be committed without explicit review:

| Category | Paths |
|---|---|
| Runtime artifacts / secrets | `erl_crash.dump`, `omp-session-*.html`, `telegram_upload_session.session`, `packages/spatial-audio-renderer/test-output/` |
| Vendored external checkouts | `vendor/` (large third‑party skill/tool trees; partially ignored by `.gitignore`) |
| Cybersecurity / vphone / reverse‑engineering / proxy implementation | `vphone-cli/`, `apps/ios-qa-controller/`, `packages/ios-control/`, `packages/proxy-lab/` |
| Duplicate skill copies | `.github/skills/impeccable/`, `.pi/skills/impeccable/` (triplicate the same `skills/design/impeccable-design-review/` content) |
| Large binary / raw transcript | `docs/research/vibe_re_xsql.pdf` |
| Already ignored by `.gitignore` | `node_modules/`, `data/`, `artifacts/`, `tmp/`, `*.sqlite`, `*.mp4`, `.env`, `.DS_Store`, etc. |

`.gitignore` gaps to consider fixing later (do not commit these files):

- `test-output/` (not ignored — the spatial‑audio renderer test dirs are leaking)
- `*.session` (e.g., `telegram_upload_session.session`)
- `omp-session-*.html`
- `erl_crash.dump`

---

## Risky files / manual decisions

- `.omp/mcp.archived-porkbun.json` — likely archived credentials; keep untracked.
- `skills/design/impeccable-design-review/` — on‑disk but removed from default profile; decide keep vs. delete.
- `packages/web-access/src/discord-agent-server.ts`, `slack-agent-server.ts`, `telegram-agent-server.ts`, `godmode.ts`, `wise-statements.ts` — external service, jailbreak, and financial API implementations; leave for separate review.
- `packages/proxy-lab/` — proxy provider matrix and scenarios; separate review.
- `docs/plans/reverse-engineering-lab.md`, `docs/plans/residential-proxy-sourcing.md`, `docs/plans/jimeng-frontend-api-reversal.md`, `docs/research/vibe_re_xsql.md` — reverse‑engineering / proxy domain docs; bulk commit is OK, but do not feed them into Fable context.

---

## Verification

```bash
# After each add, check what's left out
git status --short

# Review exactly what will be committed
git diff --stat --cached

# Review what's still unstaged
git diff --stat
```

---

## Stream priority note (latest steering)

Treat the following as **main streams**:

1. AI companion / VRM / realtime avatar (`apps/ai-companion-rtc/`, `chatbot_rtc` sessions)
2. UGC / media creative playground (`apps/slotok-workbench/`, `ugc_video` sessions)
3. Personal second-brain / shared context (Twitter/X archive + HSK deck + Mochi clone + Diamond Age Primer / Nick Land reader + personal library + annotation app + browser history / Twitter graph / personal knowledge graph)
4. Agent harness / cyborgism (`oh-my-pi/`, `packages/web-access/`, `.omp/`, high-score `agent_harness` sessions)

Cybersecurity, vphone, proxy, and reverse-engineering lanes are present but routed away from Fable.

In the current dirty tree, the visible learning/second‑brain candidates are mostly the `packages/borges-library/` book tooling and the reading lists under `docs/research/slotok-design-books-*.md`; the main app repos (`~/apps/mochi-lite`, `~/apps/hsk-deck`, etc.) are outside this repo and are not part of this commit plan.

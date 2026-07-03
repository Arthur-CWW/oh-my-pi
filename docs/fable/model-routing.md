# Fable Model / Subscription Routing

This doc records the model and subscription inventory available to the `~/agents` workspace, the current OMP model-role mapping, and the desired routing policy for Anthropic Fable sessions. It distinguishes observed state from intended policy and names the gaps.

---

## Subscriptions and model IDs

| Provider | Subscription / tier | Model ID | Where it appears | Current role / usage |
|---|---|---|---|---|
| OpenAI | Codex 20x Max | `openai-codex/gpt-5.5` | Global `modelRoles` | `default`, `complex`, `plan`, `slow` |
| Anthropic | Max 20x | `anthropic/claude-opus-4-6` | Global `modelRoles` | `designer` |
| Anthropic | Fable (scarce high-level) | `anthropic/fable-*` (expected) | Not yet in `modelRoles` | Intended for main Fable advisor/orchestrator sessions only |
| Kimi | Kimi for Coding | `kimi-code/kimi-for-coding` | Global `modelRoles` + subagent `jimeng-kimi-worker` | `smol`, `task`, `implementer`, `research`, `authenticated_web`, `maintenance` |
| Google / Antigravity | Gemini 3.5 Flash low | `google-antigravity/gemini-3.5-flash-low` | Subagent `jimeng-gemini-worker` only | Cheap bounded worker for non-core Jimeng/Dreamina slices |
| DeepSeek | DeepSeek V4 Pro | `deepseek/deepseek-v4-pro` | Global `modelRoles` + subagent `prose-deepseek-v4-pro` | `advisor`; prose review / AI-tell diagnosis |
| Z.ai | GLM 5.2 | `zai/glm-5.2` | Subagent `prose-glm-5-2` only | Cross-check prose rewrites / detector diagnosis |
| Jimeng / Dreamina | Paid generative media account | N/A (browser proxy + direct API client) | `skills/provider/jimeng-browser-proxy`, `packages/jimeng-client` | UGC asset generation, image/video workflows |
| Kagi | Web search | N/A (search provider) | `.omp/config.yml` `providers.webSearch: kagi` | Web search backend for `web_search` / `fetch_content` |

### Notes on availability

- The global config does **not** contain a `providers:` block; OMP auto-discovers providers from credentials and local settings.
- The workspace `.omp/config.yml` explicitly pins `providers.webSearch: kagi`.
- `google-antigravity/gemini-3.5-flash-low` and `zai/glm-5.2` are **not** in global `modelRoles`; they are assigned only in subagent definitions under `.omp/agents/`.
- Jimeng/Dreamina does not appear as a model role; it is consumed through browser-proxy and direct-client tooling.

---

## Model strengths

| Model / lane | Strength | Use for | Do not use for |
|---|---|---|---|
| **Anthropic Fable** (main) | High-level synthesis, creative direction, taste, cross-workstream prioritization, orchestration design | Arthur-facing advisor sessions; choosing what to build and why; routing work to cheaper agents | Implementation plumbing, menial refactors, one-off file edits |
| **Claude Opus 4.6** | Design, deep frontend/UI reasoning, visual taste, complex component architecture | Design reviews, UI/UX architecture, component APIs, visual effects design | Cheap bounded worker tasks |
| **GPT-5.5 / Codex 20x Max** | Strong logic implementation, code reasoning, planning, fallback judgment | Complex implementers, plan agents, orchestrator fallback, integration reviews | Replacing Fable's high-level advisor role |
| **Kimi for Coding** | Cheap, fast, capable bounded worker | Narrow edits, searches, small refactors, Jimeng helper, maintenance tasks | High-stakes design decisions, Fable-orchestrator replacement |
| **Gemini 3.5 Flash (Antigravity)** | Cheapest bounded worker, good for dashboard polish, fixture promotion, packet review | Non-core Jimeng/Dreamina slices, low-risk edits, large-context summarization | Core architecture, provider-sensitive logic |
| **DeepSeek V4 Pro** | Deep advisor-style reasoning, adversarial critique, prose/AI-tell diagnosis | Oracle cross-check, adversarial review, writing-without-AI-tells critique | Default worker execution (overkill and slower) |
| **GLM 5.2** | Prose rewrite, detector diagnosis, second opinion on AI-tell triggers | Cross-check drafts, identify Pangram-style triggers | General implementation work |

---

## Exact observed OMP settings

### Global config (`/Users/arthur/.omp/agent/config.yml`)

Observed on 2026-07-03 with OMP 16.3.3 (`omp update --check` reports current):

```yaml
setupVersion: 1
modelRoles:
  default: openai-codex/gpt-5.5
  smol: kimi-code/kimi-for-coding
  task: kimi-code/kimi-for-coding
  implementer: kimi-code/kimi-for-coding
  research: kimi-code/kimi-for-coding
  authenticated_web: kimi-code/kimi-for-coding
  maintenance: kimi-code/kimi-for-coding
  complex: openai-codex/gpt-5.5
  advisor: deepseek/deepseek-v4-pro
  plan: openai-codex/gpt-5.5
  slow: openai-codex/gpt-5.5
  designer: anthropic/claude-opus-4-6
extensions:
  - /Users/arthur/agents/packages/web-access/src/index.ts
  - /Users/arthur/.omp/agent/extensions/cmux-omp-session.ts
skills:
  ignoredSkills:
    - computer-use
    - orca-cli
    - orchestration
retry:
  enabled: true
  modelFallback: true
  fallbackRevertPolicy: cooldown-expiry
  fallbackChains:
    task:
      - openai-codex/gpt-5.5
    implementer:
      - openai-codex/gpt-5.5
    maintenance:
      - openai-codex/gpt-5.5
browser:
  headless: true
hideThinkingBlock: true
doubleEscapeAction: tree
power:
  sleepPrevention: system
renderMermaid:
  enabled: true
inspect_image:
  enabled: true
task:
  eager: always
  enableLsp: true
  isolation:
    mode: auto
  showResolvedModelBadge: true
  maxRecursionDepth: -1
dev:
  autoqa:
    consent: granted
github:
  enabled: true
vault:
  enabled: true
theme:
  light: light-solarized
  dark: dark-dracula
colorBlindMode: true
display:
  showTokenUsage: true
images:
  blockImages: false
steeringMode: all
disabledProviders:
  - moonshot
advisor:
  enabled: true
  syncBacklog: "off"
  subagents: true
symbolPreset: nerd
statusLine:
  preset: nerd
autolearn:
  enabled: false
compaction:
  enabled: true
  strategy: context-full
  thresholdPercent: -1
  thresholdTokens: -1
  remoteEnabled: true
  keepRecentTokens: 20000
  reserveTokens: 16384
  autoContinue: true
```

### Workspace overlay (`~/agents/.omp/config.yml`)

```yaml
task:
  isolation:
    mode: apfs
  softRequestBudget: 40
providers:
  webSearch: kagi
```

### Subagent model assignments (`.omp/agents/*.md`)

| Subagent | Model | Purpose |
|---|---|---|
| `jimeng-kimi-worker` | `kimi-code/kimi-for-coding` | Bounded Jimeng/Dreamina fallback worker |
| `jimeng-gemini-worker` | `google-antigravity/gemini-3.5-flash-low` | Cheap Jimeng/Dreamina implementation/polish worker |
| `prose-deepseek-v4-pro` | `deepseek/deepseek-v4-pro` | Prose rewrite / AI-tell diagnosis |
| `prose-glm-5-2` | `zai/glm-5.2` | Prose rewrite cross-check / detector diagnosis |

---

## Routing policy by session type

### Main Fable session

- **Model:** Anthropic Fable (when available) or the highest-level Anthropic slot.
- **Advisor:** `enabled: false`. Fable main should not carry a DeepSeek advisor. Fable is a distinct model creature with its own preferences and working style, not an extension of Arthur; its advisor/Primer policy reflects that separation.
- **Role:** High-level advisor, orchestrator, taste keeper, prioritizer.
- **Allowed work:** Synthesis, architecture decisions, product direction, delegation design, cross-workstream review.
- **Forbidden work:** Menial edits, implementation plumbing, spawning Fable subagents.
- **Context source:** Curated docs (`docs/fable/`, `docs/state/`, `docs/plans/`), `docs/fable/session-index.md`, and the homey system. **Do not rely on OMP autolearn** for Fable prep; it is currently not trusted.

### Subagent workers

- **Default implementer lane:** Kimi for Coding (`kimi-code/kimi-for-coding`).
- **Cheap / high-volume lane:** Gemini 3.5 Flash Low (`google-antigravity/gemini-3.5-flash-low`).
- **Complex logic fallback:** GPT-5.5 (`openai-codex/gpt-5.5`).
- **Design-heavy lane:** Claude Opus 4.6 (`anthropic/claude-opus-4-6`).
- **Advisor-assisted lane:** DeepSeek V4 Pro (`deepseek/deepseek-v4-pro`) when the task explicitly benefits from adversarial/oracle/prose review.

### Routing rules

1. **Fable → never spawn Fable.** If a task looks like it needs "another Fable", route it to GPT-5.5 or a specialized subagent instead.
2. **Fable → delegate execution.** Fable should describe the goal and hand it to a cheaper worker. Fable should not write hundreds of lines of implementation code unless the task is genuinely high-level architecture.
3. **Subagents can be full agents.** Give them explicit goals, bounded `maxRecursionDepth`, and the right tool set. Do not force every subagent into a single-turn worker mold.
4. **Keep DeepSeek advisor for subagents and non-Fable workers when useful.** Prose review, oracle, and adversarial critique subagents should keep it; ordinary Kimi/Gemini workers should not pay the advisor tax.
5. **Use curated context, not autolearn.** Workers receive the docs/session-index/homey context the parent provides; they do not independently mine the session corpus.

---

## `--config` overlay approach

Goal: keep `/Users/arthur/.omp/agent/config.yml` untouched, but run Fable with a different advisor/model setting than the rest of the workspace.

OMP supports config overlays via `--config <path>` (confirm exact flag with `omp --help`). A local overlay file can override only the keys that differ from the global config.

### Proposed Fable overlay (`.omp/fable-config.yml`)

```yaml
# Proposed overlay for a Fable-only session.
# Not yet created or verified; merge semantics need a test run.
modelRoles:
  default: anthropic/fable-main        # or the actual Fable model ID once provisioned
  smol: kimi-code/kimi-for-coding
  task: kimi-code/kimi-for-coding
  implementer: kimi-code/kimi-for-coding
  research: kimi-code/kimi-for-coding
  authenticated_web: kimi-code/kimi-for-coding
  maintenance: kimi-code/kimi-for-coding
  complex: openai-codex/gpt-5.5
  plan: openai-codex/gpt-5.5
  slow: openai-codex/gpt-5.5
  designer: anthropic/claude-opus-4-6
  advisor: deepseek/deepseek-v4-pro
advisor:
  enabled: false
  subagents: true
task:
  maxRecursionDepth: 8
  softRequestBudget: 40
providers:
  webSearch: kagi
```

### How to use it

```bash
# Example invocation; verify the exact flag before relying on it.
omp --config ./.omp/fable-config.yml
```

If `--config` is not supported in this form, the alternative is to keep the overlay as a documented recipe and apply it by starting the session from a wrapper script or by setting the relevant model roles explicitly in the prompt.

---

## Implementation gaps / current guardrails

1. **No Fable model role in global config.** The global `modelRoles` map has no dedicated Fable slot; add it only after the actual model ID is provisioned, preferably through a Fable-specific overlay.
2. **No clean per-session advisor split.** OMP supports `--config <path>` overlays, but `advisor.enabled` and `advisor.subagents` remain session-global once merged. Desired policy is clear: Fable main advisor off; non-Fable subagent advisor available when useful.
3. **Anti-Fable subagent guard is implemented.** `oh-my-pi/packages/coding-agent/src/config/model-resolver.ts` prevents resolved subagent models containing `fable` from running and falls back to non-Fable task/smol/slow lanes when possible.
4. **Autolearn disabled and not trusted.** `autolearn.enabled: false` in the global config; even if enabled, Fable should not rely on it. Curated docs and the session index are the source of truth.
5. **Overlay still needs one smoke test when Fable exists.** The exact Fable model ID is unknown, so the proposed overlay remains a recipe rather than a runnable committed profile.

---

## Related docs

- [`docs/fable/harness-slimming.md`](./harness-slimming.md) — skill manifest slimming and advisor/model routing notes
- [`docs/fable/preferences.md`](./preferences.md) — Fable working style and taste
- [`docs/fable/context.md`](./context.md) — workstream priorities and routing boundaries
- [`docs/fable/session-index.md`](./session-index.md) — curated session corpus and source docs

# OMP/Fable harness slimming

This is a **default slim profile** for the root `pi.skills` manifest. It trims noisy, overly specific, or security-adjacent skills from the default load so that Anthropic Fable starts with a broad, high-agency advisor/orchestrator context. Nothing here is a permanent ban — these are defaults, and any skill can be restored for a specific session or workstream.

## Kept skills

| Skill path | Reason bucket |
|---|---|
| `./skills/browser/background-browser-automation` | Browser control |
| `./skills/browser/browser-control` | Browser control |
| `./vendor/badlogic/pi-skills/browser-tools` | Browser tools |
| `./skills/browser/cmux-browser-drive` | Browser control |
| `./skills/browser/cua-driver` | CuaDriver / native macOS control |
| `./vendor/badlogic/pi-skills/gccli` | Google Workspace CLI |
| `./vendor/badlogic/pi-skills/gdcli` | Google Workspace CLI |
| `./vendor/badlogic/pi-skills/gmcli` | Google Workspace CLI |
| `./skills/provider/jimeng-browser-proxy` | Jimeng UGC / provider workflows |
| `./skills/core/librarian` | Research / library lookup |
| `./skills/browser/llm-frontend-browser` | LLM frontend browser access |
| `./skills/core/oracle` | Cross-check / advisory review |
| `./skills/core/proof-of-work-qa` | Proof-of-work QA artifacts |
| `./skills/media/remotion` | Remotion / video generation |
| `./skills/core/rubber-duck-adversarial` | Adversarial critique / sanity checks |
| `./skills/core/source-archive` | Source archive / reference capture |
| `./vendor/badlogic/pi-skills/transcribe` | Transcribe / audio-to-text |
| `./skills/provider/twitter-x-context` | Twitter / X context |
| `./vendor/badlogic/pi-skills/youtube-transcript` | YouTube transcript extraction |
| `./packages/borges-library/skills/borges-library` | Book / creative reference library |

## Removed skills

These were removed from the default profile but remain available on disk. If a workstream needs one, add it back as described below.

| Skill path | Removal bucket |
|---|---|
| `./vendor/vercel/agent-skills/vercel-composition-patterns` | Vercel design guardrails |
| `./vendor/vercel/agent-skills/vercel-react-best-practices` | Vercel design guardrails |
| `./vendor/vercel/agent-skills/vercel-react-view-transitions` | Vercel design guardrails |
| `./vendor/vercel/agent-skills/web-design-guidelines` | Vercel design guardrails |
| `./vendor/zanwei/design-dna` | Design DNA |
| `./vendor/alipay/payment-skills/alipay-aipay-product-intro` | Payment / Alipay |
| `./vendor/alipay/payment-skills/alipay-authenticate-wallet` | Payment / Alipay |
| `./vendor/alipay/payment-skills/alipay-pay-for-402-service` | Payment / Alipay |
| `./vendor/alipay/payment-skills/alipay-pay-for-service` | Payment / Alipay |
| `./vendor/alipay/payment-skills/alipay-payment-feedback` | Payment / Alipay |
| `./vendor/wechatpay-apiv3/wechatpay-skills/wechatpay-payment-integration` | Payment / WeChatPay |
| `./vendor/wechatpay-apiv3/wechatpay-skills/wechatpay-product-coupon` | Payment / WeChatPay |
| `./vendor/stablyai/orca/computer-use` | Orca vendor |
| `./vendor/stablyai/orca/linear-tickets` | Orca vendor |
| `./vendor/stablyai/orca/orca-cli` | Orca vendor |
| `./vendor/stablyai/orca/orca-emulator` | Orca vendor |
| `./vendor/stablyai/orca/orca-linear` | Orca vendor |
| `./vendor/stablyai/orca/orchestration` | Orca vendor |
| `./skills/research/reverse-engineering` | Reverse engineering |
| `./skills/research/used-hardware-buying-research` | Used hardware |
| `./vendor/badlogic/pi-skills/vscode` | VSCode |
| `./skills/research/emusks-research` | One-off research |
| `./skills/design/impeccable-design-review` | Design review |

## 3. Advisor & model routing slimming

The skill manifest above is only one half of the default harness. The other half is who (and what) runs when Fable or its subagents start. The current global config and the desired Fable config are not the same; this section records the gap.

### Current state (observed)

From `/Users/arthur/.omp/agent/config.yml`:

```yaml
advisor:
  enabled: true
  subagents: true

modelRoles:
  advisor: deepseek/deepseek-v4-pro
```

From this workspace's `.omp/config.yml`:

```yaml
task:
  isolation:
    mode: apfs
  softRequestBudget: 40
providers:
  webSearch: kagi
```

And from the global `task` block:

```yaml
task:
  maxRecursionDepth: -1
  eager: always
```

Net effect today:
- Every main session gets a `deepseek/deepseek-v4-pro` advisor by default.
- Every subagent also gets that advisor (because `advisor.subagents: true`).
- Recursion depth is unbounded (`-1`).
- Web search is pinned to Kagi.
- Task budget is soft-capped at 40 requests.

### Desired policy

- **Main Fable session** should have **no advisor**. Fable is a distinct model creature with its own preferences and working style, not an extension of Arthur; its advisor/Primer policy reflects that separation. Fable is the high-level advisor/orchestrator; adding another advisor layer on top is expensive and redundant.
- **Subagents and non-Fable workers** may keep the DeepSeek advisor when the work benefits from it (e.g., prose review, oracle cross-check, adversarial critique). It should not be on by default for every bounded worker.
- **Fable must never spawn a Fable subagent**. Fable is the scarce high-level model; worker execution should be delegated to cheaper/capable lanes: Kimi, Gemini Flash, Antigravity, or GPT-5.5.
- **Subagents can be full agents** when the task warrants it: they may have explicit goals, bounded recursion, and appropriate model/tool sets. They are not required to be minimal one-shot workers.
- **OMP autolearn is currently not trusted** for Fable preparation. Fable should rely on curated docs (`docs/fable/`), the session index, and the homey system instead of hoping autolearn will surface the right context.

### Implementation gaps / current guardrails

1. **No clean per-session advisor toggle.** OMP supports `--config <path>` overlays, but `advisor.enabled` and `advisor.subagents` are still global settings within a running session. Verify overlay merge behavior before relying on "main Fable advisor off, subagent advisor on" as an operational split.
2. **Fable-subagent guard is now hardcoded in OMP.** `oh-my-pi/packages/coding-agent/src/config/model-resolver.ts` blocks resolved subagent models whose selector contains `fable` and falls back to non-Fable `pi/task`, `pi/smol`, or `pi/slow` lanes. Main sessions can still run Fable.
3. **No Fable-specific model-role overlay is committed.** The global `modelRoles` map is shared; create a local overlay only after the exact Fable model ID is known.

### Desired `--config` overlay (illustrative)

The global config at `/Users/arthur/.omp/agent/config.yml` should stay untouched. A Fable session can be launched with a local overlay that turns off the advisor and rebinds task/implementer to cheaper lanes:

```yaml
# .omp/fable-config.yml (proposed, not yet created)
modelRoles:
  default: openai-codex/gpt-5.5
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
```

Note: the exact `--config` path and merge semantics have not been verified against OMP 16.3.3; confirm with `omp --help` or a test session before relying on this overlay.

## 4. How to restore a removed skill

1. Open `package.json`.
2. Add the skill's manifest path back to the `pi.skills` array.
3. Start a new OMP/Fable session so the updated manifest is loaded.

For example, to bring `vscode` back into the default profile:

```json
"pi": {
  "skills": [
    ...,
    "./vendor/badlogic/pi-skills/vscode"
  ]
}
```

This is a reversible default, not a blacklist. Skill directories are still on disk; only the manifest entry is removed.

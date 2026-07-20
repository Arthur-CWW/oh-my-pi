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
| `./skills/core/librarian` | Research / library lookup |
| `./skills/browser/llm-frontend-browser` | LLM frontend browser access |
| `./skills/core/oracle` | Cross-check / advisory review |
| `./skills/core/proof-of-work-qa` | Proof-of-work QA artifacts |
| `./skills/core/rubber-duck-adversarial` | Adversarial critique / sanity checks |
| `./skills/core/source-archive` | Source archive / reference capture |
| `./vendor/badlogic/pi-skills/transcribe` | Transcribe / audio-to-text |
| `./vendor/badlogic/pi-skills/youtube-transcript` | YouTube transcript extraction |
| `./packages/stema/skills/stema` | Book / creative reference library |

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
| `./skills/research/reveng` | Reverse engineering |
| `./skills/research/used-hardware-buying-research` | Used hardware |
| `./vendor/badlogic/pi-skills/vscode` | VSCode |
| `./skills/research/emusks-research` | One-off research |

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
- **DeepSeek should be minimal.** Use it only for explicit advisor/oracle/prose/adversarial passes; prefer coding subscriptions and frontend sessions for normal work.
- **Fable must never spawn a Fable subagent**. Fable is the scarce high-level model; mutable worker execution uses `task` packets with a specialist role, owned/excluded files, and a least-privilege tool allowlist. Role→model assignments live in `.omp/fable-config.yml` (read it; not restated here). Use `explore` for read-only local scouting and `librarian` for external or API research.
- **Subagents can be full agents** when the task warrants it: they may have explicit goals, bounded recursion, and an optional supported model/effort override. They are not required to be minimal one-shot workers.
- **OMP autolearn is currently not trusted** for Fable preparation. Fable should rely on curated docs (`docs/fable/`), the session index, and the homey system instead of hoping autolearn will surface the right context.

### Implementation gaps / current guardrails

1. **No true per-agent advisor split yet.** The committed `.omp/fable-config.yml` disables advisor for the whole Fable session (`advisor.enabled: false`, `advisor.subagents: false`). If Arthur later wants non-Fable workers to carry an advisor while main Fable does not, OMP needs a cleaner per-agent advisor policy.
2. **Fable-subagent guard is now hardcoded in OMP.** `vendor/oh-my-pi/packages/coding-agent/src/config/model-resolver.ts` blocks resolved subagent models whose selector contains `fable` and falls back to non-Fable `pi/task`, `pi/smol`, or `pi/slow` lanes. Main sessions can still run Fable.
3. **The committed overlay is the active routing source.** Launch Fable with the local overlay; the overlay file itself is the only authority on which lane each role resolves to.

### Committed `--config` overlay

The global config at `/Users/arthur/.omp/agent/config.yml` stays untouched. A Fable session can be launched with the committed overlay:

```bash
omp --config ./.omp/fable-config.yml
```

The overlay disables the advisor/autolearn, binds worker roles to non-Fable lanes, keeps Kagi search, and sets Sol high as the main-session default.

## 3b. Global-dir + managed-skills archive pass (2026-07-03)

The manifest slim above was only one of several discovery sources; sessions still loaded ~64 skills. Applied a reversible archive pass across the leaking sources (moves only, restore = `mv` back):

| Source | Archived to | Moved |
|---|---|---|
| `~/.omp/agent/skills/` (30 entries) | `~/.omp/agent/skills-archive/` | agent-communication, emusks-research, godmode, impeccable-design-review, lawful-reveng, used-hardware-buying-research, vscode |
| `~/.claude/skills/` (6 entries) | `~/.claude/skills-archive/` | all six (cua-driver, design-dna, vercel-composition-patterns, vercel-react-best-practices, vercel-react-view-transitions, web-design-guidelines) — all redundant with repo copies |
| `~/.agents/skills/` (12 entries) | `~/.agents/skills-archive/` | computer-use, cua-driver, design-dna, orca-cli, orchestration, vercel-*, web-design-guidelines (9); kept codex-system, find-skills, reflect |
| `~/.omp/agent/managed-skills/` (25 autolearn-generated) | `~/.omp/agent/managed-skills-archive/` | archive-noisy-mcp-server, cmux-workstream-orchestration, hanly-playcover-permissive-patch, mobile-app-protocol-reveng, omp-print-prompt-file-runner, omp-slack-agent-server, proxmark3-macos-debug, symphony-elixir-otp-spike, tailscale-ssh-auth-browser, telegram-cloud-archive, vim-lite-parity-debugging, voiceink-permission-ux, vphone-cli-safe-amfi, vphone-mcp-vendoring, vphone-red-blue-lab, zig-cache-cleanup (16); kept 9 durable ones (arthur-*, writing-without-ai-tells, ai-companion-rtc-testbed, audio-diarization-pipeline, browser-context-sync, sideline-annotation-card, wrapped-commentary-learning-card-db, agent-skill-vendoring) |

Notes: `managed-skills/` is autolearn's store — autolearn is disabled but its generated skills still load, so this dir needs a re-check whenever autolearn is ever re-enabled. Remaining known duplication: ~23 entries in `~/.omp/agent/skills/` overlap the repo manifest for `~/agents` sessions (deduped by name at load, but they also serve non-agents workspaces — left in place deliberately).

## Stream-local skill split (2026-07-03)

Stream-specific skills now live beside the stream that owns them. Global `pi.skills` keeps cross-stream tools only; stream sessions opt into local skills through `skills.customDirectories` in a `--config` overlay.

| Stream | Old path | New path |
|---|---|---|
| playground | `skills/provider/jimeng-browser-proxy` | `streams/playground/skills/jimeng-browser-proxy` |
| playground | `skills/media/remotion` | `streams/playground/skills/remotion` |
| playground | `skills/design/impeccable-design-review` | `streams/playground/skills/impeccable-design-review` |
| primer | `skills/provider/twitter-x-context` | `streams/primer/skills/twitter-x-context` |
| primer | `~/.omp/agent/managed-skills/browser-context-sync` | `streams/primer/skills/browser-context-sync` |
| primer | `~/.omp/agent/managed-skills/sideline-annotation-card` | `streams/primer/skills/sideline-annotation-card` |
| primer | `~/.omp/agent/managed-skills/wrapped-commentary-learning-card-db` | `streams/primer/skills/wrapped-commentary-learning-card-db` |
| primer | `~/.omp/agent/managed-skills/audio-diarization-pipeline` | `streams/primer/skills/audio-diarization-pipeline` |
| companion | `~/.omp/agent/managed-skills/ai-companion-rtc-testbed` | `streams/companion/skills/ai-companion-rtc-testbed` |
| harness | `skills/core/spec-driven-overlays` | `streams/harness/skills/spec-driven-overlays` |
| harness | `~/.omp/agent/skills/hermes-omp-bridge` | `streams/harness/skills/hermes-omp-bridge` |
| harness | `~/.omp/agent/skills/hermes-skill-porting` | `streams/harness/skills/hermes-skill-porting` |
| harness | `~/.omp/agent/managed-skills/agent-skill-vendoring` | `streams/harness/skills/agent-skill-vendoring` |
| attic | `skills/research/emusks-research` | `skills-attic/research/emusks-research` |
| attic | `skills/research/reveng` | `skills-attic/research/reveng` |
| attic | `skills/research/used-hardware-buying-research` | `skills-attic/research/used-hardware-buying-research` |

Config mechanism: OMP exposes `skills.customDirectories` as an array setting, passes explicit `--config` overlays into `Settings.init`, merges those overlays after global/project config, and scans each custom directory as a `custom:user` skill source. Arrays replace rather than concatenate during merge, so each overlay enumerates every custom directory it needs: `.omp/fable-config.yml` lists harness skills, and `.omp/{companion,playground,primer}-config.yml` list both harness and stream-local skills.

Restore steps:

1. Move the directory back from its `streams/<stream>/skills/` or `skills-attic/research/` path to the old path above.
2. If the skill should be global again, add its path back to `package.json` `pi.skills`; otherwise keep it out of `pi.skills` and load it through the relevant `.omp/<stream>-config.yml`.
3. For home-origin skills, move the directory back to `~/.omp/agent/skills/` or `~/.omp/agent/managed-skills/` if it must be global outside this repo.

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

## 5. Primitive overlap matrix (2026-07-16)

Doctrine: **strong composable primitives should be mostly non-overlapping; plugins are reserved for capabilities a builtin cannot reach.**

| Surface | Provenance | Verdict | Reason |
|---|---|---|---|
| URL fetch | OMP builtin `read` URL pipeline (`vendor/oh-my-pi/packages/coding-agent/src/tools/fetch.ts`); web-access `fetch_content` extension (`packages/web-access/src/index.ts`); outer-harness `mcp__fetch_fetch` | **Keep `read`; scope `fetch_content`; retire `mcp-server-fetch`** | `read` already handles HTTP(S), readable content, binary dispatch, and selectors. Keep the extension only where its multi-URL/fallback extraction reaches beyond direct `read`; the redundant fetch MCP surface is not an OMP primitive. |
| Headless browser automation | OMP builtin `browser` (`vendor/oh-my-pi/packages/coding-agent/src/tools/browser.ts`) and its CDP/tab supervisor | **Keep** | Owns scripted Chromium/CDP pages, element observation, interaction, and tab reuse; it does not pretend to be native desktop control. |
| CUA browser/computer-use bridge | `node_repl` MCP discovered from Codex compatibility config (`/Users/arthur/.codex/config.toml:186-194`), plus `skills/browser/cua-driver` | **Keep, opt-in** | This is the native macOS/browser-computer bridge. It reaches app/window/input capabilities that headless CDP cannot, so it is complementary rather than a second page automation API. OMP consults Codex-compatible config.toml only when `mcp.codexCompat: true`; fresh sessions do not auto-adopt it. |
| In-app cmux browser CLI | OMP browser cmux backend and `skills/browser/cmux-browser-drive` | **Keep, scoped to cmux** | The in-app WebView/socket surface has cmux tab and lifecycle semantics; use it for cmux-owned pages, not as a general replacement for headless browser automation. |
| JS execution (eval js vs node_repl) | OMP builtin `eval` JS backend (`vendor/oh-my-pi/packages/coding-agent/src/tools/eval.ts`); external `node_repl` MCP | **Keep both, separate scopes** | `eval` is the bounded, persistent session-cell runtime. `node_repl` is the bridge needed for CUA/browser-side Node modules and native integrations; neither should grow into the other's role. |
| Python execution | OMP builtin `eval` Python backend (`vendor/oh-my-pi/packages/coding-agent/src/eval/py/`) | **Keep** | One session-owned Python execution primitive covers persistent cells and structured output; adding another Python MCP runner would duplicate lifecycle and cleanup ownership. |
| Screenshot/image inspect | OMP builtin `inspect_image` (`vendor/oh-my-pi/packages/coding-agent/src/tools/inspect-image.ts`) | **Keep** | Image inspection is a focused vision handoff, distinct from browser screenshots and from code execution; it should remain opt-in and image-specific. |

The fetch removal audit found no `mcp-server-fetch` registration in OMP's project/user `mcp.json`, `.mcp.json`, Codex-compatible discovery, dotfiles, or cmux settings. The live `mcp__fetch_fetch` name is supplied by the outer coding harness rather than OMP, so there is no OMP/dotfiles/cmux removal diff or cmux reload step to perform. A fresh isolated OMP-session regression asserts that no `mcp__fetch_fetch` or fetch-named MCP tool is discovered; builtin `read` URL behavior remains covered by its URL/binary regression tests.

HR-149 update: the CUA bridge verdict is **Keep, opt-in**. OMP consults Codex-compatible `config.toml` only when `mcp.codexCompat: true`; explicit project `.mcp/mcp.json` remains active regardless.

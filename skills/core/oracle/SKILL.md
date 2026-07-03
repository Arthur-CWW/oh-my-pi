---
name: oracle
description: "Oracle second-model review: bundle prompts and files for an external advisory pass. Use for debugging, refactor/design cross-checks, and high-stakes review when an outside model perspective is worth the cost."
---

# Oracle (Steipete/Steinberger)

Oracle bundles a prompt + selected files into one request and sends it to an external model (API or browser automation). In this repo it is an **advisory runner**, not a replacement for OMP subagents or the existing browser ChatGPT driver.

## When to use

- **Second-model review**: you already have an OMP subagent plan/answer and want an external sanity check.
- **Debugging**: you are stuck on a subtle bug and want a fresh model to inspect the exact files.
- **Refactor / design cross-check**: large structural change where a second opinion reduces risk.
- **Prompt + file bundling**: you need to ship context to ChatGPT Pro/GPT-5.5 Pro cleanly.

Default to OMP subagents and normal repo tools. Use Oracle only when an external model review is clearly worth the time/cost.

## Important: do not replace the existing ChatGPT driver

This repo already has browser-ChatGPT workflows (OMP subagents, `llm-frontend-browser`, `browser-control`, etc.). Oracle does **not** replace them. Use Oracle as:

- an advisory bundler for one-shot external review, or
- a fallback when the fastest path is to assemble files + prompt for ChatGPT Pro.

For normal repo work — edits, refactors, tests, multi-file implementation — prefer OMP subagents.

## Defaults

- Engine: `browser` (`--engine browser`)
- Model: `gpt-5.5-pro`
- Invocation: `npx -y @steipete/oracle`
- Always preview first: `--dry-run summary` (and `--files-report` when unsure)
- Keep file sets tight; exclude tests/fixtures/generated artifacts with `!`
- Fallback when automation is blocked: `--render --copy`

## Golden path

1. Choose the smallest file set that still contains the truth.
2. Preview what will be sent:
   ```bash
   npx -y @steipete/oracle --dry-run summary -p "<task>" --file "src/**" --file "!**/*.test.*"
   ```
3. If token counts look wrong, inspect per-file usage:
   ```bash
   npx -y @steipete/oracle --dry-run summary --files-report -p "<task>" --file "src/**"
   ```
4. Run in browser mode with GPT-5.5 Pro:
   ```bash
   npx -y @steipete/oracle --engine browser --model gpt-5.5-pro -p "<task>" --file "src/**"
   ```
5. If the run detaches, reattach — do not start a duplicate run.

## Commands

### Help
```bash
npx -y @steipete/oracle --help
```

### Preview (no tokens spent)
```bash
npx -y @steipete/oracle --dry-run summary -p "Review the state machine in src/core" --file "src/core/**"
npx -y @steipete/oracle --dry-run summary --files-report -p "Debug the failing boundary test" --file "src/**" --file "!**/*.test.*"
```

### Browser run (preferred)
```bash
npx -y @steipete/oracle --engine browser --model gpt-5.5-pro \
  -p "Review this refactor for race conditions" \
  --file "src/engine.ts" --file "src/scheduler.ts"
```

### Manual paste fallback
```bash
npx -y @steipete/oracle --render --copy -p "<task>" --file "src/**"
```

## Browser mode setup and session recovery

### First-time login
Run once to create Oracle's private automation profile and log into ChatGPT:

```bash
npx -y @steipete/oracle --engine browser --browser-manual-login \
  --browser-keep-browser --browser-input-timeout 120000 \
  -p "HI"
```

### Subsequent runs
Use the saved profile:

```bash
npx -y @steipete/oracle --engine browser --browser-manual-login \
  --browser-auto-reattach-delay 5s \
  --browser-auto-reattach-interval 3s \
  --browser-auto-reattach-timeout 60s \
  -p "<task>" --file "src/**"
```

### Reattach / recover a session
```bash
npx -y @steipete/oracle status --hours 72
npx -y @steipete/oracle session <id> --render
```

## API mode rule

API mode costs real money. **Require explicit user approval before running an API invocation.** Do not auto-run API mode just because `OPENAI_API_KEY` happens to be set.

If the user approves API mode, prefer pre-flight checks first:

```bash
npx -y @steipete/oracle doctor --providers --models gpt-5.5-pro
npx -y @steipete/oracle --preflight --model gpt-5.5-pro
```

## Attaching files

- Include: `--file "src/**"`, `--file src/index.ts`, `--file docs --file README.md`
- Exclude: `--file "src/**" --file "!src/**/*.test.ts" --file "!**/*.snap"`
- Default-ignored: `node_modules`, `dist`, `coverage`, `.git`, `.turbo`, `.next`, `build`, `tmp`
- Glob expansion honors `.gitignore`.
- Files > 1 MB are rejected unless `ORACLE_MAX_FILE_SIZE_BYTES` is raised.

## OMP operating rules

- **No secrets**: do not attach `.env`, key files, tokens, or auth cookies unless explicitly required and redacted.
- **Prefer file args**: pass real repo paths via `--file`/`@path` style arguments instead of pasting large code blocks into the prompt.
- **Advisory only**: treat Oracle's output as a second opinion, not authority. Verify claims with repo tools, tests, and your own reasoning.
- **Verify with tools/tests**: after applying any Oracle suggestion, run the relevant tests or a smoke check before declaring it done.
- **Stop for human verification**: if browser mode hits a login, CAPTCHA, payment, account, or permission dialog, stop and ask the user to complete it.

## Prompt template

Oracle has zero project knowledge. Include:

1. Project briefing: stack, build/test commands, platform constraints.
2. Where things live: key directories, entrypoints, config files, dependency boundaries.
3. Exact question + what you tried + verbatim error text.
4. Constraints ("keep public API", "don't change X", perf budget, etc.).
5. Desired output format (patch plan, tests, risky assumptions, options with tradeoffs).

## References

- Upstream skill: `https://raw.githubusercontent.com/steipete/oracle/main/skills/oracle/SKILL.md`
- Upstream repo: `https://github.com/steipete/oracle`

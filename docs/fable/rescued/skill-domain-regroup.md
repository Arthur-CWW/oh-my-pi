> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-06-22T02-26-51-811Z_019eed26-ed22-7000-9996-63de9ee63627/local/skill-domain-regroup.md

# Goal
Regroup passive skills so the repo is not a flat top-level skill dump and vendored/imported skill repos are clearly separated.

# Target layout
- `skills/core/`: agent-communication, librarian, oracle, proof-of-work-qa, rubber-duck-adversarial, source-archive
- `skills/browser/`: background-browser-automation, browser-control, cmux-browser-drive, cua-driver, llm-frontend-browser
- `skills/provider/`: jimeng-browser-proxy, twitter-x-context
- `skills/research/`: emusks-research, lawful-reverse-engineering, used-hardware-buying-research
- `skills/design/`: impeccable-design-review
- `skills/media/`: remotion
- `vendor/badlogic/pi-skills/`: brave-search, browser-tools, gccli, gdcli, gmcli, transcribe, vscode, youtube-transcript, plus the current `skills/pi-skills` metadata files
- `vendor/chrome-devtools-mcp/`: stays vendored and not auto-loaded

# OMP discovery
OMP scans one level deep only, so `skills.customDirectories` must list each immediate parent:
- `/Users/arthur/agents/skills/core`
- `/Users/arthur/agents/skills/browser`
- `/Users/arthur/agents/skills/provider`
- `/Users/arthur/agents/skills/research`
- `/Users/arthur/agents/skills/design`
- `/Users/arthur/agents/skills/media`
- `/Users/arthur/agents/vendor/badlogic/pi-skills`

# Pi CLI compatibility
Root `package.json` `pi.skills` must list every concrete skill directory explicitly with its new path. Keep `./packages/borges-library/skills/borges-library` unchanged.

# Constraints
Do not rename `packages/web-access`. Preserve SKILL.md frontmatter names. Do not auto-load `vendor/chrome-devtools-mcp` skills in this pass.

# Changelog

## 0.11.0 — Radical Simplification

### Removed
- **packages/legacy-web-access** (~11,500 lines) — legacy reference code
- **packages/kagi** (~2,600 lines) — folded inline into `src/kagi.ts`
- **src/effect/** (25 files) — collapsed to flat `src/` (10 files)
- GitHub clone tool (agent uses `gh` CLI directly)
- YouTube frame extraction, local video analysis
- PDF extraction (Gemini handles)
- RSC extraction, event store, TUI rendering
- Perplexity provider

### Changed
- **Effect v4** (beta.71) from npm
- **moduleResolution: bundler** — no `.js` import extensions
- Kagi: Firefox cookies.sqlite (direct read, no puppeteer needed)
- Kagi: `X-Kagi-Authorization` header matching official extension
- Store: JSON file instead of SQLite (cross-runtime)
- Pi packages: `@earendil-works/pi-*` namespace

### Added
- `youtube_transcript` tool (yt-dlp metadata + VTT captions)
- JSON file KV store with TTL expiration
- Cross-platform tests (macOS + Ubuntu verified)
- Vendored Kagi Chrome extension for auth protocol tracking
- 27 tests across 4 test files
- `/godmode` command — LLM jailbreaking toolkit (Parseltongue obfuscation, ULTRAPLINIAN multi-model racing, GODMODE CLASSIC templates, auto-jailbreak)
- OMP skill at `~/.omp/agent/skills/godmode/` with scripts, templates, and references
- Python scripts ported from G0DM0D3/L1B3RT4S (AGPL-3.0) by elder-plinius

## 0.10.3

Previous stable release with legacy Effect implementation.

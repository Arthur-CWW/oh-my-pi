# OMP Kagi browser-session smoke — 2026-06-15

## Claim

OMP Kagi search now mirrors the `packages/web-access/src/kagi.ts` path: it ignores OMP Kagi API credentials, reuses the signed-in browser subscription session, and calls `https://kagi.com/socket/search` with `X-Kagi-Authorization`.

## Historical changed path

- Original repo-local patch: `patches/@oh-my-pi%2Fpi-coding-agent@15.12.3.patch`
- Runtime config: `.omp/config.yml` sets `providers.webSearch: kagi`.
- 2026-06-16 update: OMP 16.0.1 includes browser-session Kagi search upstream. Repo-local patch files, runtime rebuild script, and `/Users/arthur/.local/bin/omp` launch-time update guard were removed.

## Proof commands

```bash
bun scripts/smoke-omp-kagi-browser-session.ts
OMP_DISABLE_MCP=1 /Users/arthur/.local/bin/omp q --provider kagi --compact "typescript release"
```

## Observed output

```json
{
  "browserSessionOnly": true,
  "query": "typescript release",
  "sources": 3,
  "hasAnswer": true,
  "firstHost": "github.com"
}
```

The original proof calls `searchWithKagi(query, { limit: 3 })` without `AuthStorage`; the provider had no Kagi API endpoint or bearer API-key path left. Search flow: `~/.pi/pi-web-access/kagi-session.json` or Firefox/Chrome cookie capture → `X-Kagi-Authorization` → `https://kagi.com/socket/search`.

## Former auto-patch proof

This section is historical. The auto-patch mechanism was removed on 2026-06-16 because OMP 16.0.1 includes the Kagi browser-session implementation upstream.

Observed:

```txt
omp/15.12.4
⌕ Web Search: Kagi 10 sources
Query: typescript release
Answer: 28 relevant results in <0.20s. All results from external indexes.
First source: Releases · microsoft/TypeScript (github.com)
Provider: Kagi
```

## Caveats

- `bun run check:types` inside `node_modules/@oh-my-pi/pi-coding-agent` could not run because the published package does not include `tsgo` in this install.
- CLI proof uses `OMP_DISABLE_MCP=1` to keep the check scoped to web search instead of waiting on unrelated MCP startup.

# Usage Stats QA Report — 2026-07-10

## Slice A — `stats` CLI and SQL VIEWs

### Files changed

| File | Change |
|------|--------|
| `src/migrate.ts` | Added `migration0004Sql` (3 VIEWs), bumped `LEDGER_SCHEMA_VERSION` to 4, added migration step |
| `src/stats.ts` | New — `queryUsageByLaneHour`, `queryUsageByAgent`, `queryUsageBySession` with `StatsFilters` |
| `src/cli.ts` | Added `stats lanes`, `stats agents`, `stats sessions` subcommands with `--since`/`--json`/`--db` |
| `src/index.ts` | Exports for stats types, `migration0004Sql` |
| `test/stats.test.ts` | 5 tests covering view existence, aggregation math, tokensPerMinute, `--since` filter |
| `test/attribution.test.ts` | `readUserVersion` assertions updated from 3 to 4 (lines 48, 83) |

### SQL VIEWs (migration 0004)

- **`usage_by_lane_hour`** — `GROUP BY provider||'/'||model, (ts/3600000)*3600000`; columns: lane, hourBucket, calls, tokensIn, tokensOut, cacheRead, cost, avgLatencyMs, tokensPerMinute = (sum tokens)/60.0
- **`usage_by_agent`** — `GROUP BY agent, lane`; adds firstTs/lastTs, tokensPerMinute = totalTokens * 60000 / span_ms (0 if single call)
- **`usage_by_session`** — `GROUP BY session, lane ORDER BY MAX(ts) DESC`; same aggregates as agent view, newest-first

### Test names

1. `migration version is 4`
2. `views exist in sqlite_master`
3. `usage_by_lane_hour aggregates correctly`
4. `usage_by_agent aggregates with tokensPerMinute over active span`
5. `usage_by_session newest first with correct aggregates`
6. `--since filter excludes earlier data`

### `bun test` output

> Parent: run `cd packages/control-plane && bun test` and paste output here.

### CLI examples

> Parent: run these against a real or test db and paste output:
>
> ```sh
> cd packages/control-plane
> bun src/cli.ts stats lanes --db test/.tmp/stats/stats-fixture.sqlite
> bun src/cli.ts stats agents --db test/.tmp/stats/stats-fixture.sqlite --json
> bun src/cli.ts stats sessions --db test/.tmp/stats/stats-fixture.sqlite
> ```

---

## Slice B — Anthropic 5h-window burn analysis

Analysis window: last ~8 hours ending 2026-07-10T01:48 UTC.
Source: `~/.omp/agent/sessions/-agents/` JSONL files (69 files, assistant messages with `claude*` model).

### Totals

| Metric | Value |
|--------|-------|
| Fresh input tokens | 49,715 |
| Output tokens | 3,087,676 |
| Cache-read tokens | 271,968,999 |
| Cache-write tokens | 10,450,333 |
| Total calls | 1,985 |
| Overall cache-read ratio | 100.0% |

### By model

| Model | Input | Output | CacheRead | CacheWrite | Calls | CR% |
|-------|-------|--------|-----------|------------|-------|-----|
| claude-opus-4-8 | 23,539 | 2,656,969 | 161,377,121 | 7,913,474 | 1,398 | 100.0% |
| claude-fable-5 | 22,438 | 401,724 | 108,781,061 | 2,439,019 | 560 | 100.0% |
| claude-opus-4-6 | 3,738 | 28,983 | 1,810,817 | 97,840 | 27 | 99.8% |

### By session

| Session | Type | Agents | Input | Output | CacheRead | CacheWrite | Calls |
|---------|------|--------|-------|--------|-----------|------------|-------|
| `019f4958` (Jul 10 00:06) | Reading-room / annotation | 55 | 35,311 | 2,852,122 | 193,451,319 | 8,704,333 | 1,638 |
| `019f39e0` (Jul 7 00:00) | Agents — Opus/designer + this subagent | 2 | 6,912 | 204,386 | 75,232,823 | 1,429,084 | 313 |
| `019f494d` (Jul 9 23:53) | Fable session | 1 | 7,492 | 31,168 | 3,284,857 | 316,916 | 34 |

### Top consumers (by input+cacheRead, top 15)

| Agent | Model | Input | Output | CacheRead | CacheWrite | Calls | CR% |
|-------|-------|-------|--------|-----------|------------|-------|-----|
| Main (agents session) | claude-fable-5 | 3,174 | 175,403 | 73,422,006 | 1,331,244 | 286 | 100.0% |
| ReaderMultiBook | claude-opus-4-8 | 3,062 | 168,303 | 29,121,110 | 330,527 | 128 | 100.0% |
| Main (reading-room) | claude-fable-5 | 6,643 | 100,101 | 26,751,407 | 520,384 | 146 | 100.0% |
| AnnoHanFeizi2 | claude-opus-4-8 | 120 | 122,259 | 9,080,171 | 260,149 | 60 | 100.0% |
| AccelElectorSurvivor | claude-opus-4-8 | 112 | 97,436 | 8,005,684 | 275,841 | 57 | 100.0% |
| AccelNightfall | claude-opus-4-8 | 108 | 114,486 | 7,732,393 | 262,872 | 55 | 100.0% |
| AnnoJungB | claude-opus-4-8 | 108 | 103,005 | 7,584,750 | 252,485 | 55 | 100.0% |
| AnnoJungA | claude-opus-4-8 | 94 | 75,201 | 5,956,732 | 206,200 | 48 | 100.0% |
| ReviewView | claude-opus-4-8 | 5,287 | 73,472 | 5,411,574 | 190,900 | 43 | 99.9% |
| ScanView | claude-opus-4-8 | 4,763 | 54,876 | 5,285,340 | 158,718 | 49 | 99.9% |
| NietzscheThirdEssayA | claude-opus-4-8 | 60 | 125,534 | 5,138,190 | 256,083 | 31 | 100.0% |
| MeltdownDeep | claude-opus-4-8 | 76 | 81,416 | 4,817,203 | 202,818 | 39 | 100.0% |
| LibraryShelf | claude-opus-4-8 | 1,722 | 52,241 | 4,332,884 | 148,622 | 40 | 100.0% |
| AnnoAnalects2 | claude-opus-4-8 | 68 | 72,139 | 4,315,052 | 200,534 | 35 | 100.0% |
| BookIrBuilder | claude-opus-4-8 | 86 | 51,164 | 4,104,842 | 380,096 | 44 | 100.0% |

### Verdict (3 sentences)

The 5h Anthropic window was consumed overwhelmingly by the reading-room annotation session (`019f4958`, 1,638 calls across 55 subagents), which alone accounts for ~71% of cache-read and ~92% of output tokens — each of the annotation workers (AnnoHanFeizi2, AnnoJungA/B/C, AnnoXunzi2, AnnoGenealogy, AccelNightfall, etc.) running ~25-60 Opus-4-8 calls with substantial output generation. Cache-read ratios are excellent (99.8-100.0% across the board), meaning prompt caching is working properly and fresh-input is negligible (50K total vs 272M cached) — the drain is driven by sheer output volume (3.1M tokens) and call count, not cache misses. The agents-session (`019f39e0`) with this designer/Opus subagent work is a secondary consumer (313 calls, mostly fable-5 cache-reads), while a short fable session (`019f494d`, 34 calls) is trivial.

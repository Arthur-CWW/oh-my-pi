# Throughput Stats QA

## DDL landed

Migration v5 adds nullable throughput columns and recreates all usage views:

```sql
ALTER TABLE model_calls ADD COLUMN ttftMs INTEGER;
ALTER TABLE model_calls ADD COLUMN reasoningTokens INTEGER;

DROP VIEW IF EXISTS usage_by_lane_hour;
DROP VIEW IF EXISTS usage_by_agent;
DROP VIEW IF EXISTS usage_by_session;

CREATE VIEW usage_by_lane_hour AS
SELECT
  provider || '/' || model AS lane,
  (ts / 3600000) * 3600000 AS hourBucket,
  COUNT(*) AS calls,
  SUM(tokensIn) AS tokensIn,
  SUM(tokensOut) AS tokensOut,
  SUM(cacheRead) AS cacheRead,
  SUM(cost) AS cost,
  CAST(ROUND(AVG(latencyMs)) AS INTEGER) AS avgLatencyMs,
  ROUND((SUM(tokensIn) + SUM(tokensOut)) / 60.0, 2) AS tokensPerMinute,
  ROUND(SUM(tokensOut) / NULLIF(SUM(latencyMs) / 1000.0, 0), 2) AS tokensPerSecond,
  CAST(ROUND(AVG(ttftMs)) AS INTEGER) AS avgTtftMs,
  SUM(COALESCE(reasoningTokens, 0)) AS reasoningTokens
FROM model_calls
GROUP BY lane, hourBucket;

CREATE VIEW usage_by_agent AS
SELECT
  agent,
  provider || '/' || model AS lane,
  COUNT(*) AS calls,
  SUM(tokensIn) AS tokensIn,
  SUM(tokensOut) AS tokensOut,
  SUM(cacheRead) AS cacheRead,
  SUM(cost) AS cost,
  CAST(ROUND(AVG(latencyMs)) AS INTEGER) AS avgLatencyMs,
  MIN(ts) AS firstTs,
  MAX(ts) AS lastTs,
  CASE
    WHEN MAX(ts) = MIN(ts) THEN 0.0
    ELSE ROUND((SUM(tokensIn) + SUM(tokensOut)) * 60000.0 / (MAX(ts) - MIN(ts)), 2)
  END AS tokensPerMinute,
  ROUND(SUM(tokensOut) / NULLIF(SUM(latencyMs) / 1000.0, 0), 2) AS tokensPerSecond,
  CAST(ROUND(AVG(ttftMs)) AS INTEGER) AS avgTtftMs,
  SUM(COALESCE(reasoningTokens, 0)) AS reasoningTokens
FROM model_calls
GROUP BY agent, lane;

CREATE VIEW usage_by_session AS
SELECT
  session,
  provider || '/' || model AS lane,
  COUNT(*) AS calls,
  SUM(tokensIn) AS tokensIn,
  SUM(tokensOut) AS tokensOut,
  SUM(cacheRead) AS cacheRead,
  SUM(cost) AS cost,
  CAST(ROUND(AVG(latencyMs)) AS INTEGER) AS avgLatencyMs,
  MIN(ts) AS firstTs,
  MAX(ts) AS lastTs,
  CASE
    WHEN MAX(ts) = MIN(ts) THEN 0.0
    ELSE ROUND((SUM(tokensIn) + SUM(tokensOut)) * 60000.0 / (MAX(ts) - MIN(ts)), 2)
  END AS tokensPerMinute,
  ROUND(SUM(tokensOut) / NULLIF(SUM(latencyMs) / 1000.0, 0), 2) AS tokensPerSecond,
  CAST(ROUND(AVG(ttftMs)) AS INTEGER) AS avgTtftMs,
  SUM(COALESCE(reasoningTokens, 0)) AS reasoningTokens
FROM model_calls
GROUP BY session, lane
ORDER BY MAX(ts) DESC;

PRAGMA user_version = 5;
```

## CLI sample output

Observed command:

```sh
cd packages/control-plane && bun src/cli.ts stats lanes --db :memory:
```

Observed output:

```text
lane  hourBucket  calls  tokensIn  tokensOut  cacheRead  cost  avgLatencyMs  tokensPerMinute  tokensPerSecond  avgTtftMs  reasoningTokens
----  ----------  -----  --------  ---------  ---------  ----  ------------  ---------------  ---------------  ---------  ---------------
```

## Tests added or updated

- `test/stats.test.ts` — `migration version is 5`
- `test/stats.test.ts` — `usage_by_lane_hour aggregates correctly` now asserts `tokensPerSecond`, `avgTtftMs`, and `reasoningTokens`.
- `test/stats.test.ts` — `usage_by_agent aggregates with tokensPerMinute over active span` now asserts throughput columns.
- `test/stats.test.ts` — `usage_by_session newest first with correct aggregates` now asserts throughput columns.
- `test/stats.test.ts` — `v4 ledger upgrades throughput columns in place`
- `test/ingest.test.ts` — `ingest stores live model call throughput fields`
- `test/cli.test.ts` — `cli stats output includes throughput columns`
- `test/attribution.test.ts` — user_version assertions updated from 4 to 5.

## Run output

Observed full command:

```sh
cd packages/control-plane && bun test
```

Observed result: failed before exercising assertions because the available command sandbox cannot write under `packages/control-plane/test/.tmp` or system temp. First failure excerpt:

```text
bun test v1.3.14 (0d9b296a)

test/ingest.test.ts:
19 |   rmSync(tmpDir, { recursive: true, force: true })
       ^
error: EFAULT: bad address in system call argument, rm '/Users/arthur/agents/packages/control-plane/test/.tmp'
```

Additional observed sandbox write failures included `EPERM: operation not permitted, mkdir '/Users/arthur/agents/packages/control-plane/test/.tmp/stats'` and `EPERM: operation not permitted, mkdir '/var/folders/87/p8v45fj16jsfngtm_kwdch9r0000gn/T/probe-1783651218588'`.

Observed in-memory verification command passed:

```sh
cd packages/control-plane && bun --eval '<in-memory migration/stats check>'
```

Observed output:

```json
{"version":5,"row":{"tokensPerSecond":150,"avgTtftMs":100,"reasoningTokens":7}}
```

Observed in-memory ledger insert verification passed:

```json
{"ttftMs":12,"reasoningTokens":3}
```

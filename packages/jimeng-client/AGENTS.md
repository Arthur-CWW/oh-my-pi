# packages/jimeng-client

Jimeng/Dreamina API helpers for UGC generation workflows. Arthur may dictate it as "Gming" — that's `J-I-M-E-N-G`.

## Build

```bash
bun run jimeng:test   # from repo root
```

## Rules

- **Spend gate.** Dry-run default. Live/paid/mutating runs need Arthur's explicit approval with exact commands and artifact paths logged.
- **Concurrency 1.** Never parallelize generation calls.
- **Stop on risk-control.** `1019` / "shark not pass" errors = stop immediately, report.
- Value-first: prioritize the highest-value workflows before speed or cost optimization.

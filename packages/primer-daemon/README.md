# Primer Daemon

`@wirebabel/primer-daemon` is the local query path for primer work: it searches read-only browser-context, twitter-archive, and wrapped-reader substrates, ranks the evidence, and writes only to a small primer ledger for notes and card candidates.

## Substrates and paths

Defaults are resolved from the repo root unless noted:

- Browser context: `~/state/browser-context/browser_context.sqlite`
  - Override: `PRIMER_BROWSER_DB=/path/to/browser_context.sqlite`
- Twitter archive: `data/twitter-archive/twitter-archive.sqlite`
  - Override: `PRIMER_TWITTER_DB=/path/to/twitter-archive.sqlite`
- Wrapped commentary reader: `streams/primer/wrapped-commentary-reader/site/meltdown-annotations.sqlite`
  - Override: `PRIMER_READER_DB=/path/to/meltdown-annotations.sqlite`
- Writable ledger: `data/primer/daemon-ledger.sqlite`
  - Override: `PRIMER_LEDGER_DB=/path/to/daemon-ledger.sqlite`

The three substrates are always opened read-only. Missing substrate DBs are skipped with a notice and exit 0. The ledger is the only writable database; it is created on first use with parent directories as needed.

## Commands

Search terms across all substrates:

```sh
bun packages/primer-daemon/src/cli.ts search matuschak --limit 5
```

Rerun line:

```sh
bun packages/primer-daemon/src/cli.ts search matuschak --limit 5
```

Limit search to one substrate and emit machine-readable evidence hits:

```sh
bun packages/primer-daemon/src/cli.ts search nick land --source reader --limit 10 --json
```

Build a deterministic markdown evidence pack from a question:

```sh
bun packages/primer-daemon/src/cli.ts ask "what have I been reading about nick land?" --limit 8
```

Rerun line:

```sh
bun packages/primer-daemon/src/cli.ts ask "what have I been reading about nick land?"
```

Show recent browser activity and captured tweets:

```sh
bun packages/primer-daemon/src/cli.ts recent --days 2 --limit 25
```

Write and read the ledger:

```sh
bun packages/primer-daemon/src/cli.ts note add --question "What matters?" --body "A short note." --source "browser:events:206004|https://x.com/andy_matuschak|Andy Matuschak"
bun packages/primer-daemon/src/cli.ts note list --limit 5
bun packages/primer-daemon/src/cli.ts card add --front "What is the source?" --back "A provenance-linked evidence hit." --source-ref browser:events:206004
bun packages/primer-daemon/src/cli.ts card list --json
```

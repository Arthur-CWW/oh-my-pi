> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-03T10-25-44-711Z_019f2783-4f07-7000-ac94-347ad8de223d/local/primer-daemon-contract.md

# primer-daemon shared contract

## Package

`packages/primer-daemon` — "the daemon answers": query path over three read-only substrates + one writable ledger.

Dependencies (package.json, model on packages/borges-library/package.json):
- name: `@wirebabel/primer-daemon`, private, type module, exports `.` -> `./src/index.ts`
- deps: `effect@^4.0.0-beta.71`
- devDeps: `bun-types@^1.3.9`, `typescript@^5.9.3`
- scripts: `typecheck: tsc --noEmit`, `test: bun test`
- tsconfig: copy `packages/borges-library/tsconfig.json` verbatim (bundler resolution — NO .js import extensions)

## Substrate paths (src/paths.ts, owned by WorkerCore)

```ts
export interface DaemonPaths {
  browserDb: string  // env PRIMER_BROWSER_DB, default os.homedir() + "/state/browser-context/browser_context.sqlite"
  twitterDb: string  // env PRIMER_TWITTER_DB, default resolve("data/twitter-archive/twitter-archive.sqlite")
  readerDb: string   // env PRIMER_READER_DB, default resolve("streams/primer/wrapped-commentary-reader/site/meltdown-annotations.sqlite")
  ledgerDb: string   // env PRIMER_LEDGER_DB, default resolve("data/primer/daemon-ledger.sqlite")
}
export function resolveDaemonPaths(env?: Record<string, string | undefined>): DaemonPaths
```

## Access invariants

- Substrate DBs: `new Database(path, { readonly: true })` (bun:sqlite; proven to work on the WAL browser DB). NEVER open substrate DBs writable. NEVER write to browser_context.sqlite.
- Ledger DB is the ONLY writable DB. Created on first open (mkdir parent, CREATE TABLE IF NOT EXISTS).
- A missing substrate DB must degrade gracefully: skip that substrate, note it in output, exit 0.

## EvidenceHit (src/schema.ts, owned by WorkerCore)

```ts
import { Schema } from "effect"  // effect v4: check actual import path, likely "effect/Schema" or "effect/schema" — verify against borges-library/src/schemas.ts usage

EvidenceHit = {
  source: "browser" | "twitter" | "reader"
  kind: string        // "tab_entry" | "event" | "tweet" | "annotation" | "source_block" | "concept"
  ref: string         // stable provenance ref, e.g. "browser:tab_entries:123", "twitter:tweets:2056...", "reader:annotations:54"
  url: string | null
  title: string
  snippet: string | null   // <=240 chars matched-context window
  timestamp: string | null // ISO 8601; browser epoch-ms converted
  score: number
}
```

All rows read from SQLite MUST be decoded through Effect Schema before leaving the substrate module (repo rule: schema at boundaries, no untyped DB rows). No `any`/`unknown` outside decode boundaries — repo lint gates on this.

## Search semantics

- `searchBrowser(db, terms, opts)` — LIKE over tab_entries.url/title UNION events(url,title) for event_type IN (tab_updated, tab_activated); dedupe by url keeping newest last_accessed/observed_at; every term must match (AND across terms, each term against url OR title).
- `searchTwitter(db, terms)` — match on json_extract(data_json, '$.text') plus username; snippet = window around first term hit in text.
- `searchReader(db, terms)` — annotations(title, note, tags), source_blocks(text), concepts(title, short_note, long_note). snippet from matched column.
- Terms are lowercased; LIKE with wildcards both sides, case-insensitive (SQLite LIKE is case-insensitive ASCII — acceptable).
- Ranking (src/rank.ts): score = 2*(title term hits) + 1*(url/snippet term hits) + recency boost (+2 if timestamp within 7 days of now, +1 within 30). Merge substrates, sort desc, default cap 30 (`--limit`).

## Ledger (src/ledger.ts + src/ledger-cli.ts, owned by WorkerLedger)

Tables (CREATE TABLE IF NOT EXISTS on open):
```sql
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS note_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  ref TEXT NOT NULL,           -- EvidenceHit.ref
  url TEXT,
  title TEXT
);
CREATE TABLE IF NOT EXISTS card_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  source_ref TEXT,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

API (exact exported names — WorkerCore imports these):
```ts
export interface NoteInput { question: string; body: string; sources: Array<{ ref: string; url?: string; title?: string }> }
export interface CardInput { front: string; back: string; sourceRef?: string; url?: string }
export function openLedger(path: string): Database          // creates parent dir + tables
export function addNote(db: Database, input: NoteInput): { id: number }
export function listNotes(db: Database, limit?: number): NoteRow[]   // NoteRow includes sources
export function addCard(db: Database, input: CardInput): { id: number }
export function listCards(db: Database, limit?: number): CardRow[]
```

src/ledger-cli.ts (exact exported names — WorkerCore imports these):
```ts
export function runNoteCommand(argv: string[], paths: DaemonPaths): Promise<number>  // "add" | "list"
export function runCardCommand(argv: string[], paths: DaemonPaths): Promise<number>  // "add" | "list"
```
Arg style: `note add --question "..." --body "..." --source ref[|url[|title]] (repeatable)`; `card add --front "..." --back "..." --source-ref ... --url ...`; `note list [--limit N]`, `card list [--limit N]`, `--json` on list commands.

## CLI (src/cli.ts, owned by WorkerCore)

Hand-rolled argv dispatch with USAGE string (repo precedent: packages/ugc-cli/src/cli.ts, packages/jimeng-client/src/cli.ts — NOT @effect/cli, it is not effect-v4 compatible).

Commands:
- `search <term> [term...] [--limit N] [--source browser|twitter|reader] [--json]` — merged ranked EvidenceHits; human output: one line per hit `[source/kind] title — url (timestamp) ref`, plus snippet indented.
- `ask "<question>" [--limit N] [--json]` — extract terms (lowercase, strip stopwords + punctuation, keep tokens len>=3, quoted phrases kept whole), run search, print an EVIDENCE PACK: markdown, grouped by substrate, every hit with ref + url + timestamp; footer line with rerun command. This is agent-feedstock, not an LLM call — deterministic.
- `recent [--days N=2] [--limit N=25] [--json]` — newest browser activity (events tab_updated/tab_activated dedupe by url) + newest tweets captured; provenance same as search.
- `note ...` / `card ...` — delegate to runNoteCommand/runCardCommand.
- exit 2 + USAGE on unknown command/flags.

## Tests (test/ dir, bun test, NO mocks)

Fixtures: build tiny real SQLite DBs in temp dirs inside tests using the exact CREATE TABLE statements from the substrate schema reference below; insert 3-6 rows each. Test behavior:
- browser search: AND-across-terms, url dedupe keeps newest, epoch-ms -> ISO conversion
- twitter search: matches text inside data_json, snippet windowing
- reader search: hits across annotations/source_blocks/concepts
- rank: cross-substrate merge ordering, recency boost, limit
- ask term extraction: stopwords stripped, phrases kept
- ledger: openLedger idempotent, addNote round-trip with sources, addCard/listCards, missing parent dir created
- graceful degradation: nonexistent substrate path -> substrate skipped, no throw
Do NOT test against the real 3.5GB browser DB in unit tests. Do NOT assert on default paths or USAGE text.

## Non-goals

- No FTS index build, no embeddings, no LLM calls, no review UI, no mochi export yet.
- No edits outside packages/primer-daemon/ (root package.json wiring is the coordinator's).
- Skip repo-wide gates: no `bun run check`, no lint, no formatter. Coordinator gates.

> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-03T10-25-44-711Z_019f2783-4f07-7000-ac94-347ad8de223d/local/primer-dashboard-contract.md

# primer-dashboard shared contract

Extends packages/primer-daemon (existing, green: typecheck clean, 19 tests). Existing exports stay stable unless named below. Repo rules: Effect Schema at boundaries, no any/unknown, bundler resolution (no .js extensions), bun:sqlite, no external runtime deps, no build step.

## Module seams (exact exported names)

### src/evidence.ts (WorkerEvidence creates; extracted from cli.ts)
```ts
export interface EvidenceSet { hits: EvidenceHit[]; skipped: string[] }
export function searchEvidence(paths: DaemonPaths, terms: readonly string[], source: EvidenceSource | undefined, limit: number): EvidenceSet
export function askEvidence(paths: DaemonPaths, terms: readonly string[], limit: number): EvidenceSet   // OR retrieval + coverage rank (moved as-is from cli.ts)
export function recentEvidence(paths: DaemonPaths, days: number, limit: number): EvidenceSet
```
cli.ts imports these; behavior unchanged (existing tests must stay green).

### src/ledger.ts additions (WorkerEvidence)
```ts
export type CardStatus = "candidate" | "approved" | "rejected"
export function setCardStatus(db: Database, id: number, status: CardStatus): CardRow | null  // null when id unknown
export interface ProgressInput { kind: string; title: string; body?: string; refs?: string[] }
export function addProgress(db: Database, input: ProgressInput): ProgressRow
export function listProgress(db: Database, limit?: number): ProgressRow[]  // newest first, default 100
```
New table (CREATE TABLE IF NOT EXISTS in openLedger):
```sql
CREATE TABLE IF NOT EXISTS progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,            -- milestone | commit | note | proof | info
  title TEXT NOT NULL,
  body TEXT,
  refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```
ProgressRow: { id: number; kind: string; title: string; body: string | null; refs: string[]; createdAt: string } — decoded via Effect Schema like NoteRow/CardRow.

### src/dashboard-page.ts (WorkerPage creates)
```ts
export function renderDashboardPage(): string   // complete HTML document, inline CSS+JS, zero external requests
```

### src/dashboard.ts (WorkerDash creates)
```ts
export interface DashboardOptions { port: number; paths: DaemonPaths }
export function startDashboard(options: DashboardOptions): ReturnType<typeof Bun.serve>
// main: honors process.env.PORT (portless injects it), fallback 4177; resolveDaemonPaths(process.env)
```

## HTTP API (JSON; same-origin; no CORS handling needed)

| Method+Path | Request | Response |
|---|---|---|
| GET / | — | HTML from renderDashboardPage() |
| GET /api/status | — | { generatedAt: string, substrates: [{ name: "browser"|"twitter"|"reader", path: string, exists: boolean, mtime: string|null }], ledger: { path: string, notes: number, cards: number, progress: number } } |
| POST /api/ask | { question: string, limit?: number } | { question, terms: string[], hits: EvidenceHit[], skipped: string[] } (terms via extractTerms) |
| GET /api/notes?limit=50 | — | NoteRow[] |
| GET /api/cards?limit=100 | — | CardRow[] (all statuses) |
| POST /api/cards/status | { id: number, status: "approved"|"rejected"|"candidate" } | updated CardRow, or 404 {error} |
| GET /api/progress?limit=100 | — | ProgressRow[] |
| POST /api/progress | { kind, title, body?, refs? } | created ProgressRow |
| GET /api/proofs | — | [{ name: string, title: string, mtime: string }] from docs/qa/*.md (repo-root-relative; title = first `# ` line) |
| GET /api/proofs/<name> | — | { name, markdown } (name allowlist: must match a listed file; never path-join user input directly) |
Errors: 400 malformed body, 404 unknown route/id, JSON {error: string}. Request bodies decoded with Effect Schema.

## Page requirements (WorkerPage)

Single dark, dense, laptop-first page — the dæmon's face. Panels:
1. **Ask the dæmon** — input + Ask button → POST /api/ask → evidence pack: hits grouped by substrate, each with title (linked to url when present), ref chip, timestamp, snippet. Show extracted terms + skipped substrates.
2. **Card candidates** — GET /api/cards; each card: front/back, source link, status chip, Approve/Reject buttons → POST /api/cards/status → optimistic UI update. Approved/rejected shown muted in their own groups.
3. **Progress feed** — GET /api/progress, reverse-chron timeline (kind chip, title, body, refs, relative time). Poll every 3s so the page reflects live work.
4. **Notes** — GET /api/notes; question, body, sources with links.
5. **Proofs** — GET /api/proofs list; clicking loads /api/proofs/<name> and renders markdown client-side with a small built-in renderer (headings, bold/italic, inline code, code fences, links, lists — hand-rolled, ~40 lines, no CDN).
6. **Status strip** — substrate freshness from /api/status.
All fetch logic vanilla JS inline; no framework, no external fonts/CDN; keyboard: Enter submits ask. Polling: progress+cards every 3s, status every 30s.

## Non-goals
No SSE/websockets (poll), no auth, no mochi export, no writes to substrate DBs, no edits to root package.json (coordinator wires scripts), no screenshots/QA (coordinator verifies).

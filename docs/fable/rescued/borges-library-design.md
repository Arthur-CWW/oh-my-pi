> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-06-21T00-44-32-882Z_019ee7a2-e4f2-7000-b10c-4027db3388b6/local/borges-library-design.md

# Borges Library — Design Contract

## Goal
A single-source-of-truth Pi package that searches and downloads books from the extended library. User-facing name: **Borges Library**. Internal sources: Anna Archive + Library Genesis. The skill/tool copy never names the sources.

## Package layout
```
packages/borges-library/
  package.json
  tsconfig.json
  src/
    index.ts            # Pi extension entrypoint; registers tools
    schemas.ts          # Effect schemas for results/errors
    errors.ts           # Library error tagged union
    anna-archive.ts     # Anna Archive search + download client
    library-genesis.ts  # Library Genesis search + download client
    client.ts           # Unified search + download facade
  skills/borges-library/SKILL.md
  test/
    anna-archive.test.ts
    library-genesis.test.ts
    client.test.ts
```

## Naming
- Package: `@wirebabel/borges-library` (private)
- Pi tool names: `borges_library_search`, `borges_library_download`
- Skill name: `borges-library`
- User-facing label: "Borges Library"

## Schemas (`src/schemas.ts`)

```typescript
export const BookFormatSchema = Schema.Union(
  Schema.Literal("pdf"),
  Schema.Literal("epub"),
  Schema.Literal("mobi"),
  Schema.Literal("azw3"),
  Schema.Literal("djvu"),
  Schema.Literal("txt"),
  Schema.Literal("unknown"),
)

export const BookResultSchema = Schema.Struct({
  id: NonEmptyString,
  title: NonEmptyString,
  authors: Schema.Array(NonEmptyString),
  year: Schema.optional(Schema.Number),
  language: OptionalNonEmptyString,
  format: BookFormatSchema,
  size: OptionalNonEmptyString,
  source: NonEmptyString,      // internal provenance only ("anna_archive" | "library_genesis")
  sourceUrl: NonEmptyString,
})

export const DownloadResultSchema = Schema.Struct({
  id: NonEmptyString,
  title: NonEmptyString,
  downloadedPath: NonEmptyString,
  bytes: Schema.Number,
  format: BookFormatSchema,
})
```

## Client API contract

```typescript
// src/anna-archive.ts
export function searchAnnaArchive(
  query: string,
  options?: { limit?: number; baseUrl?: string }
): Effect.Effect<BookResult[], BorgesLibraryError>

export function downloadAnnaArchive(
  result: BookResult,
  options?: { outDir?: string; baseUrl?: string }
): Effect.Effect<DownloadResult, BorgesLibraryError>

// src/library-genesis.ts
export function searchLibraryGenesis(
  query: string,
  options?: { limit?: number; baseUrl?: string }
): Effect.Effect<BookResult[], BorgesLibraryError>

export function downloadLibraryGenesis(
  result: BookResult,
  options?: { outDir?: string; baseUrl?: string }
): Effect.Effect<DownloadResult, BorgesLibraryError>

// src/client.ts
export interface SearchOptions {
  query: string
  limit?: number
  source?: "anna_archive" | "library_genesis" | "all"
}

export function searchBorgesLibrary(
  options: SearchOptions
): Effect.Effect<{ query: string; results: BookResult[] }, BorgesLibraryError>

export function downloadBorgesLibrary(
  result: BookResult,
  options?: { outDir?: string }
): Effect.Effect<DownloadResult, BorgesLibraryError>
```

## Pi tools (`src/index.ts`)

### `borges_library_search`
Parameters:
- `query`: string
- `limit?`: number (default 10)
- `source?`: `"anna" | "libgen" | "all"` (default `"all"`)

Returns text list of results with index numbers, plus `details.results` array.

### `borges_library_download`
Parameters:
- `id`: string (the `id` from a search result)
- `outDir?`: string (default `data/borges-library/downloads`)

Looks up the result in the tool's transient cache (or re-fetches if needed), downloads, returns path + size.

## Skill (`skills/borges-library/SKILL.md`)
- User-facing name: `borges-library`
- Description: Search and download books from the Borges Library.
- Never mention Anna Archive or Library Genesis.
- Workflow: search with `borges_library_search`, then download with `borges_library_download` by id.

## Root manifest changes
- `pi.extensions`: add `./packages/borges-library/src/index.ts`
- `pi.skills`: add `./packages/borges-library/skills/borges-library`
- `scripts`: add `borges-library:typecheck` and `borges-library:test`
- Add to aggregate `typecheck` and `test` scripts.

## Implementation notes
- Use `Effect.fn` for effectful functions.
- Use native `fetch` wrapped in `Effect.tryPromise`.
- HTML parsing: prefer simple regex/string extraction to avoid heavy deps; if needed, add `linkedom`.
- Download: follow redirects, stream to file, report bytes written.
- Tests: mocked HTTP fixtures for unit tests; keep one live smoke test optional/skipped by default.
- No rights policy integration; no provenance in user output.

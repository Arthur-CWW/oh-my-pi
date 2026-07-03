---
name: borges-library
description: Search and download books from the Borges Library. Use when the user asks to find a book, download a text, or search for creative/design references not already on their local shelf. Excels at retrieving full-text volumes for downstream processing.
---

# Borges Library

Search and download books from the Borges Library. Use the batch CLI for all operations — it handles searching, scoring, mirror discovery, and downloading in a single pass.

## Quick start

```bash
cat > /tmp/targets.json <<'EOF'
[{"query": "Book Title Author Name"}]
EOF
cd /Users/arthur/agents/packages/borges-library && bun run download:batch -- --input /tmp/targets.json --out-dir ./downloads --dry-run
```

Run `bun run download:batch -- --help` to see all options. To inspect the report, run the dry-run command and read the JSON printed to stdout. To actually download, run the same command without `--dry-run`.

## Full CLI usage

```
Borges Library batch downloader

Usage:
  bun ./download-batch.ts [options] [query ...]
  bun ./download-batch.ts --input targets.json --out-dir ./books --report report.json

Targets may be strings or objects in JSON:
  ["Nietzsche Daybreak Kaufmann", {"query":"The Gay Science","formats":["pdf"],"translators":["Kaufmann"]}]
  {"targets":[...], "preferences":{"formats":["pdf","epub"], "languages":["English"]}}

Options:
  --input, -i FILE          Read targets from JSON file
  --target, -t QUERY        Add one search target (repeatable)
  --out-dir, -o DIR         Output directory (default: ~/.borges-library/downloads)
  --report FILE            Write JSON report to FILE, or - for stdout (default: -)
  --dry-run                Search and score only; do not download
  --concurrency N          Parallel target count (default: 4)
  --max-results N          Search result limit per target (default: 25)
  --retries N              Retry search/download failures N times (default: 4)
  --target-timeout-ms N    Per-target timeout in milliseconds (default: 120000)
  --format LIST            Preferred formats, comma-separated (pdf,epub,mobi,djvu,txt)
  --translator LIST        Preferred translator keywords, comma-separated
  --author LIST            Preferred author keywords, comma-separated
  --language LIST          Preferred language keywords, comma-separated
  --keyword LIST           Extra preferred title/metadata keywords, comma-separated
  --discover-mirrors       Discover mirror candidates before searching (default: on)
  --no-discover-mirrors    Skip OpenSLUM mirror discovery
  --no-cache               Skip mirror cache; force fresh discovery
  --mirror-source URL      Status page (default: https://open-slum.org/)
  --mirror-group LIST      Discovery groups: anna,libgen (default: both)
  --base-url URL           Add an explicit mirror/base URL (repeatable)
  --base-url-list LIST     Add comma-separated explicit mirror/base URLs
  --skip-existing          Skip already-valid matching files (default)
  --no-skip-existing       Download even when a matching file exists
  --compact                Minify JSON report
  --help, -h               Show this help
```

## JSON target format

Targets are passed as a JSON array via `--input`. Each element can be a string query or an object with preferences.

**Simple string targets:**

```json
["Consider Phlebas Iain M Banks"]
```

**Object targets with per-book preferences:**

```json
[
  {
    "query": "Consider Phlebas",
    "formats": ["epub"],
    "author": "Iain M. Banks"
  }
]
```

**Direct URL targets for known public PDFs/EPUBs:**

```json
[
  {
    "query": "Paul Romer Endogenous Technological Change 1990",
    "url": "https://example.edu/paper.pdf",
    "formats": ["pdf"],
    "authors": ["Romer"],
    "languages": ["English"]
  }
]
```

Use `url` (or `sourceUrl` / `downloadUrl`) only when a reliable file URL is already known; the CLI still validates the downloaded bytes.

**Global preferences with the targets wrapper:**

```json
{
  "targets": [
    "Nietzsche Daybreak",
    {"query": "The Gay Science", "translators": ["Kaufmann"]}
  ],
  "preferences": {
    "formats": ["epub", "pdf"],
    "languages": ["English"]
  }
}
```

Per-target preferences override global ones. Supported preference keys: `formats`, `translators`, `authors`, `languages`, `keywords`, and optional direct file keys `url` / `sourceUrl` / `downloadUrl`.

## Workflow

Follow this 4-step pattern for every download batch:

1. **Write targets JSON to `/tmp/`.** Create a `/tmp/targets.json` file with the books to find.

2. **Dry-run with mirror discovery.** Run `--dry-run --discover-mirrors` to search and score candidates without downloading. This shows which editions would be selected and why.

3. **Review the report.** Examine the JSON report (printed to stdout by default). Confirm the selected candidates match expectations — check titles, authors, formats, and languages. If selections are wrong, refine target preferences and repeat step 2.

4. **Download.** Remove `--dry-run` and re-run the same command. The batch downloads selected files to `--out-dir`, skipping any that already exist and pass validation.

The CLI automatically keeps a cached OpenSLUM mirror list, appends public Internet Archive and arXiv sources, searches sources concurrently, and scores all returned candidates together. Use `--no-cache` only when refreshing the mirror cache is part of the task; otherwise keep the cache enabled for reliability.

## Batch report

The JSON report summarizes every target. Key fields:

- `summary.dry_run` — count of dry-run target selections
- `summary.ok` — count of successful downloads
- `summary.skipped_existing` — count of already-present valid files
- `summary.no_results` — count of targets with no usable candidate
- `summary.error` / `summary.blocked` — count of failed or blocked targets

Each result in `results[]` has:

- `status`: `"dry_run"`, `"ok"`, `"skipped_existing"`, `"no_results"`, `"error"`, or `"blocked"`
- `error`: error message on failure
- `selected`: the chosen candidate, including title, authors, format, language, source URL, score, and score reasons
- `download` / `downloadedPath`: downloaded file metadata or skipped-existing path
- `selectedSource`: mirror/source used for the chosen candidate

Use `--compact` for minified output, or `--report FILE` to write the report to a file instead of stdout.

## Chat guidelines

- Keep provenance abstract: say "Borges Library" or "the library"; do not name backend source sites.
- Do not use a browser, CDP, captcha-bypass, or interactive web lanes for this skill.
- Default download directory is `~/.borges-library/downloads/` unless `--out-dir` is given.
- Be explicit about not-found and edition-ambiguity outcomes; do not silently substitute a nearby work.

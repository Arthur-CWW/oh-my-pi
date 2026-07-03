# packages/twitter-archive

Local-first Twitter/X archive: schema, capture helpers, search.

## Rules

- **Respectful capture.** Low concurrency, jitter/backoff, disk cache, entity dedupe.
- **No private/locked content.** Public tweets only.
- **Inspect only main content.** Tweet column + search input; ignore sidebars, trends, DMs, navigation chrome.

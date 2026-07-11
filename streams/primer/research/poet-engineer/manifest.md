# Kat / The Poet Engineer — source archive manifest

## Scope and authority

This is a provenance-first, partial local archive of public material rendered for **Kat ⊷ the Poet Engineer, `@poetengineer__`** on 2026-07-11. Canonical X URLs in `cleaned/posts.md` are authoritative. The profile’s visible 5,479-post counter and the documented WKWebView pagination boundary mean this archive **must not be treated as a complete corpus**.

## Reading order

1. `coverage.json` — read first for boundaries, counts, hashes, recovery methods, and remaining gaps.
2. `cleaned/profile-and-links.md` — identity confirmation and source links.
3. `cleaned/posts.md` — chronological normalized source text, canonical status URLs, and recovered-media references.
4. `cleaned/videos.md` — recovered video index, dimensions, visual/OCR observations, and transcript limitation.
5. `raw/media/public-recovery.json` — per-status canonical URL, extraction outcome, exact local file bytes, and SHA-256.
6. `raw/media/forensics.json`, `raw/media/forensic-observations.json`, and `raw/media/forensics/` — stream metadata, contact sheets, and only visually confirmed notes.
7. `raw/timeline-access-boundary.json` and `raw/timeline-boundary.png` — initial retrieval-method evidence and stopping state.

## Public-media recovery

A second bounded pass queried exactly the 32 known canonical X status URLs sequentially with public `yt-dlp`. It did not recrawl the timeline, export or use browser cookies, send auth headers, mutate account state, reconstruct streams, or pursue private, subscriber-locked, deleted, DRM, or access-controlled media. The pass recovered **12 MP4 files, 85,752,861 bytes**, from **10 of 10 indexed video posts** (two posts contained two videos). The local binaries are intentionally excluded by `raw/media/.gitignore`; their provenance, hashes, contact sheets, and observations remain in the archive.

Twenty-two known status URLs yielded no downloadable media. Image-only references remain unavailable through this bounded canonical-status path; the original capture also documented a `pbs.twimg.com` DNS-resolution failure. The exact outcome and failure for every known status is retained in `raw/media/public-recovery.json`, rather than generalized here.

## Use note

Read the source in context and preserve its provenance. Do not blindly copy visual motifs, typography, symbols, gestures, or interaction appearances from the captured posts; this archive is source evidence, not a design prescription.

## Retrieval method

Initial timeline capture used one authenticated cmux X WKWebView surface, sequentially, with low-rate scrolling and 2–5 second waits. It stopped after twelve no-progress bottom-scroll attempts. The subsequent public recovery pass was separate, bounded to the known canonical IDs above, and did not interact with the timeline or account state.

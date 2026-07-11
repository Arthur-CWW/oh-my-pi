# Nous Research promotional-media archive

## Scope and provenance

Authenticated public X session captured `@NousResearch` media view on 2026-07-11. The X view reported **438 photos & videos**. This archive contains the initial visible 34 status cards and all directly retrievable public media from that window: **21 video files** and **16 image originals**. Large originals are local-only under `raw/media/`; their hashes and source URLs are tracked in the cleaned corpus and `raw/media-index.json`.

## Recommended viewing order

1. `cleaned/profile-and-links.md` for identity and channel boundaries.
2. `cleaned/video-contact-sheet.jpg` alongside `cleaned/videos.md`, chronological order.
3. `cleaned/promotional-posts.md` with the original local image files.
4. `raw/media-index.json` for machine-readable checksums, dimensions, bytes, and paths.

Do **not** conflate campaign/product-specific art direction with a universal Nous visual style. This archive deliberately does not synthesize a taxonomy or recommendation.

## Capture method

X media-grid extraction in Arthur’s existing authenticated session; canonical status IDs/URLs deduped. Public media fetched sequentially with yt-dlp’s X extractor and direct public `pbs.twimg.com` originals, using 1.2–1.8 second jitter between video requests. No account mutation or access-control bypass.

## Known gaps

- Timeline exhaustion was not reached: browser automation ceased returning observable scroll state after the initial media window. The platform reports 438 assets; 34 visible cards were retained. This is the stop condition, not a completeness assertion.
- X grid exposed no alt text; all recorded image alt-text fields are empty.
- The X extractor downloaded video and linked-site media but does not export standalone photo post JSON; image-post exact copy/timestamp/status association must be recaptured individually in a future authenticated pass.
- No `GROQ_API_KEY` was configured, so no speech-to-text transcript was produced. `videos.md` marks this transparently; poster-frame notes are not substitutes for shot analysis.
- Some status URLs resolve to linked product pages; yt-dlp captured their embedded media where public/canonical, including one YouTube embed. This is recorded as linked-site media rather than a new canonical channel.

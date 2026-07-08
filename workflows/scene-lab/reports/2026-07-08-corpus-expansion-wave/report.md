---
title: Corpus expansion — pleometric 133, poetengineer 60, + friends
date: 2026-07-08
agent: Fable
status: shipped
---

## Arthur's list, downloaded

| Handle | Videos | Note |
|---|---|---|
| @pleometric | **82 → 133** (+51) | fresh 429 wall at page 17; range now Apr 4 – Jul 6. All labelable in LABEL now. |
| @poetengineer__ | 60 (new) | stopped at cap — more available, bump `--max-items` next window |
| @voooooogel | 3 (new) | image-first artist; 335 tweets already in twitter-archive DB |
| @SkyeSharkie | 0 | media timeline had no video/gif in first 10 pages — likely image account; verify manually |
| @abelian_soup | 57 | done 07-06 |

Contact sheets: sibling dirs `2026-07-08-<handle>-corpus/`.

## Text archives (theoryposters)

@repligate @lumpenspace @teortaxesTex @tenobrus @tszzl @xenocosmography → bounded nitter backfill into `data/twitter-archive/twitter-archive.sqlite` (separate worker, report follows).

## Rerun

```bash
bun scripts/pleometric-media-sync.boundary.ts --max-items 150 --max-pages 25                     # pleometric to cap
bun scripts/pleometric-media-sync.boundary.ts --handle poetengineer__ --max-items 150 --max-pages 25
```
## SkyeSharkie verification
- Page 1 of https://nitter.tiekoetter.com/SkyeSharkie/media contains 11 video/gif posts and 9 image posts (20 own posts total), so the timeline is video-heavy, not image-only.
- A rerun with more pages would find additional videos; the 0-video result is a scraping/selection bug, not a content gap.
- Recommendation: rerun the media sync after fixing the video-extraction filter.
- **Root cause:** `extractPrimaryVideoItems` splits the timeline on `<div class="timeline-item" data-username="${escapedLowerHandle}">` case-sensitively. For `@SkyeSharkie` the Nitter HTML keeps the original case in `data-username="SkyeSharkie"`, so the split produced zero chunks and zero videos. `@pleometric` uses an already-lowercase `data-username`, so it was unaffected.
- **Fix:** added the `i` flag to that split regex (`scripts/pleometric-media-sync.boundary.ts:436`); the handle-matching is now case-insensitive without changing the value-matching.
- **Rerun:** `bun scripts/pleometric-media-sync.boundary.ts --handle SkyeSharkie --max-items 60 --max-pages 10` → 60 items, 8 pages fetched, stop reason `max-items`, 60 MP4 files on disk. Contact sheet: `workflows/scene-lab/reports/2026-07-08-SkyeSharkie-corpus/SkyeSharkie-contact-sheet.png`.
- **Regression check:** `bun scripts/pleometric-media-sync.boundary.ts --handle pleometric --max-pages 1` → 0 new items, manifest still 133, stop reason `max-pages`; no-shrink and no-redownload invariants hold.

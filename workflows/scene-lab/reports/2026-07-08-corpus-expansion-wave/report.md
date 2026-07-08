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

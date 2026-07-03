title: Pleometric public media corpus
date: 2026-07-03
agent: PleometricCorpus
status: shipped

## Summary

Expanded the bounded public-media inspiration corpus for @pleometric into `data/inspiration/pleometric/`.

- Manifest: `data/inspiration/pleometric/manifest.json`
- Media: 35 public video/GIF MP4s, named `<tweetId>-<n>.mp4`
- Leads: `data/inspiration/pleometric/leads.json` with 2 graphics/visual leads from the first 200 public following rows
- Contact sheet: `pleometric-contact-sheet.png` refreshed from the expanded manifest, 24 sampled frames tiled 6x4
- Date range: Jun 9, 2026 · 6:12 PM UTC through Jun 28, 2026 · 11:50 PM UTC
- Status: shipped because the corpus has >=15 media items, valid manifest, refreshed contact sheet, and the requested leads sidecar.

## Access path and limits

- Re-queried local sqlite first: `data/twitter-archive/twitter-archive.sqlite` had 19 @pleometric media rows, but 0 video/GIF rows.
- Checked tools: `yt-dlp` present, `gallery-dl` absent, `ffmpeg` and `ffprobe` present.
- Collection path used: `bun scripts/pleometric-media-sync.boundary.ts --max-items 150 --max-pages 25` fetched public Nitter timeline HTML at `https://nitter.tiekoetter.com/pleometric/media?view=timeline` with `curl/8.0` User-Agent, regex-extracted primary @pleometric `<source src="https://video.twimg.com/...mp4">` URLs, then downloaded direct public `video.twimg.com` MP4s.
- Concurrency: 1.
- Jitter: 1-3 seconds between media/page requests.
- Final media run fetched 5 Nitter media pages and stopped immediately on a 429 wall at cursor `DAABCgABHMTaMhe__6gKAAIcpj6jCJsAHAgAAwAAAAIAAA`.
- Leads path used: `bun scripts/pleometric-leads.boundary.ts` fetched public `/pleometric/following` pages, bounded to the first 200 rows, and classified bios/names by graphics/shader/creative-coding keywords.
- Leads run fetched 4 following pages, scanned 200 rows, found 2 keyword leads, and hit no walls.
- No login, cookies, private content, follows, likes, or API mutations.

## Verification

Expanded validation result:

```text
{'items': 35, 'media_files': 35, 'missing': [], 'leads': 2, 'contact_sheet': True}
```

Final sync summary:

```text
items: 35
files on disk in data dir: 36 before leads.json, 37 after leads.json
media pages fetched: 5
media stop reason: wall-429
leads scanned: 200 public following rows
leads count: 2
```

The contact sheet image is present at `workflows/scene-lab/reports/2026-07-03-pleometric-corpus/pleometric-contact-sheet.png` and is 1976x1320 PNG.

## Recurring visual techniques

- **Programmatic/videogen layering as the core basis:** captions explicitly discuss model behavior and experiments, including `seedance 2` (`2070631349778579630`), `seedance 1.5` (`2070507569756385543`), and short-form remix/source-reference posts like `Bangladesh by IanMcConnell` (`2067715247679402255`). This supports Arthur's framing: Pleometric is a style basis for diverse formats plus layered programmatic assets/shaders on top of videogen.
- **Mascot and clone/grid motifs:** the refreshed contact sheet shows repeated purple penguin mascot variants and tiled/repeated figure fields; the GIF/video item `Finally, the Pleometric Machine is complete` (`2070323077087412226`) fits the machine/mascot motif.
- **Strong typography and ad-copy parody:** corpus text includes intentionally loud sales-copy phrasing (`STOP ... One Weird Trick Will Make You RICH`, `2068025479026593909`), while sampled frames include rainbow birthday text, newspaper layout, pixel-game UI, scan-card labels, and UI/inventory bars.
- **Purple/magenta plus black-background palette:** purple/magenta dominates multiple sampled frames, usually on black or heavily simplified backgrounds; the recurring penguin asset reinforces a purple/yellow accent system.
- **Glitch, inversion, and degraded-media treatments:** sampled frames include inverted color animals, posterized/thresholded figures, scan-card pseudo-text, and UI/game/newspaper pastiche, suggesting deliberate low-fi media degradation rather than clean cinematic realism.

## Creative leads sidecar

`data/inspiration/pleometric/leads.json` uses schema `creative-leads.v1` and includes public following matches from the first 200 rows. The two keyword leads found in this bounded pass were:

- `@playcanvas` — open source web graphics platform; matched `graphics`.
- `@antimemeLLC` — visual systems/media operations; matched `visual`.

## Artifacts

- `data/inspiration/pleometric/manifest.json`
- `data/inspiration/pleometric/leads.json`
- `data/inspiration/pleometric/*.mp4`
- `workflows/scene-lab/reports/2026-07-03-pleometric-corpus/pleometric-contact-sheet.png`
- `workflows/scene-lab/reports/2026-07-03-pleometric-corpus/sync-summary.json`
- `scripts/pleometric-media-sync.boundary.ts`
- `scripts/pleometric-leads.boundary.ts`

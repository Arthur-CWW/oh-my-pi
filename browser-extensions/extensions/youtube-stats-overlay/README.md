# YouTube Stats Overlay Prototype

Clean-room YouTube stats UI prototype inspired by the vidIQ surfaces documented in `reveng/vidiq-vision`.

This package intentionally uses dummy data. The data layer is isolated in `src/content/index.tsx` so it can later be replaced with a cheap YouTube scraper/API provider.

## Run

```bash
pnpm --filter youtube-stats-overlay build
```

Load the unpacked extension from:

```text
/Users/arthur/projects/browser-extensions/extensions/youtube-stats-overlay/dist
```

## UI Scope

- Right-rail watch page card.
- Views/overview/AI Coach segmented control.
- Engagement, outlier, and VPH metric pills.
- View performance chart with p10/p25/p50/p75/p90 percentile bands.
- Similar-thumbnail CTA.
- Title changes card.

## Data Plan

Use dummy data for now. Future providers should expose a small interface returning:

- `videoId`
- `channelId`
- `title`
- `thumbnailUrl`
- `views`
- `viewsPerHour`
- `outlierScore`
- `engagementRate`
- `titleChanges`
- `viewPerformancePercentiles`

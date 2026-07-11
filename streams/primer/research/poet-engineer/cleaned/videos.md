# Captured X video index

On 2026-07-11, a bounded, sequential `yt-dlp` pass against the canonical X URLs recovered 12 public MP4s from all 10 indexed video posts (two posts expose two videos). No cookies, browser-cookie extraction, auth headers, account actions, stream reconstruction, or alternate private paths were used. Per-status method, exact bytes, SHA-256, and failures for all 32 known statuses are in `raw/media/public-recovery.json`; stream details and five-frame contact sheets are in `raw/media/forensics.json` and `raw/media/forensics/`. Local MP4 binaries are intentionally ignored by `raw/media/.gitignore`; the metadata and contact sheets remain trackable.

| Post | Recovered local MP4(s) | Duration / dimensions | Visual/OCR observation |
| --- | --- | --- | --- |
| [1821654144958202077](https://x.com/poetengineer__/status/1821654144958202077) | `1801536291424641024.mp4`; `1796780683567722497.mp4` | 7.925 s, 816×720; 21.734 s, 720×856 | Teal connection lines between word labels; 3D waveform graphs with `LOW`, `MID`, `HIGH`. |
| [1873264289626374353](https://x.com/poetengineer__/status/1873264289626374353) | `1873264173787844608.mp4`; `1873197336601530368.mp4` | 10.267 s; 11.133 s, both 1200×720 | Coastal flower landscapes; legible `天空` on one, blurred Chinese overlay on the other. |
| [2066924260317147488](https://x.com/poetengineer__/status/2066924260317147488) | `2066924196337160193.mp4` | 16.718 s, 1080×1080 | Pixel symbols and rotating wireframes; `HYPNOMMATA: FORGETTING AS INVENTION`, `now available on objkt.` |
| [2068419118655529130](https://x.com/poetengineer__/status/2068419118655529130) | `2068418902443372544.mp4` | 12.585 s, 1080×1080 | Radial colored-point clusters, numbered labels, square markers, and connecting lines. |
| [2070184648265597188](https://x.com/poetengineer__/status/2070184648265597188) | `2070184538282573824.mp4` | 16.951 s, 1824×1072 | Dark network graphs with image/document thumbnail grids. |
| [2073103304612012202](https://x.com/poetengineer__/status/2073103304612012202) | `2073102931105132544.mp4` | 26.773 s, 1886×1080 | Map-like routes, wireframe zones, and hover UI; `03-19` legible. |
| [2074189012378464436](https://x.com/poetengineer__/status/2074189012378464436) | `2074188790822793216.mp4` | 17.113 s, 1920×1080 | Floating architectural diagrams and data-like forms; `HYPOMNEMATA` legible. |
| [2074432243829780985](https://x.com/poetengineer__/status/2074432243829780985) | `2074432151135617025.mp4` | 12.667 s, 1280×1280 | Circular wireframe object in a gridded 3D tunnel; numeric scale labels visible. |
| [2075264760136749101](https://x.com/poetengineer__/status/2075264760136749101) | `2075264689886359552.mp4` | 14.118 s, 1044×720 | A woman gestures while colorful particle swirls form and move around her. |
| [2074886581953990888](https://x.com/poetengineer__/status/2074886581953990888) | `2074886524844281857.mp4` | 12.190 s, 1080×1080 | Colorful wireframe box-and-point-cloud visualization. |
Audio streams occur in seven recovered files. No local speech-to-text capability was configured, and audio presence alone does not establish speech; therefore no transcript is claimed. Exact visual notes and only legible OCR are in `raw/media/forensic-observations.json`.

## Remaining media gaps

The 22 other known status URLs exposed no downloadable media to unauthenticated `yt-dlp` (recorded per status, with extractor output, in `raw/media/public-recovery.json`). The bounded run did not recrawl the timeline, use alternate private/subscriber/deleted sources, or pursue DRM/access controls. Image-only DOM references were not recovered by this canonical-status extractor; the public `pbs.twimg.com` DNS limitation documented by the initial pass remains applicable.

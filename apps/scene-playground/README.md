# Scene Playground

Local-first Bun website for editing `scene.v1` JSON specs and previewing them with `packages/scene-renderer/dist/runtime.js`.

```sh
bun install
bun src/server.ts --port 4600 --open
```

Default port is `4600`. `--open` prints the URL only. It does not launch a browser.

## Routes

| Route | Purpose |
| --- | --- |
| `GET /` | Built vanilla TS UI. |
| `GET /runtime.js` | Scene runtime bundle from `packages/scene-renderer/dist/runtime.js`; returns a helpful 404 until built. |
| `GET /api/specs` | Lists `workflows/scene-lab/specs/**/*.scene.json`. |
| `GET /api/spec?path=` | Reads one spec inside the specs directory. |
| `PUT /api/spec?path=` | Writes the request body verbatim to one spec inside the specs directory. |
| `GET /api/assets` | Lists media assets under configured local roots. |
| `GET /asset?path=` | Streams allowed local media/render files with root guards. |
| `GET /api/renders` | Lists render outputs under `workflows/scene-lab/renders/*/scene.mp4`. |
| `GET /api/reports` | Lists report dirs with parsed front matter, excerpt, and media file names. Newest first. |
| `GET /report?path=` | Streams a file inside `workflows/scene-lab/reports/` (`.md`, `.png`, `.mp4`, `.json`). Path-guarded. |
| `GET /events` | SSE updates for spec, render, and report changes. |

## Reports convention

Agent proof reports live under `workflows/scene-lab/reports/<yyyy-mm-dd>-<slug>/`:

```
workflows/scene-lab/reports/
  2026-07-03-scene-lab-boot/
    report.md          # required
    screenshot.png     # optional media
    demo.mp4           # optional media
    metrics.json       # optional media
```

`report.md` uses simple `key: value` front matter (no YAML fences) before the first blank line:

```
title: Scene Lab online
date: 2026-07-03
agent: Fable
status: shipped

Body content in markdown follows the blank line.
```

Front matter fields:

| Field | Required | Values |
| --- | --- | --- |
| `title` | yes | Free text. |
| `date` | yes | `YYYY-MM-DD`. |
| `agent` | yes | Name of the agent or person who produced the report. |
| `status` | yes | `shipped`, `partial`, or `blocked`. |

The UI surfaces reports as the default landing view with status-colored pills, inline media thumbnails, and expandable rendered markdown. SSE pushes `report-added` events when new reports appear.

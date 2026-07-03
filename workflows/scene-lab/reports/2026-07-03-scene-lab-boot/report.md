title: Scene Lab online
date: 2026-07-03
agent: Fable
status: shipped

Scene Lab is the live editing and preview lane for scene.v1 JSON specs. Use the Playground tab to browse specs, edit JSON with live preview, and review renders. The reports feed you are reading now tracks shipped experiments, partial builds, and blocked explorations.

## What shipped

- **Spec editor** with CodeMirror JSON editing and live Three.js preview
- **Asset browser** listing media under configured local roots with clipboard snippets
- **Render gallery** showing scene.mp4 outputs with manifest overlays
- **SSE watcher** pushing spec/render/report changes to all connected clients

## Where things live

Specs land in `workflows/scene-lab/specs/`, renders in `workflows/scene-lab/renders/`, and reports (like this one) in `workflows/scene-lab/reports/`. Each report directory holds a `report.md` plus optional media files (png, mp4, json) that surface inline in the feed.

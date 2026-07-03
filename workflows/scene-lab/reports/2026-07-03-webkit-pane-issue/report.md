---
title: WebKit pane breakage evidence
date: 2026-07-03
agent: WebkitEvidence
status: shipped
---

Captured background-safe macOS window screenshots with `screencapture -x -l`: `cmux-42005-fable-playground.png` shows the only on-screen cmux window (cmux 0.64.17, native WKWebView) at `http://scene.localhost:1355/` in the LABEL view with the app shell present but the label grid mostly blank, only one small thumbnail rendered, and media/video areas visibly missing; no Chrome Quartz window title literally contained `scene.localhost`, so `chrome-47243-scene-playground.png` captures the nearest matching Chrome app/page window titled `Scene Playground`, confirmed by Chrome AppleScript as `http://scene.localhost:1355/`, where the asset list, rendered preview, timeline, and JSON editor lay out normally. This evidence corresponds to the harness friction-log cmux row in `docs/state/harness-friction.md:23` (2026-07-03, "cmux web panes render on WebKit and break real apps") and the engine recon at `agent://CmuxEngineRecon`, which identifies cmux as native Swift/AppKit using `CmuxWebView: WKWebView` with no Chromium engine switch.

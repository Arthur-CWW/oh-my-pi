---
title: Scene playground dev server up
date: 2026-07-15
agent: SceneDevUp
status: done
---

## What was down

Before restart, `http://scene.localhost:1355/` returned HTTP 404 from portless with `No app registered for scene.localhost` (the portless 404 page).

## How started

Started the supervised restart loop locally (Mac) from `apps/scene-playground/`:

```sh
nohup ./scripts/dev-up.sh > /tmp/scene-dev-up.log 2>&1 &
```

The supervisor log recorded `2026-07-15T06:00:01Z`, portless registration for `scene.localhost`, and the app listening on `127.0.0.1:4370`.

## Verification

Required curl check:

```text
<!doctype html>
<html lang="en">
...
<title>Scene Playground</title>
...
<main id="app"></main>
...
HTTP_STATUS:200
```

`data/scene-lab/errors.log` has no entries dated `2026-07-15` after boot. Its newest entry is historical (`2026-07-06T04:07:27.710Z`); no new boot errors were appended.
The detached process tree remained present after verification: `/bin/sh ./scripts/dev-up.sh` (PID 94344) supervising portless (PID 94348).

## Exact restart command

From the repository root:

```sh
cd apps/scene-playground && nohup ./scripts/dev-up.sh > /tmp/scene-dev-up.log 2>&1 &
```

No app or portless configuration files were changed.

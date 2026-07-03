# Scene Renderer

Deterministic offline harness for rendering `scene.v1` JSON specs through the browser SceneRuntime into PNG frames, stills, and MP4 outputs.

```bash
bun run check --scene scene.json
bun run render --scene scene.json --out /tmp/scene-out --runtime src/test-runtime.js
bun run render --scene scene.json --out /tmp/scene-out --runtime src/test-runtime.js --still 0.5
```

The production runtime bundle is expected at `dist/runtime.js`; build it with `bun run build:runtime` once `src/runtime/index.ts` exists.

# Spatial audio renderer

Goal 3 local proof renderer for `voice-assets.v1`, `asmr-stems.v1`, and `spatial-audio-manifest.v1` manifests from `@wirebabel/media-contracts`.

## Proof command for Main

```bash
bun packages/spatial-audio-renderer/src/cli.ts render \
  --voice-assets packages/media-contracts/fixtures/valid/voice-assets.v1.json \
  --stems packages/spatial-audio-renderer/fixtures/asmr-scene/asmr-stems.v1.json \
  --spatial packages/spatial-audio-renderer/fixtures/asmr-scene/spatial-audio-manifest.v1.json \
  --outDir data/asmr-companion/goal3-spatial-proof
```

Expected artifacts:

- `data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.wav`
- `data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json`

The editable `spatial-audio-manifest.v1.json` remains the source of truth. The WAV and render-output JSON are generated artifacts.

## Validation commands for Main

This subagent did not run verification commands. Main should run:

```bash
cd packages/spatial-audio-renderer && bun run typecheck
cd packages/spatial-audio-renderer && bun test test/render.test.ts
```

The test suite covers:

- Goal 1 fixture round-trip and deterministic render from `packages/media-contracts/fixtures/valid/`.
- ASMR scene mapping for close-left whisper, close-right whisper, behind near/far movement, soft brush/tap loop, and heartbeat/room-tone bed.
- WAV duration, stereo channel count, non-silent output, output manifest SHA-256, timing constraints, manifest path consistency, and unsafe artifact path rejection.

## Render-output manifest shape

The CLI writes `spatial-audio-render-output.v1`:

```json
{
  "schemaVersion": "spatial-audio-render-output.v1",
  "audioPath": "data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.wav",
  "output": {
    "audioPath": "data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.wav",
    "mediaType": "audio/wav",
    "channels": 2,
    "sampleRateHz": 48000,
    "durationSec": 8,
    "sha256": "<wav-sha256>",
    "nonSilent": true
  },
  "source": {
    "voiceAssetsManifestPath": "packages/media-contracts/fixtures/valid/voice-assets.v1.json",
    "stemsManifestPath": "packages/spatial-audio-renderer/fixtures/asmr-scene/asmr-stems.v1.json",
    "spatialAudioManifestPath": "packages/spatial-audio-renderer/fixtures/asmr-scene/spatial-audio-manifest.v1.json"
  },
  "provenance": {
    "renderRunId": "goal3-local-render-proof-001",
    "buses": ["ambience", "foley", "voice"],
    "objects": [
      {
        "stemId": "whisper-left-001",
        "bus": "voice",
        "kind": "voice",
        "role": "close-left synthetic whisper phrase",
        "generator": "goal3-deterministic-local-voice-tone",
        "sourceVoiceAssetId": "voice-companion-soft-whisper-001"
      }
    ]
  }
}
```

## Remotion / Goal 5 handoff

`packages/remotion-renderer/src/render.ts` already accepts `--audio-manifest` and resolves nested `output.audioPath`. Pass the generated render-output manifest directly:

```bash
bun run remotion-renderer:render \
  --manifest <context.json> \
  --layer-plan <layer-plan.json> \
  --persona-manifest <persona.json> \
  --audio-manifest data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json \
  --out <render-dir>
```

Goal 5 should treat the render-output manifest as the renderer-consumable handoff and keep references back to:

- source voice assets manifest path
- source ASMR stems manifest path
- source spatial audio manifest path
- generated stereo master path
- SHA-256, duration, sample rate, channel count, and object/bus provenance

# Media contracts

Provider-neutral ASMR companion and generated-video manifest contracts live in `@wirebabel/media-contracts`.

Downstream imports:

- `decodeAnalysisTagsV1`, `AnalysisTagsV1Schema`, `type AnalysisTagsV1`
- `decodeVoiceAssetsV1`, `VoiceAssetsV1Schema`, `type VoiceAssetsV1`
- `decodeAsmrStemsV1`, `AsmrStemsV1Schema`, `type AsmrStemsV1`
- `decodeSpatialAudioManifestV1`, `SpatialAudioManifestV1Schema`, `type SpatialAudioManifestV1`
- `decodeGeneratedVideoClipsV1`, `GeneratedVideoClipsV1Schema`, `type GeneratedVideoClipsV1`
- `decodeAsmrContractManifest` for dispatch by `schemaVersion`

Shared fixtures:

- Valid bundle: `packages/media-contracts/fixtures/valid/`
- Invalid critical-failure bundle: `packages/media-contracts/fixtures/invalid/`

Goal 2 should consume `analysis-tags.v1.json` and `generated-video-clips.v1.json` for first-frame provenance, SynthID-conditioning records, and generated clip provenance. Goal 3 should consume `voice-assets.v1.json`, `asmr-stems.v1.json`, and `spatial-audio-manifest.v1.json` for voice/stem/spatial handoff shapes.

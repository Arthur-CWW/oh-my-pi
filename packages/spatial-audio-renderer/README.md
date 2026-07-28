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

## Validation cell

`bun run validate:cell` runs the Companion instantiation of the portable validation cell
(`src/validation-cell.ts`) against the real renderer: it synthesizes a deterministic 48 kHz
voice/foley scene with a five-point x/z voice trajectory, renders it twice, decodes the emitted WAV
back to Float32 stereo, and scores three invariants — exact stereo/48 kHz/frame structure with
finite samples, left-to-right trajectory energy across eight fixed windows, and voice/foley
temporal separation across a silent gap. Two negative controls (reversed trajectory, dropped foley
stem) must each fail exactly one invariant at a declared first frame, or the cell throws.

`bun run validate:cell` is a bounded wrapper, not a bare run. It reads the limits its own cgroup
imposes and, unless `MemoryMax`, `CPUQuota` and `RuntimeMaxSec` are all at least as tight as the
manifest's `execution.budget`, it re-executes itself under
`systemd-run --user --scope -p MemoryMax=… -p CPUQuota=… -p RuntimeMaxSec=…` (argv derived from
that budget) or refuses with exit 1. The receipt records the values the run observed, never the
command that was supposed to impose them, so `budget.observed.enforced` is a check rather than a
claim. On a host without a user systemd scope — macOS, for instance — the entry point always
refuses; call `runCompanionValidationCell()` directly if you need an explicitly unbounded run, and
read `budget.observed` in its receipt.

Both roots are validated before the first filesystem call: each must be repo-relative, strictly
below `packages/spatial-audio-renderer/test-output` or `local/proofs`, resolve to exactly where it
lexically claims to be, and be disjoint from the other. The previous verdict is deleted before the
run starts; the WAV and receipt are staged and published together only once the receipt decodes
and the scratch tree is provably swept, so a failed run leaves neither artifact behind.

One run owns a proof root at a time. Before it reads, clears, stages or publishes anything there,
the run claims `.proof-lock` by hard-linking a file it has already written in full, so that
well-known name is either absent or carries a complete holder identity (pid, that pid's start
stamp, hostname, token). A second run does not wait: it throws `ProofRootBusyError` having touched
nothing but its own token-named handle. A claim is stealable only once its holder is proven dead on
this host — a recycled pid, or a claim written on another machine, counts as undecided rather than
dead — and the takeover is serialised by renaming the dead holder's handle, so two runs burying one
corpse cannot both unlink. Every later step re-reads the claim: a run that lost the root publishes
nothing and clears nothing, and reports the paths it left to the new owner.

The run keeps a playable WAV plus a replayable receipt (schema digest; renderer, cell, resolved
`@wirebabel/media-contracts` source and version, `effect` version and the install-root `bun.lock`
as one source binding digest; input/output digests, metrics, replay commands, observed budget,
cleanup, errors) under `local/proofs/companion-validation-cell/`, which is self-ignored by git.
`bun test test/validation-cell.test.ts` asserts the same properties plus receipt stability across
two independent scratch roots, and covers the destructive-root, linked-root, stale-proof,
post-copy-failure, live-holder, simultaneous-run, yanked-claim, unassessable-holder, malformed-WAV,
quota-rounding and cross-field-schema negatives.

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

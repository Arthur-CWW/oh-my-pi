import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  assertSafeManifestPath,
  decodeAsmrStemsV1,
  decodeSpatialAudioManifestV1,
  decodeVoiceAssetsV1,
  type AsmrStemsV1,
  type SpatialAudioManifestV1,
  type SpatialPosition,
  type VoiceAssetsV1,
} from "@wirebabel/media-contracts"

export interface SpatialRenderInputs {
  voiceAssetsPath: string
  stemsPath: string
  spatialManifestPath: string
  outDir?: string
  outputPath?: string
  outputManifestPath?: string
}

export interface SpatialRenderResult {
  audioPath: string
  outputManifestPath: string
  sha256: string
  byteLength: number
  durationSec: number
  sampleRateHz: number
  channels: 2
  frames: number
  peak: number
  nonSilent: boolean
  source: {
    voiceAssetsPath: string
    stemsPath: string
    spatialManifestPath: string
  }
}

export interface SpatialRenderOutputManifest {
  schemaVersion: "spatial-audio-render-output.v1"
  createdAt: string
  renderer: {
    engine: string
    version: string
  }
  audioPath: string
  output: {
    audioPath: string
    mediaType: "audio/wav"
    channels: 2
    sampleRateHz: number
    durationSec: number
    frames: number
    sha256: string
    byteLength: number
    peak: number
    nonSilent: boolean
  }
  source: {
    voiceAssetsManifestPath: string
    stemsManifestPath: string
    spatialAudioManifestPath: string
    voiceAssetsManifestId: string
    stemsManifestId: string
    spatialAudioManifestId: string
  }
  provenance: {
    renderRunId: string
    buses: string[]
    objects: Array<{
      stemId: string
      bus: string
      kind: string
      role: string
      generator: string
      sourceVoiceAssetId?: string
    }>
  }
}

type Stem = AsmrStemsV1["stems"][number]
type SpatialObject = SpatialAudioManifestV1["objects"][number]
type AutomationPoint = SpatialObject["automation"][number]

const TWO_PI = Math.PI * 2
const DEFAULT_RENDERER_VERSION = "goal3-local-deterministic-stereo-v1"
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..")

export function loadSpatialRenderBundle(inputs: SpatialRenderInputs): {
  voiceAssets: VoiceAssetsV1
  stems: AsmrStemsV1
  spatial: SpatialAudioManifestV1
} {
  assertSafeManifestPath(inputs.voiceAssetsPath, "voice assets manifest path")
  assertSafeManifestPath(inputs.stemsPath, "ASMR stems manifest path")
  assertSafeManifestPath(inputs.spatialManifestPath, "spatial audio manifest path")
  if (inputs.outDir) assertSafeManifestPath(inputs.outDir, "output directory")
  if (inputs.outputPath) assertSafeManifestPath(inputs.outputPath, "output audio path")
  if (inputs.outputManifestPath) assertSafeManifestPath(inputs.outputManifestPath, "output render manifest path")
  const voiceAssets = decodeVoiceAssetsV1(readJson(inputs.voiceAssetsPath), inputs.voiceAssetsPath)
  const stems = decodeAsmrStemsV1(readJson(inputs.stemsPath), inputs.stemsPath)
  const spatial = decodeSpatialAudioManifestV1(readJson(inputs.spatialManifestPath), inputs.spatialManifestPath)
  validateRenderBundle({ voiceAssets, stems, spatial }, inputs)
  return { voiceAssets, stems, spatial }
}

export function renderSpatialAudioProof(inputs: SpatialRenderInputs): SpatialRenderResult {
  const bundle = loadSpatialRenderBundle(inputs)
  const sampleRateHz = bundle.stems.timeline.sampleRateHz
  const frames = Math.round(bundle.spatial.durationSec * sampleRateHz)
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  const stemById = new Map(bundle.stems.stems.map((stem): [string, Stem] => [stem.stemId, stem]))

  for (const object of bundle.spatial.objects) {
    const stem = stemById.get(object.stemId)
    if (!stem) {
      throw new Error(`spatial object references missing stem: ${object.stemId}`)
    }
    mixObject({ object, stem, sampleRateHz, left, right })
  }

  const peakBeforeNormalize = peakOf(left, right)
  if (peakBeforeNormalize > 0.98) {
    const scale = 0.98 / peakBeforeNormalize
    for (let index = 0; index < frames; index += 1) {
      left[index] *= scale
      right[index] *= scale
    }
  }

  const peak = peakOf(left, right)
  const wavBytes = encodeWav16({ left, right, sampleRateHz })
  const audioPath = resolveOutputAudioPath(inputs, bundle.spatial)
  mkdirSync(path.dirname(resolveRepoPath(audioPath)), { recursive: true })
  writeFileSync(resolveRepoPath(audioPath), wavBytes)

  const sha256 = createHash("sha256").update(wavBytes).digest("hex")
  const byteLength = wavBytes.byteLength
  const outputManifestPath = resolveOutputManifestPath(inputs, audioPath)
  const outputManifest = buildOutputManifest({
    bundle,
    inputs,
    audioPath,
    sha256,
    byteLength,
    frames,
    peak,
    nonSilent: peak > 0.0001,
  })
  mkdirSync(path.dirname(resolveRepoPath(outputManifestPath)), { recursive: true })
  writeJson(outputManifestPath, outputManifest)

  return {
    audioPath,
    outputManifestPath,
    sha256,
    byteLength,
    durationSec: bundle.spatial.durationSec,
    sampleRateHz,
    channels: 2,
    frames,
    peak,
    nonSilent: peak > 0.0001,
    source: {
      voiceAssetsPath: inputs.voiceAssetsPath,
      stemsPath: inputs.stemsPath,
      spatialManifestPath: inputs.spatialManifestPath,
    },
  }
}

export function inspectWav16Stereo(filePath: string): {
  channels: number
  sampleRateHz: number
  frames: number
  durationSec: number
  peak: number
  nonSilent: boolean
} {
  const bytes = readFileSync(resolveRepoPath(filePath))
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`not a WAV file: ${filePath}`)
  }
  const channels = bytes.readUInt16LE(22)
  const sampleRateHz = bytes.readUInt32LE(24)
  const bitsPerSample = bytes.readUInt16LE(34)
  if (bitsPerSample !== 16) {
    throw new Error(`expected 16-bit PCM WAV, got ${bitsPerSample}`)
  }

  let cursor = 12
  let dataOffset = -1
  let dataLength = -1
  while (cursor + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", cursor, cursor + 4)
    const chunkLength = bytes.readUInt32LE(cursor + 4)
    if (chunkId === "data") {
      dataOffset = cursor + 8
      dataLength = chunkLength
      break
    }
    cursor += 8 + chunkLength + (chunkLength % 2)
  }
  if (dataOffset < 0 || dataLength < 0) {
    throw new Error(`WAV data chunk missing: ${filePath}`)
  }

  let peak = 0
  for (let offset = dataOffset; offset < dataOffset + dataLength; offset += 2) {
    peak = Math.max(peak, Math.abs(bytes.readInt16LE(offset) / 32768))
  }
  const frames = dataLength / (channels * 2)
  return {
    channels,
    sampleRateHz,
    frames,
    durationSec: frames / sampleRateHz,
    peak,
    nonSilent: peak > 0.0001,
  }
}

function validateRenderBundle(
  bundle: { voiceAssets: VoiceAssetsV1; stems: AsmrStemsV1; spatial: SpatialAudioManifestV1 },
  inputs: SpatialRenderInputs,
): void {
  assertSafeManifestPath(inputs.voiceAssetsPath, "voice assets manifest path")
  assertSafeManifestPath(inputs.stemsPath, "ASMR stems manifest path")
  assertSafeManifestPath(inputs.spatialManifestPath, "spatial audio manifest path")
  if (inputs.outDir) assertSafeManifestPath(inputs.outDir, "output directory")
  if (inputs.outputPath) assertSafeManifestPath(inputs.outputPath, "output audio path")
  if (inputs.outputManifestPath) assertSafeManifestPath(inputs.outputManifestPath, "output render manifest path")

  if (resolveRepoPath(inputs.stemsPath) !== resolveRepoPath(bundle.spatial.stemsManifestPath)) {
    throw new Error(`spatial manifest stemsManifestPath does not match provided ASMR stems path: ${bundle.spatial.stemsManifestPath}`)
  }

  const stemById = new Map(bundle.stems.stems.map((stem): [string, Stem] => [stem.stemId, stem]))
  const voiceAssetIds = new Set(bundle.voiceAssets.voices.map((voice) => voice.voiceAssetId))
  for (const stem of bundle.stems.stems) {
    assertSafeManifestPath(stem.artifact.path, `stem artifact path ${stem.stemId}`)
    const sourceVoiceAssetId = stem.provenance.sourceVoiceAssetId
    if (sourceVoiceAssetId && !voiceAssetIds.has(sourceVoiceAssetId)) {
      throw new Error(`stem ${stem.stemId} references missing voice asset: ${sourceVoiceAssetId}`)
    }
  }

  for (const object of bundle.spatial.objects) {
    const stem = stemById.get(object.stemId)
    if (!stem) throw new Error(`spatial object references missing stem: ${object.stemId}`)
    const endSec = stem.timing.startSec + stem.timing.durationSec
    if (endSec > bundle.spatial.durationSec + 1e-6) {
      throw new Error(`stem ${stem.stemId} ends after spatial render duration`)
    }
    for (let index = 1; index < object.automation.length; index += 1) {
      const previous = object.automation[index - 1]
      const current = object.automation[index]
      if (current.timeSec < previous.timeSec) {
        throw new Error(`automation for ${object.stemId} is not sorted at index ${index}`)
      }
    }
  }
}

function mixObject(args: {
  object: SpatialObject
  stem: Stem
  sampleRateHz: number
  left: Float32Array
  right: Float32Array
}): void {
  const { object, stem, sampleRateHz, left, right } = args
  const startFrame = Math.max(0, Math.floor(stem.timing.startSec * sampleRateHz))
  const endFrame = Math.min(left.length, Math.ceil((stem.timing.startSec + stem.timing.durationSec) * sampleRateHz))
  const seed = hashSeed(`${stem.stemId}:${stem.kind}:${stem.role}`)
  const busTrim = busGain(object.bus)

  for (let frame = startFrame; frame < endFrame; frame += 1) {
    const absoluteTimeSec = frame / sampleRateHz
    const localTimeSec = absoluteTimeSec - stem.timing.startSec
    const sourceTimeSec = stem.timing.loop ? localTimeSec % loopPeriodSec(stem) : localTimeSec
    const source = sourceSample(stem, sourceTimeSec, sampleRateHz, seed)
    const timingEnvelope = envelopeGain(localTimeSec, stem.timing.durationSec, stem.timing.fadeInSec ?? 0, stem.timing.fadeOutSec ?? 0)
    if (timingEnvelope <= 0) continue

    const automation = interpolateAutomation(object.automation, absoluteTimeSec)
    const spatial = spatialGains(automation.position, automation.occlusion ?? 0)
    const gain = dbToGain(automation.gainDb) * timingEnvelope * busTrim
    left[frame] += source * gain * spatial.left
    right[frame] += source * gain * spatial.right
  }
}

function sourceSample(stem: Stem, timeSec: number, sampleRateHz: number, seed: number): number {
  if (timeSec < 0) return 0
  const noise = deterministicNoise(Math.floor(timeSec * sampleRateHz), seed)
  switch (stem.kind) {
    case "voice":
    case "whisper_double": {
      const formantA = Math.sin(TWO_PI * (170 + (seed % 37)) * timeSec)
      const formantB = Math.sin(TWO_PI * (310 + (seed % 53)) * timeSec + 0.4)
      const syllable = 0.45 + 0.55 * Math.max(0, Math.sin(TWO_PI * 2.7 * timeSec + (seed % 11)))
      const breath = noise * 0.22
      return (0.28 * formantA + 0.14 * formantB + breath) * syllable
    }
    case "breath": {
      const swell = 0.5 + 0.5 * Math.sin(TWO_PI * 0.55 * timeSec - 0.6)
      return noise * 0.34 * Math.max(0, swell)
    }
    case "foley": {
      const brush = noise * (0.14 + 0.08 * Math.sin(TWO_PI * 7.5 * timeSec))
      const tapPhase = timeSec % 0.42
      const tap = tapPhase < 0.018 ? Math.sin(Math.PI * (tapPhase / 0.018)) * 0.72 : 0
      return brush + tap
    }
    case "heartbeat": {
      const beatPhase = timeSec % 0.86
      const first = beatPhase < 0.07 ? Math.sin(Math.PI * (beatPhase / 0.07)) : 0
      const secondPhase = beatPhase - 0.18
      const second = secondPhase >= 0 && secondPhase < 0.05 ? Math.sin(Math.PI * (secondPhase / 0.05)) * 0.55 : 0
      return (first + second) * 0.46 + noise * 0.035
    }
    case "room_tone":
    case "ambience":
      return noise * 0.09 + Math.sin(TWO_PI * 62 * timeSec) * 0.025
    case "music":
      return Math.sin(TWO_PI * 110 * timeSec) * 0.18 + Math.sin(TWO_PI * 220 * timeSec) * 0.08
    default:
      return noise * 0.05
  }
}

function interpolateAutomation(points: ReadonlyArray<AutomationPoint>, timeSec: number): {
  gainDb: number
  position: SpatialPosition
  occlusion?: number
  reverbSend?: number
} {
  if (timeSec <= points[0].timeSec) return points[0]
  const last = points[points.length - 1]
  if (timeSec >= last.timeSec) return last

  for (let index = 1; index < points.length; index += 1) {
    const next = points[index]
    const previous = points[index - 1]
    if (timeSec <= next.timeSec) {
      const span = next.timeSec - previous.timeSec
      const amount = span <= 0 ? 0 : (timeSec - previous.timeSec) / span
      return {
        gainDb: lerp(previous.gainDb, next.gainDb, amount),
        position: {
          azimuthDeg: lerp(previous.position.azimuthDeg, next.position.azimuthDeg, amount),
          elevationDeg: lerp(previous.position.elevationDeg, next.position.elevationDeg, amount),
          distanceMeters: lerp(previous.position.distanceMeters, next.position.distanceMeters, amount),
        },
        occlusion: lerp(previous.occlusion ?? 0, next.occlusion ?? 0, amount),
        reverbSend: lerp(previous.reverbSend ?? 0, next.reverbSend ?? 0, amount),
      }
    }
  }
  return last
}

function spatialGains(position: SpatialPosition, occlusion: number): { left: number; right: number } {
  const azimuthRad = (position.azimuthDeg * Math.PI) / 180
  const pan = Math.max(-1, Math.min(1, Math.sin(azimuthRad)))
  const leftPan = Math.cos((pan + 1) * Math.PI * 0.25)
  const rightPan = Math.sin((pan + 1) * Math.PI * 0.25)
  const distance = Math.max(0.01, position.distanceMeters)
  const nearBoost = distance < 0.2 ? 1.18 : 1
  const distanceGain = nearBoost / (1 + Math.max(0, distance - 0.1) * 0.65)
  const elevationGain = 1 - Math.min(0.15, Math.abs(position.elevationDeg) / 90 * 0.15)
  const rearDamping = Math.abs(position.azimuthDeg) > 120 ? 0.82 : 1
  const occlusionGain = 1 - occlusion * 0.45
  const scalar = distanceGain * elevationGain * rearDamping * occlusionGain
  return { left: leftPan * scalar, right: rightPan * scalar }
}

function encodeWav16(args: { left: Float32Array; right: Float32Array; sampleRateHz: number }): Buffer {
  const { left, right, sampleRateHz } = args
  if (left.length !== right.length) throw new Error("left/right channel length mismatch")
  const channels = 2
  const bitsPerSample = 16
  const blockAlign = channels * (bitsPerSample / 8)
  const byteRate = sampleRateHz * blockAlign
  const dataLength = left.length * blockAlign
  const bytes = Buffer.alloc(44 + dataLength)
  bytes.write("RIFF", 0)
  bytes.writeUInt32LE(36 + dataLength, 4)
  bytes.write("WAVE", 8)
  bytes.write("fmt ", 12)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(channels, 22)
  bytes.writeUInt32LE(sampleRateHz, 24)
  bytes.writeUInt32LE(byteRate, 28)
  bytes.writeUInt16LE(blockAlign, 32)
  bytes.writeUInt16LE(bitsPerSample, 34)
  bytes.write("data", 36)
  bytes.writeUInt32LE(dataLength, 40)

  let offset = 44
  for (let index = 0; index < left.length; index += 1) {
    bytes.writeInt16LE(floatToInt16(left[index]), offset)
    bytes.writeInt16LE(floatToInt16(right[index]), offset + 2)
    offset += 4
  }
  return bytes
}

function buildOutputManifest(args: {
  bundle: { voiceAssets: VoiceAssetsV1; stems: AsmrStemsV1; spatial: SpatialAudioManifestV1 }
  inputs: SpatialRenderInputs
  audioPath: string
  sha256: string
  byteLength: number
  frames: number
  peak: number
  nonSilent: boolean
}): SpatialRenderOutputManifest {
  const { bundle, inputs, audioPath, sha256, byteLength, frames, peak, nonSilent } = args
  const stemById = new Map(bundle.stems.stems.map((stem): [string, Stem] => [stem.stemId, stem]))
  return {
    schemaVersion: "spatial-audio-render-output.v1",
    createdAt: new Date(0).toISOString(),
    renderer: {
      engine: "local-deterministic-stereo",
      version: DEFAULT_RENDERER_VERSION,
    },
    audioPath,
    output: {
      audioPath,
      mediaType: "audio/wav",
      channels: 2,
      sampleRateHz: bundle.stems.timeline.sampleRateHz,
      durationSec: bundle.spatial.durationSec,
      frames,
      sha256,
      byteLength,
      peak,
      nonSilent,
    },
    source: {
      voiceAssetsManifestPath: inputs.voiceAssetsPath,
      stemsManifestPath: inputs.stemsPath,
      spatialAudioManifestPath: inputs.spatialManifestPath,
      voiceAssetsManifestId: bundle.voiceAssets.manifestId,
      stemsManifestId: bundle.stems.manifestId,
      spatialAudioManifestId: bundle.spatial.manifestId,
    },
    provenance: {
      renderRunId: bundle.spatial.provenance.renderRunId,
      buses: [...new Set(bundle.spatial.objects.map((object) => object.bus))].sort(),
      objects: bundle.spatial.objects.map((object) => {
        const stem = stemById.get(object.stemId)
        if (!stem) throw new Error(`spatial object references missing stem: ${object.stemId}`)
        return {
          stemId: object.stemId,
          bus: object.bus,
          kind: stem.kind,
          role: stem.role,
          generator: stem.provenance.generator,
          sourceVoiceAssetId: stem.provenance.sourceVoiceAssetId,
        }
      }),
    },
  }
}

function resolveOutputAudioPath(inputs: SpatialRenderInputs, spatial: SpatialAudioManifestV1): string {
  const requested = inputs.outputPath ?? spatial.mix.outputPath
  assertSafeManifestPath(requested, "spatial audio output path")
  if (inputs.outDir && !inputs.outputPath) {
    return path.join(inputs.outDir, path.basename(requested))
  }
  return requested
}

function resolveOutputManifestPath(inputs: SpatialRenderInputs, audioPath: string): string {
  if (inputs.outputManifestPath) return inputs.outputManifestPath
  return path.join(path.dirname(audioPath), `${path.basename(audioPath, path.extname(audioPath))}.render-output.json`)
}

function readJson(filePath: string): unknown {
  const resolved = resolveRepoPath(filePath)
  if (!existsSync(resolved)) throw new Error(`manifest file does not exist: ${filePath}`)
  return JSON.parse(readFileSync(resolved, "utf8")) as unknown
}

function resolveRepoPath(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(REPO_ROOT, filePath)
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(resolveRepoPath(filePath), `${JSON.stringify(value, null, 2)}\n`)
}

function envelopeGain(localTimeSec: number, durationSec: number, fadeInSec: number, fadeOutSec: number): number {
  if (localTimeSec < 0 || localTimeSec > durationSec) return 0
  const fadeIn = fadeInSec > 0 ? Math.min(1, localTimeSec / fadeInSec) : 1
  const remaining = durationSec - localTimeSec
  const fadeOut = fadeOutSec > 0 ? Math.min(1, remaining / fadeOutSec) : 1
  return Math.max(0, Math.min(1, fadeIn, fadeOut))
}

function loopPeriodSec(stem: Stem): number {
  switch (stem.kind) {
    case "foley":
      return 1.68
    case "heartbeat":
      return 3.44
    case "room_tone":
    case "ambience":
      return 4
    default:
      return Math.max(0.25, stem.timing.durationSec)
  }
}

function busGain(bus: SpatialObject["bus"]): number {
  switch (bus) {
    case "voice":
      return 1
    case "foley":
      return 0.9
    case "ambience":
      return 0.78
    case "music":
      return 0.68
  }
}

function peakOf(left: Float32Array, right: Float32Array): number {
  let peak = 0
  for (let index = 0; index < left.length; index += 1) {
    peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]))
  }
  return peak
}

function deterministicNoise(index: number, seed: number): number {
  let value = (index + 1) * 374761393 + seed * 668265263
  value = (value ^ (value >> 13)) * 1274126177
  value = value ^ (value >> 16)
  return ((value >>> 0) / 0xffffffff) * 2 - 1
}

function hashSeed(value: string): number {
  const hash = createHash("sha256").update(value).digest()
  return hash.readUInt32LE(0)
}

function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount
}

function floatToInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value))
  return Math.round(clamped * 32767)
}

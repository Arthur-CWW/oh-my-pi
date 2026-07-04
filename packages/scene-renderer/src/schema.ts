import { Option, Schema, SchemaIssue } from "effect"

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export type AssetKind = "image" | "videoFrames" | "audio"
export type ObjectKind = "plane" | "sprite" | "text" | "group"
export type CloneLayout = "grid" | "orbit" | "spiral" | "line" | "scatter"
export type TrackProp =
  | "position.x"
  | "position.y"
  | "position.z"
  | "rotation.x"
  | "rotation.y"
  | "rotation.z"
  | "scale"
  | "opacity"
export type TrackMode = "keyframes" | "osc" | "beat"
export type Ease = "linear" | "inOut" | "outElastic"
export type PostPass = "bloom" | "chromaticAberration" | "vhs" | "glitch" | "feedback" | "displacement" | "halftone"

export type Vec2 = readonly [number, number]
export type Vec3 = readonly [number, number, number]

export interface TimelineSpec {
  readonly bpm: number
  readonly beats?: readonly number[]
}

export interface SceneAsset {
  readonly id: string
  readonly kind: AssetKind
  readonly path: string
  readonly frameCount?: number
}

export interface CameraSpec {
  readonly fov: number
  readonly position: Vec3
  readonly lookAt: Vec3
  readonly tracks: readonly TrackSpec[]
}

export interface KeyframeSpec {
  readonly t: number
  readonly v: number
  readonly ease: Ease
}

export interface OscTrackSpec {
  readonly amp: number
  readonly freqBeats: number
  readonly phasePerClone: number
  readonly center: number
}

export interface BeatTrackSpec {
  readonly every: number
  readonly from: number
  readonly to: number
  readonly attack: number
  readonly decay: number
}

export interface TrackSpec {
  readonly prop: TrackProp
  readonly mode: TrackMode
  readonly keyframes?: readonly KeyframeSpec[]
  readonly osc?: OscTrackSpec
  readonly beat?: BeatTrackSpec
}

export interface CloneSpec {
  readonly count: number
  readonly layout: CloneLayout
  readonly spacing: number
  readonly radius: number
  readonly seed: number
  readonly stagger: number
}

export interface SceneObjectSpec {
  readonly id: string
  readonly kind: ObjectKind
  readonly asset?: string
  readonly text?: string
  readonly font?: string
  readonly color: string
  readonly size: Vec2
  readonly position: Vec3
  readonly rotation: Vec3
  readonly scale: number
  readonly opacity: number
  readonly clone?: CloneSpec
  readonly tracks: readonly TrackSpec[]
}

export interface BeatReactiveSpec {
  readonly param: string
  readonly every: number
  readonly amount: number
  readonly decay: number
}

export interface PostSpec {
  readonly pass: PostPass
  readonly params: { readonly [key: string]: JsonValue }
  readonly beatReactive?: BeatReactiveSpec
}

export interface AudioSpec {
  readonly asset: string
  readonly offsetSeconds: number
  readonly gainDb: number
}

export interface SceneSpec {
  readonly schemaVersion: "scene.v1"
  readonly width: number
  readonly height: number
  readonly fps: number
  readonly durationSeconds: number
  readonly background: string
  readonly timeline: TimelineSpec
  readonly assets: readonly SceneAsset[]
  readonly camera: CameraSpec
  readonly objects: readonly SceneObjectSpec[]
  readonly post: readonly PostSpec[]
  readonly audio?: AudioSpec
}

const JsonValueSchema: Schema.Codec<JsonValue> = Schema.suspend((): Schema.Codec<JsonValue> =>
  Schema.Union([
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(JsonValueSchema),
    Schema.Record(Schema.String, JsonValueSchema),
  ]),
)

const PositiveNumber = Schema.Number.check(Schema.isGreaterThan(0))
const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))
const Vec2Schema = Schema.Tuple([Schema.Number, Schema.Number])
const Vec3Schema = Schema.Tuple([Schema.Number, Schema.Number, Schema.Number])
const EmptyJsonRecordSchema = Schema.Record(Schema.String, JsonValueSchema)

export const AssetSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Union([Schema.Literal("image"), Schema.Literal("videoFrames"), Schema.Literal("audio")]),
  path: Schema.String,
  frameCount: Schema.optional(NonNegativeNumber),
})

export const KeyframeSchema = Schema.Struct({
  t: NonNegativeNumber,
  v: Schema.Number,
  ease: Schema.optional(Schema.Union([Schema.Literal("linear"), Schema.Literal("inOut"), Schema.Literal("outElastic")])),
})

export const OscTrackSchema = Schema.Struct({
  amp: Schema.Number,
  freqBeats: PositiveNumber,
  phasePerClone: Schema.optional(Schema.Number),
  center: Schema.optional(Schema.Number),
})

export const BeatTrackSchema = Schema.Struct({
  every: PositiveNumber,
  from: Schema.Number,
  to: Schema.Number,
  attack: NonNegativeNumber,
  decay: NonNegativeNumber,
})

export const TrackSchema = Schema.Struct({
  prop: Schema.Union([
    Schema.Literal("position.x"),
    Schema.Literal("position.y"),
    Schema.Literal("position.z"),
    Schema.Literal("rotation.x"),
    Schema.Literal("rotation.y"),
    Schema.Literal("rotation.z"),
    Schema.Literal("scale"),
    Schema.Literal("opacity"),
  ]),
  mode: Schema.Union([Schema.Literal("keyframes"), Schema.Literal("osc"), Schema.Literal("beat")]),
  keyframes: Schema.optional(Schema.Array(KeyframeSchema)),
  osc: Schema.optional(OscTrackSchema),
  beat: Schema.optional(BeatTrackSchema),
})

export const CloneSchema = Schema.Struct({
  count: PositiveNumber,
  layout: Schema.Union([
    Schema.Literal("grid"),
    Schema.Literal("orbit"),
    Schema.Literal("spiral"),
    Schema.Literal("line"),
    Schema.Literal("scatter"),
  ]),
  spacing: Schema.optional(PositiveNumber),
  radius: Schema.optional(NonNegativeNumber),
  seed: Schema.optional(Schema.Number),
  stagger: Schema.optional(NonNegativeNumber),
})

export const ObjectSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Union([Schema.Literal("plane"), Schema.Literal("sprite"), Schema.Literal("text"), Schema.Literal("group")]),
  asset: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  font: Schema.optional(Schema.String),
  color: Schema.optional(Schema.String),
  size: Schema.optional(Vec2Schema),
  position: Schema.optional(Vec3Schema),
  rotation: Schema.optional(Vec3Schema),
  scale: Schema.optional(PositiveNumber),
  opacity: Schema.optional(NonNegativeNumber),
  clone: Schema.optional(CloneSchema),
  tracks: Schema.optional(Schema.Array(TrackSchema)),
})

export const TimelineSchema = Schema.Struct({
  bpm: Schema.optional(PositiveNumber),
  beats: Schema.optional(Schema.Array(NonNegativeNumber)),
})

export const CameraSchema = Schema.Struct({
  fov: Schema.optional(PositiveNumber),
  position: Schema.optional(Vec3Schema),
  lookAt: Schema.optional(Vec3Schema),
  tracks: Schema.optional(Schema.Array(TrackSchema)),
})

export const BeatReactiveSchema = Schema.Struct({
  param: Schema.String,
  every: PositiveNumber,
  amount: Schema.Number,
  decay: NonNegativeNumber,
})

export const PostSchema = Schema.Struct({
  pass: Schema.Union([
    Schema.Literal("bloom"),
    Schema.Literal("chromaticAberration"),
    Schema.Literal("vhs"),
    Schema.Literal("glitch"),
    Schema.Literal("feedback"),
    Schema.Literal("displacement"),
    Schema.Literal("halftone"),
  ]),
  params: Schema.optional(EmptyJsonRecordSchema),
  beatReactive: Schema.optional(BeatReactiveSchema),
})

export const AudioSchema = Schema.Struct({
  asset: Schema.String,
  offsetSeconds: Schema.optional(Schema.Number),
  gainDb: Schema.optional(Schema.Number),
})

export const SceneSpecSchema = Schema.Struct({
  schemaVersion: Schema.Literal("scene.v1"),
  width: PositiveNumber,
  height: PositiveNumber,
  fps: PositiveNumber,
  durationSeconds: PositiveNumber,
  background: Schema.optional(Schema.String),
  timeline: Schema.optional(TimelineSchema),
  assets: Schema.optional(Schema.Array(AssetSchema)),
  camera: Schema.optional(CameraSchema),
  objects: Schema.optional(Schema.Array(ObjectSchema)),
  post: Schema.optional(Schema.Array(PostSchema)),
  audio: Schema.optional(AudioSchema),
})

type RawSceneSpec = Schema.Schema.Type<typeof SceneSpecSchema>
type RawTrackSpec = Schema.Schema.Type<typeof TrackSchema>
type RawObjectSpec = Schema.Schema.Type<typeof ObjectSchema>
type RawCloneSpec = Schema.Schema.Type<typeof CloneSchema>
type RawPostSpec = Schema.Schema.Type<typeof PostSchema>
type RawAudioSpec = Schema.Schema.Type<typeof AudioSchema>

export function decodeSceneSpec(json: unknown): SceneSpec {
  try {
    return normalizeSceneSpec(Schema.decodeUnknownSync(SceneSpecSchema)(json, { errors: "all" }))
  } catch (error) {
    if (Schema.isSchemaError(error)) {
      throw new Error(formatSchemaIssues(error.issue).join("\n"))
    }
    throw error
  }
}

export function parseJsonText(text: string): unknown {
  try {
    return Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`invalid JSON: ${message}`)
  }
}

export function formatSchemaIssues(issue: SchemaIssue.Issue): readonly string[] {
  const formatted = SchemaIssue.makeFormatterStandardSchemaV1({ leafHook: formatLeafIssue })(issue)
  return formatted.issues.map((entry) => `${formatPath(entry.path)}: ${entry.message}`)
}

function normalizeSceneSpec(raw: RawSceneSpec): SceneSpec {
  return {
    schemaVersion: raw.schemaVersion,
    width: raw.width,
    height: raw.height,
    fps: raw.fps,
    durationSeconds: raw.durationSeconds,
    background: raw.background ?? "#000000",
    timeline: {
      bpm: raw.timeline?.bpm ?? 120,
      beats: raw.timeline?.beats,
    },
    assets: raw.assets ?? [],
    camera: {
      fov: raw.camera?.fov ?? 50,
      position: raw.camera?.position ?? [0, 0, 8],
      lookAt: raw.camera?.lookAt ?? [0, 0, 0],
      tracks: normalizeTracks(raw.camera?.tracks),
    },
    objects: (raw.objects ?? []).map(normalizeObject),
    post: (raw.post ?? []).map(normalizePost),
    audio: raw.audio ? normalizeAudio(raw.audio) : undefined,
  }
}

function normalizeObject(raw: RawObjectSpec): SceneObjectSpec {
  return {
    id: raw.id,
    kind: raw.kind,
    asset: raw.asset,
    text: raw.text,
    font: raw.font,
    color: raw.color ?? "#ffffff",
    size: raw.size ?? [1, 1],
    position: raw.position ?? [0, 0, 0],
    rotation: raw.rotation ?? [0, 0, 0],
    scale: raw.scale ?? 1,
    opacity: raw.opacity ?? 1,
    clone: raw.clone ? normalizeClone(raw.clone) : undefined,
    tracks: normalizeTracks(raw.tracks),
  }
}

function normalizeClone(raw: RawCloneSpec): CloneSpec {
  return {
    count: raw.count,
    layout: raw.layout,
    spacing: raw.spacing ?? 1,
    radius: raw.radius ?? 1,
    seed: raw.seed ?? 1,
    stagger: raw.stagger ?? 0,
  }
}

function normalizeTracks(raw: readonly RawTrackSpec[] | undefined): readonly TrackSpec[] {
  return (raw ?? []).map((track) => ({
    prop: track.prop,
    mode: track.mode,
    keyframes: track.keyframes?.map((keyframe) => ({
      t: keyframe.t,
      v: keyframe.v,
      ease: keyframe.ease ?? "linear",
    })),
    osc: track.osc
      ? {
          amp: track.osc.amp,
          freqBeats: track.osc.freqBeats,
          phasePerClone: track.osc.phasePerClone ?? 0,
          center: track.osc.center ?? 0,
        }
      : undefined,
    beat: track.beat,
  }))
}

function normalizePost(raw: RawPostSpec): PostSpec {
  return {
    pass: raw.pass,
    params: raw.params ?? {},
    beatReactive: raw.beatReactive,
  }
}

function normalizeAudio(raw: RawAudioSpec): AudioSpec {
  return {
    asset: raw.asset,
    offsetSeconds: raw.offsetSeconds ?? 0,
    gainDb: raw.gainDb ?? 0,
  }
}

function formatLeafIssue(issue: SchemaIssue.Leaf): string {
  if (issue._tag === "InvalidType") {
    const defaultMessage = SchemaIssue.defaultLeafHook(issue)
    const expected = expectedFromDefaultMessage(defaultMessage)
    return `expected ${expected}, got ${actualTypeFromOption(issue.actual)}`
  }
  return lowercaseFirst(SchemaIssue.defaultLeafHook(issue))
}

function expectedFromDefaultMessage(message: string): string {
  const prefix = "Expected "
  const separator = ", got "
  if (message.startsWith(prefix) && message.includes(separator)) {
    return message.slice(prefix.length, message.indexOf(separator)).toLowerCase()
  }
  return lowercaseFirst(message)
}

function actualTypeFromOption(value: Option.Option<unknown>): string {
  if (!Option.isSome(value)) return "missing"
  return describeActualType(value.value)
}

function describeActualType(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function lowercaseFirst(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toLowerCase() ?? ""}${value.slice(1)}`
}

function formatPath(path: readonly (PropertyKey | { readonly key: PropertyKey })[] | undefined): string {
  if (!path || path.length === 0) return "scene"
  let output = ""
  for (const segment of path) {
    const keyOrIndex = typeof segment === "object" && segment !== null ? segment.key : segment
    if (typeof keyOrIndex === "number") {
      output += `[${keyOrIndex}]`
    } else {
      const key = String(keyOrIndex)
      output += output.length === 0 ? key : `.${key}`
    }
  }
  return output
}

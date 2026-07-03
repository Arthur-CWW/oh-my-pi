export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];

export type AssetKind = "image" | "videoFrames" | "audio";
export type ObjectKind = "plane" | "sprite" | "text" | "group";
export type CloneLayout = "grid" | "orbit" | "spiral" | "line" | "scatter";
export type TrackProp =
  | "position.x"
  | "position.y"
  | "position.z"
  | "rotation.x"
  | "rotation.y"
  | "rotation.z"
  | "scale"
  | "opacity";
export type TrackMode = "keyframes" | "osc" | "beat";
export type EaseName = "linear" | "inOut" | "outElastic";
export type PostPassName = "bloom" | "chromaticAberration" | "vhs" | "glitch";

export interface SceneSpec {
  schemaVersion: "scene.v1";
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  background?: string;
  timeline?: TimelineSpec;
  assets?: SceneAsset[];
  camera?: CameraSpec;
  objects?: SceneObjectSpec[];
  post?: PostSpec[];
  audio?: AudioSpec;
}

export interface TimelineSpec {
  bpm?: number;
  beats?: number[];
}

export interface SceneAsset {
  id: string;
  kind: AssetKind;
  path: string;
  frameCount?: number;
}

export interface CameraSpec {
  fov?: number;
  position?: Vec3;
  lookAt?: Vec3;
  tracks?: TrackSpec[];
}

export interface SceneObjectSpec {
  id: string;
  kind: ObjectKind;
  asset?: string;
  text?: string;
  font?: string;
  color?: string;
  size?: Vec2;
  position?: Vec3;
  rotation?: Vec3;
  scale?: number;
  opacity?: number;
  clone?: CloneSpec;
  tracks?: TrackSpec[];
}

export interface CloneSpec {
  count?: number;
  layout?: CloneLayout;
  spacing?: number;
  radius?: number;
  seed?: number;
  stagger?: number;
}

export interface TrackSpec {
  prop: TrackProp;
  mode: TrackMode;
  keyframes?: KeyframeSpec[];
  osc?: OscSpec;
  beat?: BeatSpec;
}

export interface KeyframeSpec {
  t: number;
  v: number;
  ease?: EaseName;
}

export interface OscSpec {
  amp?: number;
  freqBeats?: number;
  phasePerClone?: number;
  center?: number;
}

export interface BeatSpec {
  every?: number;
  from?: number;
  to?: number;
  attack?: number;
  decay?: number;
}

export interface PostSpec {
  pass: PostPassName;
  params?: Record<string, number>;
  beatReactive?: BeatReactiveSpec;
}

export interface BeatReactiveSpec {
  param: string;
  every?: number;
  amount?: number;
  decay?: number;
}

export interface AudioSpec {
  asset: string;
  offsetSeconds?: number;
  gainDb?: number;
}

export const defaultCameraPosition: Vec3 = [0, 0, 8];
export const defaultLookAt: Vec3 = [0, 0, 0];

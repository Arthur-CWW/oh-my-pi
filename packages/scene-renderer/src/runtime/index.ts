import * as THREE from "three";
import { loadAssets, textureForAsset, type RuntimeAssetMap } from "./assets";
import { buildObject, disposeBuiltObject, type BuiltObject } from "./builders";
import { cloneTransforms } from "./layouts";
import { defaultCameraPosition, defaultLookAt, type SceneObjectSpec, type SceneSpec, type TrackProp } from "./spec";
import { durationInFrames as framesForDuration, evaluateTrack, playbackFrameForNow } from "./timeline";
import { bloomPass, chromaticAberrationPass, glitchPass, PostChain, vhsPass, type ConfiguredPass, type ScenePass } from "./post";

export interface SceneRuntimeGlobal {
  init(spec: unknown, opts: { width: number; height: number; fps: number; assetBaseUrl: string }): Promise<void>;
  renderFrame(frame: number): void;
  durationInFrames(): number;
  start(): void;
  stop(): void;
}

type AxisName = "x" | "y" | "z";

interface RuntimeState {
  spec: SceneSpec;
  opts: { width: number; height: number; fps: number; assetBaseUrl: string };
  renderer: THREE.WebGLRenderer;
  assets: RuntimeAssetMap;
  canvas: HTMLCanvasElement;
  postChain: PostChain;
  raf: number | undefined;
  timer: number | undefined;
  startedAt: number;
}

let state: RuntimeState | undefined;

async function init(specInput: unknown, opts: { width: number; height: number; fps: number; assetBaseUrl: string }): Promise<void> {
  stop();
  disposeState();
  const spec = specInput as SceneSpec;
  const canvas = document.createElement("canvas");
  canvas.id = "scene";
  canvas.width = opts.width;
  canvas.height = opts.height;
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(opts.width, opts.height, false);
  renderer.setPixelRatio(1);
  renderer.setClearColor(new THREE.Color(spec.background ?? "#0a0a0c"), 1);
  const assets = await loadAssets(spec.assets, opts.assetBaseUrl);
  const postChain = new PostChain(renderer, opts.width, opts.height, configuredPasses(spec));
  state = { spec, opts, renderer, assets, canvas, postChain, raf: undefined, timer: undefined, startedAt: 0 };
  renderFrame(0);
}

function renderFrame(frame: number): void {
  const current = state;
  if (!current) return;
  const fps = current.spec.fps || current.opts.fps;
  const timeSeconds = frame / fps;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(current.spec.background ?? "#0a0a0c");
  const camera = buildCamera(current.spec, current.opts.width / current.opts.height, timeSeconds, fps);
  const builtObjects: BuiltObject[] = [];
  for (const objectSpec of current.spec.objects ?? []) {
    buildObjectClones(objectSpec, current, frame, timeSeconds, fps, scene, builtObjects);
  }
  current.postChain.render(scene, camera, timeSeconds, current.spec.timeline);
  for (const built of builtObjects) disposeBuiltObject(built);
}

function durationInFrames(): number {
  const current = state;
  if (!current) return 0;
  return framesForDuration(current.spec.durationSeconds, current.spec.fps || current.opts.fps);
}

function start(): void {
  const current = state;
  if (!current || current.raf !== undefined || current.timer !== undefined) return;
  current.startedAt = performance.now();
  const fps = current.spec.fps || current.opts.fps;
  const durationSec = current.spec.durationSeconds;
  const tick = (now: number, scheduleNext: boolean) => {
    const live = state;
    if (!live || (live.raf === undefined && live.timer === undefined)) return;
    const frame = playbackFrameForNow(now, live.startedAt, fps, durationSec == null ? null : Math.ceil(durationSec * fps));
    renderFrame(frame);
    if (scheduleNext && live.raf !== undefined) live.raf = requestAnimationFrame((nextNow) => tick(nextNow, true));
  };
  current.raf = requestAnimationFrame((now) => tick(now, true));
  current.timer = window.setInterval(() => tick(performance.now(), false), Math.max(16, Math.floor(1000 / fps)));
}

function stop(): void {
  const current = state;
  if (!current) return;
  if (current.raf !== undefined) cancelAnimationFrame(current.raf);
  if (current.timer !== undefined) window.clearInterval(current.timer);
  current.raf = undefined;
  current.timer = undefined;
}

function buildCamera(spec: SceneSpec, aspect: number, timeSeconds: number, fps: number): THREE.PerspectiveCamera {
  const cameraSpec = spec.camera ?? {};
  const camera = new THREE.PerspectiveCamera(cameraSpec.fov ?? 50, aspect, 0.01, 1000);
  const position = cameraSpec.position ?? defaultCameraPosition;
  camera.position.set(position[0], position[1], position[2]);
  const lookAt = cameraSpec.lookAt ?? defaultLookAt;
  camera.lookAt(lookAt[0], lookAt[1], lookAt[2]);
  const basePosition = camera.position.clone();
  const baseRotation = camera.rotation.clone();
  for (const track of cameraSpec.tracks ?? []) {
    applyTrack(track.prop, evaluateTrack(track, { timeSeconds, cloneIndex: 0, fps, timeline: spec.timeline }), camera, undefined, basePosition, baseRotation, camera.scale.clone());
  }
  camera.updateProjectionMatrix();
  return camera;
}

function buildObjectClones(
  objectSpec: SceneObjectSpec,
  current: RuntimeState,
  frame: number,
  timeSeconds: number,
  fps: number,
  scene: THREE.Scene,
  builtObjects: BuiltObject[],
): void {
  const clones = cloneTransforms(objectSpec.clone);
  const basePosition = objectSpec.position ?? [0, 0, 0];
  const baseRotation = objectSpec.rotation ?? [0, 0, 0];
  const baseScale = objectSpec.scale ?? 1;
  const asset = objectSpec.asset ? current.assets.get(objectSpec.asset) : undefined;
  for (const clone of clones) {
    const built = buildObject(objectSpec, textureForAsset(asset, frame, current.opts.assetBaseUrl));
    built.root.name = `${objectSpec.id}:${clone.index}`;
    built.root.position.set(basePosition[0] + clone.position[0], basePosition[1] + clone.position[1], basePosition[2] + clone.position[2]);
    built.root.rotation.set(baseRotation[0] + clone.rotation[0], baseRotation[1] + clone.rotation[1], baseRotation[2] + clone.rotation[2]);
    built.root.scale.multiplyScalar(baseScale * clone.scale);
    const positionBeforeTracks = built.root.position.clone();
    const rotationBeforeTracks = built.root.rotation.clone();
    const scaleBeforeTracks = built.root.scale.clone();
    for (const track of objectSpec.tracks ?? []) {
      const value = evaluateTrack(track, { timeSeconds, cloneIndex: clone.index, fps, timeline: current.spec.timeline, cloneStagger: objectSpec.clone?.stagger ?? 0 });
      applyTrack(track.prop, value, built.root, built.material, positionBeforeTracks, rotationBeforeTracks, scaleBeforeTracks);
    }
    scene.add(built.root);
    builtObjects.push(built);
  }
}

function applyTrack(
  prop: TrackProp,
  value: number,
  object: THREE.Object3D,
  material: BuiltObject["material"],
  basePosition: THREE.Vector3,
  baseRotation: THREE.Euler,
  baseScale: THREE.Vector3,
): void {
  if (prop === "scale") {
    object.scale.copy(baseScale).multiplyScalar(value);
    return;
  }
  if (prop === "opacity") {
    if (material) {
      material.opacity = value;
      material.transparent = value < 1;
      material.needsUpdate = true;
    }
    return;
  }
  const axis = prop.charAt(prop.length - 1) as AxisName;
  if (prop.startsWith("position")) object.position[axis] = basePosition[axis] + value;
  if (prop.startsWith("rotation")) object.rotation[axis] = baseRotation[axis] + value;
}

function configuredPasses(spec: SceneSpec): ConfiguredPass[] {
  const passMap: Record<string, () => ScenePass> = {
    bloom: bloomPass,
    chromaticAberration: chromaticAberrationPass,
    vhs: vhsPass,
    glitch: glitchPass,
  };
  const configured: ConfiguredPass[] = [];
  for (const post of spec.post ?? []) {
    const makePass = passMap[post.pass];
    if (makePass) configured.push({ pass: makePass(), config: post });
  }
  return configured;
}

function disposeState(): void {
  const current = state;
  if (!current) return;
  current.postChain.dispose();
  current.renderer.dispose();
  current.canvas.remove();
  state = undefined;
}

const runtime: SceneRuntimeGlobal = { init, renderFrame, durationInFrames, start, stop };

declare global {
  interface Window {
    SceneRuntime: SceneRuntimeGlobal;
  }
}

if (typeof window !== "undefined") window.SceneRuntime = runtime;

export default runtime;

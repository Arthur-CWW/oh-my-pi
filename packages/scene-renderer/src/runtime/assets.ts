import * as THREE from "three";
import type { SceneAsset } from "./spec";

export interface ImageRuntimeAsset {
  id: string;
  kind: "image";
  texture: THREE.Texture;
}

export interface VideoFramesRuntimeAsset {
  id: string;
  kind: "videoFrames";
  path: string;
  frameCount: number;
  cache: Map<number, THREE.Texture>;
  pending: Map<number, Promise<THREE.Texture>>;
  fallback: THREE.Texture;
}

export interface AudioRuntimeAsset {
  id: string;
  kind: "audio";
}

export type RuntimeAsset = ImageRuntimeAsset | VideoFramesRuntimeAsset | AudioRuntimeAsset;
export type RuntimeAssetMap = Map<string, RuntimeAsset>;

const videoCacheLimit = 8;

export async function loadAssets(assets: readonly SceneAsset[] | undefined, assetBaseUrl: string): Promise<RuntimeAssetMap> {
  const map: RuntimeAssetMap = new Map();
  const loader = new THREE.TextureLoader();
  await Promise.all(
    (assets ?? []).map(async (asset) => {
      if (asset.kind === "audio") {
        map.set(asset.id, { id: asset.id, kind: "audio" });
        return;
      }
      if (asset.kind === "videoFrames") {
        const frameCount = Math.max(1, Math.floor(asset.frameCount ?? 1));
        const fallback = await loadTexture(loader, `${assetBaseUrl}/${asset.path}/000001.png`);
        const cache = new Map<number, THREE.Texture>();
        cache.set(1, fallback);
        map.set(asset.id, { id: asset.id, kind: "videoFrames", path: asset.path, frameCount, cache, pending: new Map(), fallback });
        return;
      }
      map.set(asset.id, { id: asset.id, kind: "image", texture: await loadTexture(loader, `${assetBaseUrl}/${asset.path}`) });
    }),
  );
  return map;
}

export function textureForAsset(asset: RuntimeAsset | undefined, frame: number, assetBaseUrl: string): THREE.Texture | undefined {
  if (!asset || asset.kind === "audio") return undefined;
  if (asset.kind === "image") return asset.texture;
  const oneBasedFrame = (Math.max(0, frame) % asset.frameCount) + 1;
  const cached = asset.cache.get(oneBasedFrame);
  if (cached) {
    asset.cache.delete(oneBasedFrame);
    asset.cache.set(oneBasedFrame, cached);
    return cached;
  }
  if (!asset.pending.has(oneBasedFrame)) {
    const loader = new THREE.TextureLoader();
    const path = `${assetBaseUrl}/${asset.path}/${String(oneBasedFrame).padStart(6, "0")}.png`;
    const request = loadTexture(loader, path).then((texture) => {
      asset.pending.delete(oneBasedFrame);
      asset.cache.set(oneBasedFrame, texture);
      while (asset.cache.size > videoCacheLimit) {
        const oldest = asset.cache.keys().next().value;
        if (typeof oldest !== "number") break;
        const oldTexture = asset.cache.get(oldest);
        if (oldTexture && oldTexture !== asset.fallback) oldTexture.dispose();
        asset.cache.delete(oldest);
      }
      return texture;
    });
    asset.pending.set(oneBasedFrame, request);
  }
  return asset.fallback;
}

function loadTexture(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture> {
  const { promise, resolve, reject } = Promise.withResolvers<THREE.Texture>();
  loader.load(
    url,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      resolve(texture);
    },
    undefined,
    reject,
  );
  return promise;
}

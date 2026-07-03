import * as THREE from "three";
import type { SceneObjectSpec, Vec2 } from "./spec";

export type SceneMaterial = THREE.MeshBasicMaterial | THREE.SpriteMaterial;

export interface BuiltObject {
  root: THREE.Object3D;
  material?: SceneMaterial;
}

export function buildObject(spec: SceneObjectSpec, texture: THREE.Texture | undefined): BuiltObject {
  if (spec.kind === "sprite") return buildSprite(spec, texture);
  if (spec.kind === "text") return buildText(spec);
  if (spec.kind === "group") return { root: new THREE.Group() };
  return buildPlane(spec, texture);
}

function buildPlane(spec: SceneObjectSpec, texture: THREE.Texture | undefined): BuiltObject {
  const size = spec.size ?? [3, 4];
  const geometry = new THREE.PlaneGeometry(size[0], size[1]);
  const material = new THREE.MeshBasicMaterial({ color: texture ? 0xffffff : spec.color ?? "#ffffff", map: texture, transparent: true, opacity: spec.opacity ?? 1 });
  return { root: new THREE.Mesh(geometry, material), material };
}

function buildSprite(spec: SceneObjectSpec, texture: THREE.Texture | undefined): BuiltObject {
  const material = new THREE.SpriteMaterial({ color: texture ? 0xffffff : spec.color ?? "#ffffff", map: texture, transparent: true, opacity: spec.opacity ?? 1 });
  const sprite = new THREE.Sprite(material);
  const size = spec.size ?? [3, 3];
  sprite.scale.set(size[0], size[1], 1);
  return { root: sprite, material };
}

function buildText(spec: SceneObjectSpec): BuiltObject {
  const canvas = document.createElement("canvas");
  const size = spec.size ?? [4, 1];
  canvas.width = Math.max(64, Math.ceil(size[0] * 256));
  canvas.height = Math.max(64, Math.ceil(size[1] * 256));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = spec.color ?? "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = spec.font ?? `${Math.floor(canvas.height * 0.55)}px sans-serif`;
    ctx.fillText(spec.text ?? "", canvas.width / 2, canvas.height / 2, canvas.width * 0.94);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: spec.opacity ?? 1 });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(size[0], size[1], 1);
  return { root: sprite, material };
}

export function disposeBuiltObject(built: BuiltObject): void {
  built.root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
  if (built.material) {
    const mapped = built.material.map;
    if (mapped instanceof THREE.CanvasTexture) mapped.dispose();
    built.material.dispose();
  }
}

export function setObjectBaseTransform(object: THREE.Object3D, position: readonly [number, number, number], rotation: readonly [number, number, number], scale: number): void {
  object.position.set(position[0], position[1], position[2]);
  object.rotation.set(rotation[0], rotation[1], rotation[2]);
  object.scale.multiplyScalar(scale);
}

export function sizeToScale(size: Vec2 | undefined): number {
  return Math.max(size?.[0] ?? 1, size?.[1] ?? 1);
}

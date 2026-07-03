import {
  BufferAttribute,
  BufferGeometry,
  OrthographicCamera,
  Mesh,
  RawShaderMaterial,
  Scene,
  Texture,
  Vector2,
  WebGLRenderTarget,
} from "three";
import type { PassContext } from "../types";

const vertexShader = `
precision highp float;
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const geometry = new BufferGeometry();
geometry.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
geometry.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
const scene = new Scene();
const mesh = new Mesh(geometry);
scene.add(mesh);

export type NumericUniformMap = Record<string, { value: number }>;

export const makeMaterial = (
  fragmentShader: string,
  uniforms: Record<string, { value: number | Texture | Vector2 | null }>,
): RawShaderMaterial =>
  new RawShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms,
    vertexShader,
    fragmentShader,
  });

export const renderFullscreen = (ctx: PassContext, material: RawShaderMaterial, target: WebGLRenderTarget): void => {
  mesh.material = material;
  ctx.renderer.setRenderTarget(target);
  ctx.renderer.render(scene, camera);
};

export const setResolution = (target: WebGLRenderTarget, resolution: Vector2): void => {
  if (resolution.x !== target.width || resolution.y !== target.height) {
    resolution.set(target.width, target.height);
  }
};

export const makeSetParam = (passName: string, uniforms: NumericUniformMap): ((name: string, value: number) => void) => {
  const warned = new Set<string>();
  return (name: string, value: number): void => {
    const uniform = uniforms[name];
    if (uniform) {
      uniform.value = value;
      return;
    }
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`${passName} pass ignored unknown param: ${name}`);
    }
  };
};

export const ensureTargetSize = (target: WebGLRenderTarget, width: number, height: number): void => {
  if (target.width !== width || target.height !== height) {
    target.setSize(width, height);
  }
};

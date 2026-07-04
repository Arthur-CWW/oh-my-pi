import * as THREE from "three";

export interface PassContext {
  renderer: THREE.WebGLRenderer;
  readTarget: THREE.WebGLRenderTarget;
  writeTarget: THREE.WebGLRenderTarget;
  historyTarget: THREE.WebGLRenderTarget | null;
  scene: THREE.Scene;
  camera: THREE.Camera;
  timeSeconds: number;
  beatEnv: number;
}

export interface ScenePass {
  name: string;
  setParam(name: string, value: number): void;
  render(ctx: PassContext): void;
}

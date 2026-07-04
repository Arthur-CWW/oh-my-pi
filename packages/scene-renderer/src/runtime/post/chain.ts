import * as THREE from "three";
import { beatReactiveValue } from "../timeline";
import type { PostSpec, TimelineSpec } from "../spec";
import type { ScenePass } from "./types";

export interface ConfiguredPass {
  pass: ScenePass;
  config: PostSpec;
}

export class PostChain {
  readonly #renderer: THREE.WebGLRenderer;
  readonly #readTarget: THREE.WebGLRenderTarget;
  readonly #writeTarget: THREE.WebGLRenderTarget;
  readonly #historyTarget: THREE.WebGLRenderTarget;
  readonly #hasFeedback: boolean;
  readonly #copyScene = new THREE.Scene();
  readonly #copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly #copyMaterial = new THREE.MeshBasicMaterial();
  readonly #copyMesh: THREE.Mesh;
  readonly #passes: ConfiguredPass[];

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number, passes: ConfiguredPass[]) {
    this.#renderer = renderer;
    this.#readTarget = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, stencilBuffer: false });
    this.#writeTarget = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, stencilBuffer: false });
    this.#historyTarget = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, stencilBuffer: false });
    this.#hasFeedback = passes.some((p) => p.config.pass === "feedback");
    this.#copyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.#copyMaterial);
    this.#copyScene.add(this.#copyMesh);
    this.#passes = passes;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, timeSeconds: number, timeline: TimelineSpec | undefined, frame: number): void {
    if (this.#hasFeedback && frame === 0) {
      this.#renderer.setRenderTarget(this.#historyTarget);
      this.#renderer.clear();
    }
    if (this.#passes.length === 0) {
      this.#renderer.setRenderTarget(null);
      this.#renderer.render(scene, camera);
      return;
    }
    let readTarget = this.#readTarget;
    let writeTarget = this.#writeTarget;
    this.#renderer.setRenderTarget(readTarget);
    this.#renderer.clear();
    this.#renderer.render(scene, camera);
    const historyTarget = this.#hasFeedback ? this.#historyTarget : null;
    for (const configured of this.#passes) {
      for (const [name, value] of Object.entries(configured.config.params ?? {})) configured.pass.setParam(name, value);
      const reactive = configured.config.beatReactive;
      const beatEnv = reactive ? beatReactiveValue(timeSeconds, timeline, reactive) : 0;
      if (reactive) configured.pass.setParam(reactive.param, (configured.config.params?.[reactive.param] ?? 0) + beatEnv);
      configured.pass.render({ renderer: this.#renderer, readTarget, writeTarget, historyTarget, scene, camera, timeSeconds, beatEnv });
      const previousRead = readTarget;
      readTarget = writeTarget;
      writeTarget = previousRead;
    }
    if (this.#hasFeedback) {
      this.#copyMaterial.map = readTarget.texture;
      this.#copyMaterial.needsUpdate = true;
      this.#renderer.setRenderTarget(this.#historyTarget);
      this.#renderer.render(this.#copyScene, this.#copyCamera);
    }
    this.#copyMaterial.map = readTarget.texture;
    this.#copyMaterial.needsUpdate = true;
    this.#renderer.setRenderTarget(null);
    this.#renderer.render(this.#copyScene, this.#copyCamera);
  }

  dispose(): void {
    this.#readTarget.dispose();
    this.#writeTarget.dispose();
    this.#historyTarget.dispose();
    this.#copyMaterial.dispose();
    this.#copyMesh.geometry.dispose();
  }
}

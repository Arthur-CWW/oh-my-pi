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
  readonly #copyScene = new THREE.Scene();
  readonly #copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly #copyMaterial = new THREE.MeshBasicMaterial();
  readonly #copyMesh: THREE.Mesh;
  readonly #passes: ConfiguredPass[];

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number, passes: ConfiguredPass[]) {
    this.#renderer = renderer;
    this.#readTarget = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, stencilBuffer: false });
    this.#writeTarget = new THREE.WebGLRenderTarget(width, height, { depthBuffer: false, stencilBuffer: false });
    this.#copyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.#copyMaterial);
    this.#copyScene.add(this.#copyMesh);
    this.#passes = passes;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, timeSeconds: number, timeline: TimelineSpec | undefined): void {
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
    for (const configured of this.#passes) {
      for (const [name, value] of Object.entries(configured.config.params ?? {})) configured.pass.setParam(name, value);
      const reactive = configured.config.beatReactive;
      const beatEnv = reactive ? beatReactiveValue(timeSeconds, timeline, reactive) : 0;
      if (reactive) configured.pass.setParam(reactive.param, (configured.config.params?.[reactive.param] ?? 0) + beatEnv);
      configured.pass.render({ renderer: this.#renderer, readTarget, writeTarget, scene, camera, timeSeconds, beatEnv });
      const previousRead = readTarget;
      readTarget = writeTarget;
      writeTarget = previousRead;
    }
    this.#copyMaterial.map = readTarget.texture;
    this.#copyMaterial.needsUpdate = true;
    this.#renderer.setRenderTarget(null);
    this.#renderer.render(this.#copyScene, this.#copyCamera);
  }

  dispose(): void {
    this.#readTarget.dispose();
    this.#writeTarget.dispose();
    this.#copyMaterial.dispose();
    this.#copyMesh.geometry.dispose();
  }
}

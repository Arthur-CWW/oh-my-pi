import { describe, expect, test } from "bun:test";
import { SpriteMaterial } from "three";
import { buildObject, disposeBuiltObject } from "../src/runtime/builders";
import type { SceneObjectSpec } from "../src/runtime/spec";

describe("sprite builder", () => {
  test("maps authored rotation.z to the billboard material", () => {
    const spec: SceneObjectSpec = {
      id: "card",
      kind: "sprite",
      color: "#ff3b1d",
      size: [4, 1],
      rotation: [0, 0, 0.7],
    };
    const built = buildObject(spec, undefined);

    expect(built.material).toBeInstanceOf(SpriteMaterial);
    expect((built.material as SpriteMaterial).rotation).toBeCloseTo(0.7);
    disposeBuiltObject(built);
  });
});

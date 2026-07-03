import type { ScenePass } from "../types";
import { beatScaled } from "./helpers";
import { makeMaterial, makeSetParam, renderFullscreen } from "./fullscreen";

const fragmentShader = `
precision highp float;
uniform sampler2D inputTexture;
uniform float strength;
uniform float barrel;
varying vec2 vUv;

vec2 barrelUv(vec2 uv, float amount) {
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);
  return 0.5 + centered * (1.0 + amount * r2);
}

void main() {
  vec2 uv = barrelUv(vUv, barrel);
  vec2 centered = uv - 0.5;
  vec2 direction = centered * strength;
  float red = texture2D(inputTexture, uv + direction).r;
  float green = texture2D(inputTexture, uv).g;
  float blue = texture2D(inputTexture, uv - direction).b;
  gl_FragColor = vec4(red, green, blue, texture2D(inputTexture, uv).a);
}
`;

export const chromaticAberrationDefaults = {
  strength: 0.005,
  barrel: 0.0,
} as const;

export const chromaticAberrationPass = (): ScenePass => {
  const params = {
    strength: { value: chromaticAberrationDefaults.strength },
    barrel: { value: chromaticAberrationDefaults.barrel },
  };
  const material = makeMaterial(fragmentShader, {
    inputTexture: { value: null },
    strength: { value: params.strength.value },
    barrel: params.barrel,
  });

  return {
    name: "chromaticAberration",
    setParam: makeSetParam("chromaticAberration", params),
    render(ctx) {
      material.uniforms.inputTexture.value = ctx.readTarget.texture;
      material.uniforms.strength.value = beatScaled(params.strength.value, ctx.beatEnv);
      renderFullscreen(ctx, material, ctx.writeTarget);
    },
  };
};

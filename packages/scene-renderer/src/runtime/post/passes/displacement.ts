import type { ScenePass } from "../types";
import { beatScaled } from "./helpers";
import { makeMaterial, makeSetParam, renderFullscreen } from "./fullscreen";

const fragmentShader = `
precision highp float;
uniform sampler2D inputTexture;
uniform float amplitude;
uniform float scale;
uniform float speed;
uniform float seed;
uniform float timeSeconds;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = vUv;
  float t = timeSeconds * speed + seed;
  vec2 noiseCoord = uv * scale + vec2(t * 0.7, t * 0.3);
  float nx = vnoise(noiseCoord) - 0.5;
  float ny = vnoise(noiseCoord + vec2(17.0, 31.0)) - 0.5;
  uv += vec2(nx, ny) * amplitude;
  gl_FragColor = vec4(texture2D(inputTexture, uv).rgb, 1.0);
}
`;

export const displacementDefaults = {
  amplitude: 0.008,
  scale: 4.0,
  speed: 0.3,
  seed: 0.0,
} as const;

export const displacementPass = (): ScenePass => {
  const params = {
    amplitude: { value: displacementDefaults.amplitude },
    scale: { value: displacementDefaults.scale },
    speed: { value: displacementDefaults.speed },
    seed: { value: displacementDefaults.seed },
  };
  const material = makeMaterial(fragmentShader, {
    inputTexture: { value: null },
    amplitude: { value: params.amplitude.value },
    scale: params.scale,
    speed: { value: params.speed.value },
    seed: params.seed,
    timeSeconds: { value: 0 },
  });

  return {
    name: "displacement",
    setParam: makeSetParam("displacement", params),
    render(ctx) {
      material.uniforms.inputTexture.value = ctx.readTarget.texture;
      material.uniforms.timeSeconds.value = ctx.timeSeconds;
      material.uniforms.amplitude.value = beatScaled(params.amplitude.value, ctx.beatEnv);
      material.uniforms.speed.value = params.speed.value;
      renderFullscreen(ctx, material, ctx.writeTarget);
    },
  };
};

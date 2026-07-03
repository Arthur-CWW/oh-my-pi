import type { ScenePass } from "../types";
import { beatScaled, frameSeed } from "./helpers";
import { makeMaterial, makeSetParam, renderFullscreen } from "./fullscreen";

const fragmentShader = `
precision highp float;
uniform sampler2D inputTexture;
uniform float intensity;
uniform float blockiness;
uniform float timeSeconds;
uniform float glitchSeed;
varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = vUv;
  float blocks = mix(8.0, 80.0, clamp(blockiness, 0.0, 1.0));
  float band = floor(uv.y * blocks);
  float pulse = step(0.72, hash21(vec2(glitchSeed, band)));
  float window = smoothstep(0.0, 0.08, fract(timeSeconds * 7.0)) * (1.0 - smoothstep(0.35, 1.0, fract(timeSeconds * 7.0)));
  float displacement = (hash21(vec2(band, glitchSeed + 11.0)) - 0.5) * 0.16 * intensity * pulse * window;
  uv.x += displacement;

  float spike = intensity * pulse * window;
  vec2 split = vec2(0.018 * spike, 0.0);
  float r = texture2D(inputTexture, uv + split).r;
  float g = texture2D(inputTexture, uv).g;
  float b = texture2D(inputTexture, uv - split).b;
  vec3 color = vec3(r, g, b);

  float checker = step(0.5, hash21(floor(vUv * blocks) + glitchSeed));
  color += checker * spike * 0.08;
  gl_FragColor = vec4(color, texture2D(inputTexture, uv).a);
}
`;

export const glitchDefaults = {
  intensity: 0.35,
  blockiness: 0.55,
} as const;

export const glitchPass = (): ScenePass => {
  const params = {
    intensity: { value: glitchDefaults.intensity },
    blockiness: { value: glitchDefaults.blockiness },
  };
  const material = makeMaterial(fragmentShader, {
    inputTexture: { value: null },
    intensity: { value: params.intensity.value },
    blockiness: params.blockiness,
    timeSeconds: { value: 0 },
    glitchSeed: { value: 0 },
  });

  return {
    name: "glitch",
    setParam: makeSetParam("glitch", params),
    render(ctx) {
      material.uniforms.inputTexture.value = ctx.readTarget.texture;
      material.uniforms.timeSeconds.value = ctx.timeSeconds;
      material.uniforms.glitchSeed.value = frameSeed(ctx.timeSeconds, 9);
      material.uniforms.intensity.value = beatScaled(params.intensity.value, ctx.beatEnv);
      renderFullscreen(ctx, material, ctx.writeTarget);
    },
  };
};

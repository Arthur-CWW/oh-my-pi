import type { ScenePass } from "../types";
import { beatScaled } from "./helpers";
import { makeMaterial, makeSetParam, renderFullscreen } from "./fullscreen";

const fragmentShader = `
precision highp float;
uniform sampler2D inputTexture;
uniform sampler2D historyTexture;
uniform float decay;
uniform float zoom;
uniform float rotate;
varying vec2 vUv;

void main() {
  vec3 current = texture2D(inputTexture, vUv).rgb;

  vec2 centered = vUv - 0.5;
  centered /= max(zoom, 0.001);
  float c = cos(rotate);
  float s = sin(rotate);
  vec2 rotated = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c);
  vec2 historyUv = rotated + 0.5;

  float inBounds = step(0.0, historyUv.x) * step(historyUv.x, 1.0)
                 * step(0.0, historyUv.y) * step(historyUv.y, 1.0);
  vec3 history = texture2D(historyTexture, historyUv).rgb * inBounds;

  gl_FragColor = vec4(current + history * decay, 1.0);
}
`;

export const feedbackDefaults = {
  decay: 0.65,
  zoom: 1.0,
  rotate: 0.0,
} as const;

export const feedbackPass = (): ScenePass => {
  const params = {
    decay: { value: feedbackDefaults.decay },
    zoom: { value: feedbackDefaults.zoom },
    rotate: { value: feedbackDefaults.rotate },
  };
  const material = makeMaterial(fragmentShader, {
    inputTexture: { value: null },
    historyTexture: { value: null },
    decay: params.decay,
    zoom: params.zoom,
    rotate: { value: params.rotate.value },
  });

  return {
    name: "feedback",
    setParam: makeSetParam("feedback", params),
    render(ctx) {
      material.uniforms.inputTexture.value = ctx.readTarget.texture;
      material.uniforms.historyTexture.value = ctx.historyTarget?.texture ?? null;
      material.uniforms.decay.value = beatScaled(params.decay.value, ctx.beatEnv * 0.5);
      material.uniforms.rotate.value = params.rotate.value;
      renderFullscreen(ctx, material, ctx.writeTarget);
    },
  };
};

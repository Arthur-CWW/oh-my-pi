import { LinearFilter, RGBAFormat, Vector2, WebGLRenderTarget } from "three";
import type { ScenePass } from "../types";
import { beatScaled } from "./helpers";
import { ensureTargetSize, makeMaterial, makeSetParam, renderFullscreen, setResolution } from "./fullscreen";

const brightFragment = `
precision highp float;
uniform sampler2D inputTexture;
uniform float threshold;
varying vec2 vUv;
void main() {
  vec3 color = texture2D(inputTexture, vUv).rgb;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float knee = smoothstep(threshold - 0.08, threshold + 0.08, luma);
  gl_FragColor = vec4(color * knee, 1.0);
}
`;

const blurFragment = `
precision highp float;
uniform sampler2D inputTexture;
uniform vec2 resolution;
uniform float radius;
varying vec2 vUv;
void main() {
  vec2 texel = radius / max(resolution, vec2(1.0));
  vec3 color = texture2D(inputTexture, vUv).rgb * 0.36;
  color += texture2D(inputTexture, vUv + vec2(texel.x, 0.0)).rgb * 0.16;
  color += texture2D(inputTexture, vUv - vec2(texel.x, 0.0)).rgb * 0.16;
  color += texture2D(inputTexture, vUv + vec2(0.0, texel.y)).rgb * 0.16;
  color += texture2D(inputTexture, vUv - vec2(0.0, texel.y)).rgb * 0.16;
  gl_FragColor = vec4(color, 1.0);
}
`;

const combineFragment = `
precision highp float;
uniform sampler2D inputTexture;
uniform sampler2D bloomTexture;
uniform float strength;
varying vec2 vUv;
void main() {
  vec3 base = texture2D(inputTexture, vUv).rgb;
  vec3 bloom = texture2D(bloomTexture, vUv).rgb;
  gl_FragColor = vec4(base + bloom * strength, 1.0);
}
`;

export const bloomDefaults = {
  threshold: 0.7,
  strength: 0.8,
  radius: 1.0,
} as const;

const makeTarget = (): WebGLRenderTarget =>
  new WebGLRenderTarget(1, 1, {
    depthBuffer: false,
    stencilBuffer: false,
    format: RGBAFormat,
    magFilter: LinearFilter,
    minFilter: LinearFilter,
  });

export const bloomPass = (): ScenePass => {
  const resolution = new Vector2(1, 1);
  const params = {
    threshold: { value: bloomDefaults.threshold },
    strength: { value: bloomDefaults.strength },
    radius: { value: bloomDefaults.radius },
  };
  const bright = makeMaterial(brightFragment, {
    inputTexture: { value: null },
    threshold: params.threshold,
  });
  const blur = makeMaterial(blurFragment, {
    inputTexture: { value: null },
    resolution: { value: resolution },
    radius: params.radius,
  });
  const combine = makeMaterial(combineFragment, {
    inputTexture: { value: null },
    bloomTexture: { value: null },
    strength: { value: params.strength.value },
  });
  const brightTarget = makeTarget();
  const blurTarget = makeTarget();

  const pass: ScenePass & { dispose(): void } = {
    name: "bloom",
    setParam: makeSetParam("bloom", params),
    render(ctx) {
      ensureTargetSize(brightTarget, ctx.writeTarget.width, ctx.writeTarget.height);
      ensureTargetSize(blurTarget, ctx.writeTarget.width, ctx.writeTarget.height);
      setResolution(ctx.writeTarget, resolution);

      bright.uniforms.inputTexture.value = ctx.readTarget.texture;
      renderFullscreen(ctx, bright, brightTarget);

      blur.uniforms.inputTexture.value = brightTarget.texture;
      renderFullscreen(ctx, blur, blurTarget);

      combine.uniforms.inputTexture.value = ctx.readTarget.texture;
      combine.uniforms.bloomTexture.value = blurTarget.texture;
      combine.uniforms.strength.value = beatScaled(params.strength.value, ctx.beatEnv);
      renderFullscreen(ctx, combine, ctx.writeTarget);
    },
    dispose() {
      brightTarget.dispose();
      blurTarget.dispose();
    },
  };
  return pass;
};

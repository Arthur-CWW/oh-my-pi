import type { ScenePass } from "../types";
import { beatScaled, frameSeed } from "./helpers";
import { makeMaterial, makeSetParam, renderFullscreen } from "./fullscreen";

const fragmentShader = `
precision highp float;
uniform sampler2D inputTexture;
uniform float scanlineIntensity;
uniform float wobble;
uniform float bleed;
uniform float noise;
uniform float vignette;
uniform float timeSeconds;
uniform float noiseSeed;
varying vec2 vUv;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = vUv;
  float line = floor(uv.y * 720.0);
  float drift = sin(timeSeconds * 0.65 + hash21(vec2(line * 0.013, noiseSeed)) * 6.2831853);
  float tearCenter = fract(timeSeconds * 0.11 + hash21(vec2(noiseSeed, 7.0)));
  float tear = smoothstep(0.04, 0.0, abs(uv.y - tearCenter));
  uv.x += (drift * 0.0018 + tear * 0.018) * wobble;

  float chroma = bleed * (0.0015 + tear * 0.004);
  float r = texture2D(inputTexture, uv + vec2(chroma, 0.0)).r;
  float g = texture2D(inputTexture, uv).g;
  float b = texture2D(inputTexture, uv - vec2(chroma * 1.25, 0.0)).b;
  vec3 color = vec3(r, g, b);

  float scan = sin(uv.y * 1920.0 * 3.14159265);
  color *= 1.0 - (0.5 + 0.5 * scan) * scanlineIntensity * 0.35;

  float grain = hash21(floor(uv * vec2(540.0, 960.0)) + noiseSeed) - 0.5;
  color += grain * noise * 0.18;

  vec2 centered = uv - 0.5;
  float vig = smoothstep(0.25, 0.9, dot(centered, centered) * 1.6);
  color *= 1.0 - vig * vignette * 0.55;

  float cornerStamp = smoothstep(0.72, 0.98, uv.x) * (1.0 - smoothstep(0.0, 0.22, uv.y));
  color *= 1.0 - cornerStamp * vignette * 0.25;

  gl_FragColor = vec4(color, texture2D(inputTexture, uv).a);
}
`;

export const vhsDefaults = {
  scanlineIntensity: 0.35,
  wobble: 0.45,
  bleed: 0.65,
  noise: 0.22,
  vignette: 0.35,
} as const;

export const vhsPass = (): ScenePass => {
  const params = {
    scanlineIntensity: { value: vhsDefaults.scanlineIntensity },
    wobble: { value: vhsDefaults.wobble },
    bleed: { value: vhsDefaults.bleed },
    noise: { value: vhsDefaults.noise },
    vignette: { value: vhsDefaults.vignette },
  };
  const material = makeMaterial(fragmentShader, {
    inputTexture: { value: null },
    scanlineIntensity: params.scanlineIntensity,
    wobble: { value: params.wobble.value },
    bleed: params.bleed,
    noise: { value: params.noise.value },
    vignette: params.vignette,
    timeSeconds: { value: 0 },
    noiseSeed: { value: 0 },
  });

  return {
    name: "vhs",
    setParam: makeSetParam("vhs", params),
    render(ctx) {
      material.uniforms.inputTexture.value = ctx.readTarget.texture;
      material.uniforms.timeSeconds.value = ctx.timeSeconds;
      material.uniforms.noiseSeed.value = frameSeed(ctx.timeSeconds, 30);
      material.uniforms.wobble.value = beatScaled(params.wobble.value, ctx.beatEnv);
      material.uniforms.noise.value = beatScaled(params.noise.value, ctx.beatEnv * 0.5);
      renderFullscreen(ctx, material, ctx.writeTarget);
    },
  };
};

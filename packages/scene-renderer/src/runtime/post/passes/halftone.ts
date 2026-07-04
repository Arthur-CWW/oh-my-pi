import { Vector2 } from "three";
import type { ScenePass } from "../types";
import { makeMaterial, makeSetParam, renderFullscreen, setResolution } from "./fullscreen";

const fragmentShader = `
precision highp float;
uniform sampler2D inputTexture;
uniform vec2 resolution;
uniform float dotSize;
uniform float angle;
uniform float rgbSplit;
varying vec2 vUv;

float halftone(vec2 coord, float a, float freq, float brightness) {
  float s = sin(a);
  float c = cos(a);
  vec2 rotated = vec2(coord.x * c - coord.y * s, coord.x * s + coord.y * c);
  vec2 cell = fract(rotated * freq) - 0.5;
  float dist = length(cell) * 2.0;
  float cov = 1.0 - brightness;
  return smoothstep(max(cov - 0.04, 0.0), cov + 0.04, dist);
}

void main() {
  vec3 color = texture2D(inputTexture, vUv).rgb;
  float aspect = resolution.x / max(resolution.y, 1.0);
  vec2 coord = vec2(vUv.x * aspect, vUv.y);
  if (rgbSplit > 0.5) {
    float r = halftone(coord, angle, dotSize, color.r);
    float g = halftone(coord, angle + 1.0472, dotSize, color.g);
    float b = halftone(coord, angle + 0.5236, dotSize, color.b);
    gl_FragColor = vec4(r, g, b, 1.0);
  } else {
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float d = halftone(coord, angle, dotSize, lum);
    gl_FragColor = vec4(vec3(d), 1.0);
  }
}
`;

export const halftoneDefaults = {
  dotSize: 24.0,
  angle: 0.785,
  rgbSplit: 1.0,
} as const;

export const halftonePass = (): ScenePass => {
  const resolution = new Vector2(1, 1);
  const params = {
    dotSize: { value: halftoneDefaults.dotSize },
    angle: { value: halftoneDefaults.angle },
    rgbSplit: { value: halftoneDefaults.rgbSplit },
  };
  const material = makeMaterial(fragmentShader, {
    inputTexture: { value: null },
    resolution: { value: resolution },
    dotSize: params.dotSize,
    angle: { value: params.angle.value },
    rgbSplit: { value: params.rgbSplit.value },
  });

  return {
    name: "halftone",
    setParam: makeSetParam("halftone", params),
    render(ctx) {
      setResolution(ctx.writeTarget, resolution);
      material.uniforms.inputTexture.value = ctx.readTarget.texture;
      material.uniforms.angle.value = params.angle.value;
      material.uniforms.rgbSplit.value = params.rgbSplit.value;
      renderFullscreen(ctx, material, ctx.writeTarget);
    },
  };
};

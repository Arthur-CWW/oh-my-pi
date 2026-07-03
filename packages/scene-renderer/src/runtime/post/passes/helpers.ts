export const TAU = Math.PI * 2;

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const fract = (value: number): number => value - Math.floor(value);

export const hash11 = (seed: number): number => {
  const mixed = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return fract(mixed);
};

export const hash21 = (x: number, y: number): number => {
  const mixed = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return fract(mixed);
};

export const beatScaled = (base: number, beatEnv: number): number => base * (1 + Math.max(0, beatEnv));

export const frameSeed = (timeSeconds: number, rate: number): number => Math.floor(Math.max(0, timeSeconds) * rate);

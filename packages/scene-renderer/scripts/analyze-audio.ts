#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SAMPLE_RATE = 22_050;
const WINDOW_SIZE = 1_024;
const HOP_SIZE = 512;
const ENVELOPE_HZ = 20;
const REFRACTORY_SECONDS = 0.08;

interface EnergySample {
  t: number;
  v: number;
}

async function main(): Promise<void> {
  const [inputArg, ...rest] = process.argv.slice(2);
  const outputIndex = rest.indexOf("--out");
  const outputArg = outputIndex >= 0 ? rest[outputIndex + 1] : undefined;
  if (!inputArg || !outputArg) throw new Error("Usage: bun scripts/analyze-audio.ts <audio.wav|audio.mp3> --out <cues.json>");

  const input = resolve(inputArg);
  const output = resolve(outputArg);
  const samples = await decodeMono(input);
  const frameEnergy = rmsFrames(samples);
  const peak = Math.max(...frameEnergy, Number.EPSILON);
  const normalized = frameEnergy.map((value) => value / peak);
  const flux = normalized.map((value, index) => Math.max(0, value - (normalized[index - 1] ?? value)));
  const threshold = robustThreshold(flux);
  const refractoryFrames = Math.ceil((REFRACTORY_SECONDS * SAMPLE_RATE) / HOP_SIZE);
  const onsets: number[] = [];
  let lastOnsetFrame = -refractoryFrames;
  for (let index = 1; index < flux.length - 1; index += 1) {
    if (flux[index]! < threshold || flux[index]! < flux[index - 1]! || flux[index]! < flux[index + 1]! || index - lastOnsetFrame < refractoryFrames) continue;
    onsets.push(roundTime((index * HOP_SIZE) / SAMPLE_RATE));
    lastOnsetFrame = index;
  }

  const envelopeStride = Math.max(1, Math.round(SAMPLE_RATE / HOP_SIZE / ENVELOPE_HZ));
  const energy: EnergySample[] = [];
  for (let index = 0; index < normalized.length; index += envelopeStride) {
    energy.push({ t: roundTime((index * HOP_SIZE) / SAMPLE_RATE), v: Math.round(normalized[index]! * 10_000) / 10_000 });
  }

  const result = {
    schemaVersion: "scene.cues.v1",
    source: inputArg,
    durationSeconds: roundTime(samples.length / SAMPLE_RATE),
    sampleRateHz: SAMPLE_RATE,
    onsets,
    energy,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Wrote ${onsets.length} onsets and ${energy.length} energy samples to ${output}`);
}

async function decodeMono(input: string): Promise<Float32Array> {
  const process = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", input, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "pipe:1"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [bytes, errorText, exitCode] = await Promise.all([
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`ffmpeg failed (${exitCode}): ${errorText.trim()}`);
  const aligned = bytes.slice(0, bytes.byteLength - (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT));
  return new Float32Array(aligned);
}

function rmsFrames(samples: Float32Array): number[] {
  const frames: number[] = [];
  for (let start = 0; start < samples.length; start += HOP_SIZE) {
    const end = Math.min(samples.length, start + WINDOW_SIZE);
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += samples[index]! * samples[index]!;
    frames.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  return frames;
}

function robustThreshold(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const deviations = values.map((value) => Math.abs(value - median)).sort((left, right) => left - right);
  const mad = deviations[Math.floor(deviations.length / 2)] ?? 0;
  return Math.max(0.025, median + mad * 3);
}

function roundTime(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

await main();

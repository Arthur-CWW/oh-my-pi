import type { BeatReactiveSpec, EaseName, TimelineSpec, TrackSpec } from "./spec";

const tau = Math.PI * 2;

export interface TimelineContext {
  timeSeconds: number;
  cloneIndex: number;
  fps: number;
  timeline?: TimelineSpec;
  cloneStagger?: number;
}

export function durationInFrames(durationSeconds: number, fps: number): number {
  return Math.max(0, Math.ceil(durationSeconds * fps));
}

export function playbackFrameForNow(nowMs: number, startedAtMs: number, fps: number, durationFrames: number | null): number {
  const elapsedSeconds = Math.max(0, nowMs - startedAtMs) / 1000;
  const rawFrame = Math.floor(elapsedSeconds * fps);
  if (durationFrames == null) return rawFrame;
  return Math.min(rawFrame, Math.max(0, Math.ceil(durationFrames) - 1));
}

export function beatTimesForDuration(timeline: TimelineSpec | undefined, durationSeconds: number): number[] {
  if (timeline?.beats && timeline.beats.length > 0) {
    return timeline.beats.slice().sort((left, right) => left - right);
  }
  const bpm = timeline?.bpm ?? 120;
  const step = 60 / bpm;
  const count = Math.floor(durationSeconds / step) + 2;
  const beats: number[] = [];
  for (let index = 0; index < count; index += 1) {
    beats.push(index * step);
  }
  return beats;
}

export function beatPhaseAt(timeSeconds: number, timeline: TimelineSpec | undefined): number {
  if (timeline?.beats && timeline.beats.length > 1) {
    const beats = timeline.beats;
    if (timeSeconds <= beats[0]) return 0;
    for (let index = 0; index < beats.length - 1; index += 1) {
      const start = beats[index] ?? 0;
      const end = beats[index + 1] ?? start + 1;
      if (timeSeconds >= start && timeSeconds < end) {
        return index + (timeSeconds - start) / Math.max(0.000001, end - start);
      }
    }
    const last = beats[beats.length - 1] ?? 0;
    const prev = beats[beats.length - 2] ?? last - 0.5;
    return beats.length - 1 + (timeSeconds - last) / Math.max(0.000001, last - prev);
  }
  const bpm = timeline?.bpm ?? 120;
  return timeSeconds / (60 / bpm);
}

export function easeValue(name: EaseName | undefined, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  if (name === "inOut") {
    return clamped < 0.5 ? 2 * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 2) / 2;
  }
  if (name === "outElastic") {
    if (clamped === 0 || clamped === 1) return clamped;
    return Math.pow(2, -10 * clamped) * Math.sin((clamped * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  }
  return clamped;
}

export function evaluateTrack(track: TrackSpec, context: TimelineContext): number {
  const timeSeconds = context.timeSeconds - (context.cloneStagger ?? 0) * context.cloneIndex;
  if (track.mode === "osc") {
    const osc = track.osc ?? {};
    const center = osc.center ?? 0;
    const amp = osc.amp ?? 1;
    const freqBeats = osc.freqBeats ?? 1;
    const phasePerClone = osc.phasePerClone ?? 0;
    const phase = beatPhaseAt(timeSeconds, context.timeline) * freqBeats;
    return center + amp * Math.sin(tau * phase + context.cloneIndex * phasePerClone);
  }
  if (track.mode === "beat") {
    const beat = track.beat ?? {};
    const from = beat.from ?? 1;
    const to = beat.to ?? 1.3;
    const env = beatEnvelope(timeSeconds, context.timeline, beat.every ?? 1, beat.attack ?? 0.05, beat.decay ?? 0.3);
    return from + (to - from) * env;
  }
  const keyframes = (track.keyframes ?? []).slice().sort((left, right) => left.t - right.t);
  if (keyframes.length === 0) return 0;
  const first = keyframes[0];
  if (!first || timeSeconds <= first.t) return first?.v ?? 0;
  const last = keyframes[keyframes.length - 1];
  if (!last || timeSeconds >= last.t) return last?.v ?? 0;
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const left = keyframes[index];
    const right = keyframes[index + 1];
    if (!left || !right) continue;
    if (timeSeconds >= left.t && timeSeconds <= right.t) {
      const span = Math.max(0.000001, right.t - left.t);
      const eased = easeValue(right.ease ?? left.ease, (timeSeconds - left.t) / span);
      return left.v + (right.v - left.v) * eased;
    }
  }
  return last.v;
}

export function beatEnvelope(
  timeSeconds: number,
  timeline: TimelineSpec | undefined,
  every: number,
  attack: number,
  decay: number,
): number {
  const stride = Math.max(1, Math.floor(every));
  const beats = beatTimesForDuration(timeline, Math.max(timeSeconds + 2, 2));
  let start = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < beats.length; index += 1) {
    const beatTime = beats[index] ?? 0;
    if (beatTime > timeSeconds) break;
    if (index % stride === 0) start = beatTime;
  }
  if (!Number.isFinite(start)) return 0;
  const age = Math.max(0, timeSeconds - start);
  if (age <= attack) return attack <= 0 ? 1 : age / attack;
  const decayAge = age - attack;
  return Math.exp(-decayAge / Math.max(0.000001, decay));
}

export function beatReactiveValue(timeSeconds: number, timeline: TimelineSpec | undefined, config: BeatReactiveSpec): number {
  return (config.amount ?? 0.5) * beatEnvelope(timeSeconds, timeline, config.every ?? 1, 0, config.decay ?? 0.25);
}

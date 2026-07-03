import { describe, expect, it } from "bun:test";
import { cloneTransforms } from "../src/runtime/layouts";
import { beatEnvelope, easeValue, evaluateTrack, playbackFrameForNow } from "../src/runtime/timeline";
import type { TrackSpec } from "../src/runtime/spec";

describe("runtime timeline math", () => {
  it("evaluates keyframe easing endpoints and midpoint shapes", () => {
    const base = (ease: "linear" | "inOut" | "outElastic"): TrackSpec => ({
      prop: "scale",
      mode: "keyframes",
      keyframes: [
        { t: 0, v: 0, ease },
        { t: 1, v: 10, ease },
      ],
    });
    expect(evaluateTrack(base("linear"), { timeSeconds: 0, cloneIndex: 0, fps: 30 })).toBe(0);
    expect(evaluateTrack(base("linear"), { timeSeconds: 1, cloneIndex: 0, fps: 30 })).toBe(10);
    expect(evaluateTrack(base("linear"), { timeSeconds: 0.5, cloneIndex: 0, fps: 30 })).toBeCloseTo(5);
    expect(evaluateTrack(base("inOut"), { timeSeconds: 0.25, cloneIndex: 0, fps: 30 })).toBeCloseTo(easeValue("inOut", 0.25) * 10);
    expect(evaluateTrack(base("outElastic"), { timeSeconds: 0.5, cloneIndex: 0, fps: 30 })).toBeCloseTo(easeValue("outElastic", 0.5) * 10);
  });

  it("offsets oscillator phase per clone", () => {
    const track: TrackSpec = { prop: "position.x", mode: "osc", osc: { amp: 1, freqBeats: 1, phasePerClone: Math.PI / 2, center: 0 } };
    expect(evaluateTrack(track, { timeSeconds: 0, cloneIndex: 0, fps: 30, timeline: { bpm: 60 } })).toBeCloseTo(0);
    expect(evaluateTrack(track, { timeSeconds: 0, cloneIndex: 1, fps: 30, timeline: { bpm: 60 } })).toBeCloseTo(1);
    expect(evaluateTrack(track, { timeSeconds: 0, cloneIndex: 2, fps: 30, timeline: { bpm: 60 } })).toBeCloseTo(0);
  });

  it("restarts beat envelopes at retriggering beats", () => {
    expect(beatEnvelope(0, { bpm: 60 }, 1, 0.1, 0.4)).toBe(0);
    expect(beatEnvelope(0.05, { bpm: 60 }, 1, 0.1, 0.4)).toBeCloseTo(0.5);
    expect(beatEnvelope(0.1, { bpm: 60 }, 1, 0.1, 0.4)).toBeCloseTo(1);
    expect(beatEnvelope(0.5, { bpm: 60 }, 1, 0.1, 0.4)).toBeLessThan(1);
    expect(beatEnvelope(1, { bpm: 60 }, 1, 0.1, 0.4)).toBe(0);
    expect(beatEnvelope(1.05, { bpm: 60 }, 1, 0.1, 0.4)).toBeCloseTo(0.5);
  });

  it("maps RAF timestamps to advancing clamped finite frames", () => {
    expect(playbackFrameForNow(1000, 1000, 30, 300)).toBe(0);
    expect(playbackFrameForNow(2200, 1000, 30, 300)).toBe(36);
    expect(playbackFrameForNow(11000, 1000, 30, 300)).toBe(299);
    expect(playbackFrameForNow(11200, 1000, 30, 300)).toBe(299);
  });

  it("maps RAF timestamps to unbounded frames without duration", () => {
    expect(playbackFrameForNow(11000, 1000, 30, null)).toBe(300);
    expect(playbackFrameForNow(11200, 1000, 30, null)).toBe(306);
  });
});

describe("runtime clone layouts", () => {
  it("produces count positions for grid, orbit, spiral, and line", () => {
    expect(cloneTransforms({ count: 4, layout: "grid", spacing: 2 })).toHaveLength(4);
    expect(cloneTransforms({ count: 4, layout: "orbit", radius: 3 })).toHaveLength(4);
    expect(cloneTransforms({ count: 4, layout: "spiral", radius: 3 })).toHaveLength(4);
    expect(cloneTransforms({ count: 4, layout: "line", spacing: 2 })).toHaveLength(4);
  });

  it("makes scatter deterministic for the same seed", () => {
    const first = cloneTransforms({ count: 8, layout: "scatter", radius: 5, seed: 123 });
    const second = cloneTransforms({ count: 8, layout: "scatter", radius: 5, seed: 123 });
    expect(second).toEqual(first);
  });
});

import { describe, expect, test } from "bun:test";
import { beatScaled, frameSeed, hash11, hash21 } from "../src/runtime/post/passes/helpers";

describe("post pass deterministic helpers", () => {
  test("hash helpers are stable and normalized", () => {
    const first = hash11(42.25);
    const second = hash11(42.25);
    const paired = hash21(12, 34);

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
    expect(paired).toBe(hash21(12, 34));
    expect(paired).toBeGreaterThanOrEqual(0);
    expect(paired).toBeLessThan(1);
  });

  test("frameSeed only changes on deterministic time windows", () => {
    expect(frameSeed(1.01, 9)).toBe(9);
    expect(frameSeed(1.10, 9)).toBe(9);
    expect(frameSeed(1.12, 9)).toBe(10);
    expect(frameSeed(-1, 9)).toBe(0);
  });

  test("beatScaled is a pure multiplier", () => {
    expect(beatScaled(0.5, 0)).toBe(0.5);
    expect(beatScaled(0.5, 1)).toBe(1);
    expect(beatScaled(0.5, -2)).toBe(0.5);
  });
});

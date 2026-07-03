import { afterEach, describe, expect, test, vi } from "bun:test";
import {
  type SceneSpec,
  type Selection,
  addKeyframe,
  addObject,
  addPass,
  addTrack,
  clamp,
  collectSelectableItems,
  createDebounce,
  ensureCamera,
  ensureTimeline,
  moveKeyframe,
  movePass,
  parseSpec,
  rerollSeed,
  removeKeyframe,
  removeObject,
  removePass,
  removeTrack,
  serializeSpec,
  setCameraProp,
  setCloneProp,
  setKeyframeProp,
  setNested,
  setObjectProp,
  setSceneProp,
  setTimelineProp,
  setTrackProp,
  specDurationInFrames,
  specTotalBeats,
} from "../src/ui/studio/state";
import { applyDelete, mapKey } from "../src/ui/studio/keymap";

function makeSpec(overrides: Partial<SceneSpec> = {}): SceneSpec {
  return {
    schemaVersion: "scene.v1",
    width: 720,
    height: 1280,
    fps: 30,
    durationSeconds: 10,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Parse / serialize
// ---------------------------------------------------------------------------

describe("parseSpec", () => {
  test("parses valid spec", () => {
    const spec = parseSpec(JSON.stringify(makeSpec()));
    expect(spec.width).toBe(720);
    expect(spec.fps).toBe(30);
  });

  test("rejects non-object", () => {
    expect(() => parseSpec("[]")).toThrow();
    expect(() => parseSpec("null")).toThrow();
    expect(() => parseSpec('"str"')).toThrow();
  });

  test("rejects missing required fields", () => {
    expect(() => parseSpec('{"width":720}')).toThrow();
  });
});

describe("serializeSpec", () => {
  test("round-trips", () => {
    const spec = makeSpec({ background: "#111" });
    const parsed = parseSpec(serializeSpec(spec));
    expect(parsed.background).toBe("#111");
    expect(parsed.width).toBe(720);
  });
});

// ---------------------------------------------------------------------------
// Object mutations
// ---------------------------------------------------------------------------

describe("addObject / removeObject", () => {
  test("adds plane with correct defaults", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    expect(spec.objects).toHaveLength(1);
    expect(spec.objects![0]!.kind).toBe("plane");
    expect(spec.objects![0]!.scale).toBe(1);
    expect(spec.objects![0]!.opacity).toBe(1);
  });

  test("adds text with text-specific fields", () => {
    const spec = makeSpec();
    addObject(spec, "text");
    expect(spec.objects![0]!.text).toBe("TEXT");
    expect(spec.objects![0]!.color).toBe("#ffffff");
  });

  test("generates unique ids", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    addObject(spec, "plane");
    expect(spec.objects![0]!.id).not.toBe(spec.objects![1]!.id);
  });

  test("removeObject by id", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    const id = spec.objects![0]!.id;
    removeObject(spec, id);
    expect(spec.objects).toHaveLength(0);
  });

  test("removeObject no-ops on unknown id", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    removeObject(spec, "nope");
    expect(spec.objects).toHaveLength(1);
  });
});

describe("setObjectProp", () => {
  test("sets top-level prop", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    setObjectProp(spec, spec.objects![0]!.id, "scale", 2.5);
    expect(spec.objects![0]!.scale).toBe(2.5);
  });

  test("sets dotted path (array index)", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    setObjectProp(spec, spec.objects![0]!.id, "position.1", 3.0);
    expect(spec.objects![0]!.position[1]).toBe(3.0);
  });
});

// ---------------------------------------------------------------------------
// Pass mutations
// ---------------------------------------------------------------------------

describe("pass mutations", () => {
  test("addPass appends", () => {
    const spec = makeSpec();
    addPass(spec, "bloom");
    expect(spec.post).toHaveLength(1);
    expect(spec.post![0]!.pass).toBe("bloom");
  });

  test("removePass removes by index", () => {
    const spec = makeSpec();
    addPass(spec, "bloom");
    addPass(spec, "vhs");
    removePass(spec, 0);
    expect(spec.post).toHaveLength(1);
    expect(spec.post![0]!.pass).toBe("vhs");
  });

  test("movePass reorders and preserves params", () => {
    const spec = makeSpec();
    addPass(spec, "bloom");
    addPass(spec, "vhs");
    spec.post![0]!.params.strength = 0.75;
    movePass(spec, 0, 1);
    expect(spec.post![0]!.pass).toBe("vhs");
    expect(spec.post![1]!.pass).toBe("bloom");
    expect(spec.post![1]!.params.strength).toBe(0.75);
  });

  test("movePass no-ops on out-of-bounds", () => {
    const spec = makeSpec();
    addPass(spec, "bloom");
    movePass(spec, 0, 5);
    expect(spec.post).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Track mutations
// ---------------------------------------------------------------------------

describe("track mutations", () => {
  test("addTrack to object", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    addTrack(spec, { objectId: spec.objects![0]!.id });
    expect(spec.objects![0]!.tracks).toHaveLength(1);
    expect(spec.objects![0]!.tracks![0]!.mode).toBe("keyframes");
  });

  test("addTrack to camera creates camera", () => {
    const spec = makeSpec();
    addTrack(spec, "camera");
    expect(spec.camera).toBeDefined();
    expect(spec.camera!.tracks).toHaveLength(1);
  });

  test("removeTrack", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    const id = spec.objects![0]!.id;
    addTrack(spec, { objectId: id });
    addTrack(spec, { objectId: id });
    removeTrack(spec, { objectId: id }, 0);
    expect(spec.objects![0]!.tracks).toHaveLength(1);
  });

  test("setTrackProp mode change resets fields", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    addTrack(spec, { objectId: spec.objects![0]!.id });
    setTrackProp(spec, { objectId: spec.objects![0]!.id }, 0, "mode", "osc");
    const track = spec.objects![0]!.tracks![0]!;
    expect(track.mode).toBe("osc");
    expect(track.osc).toBeDefined();
    expect(track.osc!.amp).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Keyframe mutations
// ---------------------------------------------------------------------------

describe("keyframe mutations", () => {
  test("addKeyframe appends", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    addTrack(spec, { objectId: spec.objects![0]!.id });
    addKeyframe(spec, { objectId: spec.objects![0]!.id }, 0);
    expect(spec.objects![0]!.tracks![0]!.keyframes!.length).toBeGreaterThanOrEqual(2);
  });

  test("removeKeyframe", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    addTrack(spec, { objectId: spec.objects![0]!.id });
    addKeyframe(spec, { objectId: spec.objects![0]!.id }, 0);
    removeKeyframe(spec, { objectId: spec.objects![0]!.id }, 0, 0);
    expect(spec.objects![0]!.tracks![0]!.keyframes).toHaveLength(1);
  });

  test("setKeyframeProp sets t and v", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    addTrack(spec, { objectId: spec.objects![0]!.id });
    setKeyframeProp(spec, { objectId: spec.objects![0]!.id }, 0, 0, "t", 3.5);
    setKeyframeProp(spec, { objectId: spec.objects![0]!.id }, 0, 0, "v", 0.8);
    expect(spec.objects![0]!.tracks![0]!.keyframes![0]!.t).toBe(3.5);
    expect(spec.objects![0]!.tracks![0]!.keyframes![0]!.v).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// moveKeyframe — clamp to [0, duration]
// ---------------------------------------------------------------------------

describe("moveKeyframe", () => {
  test("sets time within bounds", () => {
    const spec = makeSpec({ durationSeconds: 10 });
    addObject(spec, "plane");
    addTrack(spec, { objectId: spec.objects![0]!.id });
    moveKeyframe(spec, { objectId: spec.objects![0]!.id }, 0, 0, 5);
    expect(spec.objects![0]!.tracks![0]!.keyframes![0]!.t).toBe(5);
  });

  test("clamps to 0 on negative", () => {
    const spec = makeSpec({ durationSeconds: 10 });
    addObject(spec, "plane");
    addTrack(spec, { objectId: spec.objects![0]!.id });
    moveKeyframe(spec, { objectId: spec.objects![0]!.id }, 0, 0, -5);
    expect(spec.objects![0]!.tracks![0]!.keyframes![0]!.t).toBe(0);
  });

  test("clamps to durationSeconds on overshoot", () => {
    const spec = makeSpec({ durationSeconds: 10 });
    addObject(spec, "plane");
    addTrack(spec, { objectId: spec.objects![0]!.id });
    moveKeyframe(spec, { objectId: spec.objects![0]!.id }, 0, 0, 25);
    expect(spec.objects![0]!.tracks![0]!.keyframes![0]!.t).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Camera / timeline / clone
// ---------------------------------------------------------------------------

describe("camera helpers", () => {
  test("ensureCamera creates default", () => {
    const spec = makeSpec();
    const cam = ensureCamera(spec);
    expect(cam.fov).toBe(46);
    expect(spec.camera).toBe(cam);
  });

  test("setCameraProp sets fov", () => {
    const spec = makeSpec();
    setCameraProp(spec, "fov", 90);
    expect(spec.camera!.fov).toBe(90);
  });
});

describe("timeline helpers", () => {
  test("ensureTimeline creates default", () => {
    const spec = makeSpec();
    ensureTimeline(spec);
    expect(spec.timeline!.bpm).toBe(120);
  });

  test("setTimelineProp sets bpm", () => {
    const spec = makeSpec();
    setTimelineProp(spec, "bpm", 140);
    expect(spec.timeline!.bpm).toBe(140);
  });
});

describe("clone helpers", () => {
  test("setCloneProp creates clone group if absent", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    setCloneProp(spec, spec.objects![0]!.id, "count", 8);
    expect(spec.objects![0]!.clone!.count).toBe(8);
    expect(spec.objects![0]!.clone!.layout).toBe("grid");
  });

  test("rerollSeed changes the seed", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    setCloneProp(spec, spec.objects![0]!.id, "count", 4);
    const before = spec.objects![0]!.clone!.seed;
    rerollSeed(spec, spec.objects![0]!.id);
    expect(typeof spec.objects![0]!.clone!.seed).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Computed helpers
// ---------------------------------------------------------------------------

describe("computed helpers", () => {
  test("specDurationInFrames", () => {
    expect(specDurationInFrames(makeSpec({ fps: 30, durationSeconds: 10 }))).toBe(300);
  });

  test("specTotalBeats", () => {
    expect(specTotalBeats(makeSpec({ durationSeconds: 10, timeline: { bpm: 120 } }))).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// clamp
// ---------------------------------------------------------------------------

describe("clamp", () => {
  test("returns value within bounds", () => expect(clamp(5, 0, 10)).toBe(5));
  test("clamps below min", () => expect(clamp(-1, 0, 10)).toBe(0));
  test("clamps above max", () => expect(clamp(15, 0, 10)).toBe(10));
  test("returns min when equal", () => expect(clamp(0, 0, 10)).toBe(0));
});

// ---------------------------------------------------------------------------
// setNested
// ---------------------------------------------------------------------------

describe("setNested", () => {
  test("sets simple property", () => {
    const obj: Record<string, unknown> = { a: 1 };
    setNested(obj, "a", 42);
    expect(obj.a).toBe(42);
  });

  test("sets nested with creation", () => {
    const obj: Record<string, unknown> = {};
    setNested(obj, "a.b", 99);
    expect((obj.a as Record<string, unknown>).b).toBe(99);
  });

  test("sets array index", () => {
    const obj: Record<string, unknown> = { pos: [1, 2, 3] };
    setNested(obj, "pos.0", 10);
    expect((obj.pos as number[])[0]).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Debounce (fake timers)
// ---------------------------------------------------------------------------

describe("createDebounce", () => {
  afterEach(() => vi.useRealTimers());

  test("coalesces multiple calls", () => {
    vi.useFakeTimers();
    let count = 0;
    const d = createDebounce(() => { count += 1; }, 100);
    d.schedule();
    d.schedule();
    d.schedule();
    vi.advanceTimersByTime(150);
    expect(count).toBe(1);
  });

  test("flush fires immediately", () => {
    vi.useFakeTimers();
    let count = 0;
    const d = createDebounce(() => { count += 1; }, 1000);
    d.schedule();
    d.flush();
    expect(count).toBe(1);
  });

  test("cancel prevents execution", () => {
    vi.useFakeTimers();
    let count = 0;
    const d = createDebounce(() => { count += 1; }, 100);
    d.schedule();
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// collectSelectableItems
// ---------------------------------------------------------------------------

describe("collectSelectableItems", () => {
  test("collects camera, timeline, objects, passes, assets", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    addPass(spec, "bloom");
    spec.assets = [{ id: "img", kind: "image", path: "x.png" }];
    spec.audio = { asset: "narr", offsetSeconds: 0, gainDb: 0 };
    const items = collectSelectableItems(spec);
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items.some((i) => i.type === "camera")).toBe(true);
    expect(items.some((i) => i.type === "object")).toBe(true);
    expect(items.some((i) => i.type === "pass")).toBe(true);
    expect(items.some((i) => i.type === "asset")).toBe(true);
    expect(items.some((i) => i.type === "audio")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Keymap (pure)
// ---------------------------------------------------------------------------

describe("keymap", () => {
  test("j selects next item", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    const sel: Selection = { type: "camera" };
    const action = mapKey("j", false, spec, sel);
    expect(action.type).toBe("select");
  });

  test("k selects previous item", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    const sel: Selection = { type: "timeline" };
    const action = mapKey("k", false, spec, sel);
    expect(action.type).toBe("select");
    if (action.type === "select") expect(action.selection.type).toBe("camera");
  });

  test("Space toggles playback", () => {
    const action = mapKey(" ", false, makeSpec(), { type: "none" });
    expect(action.type).toBe("play-toggle");
  });

  test("x triggers delete", () => {
    const action = mapKey("x", false, makeSpec(), { type: "object", id: "a" });
    expect(action.type).toBe("delete");
  });

  test("G selects last item", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    addPass(spec, "bloom");
    const action = mapKey("G", false, spec, { type: "camera" });
    expect(action.type).toBe("select");
    if (action.type === "select") expect(action.selection.type).toBe("pass");
  });

  test("applyDelete removes object", () => {
    const spec = makeSpec();
    addObject(spec, "plane");
    const id = spec.objects![0]!.id;
    const result = applyDelete(spec, { type: "object", id });
    expect(result.type).toBe("none");
    expect(spec.objects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Schema-aware clamps (fix 2)
// ---------------------------------------------------------------------------

describe("setSceneProp schema clamps", () => {
  test("rejects negative width", () => {
    const spec = makeSpec();
    setSceneProp(spec, "width", -10);
    expect(spec.width).toBe(720); // unchanged
  });

  test("rejects zero fps", () => {
    const spec = makeSpec();
    setSceneProp(spec, "fps", 0);
    expect(spec.fps).toBe(30); // unchanged
  });

  test("rejects NaN durationSeconds", () => {
    const spec = makeSpec();
    setSceneProp(spec, "durationSeconds", NaN);
    expect(spec.durationSeconds).toBe(10); // unchanged
  });

  test("clamps width to valid range", () => {
    const spec = makeSpec();
    setSceneProp(spec, "width", 99999);
    expect(spec.width).toBe(7680);
  });

  test("clamps fps to 1-120", () => {
    const spec = makeSpec();
    setSceneProp(spec, "fps", 240);
    expect(spec.fps).toBe(120);
  });

  test("allows valid background passthrough", () => {
    const spec = makeSpec();
    setSceneProp(spec, "background", "#ff0000");
    expect(spec.background).toBe("#ff0000");
  });
});

// ---------------------------------------------------------------------------
// Keyframe sort after move (fix 4)
// ---------------------------------------------------------------------------

describe("moveKeyframe sorts keyframes", () => {
  test("keyframes are sorted by t after drag", () => {
    const spec = makeSpec({ durationSeconds: 10 });
    addObject(spec, "plane");
    const id = spec.objects![0]!.id;
    addTrack(spec, { objectId: id });
    // Start with kf at t=0; add one at t=1
    addKeyframe(spec, { objectId: id }, 0);
    const kfs = spec.objects![0]!.tracks![0]!.keyframes!;
    kfs[0]!.t = 5;
    kfs[1]!.t = 2;
    // Move kf[0] (t=5) to t=1 — should end up before kf at t=2
    moveKeyframe(spec, { objectId: id }, 0, 0, 1);
    const sorted = spec.objects![0]!.tracks![0]!.keyframes!;
    expect(sorted[0]!.t).toBe(1);
    expect(sorted[1]!.t).toBe(2);
  });
});

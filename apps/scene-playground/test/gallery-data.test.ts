import { describe, expect, test } from "bun:test";
import type { ReportEntry } from "../src/ui/studio/state";
import {
  type GalleryRender,
  buildArtifacts,
  countKinds,
  filterArtifacts,
  isRenderCovered,
  pickPoster,
  renderSlug,
  toLabel,
} from "../src/ui/gallery/data";

// ---------------------------------------------------------------------------
// Fixtures — mirror the real scene-lab report shapes
// ---------------------------------------------------------------------------

function report(overrides: Partial<ReportEntry> & { path: string }): ReportEntry {
  return {
    title: overrides.title ?? overrides.path,
    date: overrides.date ?? "2026-07-06",
    agent: overrides.agent ?? "Fable",
    status: overrides.status ?? "shipped",
    excerpt: overrides.excerpt ?? "",
    media: overrides.media ?? [],
    mtime: overrides.mtime ?? "2026-07-06T00:00:00.000Z",
    path: overrides.path,
  };
}

const DIR = "workflows/scene-lab/reports";

// ---------------------------------------------------------------------------
// pickPoster
// ---------------------------------------------------------------------------

describe("pickPoster", () => {
  test("prefers a still whose stem prefixes the artifact stem", () => {
    const pngs = [
      `${DIR}/x/render1_baseline-still-2s.png`,
      `${DIR}/x/render2_pulse-still-2s.png`,
    ];
    expect(pickPoster("render2_pulse", pngs)).toBe(`${DIR}/x/render2_pulse-still-2s.png`);
  });

  test("falls back to first png when no prefix matches (single-video report)", () => {
    const pngs = [`${DIR}/x/still-12.2s.png`, `${DIR}/x/still-3.5s.png`];
    expect(pickPoster("clone-field-pulse", pngs)).toBe(`${DIR}/x/still-12.2s.png`);
  });

  test("returns null when the report has no stills", () => {
    expect(pickPoster("whatever", [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildArtifacts — reports
// ---------------------------------------------------------------------------

describe("buildArtifacts (reports)", () => {
  test("emits one video card per mp4 with prefix-matched posters, stable filename order", () => {
    const reports = [
      report({
        path: `${DIR}/2026-07-06-latwalk-first-light`,
        title: "Latwalk first light",
        agent: "Latwalk",
        media: [
          `${DIR}/2026-07-06-latwalk-first-light/render2_pulse.mp4`,
          `${DIR}/2026-07-06-latwalk-first-light/render1_baseline.mp4`,
          `${DIR}/2026-07-06-latwalk-first-light/render1_baseline-still-2s.png`,
          `${DIR}/2026-07-06-latwalk-first-light/render2_pulse-still-2s.png`,
        ],
      }),
    ];
    const arts = buildArtifacts(reports);
    expect(arts).toHaveLength(2);
    // stable order = filename ascending → baseline before pulse
    expect(arts[0]!.fileName).toBe("render1_baseline.mp4");
    expect(arts[1]!.fileName).toBe("render2_pulse.mp4");
    expect(arts[0]!.kind).toBe("video");
    expect(arts[0]!.origin).toBe("report");
    expect(arts[0]!.poster).toBe(`${DIR}/2026-07-06-latwalk-first-light/render1_baseline-still-2s.png`);
    expect(arts[1]!.poster).toBe(`${DIR}/2026-07-06-latwalk-first-light/render2_pulse-still-2s.png`);
    expect(arts[0]!.title).toBe("Latwalk first light");
    expect(arts[0]!.agent).toBe("Latwalk");
    expect(arts[0]!.reportPath).toBe(`${DIR}/2026-07-06-latwalk-first-light`);
  });

  test("emits a toy card for artifact.html, badged toy, poster from sibling still", () => {
    const reports = [
      report({
        path: `${DIR}/2026-07-06-type-glitch-toy`,
        title: "TYPE GLITCH",
        media: [
          `${DIR}/2026-07-06-type-glitch-toy/artifact.html`,
          `${DIR}/2026-07-06-type-glitch-toy/type-glitch.mp4`,
          `${DIR}/2026-07-06-type-glitch-toy/still-onbeat.png`,
        ],
      }),
    ];
    const arts = buildArtifacts(reports);
    // video first, toy second (videos before toys within a report)
    expect(arts.map((a) => a.kind)).toEqual(["video", "toy"]);
    const toy = arts.find((a) => a.kind === "toy")!;
    expect(toy.src).toBe(`${DIR}/2026-07-06-type-glitch-toy/artifact.html`);
    expect(toy.poster).toBe(`${DIR}/2026-07-06-type-glitch-toy/still-onbeat.png`);
  });

  test("image-only reports produce no cards (stills are posters, not artifacts)", () => {
    const reports = [
      report({ path: `${DIR}/2026-07-03-first-light`, media: [`${DIR}/2026-07-03-first-light/a.png`, `${DIR}/2026-07-03-first-light/b.png`] }),
    ];
    expect(buildArtifacts(reports)).toHaveLength(0);
  });

  test("preserves newest-first report order across reports", () => {
    const reports = [
      report({ path: `${DIR}/2026-07-08-newer`, media: [`${DIR}/2026-07-08-newer/a.mp4`] }),
      report({ path: `${DIR}/2026-07-06-older`, media: [`${DIR}/2026-07-06-older/b.mp4`] }),
    ];
    const arts = buildArtifacts(reports);
    expect(arts.map((a) => a.fileName)).toEqual(["a.mp4", "b.mp4"]);
  });
});

// ---------------------------------------------------------------------------
// Renders + dedupe
// ---------------------------------------------------------------------------

describe("isRenderCovered", () => {
  const reports = [
    report({ path: `${DIR}/2026-07-06-clone-field-pulse`, media: [`${DIR}/2026-07-06-clone-field-pulse/clone-field-pulse.mp4`] }),
    report({ path: `${DIR}/2026-07-06-type-glitch-toy`, media: [`${DIR}/2026-07-06-type-glitch-toy/type-glitch.mp4`] }),
  ];

  test("exact date-stripped slug match is covered", () => {
    expect(isRenderCovered("clone-field-pulse", reports)).toBe(true);
  });

  test("slug-with-suffix report covers the base render (type-glitch-toy covers type-glitch)", () => {
    expect(isRenderCovered("type-glitch", reports)).toBe(true);
  });

  test("orphan render slug is not covered", () => {
    expect(isRenderCovered("orbit-halo", reports)).toBe(false);
    expect(isRenderCovered("beat-grid", reports)).toBe(false);
  });
});

describe("buildArtifacts (renders folded in)", () => {
  const reports = [
    report({ path: `${DIR}/2026-07-06-clone-field-pulse`, title: "Clone field pulse", media: [`${DIR}/2026-07-06-clone-field-pulse/clone-field-pulse.mp4`, `${DIR}/2026-07-06-clone-field-pulse/still.png`] }),
  ];
  const renders: GalleryRender[] = [
    { path: "workflows/scene-lab/renders/clone-field-pulse/scene.mp4", mtime: "2026-07-05T00:00:00.000Z" },
    { path: "workflows/scene-lab/renders/orbit-halo/scene.mp4", mtime: "2026-07-04T00:00:00.000Z" },
    { path: "workflows/scene-lab/renders/beat-grid/scene.mp4", mtime: "2026-07-04T12:00:00.000Z" },
  ];

  test("dedupes render whose slug a report already covers; surfaces orphans after report artifacts", () => {
    const arts = buildArtifacts(reports, renders);
    // report artifact + 2 orphan renders (clone-field-pulse render deduped)
    expect(arts).toHaveLength(3);
    expect(arts[0]!.origin).toBe("report");
    expect(arts[0]!.fileName).toBe("clone-field-pulse.mp4");
    // orphans sorted by mtime desc → beat-grid (12:00) before orbit-halo (00:00)
    expect(arts[1]!.origin).toBe("render");
    expect(arts[1]!.title).toBe("beat grid");
    expect(arts[2]!.title).toBe("orbit halo");
    expect(arts.some((a) => a.origin === "render" && a.title === "clone field pulse")).toBe(false);
  });

  test("render cards carry render origin, null poster, empty reportPath, mtime-derived date", () => {
    const arts = buildArtifacts([], renders);
    const orbit = arts.find((a) => a.title === "orbit halo")!;
    expect(orbit.origin).toBe("render");
    expect(orbit.kind).toBe("video");
    expect(orbit.poster).toBeNull();
    expect(orbit.reportPath).toBe("");
    expect(orbit.date).toBe("2026-07-04");
    expect(orbit.src).toBe("workflows/scene-lab/renders/orbit-halo/scene.mp4");
  });
});

// ---------------------------------------------------------------------------
// filter + counts + small helpers
// ---------------------------------------------------------------------------

describe("filterArtifacts + countKinds", () => {
  const reports = [
    report({
      path: `${DIR}/2026-07-06-type-glitch-toy`,
      media: [`${DIR}/2026-07-06-type-glitch-toy/type-glitch.mp4`, `${DIR}/2026-07-06-type-glitch-toy/artifact.html`],
    }),
  ];
  const arts = buildArtifacts(reports);

  test("all returns every artifact", () => {
    expect(filterArtifacts(arts, "all")).toHaveLength(2);
  });
  test("videos returns only video kind", () => {
    const v = filterArtifacts(arts, "videos");
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe("video");
  });
  test("toys returns only toy kind", () => {
    const t = filterArtifacts(arts, "toys");
    expect(t).toHaveLength(1);
    expect(t[0]!.kind).toBe("toy");
  });
  test("countKinds tallies both kinds", () => {
    expect(countKinds(arts)).toEqual({ videos: 1, toys: 1 });
  });
});

describe("small helpers", () => {
  test("toLabel strips extension and normalizes separators", () => {
    expect(toLabel("render1_baseline.mp4")).toBe("render1 baseline");
    expect(toLabel("pleo-remix-glitch.mp4")).toBe("pleo remix glitch");
  });
  test("renderSlug extracts the render dir name", () => {
    expect(renderSlug("workflows/scene-lab/renders/orbit-halo/scene.mp4")).toBe("orbit-halo");
  });
});

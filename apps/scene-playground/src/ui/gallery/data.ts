// ---------------------------------------------------------------------------
// Gallery data shaping — pure, testable
//
// Flattens the /api/reports payload (newest-first) plus the /api/renders
// payload into a flat list of playable ARTIFACTS:
//   • every report .mp4          → video card (poster = sibling still)
//   • every report artifact .html → toy card
//   • every renders/<slug>/scene.mp4 → video card, UNLESS a report already
//     covers that slug (dedupe: the curated report copy wins).
// Sibling .png stills are posters only — never cards themselves.
// ---------------------------------------------------------------------------

import type { ReportEntry } from "../studio/state";

export type ArtifactKind = "video" | "toy";
export type ArtifactOrigin = "report" | "render";
export type GalleryFilter = "all" | "videos" | "toys";

export interface GalleryArtifact {
  kind: ArtifactKind;
  origin: ArtifactOrigin;
  /** Repo-relative path to the mp4 or html artifact. */
  src: string;
  /** Repo-relative path to a poster png, or null → dark placeholder. */
  poster: string | null;
  /** Report directory repo path, or "" for orphan renders (drives the `o` action). */
  reportPath: string;
  title: string;
  /** Artifact file basename, e.g. "render1_baseline.mp4". */
  fileName: string;
  /** Cleaned display label derived from the filename stem ("" when uninformative). */
  label: string;
  date: string;
  agent: string;
  status: string;
}

/** Minimal shape from /api/renders needed for the gallery. */
export interface GalleryRender {
  /** Repo-relative path to renders/<slug>/scene.mp4. */
  path: string;
  mtime: string;
}

const VIDEO_RE = /\.mp4$/i;
const IMAGE_RE = /\.png$/i;
const TOY_RE = /\.html$/i;
const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}-/;

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function stem(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? fileName : fileName.slice(0, dot);
}

/** Human display label from an artifact filename: drop extension, normalize separators. */
export function toLabel(fileName: string): string {
  return stem(fileName).replace(/[_-]+/g, " ").trim();
}

/** renders/<slug>/scene.mp4 → "<slug>". */
export function renderSlug(renderPath: string): string {
  const parts = renderPath.split("/");
  return parts.length >= 2 ? parts[parts.length - 2]! : renderPath;
}

/**
 * Pick the best poster png for an artifact stem within one report.
 * Prefers a png whose stem begins with the artifact stem
 * (render1_baseline.mp4 → render1_baseline-still-2s.png), else the first png
 * (single-video reports share generic stills), else null.
 */
export function pickPoster(artifactStem: string, pngs: readonly string[]): string | null {
  if (pngs.length === 0) return null;
  const prefixed = pngs.find((p) => stem(baseName(p)).startsWith(artifactStem));
  return prefixed ?? pngs[0]!;
}

/**
 * True when some report already surfaces this render slug, so the standalone
 * render should be skipped. Matches the date-stripped report dir slug (exact or
 * "<slug>-suffix", e.g. type-glitch-toy covers the type-glitch render) or any
 * report video filename stem equal to the slug.
 */
export function isRenderCovered(slug: string, reports: readonly ReportEntry[]): boolean {
  for (const report of reports) {
    const reportSlug = baseName(report.path).replace(DATE_PREFIX_RE, "");
    if (reportSlug === slug || reportSlug.startsWith(`${slug}-`)) return true;
    for (const m of report.media) {
      if (VIDEO_RE.test(m) && stem(baseName(m)) === slug) return true;
    }
  }
  return false;
}

/**
 * Flatten reports (newest-first) then dedup-surfaced renders into one artifact
 * list. Stable order within a report: filename ascending, videos before toys.
 * Orphan renders follow, newest render mtime first.
 */
export function buildArtifacts(reports: readonly ReportEntry[], renders: readonly GalleryRender[] = []): GalleryArtifact[] {
  const artifacts: GalleryArtifact[] = [];

  for (const report of reports) {
    const pngs = report.media.filter((m) => IMAGE_RE.test(m)).slice().sort();
    const videos = report.media.filter((m) => VIDEO_RE.test(m)).slice().sort();
    const toys = report.media.filter((m) => TOY_RE.test(m)).slice().sort();
    for (const src of [...videos, ...toys]) {
      const fileName = baseName(src);
      artifacts.push({
        kind: VIDEO_RE.test(src) ? "video" : "toy",
        origin: "report",
        src,
        poster: pickPoster(stem(fileName), pngs),
        reportPath: report.path,
        title: report.title,
        fileName,
        label: toLabel(fileName),
        date: report.date,
        agent: report.agent,
        status: report.status,
      });
    }
  }

  const orphanRenders = renders
    .filter((r) => !isRenderCovered(renderSlug(r.path), reports))
    .slice()
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
  for (const render of orphanRenders) {
    const slug = renderSlug(render.path);
    artifacts.push({
      kind: "video",
      origin: "render",
      src: render.path,
      poster: null,
      reportPath: "",
      title: slug.replace(/[_-]+/g, " ").trim(),
      fileName: baseName(render.path),
      label: "render",
      date: render.mtime.slice(0, 10),
      agent: "",
      status: "",
    });
  }

  return artifacts;
}

/** Apply the current filter to the full artifact list. Returns a new array. */
export function filterArtifacts(artifacts: readonly GalleryArtifact[], filter: GalleryFilter): GalleryArtifact[] {
  if (filter === "all") return artifacts.slice();
  const kind: ArtifactKind = filter === "videos" ? "video" : "toy";
  return artifacts.filter((a) => a.kind === kind);
}

/** Count videos and toys in one pass (for the status line + filter labels). */
export function countKinds(artifacts: readonly GalleryArtifact[]): { videos: number; toys: number } {
  let videos = 0;
  let toys = 0;
  for (const a of artifacts) {
    if (a.kind === "video") videos += 1;
    else toys += 1;
  }
  return { videos, toys };
}

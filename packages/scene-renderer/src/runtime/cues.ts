import type { KeyframeSpec, SceneSpec, TrackSpec } from "./spec";

interface CueFile {
  schemaVersion: "scene.cues.v1";
  onsets: number[];
}

export async function resolveCueTimings(spec: SceneSpec, assetBaseUrl: string): Promise<SceneSpec> {
  const paths = cuePaths(spec);
  if (paths.size === 0) return spec;

  const cueFiles = new Map<string, CueFile>();
  await Promise.all(
    [...paths].map(async (path) => {
      const response = await fetch(new URL(path, assetBaseUrl));
      if (!response.ok) throw new Error(`Unable to load cues ${path}: HTTP ${response.status}`);
      cueFiles.set(path, validateCueFile(path, await response.json()));
    }),
  );

  const resolveTracks = (tracks: TrackSpec[] | undefined): TrackSpec[] | undefined =>
    tracks?.map((track) => {
      if (!track.timing || track.mode !== "keyframes" || !track.keyframes) return track;
      const cues = cueFiles.get(track.timing.cues);
      if (!cues) throw new Error(`Cues were not loaded: ${track.timing.cues}`);
      return { ...track, keyframes: snapKeyframesToOnsets(track.keyframes, cues.onsets) };
    });

  return {
    ...spec,
    camera: spec.camera ? { ...spec.camera, tracks: resolveTracks(spec.camera.tracks) } : undefined,
    objects: spec.objects?.map((object) => ({ ...object, tracks: resolveTracks(object.tracks) })),
  };
}

export function snapKeyframesToOnsets(keyframes: readonly KeyframeSpec[], onsets: readonly number[]): KeyframeSpec[] {
  if (onsets.length === 0) return [...keyframes];
  return keyframes
    .map((keyframe) => ({ ...keyframe, t: nearestOnset(keyframe.t, onsets) }))
    .sort((left, right) => left.t - right.t);
}

function cuePaths(spec: SceneSpec): Set<string> {
  const paths = new Set<string>();
  const collect = (tracks: TrackSpec[] | undefined): void => {
    for (const track of tracks ?? []) if (track.timing) paths.add(track.timing.cues);
  };
  collect(spec.camera?.tracks);
  for (const object of spec.objects ?? []) collect(object.tracks);
  return paths;
}

function nearestOnset(time: number, onsets: readonly number[]): number {
  let nearest = onsets[0] ?? time;
  let distance = Math.abs(nearest - time);
  for (let index = 1; index < onsets.length; index += 1) {
    const candidate = onsets[index] ?? nearest;
    const candidateDistance = Math.abs(candidate - time);
    if (candidateDistance >= distance) continue;
    nearest = candidate;
    distance = candidateDistance;
  }
  return nearest;
}

function validateCueFile(path: string, value: unknown): CueFile {
  if (!value || typeof value !== "object") throw new Error(`Invalid cues file ${path}: expected object`);
  const candidate = value as Partial<CueFile>;
  if (candidate.schemaVersion !== "scene.cues.v1" || !Array.isArray(candidate.onsets) || candidate.onsets.some((time) => typeof time !== "number" || time < 0)) {
    throw new Error(`Invalid cues file ${path}: expected scene.cues.v1 with non-negative onsets`);
  }
  return candidate as CueFile;
}

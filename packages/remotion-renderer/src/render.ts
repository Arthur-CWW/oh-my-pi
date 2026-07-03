#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { layerPlanSchema } from "./compositions/TiktokRecreate";
import type { LayerPlan, TiktokRecreateProps } from "./compositions/TiktokRecreate";

type Segment = {
  startFrame: number;
  endFrame: number;
  narrationFunction: string;
  visualFunction: string;
  caption: string;
};

type GeneratedClipResolution = {
  clipId: string;
  artifactPath: string;
  mediaType: string;
  durationSec: number;
  fps: number;
  dryRun: boolean;
  mediaAvailable: boolean;
  resolvedMediaPath?: string;
  missingLiveMediaReason?: string;
};

type CaptionCue = NonNullable<TiktokRecreateProps["captionCues"]>[number];
type CaptionStyle = "word" | "phrase";

function usage(): string {
  return `
Usage: render.ts --manifest <path> --persona-manifest <path> --out <dir> [options]

Required:
  --manifest          Video context JSON (e.g. 2026-05-20_7641985194186001678.context.json)
  --persona-manifest  Jimeng persona manifest JSON
  --out               Output directory for the rendered MP4 and manifest

Either --decomposition or --layer-plan must be provided:
  --decomposition     Decomposition JSON for the video
  --layer-plan        Layer-plan JSON (beat/layer composition); overrides visual rendering

Optional:
  --plates-manifest   JSON manifest of generated image plates (array of paths or {plates:string[]})
  --generated-clips-manifest JSON generated-video-clips.v1 manifest for ClipLayer resolution
  --audio-manifest    JSON manifest from MiniMax TTS lane or spatial-audio render-output (resolves audio)
  --fps               Frames per second (default: 30)
  --width             Video width (default: 1080)
  --height            Video height (default: 1920)
  --frame-range       Optional Remotion frame range slice, formatted <start>-<end>
  --captions          Optional WEBVTT captions file
  --caption-style     Caption style: word (default) or phrase

Examples:
  tsx packages/remotion-renderer/src/render.ts \\
    --manifest data/video-recreation/samuelszuchan/bootstrap-20260620/2026-05-20_7641985194186001678.context.json \\
    --decomposition data/video-recreation/samuelszuchan/bootstrap-20260620/antigravity-frame-decompositions/2026-05-20_7641985194186001678.json \\
    --persona-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/jimeng-persona-manifest.json \\
    --out data/video-recreation/samuelszuchan/renders/2026-05-20_7641985194186001678

  tsx packages/remotion-renderer/src/render.ts \\
    --manifest data/video-recreation/samuelszuchan/bootstrap-20260620/2026-05-20_7642101474981367054.context.json \\
    --layer-plan data/video-recreation/samuelszuchan/bootstrap-20260620/birthrate-layer-plan.json \\
    --persona-manifest data/video-recreation/samuelszuchan/bootstrap-20260620/jimeng-persona-manifest.json \\
    --out data/video-recreation/samuelszuchan/renders/2026-05-20_7642101474981367054
`.trim();
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  console.error("\n" + usage());
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = "true";
    }
  }
  return flags;
}

function parseFrameRange(value: string | undefined): [number, number] | undefined {
  if (!value) return undefined;
  const match = /^(\d+)-(\d+)$/.exec(value);
  if (!match) fail("--frame-range must be formatted <start>-<end>");
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    fail("--frame-range must use non-negative integers with end >= start");
  }
  return [start, end];
}

function parseVttTime(value: string): number {
  const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid WEBVTT timestamp: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4]);
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function parseWebVttCaptions(filePath: string, fps: number, style: CaptionStyle): CaptionCue[] {
  const text = fs.readFileSync(path.resolve(filePath), "utf8");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const cues: CaptionCue[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const timing = /^(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/.exec(line);
    if (!timing) continue;

    const startFrame = Math.round(parseVttTime(timing[1]) * fps);
    const endFrame = Math.max(startFrame + 1, Math.round(parseVttTime(timing[2]) * fps));
    const textLines: string[] = [];
    i += 1;
    for (; i < lines.length; i += 1) {
      const cueLine = lines[i].trim();
      if (!cueLine) break;
      textLines.push(cueLine);
    }

    const cueText = textLines.join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!cueText) continue;

    if (style === "phrase") {
      cues.push({ text: cueText, startFrame, endFrame });
      continue;
    }

    const words = cueText.split(/\s+/).filter(Boolean);
    const duration = endFrame - startFrame;
    words.forEach((word, index) => {
      const wordStart = startFrame + Math.round((duration * index) / words.length);
      const wordEnd =
        index === words.length - 1
          ? endFrame
          : startFrame + Math.round((duration * (index + 1)) / words.length);
      cues.push({ text: word, startFrame: wordStart, endFrame: Math.max(wordStart + 1, wordEnd) });
    });
  }

  return cues;
}


function readJsonFile(filePath: string): unknown {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  const text = fs.readFileSync(resolved, "utf8");
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON in ${resolved}: ${(err as Error).message}`);
  }
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function getString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new Error(`Missing or invalid string field "${key}"`);
  }
  return value;
}

function getNumber(obj: Record<string, unknown>, key: string, fallback?: number): number {
  const value = obj[key];
  if (typeof value === "number") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing or invalid number field "${key}"`);
}

function getArray(obj: Record<string, unknown>, key: string): unknown[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new Error(`Missing or invalid array field "${key}"`);
  }
  return value;
}

function splitTranscriptIntoCaptions(
  transcript: string,
  timeline: Array<{ start_seconds: number; end_seconds: number }>,
  durationSeconds: number
): string[] {
  const words = transcript.trim().split(/\s+/);
  if (words.length === 0 || timeline.length === 0) return [transcript];

  const captions: string[] = [];
  const totalDuration = durationSeconds > 0 ? durationSeconds : timeline[timeline.length - 1].end_seconds;
  let wordIndex = 0;

  for (const segment of timeline) {
    const segDuration = segment.end_seconds - segment.start_seconds;
    const ratio = segDuration / totalDuration;
    const wordCount = Math.max(1, Math.round(words.length * ratio));
    const slice = words.slice(wordIndex, wordIndex + wordCount);
    if (slice.length > 0) {
      captions.push(slice.join(" "));
      wordIndex += slice.length;
    } else {
      captions.push("");
    }
  }

  // Distribute any remaining words into the last caption.
  if (wordIndex < words.length && captions.length > 0) {
    captions[captions.length - 1] +=
      " " + words.slice(wordIndex).join(" ");
  }

  return captions;
}

function extractPersonaImageUrl(personaManifest: Record<string, unknown>): string | undefined {
  const subjectCreate = personaManifest["subjectCreate"];
  if (
    subjectCreate &&
    typeof subjectCreate === "object" &&
    Array.isArray((subjectCreate as Record<string, unknown>)["artifactPaths"])
  ) {
    const paths = (subjectCreate as Record<string, unknown>)["artifactPaths"] as string[];
    if (paths.length > 0) return paths[0];
  }

  const imageGen = personaManifest["imageGeneration"];
  if (
    imageGen &&
    typeof imageGen === "object" &&
    Array.isArray((imageGen as Record<string, unknown>)["artifactPaths"])
  ) {
    const paths = (imageGen as Record<string, unknown>)["artifactPaths"] as string[];
    if (paths.length > 0) return paths[0];
  }

  if (
    subjectCreate &&
    typeof subjectCreate === "object" &&
    (subjectCreate as Record<string, unknown>)["mainImage"]
  ) {
    const mainImage = (subjectCreate as Record<string, unknown>)["mainImage"];
    if (
      mainImage &&
      typeof mainImage === "object" &&
      typeof (mainImage as Record<string, unknown>)["image_uri"] === "string"
    ) {
      return (mainImage as Record<string, unknown>)["image_uri"] as string;
    }
  }

  return undefined;
}

function extractPlates(
  platesManifest: unknown | null | undefined
): string[] | undefined {
  if (!platesManifest) return undefined;

  if (Array.isArray(platesManifest)) {
    return platesManifest.filter((p): p is string => typeof p === "string");
  }

  const platesObject = assertObject(platesManifest, "plates manifest");
  const manifestOutDir =
    typeof platesObject["outDir"] === "string" ? (platesObject["outDir"] as string) : "";
  const normalizePlatePath = (value: string): string => {
    if (
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("data:") ||
      value.startsWith("file://") ||
      path.isAbsolute(value)
    ) {
      return value;
    }
    return manifestOutDir ? path.join(manifestOutDir, value) : value;
  };

  const plates = platesObject["plates"];
  if (Array.isArray(plates)) {
    return plates
      .filter((p): p is string => typeof p === "string")
      .map(normalizePlatePath);
  }

  const jobs = platesObject["jobs"];
  if (Array.isArray(jobs)) {
    const jobPlatePaths = jobs.flatMap((job) => {
      if (!job || typeof job !== "object") return [];
      const resultPlatePaths = (job as Record<string, unknown>)["resultPlatePaths"];
      return Array.isArray(resultPlatePaths)
        ? resultPlatePaths
            .filter((p): p is string => typeof p === "string")
            .map(normalizePlatePath)
        : [];
    });
    if (jobPlatePaths.length > 0) return jobPlatePaths;
  }

  const artifacts = platesObject["artifacts"];
  if (Array.isArray(artifacts)) {
    return artifacts
      .map((a) => {
        if (typeof a === "string") return normalizePlatePath(a);
        if (a && typeof a === "object") {
          const obj = a as Record<string, unknown>;
          return typeof obj["path"] === "string"
            ? normalizePlatePath(obj["path"])
            : typeof obj["url"] === "string"
            ? obj["url"]
            : undefined;
        }
        return undefined;
      })
      .filter((p): p is string => typeof p === "string");
  }

  return undefined;
}

function extractAudioPath(
  audioManifest: unknown | null | undefined,
  manifestDir: string
): string | undefined {
  if (!audioManifest) return undefined;

  const manifestObj = assertObject(audioManifest, "audio manifest");
  const manifestOutDir =
    typeof manifestObj["outDir"] === "string"
      ? (manifestObj["outDir"] as string)
      : "";

  const normalizePath = (value: string): string => {
    if (
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("data:") ||
      value.startsWith("file://") ||
      path.isAbsolute(value)
    ) {
      return value;
    }
    const candidates = manifestOutDir
      ? [path.resolve(value), path.join(manifestDir, value), path.join(manifestOutDir, value)]
      : [path.resolve(value), path.join(manifestDir, value)];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return candidates[0];
  };

  const resolveFromObject = (obj: Record<string, unknown>): string | undefined => {
    if (typeof obj["audioPath"] === "string") return normalizePath(obj["audioPath"] as string);
    if (typeof obj["mp3Path"] === "string") return normalizePath(obj["mp3Path"] as string);
    if (typeof obj["audioFile"] === "string") return normalizePath(obj["audioFile"] as string);
    return undefined;
  };

  // Shape 1: direct audioPath / audioFile / mp3Path
  const direct = resolveFromObject(manifestObj);
  if (direct) return direct;
  // Shape 1.5: audioPaths.mp3 (TTS manifest wrapper)
  const audioPaths = manifestObj["audioPaths"];
  if (audioPaths && typeof audioPaths === "object") {
    const mp3 = (audioPaths as Record<string, unknown>)["mp3"];
    if (typeof mp3 === "string") return normalizePath(mp3);
  }


  // Shape 2: nested output.audioPath
  const output = manifestObj["output"];
  if (output && typeof output === "object") {
    const fromOutput = resolveFromObject(output as Record<string, unknown>);
    if (fromOutput) return fromOutput;
  }

  // Shape 3: nested result.audioPath (MiniMax TTS manifest)
  const result = manifestObj["result"];
  if (result && typeof result === "object") {
    const fromResult = resolveFromObject(result as Record<string, unknown>);
    if (fromResult) return fromResult;
  }

  // Shape 4: nested jobs[0].audioPath
  const jobs = manifestObj["jobs"];
  if (Array.isArray(jobs) && jobs.length > 0) {
    const first = jobs[0];
    if (first && typeof first === "object") {
      const fromJob = resolveFromObject(first as Record<string, unknown>);
      if (fromJob) return fromJob;
    }
  }

  // Shape 5: top-level artifact / outputFile / audio
  for (const key of ["artifact", "outputFile", "audio"]) {
    const val = manifestObj[key];
    if (typeof val === "string") return normalizePath(val);
  }

  // Shape 6: artifacts array
  const artifacts = manifestObj["artifacts"];
  if (Array.isArray(artifacts) && artifacts.length > 0) {
    const first = artifacts[0];
    if (typeof first === "string") return normalizePath(first);
    if (first && typeof first === "object") {
      const obj = first as Record<string, unknown>;
      const pathVal = obj["audioPath"] || obj["mp3Path"] || obj["path"] || obj["url"];
      if (typeof pathVal === "string") return normalizePath(pathVal);
    }
  }

  return undefined;
}

const LAYER_ASSET_KEYS = new Set([
  "src",
  "plateUrl",
  "imageUrl",
  "fromPlate",
  "toPlate",
  "videoUrl",
  "clipUrl",
  "placeholderImage",
  "placeholderImagePath",
  "placeholderMediaPath",
]);

function isPassthroughAsset(value: string): boolean {
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:") ||
    value.startsWith("blob:")
  );
}

function resolveLocalAssetPath(value: string): string | undefined {
  if (isPassthroughAsset(value)) return undefined;
  const localPath = value.startsWith("file://") ? fileURLToPath(value) : path.resolve(value);
  return fs.existsSync(localPath) ? localPath : undefined;
}

// Normalize existing local media references without serializing bytes into inputProps.
function resolveLayerPlanUrls(layerPlan: LayerPlan): LayerPlan {
  const urlMap = new Map<string, string>();

  const toAssetUrl = (value: string): string => {
    if (isPassthroughAsset(value)) return value;
    if (!urlMap.has(value)) {
      urlMap.set(value, resolveLocalAssetPath(value) ?? value);
    }
    return urlMap.get(value)!;
  };

  return {
    beats: layerPlan.beats.map((beat) => ({
      ...beat,
      layers: beat.layers.map((layer) => {
        const nextProps: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(layer.props)) {
          if (LAYER_ASSET_KEYS.has(key) && typeof value === "string") {
            nextProps[key] = toAssetUrl(value)
          } else {
            nextProps[key] = value
          }
        }
        return { ...layer, props: nextProps }
      }),
    })),
  }
}

function extractGeneratedClips(
  generatedClipsManifest: unknown | null | undefined,
  manifestPath: string | undefined
): GeneratedClipResolution[] {
  if (!generatedClipsManifest) return [];
  const manifestObj = assertObject(generatedClipsManifest, "generated clips manifest");
  const manifestDir = manifestPath ? path.dirname(path.resolve(manifestPath)) : process.cwd();
  const clips = getArray(manifestObj, "clips");
  return clips.map((clip, index) => {
    const obj = assertObject(clip, `generated clip ${index}`);
    const artifact = assertObject(obj["artifact"], `generated clip ${index} artifact`);
    const generation = assertObject(obj["generation"], `generated clip ${index} generation`);
    const artifactPath = getString(artifact, "path");
    const resolved = resolveRepoRelativeCandidate(artifactPath, manifestDir);
    const mediaAvailable = Boolean(resolved && fs.existsSync(resolved));
    return {
      clipId: getString(obj, "clipId"),
      artifactPath,
      mediaType:
        typeof artifact["mediaType"] === "string"
          ? (artifact["mediaType"] as string)
          : "video/mp4",
      durationSec: getNumber(generation, "durationSec"),
      fps: getNumber(generation, "fps"),
      dryRun: generation["dryRun"] === true,
      mediaAvailable,
      resolvedMediaPath: mediaAvailable ? resolved : undefined,
      missingLiveMediaReason: mediaAvailable
        ? undefined
        : `Generated clip manifest records ${artifactPath}, but no local MP4 exists. Rendering uses the explicit placeholder layer.`,
    };
  });
}

function resolveRepoRelativeCandidate(value: string, baseDir: string): string | undefined {
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) {
    return value;
  }
  const candidates = value.startsWith("file://")
    ? [new URL(value).pathname]
    : path.isAbsolute(value)
      ? [path.resolve(value)]
      : [path.resolve(value), path.resolve(baseDir, value)];
  const repo = process.cwd();
  return candidates.find((candidate) => candidate === repo || candidate.startsWith(`${repo}${path.sep}`));
}

function applyGeneratedClipManifest(layerPlan: LayerPlan, clips: GeneratedClipResolution[]): LayerPlan {
  if (clips.length === 0) return layerPlan;
  const byId = new Map(clips.map((clip) => [clip.clipId, clip]));
  const firstClip = clips[0]!;
  return {
    beats: layerPlan.beats.map((beat) => ({
      ...beat,
      layers: beat.layers.map((layer) => {
        if (layer.type !== "ClipLayer") return layer;
        const props = layer.props as Record<string, unknown>;
        const requested =
          typeof props.generatedClipId === "string"
            ? props.generatedClipId
            : typeof props.clipId === "string"
              ? props.clipId
              : undefined;
        const clip = (requested ? byId.get(requested) : undefined) ?? firstClip;
        const nextProps: Record<string, unknown> = {
          ...props,
          generatedClipId: clip.clipId,
          plannedArtifactPath: props.plannedArtifactPath ?? clip.artifactPath,
          artifactPath: clip.artifactPath,
          mediaType: clip.mediaType,
          mediaAvailable: clip.mediaAvailable,
          dryRun: clip.dryRun,
        };
        if (clip.resolvedMediaPath) {
          nextProps.src = clip.resolvedMediaPath;
          delete nextProps.missingLiveMedia;
          delete nextProps.missingLiveMediaReason;
        } else {
          nextProps.missingLiveMedia = true;
          nextProps.missingLiveMediaReason = clip.missingLiveMediaReason;
        }
        return { ...layer, props: nextProps };
      }),
    })),
  };
}

function injectPresenterPersona(layerPlan: LayerPlan, personaImagePath: string | undefined): LayerPlan {
  if (!personaImagePath) return layerPlan;
  return {
    beats: layerPlan.beats.map((beat) => ({
      ...beat,
      layers: beat.layers.map((layer) => {
        if (layer.type !== "PresenterLayer") return layer;
        const props = layer.props as Record<string, unknown>;
        if (typeof props.src === "string" && props.src.length > 0) return layer;
        return { ...layer, props: { ...props, src: personaImagePath } };
      }),
    })),
  };
}

function buildInputProps(options: {
  manifest: Record<string, unknown>;
  decomposition: Record<string, unknown> | null;
  personaManifest: Record<string, unknown>;
  platesManifest: unknown | null | undefined;
  audioManifest: unknown | null | undefined;
  audioPath: string | undefined;
  audioManifestDir: string;
  fps: number;
  width: number;
  height: number;
  layerPlan: LayerPlan | undefined;
  layerPlanExtras: Record<string, unknown>;
  captionCues: CaptionCue[] | undefined;
}): TiktokRecreateProps {
  const {
    manifest,
    decomposition,
    personaManifest,
    platesManifest,
    audioManifest,
    audioPath,
    audioManifestDir,
    fps,
    width,
    height,
    layerPlan,
    layerPlanExtras,
    captionCues,
  } = options;

  // Resolve target video: layer-plan extras > manifest id > decomposition lookup > first video.
  let video: Record<string, unknown>;
  if (manifest["id"]) {
    video = manifest;
  } else if (decomposition && decomposition["source_video_id"]) {
    const videos = getArray(manifest, "videos");
    const id = getString(decomposition, "source_video_id");
    const match = videos.find(
      (v): v is Record<string, unknown> =>
        typeof v === "object" &&
        v !== null &&
        (v as Record<string, unknown>)["id"] === id
    );
    if (!match) {
      throw new Error(
        `No video with id "${id}" found in manifest.videos`
      );
    }
    video = match;
  } else {
    const videos = getArray(manifest, "videos");
    if (videos.length === 0) {
      throw new Error("No videos in manifest and no decomposition to resolve one");
    }
    video = assertObject(videos[0], "first video");
  }

  const sourceVideoId =
    typeof layerPlanExtras.videoId === "string"
      ? layerPlanExtras.videoId
      : getString(video, "id");
  const title =
    typeof layerPlanExtras.title === "string"
      ? layerPlanExtras.title
      : getString(video, "title");
  const transcript = getString(video, "transcript");
  const durationSeconds =
    typeof layerPlanExtras.durationSeconds === "number"
      ? layerPlanExtras.durationSeconds
      : getNumber(video, "duration");
  const durationInFrames = Math.ceil(durationSeconds * fps);

  // Build segments only when decomposition is present.
  const segments: Segment[] = (() => {
    if (!decomposition) return [];
    const timelineRaw = getArray(decomposition, "timeline");
    const timeline = timelineRaw.map((item) => {
      const obj = assertObject(item, "timeline item");
      return {
        start_seconds: getNumber(obj, "start_seconds"),
        end_seconds: getNumber(obj, "end_seconds"),
        narration_function: getString(obj, "narration_function"),
        visual_function: getString(obj, "visual_function"),
      };
    });
    const captions = splitTranscriptIntoCaptions(
      transcript,
      timeline,
      durationSeconds,
    );
    return timeline.map((item, i) => {
      const startFrame = Math.floor(item.start_seconds * fps);
      const endFrame = Math.min(
        durationInFrames,
        Math.ceil(item.end_seconds * fps)
      );
      return {
        startFrame,
        endFrame: Math.max(startFrame + 1, endFrame),
        narrationFunction: item.narration_function,
        visualFunction: item.visual_function,
        caption: captions[i] || item.narration_function,
      };
    });
  })();

  const personaImageUrl = extractPersonaImageUrl(personaManifest);
  const plates = extractPlates(platesManifest);

  // Audio precedence: explicit --audio > layer-plan ttsManifest > --audio-manifest.
  let audioUrl: string | undefined = audioPath;
  if (!audioUrl && typeof layerPlanExtras.ttsManifest === "string") {
    const tts = readJsonFile(layerPlanExtras.ttsManifest);
    if (tts && typeof tts === "object") {
      const ttsDir = path.dirname(path.resolve(layerPlanExtras.ttsManifest));
      audioUrl = extractAudioPath(tts, ttsDir);
    }
  }
  if (!audioUrl) {
    audioUrl = extractAudioPath(audioManifest, audioManifestDir);
  }

  return {
    sourceVideoId,
    title,
    transcript,
    durationInFrames,
    segments,
    layerPlan,
    personaImageUrl,
    plates,
    audioUrl,
    width,
    height,
    fps,
    captionCues,
  };
}

function stageInputAssets(inputProps: TiktokRecreateProps, outDir: string): TiktokRecreateProps {
  const publicDir = path.resolve(outDir, "public");
  const assetsDir = path.join(publicDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  const staged = new Map<string, string>();

  const stageValue = (value: string | undefined): string | undefined => {
    if (!value) return value;
    const sourcePath = resolveLocalAssetPath(value);
    if (!sourcePath) return value;
    const existing = staged.get(sourcePath);
    if (existing) return existing;

    const basename = path.basename(sourcePath).replace(/[^a-zA-Z0-9._-]/g, "_");
    const relative = `assets/${staged.size}-${basename}`;
    fs.copyFileSync(sourcePath, path.join(publicDir, relative));
    staged.set(sourcePath, relative);
    return relative;
  };

  const layerPlan = inputProps.layerPlan
    ? {
        beats: inputProps.layerPlan.beats.map((beat) => ({
          ...beat,
          layers: beat.layers.map((layer) => {
            const nextProps: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(layer.props)) {
              nextProps[key] = LAYER_ASSET_KEYS.has(key) && typeof value === "string" ? stageValue(value) : value;
            }
            return { ...layer, props: nextProps };
          }),
        })),
      }
    : undefined;

  return {
    ...inputProps,
    layerPlan,
    personaImageUrl: stageValue(inputProps.personaImageUrl),
    plates: inputProps.plates?.map((plate) => stageValue(plate) ?? plate),
    audioUrl: stageValue(inputProps.audioUrl),
  };
}

async function main() {
  const flags = parseArgs(process.argv);

  if (flags.help || flags.h) {
    console.log(usage());
    process.exit(0);
  }

  const manifestPath = flags.manifest;
  const decompositionPath = flags.decomposition;
  const layerPlanPath = flags["layer-plan"];
  const personaManifestPath = flags["persona-manifest"];
  const outDir = flags.out;

  if (!manifestPath) fail("--manifest is required");
  if (!decompositionPath && !layerPlanPath) fail("either --decomposition or --layer-plan is required");
  if (!personaManifestPath) fail("--persona-manifest is required");
  if (!outDir) fail("--out is required");

  const fps = Number(flags.fps || "30");
  const width = Number(flags.width || "1080");
  const height = Number(flags.height || "1920");

  if (!Number.isFinite(fps) || fps <= 0) fail("--fps must be a positive number");
  if (!Number.isFinite(width) || width <= 0) fail("--width must be a positive number");
  if (!Number.isFinite(height) || height <= 0) fail("--height must be a positive number");
  const frameRange = parseFrameRange(flags["frame-range"]);
  const captionStyleFlag = flags["caption-style"] ?? "word";
  if (captionStyleFlag !== "word" && captionStyleFlag !== "phrase") {
    fail("--caption-style must be either word or phrase");
  }
  const captionStyle = captionStyleFlag as CaptionStyle;
  const captionPath = flags["captions"];
  const captionCues = captionPath ? parseWebVttCaptions(captionPath, fps, captionStyle) : undefined;


  const manifest = assertObject(
    readJsonFile(manifestPath),
    "manifest"
  );
  const decomposition = decompositionPath
    ? assertObject(readJsonFile(decompositionPath), "decomposition")
    : null;
  const personaManifest = assertObject(
    readJsonFile(personaManifestPath),
    "persona manifest"
  );
  const personaImagePath = extractPersonaImageUrl(personaManifest);
  const platesManifest = flags["plates-manifest"]
    ? readJsonFile(flags["plates-manifest"])
    : null;
  const audioManifestPath = flags["audio-manifest"];
  const audioManifestDir = audioManifestPath
    ? path.dirname(path.resolve(audioManifestPath))
    : process.cwd();
  const audioPath: string | undefined = flags["audio"];
  const audioManifest = audioManifestPath
    ? readJsonFile(audioManifestPath)
    : null;
  const generatedClipsManifestPath = flags["generated-clips-manifest"];
  const generatedClipsManifest = generatedClipsManifestPath
    ? readJsonFile(generatedClipsManifestPath)
    : null;
  const generatedClipResolutions = extractGeneratedClips(
    generatedClipsManifest,
    generatedClipsManifestPath
  );

  let layerPlan: LayerPlan | undefined;
  const layerPlanExtras: Record<string, unknown> = {};
  if (layerPlanPath) {
    const raw = readJsonFile(layerPlanPath);
    const rawObj = assertObject(raw, "layer plan");
    layerPlanExtras.videoId = rawObj["videoId"];
    layerPlanExtras.title = rawObj["title"];
    layerPlanExtras.durationSeconds = rawObj["durationSeconds"];
    layerPlanExtras.ttsManifest = rawObj["ttsManifest"];

    // Beats may live inside a `timeRange` wrapper (startFrame/endFrame per beat).
    const rawBeats = rawObj["beats"];
    if (!Array.isArray(rawBeats)) {
      throw new Error("layer plan must contain a beats array");
    }
    const normalizedBeats = rawBeats.map((beat) => {
      const obj = assertObject(beat, "beat");
      const timeRange = obj["timeRange"];
      const timeObj =
        timeRange && typeof timeRange === "object"
          ? assertObject(timeRange, "timeRange")
          : null;
      const startFrame = timeObj
        ? getNumber(timeObj, "startFrame")
        : getNumber(obj, "startFrame");
      const endFrame = timeObj
        ? getNumber(timeObj, "endFrame")
        : getNumber(obj, "endFrame");
      const layers = getArray(obj, "layers");
      return {
        startFrame,
        endFrame,
        layers,
      };
    });

    const parsedLayerPlan = layerPlanSchema.parse({ beats: normalizedBeats });
    layerPlan = resolveLayerPlanUrls(
      injectPresenterPersona(
        applyGeneratedClipManifest(parsedLayerPlan, generatedClipResolutions),
        personaImagePath,
      )
    );
  }

  const rawInputProps = buildInputProps({
    manifest,
    decomposition,
    personaManifest,
    platesManifest,
    audioManifest,
    audioPath,
    audioManifestDir,
    fps,
    width,
    height,
    layerPlan,
    layerPlanExtras,
    captionCues,
  });

  fs.mkdirSync(path.resolve(outDir), { recursive: true });
  const inputProps = stageInputAssets(rawInputProps, outDir);

  const entryPoint = path.resolve(
    import.meta.dirname,
    "Root.tsx"
  );

  console.log("Bundling Remotion composition...");
  const serveUrl = await bundle({
    entryPoint,
    publicDir: path.resolve(outDir, "public"),
    webpackOverride: (config) => config,
  });


  console.log("Selecting composition...");
  const composition = await selectComposition({
    serveUrl,
    id: "TiktokRecreate",
    inputProps,
  });

  const outputPath = path.resolve(outDir, "recreate.mp4");

  console.log(`Rendering MP4: ${outputPath}`);
  console.log(`Composition: ${composition.id} ${composition.width}x${composition.height} @ ${composition.fps}fps, ${composition.durationInFrames} frames`);

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    ...(frameRange ? { frameRange } : {}),
  });

  const resultManifest = {
    schemaVersion: "tiktok-recreate.render.v1",
    sourceVideoId: inputProps.sourceVideoId,
    renderedAt: new Date().toISOString(),
    durationInFrames: inputProps.durationInFrames,
    fps,
    width: composition.width,
    height: composition.height,
    mp4: outputPath,
    relativeMp4: path.relative(process.cwd(), outputPath),
    ...(inputProps.audioUrl ? { audioUrl: inputProps.audioUrl } : {}),
    ...(audioManifestPath ? { audioManifestPath } : {}),
    ...(frameRange ? { frameRange } : {}),
    ...(captionPath ? { captionPath, captionStyle, captionCueCount: captionCues?.length ?? 0 } : {}),
    ...(generatedClipsManifestPath
      ? {
          generatedClipsManifestPath,
          generatedClips: generatedClipResolutions.map((clip) => ({
            clipId: clip.clipId,
            artifactPath: clip.artifactPath,
            mediaAvailable: clip.mediaAvailable,
            resolvedMediaPath: clip.resolvedMediaPath,
            missingLiveMediaReason: clip.missingLiveMediaReason,
          })),
        }
      : {}),
  };

  const manifestPathOut = path.resolve(outDir, "manifest.json");
  fs.writeFileSync(manifestPathOut, JSON.stringify(resultManifest, null, 2));

  console.log(`\nDone:`);
  console.log(`  MP4:   ${outputPath}`);
  console.log(`  Meta:  ${manifestPathOut}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import type { AlignmentTuple } from './messages';

const PUNCTUATION_RE = /[，。！？；：、“”‘’（）()《》〈〉【】…,.!?;:]/;

type SegmentMs = {
  startMs: number;
  endMs: number;
  voicedStartMs: number;
  voicedEndMs: number;
};

function charWeight(ch: string): number {
  if (!ch.trim()) {
    return 0.2;
  }
  if (PUNCTUATION_RE.test(ch)) {
    return 0.45;
  }
  return 1;
}

function detectVoicedSegments(pcm: Float32Array, sampleRate: number): SegmentMs[] {
  if (pcm.length === 0 || sampleRate <= 0) {
    return [];
  }

  const windowSize = Math.max(1, Math.floor(sampleRate * 0.02));
  const windows: Array<{ start: number; end: number; rms: number }> = [];
  let peakRms = 0;

  for (let start = 0; start < pcm.length; start += windowSize) {
    const end = Math.min(pcm.length, start + windowSize);
    let sum = 0;
    for (let i = start; i < end; i += 1) {
      const v = pcm[i] ?? 0;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    peakRms = Math.max(peakRms, rms);
    windows.push({ start, end, rms });
  }

  const threshold = Math.max(0.0005, peakRms * 0.2);
  const minVoicedWindows = 1;
  const rawSegments: Array<{ start: number; end: number }> = [];
  let runStart = -1;
  let runLength = 0;

  for (let i = 0; i < windows.length; i += 1) {
    const voiced = windows[i].rms >= threshold;
    if (voiced) {
      if (runStart < 0) {
        runStart = i;
      }
      runLength += 1;
      continue;
    }
    if (runStart >= 0 && runLength >= minVoicedWindows) {
      rawSegments.push({
        start: windows[runStart].start,
        end: windows[i - 1].end
      });
    }
    runStart = -1;
    runLength = 0;
  }

  if (runStart >= 0 && runLength >= minVoicedWindows) {
    rawSegments.push({
      start: windows[runStart].start,
      end: windows[windows.length - 1].end
    });
  }

  if (rawSegments.length === 0) {
    rawSegments.push({ start: 0, end: pcm.length });
  }

  const segments: SegmentMs[] = [];
  let voicedCursorMs = 0;
  for (const segment of rawSegments) {
    const startMs = (segment.start / sampleRate) * 1000;
    const endMs = (segment.end / sampleRate) * 1000;
    const voicedDurationMs = Math.max(0, endMs - startMs);
    segments.push({
      startMs,
      endMs,
      voicedStartMs: voicedCursorMs,
      voicedEndMs: voicedCursorMs + voicedDurationMs
    });
    voicedCursorMs += voicedDurationMs;
  }

  return segments;
}

function voicedToTimelineMs(segments: SegmentMs[], voicedMs: number): number {
  if (segments.length === 0) {
    return voicedMs;
  }
  if (voicedMs <= 0) {
    return segments[0].startMs;
  }

  for (const seg of segments) {
    if (voicedMs <= seg.voicedEndMs) {
      return seg.startMs + (voicedMs - seg.voicedStartMs);
    }
  }
  return segments[segments.length - 1].endMs;
}

export function alignTextToWaveform(
  text: string,
  pcm: Float32Array,
  sampleRate: number
): AlignmentTuple[] {
  if (!text || sampleRate <= 0) {
    return [];
  }

  const segments = detectVoicedSegments(pcm, sampleRate);
  const totalVoicedMs =
    segments.length > 0
      ? segments[segments.length - 1].voicedEndMs
      : (pcm.length / sampleRate) * 1000;

  const chars = Array.from(text);
  const weights = chars.map((ch) => charWeight(ch));
  const weightSum = Math.max(0.0001, weights.reduce((sum, w) => sum + w, 0));
  const minSpanMs = 20;

  let voicedCursorMs = 0;
  const tuples: AlignmentTuple[] = [];
  for (let i = 0; i < chars.length; i += 1) {
    const weightedMs = (totalVoicedMs * weights[i]) / weightSum;
    const startMs = voicedToTimelineMs(segments, voicedCursorMs);
    const endTargetVoicedMs = voicedCursorMs + weightedMs;
    let endMs = voicedToTimelineMs(segments, endTargetVoicedMs);
    if (endMs <= startMs) {
      endMs = startMs + minSpanMs;
    }
    tuples.push({
      charIndex: i,
      startMs: Math.round(startMs),
      endMs: Math.round(endMs)
    });
    voicedCursorMs = endTargetVoicedMs;
  }

  for (let i = 1; i < tuples.length; i += 1) {
    if (tuples[i].startMs < tuples[i - 1].endMs) {
      tuples[i].startMs = tuples[i - 1].endMs;
    }
    if (tuples[i].endMs <= tuples[i].startMs) {
      tuples[i].endMs = tuples[i].startMs + minSpanMs;
    }
  }

  return tuples;
}

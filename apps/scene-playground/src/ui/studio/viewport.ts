// ---------------------------------------------------------------------------
// Viewport — canvas host + transport with RAF-based live frame counter
// ---------------------------------------------------------------------------

import { type SceneSpec, clamp, specDurationInFrames } from "./state";

export interface ViewportHandle {
  updateState(playing: boolean, frame: number, spec: SceneSpec | null): void;
  getFrame(): number;
  flashObject(): void;
  destroy(): void;
}

export interface ViewportCallbacks {
  onPlayToggle(playing: boolean): void;
  onScrub(frame: number): void;
  onFrameTick(frame: number): void;
}

export function createViewport(
  previewContainer: HTMLElement,
  transportContainer: HTMLElement,
  cbs: ViewportCallbacks,
): ViewportHandle {
  // -- Build transport DOM --
  transportContainer.textContent = "";

  const playBtn = document.createElement("button");
  playBtn.className = "transport-btn";
  playBtn.textContent = "pause";

  const scrubInput = document.createElement("input");
  scrubInput.type = "range";
  scrubInput.className = "transport-scrub";
  scrubInput.min = "0";
  scrubInput.max = "0";
  scrubInput.value = "0";

  const beatSpan = document.createElement("span");
  beatSpan.className = "beat";
  beatSpan.textContent = "beat";

  const frameReadout = document.createElement("span");
  frameReadout.className = "frame-readout";
  frameReadout.textContent = "0 / 0";

  const resBadge = document.createElement("span");
  resBadge.className = "res-badge";

  transportContainer.append(playBtn, scrubInput, beatSpan, frameReadout, resBadge);

  // -- RAF playback tracker --
  let rafId = 0;
  let playStartTime = 0;
  let playStartFrame = 0;
  let currentFrame = 0;
  let isPlaying = false;
  let specFps = 30;
  let totalFrames = 0;
  let bpm = 120;
  let lastBeatFlash = 0;

  function tick(): void {
    if (!isPlaying) return;
    const elapsed = (performance.now() - playStartTime) / 1000;
    const frame = Math.floor(playStartFrame + elapsed * specFps);
    const clamped = clamp(frame, 0, Math.max(0, totalFrames - 1));
    currentFrame = clamped;
    scrubInput.value = String(clamped);
    frameReadout.textContent = `${clamped} / ${Math.max(0, totalFrames - 1)}`;

    // Beat flash
    const secondsPerBeat = 60 / bpm;
    const currentSec = clamped / specFps;
    const beatPhase = currentSec % secondsPerBeat;
    if (beatPhase < 0.08 && performance.now() - lastBeatFlash > 180) {
      lastBeatFlash = performance.now();
      beatSpan.classList.add("flash");
      setTimeout(() => beatSpan.classList.remove("flash"), 110);
    }

    // Loop: if past end, wrap to 0
    if (clamped >= totalFrames - 1 && totalFrames > 0) {
      playStartTime = performance.now();
      playStartFrame = 0;
    }

    cbs.onFrameTick(clamped);
    rafId = requestAnimationFrame(tick);
  }

  function startTicking(fromFrame: number): void {
    isPlaying = true;
    playStartTime = performance.now();
    playStartFrame = fromFrame;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function stopTicking(): void {
    isPlaying = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // -- Events --
  playBtn.addEventListener("click", () => {
    const next = !isPlaying;
    playBtn.textContent = next ? "pause" : "play";
    if (next) {
      startTicking(currentFrame);
    } else {
      stopTicking();
    }
    cbs.onPlayToggle(next);
  });

  scrubInput.addEventListener("input", () => {
    const frame = Number.parseInt(scrubInput.value, 10);
    currentFrame = frame;
    frameReadout.textContent = `${frame} / ${Math.max(0, totalFrames - 1)}`;
    if (isPlaying) {
      stopTicking();
      playBtn.textContent = "play";
    }
    cbs.onScrub(frame);
  });

  return {
    updateState(playing: boolean, frame: number, spec: SceneSpec | null): void {
      specFps = spec?.fps ?? 30;
      totalFrames = spec !== null ? specDurationInFrames(spec) : 0;
      bpm = spec?.timeline?.bpm ?? 120;
      currentFrame = frame;

      scrubInput.max = String(Math.max(0, totalFrames - 1));
      if (!isPlaying) {
        scrubInput.value = String(frame);
        frameReadout.textContent = `${frame} / ${Math.max(0, totalFrames - 1)}`;
      }
      playBtn.textContent = playing ? "pause" : "play";
      resBadge.textContent = spec !== null ? `${spec.width}\u00D7${spec.height} @${spec.fps}fps` : "";

      if (playing && !isPlaying) {
        startTicking(frame);
      } else if (!playing && isPlaying) {
        stopTicking();
      }
    },

    getFrame(): number {
      return currentFrame;
    },

    flashObject(): void {
      const overlay = document.createElement("div");
      overlay.className = "flash-overlay";
      previewContainer.style.position = "relative";
      previewContainer.append(overlay);
      overlay.addEventListener("animationend", () => overlay.remove());
    },

    destroy(): void {
      stopTicking();
    },
  };
}

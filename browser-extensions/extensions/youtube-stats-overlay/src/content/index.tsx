import { createMemo, For } from "solid-js";
import { render } from "solid-js/web";
import cssText from "./styles.css?inline";

type Metric = {
  label: string;
  value: string;
  tone?: "neutral" | "accent";
};

type PercentileBand = {
  label: string;
  lower: number[];
  upper: number[];
  tone: "low" | "mid" | "high" | "top";
};

type VideoStats = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  lastUpdated: string;
  metrics: Metric[];
  viewsTotal: string;
  chart: {
    thisVideo: number[];
    median: number[];
    bands: PercentileBand[];
    labels: string[];
  };
  titleChanges: Array<{
    title: string;
    tag: string;
  }>;
};

const ROOT_ID = "yt-stats-overlay-root";
const OBSERVER_ROOT_ID = "yt-stats-overlay-observer-root";
const STYLE_ID = "yt-stats-overlay-styles";
let disposeOverlay: (() => void) | undefined;

function compactNumber(value: number) {
  const formatter = new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
  });
  return formatter.format(value);
}

function getVideoId() {
  const url = new URL(location.href);
  return url.searchParams.get("v");
}

function textFrom(selectors: string[]) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const text = element?.textContent?.trim();
    if (text) return text.replace(/\s+/g, " ");
  }
  return "";
}

function readPageStats(videoId: string): VideoStats {
  const title =
    textFrom(["h1.ytd-watch-metadata", "h1.title", "#title h1"]) ||
    "Andrej Karpathy: From Vibe Coding to Agentic Engineering...";
  const channelTitle =
    textFrom(["#owner #channel-name a", "ytd-video-owner-renderer #channel-name a"]) ||
    "Sequoia Capital";
  const seed = Array.from(videoId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const outlier = Math.max(1.4, ((seed % 180) + 30) / 10);
  const vph = Math.max(24, (seed * 3) % 480);
  const engagement = Math.max(1.1, ((seed % 42) + 12) / 10);
  const thisVideo = [45, 295, 430, 570, 650, 710, 750, 790, 835, 875, 910, 940, 980, 1020];
  const p10 = [18, 34, 48, 62, 75, 86, 96, 104, 112, 119, 126, 132, 138, 144];
  const p25 = [28, 54, 80, 106, 130, 150, 168, 184, 198, 211, 224, 236, 248, 260];
  const p50 = [45, 92, 142, 194, 242, 286, 325, 360, 392, 422, 450, 476, 500, 524];
  const p75 = [82, 160, 240, 318, 388, 452, 510, 562, 612, 656, 696, 732, 766, 798];
  const p90 = [132, 246, 352, 454, 548, 632, 710, 780, 846, 906, 960, 1010, 1056, 1100];

  return {
    videoId,
    title,
    channelTitle,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
    lastUpdated: "04/30/2026",
    metrics: [
      { label: "Engagement", value: `${engagement.toFixed(1)}%` },
      { label: "Outlier", value: `${outlier.toFixed(1)}x`, tone: "accent" },
      { label: "VPH", value: vph.toFixed(1) },
    ],
    viewsTotal: compactNumber(1_100_000 + seed * 17),
    chart: {
      thisVideo,
      median: p50,
      bands: [
        { label: "10-25%", lower: p10, upper: p25, tone: "low" },
        { label: "25-50%", lower: p25, upper: p50, tone: "mid" },
        { label: "50-75%", lower: p50, upper: p75, tone: "high" },
        { label: "75-90%", lower: p75, upper: p90, tone: "top" },
      ],
      labels: ["0", "4D", "8D", "12D", "16D", "20D", "24D", "28D"],
    },
    titleChanges: [
      {
        title: `${title.replace(/\s+/g, " ").slice(0, 72)}${title.length > 72 ? "..." : ""}`,
        tag: "06/03/2026",
      },
      {
        title: title.replace(" w/ Stephanie Zhan", "").slice(0, 86),
        tag: "Original Title",
      },
    ],
  };
}

function makePath(points: number[], width: number, height: number, max: number) {
  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - (point / max) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function makeBandPath(lower: number[], upper: number[], width: number, height: number, max: number) {
  const upperPath = upper
    .map((point, index) => {
      const x = (index / (upper.length - 1)) * width;
      const y = height - (point / max) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const lowerPath = lower
    .map((point, index) => {
      const x = (index / (lower.length - 1)) * width;
      const y = height - (point / max) * height;
      return `L ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .reverse()
    .join(" ");
  return `${upperPath} ${lowerPath} Z`;
}

function Chart(props: { stats: VideoStats }) {
  const width = 530;
  const height = 210;
  const percentileValues = props.stats.chart.bands.flatMap((band) => [...band.lower, ...band.upper]);
  const max = Math.max(...props.stats.chart.thisVideo, ...props.stats.chart.median, ...percentileValues) * 1.06;
  const gradientPrefix = `yso-${props.stats.videoId.replace(/[^a-z0-9_-]/gi, "")}`;

  return (
    <div class="yso-chart-card">
      <div class="yso-chart-header">
        <div class="yso-chart-total">{props.stats.viewsTotal}</div>
        <button class="yso-select" type="button">View performance</button>
        <div class="yso-legend">
          <span class="yso-legend-dot yso-blue" />
          <span>This video</span>
          <span class="yso-legend-line" />
          <span>Median</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} class="yso-chart" aria-label="Views over time">
        <defs>
          <linearGradient id={`${gradientPrefix}-low`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stop-color="#e7ecf4" stop-opacity="0.86" />
            <stop offset="100%" stop-color="#d8e0ec" stop-opacity="0.66" />
          </linearGradient>
          <linearGradient id={`${gradientPrefix}-mid`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stop-color="#d9f2f6" stop-opacity="0.78" />
            <stop offset="100%" stop-color="#b9e6f2" stop-opacity="0.62" />
          </linearGradient>
          <linearGradient id={`${gradientPrefix}-high`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stop-color="#dce8ff" stop-opacity="0.8" />
            <stop offset="100%" stop-color="#adc7ff" stop-opacity="0.62" />
          </linearGradient>
          <linearGradient id={`${gradientPrefix}-top`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stop-color="#f8d7e5" stop-opacity="0.82" />
            <stop offset="100%" stop-color="#f5b8d1" stop-opacity="0.64" />
          </linearGradient>
        </defs>
        <For each={props.stats.chart.bands}>
          {(band) => (
            <path
              d={makeBandPath(band.lower, band.upper, width, height, max)}
              class="yso-percentile-band"
              fill={`url(#${gradientPrefix}-${band.tone})`}
            />
          )}
        </For>
        <For each={[0.25, 0.5, 0.75]}>
          {(position) => (
            <line
              x1="0"
              x2={width}
              y1={height * position}
              y2={height * position}
              class="yso-grid-line"
            />
          )}
        </For>
        <path d={makePath(props.stats.chart.median, width, height, max)} class="yso-chart-median" />
        <path d={makePath(props.stats.chart.thisVideo, width, height, max)} class="yso-chart-line" />
        <circle cx="0" cy={height - (props.stats.chart.thisVideo[0] / max) * height} r="7" class="yso-start-dot" />
      </svg>
      <div class="yso-percentile-key" aria-label="Percentile bands">
        <For each={props.stats.chart.bands}>
          {(band) => (
            <div class={`yso-band-key yso-band-${band.tone}`}>
              <span />
              <strong>{band.label}</strong>
            </div>
          )}
        </For>
      </div>
      <div class="yso-axis">
        <For each={props.stats.chart.labels}>{(label) => <span>{label}</span>}</For>
      </div>
    </div>
  );
}

function OverlayPanel(props: { stats: VideoStats }) {
  const shortTitle = createMemo(() =>
    props.stats.title.length > 54 ? `${props.stats.title.slice(0, 54)}...` : props.stats.title,
  );

  return (
    <aside class="yso-panel" aria-label="YouTube stats overlay prototype">
      <div class="yso-topbar">
        <div class="yso-logo">IQ</div>
        <div class="yso-tabs" role="tablist">
          <button class="yso-tab yso-active" type="button">Views</button>
          <button class="yso-tab" type="button">Overview</button>
          <button class="yso-tab" type="button">AI Coach</button>
        </div>
        <button class="yso-collapse" type="button" aria-label="Collapse">^</button>
      </div>

      <div class="yso-metrics">
        <For each={props.stats.metrics}>
          {(metric) => (
            <div class="yso-metric">
              <div class="yso-metric-label">{metric.label}</div>
              <div class={`yso-metric-pill ${metric.tone === "accent" ? "yso-accent" : ""}`}>
                {metric.value}
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="yso-range-tabs">
        <button type="button">24 hours</button>
        <button type="button">1st 7 days</button>
        <button class="yso-range-active" type="button">1st 28 days</button>
        <button type="button">All</button>
      </div>

      <Chart stats={props.stats} />

      <div class="yso-thumbnail-card">
        <img src={props.stats.thumbnailUrl} alt="" />
        <div class="yso-thumbnail-copy">
          <strong>{shortTitle()}</strong>
          <span>Last Updated {props.stats.lastUpdated}</span>
          <button type="button">See similar thumbnails</button>
        </div>
      </div>

      <section class="yso-title-card">
        <div class="yso-card-heading">
          <h2>Title Changes</h2>
          <button type="button" aria-label="Collapse title changes">^</button>
        </div>
        <For each={props.stats.titleChanges}>
          {(change) => (
            <div class="yso-title-row">
              <strong>{change.title}</strong>
              <span>{change.tag}</span>
            </div>
          )}
        </For>
      </section>

      <div class="yso-ask-row">
        <button type="button" class="yso-ask">Ask vidIQ</button>
        <button type="button" class="yso-summary">Summarize</button>
      </div>
    </aside>
  );
}

function findRightRail() {
  return (
    document.querySelector<HTMLElement>("#secondary-inner") ||
    document.querySelector<HTMLElement>("#secondary") ||
    document.querySelector<HTMLElement>("ytd-watch-flexy #secondary")
  );
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = cssText;
  document.head.append(style);
}

function ensureMount() {
  const videoId = getVideoId();
  const rightRail = findRightRail();
  if (!videoId || !rightRail) return;

  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    rightRail.prepend(root);
  }

  if (root.dataset.videoId === videoId && root.childElementCount > 0) return;

  const stats = readPageStats(videoId);
  disposeOverlay?.();
  root.innerHTML = "";
  root.dataset.videoId = videoId;
  disposeOverlay = render(() => <OverlayPanel stats={stats} />, root);
}

function scheduleMount() {
  window.setTimeout(ensureMount, 200);
  window.setTimeout(ensureMount, 900);
}

function boot() {
  if (document.getElementById(OBSERVER_ROOT_ID)) return;
  ensureStyles();
  const marker = document.createElement("meta");
  marker.id = OBSERVER_ROOT_ID;
  document.head.append(marker);

  scheduleMount();
  window.addEventListener("yt-navigate-finish", scheduleMount);
  window.addEventListener("popstate", scheduleMount);

  const observer = new MutationObserver(() => {
    const videoId = getVideoId();
    const root = document.getElementById(ROOT_ID);
    if (videoId && (!root || root.dataset.videoId !== videoId)) {
      scheduleMount();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

boot();

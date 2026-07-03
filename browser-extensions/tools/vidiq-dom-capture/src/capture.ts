import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";

type ChromeTarget = {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

type CdpResult<T> = {
  result?: T;
  exceptionDetails?: unknown;
};

type RuntimeEvaluateResult = {
  result: {
    value?: unknown;
    description?: string;
  };
  exceptionDetails?: unknown;
};

type CaptureSnapshot = {
  href?: string;
  title?: string;
  elements?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

const cdpUrl = process.env.CHROME_CDP_URL ?? "http://127.0.0.1:9222";
const urlMatch = process.env.VIDIQ_CAPTURE_URL_MATCH ?? "youtube.com/watch";
const limit = Number(process.env.VIDIQ_CAPTURE_LIMIT ?? "80");
const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
const outputDir =
  process.env.VIDIQ_CAPTURE_OUT_DIR ??
  path.join(workspaceRoot, "reveng/vidiq-vision/captures/dom");

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fetchTargets() {
  const response = await fetch(new URL("/json", cdpUrl));
  if (!response.ok) {
    throw new Error(`Failed to read Chrome targets from ${cdpUrl}: ${response.status}`);
  }
  return (await response.json()) as ChromeTarget[];
}

function pickTarget(targets: ChromeTarget[]) {
  const pageTargets = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  return (
    pageTargets.find((target) => target.url.includes(urlMatch)) ??
    pageTargets.find((target) => target.url.includes("youtube.com")) ??
    pageTargets[0]
  );
}

class CdpClient {
  private id = 1;
  private pending = new Map<number, (message: unknown) => void>();

  constructor(private readonly socket: WebSocket) {
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as { id?: number };
      if (typeof message.id !== "number") return;
      const resolve = this.pending.get(message.id);
      if (!resolve) return;
      this.pending.delete(message.id);
      resolve(message);
    });
  }

  send<T>(method: string, params: Record<string, unknown> = {}) {
    const id = this.id++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise<CdpResult<T>>((resolve, reject) => {
      this.pending.set(id, (message) => resolve(message as CdpResult<T>));
      this.socket.send(payload, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  close() {
    this.socket.close();
  }
}

function openSocket(url: string) {
  const socket = new WebSocket(url);
  return new Promise<WebSocket>((resolve, reject) => {
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

const captureExpression = String.raw`
(() => {
  const selectors = [
    "#vidiq-extension-root",
    '[id*="vidiq" i]',
    '[class*="vidiq" i]',
    '[class*="vidIQ"]',
    '[class*="Vidiq"]',
    '[data-testid*="vidiq" i]',
    ".react-popover",
    ".popover-for-VphPopover",
    ".popover-for-OutlierPopover",
    '[class*="OutlierPopover"]',
    '[class*="VphPopover"]'
  ];

  const truncate = (value, max = 100000) => {
    if (!value || value.length <= max) return value || "";
    return value.slice(0, max) + "\n<!-- truncated -->";
  };

  const keyStyles = (element) => {
    const style = getComputedStyle(element);
    return {
      display: style.display,
      position: style.position,
      zIndex: style.zIndex,
      width: style.width,
      height: style.height,
      color: style.color,
      backgroundColor: style.backgroundColor,
      border: style.border,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight
    };
  };

  const cssPath = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      const tag = current.localName;
      if (current.id) {
        parts.unshift(tag + "#" + CSS.escape(current.id));
        break;
      }
      const classNames = Array.from(current.classList).slice(0, 3).map((name) => "." + CSS.escape(name)).join("");
      const parent = current.parentElement;
      let nth = "";
      if (parent) {
        const sameTag = Array.from(parent.children).filter((child) => child.localName === tag);
        if (sameTag.length > 1) nth = ":nth-of-type(" + (sameTag.indexOf(current) + 1) + ")";
      }
      parts.unshift(tag + classNames + nth);
      current = parent;
    }
    return parts.join(" > ");
  };

  const seen = new Set();
  const elements = [];
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (seen.has(element)) continue;
      seen.add(element);
      const rect = element.getBoundingClientRect();
      elements.push({
        selector,
        path: cssPath(element),
        tagName: element.tagName.toLowerCase(),
        id: element.id || null,
        className: typeof element.className === "string" ? element.className : "",
        text: truncate((element.textContent || "").trim().replace(/\s+/g, " "), 5000),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        styles: keyStyles(element),
        outerHTML: truncate(element.outerHTML),
        shadowHTML: element.shadowRoot ? truncate(element.shadowRoot.innerHTML) : null
      });
    }
  }

  return {
    capturedAt: new Date().toISOString(),
    href: location.href,
    title: document.title,
    selectorCount: selectors.length,
    elementCount: elements.length,
    limit: __VIDIQ_CAPTURE_LIMIT__,
    elements: elements.slice(0, __VIDIQ_CAPTURE_LIMIT__)
  };
})()
`;

function renderHtml(snapshot: { href?: string; title?: string; elements?: Array<Record<string, unknown>> }) {
  const elements = snapshot.elements ?? [];
  const blocks = elements
    .map((element, index) => {
      const pathValue = typeof element.path === "string" ? element.path : "";
      const selector = typeof element.selector === "string" ? element.selector : "";
      const outerHTML = typeof element.outerHTML === "string" ? element.outerHTML : "";
      const shadowHTML = typeof element.shadowHTML === "string" ? element.shadowHTML : "";
      return `<section>
  <h2>${index + 1}. ${escapeHtml(selector)}</h2>
  <p>${escapeHtml(pathValue)}</p>
  <h3>outerHTML</h3>
  <pre><code>${escapeHtml(outerHTML)}</code></pre>
  ${
    shadowHTML
      ? `<h3>shadowHTML</h3>
  <pre><code>${escapeHtml(shadowHTML)}</code></pre>`
      : ""
  }
</section>`;
    })
    .join("\n");

  return `<!doctype html>
<meta charset="utf-8">
<title>${escapeHtml(snapshot.title ?? "vidIQ DOM capture")}</title>
<style>
body { font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; color: #111827; }
section { border-top: 1px solid #d1d5db; padding: 18px 0; }
h1, h2, h3 { line-height: 1.2; }
pre { max-height: 520px; overflow: auto; padding: 12px; background: #f3f4f6; border-radius: 8px; }
code { white-space: pre-wrap; word-break: break-word; }
</style>
<h1>vidIQ DOM capture</h1>
<p>${escapeHtml(snapshot.href ?? "")}</p>
${blocks}
`;
}

const targets = await fetchTargets();
const target = pickTarget(targets);

if (!target?.webSocketDebuggerUrl) {
  throw new Error(
    `No inspectable Chrome page target found at ${cdpUrl}. Open YouTube in Chrome launched with --remote-debugging-port=9222.`,
  );
}

const socket = await openSocket(target.webSocketDebuggerUrl);
const client = new CdpClient(socket);

try {
  await client.send("Runtime.enable");
  const expression = captureExpression.replaceAll("__VIDIQ_CAPTURE_LIMIT__", String(limit));
  const response = await client.send<RuntimeEvaluateResult>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  const exceptionDetails = response.exceptionDetails ?? response.result?.exceptionDetails;
  if (exceptionDetails) {
    throw new Error(`DOM capture evaluation failed: ${JSON.stringify(exceptionDetails)}`);
  }

  const snapshot = response.result?.result.value as CaptureSnapshot | undefined;
  if (!snapshot) {
    throw new Error(`DOM capture returned no value: ${response.result?.result.description ?? "unknown failure"}`);
  }

  await mkdir(outputDir, { recursive: true });
  const slug = timestampSlug();
  const jsonPath = path.join(outputDir, `${slug}.json`);
  const htmlPath = path.join(outputDir, `${slug}.html`);
  await Promise.all([
    writeFile(jsonPath, JSON.stringify(snapshot, null, 2) + "\n"),
    writeFile(htmlPath, renderHtml(snapshot), "utf8"),
  ]);

  console.log(JSON.stringify({ target: target.url, jsonPath, htmlPath }, null, 2));
} finally {
  client.close();
}

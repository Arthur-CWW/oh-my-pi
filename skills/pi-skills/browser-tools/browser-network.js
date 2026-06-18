#!/usr/bin/env node

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const options = parseArgs(args);

if (options.help) {
  printHelp();
  process.exit(0);
}

const browser = await Promise.race([
  puppeteer.connect({
    browserURL: "http://localhost:9222",
    defaultViewport: null,
  }),
  new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
]).catch((error) => {
  console.error("✗ Could not connect to browser:", error.message);
  console.error("  Run: browser-start.js [--profile]");
  process.exit(1);
});

const page = (await browser.pages()).at(-1);
if (!page) {
  console.error("✗ No active tab found");
  process.exit(1);
}

const startedAt = new Date().toISOString();
const runId = `network-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const outPath = path.resolve(options.out ?? `output/jimeng-lab/raw/${runId}.network.json`);
mkdirSync(path.dirname(outPath), { recursive: true });

const entries = [];
const requestMap = new Map();
let actionResult = null;

page.on("request", (request) => {
  const url = request.url();
  if (!matchesFilter(url, options.contains)) {
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestData = {
    id,
    at: new Date().toISOString(),
    type: request.resourceType(),
    method: request.method(),
    url,
    headers: request.headers(),
    postData: request.postData() ?? null,
  };

  requestMap.set(request, id);
  entries.push({ kind: "request", ...requestData });
});

page.on("response", async (response) => {
  const url = response.url();
  if (!matchesFilter(url, options.contains)) {
    return;
  }

  const request = response.request();
  const linked = requestMap.get(request);

  let body = null;
  if (options.includeBody) {
    try {
      body = await response.text();
      if (body.length > options.maxBody) {
        body = `${body.slice(0, options.maxBody)}\n...[truncated]`;
      }
    } catch {
      body = "[unavailable]";
    }
  }

  entries.push({
    kind: "response",
    at: new Date().toISOString(),
    id: linked ?? null,
    url,
    status: response.status(),
    statusText: response.statusText(),
    headers: response.headers(),
    body,
  });
});

if (options.jimengImagePrompt || options.jimengVideoPrompt) {
  const isVideo = typeof options.jimengVideoPrompt === "string";
  const promptText = options.jimengVideoPrompt ?? options.jimengImagePrompt;

  actionResult = await triggerJimengPrompt(page, promptText, {
    humanType: options.humanType,
    mode: isVideo ? "video" : "image",
  });

  entries.push({
    kind: "action",
    at: new Date().toISOString(),
    action: isVideo ? "jimeng-video-generate" : "jimeng-image-generate",
    result: actionResult,
  });

  savePromptRecord(options.promptOut, {
    runId,
    at: new Date().toISOString(),
    url: page.url(),
    mode: options.humanType ? "human-type" : "controlled-input",
    op: isVideo ? "video" : "image",
    prompt: promptText,
  });

  console.log(`Action: ${actionResult.ok ? "ok" : "failed"} (${actionResult.reason})`);
}

const waitMs = options.duration;
console.log(`Capturing network for ${waitMs}ms on ${await page.title()}`);
await sleep(waitMs);

const endedAt = new Date().toISOString();
const output = {
  runId,
  startedAt,
  endedAt,
  page: {
    url: page.url(),
    title: await page.title(),
  },
  filter: {
    contains: options.contains ?? null,
    includeBody: options.includeBody,
    maxBody: options.maxBody,
  },
  action: actionResult,
  entries,
};

writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

if (options.workflowOut) {
  const workflowPath = path.resolve(options.workflowOut);
  mkdirSync(path.dirname(workflowPath), { recursive: true });
  const isVideo = typeof options.jimengVideoPrompt === "string";
  const promptFlag = isVideo ? "--jimeng-video" : "--jimeng-image";
  const promptValue = options.jimengVideoPrompt ?? options.jimengImagePrompt ?? "<prompt>";
  const navigateUrl = isVideo
    ? "https://jimeng.jianying.com/ai-tool/generate?type=video"
    : "https://jimeng.jianying.com/ai-tool/generate?ai_feature_name=image";

  const workflow = {
    name: isVideo ? "jimeng-video-capture" : "jimeng-image-capture",
    runId,
    createdAt: endedAt,
    steps: [
      {
        name: "navigate",
        command: `.pi/skills/pi-skills/browser-tools/browser-nav.js ${navigateUrl} --new`,
      },
      {
        name: "capture-and-generate",
        command: `.pi/skills/pi-skills/browser-tools/browser-network.js ${promptFlag} ${JSON.stringify(promptValue)} --human-type --duration ${options.duration} --contains ${JSON.stringify(options.contains ?? "jianying.com")} --include-body --out ${JSON.stringify(outPath)}`,
      },
    ],
    output: {
      capture: outPath,
      promptLog: path.resolve(options.promptOut),
    },
  };
  writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, "utf8");
  console.log(`✓ Workflow saved to ${workflowPath}`);
}

console.log(`✓ Saved ${entries.length} events to ${outPath}`);

await browser.disconnect();

function parseArgs(argv) {
  const parsed = {
    duration: 30_000,
    contains: null,
    out: null,
    includeBody: false,
    maxBody: 10_000,
    jimengImagePrompt: null,
    jimengVideoPrompt: null,
    humanType: true,
    promptOut: "output/jimeng-lab/logs/prompts.jsonl",
    workflowOut: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];

    if (current === "--help" || current === "-h") {
      parsed.help = true;
      continue;
    }
    if (current === "--duration" && next) {
      parsed.duration = Number(next);
      i += 1;
      continue;
    }
    if (current === "--contains" && next) {
      parsed.contains = next;
      i += 1;
      continue;
    }
    if (current === "--out" && next) {
      parsed.out = next;
      i += 1;
      continue;
    }
    if (current === "--include-body") {
      parsed.includeBody = true;
      continue;
    }
    if (current === "--max-body" && next) {
      parsed.maxBody = Number(next);
      i += 1;
      continue;
    }
    if (current === "--jimeng-image" && next) {
      parsed.jimengImagePrompt = next;
      i += 1;
      continue;
    }
    if (current === "--jimeng-video" && next) {
      parsed.jimengVideoPrompt = next;
      i += 1;
      continue;
    }
    if (current === "--human-type") {
      parsed.humanType = true;
      continue;
    }
    if (current === "--no-human-type") {
      parsed.humanType = false;
      continue;
    }
    if (current === "--prompt-out" && next) {
      parsed.promptOut = next;
      i += 1;
      continue;
    }
    if (current === "--workflow-out" && next) {
      parsed.workflowOut = next;
      i += 1;
      continue;
    }
  }

  return parsed;
}

function printHelp() {
  console.log("Usage: browser-network.js [--duration <ms>] [--contains <substring>] [--out <file>] [--include-body] [--max-body <chars>] [--jimeng-image <prompt> | --jimeng-video <prompt>] [--human-type|--no-human-type] [--prompt-out <jsonl>] [--workflow-out <json>]");
  console.log("");
  console.log("Examples:");
  console.log("  browser-network.js --duration 45000 --contains jianying.com");
  console.log("  browser-network.js --duration 90000 --include-body --contains /api/");
  console.log("  browser-network.js --jimeng-image \"搞笑梗图...\" --human-type --duration 120000 --contains jianying.com");
  console.log("  browser-network.js --jimeng-video \"一只柴犬冲浪，电影感\" --human-type --duration 180000 --contains jianying.com");
}

function matchesFilter(url, needle) {
  if (!needle) {
    return true;
  }
  return url.includes(needle);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function savePromptRecord(filePath, record) {
  const absolute = path.resolve(filePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  appendFileSync(absolute, `${JSON.stringify(record)}\n`, "utf8");
}

async function triggerJimengPrompt(page, prompt, { humanType, mode }) {
  const target = await page.evaluate((modeValue) => {
    const isVisible = (node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const textMatch = modeValue === "video"
      ? ["画面", "视频", "创作", "运动"]
      : ["图片", "生成", "描述"];

    const textarea = Array.from(document.querySelectorAll("textarea")).find((el) => {
      if (!isVisible(el)) return false;
      const ph = el.getAttribute("placeholder") || "";
      return textMatch.some((token) => ph.includes(token));
    }) ?? Array.from(document.querySelectorAll("textarea")).find((el) => isVisible(el));

    if (!textarea) {
      return { ok: false, reason: "no_visible_textarea", title: document.title, url: location.href };
    }

    const layout = textarea.closest(".layout-KSckhZ") || textarea.closest("div");
    const submitButton = layout?.querySelector("button[class*='submit-button']") || null;
    if (!(submitButton instanceof HTMLButtonElement)) {
      return {
        ok: false,
        reason: "submit_button_not_found",
        title: document.title,
        url: location.href,
      };
    }

    textarea.setAttribute("data-pi-jimeng-prompt", "1");
    submitButton.setAttribute("data-pi-jimeng-submit", "1");

    return {
      ok: true,
      reason: "target_ready",
      title: document.title,
      url: location.href,
      promptSelector: "textarea[data-pi-jimeng-prompt='1']",
      submitSelector: "button[data-pi-jimeng-submit='1']",
    };
  }, mode);

  if (!target.ok) {
    return target;
  }

  if (humanType) {
    const promptHandle = await page.$(target.promptSelector);
    if (!promptHandle) {
      return { ok: false, reason: "prompt_handle_not_found", url: page.url() };
    }

    await promptHandle.click({ clickCount: 3, delay: randomBetween(45, 95) });
    await page.keyboard.press("Backspace", { delay: randomBetween(35, 80) });
    await sleep(randomBetween(120, 260));

    for (const char of prompt) {
      await page.keyboard.type(char, { delay: randomBetween(35, 120) });
      if (Math.random() < 0.08) {
        await sleep(randomBetween(60, 180));
      }
    }
  } else {
    await page.evaluate((text, selector) => {
      const textarea = document.querySelector(selector);
      if (!(textarea instanceof HTMLTextAreaElement)) {
        return;
      }
      const proto = Object.getPrototypeOf(textarea);
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor?.set) {
        descriptor.set.call(textarea, text);
      } else {
        textarea.value = text;
      }
      textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }, prompt, target.promptSelector);
  }

  await sleep(randomBetween(260, 700));

  const disabled = await page.$eval(target.submitSelector, (button) =>
    button instanceof HTMLButtonElement ? button.disabled : true,
  );

  if (disabled) {
    return {
      ok: false,
      reason: "submit_disabled",
      mode: humanType ? "human-type" : "controlled-input",
      title: await page.title(),
      url: page.url(),
    };
  }

  const submitHandle = await page.$(target.submitSelector);
  if (!submitHandle) {
    return { ok: false, reason: "submit_handle_not_found", url: page.url() };
  }

  const box = await submitHandle.boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x + randomBetween(-4, 4), y + randomBetween(-3, 3), {
      steps: randomBetween(8, 18),
    });
    await sleep(randomBetween(80, 220));
    await page.mouse.click(x, y, { delay: randomBetween(25, 80) });
  } else {
    await submitHandle.click({ delay: randomBetween(30, 80) });
  }

  return {
    ok: true,
    reason: "clicked_submit",
    mode: humanType ? "human-type" : "controlled-input",
    title: await page.title(),
    url: page.url(),
  };
}

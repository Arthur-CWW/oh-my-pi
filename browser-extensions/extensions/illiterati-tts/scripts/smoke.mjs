import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const extensionPath = path.resolve(process.cwd(), 'dist');
const userDataDir = path.resolve(process.cwd(), '.tmp-playwright-profile');
const logsDir = path.resolve(process.cwd(), '.logs');
const logPath = path.resolve(logsDir, `smoke-${Date.now()}.log`);
let server;
let serverUrl = '';
const chapterPath = path.resolve(process.cwd(), '..', 'input_data', 'chapter_001.txt');
let sampleChineseText = '这是一个用于浏览器扩展烟雾测试的中文段落。';

const lines = [];
const stamp = () => new Date().toISOString();
const push = (line) => {
  const out = `[${stamp()}] ${line}`;
  lines.push(out);
  console.log(out);
};

await mkdir(logsDir, { recursive: true });
await rm(userDataDir, { recursive: true, force: true });

try {
  const raw = await readFile(chapterPath, 'utf8');
  const line = raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.length > 20);
  if (line) {
    sampleChineseText = line.slice(0, 120);
  }
  push(`sample-text length=${sampleChineseText.length}`);
} catch (error) {
  push(`sample-text warning failed to read chapter input: ${error instanceof Error ? error.message : String(error)}`);
}

server = http.createServer((_, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><body><p>${sampleChineseText}</p></body></html>`);
});

await new Promise((resolve, reject) => {
  server.listen(0, '127.0.0.1', (error) => {
    if (error) {
      reject(error);
      return;
    }
    const address = server.address();
    if (!address || typeof address === 'string') {
      reject(new Error('Failed to resolve local server address'));
      return;
    }
    serverUrl = `http://127.0.0.1:${address.port}/`;
    push(`local-server ${serverUrl}`);
    resolve();
  });
});

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ]
});

context.on('page', (page) => {
  page.on('console', (msg) => {
    push(`page:${page.url()} ${msg.type()} ${msg.text()}`);
  });
});

try {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  }
  serviceWorker.on('console', (msg) => {
    push(`service-worker ${msg.type()} ${msg.text()}`);
  });

  const extensionId = serviceWorker.url().split('/')[2];
  push(`extension-id ${extensionId}`);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole('button', { name: 'Warmup Runtime' }).click();
  await popup.getByText('Warmup request sent. Select text on page to test.').waitFor({ timeout: 5000 });
  let foundSavedClip = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await popup.getByRole('button', { name: 'Refresh Clips' }).click();
    const statusText = await popup.locator('#status').innerText().catch(() => '');
    push(`popup-status attempt=${attempt + 1} ${statusText}`);
    const modelCell = popup.getByRole('cell', { name: 'Qwen3-TTS-0.6B' }).first();
    const visible = await modelCell.isVisible().catch(() => false);
    if (visible) {
      foundSavedClip = true;
      break;
    }
    await popup.waitForTimeout(500);
  }
  if (!foundSavedClip) {
    throw new Error('Saved clip row not visible in popup clip table');
  }
  push('popup-success warmup status observed');

  const page = await context.newPage();
  await page.goto(serverUrl, { waitUntil: 'domcontentloaded' });
  const overlay = page.locator('#illiterati-play');
  const overlayVisible = await overlay.isVisible({ timeout: 6000 }).catch(() => false);
  if (overlayVisible) {
    await page.evaluate(() => {
      const target = document.querySelector('p');
      if (!target) {
        throw new Error('No paragraph found on page');
      }
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await overlay.click();
    await page.waitForTimeout(1200);
    push('overlay-success click path executed');
  } else {
    push('overlay-warning content overlay not detected in automated run');
  }

  push('smoke-success extension bootstrap + warmup completed');
} catch (error) {
  push(`smoke-failed ${error instanceof Error ? error.message : String(error)}`);
  throw error;
} finally {
  await writeFile(logPath, `${lines.join('\n')}\n`, 'utf8');
  push(`wrote-log ${logPath}`);
  await context.close();
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

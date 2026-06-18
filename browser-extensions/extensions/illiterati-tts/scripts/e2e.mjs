import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const extensionPath = path.resolve(process.cwd(), 'dist');
const userDataDir = path.resolve(process.cwd(), '.tmp-playwright-profile-e2e');
const logsDir = path.resolve(process.cwd(), '.logs');
const logPath = path.resolve(logsDir, `e2e-${Date.now()}.log`);
const artifactsDir = path.resolve(process.cwd(), 'output', 'playwright');
const chapterPath = path.resolve(process.cwd(), '..', 'input_data', 'chapter_001.txt');

let server;
let serverUrl = '';
let sampleChineseText = '这是一个用于浏览器扩展端到端测试的中文段落。';

const lines = [];
const swLogs = [];
const stamp = () => new Date().toISOString();
const push = (line) => {
  const out = `[${stamp()}] ${line}`;
  lines.push(out);
  console.log(out);
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

await mkdir(logsDir, { recursive: true });
await mkdir(artifactsDir, { recursive: true });
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
  res.end(`<!doctype html><html><body><p id="sample">${sampleChineseText}</p></body></html>`);
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
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
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
    const line = `service-worker ${msg.type()} ${msg.text()}`;
    swLogs.push(line);
    push(line);
  });

  const extensionId = serviceWorker.url().split('/')[2];
  push(`extension-id ${extensionId}`);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole('button', { name: 'Reset Local DB' }).click();
  await popup.getByText('Local SQLite clip DB cleared.').waitFor({ timeout: 5000 });
  push('popup-reset-db completed');
  await popup.getByRole('button', { name: 'Warmup Runtime' }).click();
  await popup.getByText('Warmup request sent. Select text on page to test.').waitFor({ timeout: 5000 });
  push('popup-warmup triggered');

  await popup.waitForTimeout(2500);

  const streamLogs = swLogs.filter((line) => line.includes('Relaying tts.stream'));
  assert(streamLogs.length >= 3, `Expected >=3 streamed chunks, got ${streamLogs.length}`);

  const pcmLengths = streamLogs
    .map((line) => {
      const match = line.match(/pcmLength:\s*(\d+)/);
      return match ? Number(match[1]) : 0;
    })
    .filter((value) => Number.isFinite(value));
  assert(pcmLengths.length > 0, 'Expected streamed chunk logs to include pcmLength');
  assert(pcmLengths.every((value) => value > 0), `Found zero-length PCM chunks: ${pcmLengths.join(',')}`);

  const doneLogs = swLogs.filter((line) => line.includes('Relaying tts.done'));
  assert(doneLogs.length >= 1, 'Expected at least one tts.done relay log');
  push(`stream-assertions chunks=${streamLogs.length} done=${doneLogs.length}`);

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
  assert(foundSavedClip, 'Saved clip row not visible in popup clip table');

  const settings = await context.newPage();
  await settings.goto(`chrome-extension://${extensionId}/settings.html`);
  await settings.getByRole('button', { name: 'Reset Local DB' }).click();
  await settings.getByText('Local SQLite clip DB cleared.').waitFor({ timeout: 5000 });
  await settings.getByRole('button', { name: 'Generate Test Audio' }).click();
  await settings.waitForFunction(() => {
    const node = document.querySelector('#status');
    return !!node && /Done settings-/.test(node.textContent ?? '');
  }, { timeout: 20000 });
  const settingsStatus = await settings.locator('#status').innerText().catch(() => '');
  push(`settings-status ${settingsStatus}`);
  const settingsClipCell = settings.locator('.clip-table tbody tr').first();
  const settingsHasClip = await settingsClipCell.isVisible().catch(() => false);
  assert(settingsHasClip, 'Settings page did not show saved clip after Generate Test Audio');

  const page = await context.newPage();
  await page.goto(serverUrl, { waitUntil: 'domcontentloaded' });
  const overlay = page.locator('#illiterati-play');
  const overlayVisible = await overlay.isVisible({ timeout: 8000 }).catch(() => false);
  if (overlayVisible) {
    await page.evaluate(() => {
      const target = document.querySelector('#sample');
      if (!target) {
        throw new Error('No sample paragraph found');
      }
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await overlay.click();
    push('overlay-check pass');
  } else {
    push('overlay-check warning overlay not detected in this automated run');
  }

  const suffix = Date.now();
  const popupShot = path.resolve(artifactsDir, `e2e-popup-${suffix}.png`);
  const pageShot = path.resolve(artifactsDir, `e2e-page-${suffix}.png`);
  const settingsShot = path.resolve(artifactsDir, `e2e-settings-${suffix}.png`);
  await popup.screenshot({ path: popupShot, fullPage: true });
  await page.screenshot({ path: pageShot, fullPage: true });
  await settings.screenshot({ path: settingsShot, fullPage: true });
  push(`saved-artifacts ${popupShot}`);
  push(`saved-artifacts ${pageShot}`);
  push(`saved-artifacts ${settingsShot}`);

  push('e2e-success audio pipeline and persistence checks completed');
} catch (error) {
  push(`e2e-failed ${error instanceof Error ? error.message : String(error)}`);
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

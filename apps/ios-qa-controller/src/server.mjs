import http from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const stateDir = process.env.IOS_QA_STATE_DIR || path.join(appRoot, 'state');
const auditPath = process.env.IOS_QA_AUDIT_LOG || path.join(stateDir, 'audit.jsonl');
const port = Number(process.env.PORT || process.env.IOS_QA_PORT || 4777);
const host = process.env.IOS_QA_HOST || '127.0.0.1';
const wdaBaseByUdid = parseWdaMap(process.env.IOS_QA_WDA_MAP || '');
const dryRunActions = process.env.IOS_QA_DRY_RUN !== '0';

let previousAuditHash = 'GENESIS';
await mkdir(stateDir, { recursive: true });
if (existsSync(auditPath)) {
  try {
    const lines = (await readFile(auditPath, 'utf8')).trim().split('\n').filter(Boolean);
    if (lines.length) previousAuditHash = JSON.parse(lines.at(-1)).hash_this || previousAuditHash;
  } catch {}
}

function parseWdaMap(raw) {
  const map = new Map();
  for (const part of raw.split(',')) {
    const [udid, base] = part.split('=');
    if (udid && base) map.set(udid.trim(), base.trim().replace(/\/$/, ''));
  }
  return map;
}

function run(command, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ ok: false, code: 124, stdout, stderr: stderr + `\nTimed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: String(err.message || err) });
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function discoverDevices() {
  const [xctrace, cfgutil] = await Promise.all([
    run('xcrun', ['xctrace', 'list', 'devices'], 10000),
    run('cfgutil', ['list'], 5000),
  ]);
  const devices = [];
  const seen = new Set();
  if (xctrace.stdout) {
    let section = '';
    for (const raw of xctrace.stdout.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('== ')) { section = line; continue; }
      const match = line.match(/^(.*?) \(([^()]+)\)(?: \(([^()]+)\))?$/);
      if (!match) continue;
      const [, name, maybeOsOrId, maybeId] = match;
      const isSimulator = section.includes('Simulators') || name.includes('Simulator');
      const id = maybeId || maybeOsOrId;
      const os = maybeId ? maybeOsOrId : undefined;
      const key = `${isSimulator ? 'sim' : 'device'}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      devices.push({
        id,
        udid: id,
        name,
        os,
        kind: isSimulator ? 'simulator' : 'physical-or-host',
        source: 'xcrun xctrace',
        online: true,
        automation: {
          wdaBaseUrl: wdaBaseByUdid.get(id) || null,
          dryRunActions,
        },
      });
    }
  }
  if (cfgutil.ok && cfgutil.stdout) {
    for (const raw of cfgutil.stdout.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('Type')) continue;
      // cfgutil output varies; preserve a raw row if we cannot parse it confidently.
      devices.push({ id: `cfgutil:${createHash('sha1').update(line).digest('hex').slice(0, 12)}`, udid: null, name: line, kind: 'physical', source: 'cfgutil', online: true, automation: { wdaBaseUrl: null, dryRunActions } });
    }
  }
  return { devices, probes: { xctrace: summarizeProbe(xctrace), cfgutil: summarizeProbe(cfgutil) } };
}

function summarizeProbe(result) {
  return { ok: result.ok, code: result.code, stderr: result.stderr.trim().slice(0, 1000) || null };
}

async function appendAudit(event) {
  const canonical = JSON.stringify({ ...event, hash_prev: previousAuditHash });
  const hash = createHash('sha256').update(canonical).digest('hex');
  const row = { ...event, hash_prev: previousAuditHash, hash_this: hash };
  previousAuditHash = hash;
  await appendFile(auditPath, JSON.stringify(row) + '\n');
  return row;
}

async function readAudit(limit = 100) {
  if (!existsSync(auditPath)) return [];
  const lines = (await readFile(auditPath, 'utf8')).trim().split('\n').filter(Boolean);
  return lines.slice(-limit).map(line => JSON.parse(line));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
  res.end(data);
}

function notFound(res) { send(res, 404, { error: 'not_found' }); }

async function proxyWda(udid, method, endpoint, body) {
  const base = wdaBaseByUdid.get(udid);
  if (!base) return { proxied: false, dryRun: dryRunActions, reason: 'No WDA base URL configured for this UDID. Set IOS_QA_WDA_MAP="<udid>=http://127.0.0.1:<port>".' };
  const url = `${base}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { proxied: true, status: response.status, response: parsed };
}

async function handleAction(req, res, udid, actionType) {
  const body = await readJson(req);
  const event = {
    event_id: randomUUID(),
    timestamp: new Date().toISOString(),
    actor: req.headers['x-operator-id'] || 'local-operator',
    udid,
    action: { type: actionType, ...body },
    source: 'human_console_or_api',
    user_agent: req.headers['user-agent'] || null,
  };
  let backend;
  if (actionType === 'tap') {
    const x = Number(body.x ?? body.x_norm);
    const y = Number(body.y ?? body.y_norm);
    backend = await proxyWda(udid, 'POST', '/wda/tap/0', { x, y });
  } else if (actionType === 'type') {
    backend = await proxyWda(udid, 'POST', '/wda/keys', { value: String(body.text || '') });
  } else if (actionType === 'swipe') {
    backend = await proxyWda(udid, 'POST', '/wda/dragfromtoforduration', body);
  } else {
    backend = { proxied: false, dryRun: true, reason: 'Unknown action type' };
  }
  const audited = await appendAudit({ ...event, backend });
  send(res, backend.proxied || dryRunActions ? 200 : 501, { ok: true, audit: audited, backend });
}

async function snapshot(udid) {
  const safe = udid.replace(/[^A-Za-z0-9_.-]/g, '_');
  const out = path.join(stateDir, `snapshot-${safe}-${Date.now()}.png`);
  // Works for simulators. Physical devices should use WDA screenshot, go-ios, idb, or QuickTime capture.
  const sim = await run('xcrun', ['simctl', 'io', udid, 'screenshot', out], 15000);
  if (sim.ok) return { ok: true, path: out, method: 'xcrun simctl io screenshot' };
  const wda = await proxyWda(udid, 'GET', '/screenshot', null);
  return { ok: Boolean(wda.proxied), method: 'wda /screenshot', result: wda, simctlError: sim.stderr.trim().slice(0, 1000) };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/') {
      send(res, 200, await readFile(path.join(appRoot, 'public', 'index.html'), 'utf8'));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      send(res, 200, { ok: true, service: 'ios-qa-controller', stateDir, auditPath, dryRunActions, wdaConfiguredDevices: [...wdaBaseByUdid.keys()] });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/devices') {
      send(res, 200, await discoverDevices());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/audit') {
      send(res, 200, { events: await readAudit(Number(url.searchParams.get('limit') || 100)) });
      return;
    }
    const actionMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/actions\/(tap|type|swipe)$/);
    if (req.method === 'POST' && actionMatch) {
      await handleAction(req, res, decodeURIComponent(actionMatch[1]), actionMatch[2]);
      return;
    }
    const snapMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/snapshot$/);
    if (req.method === 'POST' && snapMatch) {
      const result = await snapshot(decodeURIComponent(snapMatch[1]));
      const audited = await appendAudit({ event_id: randomUUID(), timestamp: new Date().toISOString(), actor: req.headers['x-operator-id'] || 'local-operator', udid: decodeURIComponent(snapMatch[1]), action: { type: 'snapshot' }, backend: result });
      send(res, result.ok ? 200 : 501, { ok: result.ok, result, audit: audited });
      return;
    }
    notFound(res);
  } catch (error) {
    send(res, 500, { error: 'internal_error', message: error?.message || String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`iOS QA controller listening on http://${host}:${port}`);
  console.log(`Audit log: ${auditPath}`);
});

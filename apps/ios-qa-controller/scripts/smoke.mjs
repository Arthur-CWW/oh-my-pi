import { spawn } from 'node:child_process';

const port = Number(process.env.IOS_QA_PORT || 4788);
const child = spawn(process.execPath, ['src/server.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, IOS_QA_PORT: String(port), IOS_QA_DRY_RUN: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', d => output += d.toString());
child.stderr.on('data', d => output += d.toString());
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
try {
  await sleep(700);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then(r => r.json());
  if (!health.ok) throw new Error('health failed');
  const devices = await fetch(`http://127.0.0.1:${port}/api/devices`).then(r => r.json());
  if (!Array.isArray(devices.devices)) throw new Error('devices payload invalid');
  const target = devices.devices[0]?.udid || devices.devices[0]?.id || 'smoke-device';
  const tap = await fetch(`http://127.0.0.1:${port}/api/devices/${encodeURIComponent(target)}/actions/tap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-operator-id': 'smoke-test' },
    body: JSON.stringify({ x_norm: 0.5, y_norm: 0.5 }),
  }).then(r => r.json());
  if (!tap.ok || !tap.audit?.hash_this) throw new Error('tap audit failed');
  console.log(JSON.stringify({ ok: true, health, deviceCount: devices.devices.length, auditHash: tap.audit.hash_this }, null, 2));
} finally {
  child.kill('SIGTERM');
  await sleep(100);
}

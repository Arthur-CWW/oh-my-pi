const reportClientError = (payload) => fetch('/api/client-errors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), keepalive: true }).catch(() => {});
window.addEventListener('error', (event) => reportClientError({ kind: 'error', message: event.message, source: event.filename, line: event.lineno, column: event.colno, stack: event.error?.stack }));
window.addEventListener('unhandledrejection', (event) => reportClientError({ kind: 'unhandledrejection', message: event.reason instanceof Error ? event.reason.message : String(event.reason), stack: event.reason?.stack }));

const state = { snapshot: null, architecture: 'current', schedulerPaused: false, schedulerStep: 0, samples: [], unloading: false };
const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

function renderSnapshot(data) {
  state.snapshot = data;
  const summary = byId('summary-grid');
  summary.innerHTML = data.summary.map((metric) => `<article class="summary-card ${escapeHtml(metric.tone)}"><div class="metric-kicker"><span>${escapeHtml(metric.label)}</span><span class="metric-level">[${escapeHtml(metric.level)}]</span></div><div class="metric-value">${escapeHtml(metric.value)}</div><div class="metric-detail">${escapeHtml(metric.detail)}</div></article>`).join('');
  const bottlenecks = byId('bottleneck-list');
  bottlenecks.innerHTML = data.bottlenecks.map((item) => `<article class="bottleneck"><div class="rank">0${item.rank}</div><div><h3>${escapeHtml(item.title)}</h3><span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></div><div><dl><dt>EVIDENCE</dt><dd>${escapeHtml(item.evidence)}</dd></dl></div><div><dl><dt>MISSING PROOF</dt><dd>${escapeHtml(item.gap)}</dd></dl></div><div><dl><dt>PROPOSED FIX</dt><dd>${escapeHtml(item.fix)}</dd></dl></div><div><dl><dt>ACCEPTANCE · TARGET</dt><dd>${escapeHtml(item.acceptance)}</dd></dl></div></article>`).join('');
  const roadmap = byId('roadmap');
  roadmap.innerHTML = data.roadmap.map((item) => `<article class="roadmap-item ${escapeHtml(item.status)}"><strong>${escapeHtml(item.id)}</strong><p>${escapeHtml(item.title)}</p><span class="status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span><small>${item.dependsOn.length ? `DEPENDS ON ${escapeHtml(item.dependsOn.join(', '))}` : 'SUBSTRATE'}</small></article>`).join('');
  byId('build-id').textContent = data.build;
  byId('proof-events').textContent = data.proof.events.toLocaleString();
}

const architectureCopy = {
  current: { label: 'CURRENT TOPOLOGY', headline: 'One process owns authority, projection, and display.', description: 'Hidden tabs remain computationally alive. Each top-level Bun process carries the Runner, TUI View, projections, journal caches, and MCP clients.', title: 'Current OMP topology', desc: 'Runner and View are coupled in each Bun process, with retained child projections and browser helpers.' },
  proposed: { label: 'PROPOSED TOPOLOGY', headline: 'Durable authority; disposable pixels.', description: 'Runner keeps the journal, provider queue, children, and control. View hydrates only a selected viewport and can disappear completely when detached.', title: 'Proposed OMP topology', desc: 'Runner and View are separate processes, with compact child state and journal-backed cold transcript pages.' }
};
function setArchitecture(mode) {
  state.architecture = mode;
  document.querySelectorAll('[data-architecture]').forEach((button) => { const active = button.dataset.architecture === mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  byId('current-topology').classList.toggle('hidden', mode !== 'current');
  byId('proposed-topology').classList.toggle('hidden', mode !== 'proposed');
  const copy = architectureCopy[mode];
  byId('topology-mode').textContent = copy.label; byId('topology-headline').textContent = copy.headline; byId('topology-description').textContent = copy.description;
  byId('topology-svg-title').textContent = copy.title; byId('topology-svg-desc').textContent = copy.desc;
}
document.querySelectorAll('[data-architecture]').forEach((button) => button.addEventListener('click', () => setArchitecture(button.dataset.architecture)));

const controls = { detach: byId('detach-views'), paging: byId('page-transcripts'), recycle: byId('recycle-runners'), browsers: byId('browser-cap') };
function updateImpact() {
  let lowSaving = 0; let highSaving = 0;
  if (controls.detach.checked) { lowSaving += .8; highSaving += 1.6; }
  if (controls.paging.checked) { lowSaving += 1.2; highSaving += 2.5; }
  if (controls.recycle.checked) { lowSaving += 1; highSaving += 2.2; }
  const cap = Number(controls.browsers.value); const browserSaving = (69 - cap) * (13.4 / 69);
  lowSaving += browserSaving; highSaving += browserSaving;
  const baseline = 22.09; const low = Math.max(0, baseline - highSaving); const high = Math.max(low, baseline - lowSaving);
  const interventions = Number(controls.detach.checked) + Number(controls.paging.checked) + Number(controls.recycle.checked) + Number(cap < 69);
  byId('browser-cap-output').textContent = String(cap);
  byId('estimate-value').textContent = interventions ? `${low.toFixed(2)}–${high.toFixed(2)} GiB` : '22.09 GiB';
  byId('estimate-delta').textContent = interventions ? `[INFERENCE] modeled reduction ${lowSaving.toFixed(2)}–${highSaving.toFixed(2)} GiB` : 'Measured baseline · no modeled interventions';
  byId('memory-range').style.left = `${(low / baseline) * 100}%`; byId('memory-range').style.right = `${100 - (high / baseline) * 100}%`; byId('memory-marker').style.left = `${(high / baseline) * 100}%`;
  byId('cold-pages-node').classList.toggle('inactive', !controls.paging.checked);
  if (interventions && state.architecture === 'current') setArchitecture('proposed');
}
Object.values(controls).forEach((control) => control.addEventListener('input', updateImpact));
byId('reset-model').addEventListener('click', () => { controls.detach.checked = false; controls.paging.checked = false; controls.recycle.checked = false; controls.browsers.value = '69'; updateImpact(); });

const schedulerStates = [
  { name: 'Activity resets the idle timer.', className: '', progress: 8 },
  { name: '250 ms idle boundary reached.', className: '', progress: 36 },
  { name: 'Compressing one page in an incremental pass…', className: 'compressing', progress: 68 },
  { name: 'Cold pages serialized; JS objects dropped.', className: 'cold', progress: 100 },
];
function renderScheduler() {
  const current = schedulerStates[state.schedulerStep];
  byId('scheduler-state').textContent = current.name; byId('page-stack').className = `page-stack ${current.className}`; byId('scheduler-progress').style.width = `${current.progress}%`;
  document.querySelectorAll('.activity-rail .tick').forEach((tick, index) => tick.classList.toggle('active', index === state.schedulerStep));
}
const schedulerTimer = setInterval(() => { if (!state.schedulerPaused) { state.schedulerStep = (state.schedulerStep + 1) % schedulerStates.length; renderScheduler(); } }, 1450);
byId('scheduler-toggle').addEventListener('click', (event) => { state.schedulerPaused = !state.schedulerPaused; event.currentTarget.textContent = state.schedulerPaused ? 'Resume' : 'Pause'; event.currentTarget.setAttribute('aria-pressed', String(state.schedulerPaused)); });
byId('hydrate-pages').addEventListener('click', () => { byId('page-stack').className = 'page-stack hydrating'; byId('scheduler-state').textContent = 'Viewport requested: hydrating selected pages…'; setTimeout(() => { state.schedulerStep = 0; renderScheduler(); }, 750); });

function groupClass(command) {
  const value = command.toLowerCase();
  if (value.includes('chrome') || value.includes('chromium') || value.includes('playwright') || value.includes('puppeteer')) return 'Browsers';
  if (value.includes('cmux hooks') || value.includes('session-start')) return 'cmux hooks';
  if (value.includes('mcp') || value.includes('modelcontextprotocol')) return 'MCP helpers';
  if (value.includes('omp') || value.includes('oh-my-pi')) return 'OMP runner/view';
  if (value.includes('vite') || value.includes('next dev') || value.includes('bun run dev')) return 'Dev servers';
  return 'Other';
}
function renderSparkline(samples) {
  const svg = byId('machine-sparkline');
  if (!samples.length) return;
  const width = 520, height = 76, max = Math.max(...samples.map((item) => item.memoryUsedGiB), 1);
  const points = samples.map((item, index) => `${samples.length === 1 ? width : index * width / (samples.length - 1)},${height - item.memoryUsedGiB / max * (height - 8)}`).join(' ');
  svg.innerHTML = `<polyline points="${points}" vector-effect="non-scaling-stroke"></polyline>`;
}
function renderMachine(machine) {
  state.samples.push({ memoryUsedGiB: machine.memory.usedGiB, at: machine.capturedAt }); if (state.samples.length > 24) state.samples.shift(); renderSparkline(state.samples);
  byId('machine-memory').textContent = `${machine.memory.usedGiB.toFixed(1)} / ${machine.memory.physicalGiB.toFixed(1)} GiB`;
  byId('machine-pressure').textContent = machine.memory.pressure;
  byId('machine-updated').textContent = `LIVE · ${new Date(machine.capturedAt).toLocaleTimeString()}`;
  byId('machine-groups').innerHTML = machine.groups.map((group) => `<div class="group-row"><span>${escapeHtml(group.name)}</span><i style="width:${Math.min(100, group.rssGiB / Math.max(machine.groups[0]?.rssGiB || 1, .01) * 100)}%"></i><strong>${group.count} · ${group.rssGiB.toFixed(2)} GiB</strong></div>`).join('');
  byId('machine-processes').innerHTML = machine.top.map((process) => `<tr><td>${process.pid}</td><td title="${escapeHtml(process.command)}">${escapeHtml(process.name)}</td><td>${process.cpu.toFixed(1)}%</td><td>${process.rssMiB.toFixed(0)} MiB</td></tr>`).join('');
  byId('orphan-list').innerHTML = machine.orphanCandidates.length ? machine.orphanCandidates.map((process) => `<li><strong>PID ${process.pid}</strong><span>${escapeHtml(process.name)} · ${process.rssMiB.toFixed(0)} MiB</span><small>${escapeHtml(process.reason)}</small></li>`).join('') : '<li class="quiet">No candidates in this sample.</li>';
}
async function refreshMachine() {
  try { const response = await fetch('/api/machine'); if (!response.ok) throw new Error(`Machine snapshot HTTP ${response.status}`); renderMachine(await response.json()); } catch (error) { byId('machine-updated').textContent = 'LIVE SAMPLE UNAVAILABLE'; throw error; }
}

Promise.all([fetch('/api/snapshot').then((response) => { if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`); return response.json(); }), refreshMachine()]).then(([snapshot]) => renderSnapshot(snapshot));
const machineTimer = setInterval(() => refreshMachine().catch((error) => { if (!state.unloading && error?.name !== 'AbortError') reportClientError({ kind: 'machine-refresh', message: error.message, stack: error.stack }); }), 5000);
updateImpact(); renderScheduler();
window.addEventListener('beforeunload', () => { state.unloading = true; clearInterval(schedulerTimer); clearInterval(machineTimer); }, { once: true });

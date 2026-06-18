import path from "node:path"
import { JIMENG_PACKET_STATUSES, JimengArtifactLog, ingestJimengProofIntoArtifactLog, type JimengArtifactLogSnapshot, type JimengPacketInput, type JimengPacketStatus, type JimengWorkItemInput } from "./artifact-log"

export interface JimengArtifactDashboardOptions {
  dbPath: string
  rootDir: string
  port: number
  hostname?: string
  pollMs?: number
}

export interface JimengArtifactDashboardServer {
  url: string
  stop: () => void
}

const DEFAULT_DB = "data/jimeng-lab/artifact-log.sqlite"
const DEFAULT_ROOT = "."
const DEFAULT_PORT = 4177
const DEFAULT_POLL_MS = 1000

export function serveJimengArtifactDashboard(options: JimengArtifactDashboardOptions): JimengArtifactDashboardServer {
  const rootDir = path.resolve(options.rootDir)
  const dbPath = path.resolve(options.dbPath)
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/" || url.pathname.startsWith("/function/")) return htmlResponse(renderAppHtml())
      if (url.pathname === "/api/snapshot") return jsonResponse(readSnapshot(dbPath))
      if (url.pathname === "/api/events") return eventStreamResponse(dbPath, pollMs)
      if (url.pathname === "/file") return fileResponse(url, rootDir)
      return new Response("Not found", { status: 404 })
    },
  })
  return { url: server.url.toString(), stop: () => server.stop(true) }
}

function readSnapshot(dbPath: string): JimengArtifactLogSnapshot {
  const log = new JimengArtifactLog({ dbPath })
  try {
    return log.snapshot()
  } finally {
    log.close()
  }
}

function jsonResponse(value: JimengArtifactLogSnapshot): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  })
}

function htmlResponse(value: string): Response {
  return new Response(value, { headers: { "content-type": "text/html; charset=utf-8" } })
}

function eventStreamResponse(dbPath: string, pollMs: number): Response {
  let timer: ReturnType<typeof setInterval> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      let stopped = false
      const stop = () => {
        stopped = true
        if (timer) clearInterval(timer)
      }
      const send = () => {
        if (stopped) return
        try {
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(readSnapshot(dbPath))}\n\n`))
        } catch {
          stop()
        }
      }
      send()
      timer = setInterval(send, pollMs)
    },
    cancel() {
      if (timer) clearInterval(timer)
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  })
}

function fileResponse(url: URL, rootDir: string): Response | Promise<Response> {
  const raw = url.searchParams.get("path")
  if (!raw) return new Response("Missing path", { status: 400 })
  const file = path.resolve(raw)
  if (!isInside(rootDir, file)) return new Response("Path outside dashboard root", { status: 403 })
  return new Response(Bun.file(file), { headers: { "content-type": contentType(file) } })
}

function isInside(rootDir: string, file: string): boolean {
  const relative = path.relative(rootDir, file)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function contentType(file: string): string {
  if (/\.mp4$/i.test(file)) return "video/mp4"
  if (/\.png$/i.test(file)) return "image/png"
  if (/\.jpe?g$/i.test(file)) return "image/jpeg"
  if (/\.webp$/i.test(file)) return "image/webp"
  if (/\.mp3$/i.test(file)) return "audio/mpeg"
  if (/\.wav$/i.test(file)) return "audio/wav"
  if (/\.m4a$/i.test(file)) return "audio/mp4"
  return "application/octet-stream"
}

function renderAppHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jimeng Artifact Dashboard</title>
<style>
:root{color-scheme:dark;--bg:#09090b;--panel:#111113;--muted:#a1a1aa;--border:#27272a;--text:#fafafa;--accent:#a78bfa;--green:#22c55e;--yellow:#eab308;--red:#ef4444;--blue:#38bdf8}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{padding:24px;max-width:1440px;margin:0 auto}.top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:20px}.grid{display:grid;grid-template-columns:360px 1fr;gap:16px}.card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px;box-shadow:0 1px 2px #0008}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.muted{color:var(--muted)}.pill{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:999px;padding:2px 8px;font-size:12px;margin:2px}.done{color:var(--green)}.in_progress,.partial,.next{color:var(--yellow)}.failed,.blocked{color:var(--red)}button,.functionLink{background:#18181b;color:var(--text);border:1px solid var(--border);border-radius:10px;padding:8px 10px;cursor:pointer;text-decoration:none;display:inline-flex;margin:2px}.functionLink.active{border-color:var(--accent);color:white}.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}.filterInput{background:#050506;color:var(--text);border:1px solid var(--border);border-radius:10px;padding:8px 10px;min-width:220px}.shortcuts{line-height:1.6;margin-top:10px}.selected{outline:2px solid var(--accent);outline-offset:3px}.selectedArtifact{outline:2px solid var(--blue);outline-offset:3px}pre{white-space:pre-wrap;overflow:auto;background:#050506;border:1px solid var(--border);border-radius:10px;padding:10px;color:#e4e4e7}video,img,audio{width:100%;max-height:520px;border:1px solid var(--border);border-radius:12px;background:#050506}.artifact{margin-top:12px}.run{border-top:1px solid var(--border);padding-top:14px;margin-top:14px}.statusList{display:grid;gap:8px}.statusRow{border:1px solid var(--border);border-radius:10px;padding:10px;background:#0c0c0e}.small{font-size:12px}.empty{border:1px dashed var(--border);border-radius:12px;padding:24px;text-align:center;color:var(--muted)}@media(max-width:900px){.grid{grid-template-columns:1fr}.top{display:block}}
</style>
</head>
<body><main><div id="app"></div></main><script type="module">
const state = { snapshot: { generatedAtMs: 0, packets: [], workItems: [], runs: [] }, selectedFunction: routeFunction(), functionQuery: "", selectedRunIndex: 0, selectedArtifactIndex: 0 };
const app = document.getElementById("app");
function esc(value){return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}
function fileUrl(path){return "/file?path=" + encodeURIComponent(path)}
function functionPath(name){return name === "all" ? "/" : "/function/" + encodeURIComponent(name)}
function routeFunction(){return location.pathname.startsWith("/function/") ? decodeURIComponent(location.pathname.slice("/function/".length)) : "all"}
function statusClass(status){return String(status).replaceAll("-","_")}
function clampSelection(runs){
  state.selectedRunIndex = Math.max(0, Math.min(state.selectedRunIndex, Math.max(0, runs.length - 1)));
  const artifacts = runs[state.selectedRunIndex]?.artifacts ?? [];
  state.selectedArtifactIndex = Math.max(0, Math.min(state.selectedArtifactIndex, Math.max(0, artifacts.length - 1)));
}
function visibleFunctions(functions){
  const query = state.functionQuery.trim().toLowerCase();
  return query ? functions.filter(name => name.toLowerCase().includes(query)) : functions;
}
function selectFunction(name, updateUrl = true){
  state.selectedFunction = name;
  state.selectedRunIndex = 0;
  state.selectedArtifactIndex = 0;
  if (updateUrl) history.pushState(null, "", functionPath(name));
  render();
}
function moveFunction(delta){
  const functions = ["all", ...visibleFunctions(allFunctions())];
  const current = Math.max(0, functions.indexOf(state.selectedFunction));
  selectFunction(functions[(current + delta + functions.length) % functions.length]);
}
function currentRuns(){
  const runs = state.selectedFunction === "all" ? state.snapshot.runs : state.snapshot.runs.filter(run => run.functionName === state.selectedFunction);
  return runs;
}
function allFunctions(){return Array.from(new Set(state.snapshot.runs.map(run => run.functionName))).sort()}
function focusSelected(selector){
  requestAnimationFrame(() => document.querySelector(selector)?.scrollIntoView({ block: "center", behavior: "smooth" }));
}
function moveRun(delta){
  const runs = currentRuns();
  if (!runs.length) return;
  state.selectedRunIndex = (state.selectedRunIndex + delta + runs.length) % runs.length;
  state.selectedArtifactIndex = 0;
  render();
  focusSelected(".run.selected");
}
function moveArtifact(delta){
  const artifacts = currentRuns()[state.selectedRunIndex]?.artifacts ?? [];
  if (!artifacts.length) return;
  state.selectedArtifactIndex = (state.selectedArtifactIndex + delta + artifacts.length) % artifacts.length;
  render();
  focusSelected(".artifact.selectedArtifact");
}
function renderArtifact(artifact, artifactIndex){
  const url = fileUrl(artifact.path);
  let viewer = '<a href="'+esc(url)+'" target="_blank">Open artifact</a>';
  if (artifact.mime.startsWith("video/")) viewer = '<video controls src="'+esc(url)+'"></video>';
  else if (artifact.mime.startsWith("image/")) viewer = '<img src="'+esc(url)+'" alt="artifact">';
  else if (artifact.mime.startsWith("audio/")) viewer = '<audio controls src="'+esc(url)+'"></audio>';
  return '<div class="artifact '+(artifactIndex === state.selectedArtifactIndex ? "selectedArtifact" : "")+'" data-artifact-index="'+artifactIndex+'"><div class="muted small">'+esc(artifact.kind)+' · '+esc(artifact.relativePath)+' · '+esc(artifact.sizeBytes ?? "unknown")+' bytes</div>'+viewer+'</div>';
}
function renderRun(run, runIndex){
  return '<section class="run '+(runIndex === state.selectedRunIndex ? "selected" : "")+'" data-run-index="'+runIndex+'"><div><span class="pill '+statusClass(run.status)+'">'+esc(run.status)+'</span><span class="pill">'+esc(run.functionName)+'</span><span class="pill">worker '+esc(run.workerId ?? "main")+'</span></div><h3>'+esc(run.functionName)+'</h3><p>'+esc(run.prompt ?? "")+'</p><pre>'+esc(run.command)+'</pre><div class="muted small">submit '+esc(run.submitId ?? "unknown")+' · history '+esc(run.historyId ?? "unknown")+'</div>'+run.artifacts.map(renderArtifact).join("")+'</section>';
}
function renderPacket(packet){
  const owner = packet.currentWorker ?? packet.owner ?? "unassigned";
  const next = packet.nextCommand ?? packet.unblockCondition ?? "";
  return '<div class="statusRow"><div><span class="pill '+statusClass(packet.status)+'">'+esc(packet.status)+'</span><span class="pill">P'+esc(packet.priority)+'</span><span class="pill">'+esc(packet.family ?? packet.category ?? "uncategorized")+'</span></div><strong>'+esc(packet.id)+' · '+esc(packet.title)+'</strong><p class="muted">'+esc(packet.summary ?? "")+'</p><div class="small muted">Owner: '+esc(owner)+' · Next: '+esc(next)+'</div></div>';
}

function renderWorkItem(item){
  return '<div class="statusRow"><div><span class="pill '+statusClass(item.status)+'">'+esc(item.status)+'</span><span class="pill">'+esc(item.category ?? "uncategorized")+'</span></div><strong>'+esc(item.title)+'</strong><p class="muted">'+esc(item.summary ?? "")+'</p><div class="small muted">Next: '+esc(item.nextAction ?? "")+'</div></div>';
}
function render(){
  const snap = state.snapshot;
  const functions = allFunctions();
  if (state.selectedFunction !== "all" && !functions.includes(state.selectedFunction) && functions.some(name => encodeURIComponent(name) === state.selectedFunction)) state.selectedFunction = functions.find(name => encodeURIComponent(name) === state.selectedFunction);
  const shownFunctions = visibleFunctions(functions);
  const runs = currentRuns();
  clampSelection(runs);
  app.innerHTML = '<div class="top"><div><h1>Jimeng Artifact Dashboard</h1><div class="muted">Auto-refreshing from SQLite · '+new Date(snap.generatedAtMs).toLocaleTimeString()+'</div><div class="small muted shortcuts">Shortcuts: <strong>j/n</strong> next run, <strong>k/p</strong> previous run, <strong>h/l</strong> previous/next function, <strong>[</strong>/<strong>]</strong> previous/next artifact, <strong>/</strong> focus filter.</div></div><div><span class="pill">'+snap.packets.length+' packets</span><span class="pill">'+snap.workItems.length+' work items</span><span class="pill">'+snap.runs.length+' runs</span><span class="pill">'+snap.runs.reduce((sum, run) => sum + run.artifacts.length, 0)+' artifacts</span></div></div><div class="grid"><aside class="card"><h2>Packet queue</h2><div class="statusList">'+(snap.packets.length ? snap.packets.map(renderPacket).join("") : '<div class="empty">No packet ledger rows yet.</div>')+'</div><h2>Compatibility status</h2><div class="statusList">'+(snap.workItems.length ? snap.workItems.map(renderWorkItem).join("") : '<div class="empty">No legacy status rows yet.</div>')+'</div></aside><section><div class="card"><h2>Functions</h2><div class="toolbar"><input id="functionFilter" class="filterInput" value="'+esc(state.functionQuery)+'" placeholder="Filter functions (/)" aria-label="Filter functions"><a href="/" data-function="all" class="functionLink '+(state.selectedFunction === "all" ? "active" : "")+'">All</a>'+shownFunctions.map(name => '<a href="'+esc(functionPath(name))+'" data-function="'+esc(name)+'" class="functionLink '+(state.selectedFunction === name ? "active" : "")+'">'+esc(name)+'</a>').join(" ")+'</div><div class="small muted">Copy a function link to reopen this filtered dashboard directly.</div></div><div class="card">'+(runs.length ? runs.map(renderRun).join("") : '<div class="empty">No runs for this function.</div>')+'</div></section></div>';
  const filter = document.getElementById("functionFilter");
  filter?.addEventListener("input", () => { state.functionQuery = filter.value; const cursor = filter.selectionStart ?? filter.value.length; render(); const nextFilter = document.getElementById("functionFilter"); nextFilter?.focus(); nextFilter?.setSelectionRange(cursor, cursor); });
  for (const link of app.querySelectorAll("[data-function]")) link.addEventListener("click", event => { event.preventDefault(); selectFunction(link.dataset.function); });
  for (const run of app.querySelectorAll("[data-run-index]")) run.addEventListener("click", event => { const target = event.target; if (!(target instanceof Element) || target.closest("a,button,input,textarea,select,video,audio")) return; state.selectedRunIndex = Number(run.dataset.runIndex); const artifact = target.closest("[data-artifact-index]"); if (artifact) state.selectedArtifactIndex = Number(artifact.dataset.artifactIndex); render(); });
}
async function load(){state.snapshot = await (await fetch("/api/snapshot")).json(); render();}
window.addEventListener("popstate", () => { state.selectedFunction = routeFunction(); state.selectedRunIndex = 0; state.selectedArtifactIndex = 0; render(); });
document.addEventListener("keydown", event => {
  const target = event.target;
  const editing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
  if (event.key === "/" && !editing) { event.preventDefault(); document.getElementById("functionFilter")?.focus(); return; }
  if (editing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === "j" || event.key === "n") { event.preventDefault(); moveRun(1); }
  else if (event.key === "k" || event.key === "p") { event.preventDefault(); moveRun(-1); }
  else if (event.key === "l") { event.preventDefault(); moveFunction(1); }
  else if (event.key === "h") { event.preventDefault(); moveFunction(-1); }
  else if (event.key === "]") { event.preventDefault(); moveArtifact(1); }
  else if (event.key === "[") { event.preventDefault(); moveArtifact(-1); }
});
await load();
const events = new EventSource("/api/events");
events.addEventListener("snapshot", event => { state.snapshot = JSON.parse(event.data); render(); });
</script></body></html>`
}

function parseArgs(argv: string[]): { command: string; positionals: string[]; flags: Record<string, string> } {
  const [command = "serve", ...rest] = argv
  const flags: Record<string, string> = {}
  const positionals: string[] = []
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = rest[index + 1]
    if (!next || next.startsWith("--")) flags[key] = "true"
    else {
      flags[key] = next
      index += 1
    }
  }
  return { command, positionals, flags }
}

function requiredFlag(flags: Record<string, string>, key: string): string {
  const value = flags[key]
  if (!value || value === "true") throw new Error(`Missing --${key}`)
  return value
}

function optionalNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid number: ${value}`)
  return parsed
}

function optionalInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`Invalid integer: ${value}`)
  return parsed
}

function packetStatus(value: string | undefined): JimengPacketStatus {
  if (!value) return "unknown"
  if (JIMENG_PACKET_STATUSES.includes(value as JimengPacketStatus)) return value as JimengPacketStatus
  throw new Error(`Invalid packet status: ${value}`)
}

function packetOutput(packet: { id: string; status: string; title: string; priority: number; nextCommand: string | null; currentWorker: string | null }): string {
  return `id=${packet.id} status=${packet.status} priority=${packet.priority} worker=${packet.currentWorker ?? ""} title=${JSON.stringify(packet.title)} next=${JSON.stringify(packet.nextCommand ?? "")}`
}

function runPacketCommand(subcommand: string | undefined, flags: Record<string, string>, dbPath: string): void {
  const log = new JimengArtifactLog({ dbPath })
  try {
    if (subcommand === "set") {
      const id = requiredFlag(flags, "id")
      const existing = log.snapshot().packets.find((item) => item.id === id)
      const title = flags.title ?? existing?.title
      if (!title) throw new Error("Missing --title")
      const packet: JimengPacketInput = {
        id,
        title,
        family: flags.family ?? existing?.family,
        category: flags.category ?? existing?.category,
        priority: flags.priority ? optionalInteger(flags.priority, 100) : existing?.priority ?? 100,
        status: flags.status ? packetStatus(flags.status) : existing?.status ?? "unknown",
        owner: flags.owner ?? existing?.owner,
        currentWorker: flags.worker ?? existing?.currentWorker,
        reviewer: flags.reviewer ?? existing?.reviewer,
        blocker: flags.blocker ?? existing?.blocker,
        unblockCondition: flags.unblock ?? existing?.unblockCondition,
        nextCommand: flags.next ?? existing?.nextCommand,
        proofArtifact: flags.proof ?? existing?.proofArtifact,
        validationCommand: flags.validation ?? existing?.validationCommand,
        commitHash: flags.commit ?? existing?.commitHash,
        summary: flags.summary ?? existing?.summary,
      }
      log.upsertPacket(packet)
      const saved = log.snapshot().packets.find((item) => item.id === packet.id)
      if (!saved) throw new Error(`Packet not saved: ${packet.id}`)
      console.log(`[jimeng-artifacts] packet saved ${packetOutput(saved)} db=${dbPath}`)
      return
    }
    if (subcommand === "get") {
      const id = requiredFlag(flags, "id")
      const packet = log.snapshot().packets.find((item) => item.id === id)
      if (!packet) throw new Error(`Packet not found: ${id}`)
      console.log(`[jimeng-artifacts] packet ${packetOutput(packet)} db=${dbPath}`)
      return
    }
    if (subcommand === "next") {
      const next = log.nextPacket()
      if (!next) {
        console.log(`[jimeng-artifacts] packet next none db=${dbPath}`)
        return
      }
      if (flags.claim && flags.claim !== "false") {
        const currentWorker = flags.claim === "true" ? flags.worker ?? next.currentWorker ?? "" : flags.claim
        const claimed = { ...next, status: "in_progress" as const, currentWorker }
        log.upsertPacket(claimed)
        console.log(`[jimeng-artifacts] packet claimed ${packetOutput(claimed)} db=${dbPath}`)
        return
      }
      console.log(`[jimeng-artifacts] packet next ${packetOutput(next)} db=${dbPath}`)
      return
    }
  } finally {
    log.close()
  }
  throw new Error("Usage: packet set|get|next [--db path] [--id id] [--title title] [--status todo|in_progress|review|blocked|done|skipped|unknown]")
}

export async function main(argv: string[]): Promise<void> {
  const { command, positionals, flags } = parseArgs(argv)
  if (command === "ingest-proof") {
    const dbPath = flags.db ?? DEFAULT_DB
    const proofRoot = requiredFlag(flags, "proofRoot")
    const snapshot = ingestJimengProofIntoArtifactLog({
      dbPath,
      proofRoot,
      workerId: flags.worker,
      command: flags.command,
      commandCwd: flags.cwd,
      notes: flags.notes,
    })
    console.log(`[jimeng-artifacts] ingested proofRoot=${proofRoot} db=${dbPath} runs=${snapshot.runs.length} artifacts=${snapshot.runs.reduce((sum, run) => sum + run.artifacts.length, 0)}`)
    return
  }
  if (command === "packet") {
    runPacketCommand(positionals[0], flags, flags.db ?? DEFAULT_DB)
    return
  }
  if (command === "status") {
    const dbPath = flags.db ?? DEFAULT_DB
    const log = new JimengArtifactLog({ dbPath })
    try {
      const item: JimengWorkItemInput = {
        id: requiredFlag(flags, "id"),
        title: requiredFlag(flags, "title"),
        status: requiredFlag(flags, "status") as JimengWorkItemInput["status"],
        owner: flags.owner,
        category: flags.category,
        summary: flags.summary,
        nextAction: flags.next,
      }
      log.upsertWorkItem(item)
      console.log(`[jimeng-artifacts] status saved id=${item.id} status=${item.status} db=${dbPath}`)
    } finally {
      log.close()
    }
    return
  }
  if (command === "serve") {
    const server = serveJimengArtifactDashboard({
      dbPath: flags.db ?? DEFAULT_DB,
      rootDir: flags.root ?? DEFAULT_ROOT,
      port: optionalNumber(flags.port, DEFAULT_PORT),
      hostname: flags.host ?? "127.0.0.1",
      pollMs: optionalNumber(flags.pollMs, DEFAULT_POLL_MS),
    })
    console.log(`[jimeng-artifacts] serving ${server.url}`)
    const { promise } = Promise.withResolvers<void>()
    await promise
    return
  }
  throw new Error(`Unknown command: ${command}`)
}

if (import.meta.main) {
  await main(Bun.argv.slice(2))
}

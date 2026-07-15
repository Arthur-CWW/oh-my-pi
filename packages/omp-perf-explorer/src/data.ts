export type EvidenceLevel = "MEASURED" | "INFERENCE" | "TARGET";
export type Status = "landed" | "in-flight" | "proposed";

export interface SummaryMetric {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly level: EvidenceLevel;
  readonly tone: "critical" | "warning" | "neutral";
}

export interface Bottleneck {
  readonly rank: number;
  readonly title: string;
  readonly status: Status;
  readonly evidence: string;
  readonly gap: string;
  readonly fix: string;
  readonly acceptance: string;
}

export const snapshot = {
  observedAt: "2026-07-15",
  build: "1b178140adbd",
  summary: [
    { label: "OMP + MCP RSS", value: "8.69 GiB", detail: "113 processes observed", level: "MEASURED", tone: "critical" },
    { label: "Main OMP high-water", value: "1.75 GiB", detail: "PID 85376 · 55.3% CPU", level: "MEASURED", tone: "critical" },
    { label: "Browser footprint", value: "13.4 GiB", detail: "69 browser-ish processes", level: "MEASURED", tone: "warning" },
    { label: "Spawn incident", value: "8.5 GiB", detail: "cmux session-start child · 100% CPU", level: "MEASURED", tone: "critical" },
  ] satisfies readonly SummaryMetric[],
  bottlenecks: [
    { rank: 1, title: "Spawn/setup event-loop starvation", status: "in-flight", evidence: "A cmux session-start child reached 100% CPU and 8.5 GiB RSS, starving TUI input until it exited.", gap: "The 120-child proof covers POST-SPAWN only; setup and hook waves remain uninstrumented.", fix: "Measure spawn phases, bound setup concurrency, and keep input dispatch ahead of background projection work.", acceptance: "p99 input dispatch stays under 16 ms throughout a 120-child cold spawn." },
    { rank: 2, title: "Retained View projections", status: "proposed", evidence: "Hidden cmux tabs retain TUI projections, tickers, caches, and child observation despite not being visible.", gap: "No retained-size split yet between runner authority and view-only state.", fix: "Split disposable View from Runner; gate hidden views and load only the selected child journal.", acceptance: "Detached sessions do zero render/ticker work and carry no transcript component graph." },
    { rank: 3, title: "JSC high-water memory", status: "landed", evidence: "The long-lived main process remains at 1.75 GiB RSS; deleting JS objects does not reliably return high-water pages.", gap: "Need recycle trials that separate live retained bytes from allocator high-water.", fix: "Checkpoint then cold-recycle Runner through HR-115 reexec/re-adopt/auto-resume.", acceptance: "Runner RSS returns within 15% of cold baseline without journal or child-state loss." },
    { rank: 4, title: "Browser/helper sprawl", status: "in-flight", evidence: "69 browser-ish processes account for 13.4 GiB RSS in the same fleet snapshot.", gap: "Ownership and useful-idle attribution are incomplete.", fix: "Apply HR-121 ownership budgets and HR-127 pooled cmux tabs with idle reaping.", acceptance: "Hard process/RSS caps hold while active owners retain usable sessions." },
    { rank: 5, title: "Tool/transcript payload retention", status: "proposed", evidence: "Unselected logical children need summary rows, but parents observe and retain richer projections and payloads.", gap: "No page residency or hydrate-latency distribution exists yet.", fix: "Journal-backed immutable pages, compact hot rows, serialized cold pages, then drop JS objects.", acceptance: "Unselected child hot state is five scalars plus error count; p95 hydrate under 50 ms." },
  ] satisfies readonly Bottleneck[],
  proof: { events: 1440, renders: 1, gitReads: 0, journalReads: 0, inputDispatchMs: 0 },
  roadmap: [
    { id: "HR-115", title: "Fleet lifecycle substrate", status: "landed", dependsOn: [] },
    { id: "HR-121", title: "Browser ownership caps", status: "in-flight", dependsOn: ["HR-115"] },
    { id: "HR-127", title: "cmux tab pool", status: "in-flight", dependsOn: ["HR-121"] },
    { id: "HR-130", title: "Runner / View split", status: "proposed", dependsOn: ["HR-115"] },
    { id: "HR-131", title: "Progress explorer", status: "proposed", dependsOn: ["HR-130"] },
    { id: "HR-133", title: "Transcript memory paging", status: "proposed", dependsOn: ["HR-130"] },
  ],
} as const;

export type Snapshot = typeof snapshot;

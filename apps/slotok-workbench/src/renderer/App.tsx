import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { BootstrapPayload, EvalElementDetail, EvalElementSummary, EvalRunRow } from "../types"

export type ViewKey = "runs" | "dag" | "element" | "json" | "metrics" | "artifacts" | "notes" | "logs" | "terminal" | "views"

interface ViewSpec {
  key: ViewKey
  chord: string
  label: string
  description: string
}

interface AppInfo {
  name: string
  version: string
  platform: string
  cwd: string
}

const daemonBaseUrl = "http://127.0.0.1:47522"

const views: ViewSpec[] = [
  { key: "runs", chord: "gr", label: "Runs", description: "Pipeline and provider-eval run list" },
  { key: "dag", chord: "gd", label: "DAG", description: "Stage, artifact, provider, and version graph" },
  { key: "element", chord: "ge", label: "Element", description: "Focused detail view for a selected pipeline element" },
  { key: "json", chord: "gj", label: "JSON", description: "Raw structured data and schema inspection" },
  { key: "metrics", chord: "gm", label: "Metrics", description: "Cost, latency, tokens, provider quality, cache behavior" },
  { key: "artifacts", chord: "ga", label: "Artifacts", description: "Videos, frames, generated assets, audio, transcripts" },
  { key: "notes", chord: "gn", label: "Notes", description: "Annotations, markup, ratings, follow-up queues" },
  { key: "logs", chord: "gl", label: "Logs", description: "Provider logs, worker logs, errors, process output" },
  { key: "terminal", chord: "gt", label: "Terminal", description: "Future local PTY and agent/session cockpit panel" },
  { key: "views", chord: "gv", label: "Views", description: "Generated/hot-swappable renderers for selected data" },
]

const shortcuts = [
  ["j/k", "Move element selection down/up"],
  ["gg/G", "Jump to first/last element"],
  ["/", "Focus search"],
  ["g<key>", "Switch view"],
  ["a", "Annotate selected item"],
  ["r/R", "Rerun selected stage / rerun descendants"],
  ["d", "Diff versions"],
  ["y", "Copy selected ID/path"],
  ["?", "Toggle shortcut help"],
]

function viewByChord(chord: string): ViewSpec | undefined {
  return views.find((view) => view.chord === chord)
}

export interface AppProps {
  fetchOnMount?: boolean
  initialBootstrap?: BootstrapPayload | null
  initialDetail?: EvalElementDetail | null
  initialView?: ViewKey
}

export function App(props: AppProps = {}) {
  const shouldFetchOnMount = props.fetchOnMount ?? true
  const initialView = props.initialView ?? "runs"
  const initialViewIndex = Math.max(0, views.findIndex((view) => view.key === initialView))
  const matchingInitialElementIndex = props.initialBootstrap?.elements.findIndex((element) => element.id === props.initialDetail?.id) ?? 0
  const initialElementIndex = matchingInitialElementIndex >= 0 ? matchingInitialElementIndex : 0

  const [activeView, setActiveView] = createSignal<ViewKey>(initialView)
  const [selectedViewIndex, setSelectedViewIndex] = createSignal(initialViewIndex)
  const [selectedElementIndex, setSelectedElementIndex] = createSignal(initialElementIndex)
  const [showHelp, setShowHelp] = createSignal(false)
  const [pendingChord, setPendingChord] = createSignal("")
  const [appInfo, setAppInfo] = createSignal<AppInfo | null>(null)
  const [statusMessage, setStatusMessage] = createSignal("Shell ready. Waiting for daemon.")
  const [bootstrap, setBootstrap] = createSignal<BootstrapPayload | null>(props.initialBootstrap ?? null)
  const [detail, setDetail] = createSignal<EvalElementDetail | null>(props.initialDetail ?? null)
  const [detailError, setDetailError] = createSignal<string | null>(null)

  const activeSpec = createMemo(() => views.find((view) => view.key === activeView()) ?? views[0])
  const elements = createMemo(() => bootstrap()?.elements ?? [])
  const selectedElement = createMemo(() => elements()[selectedElementIndex()] ?? null)
  const selectedRun = createMemo(() => bootstrap()?.runs.find((run) => run.run_id === selectedElement()?.runId) ?? bootstrap()?.runs[0] ?? null)

  createEffect(() => {
    const element = selectedElement()
    if (!element) {
      setDetail(null)
      return
    }
    if (!shouldFetchOnMount) return
    let cancelled = false
    setDetailError(null)
    void fetch(`${daemonBaseUrl}/api/elements/${encodeURIComponent(element.id)}`)
      .then((response) => response.ok ? response.json() as Promise<EvalElementDetail> : Promise.reject(new Error(`detail ${response.status}`)))
      .then((payload) => {
        if (!cancelled) setDetail(payload)
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setDetail(null)
          setDetailError(error.message)
        }
      })
    onCleanup(() => {
      cancelled = true
    })
  })

  onMount(() => {
    void window.slotok?.getAppInfo().then(setAppInfo).catch((error: Error) => {
      setStatusMessage(`preload unavailable: ${error.message}`)
    })

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return
      }

      if (event.key === "?") {
        event.preventDefault()
        setShowHelp((value) => !value)
        return
      }

      if (event.key === "/") {
        event.preventDefault()
        document.getElementById("slotok-search")?.focus()
        return
      }

      if (event.key === "g") {
        event.preventDefault()
        if (pendingChord() === "g") {
          setSelectedElementIndex(0)
          setPendingChord("")
        } else {
          setPendingChord("g")
          window.setTimeout(() => setPendingChord(""), 900)
        }
        return
      }

      if (pendingChord() === "g") {
        const chord = `g${event.key}`
        const nextView = viewByChord(chord)
        if (nextView) {
          event.preventDefault()
          setActiveView(nextView.key)
          setSelectedViewIndex(views.findIndex((view) => view.key === nextView.key))
          setStatusMessage(`Switched to ${nextView.label}`)
        }
        setPendingChord("")
        return
      }

      if (event.key === "j") {
        event.preventDefault()
        setSelectedElementIndex((value) => Math.min(Math.max(0, elements().length - 1), value + 1))
        return
      }

      if (event.key === "k") {
        event.preventDefault()
        setSelectedElementIndex((value) => Math.max(0, value - 1))
        return
      }

      if (event.key === "G") {
        event.preventDefault()
        setSelectedElementIndex(Math.max(0, elements().length - 1))
        return
      }

      if (event.key === "Enter") {
        event.preventDefault()
        setActiveView("element")
        setSelectedViewIndex(views.findIndex((view) => view.key === "element"))
        setStatusMessage(selectedElement() ? `Focused ${selectedElement()?.title ?? "element"}` : "No element selected")
        return
      }

      if (event.key === "y") {
        event.preventDefault()
        const id = selectedElement()?.id
        if (id) {
          void navigator.clipboard?.writeText(id)
          setStatusMessage(`Copied element id ${id.slice(0, 12)}`)
        }
        return
      }

      if (["a", "r", "R", "d"].includes(event.key)) {
        event.preventDefault()
        setStatusMessage(`Shortcut ${event.key} reserved for ${selectedElement()?.title ?? activeSpec().label}`)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown))

    if (!shouldFetchOnMount) return

    void fetch(`${daemonBaseUrl}/api/bootstrap?limit=250`)
      .then((response) => response.ok ? response.json() as Promise<BootstrapPayload> : Promise.reject(new Error(`daemon ${response.status}`)))
      .then((payload) => {
        setBootstrap(payload)
        setSelectedElementIndex(0)
        setStatusMessage(`Daemon online: ${payload.runs.length} runs, ${payload.elements.length} elements`)
      })
      .catch((error: Error) => {
        setStatusMessage(`Daemon offline: ${error.message}`)
      })
  })

  return (
    <main class="slotok-shell">
      <aside class="sidebar" aria-label="Slotok navigation">
        <div class="window-controls" aria-hidden="true">
          <span class="dot close" />
          <span class="dot minimize" />
          <span class="dot zoom" />
        </div>

        <div class="sidebar-brand">
          <div class="brand-glyph">S</div>
          <div>
            <h1>Slotok</h1>
            <p>AI video workbench</p>
          </div>
        </div>

        <button type="button" class="sidebar-action">New eval run</button>
        <input id="slotok-search" class="search" placeholder="Search" />

        <section class="nav-section" aria-label="Workbench views">
          <h2>Views</h2>
          <nav class="view-list">
            <For each={views}>{(view, index) => (
              <button
                type="button"
                classList={{ "view-row": true, selected: selectedViewIndex() === index(), active: activeView() === view.key }}
                onClick={() => {
                  setSelectedViewIndex(index())
                  setActiveView(view.key)
                }}
              >
                <span class="view-dot" />
                <span class="view-label">{view.label}</span>
                <span class="view-chord">{view.chord}</span>
              </button>
            )}</For>
          </nav>
        </section>

        <section class="nav-section run-history" aria-label="Recent runs">
          <h2>Recent runs</h2>
          <Show when={bootstrap()} fallback={<p class="sidebar-muted">Start daemon to load runs.</p>}>
            {(payload) => (
              <For each={payload().runs.slice(0, 6)}>{(run) => <SidebarRun run={run} />}</For>
            )}
          </Show>
        </section>

        <div class="sidebar-footer">
          <span classList={{ "connection-dot": true, online: Boolean(bootstrap()) }} />
          <span>{bootstrap() ? "Local daemon online" : "Daemon offline"}</span>
        </div>
      </aside>

      <section class="main-column">
        <header class="topbar">
          <div class="breadcrumbs" aria-label="Breadcrumb">
            <span>Slotok</span>
            <span>›</span>
            <span>Video understanding</span>
            <span>›</span>
            <strong>{activeSpec().label}</strong>
          </div>
          <div class="topbar-actions">
            <button type="button" class="ghost-button">Local</button>
            <button type="button" class="ghost-button">{pendingChord() ? "g…" : "Normal"}</button>
            <button type="button" class="icon-button" aria-label="Keyboard shortcuts" onClick={() => setShowHelp((value) => !value)}>?</button>
          </div>
        </header>

        <div class="workspace-grid">
          <section class="document-pane" aria-label="Selected Slotok work">
            <header class="document-header">
              <p class="kicker">Cursor/Zed for AI TikTok/video pipeline engineering</p>
              <h2>Video understanding evals</h2>
              <p>
                Inspect provider results, parsed decompositions, sampled frames, cost, latency, and cache behavior
                without leaving the local workbench.
              </p>
              <div class="summary-line" aria-label="Eval summary">
                <InlineMetric label="Runs" value={String(bootstrap()?.runs.length ?? 0)} />
                <InlineMetric label="Elements" value={String(elements().length)} />
                <InlineMetric label="Selected" value={selectedElement()?.provider ?? "none"} />
                <InlineMetric label="View" value={activeSpec().chord} />
              </div>
            </header>

            <Show when={bootstrap()}>
              {(payload) => (
                <section class="run-strip" aria-label="Loaded eval runs">
                  <For each={payload().runs.slice(0, 3)}>{(run) => <RunCard run={run} />}</For>
                </section>
              )}
            </Show>

            <section class="work-card elements-card">
              <div class="card-header compact">
                <div>
                  <h3>Eval elements</h3>
                  <p>{elements().length ? `${selectedElementIndex() + 1} of ${elements().length}` : "No eval elements loaded"}</p>
                </div>
                <span class="subtle-shortcut">j/k</span>
              </div>
              <ElementList elements={elements()} selectedIndex={selectedElementIndex()} onSelect={setSelectedElementIndex} />
            </section>

            <section class="work-card detail-card">
              <div class="card-header compact">
                <div>
                  <h3>{selectedElement()?.title ?? "No element selected"}</h3>
                  <p>{selectedElement()?.subtitle ?? activeSpec().description}</p>
                </div>
                <span class="status-chip">{activeSpec().label}</span>
              </div>
              <Show when={selectedElement()} fallback={<EmptyState message="Start the daemon to load eval data." />}> 
                {(element) => (
                  <ElementDetail element={element()} detail={detail()} error={detailError()} activeView={activeView()} />
                )}
              </Show>
            </section>
          </section>

          <Inspector
            appInfo={appInfo()}
            bootstrap={bootstrap()}
            detail={detail()}
            element={selectedElement()}
            run={selectedRun()}
            statusMessage={statusMessage()}
          />
        </div>
      </section>

      <Show when={showHelp()}>
        <div class="help-popover" role="dialog" aria-label="Keyboard shortcuts">
          <header>
            <h3>Shortcuts</h3>
            <button type="button" onClick={() => setShowHelp(false)}>×</button>
          </header>
          <For each={shortcuts}>{([key, description]) => (
            <div class="shortcut-row">
              <kbd>{key}</kbd>
              <span>{description}</span>
            </div>
          )}</For>
        </div>
      </Show>
    </main>
  )
}

function SidebarRun(props: { run: EvalRunRow }) {
  return (
    <div class="sidebar-run">
      <span class="folder-icon" aria-hidden="true">□</span>
      <span>
        <strong>{compactRunId(props.run.run_id)}</strong>
        <small>{props.run.result_count ?? 0} results · {formatUsd(props.run.billed_cost_usd ?? 0)}</small>
      </span>
    </div>
  )
}

function RunCard(props: { run: EvalRunRow }) {
  return (
    <article class="run-card">
      <div class="run-icon" aria-hidden="true">↳</div>
      <div>
        <strong>{props.run.run_id}</strong>
        <p>{props.run.video_count} video · {props.run.max_frames} frame cap · {props.run.result_count ?? 0} results</p>
      </div>
      <span>{formatUsd(props.run.billed_cost_usd ?? 0)}</span>
    </article>
  )
}

function InlineMetric(props: { label: string; value: string }) {
  return (
    <span class="inline-metric">
      <strong>{props.value}</strong>
      <span>{props.label}</span>
    </span>
  )
}

function Metric(props: { label: string; value: string; detail: string }) {
  return (
    <div class="metric-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </div>
  )
}

function ElementList(props: { elements: EvalElementSummary[]; selectedIndex: number; onSelect: (index: number) => void }) {
  return (
    <div class="element-list" role="listbox" aria-label="Eval elements">
      <For each={props.elements}>{(element, index) => (
        <button
          type="button"
          classList={{ "element-row": true, selected: props.selectedIndex === index(), bad: element.metrics.parsedOk === false }}
          onClick={() => props.onSelect(index())}
        >
          <span classList={{ "result-dot": true, bad: element.metrics.parsedOk === false, good: element.metrics.parsedOk === true }} />
          <span class="element-main">
            <strong>{element.title}</strong>
            <small>{element.status} · {element.model} · {compactRunId(element.runId)}</small>
          </span>
          <span class="provider-badge">{element.provider}</span>
          <span class="parse-badge">{element.metrics.parsedOk === false ? "bad json" : element.metrics.parsedOk === true ? "parsed" : "unknown"}</span>
        </button>
      )}</For>
    </div>
  )
}

function ElementDetail(props: { element: EvalElementSummary; detail: EvalElementDetail | null; error: string | null; activeView: ViewKey }) {
  const parsed = createMemo(() => props.detail?.parsed)
  return (
    <div class="element-detail">
      <Show when={props.error}>
        {(error) => <p class="error-line">Detail load failed: {error()}</p>}
      </Show>

      <div class="metric-row">
        <Metric label="Cost" value={formatUsd(props.element.metrics.estimatedCostUsd ?? props.element.metrics.avoidedCostUsd)} detail={props.element.metrics.estimatedCostUsd ? "billed" : "avoided/cache"} />
        <Metric label="Latency" value={formatMs(props.element.metrics.latencyMs)} detail={props.element.cacheStatus} />
        <Metric label="Tokens" value={formatNumber(props.element.metrics.totalTokens)} detail={`${formatNumber(props.element.metrics.promptTokens)} in / ${formatNumber(props.element.metrics.completionTokens)} out`} />
        <Metric label="Finish" value={props.element.metrics.finishReason ?? "—"} detail={props.element.metrics.parsedOk === false ? "parse failed" : "provider"} />
      </div>

      <Show when={props.detail?.frames.length}>
        <div class="frame-strip">
          <For each={props.detail?.frames ?? []}>{(frame) => (
            <figure>
              <img src={fileUrl(frame.path)} alt={`Frame ${frame.index} at ${frame.timestampSeconds}s`} />
              <figcaption>{frame.timestampSeconds}s</figcaption>
            </figure>
          )}</For>
        </div>
      </Show>

      <ParsedSummary parsed={parsed()} />

      <Show when={props.activeView === "json" || props.activeView === "element"}>
        <pre class="json-preview">{jsonPreview(props.activeView === "json" ? parsed() : props.detail ?? props.element)}</pre>
      </Show>
    </div>
  )
}

function ParsedSummary(props: { parsed: unknown }) {
  const summary = createMemo(() => parsedSummary(props.parsed))
  return (
    <section class="parsed-summary">
      <p class="kicker">Parsed decomposition</p>
      <h4>{summary().title}</h4>
      <p>{summary().description}</p>
      <div class="summary-chips">
        <For each={summary().chips}>{(chip) => <span>{chip}</span>}</For>
      </div>
    </section>
  )
}

function Inspector(props: {
  appInfo: AppInfo | null
  bootstrap: BootstrapPayload | null
  detail: EvalElementDetail | null
  element: EvalElementSummary | null
  run: EvalRunRow | null
  statusMessage: string
}) {
  const pathRows = createMemo(() => selectedPathRows(props.element))
  return (
    <aside class="inspector-panel" aria-label="Inspector">
      <section class="inspector-card">
        <div class="inspector-header">
          <h3>Environment</h3>
          <span class="gear" aria-hidden="true">⚙</span>
        </div>
        <dl class="runtime-list">
          <dt>App</dt>
          <dd>{props.appInfo?.name ?? "Slotok Workbench"}</dd>
          <dt>Mode</dt>
          <dd>Local</dd>
          <dt>Branch</dt>
          <dd>main</dd>
          <dt>Status</dt>
          <dd>{props.statusMessage}</dd>
        </dl>
      </section>

      <section class="inspector-card">
        <div class="inspector-header">
          <h3>Selected</h3>
          <span classList={{ "connection-dot": true, online: Boolean(props.element) }} />
        </div>
        <Show when={props.element} fallback={<p class="empty-state">No element selected.</p>}>
          {(element) => (
            <dl class="runtime-list">
              <dt>Provider</dt>
              <dd>{element().provider}</dd>
              <dt>Status</dt>
              <dd>{element().status}</dd>
              <dt>Run</dt>
              <dd>{compactRunId(element().runId)}</dd>
              <dt>Created</dt>
              <dd>{formatTimestamp(element().createdAt)}</dd>
            </dl>
          )}
        </Show>
      </section>

      <section class="inspector-card">
        <div class="inspector-header">
          <h3>Metrics</h3>
          <span>{props.run ? `${props.run.result_count ?? 0} results` : "—"}</span>
        </div>
        <div class="inspector-metrics">
          <InlineMetric label="billed" value={formatUsd(props.run?.billed_cost_usd ?? props.element?.metrics.estimatedCostUsd)} />
          <InlineMetric label="avoided" value={formatUsd(props.run?.avoided_cost_usd ?? props.element?.metrics.avoidedCostUsd)} />
          <InlineMetric label="latency" value={formatMs(props.element?.metrics.latencyMs ?? props.run?.avg_latency_ms)} />
          <InlineMetric label="tokens" value={formatNumber(props.element?.metrics.totalTokens)} />
        </div>
      </section>

      <section class="inspector-card">
        <div class="inspector-header">
          <h3>Paths</h3>
          <span>{pathRows().length}</span>
        </div>
        <dl class="path-list">
          <For each={pathRows()}>{([label, path]) => (
            <>
              <dt>{label}</dt>
              <dd>{path}</dd>
            </>
          )}</For>
        </dl>
      </section>

      <section class="inspector-card actions-card">
        <button type="button">Annotate</button>
        <button type="button">Dry-run rerun</button>
        <button type="button">Copy JSON pointer</button>
      </section>
    </aside>
  )
}

function EmptyState(props: { message: string }) {
  return <p class="empty-state">{props.message}</p>
}

function selectedPathRows(element: EvalElementSummary | null): Array<[string, string]> {
  if (!element) return []
  const rows: Array<[string, string]> = [["video", element.paths.video], ["cache", element.paths.cache]]
  if (element.paths.response) rows.push(["response", element.paths.response])
  if (element.paths.parsed) rows.push(["parsed", element.paths.parsed])
  return rows
}

function parsedSummary(value: unknown): { title: string; description: string; chips: string[] } {
  if (!value || typeof value !== "object") {
    return { title: "No parsed JSON", description: "The provider output has not been parsed into a structured decomposition.", chips: [] }
  }
  const record = value as Record<string, unknown>
  if (typeof record.rawText === "string") {
    return { title: "Raw/truncated provider text", description: record.rawText.slice(0, 360), chips: ["rawText", "needs retry"] }
  }
  const timeline = record.timeline && typeof record.timeline === "object" ? record.timeline as Record<string, unknown> : {}
  const segments = Array.isArray(timeline.segments) ? timeline.segments.length : 0
  const transitions = Array.isArray(timeline.transitions) ? timeline.transitions.length : 0
  const assets = Array.isArray(record.asset_generation_plan) ? record.asset_generation_plan.length : 0
  const experiments = Array.isArray(record.provider_experiment_matrix) ? record.provider_experiment_matrix.length : 0
  return {
    title: typeof record.format_family === "string" ? record.format_family : "Structured video decomposition",
    description: typeof record.video_summary === "string" ? record.video_summary : "Parsed JSON is available for this eval result.",
    chips: [`${segments} segments`, `${transitions} transitions`, `${assets} assets`, `${experiments} experiments`],
  }
}

function fileUrl(path: string): string {
  return `${daemonBaseUrl}/api/file?path=${encodeURIComponent(path)}`
}

function jsonPreview(value: unknown, maxChars = 9000): string {
  const text = JSON.stringify(value ?? null, null, 2)
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text
}

function compactRunId(value: string): string {
  return value.replace(/^run_/, "").replace(/_slotok$/, "")
}

function formatTimestamp(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, "Z")
}

function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "—"
}

function formatMs(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  if (value === 0) return "0ms"
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.round(value)}ms`
}

function formatUsd(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—"
  if (value === 0) return "$0"
  return `$${value.toFixed(4)}`
}

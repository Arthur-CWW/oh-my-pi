import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import type { BootstrapPayload } from "../types"

type ViewKey = "runs" | "dag" | "element" | "json" | "metrics" | "artifacts" | "notes" | "logs" | "terminal" | "views"

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
  ["j/k", "Move selection down/up"],
  ["gg/G", "Jump to first/last item"],
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

export function App() {
  const [activeView, setActiveView] = createSignal<ViewKey>("runs")
  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [showHelp, setShowHelp] = createSignal(false)
  const [pendingChord, setPendingChord] = createSignal("")
  const [appInfo, setAppInfo] = createSignal<AppInfo | null>(null)
  const [statusMessage, setStatusMessage] = createSignal("Shell ready. Waiting for daemon.")
  const [bootstrap, setBootstrap] = createSignal<BootstrapPayload | null>(null)

  const activeSpec = createMemo(() => views.find((view) => view.key === activeView()) ?? views[0])
  const selectedView = createMemo(() => views[selectedIndex()] ?? views[0])

  onMount(() => {
    void window.slotok?.getAppInfo().then(setAppInfo).catch((error: Error) => {
      setStatusMessage(`preload unavailable: ${error.message}`)
    })

    void fetch("http://127.0.0.1:47522/api/bootstrap?limit=250")
      .then((response) => response.ok ? response.json() as Promise<BootstrapPayload> : Promise.reject(new Error(`daemon ${response.status}`)))
      .then((payload) => {
        setBootstrap(payload)
        setStatusMessage(`Daemon online: ${payload.runs.length} runs, ${payload.elements.length} elements`)
      })
      .catch((error: Error) => {
        setStatusMessage(`Daemon offline: ${error.message}`)
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

      if (event.key === "j") {
        event.preventDefault()
        setSelectedIndex((value) => Math.min(views.length - 1, value + 1))
        return
      }

      if (event.key === "k") {
        event.preventDefault()
        setSelectedIndex((value) => Math.max(0, value - 1))
        return
      }

      if (event.key === "G") {
        event.preventDefault()
        setSelectedIndex(views.length - 1)
        return
      }

      if (event.key === "g") {
        event.preventDefault()
        if (pendingChord() === "g") {
          setSelectedIndex(0)
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
          setSelectedIndex(views.findIndex((view) => view.key === nextView.key))
          setStatusMessage(`Switched to ${nextView.label}`)
        }
        setPendingChord("")
        return
      }

      if (event.key === "Enter") {
        event.preventDefault()
        setActiveView(selectedView().key)
        setStatusMessage(`Focused ${selectedView().label}`)
        return
      }

      if (["a", "r", "R", "d", "y"].includes(event.key)) {
        event.preventDefault()
        setStatusMessage(`Shortcut ${event.key} reserved for ${selectedView().label}`)
      }
    }

    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => window.removeEventListener("keydown", onKeyDown))
  })

  return (
    <main class="app-shell">
      <aside class="sidebar" aria-label="Slotok navigation">
        <div class="brand-block">
          <div class="brand-mark">S</div>
          <div>
            <h1>Slotok</h1>
            <p>Infinite remix workbench</p>
          </div>
        </div>

        <input id="slotok-search" class="search" placeholder="/ search runs, assets, providers" />

        <nav class="view-list">
          <For each={views}>{(view, index) => (
            <button
              type="button"
              classList={{ "view-row": true, selected: selectedIndex() === index(), active: activeView() === view.key }}
              onClick={() => {
                setSelectedIndex(index())
                setActiveView(view.key)
              }}
            >
              <span class="view-chord">{view.chord}</span>
              <span>
                <strong>{view.label}</strong>
                <small>{view.description}</small>
              </span>
            </button>
          )}</For>
        </nav>
      </aside>

      <section class="workspace">
        <header class="topbar">
          <div>
            <span class="eyebrow">{activeSpec().chord}</span>
            <h2>{activeSpec().label}</h2>
          </div>
          <div class="topbar-actions">
            <span class="status-pill">{pendingChord() ? "g…" : "normal"}</span>
            <button type="button" onClick={() => setShowHelp((value) => !value)}>?</button>
          </div>
        </header>

        <section class="hero-panel">
          <div class="panel-copy">
            <p class="eyebrow">Cursor for AI TikTok/video pipeline engineering</p>
            <h3>{activeSpec().description}</h3>
            <p>
              Slotok will connect reference videos, decompositions, provider experiments, DAG stages,
              generated assets, annotations, and reruns into one fast local-first workbench.
            </p>
          </div>
          <div class="metric-grid">
            <Metric label="Current stage" value="Shell" detail="Task 1 complete" />
            <Metric label="Daemon" value={bootstrap() ? "online" : "offline"} detail={bootstrap() ? `${bootstrap()?.runs.length ?? 0} runs` : "run dev:daemon"} />
            <Metric label="Eval elements" value={String(bootstrap()?.elements.length ?? 0)} detail="video-understanding" />
            <Metric label="Shortcut mode" value={pendingChord() || "vim"} detail="g<key>, j/k, /" />
          </div>
        </section>

        <Show when={bootstrap()}>
          {(payload) => (
            <section class="eval-strip" aria-label="Loaded eval data">
              <For each={payload().runs.slice(0, 4)}>{(run) => (
                <div class="eval-run-card">
                  <strong>{run.run_id}</strong>
                  <span>{run.video_count} video(s) · {run.max_frames} frame cap · {run.result_count ?? 0} result(s)</span>
                </div>
              )}</For>
            </section>
          )}
        </Show>

        <section class="content-grid">
          <article class="card large">
            <div class="card-header">
              <h3>{activeSpec().label} surface</h3>
              <span>{activeSpec().chord}</span>
            </div>
            <ViewPreview view={activeSpec()} />
          </article>

          <article class="card">
            <div class="card-header">
              <h3>Runtime</h3>
              <span>local</span>
            </div>
            <dl class="runtime-list">
              <dt>App</dt>
              <dd>{appInfo()?.name ?? "Slotok Workbench"}</dd>
              <dt>Platform</dt>
              <dd>{appInfo()?.platform ?? "browser/dev"}</dd>
              <dt>Project</dt>
              <dd>{appInfo()?.cwd ?? "preload pending"}</dd>
              <dt>Status</dt>
              <dd>{statusMessage()}</dd>
              <dt>SQLite</dt>
              <dd>{bootstrap()?.server.sqlitePath ?? "not connected"}</dd>
            </dl>
          </article>
        </section>
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

function Metric(props: { label: string; value: string; detail: string }) {
  return (
    <div class="metric-card">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </div>
  )
}

function ViewPreview(props: { view: ViewSpec }) {
  return (
    <div class="view-preview">
      <div class="graph-ghost" aria-hidden="true">
        <span class="node source">ref</span>
        <span class="edge edge-a" />
        <span class="node frames">frames</span>
        <span class="edge edge-b" />
        <span class="node provider">provider</span>
        <span class="edge edge-c" />
        <span class="node decomp">decomp</span>
      </div>
      <div>
        <p class="eyebrow">Selected view</p>
        <h4>{props.view.label}</h4>
        <p>{props.view.description}</p>
        <p class="muted">
          Task 2 will load current video-understanding eval runs from SQLite and hydrate this shell with real data.
        </p>
      </div>
    </div>
  )
}

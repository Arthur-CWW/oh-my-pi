const feedEl = document.querySelector("#feed")
const statusEl = document.querySelector("#status")
const needsFilterEl = document.querySelector("#needs-filter")
const activeFiltersEl = document.querySelector("#active-filters")
const systemToggleEl = document.querySelector("#system-toggle")
const systemLogEl = document.querySelector("#system-log")
const emptyTemplate = document.querySelector("#empty-template")

let entries = []
let runs = []
let systemLogs = []
const filters = { kinds: new Set(), tags: new Set(), needsInput: false }

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function markdown(summary) {
  const escaped = escapeHtml(summary)
  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br />")
}

function artifactHref(path) {
  return `/artifact/${path.split("/").map(encodeURIComponent).join("/")}`
}

function relativeTime(ts) {
  const date = new Date(ts)
  const ms = Date.now() - date.getTime()
  if (Number.isNaN(date.getTime())) return ts
  if (ms < 60_000) return "just now"
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function absoluteArtifactUrl(path) {
  return new URL(artifactHref(path), window.location.href).toString()
}

function isHtmlArtifact(artifact) {
  return typeof artifact.path === "string" && /\.html?$/i.test(artifact.path)
}

function renderArtifact(artifact, index) {
  const label = escapeHtml(artifact.label)
  const media = escapeHtml(artifact.media)
  const href = artifact.path ? artifactHref(artifact.path) : ""
  if (artifact.media === "embed" || isHtmlArtifact(artifact)) {
    const src = artifact.url || (artifact.path ? absoluteArtifactUrl(artifact.path) : "")
    if (!src) return ""
    return `<article class="artifact-card embed-card"><div class="artifact-title"><span>${label}</span><a href="${escapeHtml(src)}" target="_blank" rel="noreferrer">open full</a></div><iframe class="embed-frame" sandbox="allow-scripts allow-forms allow-same-origin" loading="lazy" src="${escapeHtml(src)}"></iframe></article>`
  }
  if (!artifact.path) return `<article class="artifact-card"><div class="artifact-title"><span>${label}</span><span>${media}</span></div></article>`
  if (artifact.media === "audio") {
    return `<article class="artifact-card waveform-card"><div class="artifact-title"><span>${label}</span><a href="${href}">open audio</a></div><div class="waveform-placeholder" data-src="${href}" data-label="${label}" id="waveform-${index}"></div></article>`
  }
  if (artifact.media === "video") {
    return `<article class="artifact-card"><video controls preload="metadata" src="${href}"></video><a class="artifact-link" href="${href}">${label}</a></article>`
  }
  if (artifact.media === "image") {
    return `<article class="artifact-card"><img class="artifact-image" src="${href}" alt="${label}" /><a class="artifact-link" href="${href}" target="_blank" rel="noreferrer">${label}</a></article>`
  }
  if (artifact.media === "markdown") {
    return `<article class="artifact-card markdown-inline" data-src="${href}" data-label="${label}"><div class="artifact-title"><span>${label}</span><a href="${href}" target="_blank" rel="noreferrer">open source</a></div><div class="inline-loading">Loading markdown…</div></article>`
  }
  if (artifact.media === "json") {
    return `<article class="artifact-card json-inline" data-src="${href}" data-label="${label}"><div class="artifact-title"><span>${label}</span><a href="${href}" target="_blank" rel="noreferrer">open source</a></div><div class="inline-loading">Loading json…</div></article>`
  }
  return `<a class="artifact-link" href="${href}" target="_blank" rel="noreferrer">${label} · ${media}</a>`
}

function latestRun(entryId, actionIndex) {
  return runs.find((run) => run.entryId === entryId && run.actionIndex === actionIndex) || null
}

function renderRunChip(entry, actionIndex) {
  const run = latestRun(entry.id, actionIndex)
  if (!run) return ""
  const exit = run.exitCode === undefined ? "" : ` ${run.exitCode}`
  return `<button class="run-chip ${run.status}" type="button" data-run-id="${escapeHtml(run.id)}">${escapeHtml(run.status)}${exit}<time datetime="${escapeHtml(run.end || run.start)}">${escapeHtml(relativeTime(run.end || run.start))}</time></button>`
}

function renderEntry(entry) {
  const article = document.createElement("article")
  const isQuestion = entry.kind === "question" || entry.needsInput
  article.className = `card ${isQuestion ? "question" : ""}`
  article.id = `entry-${entry.id}`

  const tags = entry.tags.length > 0
    ? `<div class="tags">${entry.tags.map((tag) => `<button class="tag" type="button" data-filter-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join("")}</div>`
    : ""
  const artifacts = entry.artifacts.length > 0
    ? `<div class="artifacts">${entry.artifacts.map((artifact, index) => renderArtifact(artifact, index)).join("")}</div>`
    : ""
  const links = entry.links.length > 0
    ? `<div class="links">${entry.links.map((link) => `<a class="link-pill" href="${escapeHtml(link.href)}" target="${link.href.startsWith("#") ? "_self" : "_blank"}" rel="noreferrer">${escapeHtml(link.label)}</a>`).join("")}</div>`
    : ""
  const actions = entry.actions.length > 0
    ? `<div class="actions">${entry.actions.map((action, index) => `<div class="action-pair"><button class="action-button" data-entry="${escapeHtml(entry.id)}" data-index="${index}">${escapeHtml(action.label)}</button>${renderRunChip(entry, index)}</div>`).join("")}</div>`
    : ""
  const answer = isQuestion
    ? `<form class="answer-form" data-entry="${escapeHtml(entry.id)}"><textarea name="summary" rows="3" placeholder="Answer in place"></textarea><button type="submit">Reply</button></form>`
    : ""

  article.innerHTML = `
    <div class="card-head">
      <div>
        <div class="title-row"><button class="kind" type="button" data-filter-kind="${escapeHtml(entry.kind)}">${escapeHtml(entry.kind)}</button><h2>${escapeHtml(entry.title)}</h2></div>
        ${entry.summary ? `<div class="summary"><p>${markdown(entry.summary)}</p></div>` : ""}
      </div>
      <time class="time" datetime="${escapeHtml(entry.ts)}">${escapeHtml(relativeTime(entry.ts))}</time>
    </div>
    ${artifacts}
    ${links}
    ${actions}
    ${tags}
    ${answer}
  `

  for (const button of article.querySelectorAll(".action-button")) {
    button.addEventListener("click", () => runAction(button, article))
  }
  for (const chip of article.querySelectorAll(".run-chip")) {
    chip.addEventListener("click", () => toggleRunLog(chip, article))
  }
  for (const tag of article.querySelectorAll("[data-filter-tag]")) {
    tag.addEventListener("click", () => {
      filters.tags.add(tag.dataset.filterTag)
      render()
    })
  }
  for (const kind of article.querySelectorAll("[data-filter-kind]")) {
    kind.addEventListener("click", () => {
      filters.kinds.add(kind.dataset.filterKind)
      render()
    })
  }
  for (const placeholder of article.querySelectorAll(".waveform-placeholder")) mountWaveform(placeholder)
  for (const markdownEl of article.querySelectorAll(".markdown-inline")) mountMarkdownInline(markdownEl)
  for (const jsonEl of article.querySelectorAll(".json-inline")) mountJsonInline(jsonEl)
  for (const form of article.querySelectorAll(".answer-form")) form.addEventListener("submit", submitAnswer)
  return article
}

function answeredIds() {
  const ids = new Set()
  for (const entry of entries) {
    if (entry.parentId) ids.add(entry.parentId)
  }
  return ids
}

function filteredEntries() {
  const answered = answeredIds()
  const visible = entries.filter((entry) => {
    if (filters.needsInput && !(entry.needsInput || entry.kind === "question")) return false
    for (const kind of filters.kinds) if (entry.kind !== kind) return false
    for (const tag of filters.tags) if (!entry.tags.includes(tag)) return false
    return true
  })
  return visible.sort((left, right) => {
    const leftPinned = (left.needsInput || left.kind === "question") && !answered.has(left.id)
    const rightPinned = (right.needsInput || right.kind === "question") && !answered.has(right.id)
    if (leftPinned === rightPinned) return 0
    return leftPinned ? -1 : 1
  })
}

function renderFilters() {
  needsFilterEl.setAttribute("aria-pressed", filters.needsInput ? "true" : "false")
  const chips = []
  for (const kind of filters.kinds) chips.push(`<button class="filter-chip" type="button" data-clear-kind="${escapeHtml(kind)}">kind ${escapeHtml(kind)} ×</button>`)
  for (const tag of filters.tags) chips.push(`<button class="filter-chip" type="button" data-clear-tag="${escapeHtml(tag)}">tag ${escapeHtml(tag)} ×</button>`)
  activeFiltersEl.innerHTML = chips.join("")
  for (const chip of activeFiltersEl.querySelectorAll("[data-clear-kind]")) {
    chip.addEventListener("click", () => {
      filters.kinds.delete(chip.dataset.clearKind)
      render()
    })
  }
  for (const chip of activeFiltersEl.querySelectorAll("[data-clear-tag]")) {
    chip.addEventListener("click", () => {
      filters.tags.delete(chip.dataset.clearTag)
      render()
    })
  }
}

function render() {
  renderFilters()
  const visibleEntries = filteredEntries()
  feedEl.replaceChildren()

  if (visibleEntries.length === 0) {
    feedEl.append(emptyTemplate.content.cloneNode(true))
    return
  }
  for (const entry of visibleEntries) feedEl.append(renderEntry(entry))
  updateRelativeTimes()
}

function renderSystemLog() {
  if (systemLogs.length === 0) {
    systemLogEl.innerHTML = '<p class="system-empty">No system warnings.</p>'
    return
  }
  systemLogEl.innerHTML = systemLogs.slice().reverse().map((entry) => `<div class="system-line ${escapeHtml(entry.level)}"><time datetime="${escapeHtml(entry.ts)}">${escapeHtml(relativeTime(entry.ts))}</time><span>${escapeHtml(entry.message)}</span></div>`).join("")
}

async function loadFeed() {
  const response = await fetch("/api/feed")
  if (!response.ok) throw new Error(`Feed request failed: ${response.status}`)
  const payload = await response.json()
  entries = payload.entries
  runs = payload.runs || []
  systemLogs = payload.systemLog || []
  statusEl.textContent = `${entries.length} entries loaded.`
  renderSystemLog()
  render()
}

async function runAction(button, article) {
  const pair = button.closest(".action-pair")
  button.disabled = true
  try {
    const response = await fetch(`/api/actions/${encodeURIComponent(button.dataset.entry)}/${button.dataset.index}`, { method: "POST" })
    const runId = response.headers.get("x-xanadu-run-id")
    const pane = ensureRunPane(article, runId || "pending")
    pane.textContent = response.ok ? "" : `HTTP ${response.status}\n`
    const reader = response.body?.getReader()
    if (!reader) {
      pane.textContent += await response.text()
      return
    }
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      pane.textContent += decoder.decode(value, { stream: true })
      pane.scrollTop = pane.scrollHeight
    }
    pane.textContent += decoder.decode()
    await refreshRuns()
  } catch (error) {
    const pane = ensureRunPane(article, "error")
    pane.textContent += `\n${error instanceof Error ? error.message : String(error)}\n`
  } finally {
    button.disabled = false
    if (pair) pair.classList.remove("running")
  }
}

function ensureRunPane(article, runId) {
  let pane = article.querySelector(`.run-log[data-run-id="${CSS.escape(runId)}"]`)
  if (!pane) {
    pane = document.createElement("pre")
    pane.className = "run-log visible"
    pane.dataset.runId = runId
    article.append(pane)
  }
  return pane
}

async function toggleRunLog(chip, article) {
  const runId = chip.dataset.runId
  let pane = article.querySelector(`.run-log[data-run-id="${CSS.escape(runId)}"]`)
  if (pane) {
    pane.remove()
    return
  }
  pane = ensureRunPane(article, runId)
  pane.textContent = "Loading run log…"
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`)
  pane.textContent = response.ok ? await response.text() : `Unable to load run ${runId}: HTTP ${response.status}`
}

async function refreshRuns() {
  const response = await fetch("/api/runs")
  if (!response.ok) return
  const payload = await response.json()
  runs = payload.runs || []
  render()
}

async function submitAnswer(event) {
  event.preventDefault()
  const form = event.currentTarget
  const textarea = form.querySelector("textarea")
  const summary = textarea.value.trim()
  if (!summary) return
  const button = form.querySelector("button")
  button.disabled = true
  try {
    const response = await fetch(`/api/entries/${encodeURIComponent(form.dataset.entry)}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary }),
    })
    if (!response.ok) throw new Error(await response.text())
    textarea.value = ""
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : String(error)
  } finally {
    button.disabled = false
  }
}

async function mountMarkdownInline(el) {
  try {
    const response = await fetch(el.dataset.src)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    el.querySelector(".inline-loading").outerHTML = `<details open><summary>${escapeHtml(el.dataset.label)}</summary><div class="markdown-body"><p>${markdown(text)}</p></div></details>`
  } catch (error) {
    el.querySelector(".inline-loading").textContent = error instanceof Error ? error.message : String(error)
  }
}

async function mountJsonInline(el) {
  try {
    const response = await fetch(el.dataset.src)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const value = await response.json()
    el.querySelector(".inline-loading").outerHTML = `<details><summary>${escapeHtml(el.dataset.label)}</summary><pre class="json-pre">${escapeHtml(JSON.stringify(value, null, 2))}</pre></details>`
  } catch (error) {
    el.querySelector(".inline-loading").textContent = error instanceof Error ? error.message : String(error)
  }
}

async function mountWaveform(el) {
  const audio = new Audio(el.dataset.src)
  audio.preload = "metadata"
  const button = document.createElement("button")
  button.className = "waveform-play"
  button.type = "button"
  button.textContent = "Play"
  const canvas = document.createElement("canvas")
  canvas.width = 900
  canvas.height = 120
  canvas.className = "waveform"
  el.replaceChildren(button, canvas, audio)
  button.addEventListener("click", () => {
    if (audio.paused) {
      void audio.play()
      button.textContent = "Pause"
    } else {
      audio.pause()
      button.textContent = "Play"
    }
  })
  audio.addEventListener("pause", () => { button.textContent = "Play" })
  audio.addEventListener("play", () => { button.textContent = "Pause" })
  canvas.addEventListener("click", (event) => {
    if (!Number.isFinite(audio.duration)) return
    audio.currentTime = (event.offsetX / canvas.clientWidth) * audio.duration
  })
  audio.addEventListener("timeupdate", () => drawPlayhead(canvas, audio))
  try {
    const response = await fetch(el.dataset.src)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const context = new AudioContext()
    const buffer = await context.decodeAudioData(await response.arrayBuffer())
    audio._xanaduBuffer = buffer
    drawWaveform(canvas, buffer)
    await context.close()
  } catch (error) {
    const ctx = canvas.getContext("2d")
    ctx.fillStyle = "#f87171"
    ctx.fillText(error instanceof Error ? error.message : String(error), 20, 64)
  }
}

function drawWaveform(canvas, buffer) {
  const ctx = canvas.getContext("2d")
  const width = canvas.width
  const height = canvas.height
  const data = buffer.getChannelData(0)
  const step = Math.max(1, Math.floor(data.length / width))
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = "#071018"
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = "#79ffe1"
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = 0; x < width; x += 1) {
    let peak = 0
    const offset = x * step
    for (let i = 0; i < step && offset + i < data.length; i += 1) {
      const sample = Math.abs(data[offset + i])
      if (sample > peak) peak = sample
    }
    const y = peak * (height / 2 - 8)
    ctx.moveTo(x, height / 2 - y)
    ctx.lineTo(x, height / 2 + y)
  }
  ctx.stroke()
}

function drawPlayhead(canvas, audio) {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return
  drawWaveform(canvas, audio._xanaduBuffer || { getChannelData: () => new Float32Array(0) })
  const ctx = canvas.getContext("2d")
  const x = (audio.currentTime / audio.duration) * canvas.width
  ctx.strokeStyle = "#f8fafc"
  ctx.beginPath()
  ctx.moveTo(x, 0)
  ctx.lineTo(x, canvas.height)
  ctx.stroke()
}

function updateRelativeTimes() {
  for (const timeEl of document.querySelectorAll("time[datetime]")) {
    timeEl.textContent = relativeTime(timeEl.dateTime)
  }
}

needsFilterEl.addEventListener("click", () => {
  filters.needsInput = !filters.needsInput
  render()
})
systemToggleEl.addEventListener("click", () => {
  systemLogEl.hidden = !systemLogEl.hidden
  renderSystemLog()
})

try {
  await loadFeed()
} catch (error) {
  statusEl.textContent = error instanceof Error ? error.message : String(error)
}

const events = new EventSource("/api/events")
events.addEventListener("open", () => {
  statusEl.textContent = `${entries.length} entries loaded. Live updates connected.`
})
events.addEventListener("feed", (event) => {
  const payload = JSON.parse(event.data)
  entries = payload.entries
  runs = payload.runs || runs
  systemLogs = payload.systemLog || systemLogs
  statusEl.textContent = `${entries.length} entries loaded. Live updates connected.`
  renderSystemLog()
  render()
})
events.addEventListener("run", (event) => {
  const payload = JSON.parse(event.data)
  runs = payload.runs || runs
  render()
})
events.addEventListener("failure", (event) => {
  const payload = JSON.parse(event.data)
  statusEl.textContent = `Action failed: ${payload.run.id}`
})
events.addEventListener("system", (event) => {
  const payload = JSON.parse(event.data)
  systemLogs = payload.logs || systemLogs
  renderSystemLog()
})
events.addEventListener("error", () => {
  statusEl.textContent = "Live updates disconnected; retrying."
})

setInterval(updateRelativeTimes, 15_000)

const feedEl = document.querySelector("#feed")
const statusEl = document.querySelector("#status")
const needsFilterEl = document.querySelector("#needs-filter")
const emptyTemplate = document.querySelector("#empty-template")

let entries = []

function escapeHtml(value) {
  return value
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

function formatTime(ts) {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function renderArtifact(artifact) {
  const href = artifactHref(artifact.path)
  if (artifact.media === "audio") {
    return `<div><audio controls preload="metadata" src="${href}"></audio><a class="artifact-link" href="${href}">${escapeHtml(artifact.label)}</a></div>`
  }
  if (artifact.media === "video") {
    return `<div><video controls preload="metadata" src="${href}"></video><a class="artifact-link" href="${href}">${escapeHtml(artifact.label)}</a></div>`
  }
  return `<a class="artifact-link" href="${href}" target="_blank" rel="noreferrer">${escapeHtml(artifact.label)} · ${escapeHtml(artifact.media)}</a>`
}

function renderEntry(entry) {
  const article = document.createElement("article")
  article.className = `card ${entry.kind === "question" || entry.needsInput ? "question" : ""}`

  const tags = entry.tags.length > 0
    ? `<div class="tags">${entry.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
    : ""
  const artifacts = entry.artifacts.length > 0
    ? `<div class="artifacts">${entry.artifacts.map(renderArtifact).join("")}</div>`
    : ""
  const links = entry.links.length > 0
    ? `<div class="links">${entry.links.map((link) => `<a class="link-pill" href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>`).join("")}</div>`
    : ""
  const actions = entry.actions.length > 0
    ? `<div class="actions">${entry.actions.map((action, index) => `<button class="action-button" data-entry="${escapeHtml(entry.id)}" data-index="${index}">${escapeHtml(action.label)}</button>`).join("")}</div><pre class="output" aria-live="polite"></pre>`
    : ""

  article.innerHTML = `
    <div class="card-head">
      <div>
        <div class="title-row"><span class="kind">${escapeHtml(entry.kind)}</span><h2>${escapeHtml(entry.title)}</h2></div>
        ${entry.summary ? `<div class="summary"><p>${markdown(entry.summary)}</p></div>` : ""}
      </div>
      <time class="time" datetime="${escapeHtml(entry.ts)}">${escapeHtml(formatTime(entry.ts))}</time>
    </div>
    ${artifacts}
    ${links}
    ${actions}
    ${tags}
  `

  for (const button of article.querySelectorAll(".action-button")) {
    button.addEventListener("click", () => runAction(button, article))
  }
  return article
}

function render() {
  const onlyNeeds = needsFilterEl.checked
  const visibleEntries = onlyNeeds ? entries.filter((entry) => entry.needsInput || entry.kind === "question") : entries
  feedEl.replaceChildren()

  if (visibleEntries.length === 0) {
    feedEl.append(emptyTemplate.content.cloneNode(true))
    return
  }
  for (const entry of visibleEntries) feedEl.append(renderEntry(entry))
}

async function loadFeed() {
  const response = await fetch("/api/feed")
  if (!response.ok) throw new Error(`Feed request failed: ${response.status}`)
  const payload = await response.json()
  entries = payload.entries
  statusEl.textContent = `${entries.length} entries loaded.`
  render()
}

async function runAction(button, article) {
  const output = article.querySelector(".output")
  output.classList.add("visible")
  output.textContent = ""
  button.disabled = true
  try {
    const response = await fetch(`/api/actions/${encodeURIComponent(button.dataset.entry)}/${button.dataset.index}`, { method: "POST" })
    output.textContent += response.ok ? "" : `HTTP ${response.status}\n`
    const reader = response.body?.getReader()
    if (!reader) {
      output.textContent += await response.text()
      return
    }
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      output.textContent += decoder.decode(value, { stream: true })
      output.scrollTop = output.scrollHeight
    }
    output.textContent += decoder.decode()
  } catch (error) {
    output.textContent += `\n${error instanceof Error ? error.message : String(error)}\n`
  } finally {
    button.disabled = false
  }
}

needsFilterEl.addEventListener("change", render)

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
  statusEl.textContent = `${entries.length} entries loaded. Live updates connected.`
  render()
})
events.addEventListener("error", () => {
  statusEl.textContent = "Live updates disconnected; retrying."
})

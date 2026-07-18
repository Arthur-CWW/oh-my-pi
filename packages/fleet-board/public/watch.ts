export interface FleetSession {
  readonly sessionId: string;
  readonly name: string;
  readonly state: string;
  readonly workstream: string;
  readonly objective: string;
  readonly summary: string;
  readonly spawnName: string;
  readonly todoHead: string;
  readonly lastSeen: string;
  readonly cwd: string;
  readonly pid: number | null;
  readonly journal: string;
  readonly version: string;
  readonly digest: string;
}

export interface FleetEnvelope {
  readonly generatedAt: string;
  readonly sessions: readonly FleetSession[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstString(record: Record<string, unknown>, keys: readonly string[], fallback = ""): string {
  for (const key of keys) {
    const value = asString(record[key]);
    if (value !== undefined) return value;
  }
  return fallback;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function labelRecord(record: Record<string, unknown>): Record<string, unknown> {
  const labels = record.labels;
  return isRecord(labels) ? labels : {};
}

export function normalizeSession(value: unknown): FleetSession | null {
  if (!isRecord(value)) return null;
  const labels = labelRecord(value);
  const labelOrRow = (keys: readonly string[], fallback = ""): string => {
    const direct = firstString(value, keys);
    return direct || firstString(labels, keys, fallback);
  };
  const sessionId = firstString(value, ["session_id", "sessionId", "id"]);
  if (!sessionId) return null;

  return {
    sessionId,
    name: labelOrRow(["name", "display_name"], sessionId),
    state: labelOrRow(["state", "status"], "unknown"),
    workstream: labelOrRow(["workstream"]),
    objective: labelOrRow(["objective"]),
    summary: labelOrRow(["summary", "observer_summary"]),
    spawnName: labelOrRow(["spawnName", "spawn_name"]),
    todoHead: labelOrRow(["todo_head", "todoHead"]),
    lastSeen: labelOrRow(["last_seen", "lastSeen"]),
    cwd: labelOrRow(["cwd"]),
    pid: asNumber(value.pid) ?? asNumber(labels.pid),
    journal: labelOrRow(["session_journal", "sessionJournal", "journal"]),
    version: labelOrRow(["version", "client_version", "server_version"]),
    digest: labelOrRow(["digest", "build_digest", "buildDigest", "version_digest"]),
  };
}

export function normalizeFleet(value: unknown): FleetEnvelope {
  const record = isRecord(value) ? value : {};
  const rawSessions = Array.isArray(record.sessions) ? record.sessions : Array.isArray(value) ? value : [];
  const sessions: FleetSession[] = [];
  for (const item of rawSessions) {
    const session = normalizeSession(item);
    if (session) sessions.push(session);
  }
  return {
    generatedAt: firstString(record, ["generatedAt", "generated_at"]),
    sessions,
  };
}

export function sessionIdFromHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded || null;
  } catch {
    return raw.trim() || null;
  }
}

export function hashForSession(sessionId: string): string {
  return `#${encodeURIComponent(sessionId)}`;
}

export function selectSessionId(
  sessions: readonly FleetSession[],
  hash: string,
  previousId: string | null = null,
): string | null {
  const ids = new Set(sessions.map(session => session.sessionId));
  const fromHash = sessionIdFromHash(hash);
  if (fromHash && ids.has(fromHash)) return fromHash;
  if (previousId && ids.has(previousId)) return previousId;
  return sessions[0]?.sessionId ?? null;
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) break;
    if (/^\s*```/.test(line)) {
      const language = line.replace(/^\s*```/, "").trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      const className = language ? ` class="language-${escapeHtml(language)}"` : "";
      output.push(`<pre><code${className}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      output.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`);
      index += 1;
      continue;
    }

    const listMarker = line.match(/^\s*([-*+])\s+(.+)$/) ?? line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (listMarker) {
      const ordered = /^\d+$/.test(listMarker[1] ?? "");
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const match = ordered
          ? current.match(/^\s*\d+[.)]\s+(.+)$/)
          : current.match(/^\s*[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(`<li>${renderInline(match[1] ?? "")}</li>`);
        index += 1;
      }
      output.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (
        current.trim() === "" ||
        /^\s*```/.test(current) ||
        /^\s{0,3}#{1,6}\s+/.test(current) ||
        /^\s*[-*+]\s+/.test(current) ||
        /^\s*\d+[.)]\s+/.test(current)
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    if (paragraph.length > 0) output.push(`<p>${renderInline(paragraph.join("\n"))}</p>`);
  }

  return output.join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHref(value: string): string | null {
  const href = value.trim();
  if (!href || /[\u0000-\u001f]/.test(href)) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^(?:https?:|mailto:|history:|omp:)/i.test(href)) return null;
  if (/^(?:https?:|mailto:|history:|omp:)/i.test(href) || /^(?:[./]|#)/.test(href) || !href.includes(":")) {
    return href;
  }
  return null;
}

function renderInline(value: string): string {
  const token = /`([^`\n]*)`|\[([^\]\n]+)\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
  let cursor = 0;
  let output = "";
  let match: RegExpExecArray | null;
  while ((match = token.exec(value)) !== null) {
    output += escapeHtml(value.slice(cursor, match.index));
    if (match[1] !== undefined) {
      output += `<code>${escapeHtml(match[1])}</code>`;
    } else {
      const label = escapeHtml(match[2] ?? "");
      const href = safeHref(match[3] ?? "");
      output += href === null ? label : `<a href="${escapeHtml(href)}">${label}</a>`;
    }
    cursor = match.index + match[0].length;
  }
  return output + escapeHtml(value.slice(cursor));
}

interface WatchDom {
  readonly layout: HTMLElement;
  readonly rail: HTMLElement;
  readonly sessionCount: HTMLElement;
  readonly main: HTMLElement;
  readonly empty: HTMLElement;
  readonly view: HTMLElement;
  readonly refreshStatus: HTMLElement;
  readonly detailStateDot: HTMLElement;
  readonly detailState: HTMLElement;
  readonly detailName: HTMLElement;
  readonly detailId: HTMLElement;
  readonly detailLastSeen: HTMLElement;
  readonly historyUri: HTMLElement;
  readonly labelCommand: HTMLElement;
  readonly labelFields: HTMLElement;
  readonly journal: HTMLElement;
  readonly cwd: HTMLElement;
  readonly version: HTMLElement;
  readonly digest: HTMLElement;
  readonly docVersion: HTMLElement;
  readonly doc: HTMLElement;
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`watch UI is missing #${id}`);
  return element as T;
}

function getDom(): WatchDom {
  const layout = document.querySelector<HTMLElement>(".watch-layout");
  const rail = getElement<HTMLElement>("session-list");
  if (!layout) throw new Error("watch UI is missing .watch-layout");
  return {
    layout,
    rail,
    sessionCount: getElement("session-count"),
    main: getElement("watch-main"),
    empty: getElement("empty-state"),
    view: getElement("session-view"),
    refreshStatus: getElement("refresh-status"),
    detailStateDot: getElement("detail-state-dot"),
    detailState: getElement("detail-state"),
    detailName: getElement("detail-name"),
    detailId: getElement("detail-id"),
    detailLastSeen: getElement("detail-last-seen"),
    historyUri: getElement("history-uri"),
    labelCommand: getElement("label-command"),
    labelFields: getElement("label-fields"),
    journal: getElement("detail-journal"),
    cwd: getElement("detail-cwd"),
    version: getElement("detail-version"),
    digest: getElement("detail-digest"),
    docVersion: getElement("doc-version"),
    doc: getElement("state-doc"),
  };
}

function setText(element: HTMLElement, value: string, fallback = "—"): void {
  element.textContent = value || fallback;
}

function displayTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function sessionStateClass(state: string): string {
  return state.trim().toLowerCase().replaceAll("-", "_");
}

function renderLabelFields(target: HTMLElement, session: FleetSession): void {
  target.replaceChildren();
  const fields: readonly [string, string][] = [
    ["workstream", session.workstream],
    ["objective", session.objective],
    ["summary", session.summary],
    ["spawn name", session.spawnName],
    ["todo", session.todoHead],
  ];
  for (const [name, value] of fields) {
    if (!value) continue;
    const wrapper = document.createElement("div");
    const title = document.createElement("dt");
    title.textContent = name;
    const detail = document.createElement("dd");
    detail.textContent = value;
    wrapper.append(title, detail);
    target.append(wrapper);
  }
  if (target.childElementCount === 0) {
    const empty = document.createElement("div");
    empty.textContent = "No labels reported.";
    empty.className = "doc-placeholder";
    target.append(empty);
  }
}

function reportClientError(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  try {
    void fetch("/client-error", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, source: "fleet-board/watch" }),
    }).catch(() => undefined);
  } catch {
    // Reporting must never create a second browser error.
  }
}

async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the textarea path for local/browser compatibility.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

async function fetchFleet(): Promise<FleetEnvelope> {
  const response = await fetch("/api/fleet", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`fleet request failed (${response.status})`);
  return normalizeFleet(await response.json());
}

async function fetchStateDoc(sessionId: string): Promise<string | null> {
  const response = await fetch(`/api/statedoc/${encodeURIComponent(sessionId)}`, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`state document request failed (${response.status})`);
  const body: unknown = await response.json();
  return isRecord(body) && typeof body.markdown === "string" ? body.markdown : "";
}

function startWatchApp(): void {
  const dom = getDom();
  let sessions: FleetSession[] = [];
  let selectedId = sessionIdFromHash(window.location.hash);
  let requestNumber = 0;
  let refreshInFlight = false;


  const syncHash = (): void => {
    if (selectedId && sessionIdFromHash(window.location.hash) !== selectedId) {
      window.history.replaceState(null, "", hashForSession(selectedId));
    }
  };

  const renderList = (): void => {
    dom.sessionCount.textContent = String(sessions.length);
    dom.rail.replaceChildren();
    if (sessions.length === 0) {
      const empty = document.createElement("p");
      empty.className = "rail-empty";
      empty.textContent = "No sessions reported.";
      dom.rail.append(empty);
      return;
    }
    for (const session of sessions) {
      const button = document.createElement("button");
      button.className = "session-item";
      button.type = "button";
      button.role = "option";
      button.ariaSelected = String(session.sessionId === selectedId);
      button.title = session.sessionId;

      const top = document.createElement("span");
      top.className = "session-item-top";
      const dot = document.createElement("span");
      dot.className = "state-dot";
      dot.dataset.state = sessionStateClass(session.state);
      dot.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.className = "session-item-name";
      name.textContent = session.name;
      const state = document.createElement("span");
      state.className = "session-item-state";
      state.textContent = session.state;
      top.append(dot, name, state);
      button.append(top);
      if (session.summary) {
        const summary = document.createElement("span");
        summary.className = "session-item-summary";
        summary.textContent = session.summary;
        button.append(summary);
      }
      button.addEventListener("click", () => {
        if (selectedId === session.sessionId) {
          dom.main.focus({ preventScroll: true });
          return;
        }
        window.location.hash = hashForSession(session.sessionId);
      });
      dom.rail.append(button);
    }
  };

  const renderSession = (session: FleetSession | null): void => {
    dom.empty.hidden = session !== null;
    dom.view.hidden = session === null;
    if (!session) return;
    dom.detailStateDot.dataset.state = sessionStateClass(session.state);
    setText(dom.detailState, session.state, "unknown");
    setText(dom.detailName, session.name, session.sessionId);
    setText(dom.detailId, session.sessionId);
    setText(dom.detailLastSeen, displayTime(session.lastSeen));
    dom.historyUri.textContent = `history://${session.sessionId}`;
    dom.labelCommand.textContent = `omp fleet label ${shellQuote(session.sessionId)} --summary ${shellQuote(session.summary || "<summary>")}`;
    renderLabelFields(dom.labelFields, session);
    setText(dom.journal, session.journal);
    setText(dom.cwd, session.cwd);
    setText(dom.version, session.version);
    setText(dom.digest, session.digest, "not reported");
  };

  const loadDocument = async (session: FleetSession, restoreScrollTop: number): Promise<void> => {
    const currentRequest = ++requestNumber;
    dom.docVersion.textContent = session.version ? `version ${session.version}` : "live";
    dom.doc.innerHTML = '<p class="doc-placeholder">Loading state document…</p>';
    try {
      const markdown = await fetchStateDoc(session.sessionId);
      if (currentRequest !== requestNumber || selectedId !== session.sessionId) return;
      if (markdown === null) {
        dom.doc.innerHTML = '<p class="doc-placeholder">No state document found for this session.</p>';
      } else {
        dom.doc.innerHTML = renderMarkdown(markdown);
        if (!dom.doc.innerHTML) dom.doc.innerHTML = '<p class="doc-placeholder">State document is empty.</p>';
      }
      dom.main.scrollTop = restoreScrollTop;
      window.requestAnimationFrame(() => { dom.main.scrollTop = restoreScrollTop; });
    } catch (error) {
      if (currentRequest !== requestNumber || selectedId !== session.sessionId) return;
      dom.doc.innerHTML = '<p class="doc-error">State document could not be loaded. The next refresh will retry.</p>';
      reportClientError(error);
    }
  };

  const refresh = async (): Promise<void> => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    const scrollTop = dom.main.scrollTop;
    const previousId = selectedId;
    try {
      const fleet = await fetchFleet();
      sessions = [...fleet.sessions];
      selectedId = selectSessionId(sessions, window.location.hash, previousId);
      syncHash();
      renderList();
      const session = sessions.find(candidate => candidate.sessionId === selectedId) ?? null;
      renderSession(session);
      if (session) await loadDocument(session, scrollTop);
      dom.refreshStatus.dataset.error = "false";
      dom.refreshStatus.textContent = fleet.generatedAt ? `Updated ${displayTime(fleet.generatedAt)}` : "Live · 5s";
    } catch (error) {
      dom.refreshStatus.dataset.error = "true";
      dom.refreshStatus.textContent = "Fleet unavailable · retrying";
      reportClientError(error);
      if (sessions.length === 0) renderList();
    } finally {
      refreshInFlight = false;
    }
  };

  const handleRoute = async (): Promise<void> => {
    const nextId = selectSessionId(sessions, window.location.hash, selectedId);
    if (nextId === selectedId) {
      renderList();
      renderSession(sessions.find(candidate => candidate.sessionId === selectedId) ?? null);
      return;
    }
    selectedId = nextId;
    syncHash();
    renderList();
    const session = sessions.find(candidate => candidate.sessionId === selectedId) ?? null;
    renderSession(session);
    if (session) await loadDocument(session, 0);
  };

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy-target]")) {
    button.addEventListener("click", async () => {
      const targetId = button.dataset.copyTarget;
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) return;
      const copied = await copyText(target.textContent ?? "");
      button.dataset.copied = String(copied);
      button.textContent = copied ? "Copied" : "Copy failed";
      window.setTimeout(() => {
        button.textContent = "Copy";
        button.dataset.copied = "false";
      }, 1400);
    });
  }

  window.addEventListener("hashchange", () => { void handleRoute().catch(reportClientError); });
  window.addEventListener("error", event => reportClientError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", event => reportClientError(event.reason));
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? window.innerWidth;
      dom.layout.dataset.layout = width < 600 ? "stacked" : width < 900 ? "narrow" : "wide";
    });
    observer.observe(dom.layout);
  }
  void refresh();
  window.setInterval(() => { void refresh(); }, 5000);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startWatchApp, { once: true });
  } else {
    startWatchApp();
  }
}

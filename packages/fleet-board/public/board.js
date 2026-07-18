// public/board.ts
var BOARD_COLUMNS = [
  "needs-arthur",
  "in-progress",
  "held-deferred",
  "recently-implemented"
];
var BOARD_COLUMN_LABELS = {
  "needs-arthur": "Needs Arthur",
  "in-progress": "In Progress",
  "held-deferred": "Held / Deferred",
  "recently-implemented": "Recently Implemented"
};
function text(value, fallback = "") {
  if (typeof value !== "string")
    return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}
function normalized(value) {
  return text(value).toUpperCase().replace(/[\-_]+/g, " ").replace(/\s+/g, " ").trim();
}
function columnForRegisterStatus(status) {
  const value = normalized(status);
  if (value.includes("IMPLEMENTED") || value === "DONE" || value === "COMPLETE") {
    return "recently-implemented";
  }
  if (value.includes("IN PROGRESS") || value === "WORKING") {
    return "in-progress";
  }
  if (value.includes("REQUESTED") || value.includes("AWAITING") || value.includes("NEEDS ARTHUR") || value === "OPEN") {
    return "needs-arthur";
  }
  if (value.includes("HELD") || value.includes("DEFERRED") || value.includes("BLOCKED") || value.includes("PAUSED")) {
    return "held-deferred";
  }
  return "held-deferred";
}
function columnForSessionState(state) {
  const value = normalized(state);
  if (value === "WAITING INPUT" || value === "WAITING FOR INPUT" || value === "AWAITING INPUT") {
    return "needs-arthur";
  }
  if (value === "WORKING" || value === "RUNNING" || value === "ACTIVE" || value === "IN PROGRESS") {
    return "in-progress";
  }
  if (value === "IMPLEMENTED" || value === "DONE" || value === "COMPLETED" || value === "SUCCESS") {
    return "recently-implemented";
  }
  return "held-deferred";
}
function modalVersion(sessions) {
  const counts = new Map;
  let winner = null;
  let winnerCount = 0;
  for (const session of sessions) {
    const version = text(session.version);
    if (!version)
      continue;
    const count = (counts.get(version) ?? 0) + 1;
    counts.set(version, count);
    if (count > winnerCount) {
      winner = version;
      winnerCount = count;
    }
  }
  return winner;
}
function isVersionSkewed(version, modal) {
  const current = text(version);
  const common = text(modal);
  return current.length > 0 && common.length > 0 && current !== common;
}
function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1000000000000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
function formatFreshness(value, now = Date.now()) {
  const seen = timestampMs(value);
  if (seen === null)
    return { label: "last seen unknown", tone: "unknown" };
  const age = Math.max(0, now - seen);
  const minutes = Math.floor(age / 60000);
  if (minutes < 2)
    return { label: "just now", tone: "fresh" };
  if (minutes < 60)
    return { label: `${minutes}m ago`, tone: "fresh" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return { label: `${hours}h ago`, tone: "aging" };
  const days = Math.floor(hours / 24);
  return { label: `${days}d ago`, tone: "stale" };
}
function sessionItem(session, commonVersion) {
  const freshness = formatFreshness(session.last_seen);
  return {
    key: `session:${session.session_id}`,
    kind: "session",
    column: columnForSessionState(session.state),
    sessionId: session.session_id,
    name: text(session.name, text(session.spawnName, session.session_id)),
    workstream: text(session.workstream, "unassigned"),
    summary: text(session.summary, text(session.objective, "No observer summary yet.")),
    todoHead: text(session.todo_head, "No active todo"),
    state: text(session.state, "unknown").toLowerCase(),
    version: text(session.version, "unknown"),
    skew: isVersionSkewed(session.version, commonVersion),
    lastSeen: session.last_seen ?? null,
    freshness: freshness.label,
    freshnessTone: freshness.tone
  };
}
function registerItem(card) {
  return {
    key: `card:${card.id}`,
    kind: "register",
    column: columnForRegisterStatus(card.status),
    id: card.id,
    intent: text(card.intent, "Untitled request"),
    status: text(card.status, "UNKNOWN"),
    phase: text(card.phase, "unphased")
  };
}
function registerIdNumber(id) {
  const match = /(?:HR[-_])?(\d+)/i.exec(id);
  return match ? Number.parseInt(match[1], 10) : -1;
}
function emptyColumns() {
  return {
    "needs-arthur": [],
    "in-progress": [],
    "held-deferred": [],
    "recently-implemented": []
  };
}
function buildBoardModel(sessions = [], cards = []) {
  const commonVersion = modalVersion(sessions);
  const columns = emptyColumns();
  const items = {};
  for (const session of sessions) {
    if (!session.session_id)
      continue;
    const item = sessionItem(session, commonVersion);
    columns[item.column].push(item);
    items[item.key] = item;
  }
  for (const card of cards) {
    if (!card.id)
      continue;
    const item = registerItem(card);
    columns[item.column].push(item);
    items[item.key] = item;
  }
  columns["recently-implemented"].sort((a, b) => {
    if (a.kind === "register" && b.kind === "register")
      return registerIdNumber(b.id) - registerIdNumber(a.id);
    if (a.kind === "register")
      return -1;
    if (b.kind === "register")
      return 1;
    return 0;
  });
  return { modalVersion: commonVersion, columns, items };
}
function itemFieldValues(item) {
  if (item.kind === "session") {
    return {
      name: item.name,
      workstream: item.workstream,
      summary: item.summary,
      todoHead: item.todoHead,
      state: item.state,
      version: item.version,
      skew: item.skew,
      freshness: item.freshness,
      freshnessTone: item.freshnessTone,
      lastSeen: item.lastSeen
    };
  }
  return { id: item.id, intent: item.intent, phase: item.phase, status: item.status };
}
function itemPosition(model, key) {
  const item = model.items[key];
  if (!item)
    return null;
  const index = model.columns[item.column].findIndex((candidate) => candidate.key === key);
  return { column: item.column, index };
}
function allKeys(model) {
  return BOARD_COLUMNS.flatMap((column) => model.columns[column].map((item) => item.key));
}
function diffBoardModels(previous, next) {
  if (!previous) {
    return BOARD_COLUMNS.flatMap((column) => next.columns[column].map((item, index) => ({ op: "insert", key: item.key, item, column, index })));
  }
  const patches = [];
  const nextKeys = new Set(allKeys(next));
  for (const key of allKeys(previous)) {
    if (!nextKeys.has(key)) {
      const position = itemPosition(previous, key);
      if (position)
        patches.push({ op: "remove", key, ...position });
    }
  }
  const previousKeys = new Set(allKeys(previous));
  for (const column of BOARD_COLUMNS) {
    for (const [index, item] of next.columns[column].entries()) {
      if (!previousKeys.has(item.key)) {
        patches.push({ op: "insert", key: item.key, item, column, index });
        continue;
      }
      const oldPosition = itemPosition(previous, item.key);
      if (!oldPosition || oldPosition.column !== column || oldPosition.index !== index) {
        patches.push({ op: "move", key: item.key, column, index });
      }
      const oldItem = previous.items[item.key];
      const oldFields = itemFieldValues(oldItem);
      const newFields = itemFieldValues(item);
      const fields = Object.keys(newFields).filter((field) => oldFields[field] !== newFields[field]);
      if (fields.length)
        patches.push({ op: "update", key: item.key, fields });
    }
  }
  return patches;
}
function createSessionCard(item) {
  const card = document.createElement("article");
  card.className = "board-card session-card";
  card.dataset.key = item.key;
  card.dataset.kind = "session";
  card.innerHTML = `<a class="card-link" href="watch.html#${encodeURIComponent(item.sessionId)}">
    <div class="card-topline"><span class="card-type">SESSION</span><span class="state-label"><i data-field="state-dot" class="state-dot"></i><span data-field="state"></span></span></div>
    <div class="card-title" data-field="name"></div>
    <span class="workstream-chip" data-field="workstream"></span>
    <p class="card-summary" data-field="summary"></p>
    <div class="card-todo"><span class="muted-label">TODO</span><span data-field="todoHead"></span></div>
    <div class="card-meta"><span data-field="version" class="version-label"></span><span data-field="skew" class="skew-badge" hidden>VERSION SKEW</span><time data-field="freshness"></time></div>
  </a>`;
  updateSessionCard(card, item);
  return card;
}
function createRegisterCard(item) {
  const card = document.createElement("article");
  card.className = "board-card register-card";
  card.dataset.key = item.key;
  card.dataset.kind = "register";
  card.innerHTML = `<div class="card-topline"><span class="card-type">REGISTER</span><span data-field="status" class="register-status"></span></div>
    <div class="register-id" data-field="id"></div><p class="card-summary" data-field="intent"></p>
    <div class="card-meta"><span class="muted-label">PHASE</span><span data-field="phase"></span></div>`;
  updateRegisterCard(card, item);
  return card;
}
function field(node, name) {
  return node.querySelector(`[data-field="${name}"]`);
}
function setText(node, name, value) {
  const target = field(node, name);
  if (target && target.textContent !== value)
    target.textContent = value;
}
function updateSessionCard(node, item, fields) {
  const changed = fields ? new Set(fields) : null;
  const should = (name) => changed === null || changed.has(name);
  if (should("name"))
    setText(node, "name", item.name);
  if (should("workstream"))
    setText(node, "workstream", item.workstream);
  if (should("summary"))
    setText(node, "summary", item.summary);
  if (should("todoHead"))
    setText(node, "todoHead", item.todoHead);
  if (should("state")) {
    setText(node, "state", item.state);
    const dot = field(node, "state-dot");
    if (dot)
      dot.className = `state-dot state-${item.state.replace(/[^a-z0-9]+/g, "-")}`;
  }
  if (should("version"))
    setText(node, "version", `VERSION ${item.version}`);
  if (should("skew")) {
    const badge = field(node, "skew");
    if (badge)
      badge.hidden = !item.skew;
  }
  if (should("freshness") || should("freshnessTone")) {
    setText(node, "freshness", item.freshness);
    const time = field(node, "freshness");
    if (time)
      time.className = `freshness ${item.freshnessTone}`;
  }
}
function updateRegisterCard(node, item, fields) {
  const changed = fields ? new Set(fields) : null;
  const should = (name) => changed === null || changed.has(name);
  if (should("id"))
    setText(node, "id", item.id);
  if (should("intent"))
    setText(node, "intent", item.intent);
  if (should("phase"))
    setText(node, "phase", item.phase);
  if (should("status"))
    setText(node, "status", item.status);
}
function createCard(item) {
  return item.kind === "session" ? createSessionCard(item) : createRegisterCard(item);
}
function columnCards(column) {
  return document.querySelector(`[data-cards="${column}"]`);
}
function insertAt(column, node, index) {
  const parent = columnCards(column);
  if (!parent)
    return;
  const before = parent.children[index];
  if (before)
    parent.insertBefore(node, before);
  else
    parent.append(node);
}
function updateCounts(model) {
  for (const column of BOARD_COLUMNS) {
    const count = document.querySelector(`[data-count="${column}"]`);
    const value = String(model.columns[column].length);
    if (count && count.textContent !== value)
      count.textContent = value;
  }
}
function reportClientError(error) {
  const payload = JSON.stringify({
    source: "browser",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    url: window.location.href
  });
  fetch("/client-error", { method: "POST", headers: { "content-type": "application/json" }, body: payload }).catch(() => {
    return;
  });
}
function bootstrap() {
  const modelState = { current: null, selectedKey: null };
  const nodes = new Map;
  const generated = document.querySelector("[data-generated-at]");
  const boardGrid = document.querySelector("#board-grid");
  if (boardGrid && "ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? boardGrid.clientWidth;
      const density = width < 650 ? "compact" : width < 1050 ? "two-up" : "wide";
      if (boardGrid.dataset.density !== density)
        boardGrid.dataset.density = density;
    });
    resizeObserver.observe(boardGrid);
  }
  const setSelected = (key) => {
    if (modelState.selectedKey === key)
      return;
    if (modelState.selectedKey)
      nodes.get(modelState.selectedKey)?.classList.remove("is-selected");
    modelState.selectedKey = key;
    if (key)
      nodes.get(key)?.classList.add("is-selected");
  };
  const applyPatches = (next, patches) => {
    for (const patch of patches) {
      if (patch.op === "remove") {
        nodes.get(patch.key)?.remove();
        nodes.delete(patch.key);
      } else if (patch.op === "insert") {
        const node = createCard(patch.item);
        nodes.set(patch.key, node);
        insertAt(patch.column, node, patch.index);
      } else if (patch.op === "move") {
        const node = nodes.get(patch.key);
        if (node)
          insertAt(patch.column, node, patch.index);
      } else {
        const item = next.items[patch.key];
        const node = nodes.get(patch.key);
        if (!item || !node)
          continue;
        if (item.kind === "session")
          updateSessionCard(node, item, patch.fields);
        else
          updateRegisterCard(node, item, patch.fields);
      }
    }
    updateCounts(next);
    if (!modelState.selectedKey || !next.items[modelState.selectedKey]) {
      const first = BOARD_COLUMNS.flatMap((column) => next.columns[column])[0];
      setSelected(first?.key ?? null);
    }
    modelState.current = next;
  };
  const moveSelection = (direction) => {
    const model = modelState.current;
    if (!model)
      return;
    const currentKey = modelState.selectedKey;
    if (!currentKey) {
      const first = BOARD_COLUMNS.flatMap((column) => model.columns[column])[0];
      setSelected(first?.key ?? null);
      return;
    }
    const current = model.items[currentKey];
    if (!current)
      return;
    const columnIndex = BOARD_COLUMNS.indexOf(current.column);
    const rowIndex = model.columns[current.column].findIndex((item) => item.key === currentKey);
    let targetColumnIndex = columnIndex;
    let targetRowIndex = rowIndex;
    if (direction === "j")
      targetRowIndex += 1;
    if (direction === "k")
      targetRowIndex -= 1;
    if (direction === "h")
      targetColumnIndex -= 1;
    if (direction === "l")
      targetColumnIndex += 1;
    targetColumnIndex = Math.max(0, Math.min(BOARD_COLUMNS.length - 1, targetColumnIndex));
    const targetColumn = model.columns[BOARD_COLUMNS[targetColumnIndex]];
    if (direction === "h" || direction === "l")
      targetRowIndex = Math.min(rowIndex, targetColumn.length - 1);
    if (targetRowIndex < 0 || targetRowIndex >= targetColumn.length)
      return;
    setSelected(targetColumn[targetRowIndex].key);
  };
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      return;
    if (!(event.key in { j: 1, k: 1, h: 1, l: 1 }))
      return;
    event.preventDefault();
    moveSelection(event.key);
  });
  window.addEventListener("error", (event) => reportClientError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => reportClientError(event.reason));
  const refresh = async () => {
    try {
      const [fleetResponse, cardsResponse] = await Promise.all([fetch("/api/fleet"), fetch("/api/cards")]);
      if (!fleetResponse.ok || !cardsResponse.ok)
        throw new Error(`Fleet refresh failed (${fleetResponse.status}/${cardsResponse.status})`);
      const fleet = await fleetResponse.json();
      const cards = await cardsResponse.json();
      const next = buildBoardModel(fleet.sessions ?? [], cards.cards ?? []);
      applyPatches(next, diffBoardModels(modelState.current, next));
      if (generated && fleet.generatedAt)
        generated.textContent = `Updated ${formatFreshness(fleet.generatedAt).label}`;
    } catch (error) {
      reportClientError(error);
    }
  };
  refresh();
  window.setInterval(() => void refresh(), 5000);
}
if (typeof document !== "undefined")
  bootstrap();
export {
  modalVersion,
  isVersionSkewed,
  formatFreshness,
  diffBoardModels,
  columnForSessionState,
  columnForRegisterStatus,
  buildBoardModel,
  BOARD_COLUMN_LABELS,
  BOARD_COLUMNS
};

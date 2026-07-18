export const BOARD_COLUMNS = [
  "needs-arthur",
  "in-progress",
  "held-deferred",
  "recently-implemented",
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const BOARD_COLUMN_LABELS: Record<BoardColumn, string> = {
  "needs-arthur": "Needs Arthur",
  "in-progress": "In Progress",
  "held-deferred": "Held / Deferred",
  "recently-implemented": "Recently Implemented",
};

export interface FleetSession {
  session_id: string;
  name?: string | null;
  state?: string | null;
  workstream?: string | null;
  objective?: string | null;
  summary?: string | null;
  spawnName?: string | null;
  todo_head?: string | null;
  last_seen?: string | number | null;
  version?: string | null;
  [key: string]: unknown;
}

export interface RegisterCard {
  id: string;
  intent: string;
  status?: string | null;
  phase?: string | null;
  [key: string]: unknown;
}

export interface SessionBoardItem {
  key: string;
  kind: "session";
  column: BoardColumn;
  sessionId: string;
  name: string;
  workstream: string;
  summary: string;
  todoHead: string;
  state: string;
  version: string;
  skew: boolean;
  lastSeen: string | number | null;
  freshness: string;
  freshnessTone: FreshnessTone;
}

export interface RegisterBoardItem {
  key: string;
  kind: "register";
  column: BoardColumn;
  id: string;
  intent: string;
  status: string;
  phase: string;
}

export type BoardItem = SessionBoardItem | RegisterBoardItem;

export interface BoardModel {
  modalVersion: string | null;
  columns: Record<BoardColumn, BoardItem[]>;
  items: Record<string, BoardItem>;
}

export type FreshnessTone = "fresh" | "aging" | "stale" | "unknown";

export type BoardPatch =
  | { op: "insert"; key: string; item: BoardItem; column: BoardColumn; index: number }
  | { op: "remove"; key: string; column: BoardColumn; index: number }
  | { op: "move"; key: string; column: BoardColumn; index: number }
  | { op: "update"; key: string; fields: string[] };

export interface BoardDomRoot {
  querySelector<T extends Element = Element>(selectors: string): T | null;
  createElement(tagName: string): HTMLElement;
}

export interface BoardRenderState {
  current: BoardModel | null;
  selectedKey: string | null;
  nodes: Map<string, HTMLElement>;
}

export interface FleetResponse {
  generatedAt?: string;
  sessions?: FleetSession[];
}

export interface CardsResponse {
  cards?: RegisterCard[];
}

function text(value: unknown, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalized(value: unknown) {
  return text(value).toUpperCase().replace(/[\-_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function columnForRegisterStatus(status: string | null | undefined): BoardColumn {
  const value = normalized(status);
  if (value.includes("IMPLEMENTED") || value === "DONE" || value === "COMPLETE") {
    return "recently-implemented";
  }
  if (value.includes("IN PROGRESS") || value === "WORKING") {
    return "in-progress";
  }
  if (
    value.includes("REQUESTED") ||
    value.includes("AWAITING") ||
    value.includes("NEEDS ARTHUR") ||
    value === "OPEN"
  ) {
    return "needs-arthur";
  }
  if (
    value.includes("HELD") ||
    value.includes("DEFERRED") ||
    value.includes("BLOCKED") ||
    value.includes("PAUSED")
  ) {
    return "held-deferred";
  }
  return "held-deferred";
}

export function columnForSessionState(state: string | null | undefined): BoardColumn {
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

export function modalVersion(sessions: readonly FleetSession[]): string | null {
  const counts = new Map<string, number>();
  let winner: string | null = null;
  let winnerCount = 0;
  for (const session of sessions) {
    const version = text(session.version);
    if (!version) continue;
    const count = (counts.get(version) ?? 0) + 1;
    counts.set(version, count);
    if (count > winnerCount) {
      winner = version;
      winnerCount = count;
    }
  }
  return winner;
}

export function isVersionSkewed(version: string | null | undefined, modal: string | null | undefined) {
  const current = text(version);
  const common = text(modal);
  return current.length > 0 && common.length > 0 && current !== common;
}

function timestampMs(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function formatFreshness(
  value: string | number | null | undefined,
  now = Date.now(),
): { label: string; tone: FreshnessTone } {
  const seen = timestampMs(value);
  if (seen === null) return { label: "last seen unknown", tone: "unknown" };
  const age = Math.max(0, now - seen);
  const minutes = Math.floor(age / 60_000);
  if (minutes < 2) return { label: "just now", tone: "fresh" };
  if (minutes < 60) return { label: `${minutes}m ago`, tone: "fresh" };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { label: `${hours}h ago`, tone: "aging" };
  const days = Math.floor(hours / 24);
  return { label: `${days}d ago`, tone: "stale" };
}

function sessionItem(session: FleetSession, commonVersion: string | null): SessionBoardItem {
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
    freshnessTone: freshness.tone,
  };
}

function registerItem(card: RegisterCard): RegisterBoardItem {
  return {
    key: `card:${card.id}`,
    kind: "register",
    column: columnForRegisterStatus(card.status),
    id: card.id,
    intent: text(card.intent, "Untitled request"),
    status: text(card.status, "UNKNOWN"),
    phase: text(card.phase, "unphased"),
  };
}

function registerIdNumber(id: string) {
  const match = /(?:HR[-_])?(\d+)/i.exec(id);
  return match ? Number.parseInt(match[1], 10) : -1;
}

function emptyColumns(): Record<BoardColumn, BoardItem[]> {
  return {
    "needs-arthur": [],
    "in-progress": [],
    "held-deferred": [],
    "recently-implemented": [],
  };
}

export function buildBoardModel(
  sessions: readonly FleetSession[] = [],
  cards: readonly RegisterCard[] = [],
): BoardModel {
  const commonVersion = modalVersion(sessions);
  const columns = emptyColumns();
  const items: Record<string, BoardItem> = {};

  for (const session of sessions) {
    if (!session.session_id) continue;
    const item = sessionItem(session, commonVersion);
    columns[item.column].push(item);
    items[item.key] = item;
  }

  for (const card of cards) {
    if (!card.id) continue;
    const item = registerItem(card);
    columns[item.column].push(item);
    items[item.key] = item;
  }

  columns["recently-implemented"].sort((a, b) => {
    if (a.kind === "register" && b.kind === "register") return registerIdNumber(b.id) - registerIdNumber(a.id);
    if (a.kind === "register") return -1;
    if (b.kind === "register") return 1;
    return 0;
  });
  return { modalVersion: commonVersion, columns, items };
}

function itemFieldValues(item: BoardItem): Record<string, unknown> {
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
      lastSeen: item.lastSeen,
    };
  }
  return { id: item.id, intent: item.intent, phase: item.phase, status: item.status };
}

function itemPosition(model: BoardModel, key: string) {
  const item = model.items[key];
  if (!item) return null;
  const index = model.columns[item.column].findIndex((candidate) => candidate.key === key);
  return { column: item.column, index };
}

function allKeys(model: BoardModel) {
  return BOARD_COLUMNS.flatMap((column) => model.columns[column].map((item) => item.key));
}

export function diffBoardModels(previous: BoardModel | null, next: BoardModel): BoardPatch[] {
  if (!previous) {
    return BOARD_COLUMNS.flatMap((column) =>
      next.columns[column].map((item, index) => ({ op: "insert", key: item.key, item, column, index }) as const),
    );
  }

  const patches: BoardPatch[] = [];
  const nextKeys = new Set(allKeys(next));
  const previousKeys = new Set(allKeys(previous));
  const working: Record<BoardColumn, string[]> = {
    "needs-arthur": previous.columns["needs-arthur"].map((item) => item.key),
    "in-progress": previous.columns["in-progress"].map((item) => item.key),
    "held-deferred": previous.columns["held-deferred"].map((item) => item.key),
    "recently-implemented": previous.columns["recently-implemented"].map((item) => item.key),
  };

  for (const key of allKeys(previous)) {
    if (nextKeys.has(key)) continue;
    const position = itemPosition(previous, key);
    if (!position) continue;
    const currentIndex = working[position.column].indexOf(key);
    if (currentIndex >= 0) working[position.column].splice(currentIndex, 1);
    patches.push({ op: "remove", key, ...position });
  }

  for (const column of BOARD_COLUMNS) {
    for (const [index, item] of next.columns[column].entries()) {
      if (previousKeys.has(item.key)) continue;
      working[column].splice(index, 0, item.key);
      patches.push({ op: "insert", key: item.key, item, column, index });
    }
  }

  for (const column of BOARD_COLUMNS) {
    for (const item of next.columns[column]) {
      if (!previousKeys.has(item.key)) continue;
      const currentColumn = BOARD_COLUMNS.find((candidate) => working[candidate].includes(item.key));
      if (!currentColumn || currentColumn === column) continue;
      const currentIndex = working[currentColumn].indexOf(item.key);
      working[currentColumn].splice(currentIndex, 1);
      const destinationIndex = working[column].length;
      working[column].splice(destinationIndex, 0, item.key);
      patches.push({ op: "move", key: item.key, column, index: destinationIndex });
    }
  }

  for (const column of BOARD_COLUMNS) {
    for (const [index, item] of next.columns[column].entries()) {
      const currentIndex = working[column].indexOf(item.key);
      if (currentIndex < 0) continue;
      if (currentIndex !== index) {
        working[column].splice(currentIndex, 1);
        working[column].splice(index, 0, item.key);
        patches.push({ op: "move", key: item.key, column, index });
      }
    }
  }

  for (const column of BOARD_COLUMNS) {
    for (const item of next.columns[column]) {
      if (!previousKeys.has(item.key)) continue;
      const oldItem = previous.items[item.key];
      const oldFields = itemFieldValues(oldItem);
      const newFields = itemFieldValues(item);
      const fields = Object.keys(newFields).filter((field) => oldFields[field] !== newFields[field]);
      if (fields.length) patches.push({ op: "update", key: item.key, fields });
    }
  }
  return patches;
}

function esc(value: string) {
  return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" })[character] ?? character);
}

function createSessionCard(item: SessionBoardItem, root: BoardDomRoot) {
  const card = root.createElement("article");
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

function createRegisterCard(item: RegisterBoardItem, root: BoardDomRoot) {
  const card = root.createElement("article");
  card.className = "board-card register-card";
  card.dataset.key = item.key;
  card.dataset.kind = "register";
  card.innerHTML = `<div class="card-topline"><span class="card-type">REGISTER</span><span data-field="status" class="register-status"></span></div>
    <div class="register-id" data-field="id"></div><p class="card-summary" data-field="intent"></p>
    <div class="card-meta"><span class="muted-label">PHASE</span><span data-field="phase"></span></div>`;
  updateRegisterCard(card, item);
  return card;
}

function field(node: Element, name: string) {
  return node.querySelector<HTMLElement>(`[data-field="${name}"]`);
}

function setText(node: Element, name: string, value: string) {
  const target = field(node, name);
  if (target && target.textContent !== value) target.textContent = value;
}

function updateSessionCard(node: HTMLElement, item: SessionBoardItem, fields?: readonly string[]) {
  const changed = fields ? new Set(fields) : null;
  const should = (name: string) => changed === null || changed.has(name);
  if (should("name")) setText(node, "name", item.name);
  if (should("workstream")) setText(node, "workstream", item.workstream);
  if (should("summary")) setText(node, "summary", item.summary);
  if (should("todoHead")) setText(node, "todoHead", item.todoHead);
  if (should("state")) {
    setText(node, "state", item.state);
    const dot = field(node, "state-dot");
    if (dot) dot.className = `state-dot state-${item.state.replace(/[^a-z0-9]+/g, "-")}`;
  }
  if (should("version")) setText(node, "version", `VERSION ${item.version}`);
  if (should("skew")) {
    const badge = field(node, "skew");
    if (badge) badge.hidden = !item.skew;
  }
  if (should("freshness") || should("freshnessTone")) {
    setText(node, "freshness", item.freshness);
    const time = field(node, "freshness");
    if (time) time.className = `freshness ${item.freshnessTone}`;
  }
}

function updateRegisterCard(node: HTMLElement, item: RegisterBoardItem, fields?: readonly string[]) {
  const changed = fields ? new Set(fields) : null;
  const should = (name: string) => changed === null || changed.has(name);
  if (should("id")) setText(node, "id", item.id);
  if (should("intent")) setText(node, "intent", item.intent);
  if (should("phase")) setText(node, "phase", item.phase);
  if (should("status")) setText(node, "status", item.status);
}

function createCard(item: BoardItem, root: BoardDomRoot) {
  return item.kind === "session" ? createSessionCard(item, root) : createRegisterCard(item, root);
}

function columnCards(root: BoardDomRoot, column: BoardColumn) {
  return root.querySelector<HTMLElement>(`[data-cards="${column}"]`);
}

function insertAt(root: BoardDomRoot, column: BoardColumn, node: HTMLElement, index: number) {
  const parent = columnCards(root, column);
  if (!parent) return;
  const before = parent.children[index] as HTMLElement | undefined;
  if (before && before !== node) parent.insertBefore(node, before);
  else if (!before) parent.append(node);
}

function updateCounts(root: BoardDomRoot, model: BoardModel) {
  for (const column of BOARD_COLUMNS) {
    const count = root.querySelector<HTMLElement>(`[data-count="${column}"]`);
    const value = String(model.columns[column].length);
    if (count && count.textContent !== value) count.textContent = value;
  }
}

function setSelectedNode(state: BoardRenderState, key: string | null) {
  if (state.selectedKey === key) {
    if (key) state.nodes.get(key)?.classList.add("is-selected");
    return;
  }
  if (state.selectedKey) state.nodes.get(state.selectedKey)?.classList.remove("is-selected");
  state.selectedKey = key;
  if (key) state.nodes.get(key)?.classList.add("is-selected");
}

export function applyBoardPatches(
  next: BoardModel,
  patches: readonly BoardPatch[],
  state: BoardRenderState,
  root: BoardDomRoot = document,
) {
  for (const patch of patches) {
    if (patch.op === "remove") {
      state.nodes.get(patch.key)?.remove();
      state.nodes.delete(patch.key);
    } else if (patch.op === "insert") {
      const node = createCard(patch.item, root);
      state.nodes.set(patch.key, node);
      insertAt(root, patch.column, node, patch.index);
    } else if (patch.op === "move") {
      const node = state.nodes.get(patch.key);
      if (node) insertAt(root, patch.column, node, patch.index);
    } else {
      const item = next.items[patch.key];
      const node = state.nodes.get(patch.key);
      if (!item || !node) continue;
      if (item.kind === "session") updateSessionCard(node, item, patch.fields);
      else updateRegisterCard(node, item, patch.fields);
    }
  }
  updateCounts(root, next);
  if (!state.selectedKey || !next.items[state.selectedKey]) {
    const first = BOARD_COLUMNS.flatMap((column) => next.columns[column])[0];
    setSelectedNode(state, first?.key ?? null);
  } else {
    setSelectedNode(state, state.selectedKey);
  }
  state.current = next;
}

function reportClientError(error: unknown) {
  const payload = JSON.stringify({
    source: "browser",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    url: window.location.href,
  });
  void fetch("/client-error", { method: "POST", headers: { "content-type": "application/json" }, body: payload }).catch(() => undefined);
}

function bootstrap() {
  const modelState: BoardRenderState = { current: null, selectedKey: null, nodes: new Map() };
  const nodes = modelState.nodes;
  const generated = document.querySelector<HTMLElement>("[data-generated-at]");
  const boardGrid = document.querySelector<HTMLElement>("#board-grid");
  if (boardGrid && "ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? boardGrid.clientWidth;
      const density = width < 650 ? "compact" : width < 1050 ? "two-up" : "wide";
      if (boardGrid.dataset.density !== density) boardGrid.dataset.density = density;
    });
    resizeObserver.observe(boardGrid);
  }

  const setSelected = (key: string | null) => setSelectedNode(modelState, key);

  const applyPatches = (next: BoardModel, patches: readonly BoardPatch[]) => {
    applyBoardPatches(next, patches, modelState, document);
  };

  const moveSelection = (direction: "j" | "k" | "h" | "l") => {
    const model = modelState.current;
    if (!model) return;
    const currentKey = modelState.selectedKey;
    if (!currentKey) {
      const first = BOARD_COLUMNS.flatMap((column) => model.columns[column])[0];
      setSelected(first?.key ?? null);
      return;
    }
    const current = model.items[currentKey];
    if (!current) return;
    const columnIndex = BOARD_COLUMNS.indexOf(current.column);
    const rowIndex = model.columns[current.column].findIndex((item) => item.key === currentKey);
    let targetColumnIndex = columnIndex;
    let targetRowIndex = rowIndex;
    if (direction === "j") targetRowIndex += 1;
    if (direction === "k") targetRowIndex -= 1;
    if (direction === "h") targetColumnIndex -= 1;
    if (direction === "l") targetColumnIndex += 1;
    targetColumnIndex = Math.max(0, Math.min(BOARD_COLUMNS.length - 1, targetColumnIndex));
    const targetColumn = model.columns[BOARD_COLUMNS[targetColumnIndex]];
    if (direction === "h" || direction === "l") targetRowIndex = Math.min(rowIndex, targetColumn.length - 1);
    if (targetRowIndex < 0 || targetRowIndex >= targetColumn.length) return;
    setSelected(targetColumn[targetRowIndex].key);
  };

  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (!(event.key in { j: 1, k: 1, h: 1, l: 1 })) return;
    event.preventDefault();
    moveSelection(event.key as "j" | "k" | "h" | "l");
  });

  window.addEventListener("error", (event) => reportClientError(event.error ?? event.message));
  window.addEventListener("unhandledrejection", (event) => reportClientError(event.reason));

  const refresh = async () => {
    try {
      const [fleetResponse, cardsResponse] = await Promise.all([fetch("/api/fleet"), fetch("/api/cards")]);
      if (!fleetResponse.ok || !cardsResponse.ok) throw new Error(`Fleet refresh failed (${fleetResponse.status}/${cardsResponse.status})`);
      const fleet = (await fleetResponse.json()) as FleetResponse;
      const cards = (await cardsResponse.json()) as CardsResponse;
      const next = buildBoardModel(fleet.sessions ?? [], cards.cards ?? []);
      applyPatches(next, diffBoardModels(modelState.current, next));
      if (generated && fleet.generatedAt) generated.textContent = `Updated ${formatFreshness(fleet.generatedAt).label}`;
    } catch (error) {
      reportClientError(error);
    }
  };

  void refresh();
  window.setInterval(() => void refresh(), 5000);
}

if (typeof document !== "undefined") bootstrap();

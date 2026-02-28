import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSse, type ParsedSseEvent } from "./kagi-client.js";
import { type StoredRunRecord, loadRunRecord } from "./kagi-log.js";

export interface KagiVisualizerResultItem {
	readonly title: string;
	readonly url: string;
	readonly snippet: string;
	readonly publishedAt?: string;
}

export interface KagiVisualizerEvent {
	readonly index: number;
	readonly id: string | null;
	readonly tags: ReadonlyArray<string>;
	readonly rawData: string;
	readonly dataJson: unknown;
	readonly searchHtml?: string;
}

export interface KagiVisualizerModel {
	readonly title: string;
	readonly sourceLabel: string;
	readonly metadata: Readonly<Record<string, string>>;
	readonly events: ReadonlyArray<KagiVisualizerEvent>;
	readonly summaryResults: ReadonlyArray<KagiVisualizerResultItem>;
	readonly additionalPayload?: unknown;
}

export interface BuildVisualizerFromRawOptions {
	readonly title: string;
	readonly sourceLabel: string;
	readonly rawSse: string;
	readonly metadata?: Readonly<Record<string, string>>;
	readonly additionalPayload?: unknown;
}

function toTaggedPayloadRecords(dataJson: unknown): ReadonlyArray<{ tag: string; payload: unknown }> {
	if (Array.isArray(dataJson)) {
		return dataJson
			.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
			.map((entry) => ({
				tag: typeof entry.tag === "string" ? entry.tag : "",
				payload: entry.payload,
			}))
			.filter((entry) => entry.tag.length > 0);
	}
	if (dataJson && typeof dataJson === "object") {
		const data = dataJson as Record<string, unknown>;
		if (typeof data.tag === "string") {
			return [{ tag: data.tag, payload: data.payload }];
		}
	}
	return [];
}

function decodeHtmlEntities(input: string): string {
	return input
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

function stripHtml(input: string): string {
	const stripped = input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
	return decodeHtmlEntities(stripped).replace(/\s+([.,;:!?])/g, "$1");
}

function extractSearchHtml(payload: unknown): string {
	if (typeof payload === "string") {
		try {
			const parsed = JSON.parse(payload) as { content?: unknown };
			if (typeof parsed.content === "string") {
				return parsed.content;
			}
		} catch {
			return payload;
		}
		return payload;
	}
	if (payload && typeof payload === "object") {
		const record = payload as Record<string, unknown>;
		if (typeof record.content === "string") {
			return record.content;
		}
	}
	return "";
}

function extractResultsFromSearchHtml(html: string): KagiVisualizerResultItem[] {
	if (!html) {
		return [];
	}
	const titleRegex = /<a[^>]*class="[^"]*__sri_title_link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
	const descRegex = /<div class="_0_DESC __sri-desc">([\s\S]*?)<\/div>/g;
	const timeRegex = /<span class="__sri-time[^"]*">([\s\S]*?)<\/span>/g;

	const descList = Array.from(html.matchAll(descRegex)).map((match) => stripHtml(match[1] ?? ""));
	const publishedAtList = Array.from(html.matchAll(timeRegex)).map((match) => stripHtml(match[1] ?? ""));

	const results: KagiVisualizerResultItem[] = [];
	let index = 0;
	for (const match of html.matchAll(titleRegex)) {
		const url = decodeHtmlEntities((match[1] ?? "").trim());
		const title = stripHtml(match[2] ?? "");
		if (!url || !title) {
			continue;
		}
		const publishedAt = (publishedAtList[index] ?? "").trim();
		results.push({
			title,
			url,
			snippet: descList[index] ?? "",
			...(publishedAt.length > 0 ? { publishedAt } : {}),
		});
		index += 1;
	}

	return results;
}

function extractResultsFromJson(dataJson: unknown): KagiVisualizerResultItem[] {
	if (!dataJson || typeof dataJson !== "object" || Array.isArray(dataJson)) {
		return [];
	}
	const data = dataJson as Record<string, unknown>;
	const list = data.results ?? data.items ?? data.search_results;
	if (!Array.isArray(list)) {
		return [];
	}

	const results: KagiVisualizerResultItem[] = [];
	for (const entry of list) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const item = entry as Record<string, unknown>;
		const title = String(item.title ?? item.name ?? "").trim();
		const url = String(item.url ?? item.link ?? item.href ?? "").trim();
		if (title.length === 0 || url.length === 0) {
			continue;
		}
		const snippet = String(item.snippet ?? item.description ?? item.content ?? "").trim();
		const publishedAt = String(
			item.publishedAt ?? item.published_at ?? item.updatedAt ?? item.updated_at ?? item.date ?? "",
		).trim();
		results.push({
			title,
			url,
			snippet,
			...(publishedAt.length > 0 ? { publishedAt } : {}),
		});
	}

	return results;
}

function dedupeResults(results: ReadonlyArray<KagiVisualizerResultItem>): KagiVisualizerResultItem[] {
	const deduped: KagiVisualizerResultItem[] = [];
	const seenUrls = new Set<string>();
	for (const result of results) {
		if (seenUrls.has(result.url)) {
			continue;
		}
		seenUrls.add(result.url);
		deduped.push(result);
	}
	return deduped;
}

function mapEvents(parsedEvents: ReadonlyArray<ParsedSseEvent>): KagiVisualizerEvent[] {
	return parsedEvents.map((event, index) => {
		const taggedRecords = toTaggedPayloadRecords(event.dataJson);
		const tags = taggedRecords.map((record) => record.tag);
		const searchRecord = taggedRecords.find((record) => record.tag === "search");
		const searchHtml = searchRecord ? extractSearchHtml(searchRecord.payload) : "";
		return {
			index,
			id: event.id,
			tags,
			rawData: event.dataRaw,
			dataJson: event.dataJson,
			...(searchHtml.length > 0 ? { searchHtml } : {}),
		};
	});
}

function buildSummaryResults(events: ReadonlyArray<KagiVisualizerEvent>): KagiVisualizerResultItem[] {
	const collected: KagiVisualizerResultItem[] = [];
	for (const event of events) {
		if (event.searchHtml) {
			collected.push(...extractResultsFromSearchHtml(event.searchHtml));
		}
		collected.push(...extractResultsFromJson(event.dataJson));
	}
	return dedupeResults(collected);
}

function ensureEvents(rawSse: string, additionalPayload: unknown): ParsedSseEvent[] {
	const parsed = parseSse(rawSse);
	if (parsed.length > 0) {
		return parsed;
	}
	if (typeof additionalPayload === "undefined") {
		return [];
	}
	return [
		{
			id: "json",
			dataRaw: JSON.stringify(additionalPayload),
			dataJson: additionalPayload,
		},
	];
}

export function buildVisualizerModelFromRaw(options: BuildVisualizerFromRawOptions): KagiVisualizerModel {
	const parsedEvents = ensureEvents(options.rawSse, options.additionalPayload);
	const events = mapEvents(parsedEvents);
	const summaryResults = buildSummaryResults(events);
	return {
		title: options.title,
		sourceLabel: options.sourceLabel,
		metadata: options.metadata ?? {},
		events,
		summaryResults,
		...(typeof options.additionalPayload === "undefined" ? {} : { additionalPayload: options.additionalPayload }),
	};
}

export function buildVisualizerModelFromRunRecord(
	record: StoredRunRecord,
	sourceLabel = "Stored run record",
): KagiVisualizerModel {
	const metadata: Record<string, string> = {
		runId: record.runId,
		query: record.query,
		status: String(record.status),
		requestUrl: record.requestUrl,
		referer: record.referer,
		capturedAt: record.result.capturedAt,
		eventCount: String(record.result.parsedEvents.length),
		tags: record.tags.join(", "),
	};

	return buildVisualizerModelFromRaw({
		title: `Kagi SSE Visualizer — ${record.runId}`,
		sourceLabel,
		rawSse: record.result.rawSse,
		metadata,
		additionalPayload: record,
	});
}

function escapeInlineJson(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

export function buildKagiVisualizerHtml(model: KagiVisualizerModel): string {
	const serialized = escapeInlineJson(model);
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${model.title}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f1116;
      --panel: #171b23;
      --border: #2b3241;
      --text: #e8edf6;
      --muted: #9ba7bd;
      --accent: #75b8ff;
      --accent-2: #2f8cff;
      --danger: #ff8f8f;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --sans: Inter, Segoe UI, system-ui, sans-serif;
    }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); font-family: var(--sans); height: 100%; }
    * { box-sizing: border-box; }
    .app { display: grid; grid-template-rows: auto auto 1fr; height: 100vh; }
    .topbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--border); background: #111620; gap: 12px; }
    .title { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .source { color: var(--muted); font-size: 12px; }
    .shortcuts-inline { color: var(--muted); font-size: 12px; white-space: nowrap; }
    .controls { display: grid; grid-template-columns: minmax(220px, 340px) 120px 1fr; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
    .input {
      width: 100%;
      background: #111722;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 10px;
      font-family: var(--mono);
      font-size: 12px;
    }
    .layout { display: grid; grid-template-columns: minmax(280px, 0.9fr) minmax(460px, 1.5fr) minmax(320px, 1fr); gap: 8px; padding: 8px; min-height: 0; }
    .panel { min-height: 0; border: 1px solid var(--border); background: var(--panel); border-radius: 8px; display: grid; grid-template-rows: auto 1fr; overflow: hidden; }
    .panel.active-focus { border-color: var(--accent-2); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-2) 50%, transparent) inset; }
    .panel-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--muted); }
    .events { overflow: auto; font-family: var(--mono); font-size: 12px; }
    .event-item { padding: 8px 10px; border-bottom: 1px solid #202736; cursor: pointer; }
    .event-item:hover { background: #20283a; }
    .event-item.selected { background: #25304a; border-left: 3px solid var(--accent); padding-left: 7px; }
    .event-tags { color: var(--accent); margin-bottom: 4px; }
    .event-id { color: var(--muted); }
    .tabs { display: flex; gap: 6px; }
    .tab-btn {
      background: #111722;
      border: 1px solid var(--border);
      color: var(--muted);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 12px;
      cursor: pointer;
    }
    .tab-btn.active { color: var(--text); border-color: var(--accent-2); background: #1a2335; }
    .viewer-body { min-height: 0; position: relative; }
    .viewer-pane { display: none; height: 100%; }
    .viewer-pane.active { display: block; }
    pre {
      margin: 0;
      height: 100%;
      overflow: auto;
      padding: 10px;
      font-family: var(--mono);
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: #fff;
    }
    .summary { overflow: auto; padding: 8px 10px; font-size: 12px; }
    .kv { display: grid; grid-template-columns: 110px 1fr; gap: 8px; margin-bottom: 6px; }
    .kv .k { color: var(--muted); }
    .meta-break { margin: 12px 0; border-top: 1px solid var(--border); }
    .result { border: 1px solid #273045; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
    .result-title { color: var(--accent); margin-bottom: 4px; }
    .result-url { color: #9cc1f5; font-family: var(--mono); word-break: break-all; font-size: 11px; }
    .result-date { color: #b5c6df; margin-top: 4px; font-size: 11px; }
    .result-snippet { color: #d7dfec; margin-top: 6px; }
    .status { color: var(--muted); font-size: 11px; }
    .status.warn { color: var(--danger); }
    .help {
      position: fixed;
      right: 14px;
      bottom: 14px;
      width: 360px;
      max-width: calc(100vw - 28px);
      background: #101623;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      font-size: 12px;
      line-height: 1.4;
      display: none;
      z-index: 20;
    }
    .help.visible { display: block; }
    .help h3 { margin: 0 0 8px; font-size: 13px; }
    .help code { font-family: var(--mono); color: var(--accent); }
  </style>
</head>
<body>
  <div class="app">
    <div class="topbar">
      <div>
        <div class="title"></div>
        <div class="source"></div>
      </div>
      <div class="shortcuts-inline">j/k select · h/l tab · 1/2/3 tab · / filter · : jump · ? help</div>
    </div>
    <div class="controls">
      <input id="filter-input" class="input" type="text" placeholder="Filter events by tag/text (/ to focus)" />
      <input id="jump-input" class="input" type="text" placeholder=": jump" />
      <div id="status" class="status"></div>
    </div>
    <div class="layout">
      <section id="events-panel" class="panel active-focus">
        <div class="panel-header">
          <span>Events</span>
          <span id="event-count"></span>
        </div>
        <div id="events" class="events"></div>
      </section>
      <section id="viewer-panel" class="panel">
        <div class="panel-header">
          <span>Payload</span>
          <div class="tabs">
            <button class="tab-btn active" data-tab="render">Render</button>
            <button class="tab-btn" data-tab="json">JSON</button>
            <button class="tab-btn" data-tab="raw">Raw</button>
          </div>
        </div>
        <div class="viewer-body">
          <div id="pane-render" class="viewer-pane active"><iframe id="render-frame" title="Rendered SSE HTML"></iframe></div>
          <div id="pane-json" class="viewer-pane"><pre id="json-pre"></pre></div>
          <div id="pane-raw" class="viewer-pane"><pre id="raw-pre"></pre></div>
        </div>
      </section>
      <section id="summary-panel" class="panel">
        <div class="panel-header"><span>Parsed summary</span><span id="result-count"></span></div>
        <div id="summary" class="summary"></div>
      </section>
    </div>
  </div>

  <div id="help" class="help">
    <h3>Vim-style shortcuts</h3>
    <div><code>j</code>/<code>k</code>: next/prev event</div>
    <div><code>g g</code>: first event · <code>G</code>: last event</div>
    <div><code>h</code>/<code>l</code>: previous/next payload tab</div>
    <div><code>1</code>/<code>2</code>/<code>3</code>: render/json/raw tab</div>
    <div><code>/</code>: focus filter input · <code>:</code>: focus jump input</div>
    <div><code>?</code>: toggle help · <code>Esc</code>: blur input/help</div>
  </div>

  <script id="kagi-visualizer-model" type="application/json">${serialized}</script>
  <script>
    const model = JSON.parse(document.getElementById("kagi-visualizer-model").textContent || "{}");

    const state = {
      filter: "",
      filteredIndices: [],
      selectedFilteredIndex: 0,
      activeTab: "render",
      paneFocus: "events",
      gPending: false,
      helpVisible: false,
    };

    const titleEl = document.querySelector(".title");
    const sourceEl = document.querySelector(".source");
    const eventsEl = document.getElementById("events");
    const eventCountEl = document.getElementById("event-count");
    const resultCountEl = document.getElementById("result-count");
    const filterInput = document.getElementById("filter-input");
    const jumpInput = document.getElementById("jump-input");
    const statusEl = document.getElementById("status");
    const jsonPre = document.getElementById("json-pre");
    const rawPre = document.getElementById("raw-pre");
    const frame = document.getElementById("render-frame");
    const helpEl = document.getElementById("help");
    const eventsPanel = document.getElementById("events-panel");
    const viewerPanel = document.getElementById("viewer-panel");
    const summaryPanel = document.getElementById("summary-panel");

    const tabs = ["render", "json", "raw"];

    function escapeHtml(text) {
      return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }

    function isInputFocused() {
      const active = document.activeElement;
      return active === filterInput || active === jumpInput;
    }

    function applyPaneFocus() {
      for (const panel of [eventsPanel, viewerPanel, summaryPanel]) {
        panel.classList.remove("active-focus");
      }
      if (state.paneFocus === "events") eventsPanel.classList.add("active-focus");
      if (state.paneFocus === "viewer") viewerPanel.classList.add("active-focus");
      if (state.paneFocus === "summary") summaryPanel.classList.add("active-focus");
    }

    function currentEvent() {
      if (state.filteredIndices.length === 0) {
        return null;
      }
      const actualIndex = state.filteredIndices[state.selectedFilteredIndex] ?? null;
      if (actualIndex === null || typeof actualIndex === "undefined") {
        return null;
      }
      return model.events[actualIndex] ?? null;
    }

    function filterEvents() {
      const needle = state.filter.trim().toLowerCase();
      if (!needle) {
        state.filteredIndices = model.events.map((_, index) => index);
      } else {
        state.filteredIndices = model.events
          .map((event, index) => ({ event, index }))
          .filter(({ event }) => {
            const hay = [
              event.id || "",
              ...(event.tags || []),
              event.rawData || "",
              JSON.stringify(event.dataJson ?? ""),
            ].join(" ").toLowerCase();
            return hay.includes(needle);
          })
          .map(({ index }) => index);
      }
      if (state.selectedFilteredIndex >= state.filteredIndices.length) {
        state.selectedFilteredIndex = Math.max(0, state.filteredIndices.length - 1);
      }
    }

    function renderEvents() {
      eventCountEl.textContent = \`\${state.filteredIndices.length}/\${model.events.length}\`;
      eventsEl.innerHTML = "";
      state.filteredIndices.forEach((actualIndex, filteredIndex) => {
        const event = model.events[actualIndex];
        if (!event) return;
        const div = document.createElement("div");
        div.className = "event-item" + (filteredIndex === state.selectedFilteredIndex ? " selected" : "");
        div.dataset.index = String(filteredIndex);
        const tags = Array.isArray(event.tags) && event.tags.length > 0 ? event.tags.join(", ") : "no-tag";
        div.innerHTML = \`<div class="event-tags">#\${actualIndex} \${escapeHtml(tags)}</div><div class="event-id">id: \${escapeHtml(event.id ?? "null")}</div>\`;
        div.addEventListener("click", () => {
          state.selectedFilteredIndex = filteredIndex;
          renderAll();
        });
        eventsEl.appendChild(div);
      });
    }

    function setActiveTab(tab) {
      state.activeTab = tab;
      for (const button of document.querySelectorAll(".tab-btn")) {
        button.classList.toggle("active", button.dataset.tab === tab);
      }
      for (const pane of document.querySelectorAll(".viewer-pane")) {
        pane.classList.toggle("active", pane.id === \`pane-\${tab}\`);
      }
    }

    function buildIframeDoc(event) {
      const rawHtml = String(event.searchHtml || "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, "");
      return \`<!doctype html><html><head><meta charset="utf-8" /><base target="_blank" /><style>
        html, body { margin: 0; padding: 12px; background: #f5f8ff; color: #0f172a; font-family: Inter, Segoe UI, system-ui, sans-serif; }
        * { box-sizing: border-box; }
        a { color: #1d4ed8; }
        ._0_SRI { border: 1px solid #d4ddf2; border-radius: 8px; padding: 10px; margin-bottom: 8px; background: #fff; }
        ._0_TITLE { margin-bottom: 4px; font-weight: 600; }
        ._0_DESC { color: #334155; }
        .__sri-time { color: #64748b; font-size: 12px; margin-right: 8px; }
      </style></head><body>\${rawHtml || "<p>No HTML payload on selected event.</p>"}</body></html>\`;
    }

    function renderViewer() {
      const event = currentEvent();
      if (!event) {
        jsonPre.textContent = "No event selected.";
        rawPre.textContent = "No event selected.";
        frame.srcdoc = "<p style='font-family: sans-serif; padding: 12px;'>No event selected.</p>";
        return;
      }
      jsonPre.textContent = JSON.stringify(event.dataJson, null, 2);
      rawPre.textContent = String(event.rawData || "");
      frame.srcdoc = buildIframeDoc(event);
    }

    function renderSummary() {
      resultCountEl.textContent = \`\${(model.summaryResults || []).length} result(s)\`;
      const metadataEntries = Object.entries(model.metadata || {});
      const metadataHtml = metadataEntries
        .map(([key, value]) => \`<div class="kv"><div class="k">\${escapeHtml(key)}</div><div>\${escapeHtml(String(value))}</div></div>\`)
        .join("");

      const resultsHtml = (model.summaryResults || [])
        .map((result) => {
          const date = result.publishedAt ? \`<div class="result-date">Date: \${escapeHtml(result.publishedAt)}</div>\` : "";
          const snippet = result.snippet ? \`<div class="result-snippet">\${escapeHtml(result.snippet)}</div>\` : "";
          return \`<div class="result"><div class="result-title">\${escapeHtml(result.title)}</div><div class="result-url">\${escapeHtml(result.url)}</div>\${date}\${snippet}</div>\`;
        })
        .join("");

      document.getElementById("summary").innerHTML =
        metadataHtml +
        \`<div class="meta-break"></div><div class="k" style="margin-bottom: 8px; color: var(--muted);">Extracted results</div>\` +
        (resultsHtml || \`<div class="status warn">No extracted search results in current payload.</div>\`);
    }

    function renderStatus() {
      const event = currentEvent();
      const eventLabel = event ? \`Event #\${event.index}\` : "No event";
      statusEl.textContent = \`\${eventLabel} · tab:\${state.activeTab} · focus:\${state.paneFocus}\`;
    }

    function renderAll() {
      titleEl.textContent = model.title || "Kagi SSE visualizer";
      sourceEl.textContent = model.sourceLabel || "source";
      filterEvents();
      renderEvents();
      renderViewer();
      renderSummary();
      renderStatus();
      applyPaneFocus();
    }

    function moveSelection(delta) {
      if (state.filteredIndices.length === 0) return;
      state.selectedFilteredIndex = Math.max(
        0,
        Math.min(state.filteredIndices.length - 1, state.selectedFilteredIndex + delta),
      );
      renderAll();
    }

    function cycleTab(delta) {
      const current = tabs.indexOf(state.activeTab);
      const next = (current + delta + tabs.length) % tabs.length;
      setActiveTab(tabs[next]);
      renderStatus();
    }

    function toggleHelp() {
      state.helpVisible = !state.helpVisible;
      helpEl.classList.toggle("visible", state.helpVisible);
    }

    for (const button of document.querySelectorAll(".tab-btn")) {
      button.addEventListener("click", () => {
        const tab = button.dataset.tab;
        if (!tab) return;
        setActiveTab(tab);
        renderStatus();
      });
    }

    filterInput.addEventListener("input", () => {
      state.filter = filterInput.value;
      state.selectedFilteredIndex = 0;
      renderAll();
    });

    jumpInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const value = Number(jumpInput.value.trim());
      if (!Number.isInteger(value)) return;
      const target = Math.max(0, Math.min(model.events.length - 1, value));
      const filteredPos = state.filteredIndices.indexOf(target);
      if (filteredPos >= 0) {
        state.selectedFilteredIndex = filteredPos;
        renderAll();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        state.gPending = false;
        state.helpVisible = false;
        helpEl.classList.remove("visible");
        if (isInputFocused()) {
          filterInput.blur();
          jumpInput.blur();
        }
        return;
      }

      if (isInputFocused() && !["?"].includes(event.key)) {
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        filterInput.focus();
        filterInput.select();
        return;
      }

      if (event.key === ":") {
        event.preventDefault();
        jumpInput.focus();
        jumpInput.select();
        return;
      }

      if (event.key === "?") {
        event.preventDefault();
        toggleHelp();
        return;
      }

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
        state.gPending = false;
        return;
      }

      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
        state.gPending = false;
        return;
      }

      if (event.key === "h") {
        event.preventDefault();
        cycleTab(-1);
        state.gPending = false;
        return;
      }

      if (event.key === "l") {
        event.preventDefault();
        cycleTab(1);
        state.gPending = false;
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        setActiveTab("render");
        renderStatus();
        state.gPending = false;
        return;
      }
      if (event.key === "2") {
        event.preventDefault();
        setActiveTab("json");
        renderStatus();
        state.gPending = false;
        return;
      }
      if (event.key === "3") {
        event.preventDefault();
        setActiveTab("raw");
        renderStatus();
        state.gPending = false;
        return;
      }

      if (event.key === "g") {
        event.preventDefault();
        if (state.gPending) {
          state.selectedFilteredIndex = 0;
          renderAll();
          state.gPending = false;
        } else {
          state.gPending = true;
          setTimeout(() => {
            state.gPending = false;
          }, 450);
        }
        return;
      }

      if (event.key === "G") {
        event.preventDefault();
        if (state.filteredIndices.length > 0) {
          state.selectedFilteredIndex = state.filteredIndices.length - 1;
          renderAll();
        }
        state.gPending = false;
      }
    });

    renderAll();
  </script>
</body>
</html>`;
}

export function loadRunRecordForVisualizer(runPath: string): StoredRunRecord {
	return loadRunRecord(resolve(runPath));
}

export function loadJsonPayload(filePath: string): unknown {
	const raw = readFileSync(resolve(filePath), "utf8");
	return JSON.parse(raw) as unknown;
}

export function loadTextPayload(filePath: string): string {
	return readFileSync(resolve(filePath), "utf8");
}

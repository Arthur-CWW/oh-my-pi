import { createMemo, createSignal, For, onMount, Show } from "solid-js";

type Settings = {
  captureEnabled: boolean;
  bookmarkOnly: boolean;
  storeBodies: boolean;
  autoPost: boolean;
  endpoint: string;
};

type TweetLikeRecord = {
  rest_id?: string;
  id_str?: string;
  full_text: string;
  created_at?: string;
  screen_name?: string;
  path: string;
};

type Capture = {
  id: string;
  capturedAt: string;
  inspectedTabId: number;
  request: {
    method: string;
    url: string;
    postData?: string;
  };
  response: {
    status: number;
    statusText: string;
    mimeType: string;
    bodySize: number;
    encoding: string;
    headers: unknown[];
  };
  timing: {
    startedDateTime: string;
    time: number;
  };
  tags: string[];
  tweetLike: TweetLikeRecord[];
  body?: string;
  json?: unknown;
  parseError?: string;
};

const DEFAULT_ENDPOINT = "http://127.0.0.1:51747/x-bookmark-sync/ingest";
const MAX_PREVIEW_CHARS = 80_000;

const defaultSettings: Settings = {
  captureEnabled: true,
  bookmarkOnly: true,
  storeBodies: true,
  autoPost: false,
  endpoint: DEFAULT_ENDPOINT,
};

export function App() {
  const [captures, setCaptures] = createSignal<Capture[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [settings, setSettings] = createSignal<Settings>(defaultSettings);
  const [status, setStatus] = createSignal({ text: "booting", error: false });

  const selectedCapture = createMemo(() => captures().find((capture) => capture.id === selectedId()) ?? null);
  const totalBodyBytes = createMemo(() => captures().reduce((sum, item) => sum + item.response.bodySize, 0));
  const tweetLikeCount = createMemo(() => captures().reduce((sum, item) => sum + item.tweetLike.length, 0));

  onMount(async () => {
    const stored = await storageGet<{ xBookmarkSyncSettings?: Settings }>(["xBookmarkSyncSettings"]);
    setSettings({ ...defaultSettings, ...(stored.xBookmarkSyncSettings || {}) });
    setStatus({ text: "listening", error: false });

    chrome.devtools.network.onRequestFinished.addListener((entry) => {
      void onRequestFinished(entry as any);
    });
  });

  const patchSettings = (patch: Partial<Settings>) => {
    const next = { ...settings(), ...patch };
    setSettings(next);
    void storageSet({ xBookmarkSyncSettings: next });
    if ("captureEnabled" in patch) {
      setStatus({ text: next.captureEnabled ? "listening" : "paused", error: false });
    }
  };

  const clear = () => {
    setCaptures([]);
    setSelectedId(null);
  };

  const onRequestFinished = async (entry: any) => {
    const currentSettings = settings();
    if (!currentSettings.captureEnabled) return;
    if (!isXUrl(entry.request.url)) return;

    const method = entry.request.method || "GET";
    const requestPostData = entry.request.postData?.text || "";
    const urlMatches = isBookmarkishUrl(entry.request.url);
    const bodyMatches = isBookmarkishText(requestPostData);

    if (currentSettings.bookmarkOnly && !urlMatches && !bodyMatches) {
      return;
    }

    entry.getContent(async (body: string | undefined, encoding: string | undefined) => {
      try {
        const safeBody = typeof body === "string" ? body : "";
        const parsed = parseMaybeJson(safeBody);
        const tweetLike = parsed.ok ? extractTweetLikeRecords(parsed.value) : [];
        const responseTextMatches = isBookmarkishText(safeBody);

        if (currentSettings.bookmarkOnly && !urlMatches && !bodyMatches && !responseTextMatches && tweetLike.length === 0) {
          return;
        }

        const capture: Capture = {
          id: crypto.randomUUID(),
          capturedAt: new Date().toISOString(),
          inspectedTabId: chrome.devtools.inspectedWindow.tabId,
          request: {
            method,
            url: entry.request.url,
            postData: trimOrUndefined(requestPostData, MAX_PREVIEW_CHARS),
          },
          response: {
            status: entry.response.status,
            statusText: entry.response.statusText,
            mimeType: entry.response.content?.mimeType || "",
            bodySize: byteLength(safeBody),
            encoding: encoding || "",
            headers: entry.response.headers || [],
          },
          timing: {
            startedDateTime: entry.startedDateTime,
            time: entry.time,
          },
          tags: makeTags(entry.request.url, requestPostData, safeBody, tweetLike),
          tweetLike,
          body: currentSettings.storeBodies ? safeBody : undefined,
          json: parsed.ok && currentSettings.storeBodies ? parsed.value : undefined,
          parseError: parsed.ok ? undefined : parsed.error,
        };

        setCaptures((items) => [capture, ...items]);
        setSelectedId((id) => id || capture.id);

        if (currentSettings.autoPost) {
          await postSnapshot({ captures: [capture], source: snapshotSource(), incremental: true }, currentSettings.endpoint);
        }
      } catch (error) {
        setStatus({ text: `capture error: ${(error as Error).message}`, error: true });
      }
    });
  };

  const postCurrentSnapshot = async () => {
    setStatus({ text: "posting…", error: false });
    try {
      await postSnapshot(makeSnapshot(captures()), settings().endpoint);
      setStatus({ text: `posted ${captures().length} capture(s)`, error: false });
    } catch (error) {
      setStatus({ text: `post failed: ${(error as Error).message}`, error: true });
    }
  };

  return (
    <div class="min-h-screen bg-slate-950 text-slate-100 selection:bg-sky-400/30">
      <header class="border-b border-slate-800 bg-slate-950/95 px-4 py-3 shadow-[0_1px_0_rgba(125,211,252,0.12)]">
        <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div class="mb-1 flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-sky-300 shadow-[0_0_18px_rgba(125,211,252,0.9)]" />
              <p class="font-mono text-[10px] uppercase tracking-[0.28em] text-sky-300/80">local capture console</p>
            </div>
            <h1 class="text-lg font-semibold tracking-tight text-white">X Bookmark Sync</h1>
            <p class="mt-1 max-w-3xl text-xs text-slate-400">
              Capture bookmark-related GraphQL/API responses from the inspected X/Twitter tab while DevTools is open.
            </p>
          </div>
          <div
            class={`rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wider ${
              status().error
                ? "border-rose-400/40 bg-rose-500/10 text-rose-300"
                : "border-sky-400/30 bg-sky-400/10 text-sky-200"
            }`}
          >
            {status().text}
          </div>
        </div>
      </header>

      <section class="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900/80 px-4 py-3 text-xs">
        <Toggle
          label="capture"
          checked={settings().captureEnabled}
          onChange={(captureEnabled) => patchSettings({ captureEnabled })}
        />
        <Toggle
          label="bookmark-ish only"
          checked={settings().bookmarkOnly}
          onChange={(bookmarkOnly) => patchSettings({ bookmarkOnly })}
        />
        <Toggle
          label="keep bodies"
          checked={settings().storeBodies}
          onChange={(storeBodies) => patchSettings({ storeBodies })}
        />
        <div class="h-5 w-px bg-slate-700" />
        <button class="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-slate-200 hover:border-sky-400" onClick={clear}>
          Clear
        </button>
        <button
          class="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-slate-200 hover:border-sky-400"
          onClick={() => downloadJson(makeSnapshot(captures()), `x-bookmark-captures-${dateStamp()}.json`)}
        >
          Download JSON
        </button>
      </section>

      <section class="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900/60 px-4 py-3 text-xs">
        <label class="flex min-w-0 flex-1 basis-[420px] items-center gap-2 text-slate-400">
          <span class="shrink-0">Local ingest</span>
          <input
            class="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-slate-100 outline-none focus:border-sky-400"
            type="url"
            spellcheck={false}
            value={settings().endpoint}
            onChange={(event) => patchSettings({ endpoint: event.currentTarget.value.trim() || DEFAULT_ENDPOINT })}
          />
        </label>
        <button
          class="rounded-md border border-sky-400/40 bg-sky-400/10 px-3 py-1.5 text-sky-100 hover:bg-sky-400/20"
          onClick={() => void postCurrentSnapshot()}
        >
          POST snapshot
        </button>
        <Toggle label="auto-post" checked={settings().autoPost} onChange={(autoPost) => patchSettings({ autoPost })} />
      </section>

      <section class="grid grid-cols-3 gap-2 border-b border-slate-800 bg-slate-950 px-4 py-3">
        <Stat label="captured requests" value={captures().length.toLocaleString()} />
        <Stat label="tweet-like records" value={tweetLikeCount().toLocaleString()} />
        <Stat label="body bytes" value={formatBytes(totalBodyBytes())} />
      </section>

      <main class="grid h-[calc(100vh-236px)] min-h-[340px] grid-cols-[minmax(260px,36%)_1fr] bg-slate-950">
        <aside class="min-w-0 overflow-hidden border-r border-slate-800 bg-slate-900/70">
          <h2 class="border-b border-slate-800 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">Requests</h2>
          <div class="h-[calc(100%-33px)] overflow-auto">
            <Show when={captures().length > 0} fallback={<EmptyRequests />}>
              <For each={captures()}>
                {(capture) => (
                  <button
                    class={`block w-full border-b border-slate-800 px-3 py-2 text-left transition hover:bg-slate-800/80 ${
                      capture.id === selectedId() ? "bg-sky-400/10 ring-1 ring-inset ring-sky-400/30" : ""
                    }`}
                    onClick={() => setSelectedId(capture.id)}
                  >
                    <div class="truncate text-xs text-slate-100">{shortUrl(capture.request.url)}</div>
                    <div class="mt-1 truncate font-mono text-[11px] text-slate-500">
                      {capture.response.status} · {capture.request.method} · {capture.tweetLike.length} tweets · {formatBytes(capture.response.bodySize)}
                    </div>
                    <div class="mt-1 flex flex-wrap gap-1">
                      <For each={capture.tags}>{(tag) => <span class="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-sky-200">{tag}</span>}</For>
                    </div>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </aside>

        <section class="min-w-0 overflow-hidden">
          <h2 class="truncate border-b border-slate-800 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400">
            <Show when={selectedCapture()} fallback="No request selected">
              {(capture) => shortUrl(capture().request.url, 140)}
            </Show>
          </h2>
          <pre class="h-[calc(100%-33px)] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-slate-300">
            <Show when={selectedCapture()} fallback="Open or reload x.com/i/bookmarks with DevTools open, then wait for X/Twitter API responses.">
              {(capture) => JSON.stringify(capture(), null, 2)}
            </Show>
          </pre>
        </section>
      </main>

      <footer class="border-t border-slate-800 bg-slate-950 px-4 py-2 text-[11px] text-slate-500">
        DevTools panels only see requests captured while DevTools is open. Prefer storing parsed tweet data, not cookies or tokens.
      </footer>
    </div>
  );
}

function Toggle(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label class="inline-flex items-center gap-2 text-slate-300">
      <input
        class="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-sky-400"
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      {props.label}
    </label>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div class="rounded-lg border border-slate-800 bg-slate-900/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <strong class="block text-xl font-semibold text-white">{props.value}</strong>
      <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">{props.label}</span>
    </div>
  );
}

function EmptyRequests() {
  return (
    <div class="p-4 text-xs text-slate-500">
      <p class="font-medium text-slate-300">No captures yet.</p>
      <p class="mt-1">Open the Network panel or reload X/Twitter with this panel visible.</p>
    </div>
  );
}

function isXUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return /(^|\.)x\.com$/i.test(url.hostname) || /(^|\.)twitter\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function isBookmarkishUrl(rawUrl: string) {
  const text = rawUrl.toLowerCase();
  return (
    text.includes("bookmark") ||
    text.includes("/i/api/graphql/") ||
    text.includes("/graphql/") ||
    text.includes("tweetdetail") ||
    text.includes("timeline")
  );
}

function isBookmarkishText(text: string) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return (
    lower.includes("bookmark") ||
    lower.includes("bookmarks") ||
    lower.includes("bookmarktweet") ||
    lower.includes("deletebookmark") ||
    lower.includes("timeline_v2") ||
    lower.includes("tweet_results")
  );
}

function makeTags(url: string, requestText: string, responseText: string, tweetLike: TweetLikeRecord[]) {
  const tags = new Set<string>();
  const haystack = `${url}\n${requestText}\n${responseText.slice(0, 20_000)}`.toLowerCase();
  if (haystack.includes("bookmark")) tags.add("bookmark");
  if (haystack.includes("graphql")) tags.add("graphql");
  if (haystack.includes("bookmarktweet")) tags.add("add-bookmark");
  if (haystack.includes("deletebookmark")) tags.add("delete-bookmark");
  if (tweetLike.length > 0) tags.add("tweet-like");
  return [...tags];
}

function parseMaybeJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!text) return { ok: false, error: "empty body" };
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { ok: false, error: "not JSON" };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

function extractTweetLikeRecords(root: unknown) {
  const records: TweetLikeRecord[] = [];
  const seen = new WeakSet<object>();
  const seenIds = new Set<string>();

  function visit(value: unknown, path: string, depth: number) {
    if (records.length >= 1_000 || depth > 40 || value == null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    const candidate = normalizeTweetCandidate(value as Record<string, any>, path);
    if (candidate) {
      const key = candidate.rest_id || candidate.id_str || candidate.path;
      if (!seenIds.has(key)) {
        seenIds.add(key);
        records.push(candidate);
      }
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      visit(child, path ? `${path}.${key}` : key, depth + 1);
    }
  }

  visit(root, "", 0);
  return records;
}

function normalizeTweetCandidate(value: Record<string, any>, path: string): TweetLikeRecord | null {
  const legacy = value.legacy && typeof value.legacy === "object" ? value.legacy : undefined;
  const restId = asString(value.rest_id || legacy?.id_str || value.id_str || value.id);
  const fullText = asString(legacy?.full_text || value.full_text || value.text);
  const user = value.core?.user_results?.result || value.user_results?.result || value.user;
  const userLegacy = user?.legacy;
  const screenName = asString(userLegacy?.screen_name || user?.screen_name || value.screen_name);

  const looksLikeTweet = Boolean(
    fullText && (restId || path.toLowerCase().includes("tweet")) && !path.toLowerCase().includes("user_results"),
  );

  if (!looksLikeTweet) return null;

  return {
    rest_id: restId || undefined,
    id_str: asString(legacy?.id_str || value.id_str) || undefined,
    full_text: fullText,
    created_at: asString(legacy?.created_at || value.created_at) || undefined,
    screen_name: screenName || undefined,
    path,
  };
}

function asString(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function trimOrUndefined(text: string, maxChars: number) {
  if (!text) return undefined;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n… trimmed ${text.length - maxChars} chars`;
}

function byteLength(text: string) {
  return new TextEncoder().encode(text || "").byteLength;
}

function makeSnapshot(captures: Capture[]) {
  return {
    source: snapshotSource(),
    generatedAt: new Date().toISOString(),
    captures,
  };
}

function snapshotSource() {
  return {
    extension: "x-bookmark-sync-devtools",
    version: "0.1.0",
    inspectedTabId: chrome.devtools.inspectedWindow.tabId,
  };
}

async function postSnapshot(snapshot: unknown, endpoint: string) {
  const response = await fetch(endpoint || DEFAULT_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(snapshot),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
}

function downloadJson(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function dateStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function shortUrl(rawUrl: string, max = 90) {
  try {
    const url = new URL(rawUrl);
    const out = `${url.hostname}${url.pathname}${url.search}`;
    return out.length <= max ? out : `${out.slice(0, max - 1)}…`;
  } catch {
    return rawUrl.length <= max ? rawUrl : `${rawUrl.slice(0, max - 1)}…`;
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

function storageGet<T>(keys: string[]): Promise<T> {
  return new Promise((resolve) => chrome.storage.local.get(keys, (value) => resolve(value as T)));
}

function storageSet(value: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(value, () => resolve()));
}

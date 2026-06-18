const LOG_KEY = 'illiterati.debug.logs';
const MAX_LOG_ENTRIES = 300;

export type DebugLogEntry = {
  ts: string;
  scope: string;
  message: string;
  meta?: unknown;
};

let writeQueue: Promise<void> = Promise.resolve();

function getStorage(): chrome.storage.LocalStorageArea | null {
  return globalThis.chrome?.storage?.local ?? null;
}

function cloneMeta(meta: unknown): unknown {
  if (meta === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(meta));
  } catch {
    return String(meta);
  }
}

async function appendDebugLog(entry: DebugLogEntry): Promise<void> {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  const result = await storage.get(LOG_KEY);
  const existing = Array.isArray(result[LOG_KEY]) ? (result[LOG_KEY] as unknown[]) : [];
  const normalized = existing.filter((item) => item && typeof item === 'object');
  const next = [...normalized, entry].slice(-MAX_LOG_ENTRIES);
  await storage.set({ [LOG_KEY]: next });
}

export async function listDebugLogs(): Promise<DebugLogEntry[]> {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  const result = await storage.get(LOG_KEY);
  const raw = Array.isArray(result[LOG_KEY]) ? (result[LOG_KEY] as unknown[]) : [];
  return raw
    .filter((item): item is DebugLogEntry => !!item && typeof item === 'object')
    .map((item) => ({
      ts: typeof item.ts === 'string' ? item.ts : new Date().toISOString(),
      scope: typeof item.scope === 'string' ? item.scope : 'unknown',
      message: typeof item.message === 'string' ? item.message : '',
      meta: item.meta
    }));
}

export async function clearDebugLogs(): Promise<void> {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  await storage.remove(LOG_KEY);
}

export function devLog(scope: string, message: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  if (meta === undefined) {
    console.info(`[illiterati][${ts}][${scope}] ${message}`);
  } else {
    console.info(`[illiterati][${ts}][${scope}] ${message}`, meta);
  }
  const entry: DebugLogEntry = {
    ts,
    scope,
    message,
    meta: cloneMeta(meta)
  };
  writeQueue = writeQueue.then(() => appendDebugLog(entry)).catch(() => undefined);
}

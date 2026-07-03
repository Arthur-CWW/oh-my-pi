import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type ErrorSource = "server" | "client";

export interface AppendErrorInput {
  source: ErrorSource;
  message: string;
  stack?: string;
  url?: string;
  ts?: string;
}

export interface ErrorLogEntry {
  source: ErrorSource;
  message: string;
  stack?: string;
  url?: string;
  ts: string;
}

export const DEFAULT_ERROR_LOG_PATH = resolve("data/scene-lab/errors.log");

export async function appendError(input: AppendErrorInput, logPath = DEFAULT_ERROR_LOG_PATH): Promise<ErrorLogEntry> {
  const entry = normalizeErrorInput(input);
  console.error(`[scene-playground:${entry.source}] ${entry.message}${entry.url === undefined ? "" : ` (${entry.url})`}`);
  if (entry.stack !== undefined) console.error(entry.stack);
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  return entry;
}

export async function listRecentErrors(limit: number, logPath = DEFAULT_ERROR_LOG_PATH): Promise<ErrorLogEntry[]> {
  const safeLimit = normalizeLimit(limit);
  let content = "";
  try {
    content = await readFile(logPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
  const entries: ErrorLogEntry[] = [];
  const lines = content.split("\n");
  for (let index = lines.length - 1; index >= 0 && entries.length < safeLimit; index -= 1) {
    const line = lines[index];
    if (line === undefined || line.trim().length === 0) continue;
    const entry = parseErrorLine(line);
    if (entry !== null) entries.push(entry);
  }
  return entries;
}

export function caughtErrorInput(source: ErrorSource, error: unknown, url?: string): AppendErrorInput {
  if (error instanceof Error) {
    const input: AppendErrorInput = { source, message: error.message };
    if (typeof error.stack === "string") input.stack = error.stack;
    if (url !== undefined) input.url = url;
    return input;
  }
  const input: AppendErrorInput = { source, message: String(error) };
  if (url !== undefined) input.url = url;
  return input;
}

function normalizeErrorInput(input: AppendErrorInput): ErrorLogEntry {
  const entry: ErrorLogEntry = {
    source: input.source,
    message: input.message,
    ts: input.ts ?? new Date().toISOString(),
  };
  if (input.stack !== undefined) entry.stack = input.stack;
  if (input.url !== undefined) entry.url = input.url;
  return entry;
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 50;
  const integer = Math.trunc(limit);
  if (integer < 1) return 1;
  if (integer > 500) return 500;
  return integer;
}

function parseErrorLine(line: string): ErrorLogEntry | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const source = record.source;
    const message = record.message;
    const ts = record.ts;
    if ((source !== "server" && source !== "client") || typeof message !== "string" || typeof ts !== "string") return null;
    const entry: ErrorLogEntry = { source, message, ts };
    if (typeof record.stack === "string") entry.stack = record.stack;
    if (typeof record.url === "string") entry.url = record.url;
    return entry;
  } catch {
    return null;
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface CommitAttribution {
  readonly sessionId: string;
  readonly agentId: string;
}

interface SessionIdentityCandidate {
  readonly file: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly cwd?: string;
  readonly mtimeMs: number;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim().length > 0 ? field.trim() : undefined;
}

async function identityFromFile(file: string): Promise<SessionIdentityCandidate | undefined> {
  let text: string;
  let stat: { mtimeMs: number };
  try {
    [text, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
  } catch {
    return undefined;
  }
  let sessionId: string | undefined;
  let agentId: string | undefined;
  let cwd: string | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (stringField(record, "type") === "session") {
      sessionId = stringField(record, "id") ?? sessionId;
      cwd = stringField(record, "cwd") ?? cwd;
    }
    if (stringField(record, "type") === "session_init") {
      const subagent = record && typeof record === "object" ? (record as Record<string, unknown>).subagent : undefined;
      agentId = stringField(subagent, "agentId") ?? agentId;
    }
    if (sessionId && cwd && agentId) break;
  }
  if (!sessionId) return undefined;
  const stem = path.basename(file, ".jsonl");
  return { file, sessionId, agentId: agentId ?? (stem.includes("-") ? "Main" : stem), cwd, mtimeMs: stat.mtimeMs };
}

async function findLatestSession(cwd: string): Promise<SessionIdentityCandidate | undefined> {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".omp", "agent");
  const sessionsDir = path.join(agentDir, "sessions");
  const files: string[] = [];
  const walk = async (root: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = path.join(root, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(file);
    }
  };
  await walk(sessionsDir);
  const candidates = (await Promise.all(files.map(identityFromFile)))
    .filter((candidate): candidate is SessionIdentityCandidate => candidate !== undefined)
    .filter(candidate => candidate.cwd === cwd)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidates[0];
}

export async function resolveCommitAttribution(cwd = process.cwd()): Promise<CommitAttribution | undefined> {
  const explicit = process.env.PI_SESSION_FILE?.trim();
  const candidate = explicit ? await identityFromFile(explicit) : await findLatestSession(path.resolve(cwd));
  return candidate ? { sessionId: candidate.sessionId, agentId: candidate.agentId } : undefined;
}

export function appendCommitTrailers(message: string, attribution: CommitAttribution | undefined): string {
  if (!attribution) return message;
  const base = message.replace(/[\r\n]+$/, "");
  const lines = base.split("\n");
  const hasSession = lines.some(line => line.startsWith("Session: "));
  const hasAgent = lines.some(line => line.startsWith("Agent: "));
  const trailers = [
    ...(hasSession ? [] : [`Session: ${attribution.sessionId}`]),
    ...(hasAgent ? [] : [`Agent: ${attribution.agentId}`]),
  ];
  return trailers.length === 0 ? base : `${base}\n\n${trailers.join("\n")}`;
}

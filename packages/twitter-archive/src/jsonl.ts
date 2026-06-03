import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export class JsonlParseError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly lineNumber: number,
    public readonly cause: unknown,
  ) {
    super(`Failed to parse ${filePath} at JSONL line ${lineNumber}`)
    this.name = "JsonlParseError"
  }
}

export interface UpsertJsonlResult {
  inserted: number
  updated: number
  total: number
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  let contents: string
  try {
    contents = await readFile(filePath, "utf8")
  } catch (error) {
    if (isErrno(error, "ENOENT")) {
      return []
    }
    throw error
  }

  const records: T[] = []
  const lines = contents.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }

    try {
      records.push(JSON.parse(trimmed) as T)
    } catch (error) {
      throw new JsonlParseError(filePath, index + 1, error)
    }
  }

  return records
}

export async function appendJsonl<T>(filePath: string, records: T | readonly T[]): Promise<void> {
  const array = Array.isArray(records) ? records : [records]
  if (array.length === 0) {
    return
  }

  await mkdir(dirname(filePath), { recursive: true })
  const payload = array.map((record) => JSON.stringify(record)).join("\n") + "\n"
  await writeFile(filePath, payload, { flag: "a" })
}

export async function writeJsonlAtomic<T>(filePath: string, records: readonly T[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const payload = records.map((record) => JSON.stringify(record)).join("\n")
  const contents = payload.length === 0 ? "" : `${payload}\n`
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`

  await writeFile(tempPath, contents)
  await rename(tempPath, filePath)
}

export function dedupeById<T extends { id: string }>(records: Iterable<T>): T[] {
  const byId = new Map<string, T>()
  for (const record of records) {
    byId.set(record.id, record)
  }
  return [...byId.values()]
}

export async function readJsonlById<T extends { id: string }>(filePath: string): Promise<Map<string, T>> {
  const records = await readJsonl<T>(filePath)
  return new Map(records.map((record) => [record.id, record]))
}

export async function upsertJsonlById<T extends { id: string }>(
  filePath: string,
  records: readonly T[],
): Promise<UpsertJsonlResult> {
  const existing = await readJsonl<T>(filePath)
  const order: string[] = []
  const byId = new Map<string, T>()
  for (const record of existing) {
    if (!byId.has(record.id)) {
      order.push(record.id)
    }
    byId.set(record.id, record)
  }
  let inserted = 0
  let updated = 0

  for (const record of records) {
    if (byId.has(record.id)) {
      updated += 1
    } else {
      inserted += 1
      order.push(record.id)
    }
    byId.set(record.id, record)
  }

  await writeJsonlAtomic(
    filePath,
    order.map((id) => byId.get(id)).filter((record): record is T => record !== undefined),
  )

  return { inserted, updated, total: byId.size }
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && (error as NodeJS.ErrnoException).code === code
}

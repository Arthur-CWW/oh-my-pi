import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { Database } from "bun:sqlite"
import { Context, Effect, Layer, Schema } from "effect"
import { and, asc, desc, eq, type SQL } from "drizzle-orm"
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite"

import { StorageError } from "./errors"
import { defaultLedgerPath } from "./ledger"
import {
  lifeQueueItems,
  QueueItemSchema,
  QueuePrioritySchema,
  QueueSourceSchema,
  QueueStatusSchema,
  type QueueItem,
  type QueuePriority,
  type QueueSource,
  type QueueStatus,
} from "./life-queue-schema"
import { setDurabilityPragmas } from "./migrate"

export interface QueueItemInput {
  readonly id?: string
  readonly title: string
  readonly intent: string
  readonly priority: QueuePriority
  readonly source: QueueSource
  readonly contextPacketPath: string
  readonly status?: QueueStatus
  readonly owningAgent?: string | null
  readonly resumeRef?: string | null
  readonly createdAt?: number
}

export interface QueueFilters {
  readonly priority?: QueuePriority
  readonly source?: QueueSource
  readonly status?: QueueStatus
  readonly owningAgent?: string
  readonly limit?: number
  readonly oldestFirst?: boolean
}

export interface QueueInsertResult {
  readonly item: QueueItem
  readonly inserted: boolean
}

export interface QueueStoreShape {
  readonly dbPath: string
  readonly add: (input: QueueItemInput) => Effect.Effect<QueueInsertResult, StorageError>
  readonly list: (filters?: QueueFilters) => Effect.Effect<readonly QueueItem[], StorageError>
  readonly show: (id: string) => Effect.Effect<QueueItem | null, StorageError>
  readonly transition: (id: string, status: QueueStatus, now?: number) => Effect.Effect<QueueItem, StorageError>
  readonly close: () => void
}

export class QueueStore extends Context.Service<QueueStore, QueueStoreShape>()("ControlPlane/QueueStore") {}

type QueueDb = BunSQLiteDatabase

const allowedTransitions: Readonly<Record<QueueStatus, readonly QueueStatus[]>> = {
  inbox: ["triaged", "active", "dropped"],
  triaged: ["active", "paused", "dropped"],
  active: ["paused", "done", "dropped"],
  paused: ["active", "dropped"],
  done: [],
  dropped: [],
}

export function openQueueStore(dbPath: string = defaultLedgerPath()): Layer.Layer<QueueStore, StorageError> {
  return Layer.effect(
    QueueStore,
    Effect.acquireRelease(
      Effect.try({
        try: () => makeQueueStore(dbPath),
        catch: (cause) => storageError("openQueueStore", cause, dbPath),
      }),
      (store) => Effect.sync(() => store.close()),
    ),
  )
}

function makeQueueStore(dbPath: string): QueueStoreShape {
  if (dbPath !== ":memory:") mkdirSync(dirname(resolve(dbPath)), { recursive: true })
  const sqlite = new Database(dbPath)
  setDurabilityPragmas(sqlite)
  migrateQueue(sqlite)
  const db = drizzle(sqlite)
  return {
    dbPath,
    add: Effect.fn("QueueStore.add")((input: QueueItemInput) => storageEffect("add", () => insertItem(db, input))),
    list: Effect.fn("QueueStore.list")((filters: QueueFilters = {}) => storageEffect("list", () => listItems(db, filters))),
    show: Effect.fn("QueueStore.show")((id: string) => storageEffect("show", () => findItem(db, id))),
    transition: Effect.fn("QueueStore.transition")((id: string, status: QueueStatus, now = Date.now()) =>
      storageEffect("transition", () => transitionItem(db, id, status, now)),
    ),
    close: () => sqlite.close(),
  }
}

function migrateQueue(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS life_queue_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      intent TEXT NOT NULL,
      priority TEXT NOT NULL,
      source TEXT NOT NULL,
      contextPacketPath TEXT NOT NULL,
      status TEXT NOT NULL,
      owningAgent TEXT,
      resumeRef TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS life_queue_status_created_idx ON life_queue_items (status, createdAt);
    CREATE INDEX IF NOT EXISTS life_queue_source_resume_idx ON life_queue_items (source, resumeRef);
  `)
}

function insertItem(db: QueueDb, input: QueueItemInput): QueueInsertResult {
  const createdAt = input.createdAt ?? Date.now()
  const item = decodeItem({
    id: input.id ?? crypto.randomUUID(),
    title: input.title.trim(),
    intent: input.intent.trim(),
    priority: decodePriority(input.priority),
    source: decodeSource(input.source),
    contextPacketPath: input.contextPacketPath,
    status: decodeStatus(input.status ?? "inbox"),
    owningAgent: input.owningAgent ?? null,
    resumeRef: input.resumeRef ?? null,
    createdAt,
    updatedAt: createdAt,
  })
  if (item.title.length === 0 || item.intent.length === 0) throw new Error("title and intent must not be empty")
  const rows = db.insert(lifeQueueItems).values(item).onConflictDoNothing().returning().all()
  return { item: rows.length === 0 ? findItem(db, item.id) ?? item : decodeItem(rows[0]), inserted: rows.length > 0 }
}

function listItems(db: QueueDb, filters: QueueFilters): QueueItem[] {
  const conditions: SQL[] = []
  if (filters.priority !== undefined) conditions.push(eq(lifeQueueItems.priority, decodePriority(filters.priority)))
  if (filters.source !== undefined) conditions.push(eq(lifeQueueItems.source, decodeSource(filters.source)))
  if (filters.status !== undefined) conditions.push(eq(lifeQueueItems.status, decodeStatus(filters.status)))
  if (filters.owningAgent !== undefined) conditions.push(eq(lifeQueueItems.owningAgent, filters.owningAgent))
  const limit = filters.limit ?? 100
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error("limit must be an integer from 1 to 10000")
  const order = filters.oldestFirst ? asc(lifeQueueItems.createdAt) : desc(lifeQueueItems.updatedAt)
  const query = db.select().from(lifeQueueItems).where(conditions.length === 0 ? undefined : and(...conditions)).orderBy(order).limit(limit)
  return query.all().map(decodeItem)
}

function findItem(db: QueueDb, id: string): QueueItem | null {
  const row = db.select().from(lifeQueueItems).where(eq(lifeQueueItems.id, id)).limit(1).get()
  return row === undefined ? null : decodeItem(row)
}

function transitionItem(db: QueueDb, id: string, status: QueueStatus, now: number): QueueItem {
  const target = decodeStatus(status)
  const current = findItem(db, id)
  if (current === null) throw new Error(`queue item not found: ${id}`)
  if (!allowedTransitions[current.status].includes(target)) {
    throw new Error(`invalid queue transition: ${current.status} -> ${target}`)
  }
  db.update(lifeQueueItems).set({ status: target, updatedAt: now }).where(eq(lifeQueueItems.id, id)).run()
  return findItem(db, id) as QueueItem
}

function decodeItem(value: unknown): QueueItem {
  return Schema.decodeUnknownSync(QueueItemSchema)(value)
}

function decodePriority(value: unknown): QueuePriority {
  return Schema.decodeUnknownSync(QueuePrioritySchema)(value)
}

function decodeSource(value: unknown): QueueSource {
  return Schema.decodeUnknownSync(QueueSourceSchema)(value)
}

function decodeStatus(value: unknown): QueueStatus {
  return Schema.decodeUnknownSync(QueueStatusSchema)(value)
}

function storageEffect<A>(operation: string, thunk: () => A): Effect.Effect<A, StorageError> {
  return Effect.try({ try: thunk, catch: (cause) => storageError(operation, cause) })
}

function storageError(operation: string, cause: unknown, context?: string): StorageError {
  return new StorageError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause: cause instanceof Error ? cause.name : undefined,
    context,
  })
}

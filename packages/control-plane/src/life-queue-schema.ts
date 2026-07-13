import { Schema } from "effect"
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const QueuePrioritySchema = Schema.Literals(["p0", "p1", "p2", "p3"])
export type QueuePriority = Schema.Schema.Type<typeof QueuePrioritySchema>

export const QueueSourceSchema = Schema.Literals(["manual", "session-scan", "rant", "bookmark", "email"])
export type QueueSource = Schema.Schema.Type<typeof QueueSourceSchema>

export const QueueStatusSchema = Schema.Literals(["inbox", "triaged", "active", "paused", "done", "dropped"])
export type QueueStatus = Schema.Schema.Type<typeof QueueStatusSchema>

export const QueueItemSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  intent: Schema.String,
  priority: QueuePrioritySchema,
  source: QueueSourceSchema,
  contextPacketPath: Schema.String,
  status: QueueStatusSchema,
  owningAgent: Schema.NullOr(Schema.String),
  resumeRef: Schema.NullOr(Schema.String),
  createdAt: Schema.Int,
  updatedAt: Schema.Int,
})
export type QueueItem = Schema.Schema.Type<typeof QueueItemSchema>

export const lifeQueueItems = sqliteTable(
  "life_queue_items",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    intent: text("intent").notNull(),
    priority: text("priority").notNull(),
    source: text("source").notNull(),
    contextPacketPath: text("contextPacketPath").notNull(),
    status: text("status").notNull(),
    owningAgent: text("owningAgent"),
    resumeRef: text("resumeRef"),
    createdAt: integer("createdAt").notNull(),
    updatedAt: integer("updatedAt").notNull(),
  },
  (table) => [
    index("life_queue_status_created_idx").on(table.status, table.createdAt),
    index("life_queue_source_resume_idx").on(table.source, table.resumeRef),
  ],
)

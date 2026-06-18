import { Schema } from "effect";

export const CaptureTargetType = Schema.Union([
  Schema.Literal("user-profile"),
  Schema.Literal("user-timeline"),
  Schema.Literal("tweet-thread"),
  Schema.Literal("search-query"),
  Schema.Literal("hashtag"),
  Schema.Literal("direct-messages"),
  Schema.Literal("settings"),
  Schema.Literal("bookmarks"),
  Schema.Literal("likes"),
  Schema.Literal("notifications")
]);
export type CaptureTargetType = Schema.Schema.Type<typeof CaptureTargetType>;

export const CaptureTarget = Schema.Struct({
  type: CaptureTargetType,
  value: Schema.String,
  username: Schema.optional(Schema.String),
  protected: Schema.optional(Schema.Boolean)
});
export type CaptureTarget = Schema.Schema.Type<typeof CaptureTarget>;

export const CaptureJobStatus = Schema.Union([
  Schema.Literal("pending"),
  Schema.Literal("processing"),
  Schema.Literal("completed"),
  Schema.Literal("failed"),
  Schema.Literal("stopped")
]);
export type CaptureJobStatus = Schema.Schema.Type<typeof CaptureJobStatus>;

export const CaptureSessionInfo = Schema.Struct({
  userId: Schema.optional(Schema.String),
  userAgent: Schema.String,
  ipCountry: Schema.optional(Schema.String)
});
export type CaptureSessionInfo = Schema.Schema.Type<typeof CaptureSessionInfo>;

export const CaptureProvenance = Schema.Struct({
  sourceUrl: Schema.String,
  capturedAt: Schema.String, // ISO Date string
  sessionInfo: CaptureSessionInfo,
  rawPayloadChecksum: Schema.optional(Schema.String),
  runId: Schema.String
});
export type CaptureProvenance = Schema.Schema.Type<typeof CaptureProvenance>;

export const CaptureJob = Schema.Struct({
  id: Schema.String,
  target: CaptureTarget,
  status: CaptureJobStatus,
  priority: Schema.Number,
  createdTime: Schema.Number,
  startedTime: Schema.optional(Schema.Number),
  endedTime: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  provenance: Schema.optional(CaptureProvenance)
});
export type CaptureJob = Schema.Schema.Type<typeof CaptureJob>;

export const StopConditionInput = Schema.Struct({
  status: Schema.Number,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.optional(Schema.String),
  html: Schema.optional(Schema.String)
});
export type StopConditionInput = Schema.Schema.Type<typeof StopConditionInput>;

export const StopConditionResult = Schema.Struct({
  shouldStop: Schema.Boolean,
  reason: Schema.optional(Schema.String)
});
export type StopConditionResult = Schema.Schema.Type<typeof StopConditionResult>;

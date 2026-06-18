import { join, resolve } from "node:path"

import { Context, Effect, Layer, Schema } from "effect"

import { NITTER_DEFAULT_BASE_URL, NITTER_HARD_MAX_PAGES } from "./nitter"
import {
  appendTwitterArchiveJsonlLogEffect,
  type JsonlLogWriteError,
  type TwitterArchiveLogEvent,
  type TwitterArchiveLogEventInput,
} from "./jsonl-log"
import {
  initTwitterArchiveSqliteStore,
  openTwitterArchiveSqliteStore,
  type OpenTwitterArchiveSqliteStoreOptions,
  type TwitterArchiveSqliteStore,
} from "./sqlite-store"

export const DEFAULT_TWITTER_ARCHIVE_DATA_DIR = resolve(import.meta.dir, "../../..", "data/twitter-archive")
export const DEFAULT_TWITTER_ARCHIVE_DB_PATH = join(DEFAULT_TWITTER_ARCHIVE_DATA_DIR, "twitter-archive.sqlite")
export const DEFAULT_TWITTER_ARCHIVE_LOG_PATH = join(DEFAULT_TWITTER_ARCHIVE_DATA_DIR, "twitter-archive.jsonl")
export const DEFAULT_TWITTER_ARCHIVE_MEDIA_ROOT = join(DEFAULT_TWITTER_ARCHIVE_DATA_DIR, "media")
export const DEFAULT_TWITTER_ARCHIVE_MARKDOWN_ROOT = join(DEFAULT_TWITTER_ARCHIVE_DATA_DIR, "markdown")
export const DEFAULT_TWITTER_ARCHIVE_PORT = 3420
export const DEFAULT_TWITTER_ARCHIVE_MAX_ITEMS = 200

const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
const PortNumber = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(65535),
)

export const TwitterArchiveEnvConfigSchema = Schema.Struct({
  dbPath: Schema.NonEmptyString,
  logPath: Schema.NonEmptyString,
  mediaRoot: Schema.NonEmptyString,
  markdownRoot: Schema.NonEmptyString,
  port: PortNumber,
  baseUrl: Schema.URLFromString,
  maxPages: PositiveInteger,
  maxItems: PositiveInteger,
})

type TwitterArchiveDecodedEnvConfig = Schema.Schema.Type<typeof TwitterArchiveEnvConfigSchema>

export interface TwitterArchiveAppConfig {
  readonly dbPath: string
  readonly logPath: string
  readonly mediaRoot: string
  readonly port: number
  readonly markdownRoot: string
  readonly baseUrl: string
  readonly maxPages: number
  readonly maxItems: number
}

export interface TwitterArchiveConfigEnv {
  readonly TWITTER_ARCHIVE_DB?: string
  readonly NITTER_SQLITE_PATH?: string
  readonly TWITTER_ARCHIVE_LOG?: string
  readonly TWITTER_ARCHIVE_LOG_PATH?: string
  readonly TWITTER_ARCHIVE_MEDIA_ROOT?: string
  readonly TWITTER_ARCHIVE_MARKDOWN_ROOT?: string
  readonly TWITTER_ARCHIVE_PORT?: string
  readonly PORT?: string
  readonly TWITTER_ARCHIVE_BASE_URL?: string
  readonly NITTER_BASE_URL?: string
  readonly TWITTER_ARCHIVE_MAX_PAGES?: string
  readonly NITTER_MAX_PAGES?: string
  readonly TWITTER_ARCHIVE_MAX_ITEMS?: string
  readonly [key: string]: string | undefined
}

export class ConfigParseError extends Schema.TaggedErrorClass<ConfigParseError>()("ConfigParseError", {
  message: Schema.String,
  cause: Schema.optionalKey(Schema.String),
}) {}

export class SqliteStoreLifecycleError extends Schema.TaggedErrorClass<SqliteStoreLifecycleError>()(
  "SqliteStoreLifecycleError",
  {
    dbPath: Schema.String,
    action: Schema.String,
    message: Schema.String,
  },
) {}

export class FetchClientError extends Schema.TaggedErrorClass<FetchClientError>()("FetchClientError", {
  url: Schema.String,
  message: Schema.String,
}) {}

export interface TwitterArchiveJsonlLoggerService {
  readonly logPath: string
  readonly log: (input: TwitterArchiveLogEventInput) => Effect.Effect<TwitterArchiveLogEvent, JsonlLogWriteError>
}

export interface TwitterArchiveSqliteStoreService {
  readonly dbPath: string
  readonly store: TwitterArchiveSqliteStore
}

export interface TwitterArchiveFetchClientService {
  readonly fetch: (url: string, init?: RequestInit) => Effect.Effect<Response, FetchClientError>
}

export interface TwitterArchiveSqliteStoreLayerOptions extends OpenTwitterArchiveSqliteStoreOptions {
  readonly initSchema?: boolean
}

export class TwitterArchiveConfig extends Context.Service<TwitterArchiveConfig, TwitterArchiveAppConfig>()(
  "TwitterArchive/Config",
) {}

export class TwitterArchiveJsonlLogger extends Context.Service<
  TwitterArchiveJsonlLogger,
  TwitterArchiveJsonlLoggerService
>()("TwitterArchive/JsonlLogger") {}

export class TwitterArchiveSqliteStoreServiceTag extends Context.Service<
  TwitterArchiveSqliteStoreServiceTag,
  TwitterArchiveSqliteStoreService
>()("TwitterArchive/SqliteStore") {}

export class TwitterArchiveFetchClient extends Context.Service<
  TwitterArchiveFetchClient,
  TwitterArchiveFetchClientService
>()("TwitterArchive/FetchClient") {}

export function readTwitterArchiveConfig(env: TwitterArchiveConfigEnv = runtimeConfigEnv()): TwitterArchiveAppConfig {
  const decoded = Schema.decodeUnknownSync(TwitterArchiveEnvConfigSchema)({
    dbPath: firstNonEmpty(env.TWITTER_ARCHIVE_DB, env.NITTER_SQLITE_PATH) ?? DEFAULT_TWITTER_ARCHIVE_DB_PATH,
    logPath: firstNonEmpty(env.TWITTER_ARCHIVE_LOG, env.TWITTER_ARCHIVE_LOG_PATH) ?? DEFAULT_TWITTER_ARCHIVE_LOG_PATH,
    mediaRoot: firstNonEmpty(env.TWITTER_ARCHIVE_MEDIA_ROOT) ?? DEFAULT_TWITTER_ARCHIVE_MEDIA_ROOT,
    markdownRoot: firstNonEmpty(env.TWITTER_ARCHIVE_MARKDOWN_ROOT) ?? DEFAULT_TWITTER_ARCHIVE_MARKDOWN_ROOT,
    port: parseInteger(firstNonEmpty(env.TWITTER_ARCHIVE_PORT, env.PORT), DEFAULT_TWITTER_ARCHIVE_PORT),
    baseUrl: firstNonEmpty(env.TWITTER_ARCHIVE_BASE_URL, env.NITTER_BASE_URL) ?? NITTER_DEFAULT_BASE_URL,
    maxPages: parseInteger(firstNonEmpty(env.TWITTER_ARCHIVE_MAX_PAGES, env.NITTER_MAX_PAGES), 1),
    maxItems: parseInteger(firstNonEmpty(env.TWITTER_ARCHIVE_MAX_ITEMS), DEFAULT_TWITTER_ARCHIVE_MAX_ITEMS),
  })
  return decodedEnvConfigToAppConfig(decoded)
}

export const parseTwitterArchiveConfigEffect = Effect.fn("parseTwitterArchiveConfigEffect")(function*(
  env?: TwitterArchiveConfigEnv,
) {
  return yield* Effect.try({
    try: () => readTwitterArchiveConfig(env ?? runtimeConfigEnv()),
    catch: (error) =>
      new ConfigParseError({
        message: "Invalid Twitter archive configuration",
        cause: error instanceof Error ? error.message : String(error),
      }),
  })
})

export function makeTwitterArchiveConfigLayer(env?: TwitterArchiveConfigEnv): Layer.Layer<TwitterArchiveConfig, ConfigParseError> {
  return Layer.effect(TwitterArchiveConfig, parseTwitterArchiveConfigEffect(env))
}

export function makeTwitterArchiveJsonlLogger(logPath: string): TwitterArchiveJsonlLoggerService {
  return {
    logPath,
    log: Effect.fn("TwitterArchiveJsonlLogger.log")(function*(input: TwitterArchiveLogEventInput) {
      return yield* appendTwitterArchiveJsonlLogEffect(logPath, input)
    }),
  }
}

export const TwitterArchiveJsonlLoggerLayer = Layer.effect(
  TwitterArchiveJsonlLogger,
  Effect.gen(function*() {
    const config = yield* TwitterArchiveConfig
    return makeTwitterArchiveJsonlLogger(config.logPath)
  }),
)

export const openTwitterArchiveSqliteStoreEffect = Effect.fn("openTwitterArchiveSqliteStoreEffect")(function*(
  dbPath: string,
  options: TwitterArchiveSqliteStoreLayerOptions = {},
) {
  return yield* Effect.try({
    try: () =>
      options.readonly || options.initSchema === false
        ? openTwitterArchiveSqliteStore(dbPath, options)
        : initTwitterArchiveSqliteStore(dbPath, options),
    catch: (error) =>
      new SqliteStoreLifecycleError({
        dbPath,
        action: "open",
        message: error instanceof Error ? error.message : String(error),
      }),
  })
})

export const openTwitterArchiveSqliteStoreScoped = Effect.fn("openTwitterArchiveSqliteStoreScoped")(function*(
  dbPath: string,
  options: TwitterArchiveSqliteStoreLayerOptions = {},
) {
  return yield* Effect.acquireRelease(
    openTwitterArchiveSqliteStoreEffect(dbPath, options),
    (store) =>
      Effect.sync(() => {
        try {
          store.close()
        } catch {
          // Scope finalizers cannot fail; close errors are intentionally ignored here.
        }
      }),
  )
})

export function makeTwitterArchiveSqliteStoreLayer(
  options: TwitterArchiveSqliteStoreLayerOptions = {},
): Layer.Layer<TwitterArchiveSqliteStoreServiceTag, SqliteStoreLifecycleError, TwitterArchiveConfig> {
  return Layer.effect(
    TwitterArchiveSqliteStoreServiceTag,
    Effect.gen(function*() {
      const config = yield* TwitterArchiveConfig
      const store = yield* openTwitterArchiveSqliteStoreScoped(config.dbPath, options)
      return { dbPath: config.dbPath, store }
    }),
  )
}

export function makeTwitterArchiveFetchClient(fetchFn: typeof fetch = fetch): TwitterArchiveFetchClientService {
  return {
    fetch: Effect.fn("TwitterArchiveFetchClient.fetch")(function*(url: string, init?: RequestInit) {
      return yield* Effect.tryPromise({
        try: (signal) => fetchFn(url, { ...init, signal: init?.signal ?? signal }),
        catch: (error) =>
          new FetchClientError({
            url,
            message: error instanceof Error ? error.message : String(error),
          }),
      })
    }),
  }
}

export function makeTwitterArchiveFetchClientLayer(fetchFn: typeof fetch = fetch): Layer.Layer<TwitterArchiveFetchClient> {
  return Layer.succeed(TwitterArchiveFetchClient, makeTwitterArchiveFetchClient(fetchFn))
}


function decodedEnvConfigToAppConfig(decoded: TwitterArchiveDecodedEnvConfig): TwitterArchiveAppConfig {
  return {
    dbPath: decoded.dbPath,
    logPath: decoded.logPath,
    mediaRoot: decoded.mediaRoot,
    markdownRoot: decoded.markdownRoot,
    port: decoded.port,
    baseUrl: decoded.baseUrl.href.replace(/\/+$/, ""),
    maxPages: Math.min(decoded.maxPages, NITTER_HARD_MAX_PAGES),
    maxItems: decoded.maxItems,
  }
}

function runtimeConfigEnv(): TwitterArchiveConfigEnv {
  if (typeof Bun !== "undefined") {
    return Bun.env
  }
  return {}
}

function firstNonEmpty(...values: ReadonlyArray<string | undefined>): string | undefined {
  for (const value of values) {
    if (value && value.trim().length > 0) {
      return value
    }
  }
  return undefined
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback
  }
  return Number(value)
}

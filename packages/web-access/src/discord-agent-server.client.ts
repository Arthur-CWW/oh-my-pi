import { Effect } from "effect"
import { toErrorMessage } from "./schemas"

export type DiscordJson = null | boolean | number | string | DiscordJson[] | { [key: string]: DiscordJson }

export interface DiscordUserSummary {
  id: string
  username: string
  discriminator: string | null
  globalName: string | null
  bot: boolean
}

export interface DiscordMessageSummary {
  id: string
  channelId: string
  authorId: string
  authorName: string
  authorBot: boolean
  content: string
  timestamp: string
  referencedMessageId: string | null
  attachmentCount: number
}

export interface DiscordSentMessage {
  id: string
  channelId: string
  content: string
  timestamp: string
}

export interface DiscordRateLimitInfo {
  limit: string | null
  remaining: string | null
  reset: string | null
  resetAfter: string | null
  bucket: string | null
  scope: string | null
  retryAfterHeader: string | null
  global: boolean
  retryAfter: number | null
}

export interface DiscordAllowedMentions {
  parse: string[]
  users?: string[]
  replied_user?: boolean
}

export interface DiscordMessageReference {
  message_id: string
  channel_id?: string
  fail_if_not_exists?: boolean
}

export interface DiscordEmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface DiscordEmbedFooter {
  text: string
}

export interface DiscordEmbed {
  title?: string
  description?: string
  color?: number
  fields?: DiscordEmbedField[]
  footer?: DiscordEmbedFooter
  timestamp?: string
}

export interface DiscordLinkButtonComponent {
  type: 2
  style: 5
  label: string
  url: string
}

export interface DiscordActionRowComponent {
  type: 1
  components: DiscordLinkButtonComponent[]
}

export interface DiscordSendMessagePayload {
  content?: string
  allowed_mentions: DiscordAllowedMentions
  message_reference?: DiscordMessageReference
  embeds?: DiscordEmbed[]
  components?: DiscordActionRowComponent[]
}

export class DiscordApiError extends Error {
  readonly status: number
  readonly code: number | null
  readonly rateLimit: DiscordRateLimitInfo | null
  readonly retryAfter: number | null

  constructor(message: string, options: { status: number; code?: number; rateLimit?: DiscordRateLimitInfo | null; retryAfter?: number | null }) {
    super(message)
    this.name = "DiscordApiError"
    this.status = options.status
    this.code = options.code ?? null
    this.rateLimit = options.rateLimit ?? null
    this.retryAfter = options.retryAfter ?? options.rateLimit?.retryAfter ?? null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function booleanValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : false
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key]
  return isRecord(value) ? value : null
}

function rateLimitFromHeaders(headers: Headers, body: Record<string, unknown> | null): DiscordRateLimitInfo | null {
  const retryAfterHeader = headers.get("retry-after")
  const headerRetryAfter = retryAfterHeader === null ? null : Number(retryAfterHeader)
  const bodyRetryAfter = numberValue(body?.retry_after)
  const retryAfter = bodyRetryAfter ?? (Number.isFinite(headerRetryAfter) ? headerRetryAfter : null)
  const global = headers.get("x-ratelimit-global") === "true" || booleanValue(body?.global)
  const info: DiscordRateLimitInfo = {
    limit: headers.get("x-ratelimit-limit"),
    remaining: headers.get("x-ratelimit-remaining"),
    reset: headers.get("x-ratelimit-reset"),
    resetAfter: headers.get("x-ratelimit-reset-after"),
    bucket: headers.get("x-ratelimit-bucket"),
    scope: headers.get("x-ratelimit-scope"),
    retryAfterHeader,
    global,
    retryAfter,
  }
  if (info.limit === null && info.remaining === null && info.reset === null && info.resetAfter === null && info.bucket === null && info.scope === null && info.retryAfterHeader === null && !global && retryAfter === null) return null
  return info
}

function userName(user: Record<string, unknown>): string {
  return stringValue(user.global_name) ?? stringValue(user.username) ?? String(user.id ?? "unknown")
}


export function buildDiscordApiError(response: Response, body: unknown, fallbackMessage: string): DiscordApiError {
  const record = isRecord(body) ? body : null
  const rateLimit = rateLimitFromHeaders(response.headers, record)
  const message = stringValue(record?.message) ?? fallbackMessage
  const code = numberValue(record?.code) ?? undefined
  const suffix = response.status === 429 && rateLimit?.retryAfter !== null && rateLimit?.retryAfter !== undefined ? ` (retry_after ${rateLimit.retryAfter}s)` : ""
  return new DiscordApiError(`${message}${suffix}`, { status: response.status, code, rateLimit })
}
export function buildDiscordSendMessagePayload(
  content: string,
  options: { replyToMessageId?: string; channelId?: string; allowUserMentions?: string[]; repliedUser?: boolean; embeds?: DiscordEmbed[]; components?: DiscordActionRowComponent[] } = {},
): DiscordSendMessagePayload {
  const trimmed = content.trim()
  if (!trimmed && !options.embeds?.length && !options.components?.length) throw new DiscordApiError("Discord message content, embed, or component is required", { status: 0 })
  const payload: DiscordSendMessagePayload = {
    allowed_mentions: {
      parse: [],
      replied_user: options.repliedUser === true,
    },
  }
  if (trimmed) payload.content = trimmed
  if (options.allowUserMentions && options.allowUserMentions.length > 0) {
    payload.allowed_mentions.users = options.allowUserMentions
  }
  if (options.embeds && options.embeds.length > 0) payload.embeds = options.embeds
  if (options.components && options.components.length > 0) payload.components = options.components
  if (options.replyToMessageId) {
    payload.message_reference = {
      message_id: options.replyToMessageId,
      ...(options.channelId ? { channel_id: options.channelId } : {}),
      fail_if_not_exists: false,
    }
  }
  return payload
}

export function decodeDiscordUser(value: unknown): DiscordUserSummary {
  if (!isRecord(value)) throw new DiscordApiError("Discord user response is not an object", { status: 0 })
  const id = stringValue(value.id)
  const username = stringValue(value.username)
  if (id === null || username === null) throw new DiscordApiError("Discord user response is missing id or username", { status: 0 })
  return {
    id,
    username,
    discriminator: stringValue(value.discriminator),
    globalName: stringValue(value.global_name),
    bot: booleanValue(value.bot),
  }
}

export function summarizeDiscordMessage(value: unknown): DiscordMessageSummary {
  if (!isRecord(value)) throw new DiscordApiError("Discord message response is not an object", { status: 0 })
  const id = stringValue(value.id)
  const channelId = stringValue(value.channel_id)
  const author = recordField(value, "author")
  const timestamp = stringValue(value.timestamp)
  if (id === null || channelId === null || author === null || timestamp === null) {
    throw new DiscordApiError("Discord message response is missing id, channel_id, author, or timestamp", { status: 0 })
  }
  return {
    id,
    channelId,
    authorId: stringValue(author.id) ?? "unknown",
    authorName: userName(author),
    authorBot: booleanValue(author.bot),
    content: stringValue(value.content) ?? "",
    timestamp,
    referencedMessageId: recordField(value, "referenced_message") ? stringValue(recordField(value, "referenced_message")?.id) : null,
    attachmentCount: arrayValue(value.attachments).length,
  }
}

export function decodeDiscordMessages(value: unknown): DiscordMessageSummary[] {
  if (!Array.isArray(value)) throw new DiscordApiError("Discord messages response is not an array", { status: 0 })
  return value.map((message) => summarizeDiscordMessage(message)).sort((left, right) => {
    const leftTime = Date.parse(left.timestamp)
    const rightTime = Date.parse(right.timestamp)
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime
    return left.id.localeCompare(right.id)
  })
}

export function decodeDiscordSentMessage(value: unknown): DiscordSentMessage {
  const summary = summarizeDiscordMessage(value)
  return { id: summary.id, channelId: summary.channelId, content: summary.content, timestamp: summary.timestamp }
}

const discordApiRequest = Effect.fn("discordApiRequest")(function* (
  token: string,
  method: string,
  path: string,
  payload: DiscordSendMessagePayload | null,
) {
  if (!token.trim()) return yield* Effect.fail(new DiscordApiError("Discord bot token is required", { status: 0 }))
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(`https://discord.com/api/v10${path}`, {
        method,
        headers: {
          authorization: `Bot ${token}`,
          "content-type": "application/json",
        },
        body: payload === null ? undefined : JSON.stringify(payload),
      }),
    catch: (err) => new DiscordApiError(`Discord API ${method} ${path} request failed: ${toErrorMessage(err)}`, { status: 0 }),
  })
  const text = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: (err) => new DiscordApiError(`Discord API ${method} ${path} response read failed: ${toErrorMessage(err)}`, { status: response.status }),
  })
  const parsed = yield* Effect.try({
    try: () => text ? JSON.parse(text) as unknown : null,
    catch: (err) => new DiscordApiError(`Discord API ${method} ${path} returned invalid JSON: ${toErrorMessage(err)}`, { status: response.status }),
  })
  if (!response.ok) return yield* Effect.fail(buildDiscordApiError(response, parsed, `Discord API ${method} ${path} failed`))
  return parsed
})

export const getDiscordMe = Effect.fn("getDiscordMe")(function* (token: string) {
  const value = yield* discordApiRequest(token, "GET", "/users/@me", null)
  return yield* Effect.try({
    try: () => decodeDiscordUser(value),
    catch: (err) => err instanceof DiscordApiError ? err : new DiscordApiError(`Discord API GET /users/@me response decode failed: ${toErrorMessage(err)}`, { status: 200 }),
  })
})

export const fetchDiscordMessages = Effect.fn("fetchDiscordMessages")(function* (
  token: string,
  channelId: string,
  options: { limit?: number; before?: string; after?: string; around?: string } = {},
) {
  const params = new URLSearchParams()
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  if (options.before) params.set("before", options.before)
  if (options.after) params.set("after", options.after)
  if (options.around) params.set("around", options.around)
  const query = params.size > 0 ? `?${params.toString()}` : ""
  const path = `/channels/${encodeURIComponent(channelId)}/messages${query}`
  const value = yield* discordApiRequest(token, "GET", path, null)
  return yield* Effect.try({
    try: () => decodeDiscordMessages(value),
    catch: (err) => err instanceof DiscordApiError ? err : new DiscordApiError(`Discord API GET ${path} response decode failed: ${toErrorMessage(err)}`, { status: 200 }),
  })
})

export const sendDiscordMessage = Effect.fn("sendDiscordMessage")(function* (
  token: string,
  channelId: string,
  content: string,
  options: { replyToMessageId?: string; allowUserMentions?: string[]; repliedUser?: boolean; embeds?: DiscordEmbed[]; components?: DiscordActionRowComponent[] } = {},
) {
  const payload = yield* Effect.try({
    try: () => buildDiscordSendMessagePayload(content, { ...options, channelId }),
    catch: (err) => err instanceof DiscordApiError ? err : new DiscordApiError(`Discord message payload failed: ${toErrorMessage(err)}`, { status: 0 }),
  })
  const path = `/channels/${encodeURIComponent(channelId)}/messages`
  const value = yield* discordApiRequest(token, "POST", path, payload)
  return yield* Effect.try({
    try: () => decodeDiscordSentMessage(value),
    catch: (err) => err instanceof DiscordApiError ? err : new DiscordApiError(`Discord API POST ${path} response decode failed: ${toErrorMessage(err)}`, { status: 200 }),
  })
})

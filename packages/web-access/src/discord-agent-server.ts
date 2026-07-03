import { Effect } from "effect"
import {
  fetchDiscordMessages,
  getDiscordMe,
  sendDiscordMessage,
  type DiscordMessageSummary,
  type DiscordSentMessage,
  type DiscordUserSummary,
} from "./discord-agent-server.client"

export type DiscordAgentServerAction = "config" | "getMe" | "fetchMessages" | "sendMessage"

export interface DiscordAgentServerConfig {
  botToken: string
  channelId?: string
  threadId?: string
}

export interface DiscordAgentServerInput {
  action: DiscordAgentServerAction
  botToken?: string
  channelId?: string
  threadId?: string
  text?: string
  limit?: number
  before?: string
  after?: string
  around?: string
  replyToMessageId?: string
}

export interface DiscordAgentServerResult {
  action: DiscordAgentServerAction
  text: string
  details: DiscordAgentServerDetails
}

export type DiscordAgentServerDetails =
  | { action: "config"; token: string; channelId: string | null; threadId: string | null }
  | { action: "getMe"; token: string; bot: DiscordUserSummary }
  | { action: "fetchMessages"; token: string; channelId: string; messages: DiscordMessageSummary[] }
  | { action: "sendMessage"; token: string; channelId: string; sent: DiscordSentMessage }

export function redactDiscordToken(token: string): string {
  const trimmed = token.trim()
  if (trimmed.length <= 10) return "…"
  return `${trimmed.slice(0, 6)}…${trimmed.slice(-4)}`
}

export function loadDiscordAgentServerConfig(
  env: Record<string, string | undefined>,
  overrides: { botToken?: string; channelId?: string; threadId?: string } = {},
): DiscordAgentServerConfig {
  const botToken = overrides.botToken?.trim() || env.OMP_DISCORD_BOT_TOKEN?.trim() || env.DISCORD_BOT_TOKEN?.trim() || ""
  const channelId = overrides.channelId?.trim() || env.OMP_DISCORD_CHANNEL_ID?.trim() || env.DISCORD_CHANNEL_ID?.trim()
  const threadId = overrides.threadId?.trim() || env.OMP_DISCORD_THREAD_ID?.trim() || env.DISCORD_THREAD_ID?.trim()
  return {
    botToken,
    ...(channelId ? { channelId } : {}),
    ...(threadId ? { threadId } : {}),
  }
}

export function formatDiscordMessages(messages: DiscordMessageSummary[]): string {
  if (messages.length === 0) return "No Discord messages returned. Check channel id, permissions, and Read Message History."
  const lines = [`${messages.length} Discord message(s), chronological:`]
  for (const message of messages) {
    const text = message.content.replace(/\s+/g, " ").slice(0, 180) || (message.attachmentCount > 0 ? `<${message.attachmentCount} attachment(s)>` : "<empty message>")
    const bot = message.authorBot ? " bot" : ""
    lines.push(`- ${message.timestamp} #${message.id} ${message.authorName}${bot}: ${text}`)
  }
  return lines.join("\n")
}


export const runDiscordAgentServerAction = Effect.fn("runDiscordAgentServerAction")(function* (
  input: DiscordAgentServerInput,
  env: Record<string, string | undefined> = process.env,
) {
  const config = loadDiscordAgentServerConfig(env, input)
  const tokenSummary = config.botToken ? redactDiscordToken(config.botToken) : "<missing>"

  if (input.action === "config") {
    const details: DiscordAgentServerDetails = {
      action: "config",
      token: tokenSummary,
      channelId: config.channelId ?? null,
      threadId: config.threadId ?? null,
    }
    return {
      action: "config",
      text: [`Discord agent server config:`, `token: ${details.token}`, `channel_id: ${details.channelId ?? "<missing>"}`, `thread_id: ${details.threadId ?? "<none>"}`].join("\n"),
      details,
    }
  }

  const botToken = config.botToken
  if (!botToken.trim()) return yield* Effect.fail(new Error("Missing Discord bot token. Set OMP_DISCORD_BOT_TOKEN or pass botToken."))
  if (input.action === "getMe") {
    const bot = yield* getDiscordMe(botToken)
    const details: DiscordAgentServerDetails = { action: "getMe", token: tokenSummary, bot }
    return {
      action: "getMe",
      text: `Discord bot ${bot.globalName ?? bot.username} (${bot.id}) is reachable. Token ${tokenSummary}.`,
      details,
    }
  }

  const channelId = config.threadId ?? config.channelId
  if (!channelId?.trim()) return yield* Effect.fail(new Error("Missing Discord channel/thread id. Set OMP_DISCORD_CHANNEL_ID or pass channelId."))
  if (input.action === "fetchMessages") {
    const messages = yield* fetchDiscordMessages(botToken, channelId, {
      limit: input.limit,
      before: input.before,
      after: input.after,
      around: input.around,
    })
    const details: DiscordAgentServerDetails = { action: "fetchMessages", token: tokenSummary, channelId, messages }
    return { action: "fetchMessages", text: formatDiscordMessages(messages), details }
  }

  const text = input.text
  if (!text?.trim()) return yield* Effect.fail(new Error("Missing Discord message text."))
  const sent = yield* sendDiscordMessage(botToken, channelId, text, { replyToMessageId: input.replyToMessageId })
  const details: DiscordAgentServerDetails = { action: "sendMessage", token: tokenSummary, channelId, sent }
  return {
    action: "sendMessage",
    text: `Sent Discord message ${sent.id} to channel/thread ${sent.channelId}.`,
    details,
  }
})

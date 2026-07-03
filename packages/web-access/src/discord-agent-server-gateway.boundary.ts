#!/usr/bin/env bun
import { Effect } from "effect"
import { fetchDiscordMessages, getDiscordMe, sendDiscordMessage, type DiscordActionRowComponent, type DiscordEmbed, type DiscordMessageSummary } from "./discord-agent-server.client"
import { loadDiscordAgentServerConfig, redactDiscordToken } from "./discord-agent-server"
import { toErrorMessage } from "./schemas"

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json"
const INTENTS_GUILDS = 1
const INTENTS_GUILD_MESSAGES = 512
const INTENTS_DIRECT_MESSAGES = 4096
const INTENTS_MESSAGE_CONTENT = 32768
const DEFAULT_INTENTS = INTENTS_GUILDS | INTENTS_GUILD_MESSAGES | INTENTS_DIRECT_MESSAGES | INTENTS_MESSAGE_CONTENT
const DEFAULT_BACKFILL_LIMIT = 50
const DISCORD_MESSAGES_FETCH_LIMIT = 100
const OMP_ACCEPTED_PREFIX = "🟣 OMP accepted:"

export function buildDiscordGatewayIdentifyProperties(platform: string): Record<"$os" | "$browser" | "$device", string> {
  return {
    $os: platform,
    $browser: "omp-discord-agent-server",
    $device: "omp-discord-agent-server",
  }
}

interface GatewayPayload {
  op: number
  d?: unknown
  s?: number | null
  t?: string | null
}

interface GatewayHello {
  heartbeat_interval: number
}

interface DiscordGatewayMessageCreate {
  id: string
  channel_id: string
  content: string
  author: {
    id: string
    username?: string
    global_name?: string | null
    bot?: boolean
  }
  guild_id?: string
  timestamp?: string
}

interface DiscordGatewayOptions {
  token: string
  allowedUsers: Set<string>
  allowedChannels: Set<string>
  backfillLimit: number
  dryRun: boolean
}

interface BackfillContext {
  messages: DiscordMessageSummary[]
  fetchedCount: number
  skippedBotCount: number
  stoppedAtMessageId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function parseCsvSet(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter((item) => item.length > 0))
}

function parseBackfillLimit(value: string | undefined): number {
  const parsed = Number(value ?? String(DEFAULT_BACKFILL_LIMIT))
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_BACKFILL_LIMIT
  return Math.min(parsed, DISCORD_MESSAGES_FETCH_LIMIT)
}

function parseGatewayPayload(raw: string): GatewayPayload | null {
  const parsed = JSON.parse(raw)
  if (!isRecord(parsed)) return null
  const op = numberValue(parsed.op)
  if (op === null) return null
  return {
    op,
    d: parsed.d,
    s: numberValue(parsed.s),
    t: stringValue(parsed.t),
  }
}

function parseHello(value: unknown): GatewayHello | null {
  if (!isRecord(value)) return null
  const heartbeatInterval = numberValue(value.heartbeat_interval)
  if (heartbeatInterval === null) return null
  return { heartbeat_interval: heartbeatInterval }
}

function parseMessageCreate(value: unknown): DiscordGatewayMessageCreate | null {
  if (!isRecord(value)) return null
  const author = isRecord(value.author) ? value.author : null
  const id = stringValue(value.id)
  const channelId = stringValue(value.channel_id)
  const content = stringValue(value.content)
  const authorId = author ? stringValue(author.id) : null
  if (id === null || channelId === null || content === null || author === null || authorId === null) return null
  return {
    id,
    channel_id: channelId,
    content,
    author: {
      id: authorId,
      username: stringValue(author.username) ?? undefined,
      global_name: stringValue(author.global_name),
      bot: author.bot === true,
    },
    guild_id: stringValue(value.guild_id) ?? undefined,
    timestamp: stringValue(value.timestamp) ?? undefined,
  }
}

function stripGoalTrigger(content: string, botId: string): string | null {
  const trimmed = content.trim()
  if (trimmed.startsWith("!goal")) return trimmed.slice("!goal".length).trim()
  const mentionForms = [`<@${botId}>`, `<@!${botId}>`]
  for (const mention of mentionForms) {
    if (trimmed.startsWith(mention)) {
      const rest = trimmed.slice(mention.length).trim()
      if (rest.startsWith("goal")) return rest.slice("goal".length).trim()
      if (rest.startsWith("!goal")) return rest.slice("!goal".length).trim()
      return rest
    }
  }
  return null
}

async function gatewayEventDataToString(data: string | ArrayBuffer | Blob): Promise<string> {
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8")
  return Buffer.from(await data.arrayBuffer()).toString("utf8")
}

function truncateForDiscord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`
}

function selectBackfillContext(messages: DiscordMessageSummary[], triggerId: string, botId: string): BackfillContext {
  const withoutTrigger = messages.filter((message) => message.id !== triggerId)
  let previousBotIndex = -1
  for (let index = withoutTrigger.length - 1; index >= 0; index -= 1) {
    const message = withoutTrigger[index]
    if (message?.authorId === botId) {
      previousBotIndex = index
      break
    }
  }
  const afterPreviousBot = previousBotIndex === -1 ? withoutTrigger : withoutTrigger.slice(previousBotIndex + 1)
  const contextMessages = afterPreviousBot.filter((message) => !message.authorBot)
  return {
    messages: contextMessages,
    fetchedCount: messages.length,
    skippedBotCount: afterPreviousBot.length - contextMessages.length,
    stoppedAtMessageId: previousBotIndex === -1 ? null : withoutTrigger[previousBotIndex]?.id ?? null,
  }
}

function messageLink(message: DiscordGatewayMessageCreate): string | null {
  if (!message.guild_id) return null
  return `https://discord.com/channels/${message.guild_id}/${message.channel_id}/${message.id}`
}

function goalEmbed(goal: string, backfill: BackfillContext, context: string, message: DiscordGatewayMessageCreate, dryRun: boolean): DiscordEmbed {
  const backfillStatus = [
    `${backfill.messages.length} context message(s) from ${backfill.fetchedCount} fetched`,
    backfill.stoppedAtMessageId ? `stopped after bot message ${backfill.stoppedAtMessageId}` : "no prior bot response found",
    backfill.skippedBotCount > 0 ? `${backfill.skippedBotCount} bot message(s) ignored` : null,
  ].filter((item): item is string => item !== null).join("; ")
  const artifactStatus = dryRun ? "None: dry-run Gateway proof card only." : "Pending: OMP dispatch hook not connected in V1."
  return {
    title: "🟣 OMP goal accepted",
    description: truncateForDiscord(goal || "<empty goal>", 600),
    color: 8135405,
    timestamp: new Date().toISOString(),
    fields: [
      { name: "Session", value: `discord:${message.channel_id}:${message.id}`, inline: false },
      { name: "Trigger", value: `<@${message.author.id}> in <#${message.channel_id}>`, inline: true },
      { name: "Backfill", value: truncateForDiscord(backfillStatus, 1024), inline: false },
      { name: "Status", value: dryRun ? "Dry run: OMP dispatch skipped." : "Ready for OMP agent dispatch hook.", inline: false },
      { name: "Artifacts", value: truncateForDiscord(artifactStatus, 1024), inline: false },
      { name: "Recent context", value: truncateForDiscord(context, 1024), inline: false },
    ],
    footer: { text: "OMP Discord gateway · safe mentions disabled" },
  }
}

function goalComponents(message: DiscordGatewayMessageCreate): DiscordActionRowComponent[] {
  const link = messageLink(message)
  if (!link) return []
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 5, label: "Open trigger", url: link },
      ],
    },
  ]
}

function formatBackfill(messages: DiscordMessageSummary[]): string {
  if (messages.length === 0) return "No prior human context fetched after the previous OMP bot response."
  return messages.map((message) => {
    const body = message.content.replace(/\s+/g, " ").slice(0, 240) || (message.attachmentCount > 0 ? `<${message.attachmentCount} attachment(s)>` : "<empty>")
    return `- ${message.authorName}: ${body}`
  }).join("\n")
}

async function handleGoalMessage(options: DiscordGatewayOptions, botId: string, message: DiscordGatewayMessageCreate): Promise<void> {
  if (message.author.bot === true) return
  if (options.allowedUsers.size > 0 && !options.allowedUsers.has(message.author.id)) return
  if (options.allowedChannels.size > 0 && !options.allowedChannels.has(message.channel_id)) return
  const goal = stripGoalTrigger(message.content, botId)
  if (goal === null) return
  const fetchedMessages = await run(fetchDiscordMessages(options.token, message.channel_id, { limit: options.backfillLimit, before: message.id }))
  const backfill = selectBackfillContext(fetchedMessages, message.id, botId)
  const context = formatBackfill(backfill.messages)
  const embed = goalEmbed(goal, backfill, context, message, options.dryRun)
  const components = goalComponents(message)
  const content = `${OMP_ACCEPTED_PREFIX} ${truncateForDiscord(goal || "<empty goal>", 120)}`
  await run(sendDiscordMessage(options.token, message.channel_id, content, {
    replyToMessageId: message.id,
    repliedUser: false,
    embeds: [embed],
    components,
  }))
}

async function runGateway(): Promise<void> {
  const config = loadDiscordAgentServerConfig(process.env)
  if (!config.botToken.trim()) throw new Error("Missing OMP_DISCORD_BOT_TOKEN or DISCORD_BOT_TOKEN")
  const allowedUsers = parseCsvSet(process.env.OMP_DISCORD_ALLOWED_USERS ?? process.env.DISCORD_ALLOWED_USERS)
  const allowedChannels = parseCsvSet(process.env.OMP_DISCORD_ALLOWED_CHANNELS ?? process.env.DISCORD_ALLOWED_CHANNELS)
  const backfillLimit = parseBackfillLimit(process.env.OMP_DISCORD_BACKFILL_LIMIT ?? process.env.DISCORD_HISTORY_BACKFILL_LIMIT)
  const dryRun = (process.env.OMP_DISCORD_DRY_RUN ?? "true").toLowerCase() !== "false"
  const me = await run(getDiscordMe(config.botToken))
  console.log(`Discord gateway starting as ${me.globalName ?? me.username} (${me.id}), token ${redactDiscordToken(config.botToken)}.`)
  console.log(`Allowed users: ${allowedUsers.size === 0 ? "all" : [...allowedUsers].join(",")}; allowed channels: ${allowedChannels.size === 0 ? "all" : [...allowedChannels].join(",")}; backfillLimit=${backfillLimit}; dryRun=${dryRun}.`)

  let sequence: number | null = null
  let heartbeat: NodeJS.Timeout | undefined
  const socket = new WebSocket(DISCORD_GATEWAY_URL)

  socket.addEventListener("open", () => {
    console.log("Discord gateway socket opened.")
  })

  socket.addEventListener("message", (event) => {
    void (async () => {
      const raw = await gatewayEventDataToString(event.data)
      const payload = parseGatewayPayload(raw)
      if (!payload) return
      if (payload.s !== null && payload.s !== undefined) sequence = payload.s
      if (payload.op === 10) {
        const hello = parseHello(payload.d)
        if (!hello) throw new Error("Discord gateway hello missing heartbeat interval")
        heartbeat = setInterval(() => {
          socket.send(JSON.stringify({ op: 1, d: sequence }))
        }, hello.heartbeat_interval)
        socket.send(JSON.stringify({
          op: 2,
          d: {
            token: config.botToken,
            intents: DEFAULT_INTENTS,
            properties: buildDiscordGatewayIdentifyProperties(process.platform),
          },
        }))
        return
      }
      if (payload.op === 0 && payload.t === "READY") {
        console.log("Discord gateway ready. Send `!goal ...` or `@bot goal ...` in an allowed channel.")
        return
      }
      if (payload.op === 0 && payload.t === "MESSAGE_CREATE") {
        const message = parseMessageCreate(payload.d)
        if (message) await handleGoalMessage({ token: config.botToken, allowedUsers, allowedChannels, backfillLimit, dryRun }, me.id, message)
      }
    })().catch((err) => console.error(`Discord gateway event error: ${toErrorMessage(err)}`))
  })

  socket.addEventListener("close", (event) => {
    clearInterval(heartbeat)
    console.error(`Discord gateway socket closed: ${event.code} ${event.reason}`)
    process.exit(event.wasClean ? 0 : 1)
  })

  socket.addEventListener("error", () => {
    console.error("Discord gateway socket error.")
  })
}

if (import.meta.main) {
  runGateway().catch((err) => {
    console.error(`Discord gateway failed: ${toErrorMessage(err)}`)
    process.exit(1)
  })
}

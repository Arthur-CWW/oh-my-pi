import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { Effect } from "effect"
import { runDiscordAgentServerAction, type DiscordAgentServerAction } from "./discord-agent-server"
import { toErrorMessage } from "./schemas"

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

function stringParam(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberParam(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function actionParam(value: unknown): DiscordAgentServerAction {
  if (value === "getMe" || value === "fetchMessages" || value === "sendMessage" || value === "config") return value
  return "config"
}

export function registerDiscordAgentServer(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "discord_agent_server",
    label: "Discord Agent Server",
    description: "Safe Discord Bot API bridge for OMP agent-server setup: inspect bot identity, fetch recent channel/thread context, and send a message.",
    parameters: Type.Object({
      action: Type.Optional(Type.String({ description: "config, getMe, fetchMessages, or sendMessage" })),
      botToken: Type.Optional(Type.String({ description: "Bot token. Prefer OMP_DISCORD_BOT_TOKEN env; tool output redacts it." })),
      channelId: Type.Optional(Type.String({ description: "Target Discord channel id. Prefer OMP_DISCORD_CHANNEL_ID env." })),
      threadId: Type.Optional(Type.String({ description: "Target Discord thread id; overrides channelId for fetch/send." })),
      text: Type.Optional(Type.String({ description: "Message text for sendMessage." })),
      limit: Type.Optional(Type.Number({ description: "fetchMessages limit." })),
      before: Type.Optional(Type.String({ description: "Fetch messages before this message id." })),
      after: Type.Optional(Type.String({ description: "Fetch messages after this message id." })),
      around: Type.Optional(Type.String({ description: "Fetch messages around this message id." })),
      replyToMessageId: Type.Optional(Type.String({ description: "Reply-reference this message id for sendMessage." })),
    }),
    async execute(_callId, rawParams) {
      const params = asRecord(rawParams)
      try {
        const result = await run(runDiscordAgentServerAction({
          action: actionParam(params.action),
          botToken: stringParam(params.botToken),
          channelId: stringParam(params.channelId),
          threadId: stringParam(params.threadId),
          text: stringParam(params.text),
          limit: numberParam(params.limit),
          before: stringParam(params.before),
          after: stringParam(params.after),
          around: stringParam(params.around),
          replyToMessageId: stringParam(params.replyToMessageId),
        }))
        return { content: [{ type: "text", text: result.text }], details: result.details }
      } catch (err) {
        const message = toErrorMessage(err)
        return { content: [{ type: "text", text: `Discord agent server error: ${message}` }] }
      }
    },
  })
}

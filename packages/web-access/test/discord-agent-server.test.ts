import { describe, expect, it, mock } from "bun:test"
import { Effect } from "effect"
import {
  buildDiscordApiError,
  buildDiscordSendMessagePayload,
  decodeDiscordMessages,
  DiscordApiError,
  sendDiscordMessage,
} from "../src/discord-agent-server.client"
import {
  formatDiscordMessages,
  loadDiscordAgentServerConfig,
  redactDiscordToken,
  runDiscordAgentServerAction,
} from "../src/discord-agent-server"
import { buildDiscordGatewayIdentifyProperties } from "../src/discord-agent-server-gateway.boundary"

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

const newestFirstMessages = [
  {
    id: "3",
    channel_id: "10",
    author: { id: "7", username: "Arthur", global_name: "Arthur", bot: false },
    content: "third",
    timestamp: "2026-06-19T00:00:03.000Z",
    attachments: [],
  },
  {
    id: "2",
    channel_id: "10",
    author: { id: "8", username: "OMP", global_name: "OMP", bot: true },
    content: "second",
    timestamp: "2026-06-19T00:00:02.000Z",
    attachments: [{ id: "a" }],
  },
  {
    id: "1",
    channel_id: "10",
    author: { id: "7", username: "Arthur", global_name: "Arthur", bot: false },
    content: "first",
    timestamp: "2026-06-19T00:00:01.000Z",
    attachments: [],
  },
]

describe("discord agent server config", () => {
  it("prefers OMP env keys and falls back to Discord env keys", () => {
    const primary = loadDiscordAgentServerConfig({
      OMP_DISCORD_BOT_TOKEN: "omp-token",
      OMP_DISCORD_CHANNEL_ID: "10",
      OMP_DISCORD_THREAD_ID: "11",
      DISCORD_BOT_TOKEN: "legacy-token",
      DISCORD_CHANNEL_ID: "12",
      DISCORD_THREAD_ID: "13",
    })
    expect(primary.botToken).toBe("omp-token")
    expect(primary.channelId).toBe("10")
    expect(primary.threadId).toBe("11")

    const fallback = loadDiscordAgentServerConfig({
      DISCORD_BOT_TOKEN: "legacy-token",
      DISCORD_CHANNEL_ID: "12",
      DISCORD_THREAD_ID: "13",
    })
    expect(fallback.botToken).toBe("legacy-token")
    expect(fallback.channelId).toBe("12")
    expect(fallback.threadId).toBe("13")
  })

  it("redacts tokens in summaries", async () => {
    const token = "MTEyMzQ1Njc4OTAx.fake-secret-token"
    expect(redactDiscordToken(token)).not.toContain(token)
    expect(redactDiscordToken(token)).not.toContain("fake-secret-token")

    const result = await run(runDiscordAgentServerAction({ action: "config" }, {
      OMP_DISCORD_BOT_TOKEN: token,
      OMP_DISCORD_CHANNEL_ID: "10",
    }))
    expect(result.text).not.toContain(token)
    expect(JSON.stringify(result.details)).not.toContain(token)
    expect(result.text).toContain("MTEyMz")
  })
})

describe("discord send payload", () => {
  it("uses safe allowed_mentions defaults", () => {
    expect(buildDiscordSendMessagePayload("hello")).toEqual({
      content: "hello",
      allowed_mentions: {
        parse: [],
        replied_user: false,
      },
    })
  })

  it("adds a safe reply reference", () => {
    expect(buildDiscordSendMessagePayload("hello", { channelId: "10", replyToMessageId: "99", repliedUser: true })).toEqual({
      content: "hello",
      allowed_mentions: {
        parse: [],
        replied_user: true,
      },
      message_reference: {
        message_id: "99",
        channel_id: "10",
        fail_if_not_exists: false,
      },
    })
  })

  it("adds embed cards and link buttons without enabling broad mentions", () => {
    expect(buildDiscordSendMessagePayload("", {
      embeds: [{
        title: "🟣 OMP goal accepted",
        color: 8135405,
        fields: [{ name: "Status", value: "Ready", inline: true }],
      }],
      components: [{
        type: 1,
        components: [{ type: 2, style: 5, label: "Open trigger", url: "https://discord.com/channels/1/2/3" }],
      }],
    })).toEqual({
      allowed_mentions: {
        parse: [],
        replied_user: false,
      },
      embeds: [{
        title: "🟣 OMP goal accepted",
        color: 8135405,
        fields: [{ name: "Status", value: "Ready", inline: true }],
      }],
      components: [{
        type: 1,
        components: [{ type: 2, style: 5, label: "Open trigger", url: "https://discord.com/channels/1/2/3" }],
      }],
    })
  })

  it("serializes Gateway card embeds and link buttons in the POST body", async () => {
    const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = []
    const originalFetch = globalThis.fetch
    const mockedFetch = mock((url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(new Response(JSON.stringify({
        id: "42",
        channel_id: "10",
        author: { id: "8", username: "OMP", global_name: "OMP", bot: true },
        content: "🟣 OMP accepted: ship it",
        timestamp: "2026-06-19T00:00:04.000Z",
        attachments: [],
      }), { status: 200 }))
    })
    globalThis.fetch = Object.assign(mockedFetch, { preconnect: originalFetch.preconnect })

    try {
      const sent = await run(sendDiscordMessage("bot-token", "10", "🟣 OMP accepted: ship it", {
        replyToMessageId: "99",
        repliedUser: false,
        embeds: [{
          title: "🟣 OMP goal accepted",
          color: 8135405,
          fields: [{ name: "Status", value: "Ready", inline: true }],
        }],
        components: [{
          type: 1,
          components: [{ type: 2, style: 5, label: "Open trigger", url: "https://discord.com/channels/1/10/99" }],
        }],
      }))

      expect(sent.id).toBe("42")
      expect(calls).toHaveLength(1)
      expect(String(calls[0]?.url)).toBe("https://discord.com/api/v10/channels/10/messages")
      expect(calls[0]?.init?.method).toBe("POST")
      expect(await new Response(calls[0]?.init?.body).json()).toEqual({
        content: "🟣 OMP accepted: ship it",
        allowed_mentions: {
          parse: [],
          replied_user: false,
        },
        embeds: [{
          title: "🟣 OMP goal accepted",
          color: 8135405,
          fields: [{ name: "Status", value: "Ready", inline: true }],
        }],
        components: [{
          type: 1,
          components: [{ type: 2, style: 5, label: "Open trigger", url: "https://discord.com/channels/1/10/99" }],
        }],
        message_reference: {
          message_id: "99",
          channel_id: "10",
          fail_if_not_exists: false,
        },
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe("discord gateway identify", () => {
  it("uses Discord's dollar-prefixed identify connection property keys", () => {
    expect(buildDiscordGatewayIdentifyProperties("darwin")).toEqual({
      $os: "darwin",
      $browser: "omp-discord-agent-server",
      $device: "omp-discord-agent-server",
    })
  })
})

describe("discord message decoding", () => {
  it("returns chronological summaries from Discord newest-first responses", () => {
    const messages = decodeDiscordMessages(newestFirstMessages)
    expect(messages.map((message) => message.id)).toEqual(["1", "2", "3"])
    expect(messages[1]?.authorBot).toBe(true)
    expect(messages[1]?.attachmentCount).toBe(1)

    const summary = formatDiscordMessages(messages)
    expect(summary).toContain("3 Discord message(s), chronological")
    expect(summary.indexOf("first")).toBeLessThan(summary.indexOf("third"))
    expect(summary).toContain("OMP bot")
  })

  it("decodes retry_after and rate-limit headers on errors", () => {
    const response = new Response(JSON.stringify({ message: "rate limited", retry_after: 1.2, global: false, code: 0 }), {
      status: 429,
      headers: {
        "retry-after": "2",
        "x-ratelimit-bucket": "abc",
        "x-ratelimit-limit": "5",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1780000000.000",
        "x-ratelimit-reset-after": "1.2",
        "x-ratelimit-scope": "user",
      },
    })
    const error = buildDiscordApiError(response, { message: "rate limited", retry_after: 1.2, global: false, code: 0 }, "fallback")
    expect(error).toBeInstanceOf(DiscordApiError)
    expect(error.status).toBe(429)
    expect(error.retryAfter).toBe(1.2)
    expect(error.rateLimit?.retryAfter).toBe(1.2)
    expect(error.rateLimit?.retryAfterHeader).toBe("2")
    expect(error.rateLimit?.resetAfter).toBe("1.2")
    expect(error.rateLimit?.bucket).toBe("abc")
    expect(error.rateLimit?.scope).toBe("user")
    expect(error.message).toContain("retry_after 1.2s")
  })
})

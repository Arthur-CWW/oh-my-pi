#!/usr/bin/env bun
import { Effect } from "effect"
import { runDiscordAgentServerAction, type DiscordAgentServerAction, type DiscordAgentServerInput } from "./discord-agent-server"
import { toErrorMessage } from "./schemas"

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

interface ParsedCli {
  input: DiscordAgentServerInput
  json: boolean
}

function printHelp(): void {
  console.log(`Usage: pi-discord-agent-server <command> [options]

Commands:
  config                    Show redacted env/config summary
  get-me                    Verify the Discord bot token
  fetch-messages            Fetch recent messages from channel/thread
  send <text>               Send text to the configured channel/thread

Options:
  --bot-token <token>       Override OMP_DISCORD_BOT_TOKEN / DISCORD_BOT_TOKEN
  --channel-id <id>         Override OMP_DISCORD_CHANNEL_ID / DISCORD_CHANNEL_ID
  --thread-id <id>          Override OMP_DISCORD_THREAD_ID / DISCORD_THREAD_ID
  --limit <n>               fetch-messages limit
  --before <id>             fetch messages before message id
  --after <id>              fetch messages after message id
  --around <id>             fetch messages around message id
  --reply-to <id>           send reply-reference message id
  --json                    Print JSON details
  -h, --help                Show help

Examples:
  pi-discord-agent-server get-me
  pi-discord-agent-server fetch-messages --limit 20
  pi-discord-agent-server send --channel-id 1234567890 "OMP Discord bridge smoke"`)
}

function commandToAction(command: string): DiscordAgentServerAction {
  if (command === "get-me" || command === "getMe") return "getMe"
  if (command === "fetch-messages" || command === "fetchMessages") return "fetchMessages"
  if (command === "send" || command === "send-message" || command === "sendMessage") return "sendMessage"
  if (command === "config") return "config"
  throw new Error(`Unknown command: ${command}`)
}

function numberFlag(name: string, value: string | undefined): number {
  const parsed = Number(value ?? "")
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric ${name}: ${value ?? ""}`)
  return parsed
}

export function parseDiscordAgentServerCliArgs(argv: string[]): ParsedCli {
  const args = [...argv]
  const command = args.shift() ?? "config"
  if (command === "-h" || command === "--help") {
    printHelp()
    process.exit(0)
  }
  const input: DiscordAgentServerInput = { action: commandToAction(command) }
  let json = false
  const textParts: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === "--") {
      textParts.push(...args.slice(i + 1))
      break
    }
    if (arg === "--json") {
      json = true
      continue
    }
    if (arg === "--bot-token") {
      input.botToken = args[++i]
      continue
    }
    if (arg.startsWith("--bot-token=")) {
      input.botToken = arg.slice("--bot-token=".length)
      continue
    }
    if (arg === "--channel-id") {
      input.channelId = args[++i]
      continue
    }
    if (arg.startsWith("--channel-id=")) {
      input.channelId = arg.slice("--channel-id=".length)
      continue
    }
    if (arg === "--thread-id") {
      input.threadId = args[++i]
      continue
    }
    if (arg.startsWith("--thread-id=")) {
      input.threadId = arg.slice("--thread-id=".length)
      continue
    }
    if (arg === "--limit") {
      input.limit = numberFlag(arg, args[++i])
      continue
    }
    if (arg.startsWith("--limit=")) {
      input.limit = numberFlag("--limit", arg.slice("--limit=".length))
      continue
    }
    if (arg === "--before") {
      input.before = args[++i]
      continue
    }
    if (arg.startsWith("--before=")) {
      input.before = arg.slice("--before=".length)
      continue
    }
    if (arg === "--after") {
      input.after = args[++i]
      continue
    }
    if (arg.startsWith("--after=")) {
      input.after = arg.slice("--after=".length)
      continue
    }
    if (arg === "--around") {
      input.around = args[++i]
      continue
    }
    if (arg.startsWith("--around=")) {
      input.around = arg.slice("--around=".length)
      continue
    }
    if (arg === "--reply-to") {
      input.replyToMessageId = args[++i]
      continue
    }
    if (arg.startsWith("--reply-to=")) {
      input.replyToMessageId = arg.slice("--reply-to=".length)
      continue
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`)
    textParts.push(arg)
  }
  if (textParts.length > 0) input.text = textParts.join(" ").trim()
  return { input, json }
}

export async function runDiscordAgentServerCli(argv: string[]): Promise<void> {
  const parsed = parseDiscordAgentServerCliArgs(argv)
  const result = await run(runDiscordAgentServerAction(parsed.input))
  if (parsed.json) console.log(JSON.stringify(result.details, null, 2))
  else console.log(result.text)
}

runDiscordAgentServerCli(process.argv.slice(2)).catch((err) => {
  console.error(`Discord agent server failed: ${toErrorMessage(err)}`)
  process.exit(1)
})

#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { Effect } from "effect"
import { openChatGptHandoff, type ChatGptHandoffResult } from "./chatgpt"
import { toErrorMessage } from "./schemas"

interface CliOptions {
  browser: string
  conversationUrl?: string
  projectUrl?: string
  copyOnly: boolean
  json: boolean
  prompt: string
}

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

function printHelp(): void {
  console.log(`Usage: pi-chatgpt [options] <prompt>

Copy a prompt to the clipboard and open ChatGPT for manual Pro runs.
This command does not submit prompts or scrape ChatGPT responses.

Options:
      --conversation-url <url>  Open an existing chatgpt.com conversation
      --project-url <url>       Open a chatgpt.com project
      --browser <app>           Browser app to open (default: Firefox)
      --prompt-file <path>      Read prompt from a file
      --copy-only               Copy prompt without opening the browser
      --json                    Print JSON
  -h, --help                    Show this help

Examples:
  pi-chatgpt "draft a research plan"
  pi-chatgpt --project-url https://chatgpt.com/g/g-... "$(cat prompt.md)"
  bun run chatgpt -- --copy-only --prompt-file prompt.md`)
}

function readPromptFile(path: string): string {
  return readFileSync(path, "utf-8")
}

function parseArgs(argv: string[]): CliOptions {
  let browser = "Firefox"
  let conversationUrl: string | undefined
  let projectUrl: string | undefined
  let copyOnly = false
  let json = false
  const promptParts: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "--") {
      promptParts.push(...argv.slice(i + 1))
      break
    }
    if (arg === "-h" || arg === "--help") {
      printHelp()
      process.exit(0)
    }
    if (arg === "--json") {
      json = true
      continue
    }
    if (arg === "--copy-only") {
      copyOnly = true
      continue
    }
    if (arg === "--browser") {
      browser = argv[++i] ?? ""
      continue
    }
    if (arg.startsWith("--browser=")) {
      browser = arg.slice("--browser=".length)
      continue
    }
    if (arg === "--conversation-url") {
      conversationUrl = argv[++i]
      continue
    }
    if (arg.startsWith("--conversation-url=")) {
      conversationUrl = arg.slice("--conversation-url=".length)
      continue
    }
    if (arg === "--project-url") {
      projectUrl = argv[++i]
      continue
    }
    if (arg.startsWith("--project-url=")) {
      projectUrl = arg.slice("--project-url=".length)
      continue
    }
    if (arg === "--prompt-file") {
      promptParts.push(readPromptFile(argv[++i] ?? ""))
      continue
    }
    if (arg.startsWith("--prompt-file=")) {
      promptParts.push(readPromptFile(arg.slice("--prompt-file=".length)))
      continue
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`)
    promptParts.push(arg)
  }

  if (conversationUrl && projectUrl) {
    throw new Error("Use either --conversation-url or --project-url, not both.")
  }

  return {
    browser,
    conversationUrl,
    projectUrl,
    copyOnly,
    json,
    prompt: promptParts.join(" ").trim(),
  }
}

function printText(result: ChatGptHandoffResult): void {
  console.log(`Copied ${result.promptLength} characters to the clipboard.`)
  if (result.opened) {
    console.log(`Opened ${result.mode} target in ${result.browser}: ${result.url}`)
  } else {
    console.log(`Copy-only mode. Target would be: ${result.url}`)
  }
  console.log("Paste the prompt into ChatGPT and submit it manually.")
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.prompt) {
    printHelp()
    process.exit(1)
  }

  const result = await run(openChatGptHandoff(opts))
  if (opts.json) console.log(JSON.stringify(result, null, 2))
  else printText(result)
}

main().catch((err) => {
  console.error(`ChatGPT handoff failed: ${toErrorMessage(err)}`)
  process.exit(1)
})

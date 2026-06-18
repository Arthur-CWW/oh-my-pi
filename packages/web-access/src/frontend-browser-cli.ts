#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { Effect } from "effect"
import {
  chatGptLoginFrontendBrowser,
  collectFrontendBrowser,
  frontendBrowserProjects,
  frontendBrowserSessions,
  frontendBrowserStatus,
  googleLoginFrontendBrowser,
  promptFrontendBrowser,
  saveFrontendBrowserProject,
  setupFrontendBrowser,
  type ChatGptLoginResult,
  type FrontendBrowserOptions,
  type FrontendProjectRecord,
  type FrontendBrowserSetupResult,
  type FrontendBrowserStatus,
  type FrontendCollectResult,
  type FrontendPromptResult,
  type FrontendProvider,
  type FrontendSessionRecord,
  type GoogleLoginResult,
} from "./frontend-browser"
import { toErrorMessage } from "./schemas"

type Command = "setup" | "status" | "open" | "google-login" | "chatgpt-login" | "prompt" | "collect" | "wait" | "sessions" | "projects"

interface CliOptions extends FrontendBrowserOptions {
  account?: string
  command: Command
  conversationUrl?: string
  json: boolean
  limit?: number
  newChat?: boolean
  prompt?: string
  project?: string
  projectKey?: string
  projectTitle?: string
  projectUrl?: string
  outputFile?: string
  responseTimeoutMs?: number
  session?: string
  waitForResponse?: boolean
}

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

function printHelp(): void {
  console.log(`Usage: pi-llm-browser <setup|open|google-login|chatgpt-login|prompt|collect|wait|sessions|projects|status> [options]

Manage a dedicated Helium/Chromium CDP profile for frontend LLM sites.

Commands:
  setup   Launch browser visibly for first login and ensure provider tab
  open    Launch/reuse browser in background and ensure provider tab
  google-login
          Sign into Google from macOS Keychain credentials
  chatgpt-login
          Sign into ChatGPT through Google OAuth
  prompt  Send a prompt through frontend automation
  collect Snapshot the latest response from a saved ChatGPT session/conversation
  wait    Long-poll a saved ChatGPT session/conversation and save the response
  sessions
          List saved frontend prompt sessions
  projects
          List saved projects, or save a project alias with --save-project
  status  Show CDP connection and open tabs

Options:
      --provider <aistudio|deepseek|chatgpt|grok|jimeng>
                                             Provider target (default: aistudio)
      --browser <app>                         macOS browser app (default: Helium)
      --port <number>                         CDP port (provider-specific default)
      --profile-dir <path>                    Browser user data directory
      --background                            Do not activate the browser
      --prompt-file <path>                    Read prompt text from file
      --conversation-url <url>                ChatGPT conversation URL for collect/wait
      --output-file <path>                    Write captured response text to a local file
      --project <key-or-url>                  Use a saved project alias or direct project URL
      --session <id|latest>                   Continue a saved conversation
      --continue                              Continue the latest matching saved conversation
      --save-project <key>                    Save a project alias for --project
      --project-url <url>                     Project URL for --save-project
      --project-title <title>                 Human title for --save-project
      --same-chat                             Reuse the current provider chat
      --no-wait                               Submit prompt without waiting for text
      --response-timeout-ms <number>          Response wait timeout (default: 120000)
      --limit <number>                        Number of sessions to list (default: 20)
      --json                                  Print JSON
  -h, --help                                  Show this help

Examples:
  pi-llm-browser setup --provider aistudio
  pi-llm-browser open --provider deepseek --background
  pi-llm-browser open --provider grok --background
  pi-llm-browser open --provider jimeng --background
  pi-llm-browser google-login
  pi-llm-browser chatgpt-login
  pi-llm-browser prompt --provider aistudio "Return exactly: ok"
  pi-llm-browser prompt --provider chatgpt --project youtube-video-essay --prompt-file prompt.md
  pi-llm-browser prompt --provider chatgpt --no-wait "Deep research question"
  pi-llm-browser prompt --provider grok --no-wait "Search public X posts from @openai about Codex and summarize them"
  pi-llm-browser wait --provider chatgpt --session latest --response-timeout-ms 900000 --output-file research.md
  pi-llm-browser wait --provider grok --session latest --response-timeout-ms 300000 --output-file grok-search.md
  pi-llm-browser prompt --provider chatgpt --continue "Continue from the last answer"
  pi-llm-browser projects --provider chatgpt --save-project youtube-video-essay --project-url https://chatgpt.com/project/...
  pi-llm-browser sessions --provider chatgpt --project youtube-video-essay
  pi-llm-browser status --provider chatgpt`)
}

function parseProvider(value: string | undefined): FrontendProvider {
  if (value === "aistudio" || value === "deepseek" || value === "chatgpt" || value === "grok" || value === "jimeng") return value
  throw new Error("--provider must be one of: aistudio, deepseek, chatgpt, grok, jimeng")
}

function parseArgs(argv: string[]): CliOptions {
  const commandArg = argv[0]
  const command = commandArg as Command | undefined
  if (!commandArg || commandArg === "-h" || commandArg === "--help") {
    printHelp()
    process.exit(commandArg ? 0 : 1)
  }
  if (
    command !== "setup"
    && command !== "open"
    && command !== "status"
    && command !== "google-login"
    && command !== "chatgpt-login"
    && command !== "prompt"
    && command !== "collect"
    && command !== "wait"
    && command !== "sessions"
    && command !== "projects"
  ) {
    throw new Error("Command must be one of: setup, open, google-login, chatgpt-login, prompt, collect, wait, sessions, projects, status")
  }

  const opts: CliOptions = {
    background: command === "open" || command === "google-login" || command === "chatgpt-login" || command === "prompt" || command === "collect" || command === "wait",
    command,
    json: false,
  }
  const promptParts: string[] = []

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === "-h" || arg === "--help") {
      printHelp()
      process.exit(0)
    }
    if (arg === "--json") {
      opts.json = true
      continue
    }
    if (arg === "--background") {
      opts.background = true
      continue
    }
    if (arg === "--prompt-file") {
      promptParts.push(readFileSync(argv[++i] ?? "", "utf-8"))
      continue
    }
    if (arg.startsWith("--prompt-file=")) {
      promptParts.push(readFileSync(arg.slice("--prompt-file=".length), "utf-8"))
      continue
    }
    if (arg === "--conversation-url") {
      opts.conversationUrl = argv[++i]
      continue
    }
    if (arg.startsWith("--conversation-url=")) {
      opts.conversationUrl = arg.slice("--conversation-url=".length)
      continue
    }
    if (arg === "--output-file") {
      opts.outputFile = argv[++i]
      continue
    }
    if (arg.startsWith("--output-file=")) {
      opts.outputFile = arg.slice("--output-file=".length)
      continue
    }
    if (arg === "--same-chat") {
      opts.newChat = false
      continue
    }
    if (arg === "--continue") {
      opts.session = "latest"
      opts.newChat = false
      continue
    }
    if (arg === "--no-wait") {
      opts.waitForResponse = false
      continue
    }
    if (arg === "--response-timeout-ms") {
      opts.responseTimeoutMs = Number(argv[++i])
      continue
    }
    if (arg.startsWith("--response-timeout-ms=")) {
      opts.responseTimeoutMs = Number(arg.slice("--response-timeout-ms=".length))
      continue
    }
    if (arg === "--limit") {
      opts.limit = Number(argv[++i])
      continue
    }
    if (arg.startsWith("--limit=")) {
      opts.limit = Number(arg.slice("--limit=".length))
      continue
    }
    if (arg === "--provider") {
      opts.provider = parseProvider(argv[++i])
      continue
    }
    if (arg.startsWith("--provider=")) {
      opts.provider = parseProvider(arg.slice("--provider=".length))
      continue
    }
    if (arg === "--project") {
      opts.project = argv[++i]
      continue
    }
    if (arg.startsWith("--project=")) {
      opts.project = arg.slice("--project=".length)
      continue
    }
    if (arg === "--session") {
      opts.session = argv[++i]
      opts.newChat = false
      continue
    }
    if (arg.startsWith("--session=")) {
      opts.session = arg.slice("--session=".length)
      opts.newChat = false
      continue
    }
    if (arg === "--save-project") {
      opts.projectKey = argv[++i]
      continue
    }
    if (arg.startsWith("--save-project=")) {
      opts.projectKey = arg.slice("--save-project=".length)
      continue
    }
    if (arg === "--project-url") {
      opts.projectUrl = argv[++i]
      continue
    }
    if (arg.startsWith("--project-url=")) {
      opts.projectUrl = arg.slice("--project-url=".length)
      continue
    }
    if (arg === "--project-title") {
      opts.projectTitle = argv[++i]
      continue
    }
    if (arg.startsWith("--project-title=")) {
      opts.projectTitle = arg.slice("--project-title=".length)
      continue
    }
    if (arg === "--account") {
      opts.account = argv[++i]
      continue
    }
    if (arg.startsWith("--account=")) {
      opts.account = arg.slice("--account=".length)
      continue
    }
    if (arg === "--browser") {
      opts.browser = argv[++i]
      continue
    }
    if (arg.startsWith("--browser=")) {
      opts.browser = arg.slice("--browser=".length)
      continue
    }
    if (arg === "--profile-dir") {
      opts.profileDir = argv[++i]
      continue
    }
    if (arg.startsWith("--profile-dir=")) {
      opts.profileDir = arg.slice("--profile-dir=".length)
      continue
    }
    if (arg === "--port") {
      opts.port = Number(argv[++i])
      continue
    }
    if (arg.startsWith("--port=")) {
      opts.port = Number(arg.slice("--port=".length))
      continue
    }
    if (command === "prompt") {
      promptParts.push(arg)
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  if (opts.port !== undefined && (!Number.isInteger(opts.port) || opts.port < 1)) {
    throw new Error("--port must be a positive integer")
  }
  if (
    opts.responseTimeoutMs !== undefined
    && (!Number.isInteger(opts.responseTimeoutMs) || opts.responseTimeoutMs < 1)
  ) {
    throw new Error("--response-timeout-ms must be a positive integer")
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw new Error("--limit must be a positive integer")
  }
  if (command === "projects" && opts.projectKey && !opts.projectUrl) {
    throw new Error("--project-url is required with --save-project")
  }
  if (command === "prompt") {
    opts.provider ??= "aistudio"
    opts.prompt = promptParts.join(" ").trim()
  }
  if ((command === "collect" || command === "wait") && !opts.session && !opts.conversationUrl) {
    opts.session = "latest"
  }

  return opts
}

function printStatus(status: FrontendBrowserStatus): void {
  console.log(`${status.provider}: ${status.running ? "running" : "not running"}`)
  console.log(`Browser: ${status.browser}`)
  console.log(`CDP: ${status.cdpUrl}`)
  console.log(`Profile: ${status.profileDir}`)
  if (!status.running) return
  const providerTabs = status.tabs.filter((tab) => tab.url.startsWith(status.defaultUrl))
  console.log(`Tabs: ${status.tabs.length}${providerTabs.length ? ` (${providerTabs.length} provider tab)` : ""}`)
}

function printSetup(result: FrontendBrowserSetupResult): void {
  printStatus(result)
  console.log(`Launched: ${result.launched ? "yes" : "already running"}`)
  if (result.selectedTab) {
    console.log(`Provider tab: ${result.selectedTab.title || "(untitled)"}`)
    console.log(result.selectedTab.url)
  }
  console.log("Log in in the browser if needed. Future open calls can run in the background.")
}

function printGoogleLogin(result: GoogleLoginResult): void {
  printSetup(result)
  console.log(`Credential account: ${result.credentialAccount}`)
  console.log(`Google login: ${result.loggedIn ? "ok" : "not confirmed"}`)
  console.log(`Needs human: ${result.needsHuman ? "yes" : "no"}`)
  console.log(`Reused tab: ${result.reusedTab ? "yes" : "no"}`)
  console.log(`Page: ${result.title || "(untitled)"}`)
  console.log(result.url)
  if (result.clicked.length) console.log(`Clicked: ${result.clicked.join(", ")}`)
}

function printChatGptLogin(result: ChatGptLoginResult): void {
  printSetup(result)
  console.log(`Credential account: ${result.credentialAccount}`)
  console.log(`ChatGPT login: ${result.loggedIn ? "ok" : "not confirmed"}`)
  console.log(`Needs human: ${result.needsHuman ? "yes" : "no"}`)
  if (result.humanReason) console.log(`Human reason: ${result.humanReason}`)
  console.log(`Page: ${result.title || "(untitled)"}`)
  console.log(result.url)
  if (result.clicked.length) console.log(`Clicked: ${result.clicked.join(", ")}`)
}

function printPrompt(result: FrontendPromptResult): void {
  printSetup(result)
  console.log(`Submitted: ${result.submitted ? "yes" : "no"}`)
  console.log(`Needs human: ${result.needsHuman ? "yes" : "no"}`)
  if (result.humanReason) console.log(`Human reason: ${result.humanReason}`)
  if (result.sessionId) console.log(`Session: ${result.sessionId}`)
  if (result.projectKey) console.log(`Project: ${result.projectKey}`)
  if (result.projectUrl) console.log(`Project URL: ${result.projectUrl}`)
  if (result.conversationUrl) console.log(`Conversation: ${result.conversationUrl}`)
  if (result.outputFile) console.log(`Output file: ${result.outputFile}`)
  console.log(`Page: ${result.title || "(untitled)"}`)
  console.log(result.url)
  if (result.responseText) {
    console.log("")
    console.log(result.responseText)
  } else if (result.submitted) {
    console.log(`Response text: ${result.responseLength ? `${result.responseLength} chars` : "not captured"}`)
  }
}

function printCollect(result: FrontendCollectResult): void {
  printSetup(result)
  console.log(`Running: ${result.running ? "yes" : "no"}`)
  if (result.sessionId) console.log(`Session: ${result.sessionId}`)
  if (result.conversationUrl) console.log(`Conversation: ${result.conversationUrl}`)
  if (result.outputFile) console.log(`Output file: ${result.outputFile}`)
  console.log(`Page: ${result.title || "(untitled)"}`)
  console.log(result.url)
  if (result.responseText) {
    console.log("")
    console.log(result.responseText)
  } else {
    console.log(`Response text: ${result.responseLength ? `${result.responseLength} chars` : "not captured"}`)
  }
}

function formatDate(value: number): string {
  return new Date(value).toISOString()
}

function truncate(value: string, length: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= length) return normalized
  return `${normalized.slice(0, Math.max(0, length - 3))}...`
}

function printProjects(projects: FrontendProjectRecord[]): void {
  if (!projects.length) {
    console.log("No saved projects.")
    return
  }
  for (const project of projects) {
    console.log(`${project.key} (${project.provider})`)
    console.log(`  Title: ${project.title}`)
    console.log(`  URL: ${project.url}`)
    console.log(`  Updated: ${formatDate(project.updatedAt)}`)
  }
}

function printSessions(sessions: FrontendSessionRecord[]): void {
  if (!sessions.length) {
    console.log("No saved sessions.")
    return
  }
  for (const session of sessions) {
    console.log(`${session.id} (${session.provider})`)
    console.log(`  Updated: ${formatDate(session.updatedAt)}`)
    if (session.projectKey) console.log(`  Project: ${session.projectKey}`)
    if (session.conversationUrl) console.log(`  Conversation: ${session.conversationUrl}`)
    if (session.title) console.log(`  Title: ${session.title}`)
    console.log(`  Prompt: ${truncate(session.prompt, 120)}`)
    if (session.responseText) console.log(`  Response: ${truncate(session.responseText, 160)}`)
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.command === "status") {
    const status = await run(frontendBrowserStatus(opts))
    if (opts.json) console.log(JSON.stringify(status, null, 2))
    else printStatus(status)
    return
  }

  if (opts.command === "projects") {
    if (opts.projectKey) {
      const project = await run(saveFrontendBrowserProject({
        key: opts.projectKey,
        provider: opts.provider ?? "chatgpt",
        title: opts.projectTitle,
        url: opts.projectUrl ?? "",
      }))
      if (opts.json) console.log(JSON.stringify(project, null, 2))
      else printProjects([project])
      return
    }

    const projects = await run(frontendBrowserProjects({ provider: opts.provider }))
    if (opts.json) console.log(JSON.stringify(projects, null, 2))
    else printProjects(projects)
    return
  }

  if (opts.command === "sessions") {
    const sessions = await run(frontendBrowserSessions({
      limit: opts.limit,
      project: opts.project,
      provider: opts.provider,
    }))
    if (opts.json) console.log(JSON.stringify(sessions, null, 2))
    else printSessions(sessions)
    return
  }

  if (opts.command === "google-login") {
    const result = await run(googleLoginFrontendBrowser(opts))
    if (opts.json) console.log(JSON.stringify(result, null, 2))
    else printGoogleLogin(result)
    return
  }

  if (opts.command === "chatgpt-login") {
    const result = await run(chatGptLoginFrontendBrowser({
      ...opts,
      background: opts.background ?? true,
      provider: "chatgpt",
    }))
    if (opts.json) console.log(JSON.stringify(result, null, 2))
    else printChatGptLogin(result)
    return
  }

  if (opts.command === "prompt") {
    if (!opts.prompt) throw new Error("Prompt is empty.")
    const result = await run(promptFrontendBrowser({
      ...opts,
      prompt: opts.prompt,
    }))
    if (opts.json) console.log(JSON.stringify(result, null, 2))
    else printPrompt(result)
    return
  }

  if (opts.command === "collect" || opts.command === "wait") {
    const result = await run(collectFrontendBrowser({
      ...opts,
      provider: opts.provider ?? "chatgpt",
      waitForResponse: opts.command === "wait" ? true : opts.waitForResponse ?? false,
    }))
    if (opts.json) console.log(JSON.stringify(result, null, 2))
    else printCollect(result)
    return
  }

  const result = await run(setupFrontendBrowser(opts))
  if (opts.json) console.log(JSON.stringify(result, null, 2))
  else printSetup(result)
}

main().catch((err) => {
  console.error(`LLM browser failed: ${toErrorMessage(err)}`)
  process.exit(1)
})

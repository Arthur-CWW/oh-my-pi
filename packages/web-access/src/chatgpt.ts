import { execFile } from "node:child_process"
import { Effect } from "effect"
import { ChatGptHandoffError } from "./schemas"

const CHATGPT_HOME = "https://chatgpt.com/"

export interface ChatGptHandoffOptions {
  prompt: string
  browser?: string
  conversationUrl?: string
  projectUrl?: string
  copyOnly?: boolean
}

export interface ChatGptHandoffResult {
  url: string
  browser: string
  copied: boolean
  opened: boolean
  mode: "new" | "conversation" | "project"
  promptLength: number
}

function execFilePromise(file: string, args: string[], input?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, (err) => {
      if (err) reject(err)
      else resolve()
    })
    if (input) child.stdin?.end(input)
  })
}

function normalizeChatGptUrl(value: string, label: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ChatGptHandoffError({ reason: `${label} must be a valid URL.` })
  }

  if (url.protocol !== "https:" || url.hostname !== "chatgpt.com") {
    throw new ChatGptHandoffError({ reason: `${label} must be an https://chatgpt.com URL.` })
  }
  return url.toString()
}

function targetFor(options: ChatGptHandoffOptions): Pick<ChatGptHandoffResult, "url" | "mode"> {
  if (options.conversationUrl) {
    return {
      url: normalizeChatGptUrl(options.conversationUrl, "conversationUrl"),
      mode: "conversation",
    }
  }

  if (options.projectUrl) {
    return {
      url: normalizeChatGptUrl(options.projectUrl, "projectUrl"),
      mode: "project",
    }
  }

  return { url: CHATGPT_HOME, mode: "new" }
}

export const openChatGptHandoff = Effect.fn("openChatGptHandoff")(function* (
  options: ChatGptHandoffOptions,
) {
  const prompt = options.prompt.trim()
  if (!prompt) {
    return yield* Effect.fail(new ChatGptHandoffError({ reason: "Prompt is empty." }))
  }

  const browser = options.browser?.trim() || "Firefox"
  const target = targetFor(options)

  yield* Effect.tryPromise({
    try: () => execFilePromise("pbcopy", [], prompt),
    catch: (err) => new ChatGptHandoffError({ reason: `Could not copy prompt: ${String(err)}` }),
  })

  if (!options.copyOnly) {
    yield* Effect.tryPromise({
      try: () => execFilePromise("open", ["-a", browser, target.url]),
      catch: (err) => new ChatGptHandoffError({ reason: `Could not open ${browser}: ${String(err)}` }),
    })
  }

  return {
    ...target,
    browser,
    copied: true,
    opened: !options.copyOnly,
    promptLength: prompt.length,
  }
})

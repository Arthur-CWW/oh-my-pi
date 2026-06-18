import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { Effect, Result } from "effect"
import { search } from "./search"
import { fetchContent } from "./fetch"
import { readCookies } from "./cookies"
import { storeSearch, storeFetch, getStored } from "./store"
import { getTranscript } from "./youtube"
import { openChatGptHandoff } from "./chatgpt"
import {
  isCuaDriverAction,
  runCuaDriver,
  type CuaDriverAction,
  type JsonValue,
} from "./cua-driver"
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
  type FrontendProvider,
} from "./frontend-browser"
import { registerCodexResume } from "./codex"
import registerVimLite from "./vim-lite"
import { registerAgentCockpit } from "./agent-cockpit-extension"
import { registerAgentHistory } from "./agent-history-extension"
import { toErrorMessage } from "./schemas"
import {
  executeComputerUseAction,
  getGlobalPolicyState,
  runComputerUseAction,
  setGlobalPolicyState,
} from "./computer-use"

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 80))}\n\n... truncated ${text.length - limit} chars ...`
}

// ─── Tool: cua_driver ────────────────────────────────────────────────

function registerCuaDriver(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "cua_driver",
    label: "CuaDriver",
    description:
      "Background-safe macOS GUI/browser automation through installed cua-driver. Use capture/get_window_state before element-indexed actions.",
    parameters: Type.Object({
      action: Type.String({
        description: "status, permissions, list_apps, list_windows, launch_app, capture, get_window_state, click, double_click, right_click, type_text, press_key, hotkey, scroll, drag, set_value, page, zoom, start_recording, or stop_recording",
      }),
      args: Type.Optional(Type.Any({ description: "JSON object passed to the underlying cua-driver tool" })),
      executable: Type.Optional(Type.String({ description: "Optional cua-driver executable path" })),
      timeoutMs: Type.Optional(Type.Number({ description: "Execution timeout in milliseconds" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as {
        action?: string
        args?: JsonValue
        executable?: string
        timeoutMs?: number
      }
      if (!params.action || !isCuaDriverAction(params.action)) {
        return {
          content: [{ type: "text", text: "Error: unsupported cua_driver action." }],
          details: { action: "", error: "Unsupported action", json: "", text: "" },
        }
      }

      const result = await run(
        Effect.match(runCuaDriver({
          action: params.action as CuaDriverAction,
          args: params.args,
          executable: params.executable,
          timeoutMs: params.timeoutMs,
        }), {
          onFailure: (err) => ({ error: toErrorMessage(err), ok: false as const }),
          onSuccess: (data) => ({ data, ok: true as const }),
        }),
      )

      if (result.ok === false) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          details: { action: params.action, error: result.error, json: "", text: "" },
        }
      }

      const output = result.data.json === null ? result.data.text : JSON.stringify(result.data.json, null, 2)
      const text = [
        `cua_driver ${result.data.action}: ok`,
        "",
        truncateText(output, 24_000),
      ].join("\n")
      return {
        content: [{ type: "text", text }],
        details: {
          action: result.data.action,
          error: "",
          json: result.data.json === null ? "" : JSON.stringify(result.data.json),
          text: result.data.text,
        },
      }
    },
  })
}

// ─── Tool: computer_use ──────────────────────────────────────────────

function registerComputerUse(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "computer_use",
    label: "ComputerUse",
    description:
      "Higher-level background computer use extension. Executes safe action mapping, policy classification, and runs the action via CuaDriver.",
    parameters: Type.Object({
      action: Type.String({
        description: "The computer use action: status, list_apps, get_app_state, capture, click, type, key",
      }),
      args: Type.Optional(Type.Any({ description: "JSON object containing arguments for the action" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as {
        action?: string
        args?: Record<string, JsonValue>
      }

      const rawAction = {
        type: params.action,
        ...(params.args || {}),
      }

      const result = await runComputerUseAction(
        rawAction,
        getGlobalPolicyState(),
        async (options) => {
          const runRes = await run(
            Effect.match(runCuaDriver(options), {
              onFailure: (err) => ({ error: toErrorMessage(err), ok: false as const }),
              onSuccess: (data) => ({ data, ok: true as const }),
            })
          )
          if (!runRes.ok) {
            throw new Error(runRes.error)
          }
          return runRes.data
        }
      )

      if (result.updatedState && !result.error && result.allowed) {
        setGlobalPolicyState(result.updatedState)
      }

      if (!result.allowed) {
        return {
          content: [{ type: "text", text: `Error: ${result.reason}` }],
          details: {
            action: params.action || "",
            error: result.reason || "Policy violation",
            json: JSON.stringify({
              allowed: false,
              reason: result.reason,
              updatedState: result.updatedState,
            }),
            text: `Error: ${result.reason}`,
          },
        }
      }

      if (result.error) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          details: {
            action: params.action || "",
            error: result.error,
            json: JSON.stringify({
              allowed: true,
              mappedAction: result.mappedAction,
              error: result.error,
              updatedState: result.updatedState,
            }),
            text: `Error: ${result.error}`,
          },
        }
      }

      const output = result.output!
      const outputText = output.json === null ? output.text : JSON.stringify(output.json, null, 2)
      const text = [
        `computer_use ${params.action}: ok`,
        `Mapped CuaDriver action: ${result.mappedAction?.action}`,
        `Updated policy state: ${JSON.stringify(result.updatedState)}`,
        "",
        truncateText(outputText, 24_000),
      ].join("\n")

      return {
        content: [{ type: "text", text }],
        details: {
          action: params.action || "",
          error: "",
          json: JSON.stringify({
            allowed: true,
            mappedAction: result.mappedAction,
            updatedState: result.updatedState,
            output: output.json,
          }),
          text: output.text,
        },
      }
    },
  })
}

// ─── Tool: web_search ─────────────────────────────────────────────────

function registerWebSearch(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Web search using Kagi (default) with Gemini fallback.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      provider: Type.Optional(Type.String()),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as { query: string; provider?: string }
      if (!params.query?.trim()) {
        return { content: [{ type: "text", text: "Error: Empty search query." }], details: { error: "Empty query" } }
      }

      const result = await run(
        Effect.match(search(params.query, {
          provider: (params.provider as "kagi" | "gemini" | undefined) ?? "kagi",
        }), {
          onFailure: (err) => ({
            text: `Search error: ${toErrorMessage(err)}`,
            ok: false as const,
          }),
          onSuccess: (response) => {
            // Fire-and-forget store
            run(storeSearch(response.answer, [...response.results])).catch(() => {})
            const lines: string[] = []
            if (response.answer) {
              lines.push(response.answer, "", "---", "", "**Sources:**")
            }
            response.results.forEach((r, i) => {
              lines.push(`${i + 1}. ${r.title}`, `   ${r.url}`)
              if (r.snippet) lines.push(`   ${r.snippet}`)
            })
            return { text: lines.join("\n"), ok: true as const }
          },
        }),
      )

      return {
        content: [{ type: "text", text: result.text }],
        details: result.ok ? { error: null as unknown as string } : { error: result.text },
      }
    },
  })
}

// ─── Tool: fetch_content ──────────────────────────────────────────────

function registerFetchContent(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "fetch_content",
    label: "Fetch Content",
    description: "Fetch URL(s) and extract readable content as markdown.",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
      urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple URLs (parallel)" })),
    }),
    async execute(_callId, rawParams, signal) {
      const params = rawParams as { url?: string; urls?: string[] }
      const urls = params.urls ?? (params.url ? [params.url] : [])
      if (!urls.length) {
        return { content: [{ type: "text", text: "Error: No URL provided." }], details: { error: "No URL" } }
      }

      const result = await run(
        Effect.match(fetchContent(urls, signal), {
          onFailure: (err) => ({ ok: false as const, error: toErrorMessage(err) }),
          onSuccess: (results) => {
            run(storeFetch([...results])).catch(() => {})
            return { ok: true as const, results }
          },
        }),
      )

      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          details: { error: result.error },
        }
      }

      const fetched = result.results
      if (fetched.length === 1) {
        const r = fetched[0]!
        if (r.error) {
          return {
            content: [{ type: "text", text: `Error: ${r.error}` }],
            details: { error: r.error },
          }
        }
        const truncated = r.content.length > 30000
        const display = truncated
          ? r.content.slice(0, 30000) + "\n\n[Content truncated...]"
          : r.content
        return {
          content: [{ type: "text", text: display }],
          details: { error: null as unknown as string },
        }
      }

      // Multi-URL summary
      const successful = fetched.filter((r) => !r.error).length
      let summary = "## Fetched URLs\n\n"
      for (const r of fetched) {
        if (r.error) summary += `- ${r.url}: Error - ${r.error}\n`
        else summary += `- ${r.title || r.url} (${r.content.length} chars)\n`
      }
      summary += "\n---\nUse get_search_content to retrieve full content."

      return {
        content: [{ type: "text", text: summary }],
        details: { error: null as unknown as string },
      }
    },
  })
}

// ─── Tool: get_search_content ─────────────────────────────────────────

function registerGetContent(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "get_search_content",
    label: "Get Search Content",
    description: "Retrieve full content from a previous web_search or fetch_content call.",
    parameters: Type.Object({
      responseId: Type.String({ description: "The responseId from web_search or fetch_content" }),
      queryIndex: Type.Optional(Type.Number({ description: "Get content for query at index" })),
      urlIndex: Type.Optional(Type.Number({ description: "Get content for URL at index" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as { responseId: string; queryIndex?: number; urlIndex?: number }
      const data = await run(getStored(params.responseId))

      if (!data) {
        return {
          content: [{ type: "text", text: `No stored results for "${params.responseId}".` }],
          details: { error: "Not found" },
        }
      }

      if (data.type === "search") {
        const idx = params.queryIndex ?? 0
        const query = data.queries[idx]
        if (!query) {
          return {
            content: [{ type: "text", text: `Index ${idx} out of range.` }],
            details: { error: "Index out of range" },
          }
        }
        if (query.error) {
          return {
            content: [{ type: "text", text: `Error: ${query.error}` }],
            details: { error: query.error },
          }
        }
        let out = `## Results for: "${query.query}"\n\n${query.answer}\n\n---\n\n`
        for (const r of query.results) out += `### ${r.title}\n${r.url}\n\n`
        return {
          content: [{ type: "text", text: out }],
          details: { error: null as unknown as string },
        }
      }

      // fetch type
      const idx = params.urlIndex ?? 0
      const url = data.urls[idx]
      if (!url) {
        return {
          content: [{ type: "text", text: `Index ${idx} out of range.` }],
          details: { error: "Index out of range" },
        }
      }
      if (url.error) {
        return {
          content: [{ type: "text", text: `Error: ${url.error}` }],
          details: { error: url.error },
        }
      }
      return {
        content: [{ type: "text", text: `# ${url.title}\n\n${url.content}` }],
        details: { error: null as unknown as string },
      }
    },
  })
}

// ─── Tool: chrome_cookies ─────────────────────────────────────────────

function registerCookies(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "chrome_cookies",
    label: "Chrome Cookies",
    description: "Read Google/Gemini cookie availability from local Chrome profile.",
    parameters: Type.Object({
      names: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as { names?: string[] }
      const res = await run(readCookies())
      const requested = params.names ?? ["__Secure-1PSID", "__Secure-1PSIDTS", "NID"]
      const present = requested.filter((n) => Boolean(res.cookies[n]))
      const warningText = res.warnings.length ? ` Warnings: ${res.warnings.length}.` : ""

      return {
        content: [{
          type: "text",
          text: `Found ${Object.keys(res.cookies).length} Google cookie(s). Present: ${present.length}/${requested.length}. Source: ${res.source}.${warningText}`,
        }],
        details: { error: null as unknown as string },
      }
    },
  })
}

// ─── Tool: youtube_transcript ─────────────────────────────────────────

function registerYouTube(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "youtube_transcript",
    label: "YouTube Transcript",
    description:
      "Extract the title, description, and full transcript (with timestamps) from a YouTube video. Requires yt-dlp: brew install yt-dlp",
    parameters: Type.Object({
      url: Type.String({ description: "YouTube video URL (watch, youtu.be, shorts, embed)" }),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as { url: string }
      const result = await run(
        Effect.match(getTranscript(params.url), {
          onFailure: (err) => ({ ok: false as const, error: toErrorMessage(err) }),
          onSuccess: (data) => ({ ok: true as const, data }),
        }),
      )

      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          details: { error: result.error },
        }
      }

      return {
        content: [{ type: "text", text: result.data.transcript }],
        details: { error: null as unknown as string },
      }
    },
  })
}

// ─── Tool: chatgpt_handoff ───────────────────────────────────────────

function registerChatGptHandoff(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "chatgpt_handoff",
    label: "ChatGPT Handoff",
    description:
      "Copy a prompt to the clipboard and open ChatGPT in a browser for a manual Pro run. Does not submit prompts or scrape responses.",
    parameters: Type.Object({
      prompt: Type.String({ description: "Prompt to copy to the clipboard" }),
      browser: Type.Optional(Type.String({ description: "macOS browser app to open (default: Firefox)" })),
      conversationUrl: Type.Optional(Type.String({ description: "Existing chatgpt.com conversation URL to continue" })),
      projectUrl: Type.Optional(Type.String({ description: "chatgpt.com project URL to open" })),
      copyOnly: Type.Optional(Type.Boolean({ description: "Only copy the prompt; do not open a browser" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as {
        prompt: string
        browser?: string
        conversationUrl?: string
        projectUrl?: string
        copyOnly?: boolean
      }

      if (params.conversationUrl && params.projectUrl) {
        return {
          content: [{ type: "text", text: "Error: Use either conversationUrl or projectUrl, not both." }],
          details: { error: "Conflicting targets" },
        }
      }

      const result = await run(
        Effect.match(openChatGptHandoff(params), {
          onFailure: (err) => ({ ok: false as const, error: toErrorMessage(err) }),
          onSuccess: (data) => ({ ok: true as const, data }),
        }),
      )

      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          details: { error: result.error },
        }
      }

      const opened = result.data.opened
        ? `Opened ${result.data.mode} target in ${result.data.browser}: ${result.data.url}`
        : `Copy-only mode. Target would be: ${result.data.url}`

      return {
        content: [{
          type: "text",
          text: `Copied ${result.data.promptLength} characters to the clipboard.\n${opened}\nPaste and submit manually in ChatGPT.`,
        }],
        details: { error: null as unknown as string },
      }
    },
  })
}

// ─── Tool: llm_frontend_browser ──────────────────────────────────────

function registerLlmFrontendBrowser(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "llm_frontend_browser",
    label: "LLM Frontend Browser",
    description:
      "Launch, open, inspect, prompt, or collect responses from a dedicated Helium/Chromium CDP profile for frontend LLM sites like AI Studio, ChatGPT, and Grok.",
    parameters: Type.Object({
      action: Type.Optional(Type.String({ description: "setup, open, google-login, chatgpt-login, prompt, collect, wait, sessions, projects, save-project, or status (default: status)" })),
      account: Type.Optional(Type.String({ description: "Optional Keychain account label for google-login/chatgpt-login" })),
      conversationUrl: Type.Optional(Type.String({ description: "Existing provider conversation URL for action=collect/wait" })),
      outputFile: Type.Optional(Type.String({ description: "Write captured response text to this local file" })),
      prompt: Type.Optional(Type.String({ description: "Prompt text for action=prompt" })),
      provider: Type.Optional(Type.String({ description: "aistudio, deepseek, chatgpt, grok, or jimeng (default: aistudio)" })),
      browser: Type.Optional(Type.String({ description: "macOS browser app (default: Helium)" })),
      port: Type.Optional(Type.Number({ description: "CDP port" })),
      profileDir: Type.Optional(Type.String({ description: "Browser user data directory" })),
      background: Type.Optional(Type.Boolean({ description: "Do not activate the browser" })),
      newChat: Type.Optional(Type.Boolean({ description: "Start a new provider chat for action=prompt" })),
      project: Type.Optional(Type.String({ description: "Saved project key or direct project URL for action=prompt/sessions" })),
      projectKey: Type.Optional(Type.String({ description: "Project alias key for action=save-project" })),
      projectTitle: Type.Optional(Type.String({ description: "Human title for action=save-project" })),
      projectUrl: Type.Optional(Type.String({ description: "Project URL for action=prompt/save-project" })),
      waitForResponse: Type.Optional(Type.Boolean({ description: "Wait for best-effort response text for action=prompt" })),
      responseTimeoutMs: Type.Optional(Type.Number({ description: "Response wait timeout for action=prompt" })),
      session: Type.Optional(Type.String({ description: "Saved session id prefix or latest for action=prompt" })),
      limit: Type.Optional(Type.Number({ description: "Number of sessions to list for action=sessions" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as {
        action?: string
        account?: string
        conversationUrl?: string
        outputFile?: string
        prompt?: string
        provider?: string
        browser?: string
        port?: number
        profileDir?: string
        background?: boolean
        newChat?: boolean
        project?: string
        projectKey?: string
        projectTitle?: string
        projectUrl?: string
        waitForResponse?: boolean
        responseTimeoutMs?: number
        session?: string
        limit?: number
      }

      const provider = params.provider as FrontendProvider | undefined
      const options = {
        provider,
        browser: params.browser,
        port: params.port,
        profileDir: params.profileDir,
        account: params.account,
        background: params.background ?? (params.action === "open" || params.action === "prompt"),
      }

      if (params.provider && !["aistudio", "deepseek", "chatgpt", "grok", "jimeng"].includes(params.provider)) {
        return {
          content: [{ type: "text", text: "Error: provider must be one of: aistudio, deepseek, chatgpt, grok, jimeng." }],
          details: { error: "Invalid provider" },
        }
      }

      if (
        params.action
        && !["setup", "open", "google-login", "chatgpt-login", "prompt", "collect", "wait", "sessions", "projects", "save-project", "status"]
          .includes(params.action)
      ) {
        return {
          content: [{ type: "text", text: "Error: action must be one of: setup, open, google-login, chatgpt-login, prompt, collect, wait, sessions, projects, save-project, status." }],
          details: { error: "Invalid action" },
        }
      }

      const action = params.action ?? "status"
      if (action === "prompt" && !params.prompt?.trim()) {
        return {
          content: [{ type: "text", text: "Error: prompt is required for action=prompt." }],
          details: { error: "Missing prompt" },
        }
      }
      if (action === "save-project" && (!params.projectKey?.trim() || !params.projectUrl?.trim())) {
        return {
          content: [{ type: "text", text: "Error: projectKey and projectUrl are required for action=save-project." }],
          details: { error: "Missing project" },
        }
      }

      if (action === "save-project") {
        const projectResult = await run(
          Effect.match(saveFrontendBrowserProject({
            key: params.projectKey ?? "",
            provider: provider ?? "chatgpt",
            title: params.projectTitle,
            url: params.projectUrl ?? "",
          }), {
            onFailure: (err) => ({ ok: false as const, error: toErrorMessage(err) }),
            onSuccess: (data) => ({ ok: true as const, data }),
          }),
        )
        if (!projectResult.ok) {
          return {
            content: [{ type: "text", text: `Error: ${projectResult.error}` }],
            details: { error: projectResult.error },
          }
        }
        const project = projectResult.data
        const text = [
          `${project.key} (${project.provider})`,
          `Title: ${project.title}`,
          `URL: ${project.url}`,
          `Updated: ${new Date(project.updatedAt).toISOString()}`,
        ].join("\n")
        return {
          content: [{ type: "text", text }],
          details: { error: null as unknown as string },
        }
      }

      if (action === "projects") {
        const projectResult = await run(
          Effect.match(frontendBrowserProjects({ provider }), {
            onFailure: (err) => ({ ok: false as const, error: toErrorMessage(err) }),
            onSuccess: (data) => ({ ok: true as const, data }),
          }),
        )
        if (!projectResult.ok) {
          return {
            content: [{ type: "text", text: `Error: ${projectResult.error}` }],
            details: { error: projectResult.error },
          }
        }
        const text = projectResult.data.length
          ? projectResult.data.map((project) => [
            `${project.key} (${project.provider})`,
            `Title: ${project.title}`,
            `URL: ${project.url}`,
            `Updated: ${new Date(project.updatedAt).toISOString()}`,
          ].join("\n")).join("\n\n")
          : "No saved projects."
        return {
          content: [{ type: "text", text }],
          details: { error: null as unknown as string },
        }
      }

      if (action === "sessions") {
        const sessionResult = await run(
          Effect.match(frontendBrowserSessions({ limit: params.limit, project: params.project, provider }), {
            onFailure: (err) => ({ ok: false as const, error: toErrorMessage(err) }),
            onSuccess: (data) => ({ ok: true as const, data }),
          }),
        )
        if (!sessionResult.ok) {
          return {
            content: [{ type: "text", text: `Error: ${sessionResult.error}` }],
            details: { error: sessionResult.error },
          }
        }
        const trim = (value: string, length: number) => {
          const normalized = value.replace(/\s+/g, " ").trim()
          if (normalized.length <= length) return normalized
          return `${normalized.slice(0, Math.max(0, length - 3))}...`
        }
        const text = sessionResult.data.length
          ? sessionResult.data.map((session) => [
            `${session.id} (${session.provider})`,
            `Updated: ${new Date(session.updatedAt).toISOString()}`,
            ...(session.projectKey ? [`Project: ${session.projectKey}`] : []),
            ...(session.conversationUrl ? [`Conversation: ${session.conversationUrl}`] : []),
            ...(session.title ? [`Title: ${session.title}`] : []),
            `Prompt: ${trim(session.prompt, 120)}`,
            ...(session.responseText ? [`Response: ${trim(session.responseText, 160)}`] : []),
          ].join("\n")).join("\n\n")
          : "No saved sessions."
        return {
          content: [{ type: "text", text }],
          details: { error: null as unknown as string },
        }
      }

      const effect = action === "google-login"
        ? googleLoginFrontendBrowser({ ...options, background: params.background ?? true })
        : action === "chatgpt-login"
          ? chatGptLoginFrontendBrowser({ ...options, background: params.background ?? true, provider: "chatgpt" })
        : action === "prompt"
          ? promptFrontendBrowser({
            ...options,
            background: params.background ?? true,
            newChat: params.newChat,
            outputFile: params.outputFile,
            prompt: params.prompt ?? "",
            project: params.project,
            projectUrl: params.projectUrl,
            responseTimeoutMs: params.responseTimeoutMs,
            session: params.session,
            waitForResponse: params.waitForResponse,
          })
          : action === "collect" || action === "wait"
          ? collectFrontendBrowser({
            ...options,
            background: params.background ?? true,
            conversationUrl: params.conversationUrl,
            outputFile: params.outputFile,
            project: params.project,
            responseTimeoutMs: params.responseTimeoutMs,
            session: params.session ?? "latest",
            waitForResponse: action === "wait" ? true : params.waitForResponse ?? false,
          })
          : action === "status"
            ? frontendBrowserStatus(options)
            : setupFrontendBrowser(options)
      const result = await run(
        Effect.match(effect, {
          onFailure: (err) => ({ ok: false as const, error: toErrorMessage(err) }),
          onSuccess: (data) => ({ ok: true as const, data }),
        }),
      )

      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Error: ${result.error}` }],
          details: { error: result.error },
        }
      }

      const data = result.data
      const lines = [
        `${data.provider}: ${data.running ? "running" : "not running"}`,
        `Browser: ${data.browser}`,
        `CDP: ${data.cdpUrl}`,
        `Profile: ${data.profileDir}`,
        `Tabs: ${data.tabs.length}`,
      ]

      const setupData = data as { selectedTab?: { title: string; url: string } | null }
      if (setupData.selectedTab) {
        lines.push(`Provider tab: ${setupData.selectedTab.title || "(untitled)"}`, setupData.selectedTab.url)
      }
      const googleData = data as {
        credentialAccount?: string
        humanReason?: string | null
        loggedIn?: boolean
        needsHuman?: boolean
        reusedTab?: boolean
        title?: string
        url?: string
      }
      if (googleData.credentialAccount) {
        lines.push(
          `Credential account: ${googleData.credentialAccount}`,
          `${action === "chatgpt-login" ? "ChatGPT" : "Google"} login: ${googleData.loggedIn ? "ok" : "not confirmed"}`,
          `Needs human: ${googleData.needsHuman ? "yes" : "no"}`,
          ...(action === "google-login" ? [`Reused tab: ${googleData.reusedTab ? "yes" : "no"}`] : []),
          ...(typeof googleData.humanReason === "string" ? [`Human reason: ${googleData.humanReason}`] : []),
          `Page: ${googleData.title || "(untitled)"}`,
          googleData.url ?? "",
        )
      }
      const promptData = data as {
        conversationUrl?: string | null
        humanReason?: string | null
        needsHuman?: boolean
        projectKey?: string | null
        outputFile?: string | null
        projectUrl?: string | null
        responseLength?: number
        responseText?: string
        running?: boolean
        sessionId?: string | null
        submitted?: boolean
        title?: string
        url?: string
      }
      if (action === "prompt") {
        lines.push(
          `Submitted: ${promptData.submitted ? "yes" : "no"}`,
          `Needs human: ${promptData.needsHuman ? "yes" : "no"}`,
        )
        if (promptData.humanReason) lines.push(`Human reason: ${promptData.humanReason}`)
        if (promptData.sessionId) lines.push(`Session: ${promptData.sessionId}`)
        if (promptData.projectKey) lines.push(`Project: ${promptData.projectKey}`)
        if (promptData.projectUrl) lines.push(`Project URL: ${promptData.projectUrl}`)
        if (promptData.conversationUrl) lines.push(`Conversation: ${promptData.conversationUrl}`)
        if (promptData.outputFile) lines.push(`Output file: ${promptData.outputFile}`)
        lines.push(`Page: ${promptData.title || "(untitled)"}`, promptData.url ?? "")
        if (promptData.responseText) lines.push("", promptData.responseText)
        else if (promptData.submitted) lines.push(`Response text: ${promptData.responseLength ? `${promptData.responseLength} chars` : "not captured"}`)
      }
      if (action === "collect" || action === "wait") {
        lines.push(`Running: ${promptData.running ? "yes" : "no"}`)
        if (promptData.sessionId) lines.push(`Session: ${promptData.sessionId}`)
        if (promptData.conversationUrl) lines.push(`Conversation: ${promptData.conversationUrl}`)
        if (promptData.outputFile) lines.push(`Output file: ${promptData.outputFile}`)
        lines.push(`Page: ${promptData.title || "(untitled)"}`, promptData.url ?? "")
        if (promptData.responseText) lines.push("", promptData.responseText)
        else lines.push(`Response text: ${promptData.responseLength ? `${promptData.responseLength} chars` : "not captured"}`)
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { error: null as unknown as string },
      }
    },
  })
}

// ─── Entrypoint ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  registerCuaDriver(pi)
  registerComputerUse(pi)
  registerWebSearch(pi)
  registerFetchContent(pi)
  registerGetContent(pi)
  registerCookies(pi)
  registerYouTube(pi)
  registerChatGptHandoff(pi)
  registerLlmFrontendBrowser(pi)
  registerCodexResume(pi)
  registerVimLite(pi)
  registerAgentCockpit(pi)
  registerAgentHistory(pi)
}

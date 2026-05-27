import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "@sinclair/typebox"
import { Effect, Result } from "effect"
import { search } from "./search"
import { fetchContent } from "./fetch"
import { readCookies } from "./cookies"
import { storeSearch, storeFetch, getStored } from "./store"
import { getTranscript } from "./youtube"
import { toErrorMessage } from "./schemas"

function run<E, A>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect as Effect.Effect<A, E, never>)
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

// ─── Entrypoint ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  registerWebSearch(pi)
  registerFetchContent(pi)
  registerGetContent(pi)
  registerCookies(pi)
  registerYouTube(pi)
}

import { Type } from "@sinclair/typebox"
import { Effect, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"
import { downloadBorgesLibrary, searchBorgesLibrary } from "./client"
import { BookResultFromJsonStringSchema } from "./schemas"
import type { BookResult, DownloadResult } from "./schemas"

const httpLayer = FetchHttpClient.layer

function formatResults(results: readonly BookResult[]): string {
  if (results.length === 0) {
    return "No books found in the library."
  }
  const lines: string[] = ["**Borges Library Search Results:**", ""]
  results.forEach((r, i) => {
    const authors = r.authors.join(", ")
    const year = r.year ? ` (${r.year})` : ""
    const size = r.size ? ` - ${r.size}` : ""
    const format = r.format.toUpperCase()
    lines.push(`${i + 1}. **${r.title}** by *${authors}*${year}`)
    lines.push(`   Format: ${format}${size}`)
    lines.push(`   ID: ${r.id}`)
    lines.push("")
  })
  return lines.join("\n")
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "borges_library_search",
    label: "Borges Library Search",
    description: "Search the Borges Library for books. Returns metadata only.",
    parameters: Type.Object({
      query: Type.String({ description: "Book title, author, or keywords to search" }),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results to return", default: 10 })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as { query: string; limit?: number }
      try {
        const results = await Effect.runPromise(
          searchBorgesLibrary(params.query, params.limit ?? 10).pipe(
            Effect.provide(httpLayer),
          ),
        )
        return {
          content: [{ type: "text", text: formatResults(results) }],
          details: { results, error: undefined as string | undefined },
        }
      } catch (err) {
        return {
          content: [{ type: "text", text: `Search failed: ${String(err)}` }],
          details: { results: [] as BookResult[], error: String(err) },
        }
      }
    },
  })

  pi.registerTool({
    name: "borges_library_download",
    label: "Borges Library Download",
    description: "Download a book from the Borges Library. Only works with a search result from borges_library_search.",
    parameters: Type.Object({
      result_json: Type.String({ description: "The raw JSON of the book result from borges_library_search" }),
      outDir: Type.Optional(Type.String({ description: "Output directory for the downloaded file (default: ~/.borges-library/downloads)" })),
    }),
    async execute(_callId, rawParams) {
      const params = rawParams as { result_json: string; outDir?: string }
      try {
        const result = Schema.decodeUnknownSync(BookResultFromJsonStringSchema)(params.result_json)
        const downloadResult = await Effect.runPromise(
          downloadBorgesLibrary(result, params.outDir).pipe(
            Effect.provide(httpLayer),
          ),
        )
        return {
          content: [
            {
              type: "text",
              text: `Downloaded: **${downloadResult.title}**\nSaved to: \`${downloadResult.downloadedPath}\` (${(downloadResult.bytes / 1024 / 1024).toFixed(2)} MB)`,
            },
          ],
          details: { result: downloadResult as DownloadResult | undefined, error: undefined as string | undefined },
        }
      } catch (err) {
        return {
          content: [{ type: "text", text: `Download failed: ${String(err)}` }],
          details: { result: undefined as DownloadResult | undefined, error: String(err) },
        }
      }
    },
  })
}

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"
import { InternalUrlRouter } from "@oh-my-pi/pi-coding-agent/internal-urls"

const CUSTOM_TYPE = "agent-history-view"
const DISPLAY_LIMIT = 80_000


function truncateTranscript(content: string, id: string): string {
  if (content.length <= DISPLAY_LIMIT) return content
  return [
    content.slice(0, DISPLAY_LIMIT),
    "",
    `--- truncated ${content.length - DISPLAY_LIMIT} chars ---`,
    `Full transcript: read history://${id}`,
  ].join("\n")
}


export function registerAgentHistory(pi: ExtensionAPI): void {
  pi.registerCommand("agent-history", {
    description: "Inspect a live, idle, or parked subagent transcript without reviving it",
    handler: async (rawArgs, ctx) => {
      let id = rawArgs.trim().replace(/^history:\/\//, "").replace(/^read\s+history:\/\//, "").trim()

      if (id === "list" || id === "ls" || id === "--list") {
        pi.sendMessage({
          customType: CUSTOM_TYPE,
          content: (await InternalUrlRouter.instance().resolve("history://")).content,
          display: true,
          details: { mode: "index" },
        })
        return
      }

      if (!id) {
        const options = await InternalUrlRouter.instance().complete("history", "") ?? []
        if (options.length === 0) {
          pi.sendMessage({
            customType: CUSTOM_TYPE,
            content: (await InternalUrlRouter.instance().resolve("history://")).content,
            display: true,
            details: { mode: "index" },
          })
          return
        }

        if (!ctx.hasUI) {
          pi.sendMessage({
            customType: CUSTOM_TYPE,
            content: (await InternalUrlRouter.instance().resolve("history://")).content,
            display: true,
            details: { mode: "index" },
          })
          return
        }

        const labels = options.map((option) => option.description ? `${option.value} — ${option.description}` : option.value)
        const selected = await ctx.ui.select("Inspect agent transcript", labels, {
          helpText: "Opens history://<agent> read-only through the internal history protocol; parked agents are not revived.",
        })
        if (!selected) return
        const selectedIndex = labels.indexOf(selected)
        id = options[selectedIndex]?.value ?? selected
      }

      const content = truncateTranscript((await InternalUrlRouter.instance().resolve(`history://${id}`)).content, id)
      pi.sendMessage({
        customType: CUSTOM_TYPE,
        content,
        display: true,
        details: { agentId: id, mode: "transcript", source: `history://${id}` },
      })
    },
  })
}

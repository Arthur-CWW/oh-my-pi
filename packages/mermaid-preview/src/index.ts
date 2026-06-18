import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent"
import { truncateToWidth, type Component } from "@oh-my-pi/pi-tui"
import {
  buildMermaidPreviewDetails,
  extractMessageText,
  MERMAID_PREVIEW_CUSTOM_TYPE,
  type MermaidPreviewDetails,
} from "./preview"

const COLLAPSED_LINES_PER_DIAGRAM = 18

class MermaidPreviewComponent implements Component {
  constructor(
    private readonly header: string,
    private readonly subtitle: string,
    private readonly diagrams: Array<{ title: string; lines: string[]; footer?: string }>,
  ) {}

  render(width: number): string[] {
    const lines: string[] = []
    lines.push(truncateToWidth(this.header, width))
    lines.push(truncateToWidth(this.subtitle, width))
    lines.push("")

    this.diagrams.forEach((diagram, index) => {
      lines.push(truncateToWidth(diagram.title, width))
      for (const line of diagram.lines) {
        lines.push(truncateToWidth(line, width))
      }
      if (diagram.footer) lines.push(truncateToWidth(diagram.footer, width))
      if (index < this.diagrams.length - 1) lines.push("")
    })

    return lines
  }

  invalidate(): void {}
}

function isPreviewMessage(message: unknown): message is {
  role: "custom"
  customType: string
  details?: MermaidPreviewDetails
} {
  return Boolean(
    message
    && typeof message === "object"
    && "role" in message
    && "customType" in message
    && (message as { role?: string }).role === "custom"
    && (message as { customType?: string }).customType === MERMAID_PREVIEW_CUSTOM_TYPE,
  )
}

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer<MermaidPreviewDetails>(MERMAID_PREVIEW_CUSTOM_TYPE, (message, { expanded }, theme) => {
    const details = message.details as MermaidPreviewDetails | undefined
    const diagrams = details?.diagrams ?? []
    const renderedDiagrams = diagrams.map((diagram, index) => {
      const title = diagrams.length > 1
        ? theme.fg("muted", `diagram ${index + 1}`)
        : theme.fg("muted", "diagram")

      if (diagram.error) {
        return {
          title,
          lines: [theme.fg("error", `render error: ${diagram.error}`)],
        }
      }

      const body = (diagram.ascii ?? "").split("\n")
      const collapsed = !expanded && body.length > COLLAPSED_LINES_PER_DIAGRAM
      return {
        title,
        lines: collapsed ? body.slice(0, COLLAPSED_LINES_PER_DIAGRAM) : body,
        footer: collapsed ? theme.fg("dim", `… ${body.length - COLLAPSED_LINES_PER_DIAGRAM} more lines`) : undefined,
      }
    })

    return new MermaidPreviewComponent(
      theme.fg("accent", theme.bold("Mermaid preview")),
      theme.fg("dim", `${details?.diagramCount ?? renderedDiagrams.length} diagram(s) from ${details?.sourceRole ?? "message"}`),
      renderedDiagrams,
    )
  })

  pi.on("context", (event) => ({
    messages: event.messages.filter((message) => !isPreviewMessage(message)),
  }))

  pi.on("message_end", (event, ctx) => {
    if (!ctx.hasUI) return
    if (event.message.role !== "user" && event.message.role !== "assistant") return

    const markdown = extractMessageText(event.message)
    const details = buildMermaidPreviewDetails(markdown, event.message.role)
    if (!details) return

    pi.sendMessage({
      customType: MERMAID_PREVIEW_CUSTOM_TYPE,
      content: `Mermaid preview (${details.diagramCount})`,
      display: true,
      details,
    })
  })
}

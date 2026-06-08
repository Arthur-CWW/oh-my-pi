import { renderMermaidASCII } from "beautiful-mermaid"

export const MERMAID_PREVIEW_CUSTOM_TYPE = "mermaid-preview"

export interface MermaidBlock {
  source: string
}

export interface MermaidDiagramPreview {
  source: string
  ascii?: string
  error?: string
}

export interface MermaidPreviewDetails {
  diagramCount: number
  sourceRole: string
  diagrams: MermaidDiagramPreview[]
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = []
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")

  let openFence: string | null = null
  let buffer: string[] = []

  for (const line of lines) {
    if (!openFence) {
      const match = /^[ \t]*(```+|~~~+)\s*mermaid\b[^\n]*$/i.exec(line)
      if (match) {
        openFence = match[1]!
        buffer = []
      }
      continue
    }

    if (new RegExp(`^[ \\t]*${escapeRegex(openFence)}\\s*$`).test(line)) {
      const source = buffer.join("\n").trim()
      if (source) blocks.push({ source })
      openFence = null
      buffer = []
      continue
    }

    buffer.push(line)
  }

  return blocks
}

export function renderMermaidPreview(source: string): MermaidDiagramPreview {
  try {
    return {
      source,
      ascii: renderMermaidASCII(source, {
        useAscii: false,
        paddingX: 3,
        paddingY: 1,
        boxBorderPadding: 1,
        colorMode: "none",
      }),
    }
  } catch (error) {
    return {
      source,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function buildMermaidPreviewDetails(markdown: string, sourceRole: string): MermaidPreviewDetails | null {
  const blocks = extractMermaidBlocks(markdown)
  if (!blocks.length) return null

  const diagrams = blocks.map((block) => renderMermaidPreview(block.source))
  return {
    diagramCount: diagrams.length,
    sourceRole,
    diagrams,
  }
}

export function extractMessageText(message: { content: unknown }): string {
  const { content } = message
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""

  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") return [] as string[]
      const candidate = block as { type?: string; text?: string }
      return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : []
    })
    .join("\n\n")
}

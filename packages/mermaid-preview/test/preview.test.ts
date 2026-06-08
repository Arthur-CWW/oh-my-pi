import { describe, expect, it } from "bun:test"
import {
  buildMermaidPreviewDetails,
  extractMermaidBlocks,
  extractMessageText,
} from "../src/preview"

describe("extractMermaidBlocks", () => {
  it("finds fenced mermaid blocks", () => {
    const markdown = [
      "before",
      "```mermaid",
      "graph LR",
      "  A --> B --> C",
      "```",
      "after",
      "~~~mermaid",
      "flowchart TD",
      "  X --> Y",
      "~~~",
    ].join("\n")

    expect(extractMermaidBlocks(markdown)).toEqual([
      { source: "graph LR\n  A --> B --> C" },
      { source: "flowchart TD\n  X --> Y" },
    ])
  })
})

describe("buildMermaidPreviewDetails", () => {
  it("renders mermaid blocks to unicode previews", () => {
    const details = buildMermaidPreviewDetails("```mermaid\ngraph LR\n  A --> B --> C\n```", "assistant")
    expect(details).not.toBeNull()
    expect(details?.diagramCount).toBe(1)
    expect(details?.diagrams[0]?.ascii).toContain("A")
    expect(details?.diagrams[0]?.ascii).toContain("B")
    expect(details?.diagrams[0]?.ascii).toContain("C")
    expect(details?.diagrams[0]?.ascii).toMatch(/[┌►]/)
  })

  it("returns null when no mermaid blocks are present", () => {
    expect(buildMermaidPreviewDetails("just text", "user")).toBeNull()
  })
})

describe("extractMessageText", () => {
  it("joins text blocks and ignores non-text blocks", () => {
    const text = extractMessageText({
      content: [
        { type: "text", text: "one" },
        { type: "thinking", thinking: "ignore me" },
        { type: "text", text: "two" },
      ],
    })

    expect(text).toBe("one\n\ntwo")
  })
})

import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { ReactUgcStudio, reactUgcStudioViewMetadata } from "./ReactUgcStudio"
import { createInitialLocalState } from "../ugc/local-state"

const stablePrimitiveTokens = {
  field: ["grid", "gap-1.5"],
  fieldLabel: ["text-[11px]", "font-medium", "leading-4", "text-zinc-500"],
  select: ["min-w-0", "border-input", "text-foreground", "focus-visible:ring-ring"],
  note: ["rounded-lg", "border-zinc-200", "bg-zinc-50", "text-muted-foreground", "[&_strong]:text-foreground"],
} as const

function stableClassTokens(html: string, pattern: RegExp, expectedTokens: readonly string[]): readonly string[] {
  const className = html.match(pattern)?.[1]
  expect(className).toBeDefined()
  const tokens = new Set(className!.replace(/&amp;/g, "&").split(/\s+/))
  const stableTokens = expectedTokens.filter((token) => tokens.has(token))
  expect(stableTokens).toEqual(expectedTokens)
  return stableTokens
}

function stableCopy(html: string, text: string): string {
  expect(html).toContain(text)
  return text
}


describe("React UGC Studio route model", () => {
  test("defines the maintained workbench views without rendering HTML", () => {
    expect(reactUgcStudioViewMetadata.map((view) => view.value)).toEqual([
      "atlas",
      "explore",
      "campaign",
      "provider",
      "review",
      "editor",
      "reference",
      "graph",
      "pipeline",
      "browser",
      "hyperframes",
    ])
    expect(reactUgcStudioViewMetadata.map((view) => view.label)).toEqual([
      "Persona Atlas",
      "Exploration Board",
      "Campaign Branch Map",
      "KIE Proxy",
      "Batch Review",
      "Final Layer Editor",
      "Reference Archive",
      "Developer Graph",
      "Pipeline Debug",
      "Browse Artifacts",
      "HyperFrames",
    ])
  })

  test("seeds reviewable workspace state before render", () => {
    const state = createInitialLocalState("2026-06-13T00:00:00.000Z")

    expect(state.workspace.personas.length).toBeGreaterThan(0)
    expect(state.workspace.candidates.length).toBeGreaterThan(0)
    expect(state.referenceArchives.length).toBeGreaterThan(0)
    expect(state.workspace.finalEditor.tracks.length).toBeGreaterThan(0)
    expect(state.providerJobs.every((job) => job.mode === "dry-run" || job.mode === "live")).toBe(true)
  })

  test("renders the actual provider surface with migrated workbench form primitives and local/live copy", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReactUgcStudio, { initialView: "provider" }),
    )

    expect(html).toContain("data-ugc-studio-root")
    expect(html).toContain("KIE route controls")
    expect(html).toContain("Seedream 5 Lite text-to-image")
    expect(html).toContain("Default action prepares local dry-run JSON")
    expect(html).toContain("Send live ($0.05 cap)")

    expect({
      copy: {
        panelEyebrow: stableCopy(html, "Local provider controls"),
        panelTitle: stableCopy(html, "KIE route controls"),
        label: stableCopy(html, "Operation"),
        option: stableCopy(html, "image-text / seedream/5-lite-text-to-image"),
        capability: stableCopy(html, "Seedream 5 Lite text-to-image"),
        localBoundary: stableCopy(html, "local dry-run JSON"),
        liveBoundary: stableCopy(html, "capped provider request"),
        dryRunAction: stableCopy(html, "Plan dry-run JSON"),
        liveAction: stableCopy(html, "Send live ($0.05 cap)"),
      },
      primitives: {
        field: stableClassTokens(html, /<label class="([^"]+)"><span class="[^"]+">Operation<\/span><select/, stablePrimitiveTokens.field),
        fieldLabel: stableClassTokens(html, /<span class="([^"]+)">Operation<\/span><select/, stablePrimitiveTokens.fieldLabel),
        select: stableClassTokens(html, /<select class="([^"]+)"/, stablePrimitiveTokens.select),
        note: stableClassTokens(html, /<div class="([^"]+)"><strong>Seedream 5 Lite text-to-image<\/strong>/, stablePrimitiveTokens.note),
      },
    }).toEqual({
      copy: {
        panelEyebrow: "Local provider controls",
        panelTitle: "KIE route controls",
        label: "Operation",
        option: "image-text / seedream/5-lite-text-to-image",
        capability: "Seedream 5 Lite text-to-image",
        localBoundary: "local dry-run JSON",
        liveBoundary: "capped provider request",
        dryRunAction: "Plan dry-run JSON",
        liveAction: "Send live ($0.05 cap)",
      },
      primitives: {
        field: ["grid", "gap-1.5"],
        fieldLabel: ["text-[11px]", "font-medium", "leading-4", "text-zinc-500"],
        select: ["min-w-0", "border-input", "text-foreground", "focus-visible:ring-ring"],
        note: ["rounded-lg", "border-zinc-200", "bg-zinc-50", "text-muted-foreground", "[&_strong]:text-foreground"],
      },
    })
  })

})

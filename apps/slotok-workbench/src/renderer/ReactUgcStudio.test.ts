import { describe, expect, test } from "vitest"
import { reactUgcStudioViewMetadata } from "./ReactUgcStudio"
import { createInitialLocalState } from "../ugc/local-state"

describe("React UGC Studio route model", () => {
  test("defines the maintained workbench views without rendering HTML", () => {
    expect(reactUgcStudioViewMetadata.map((view) => view.value)).toEqual([
      "atlas",
      "explore",
      "review",
      "campaign",
      "reference",
      "editor",
      "graph",
      "provider",
    ])
    expect(reactUgcStudioViewMetadata.map((view) => view.label)).toEqual([
      "Persona Atlas",
      "Exploration Board",
      "Batch Review",
      "Campaign Branch Map",
      "Reference Archive",
      "Final Layer Editor",
      "Developer Graph",
      "KIE Proxy",
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
})

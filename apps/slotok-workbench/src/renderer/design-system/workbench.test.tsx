import { describe, expect, test } from "vitest"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ReactUgcStudio } from "../ReactUgcStudio"

const stableWorkbenchTokens = {
  shell: ["grid", "h-dvh", "min-h-0", "overflow-hidden", "bg-background", "text-foreground"],
  content: ["grid", "min-h-0", "flex-1", "overflow-hidden"],
  commandSurface: ["overflow-hidden", "border-zinc-200", "bg-white/95", "shadow-md", "backdrop-blur-md", "p-2", "flex", "items-end", "rounded-xl"],
  commandTextarea: ["min-h-10", "min-w-0", "flex-1", "border-0", "bg-transparent", "focus-visible:ring-0"],
} as const

function stableClassTokens(html: string, pattern: RegExp, expectedTokens: readonly string[]): readonly string[] {
  const className = html.match(pattern)?.[1]
  expect(className).toBeDefined()
  const tokens = new Set(className!.split(/\s+/))
  const stableTokens = expectedTokens.filter((token) => tokens.has(token))
  expect(stableTokens).toEqual(expectedTokens)
  return stableTokens
}

function stableCopy(html: string, text: string): string {
  expect(html).toContain(text)
  return text
}


describe("UGC workbench design system", () => {
  test("asserts focused workbench invariants from the real provider surface", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReactUgcStudio, { initialView: "provider" }),
    )

    expect({
      copy: {
        activeNavigation: stableCopy(html, "KIE Proxy"),
        panelEyebrow: stableCopy(html, "Local provider controls"),
        panelTitle: stableCopy(html, "KIE route controls"),
        providerQueue: stableCopy(html, "Provider jobs"),
        localBoundary: stableCopy(html, "Default action prepares local dry-run JSON"),
        liveBoundary: stableCopy(html, "Send live ($0.05 cap)"),
        commandPrompt: stableCopy(html, "Make the selected personas less polished and generate 8 warmer hooks"),
      },
      layout: {
        shell: stableClassTokens(html, /<main class="([^"]+)"/, stableWorkbenchTokens.shell),
        content: stableClassTokens(html, /<div class="([^"]*flex-1[^"]*overflow-hidden[^"]*)"/, stableWorkbenchTokens.content),
      },
      commandSurface: {
        surface: stableClassTokens(html, /<div data-ugc-command-surface="true" class="([^"]+)"/, stableWorkbenchTokens.commandSurface),
        textarea: stableClassTokens(html, /<textarea class="([^"]+)"/, stableWorkbenchTokens.commandTextarea),
      },
    }).toMatchSnapshot()
  })
})

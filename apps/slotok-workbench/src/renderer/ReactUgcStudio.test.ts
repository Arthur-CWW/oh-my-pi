import { describe, expect, test } from "vitest"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ReactUgcStudio } from "./ReactUgcStudio"

describe("React UGC Studio route", () => {
  test("renders the KIE-enabled shadcn comparison surface", () => {
    const html = renderToStaticMarkup(React.createElement(ReactUgcStudio))

    expect(html).toContain("Persona Atlas")
    expect(html).toContain("Exploration Board")
    expect(html).toContain("Batch Review")
    expect(html).toContain("Reference Archive")
    expect(html).toContain("Developer Graph")
    expect(html).toContain("KIE Proxy")
    expect(html).toContain("Seoul Gym Diary")
  })
})

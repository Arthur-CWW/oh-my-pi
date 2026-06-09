import { afterEach, describe, expect, test } from "vitest"
import type { JSX } from "solid-js"
import { render } from "solid-js/web"
import { App } from "./App"
import { UgcStudio } from "./UgcStudio"
import { fixtureBootstrap, fixtureDetail, truncatedDetail } from "./test-fixtures"

let disposers: Array<() => void> = []

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  document.body.innerHTML = ""
})

describe("Slotok workbench UI snapshots", () => {
  test("offline shell", () => {
    const html = renderSnapshot(() => <App fetchOnMount={false} />)
    expect(html).toMatchSnapshot()
  })

  test("loaded eval browser", () => {
    const html = renderSnapshot(() => (
      <App fetchOnMount={false} initialBootstrap={fixtureBootstrap} initialDetail={fixtureDetail} />
    ))
    expect(html).toMatchSnapshot()
  })

  test("json view with truncated provider output", () => {
    const html = renderSnapshot(() => (
      <App
        fetchOnMount={false}
        initialBootstrap={fixtureBootstrap}
        initialDetail={truncatedDetail}
        initialView="json"
      />
    ))
    expect(html).toMatchSnapshot()
  })

  test("ugc studio demo shell", () => {
    const html = renderSnapshot(() => <UgcStudio />)
    expect(html).toMatchSnapshot()
  })
})

function renderSnapshot(component: () => JSX.Element): string {
  const root = document.createElement("div")
  document.body.append(root)
  const dispose = render(component, root)
  disposers.push(dispose)
  return normalizeHtml(root.innerHTML)
}

function normalizeHtml(value: string): string {
  return value
    .replace(/ data-hk="[^"]+"/g, "")
    .replace(/<!---->/g, "")
    .replace(/\s+$/gm, "")
    .trim()
}

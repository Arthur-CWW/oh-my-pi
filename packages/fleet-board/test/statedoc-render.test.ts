import { describe, expect, test } from "bun:test"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { renderMarkdownSubset } from "../ui/src/components/session/session-view"

function html(markdown: string): string {
  return renderToStaticMarkup(React.createElement("div", null, renderMarkdownSubset(markdown)))
}

describe("state document markdown subset", () => {
  test("renders headings, paragraphs, inline code, and safe links", () => {
    const output = html("# Heading\n\nA `session-id` links to [the fleet](https://example.com/fleet).")
    expect(output).toContain("<h1")
    expect(output).toContain("Heading")
    expect(output).toContain("<code")
    expect(output).toContain("session-id")
    expect(output).toContain('href="https://example.com/fleet"')
  })

  test("renders ordered and unordered lists", () => {
    const output = html("- first\n- second\n\n1. one\n2) two")
    expect(output).toContain("<ul")
    expect(output).toContain("<li>first</li>")
    expect(output).toContain("<ol")
    expect(output).toContain("<li>one</li>")
    expect(output).toContain("<li>two</li>")
  })

  test("renders fenced code as escaped text", () => {
    const output = html("```ts\nconst value = `<unsafe>`\n```")
    expect(output).toContain('class="language-ts"')
    expect(output).toContain("const value = `&lt;unsafe&gt;`")
    expect(output).not.toContain("<unsafe>")
  })

  test("escapes raw HTML and rejects javascript links", () => {
    const output = html('<script>alert("x")</script> [bad](javascript:alert) [ok](mailto:ops@example.com)')
    expect(output).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;")
    expect(output).not.toContain("javascript:")
    expect(output).not.toContain('href="javascript:')
    expect(output).toContain('href="mailto:ops@example.com"')
  })
})

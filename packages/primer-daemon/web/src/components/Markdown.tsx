import { createElement } from "react"
import type * as React from "react"

import { cn } from "@/lib/utils"
import { Separator } from "./ui/separator"

const CODE = /`([^`]+)`/
const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/
const BOLD = /(\*\*|__)(.+?)\1/
const ITALIC = /(\*|_)(.+?)\1/

// Ordered by precedence so that, at an equal match index, bold wins over italic.
const RULES: readonly [string, RegExp][] = [
  ["code", CODE],
  ["link", LINK],
  ["bold", BOLD],
  ["italic", ITALIC],
]

/** Inline spans: `code`, [links](url), **bold**, _italic_ — recursively. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let rest = text
  let k = 0

  while (rest.length > 0) {
    let best: { type: string; m: RegExpExecArray; priority: number } | null = null
    for (let priority = 0; priority < RULES.length; priority++) {
      const [type, re] = RULES[priority]
      const m = re.exec(rest)
      if (m === null) continue
      if (best === null || m.index < best.m.index || (m.index === best.m.index && priority < best.priority)) {
        best = { type, m, priority }
      }
    }

    if (best === null) {
      nodes.push(rest)
      break
    }

    const { type, m } = best
    if (m.index > 0) nodes.push(rest.slice(0, m.index))
    const key = `${keyPrefix}-${k++}`

    if (type === "code") {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {m[1]}
        </code>,
      )
    } else if (type === "link") {
      nodes.push(
        <a
          key={key}
          href={m[2]}
          target="_blank"
          rel="noreferrer"
          className="text-primer underline decoration-primer/40 underline-offset-2 transition-colors hover:decoration-primer"
        >
          {renderInline(m[1], key)}
        </a>,
      )
    } else if (type === "bold") {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {renderInline(m[2], key)}
        </strong>,
      )
    } else {
      nodes.push(<em key={key}>{renderInline(m[2], key)}</em>)
    }

    rest = rest.slice(m.index + m[0].length)
  }

  return nodes
}

const HEADING_CLASS = [
  "text-lg font-semibold",
  "text-base font-semibold",
  "text-sm font-semibold",
  "text-sm font-medium",
  "text-xs font-medium uppercase tracking-wide text-muted-foreground",
  "text-xs font-medium uppercase tracking-wide text-muted-foreground",
]

function isStructural(line: string): boolean {
  return /^```/.test(line) || /^#{1,6}\s+/.test(line) || /^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line) || /^\s*>\s?/.test(line)
}

function parseBlocks(src: string): React.ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n")
  const out: React.ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (/^```/.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      i++ // consume closing fence
      out.push(
        <pre key={key++} className="overflow-x-auto rounded-lg border border-border/60 bg-muted/40 p-3 text-xs">
          <code className="font-mono">{body.join("\n")}</code>
        </pre>,
      )
      continue
    }

    if (/^\s*$/.test(line)) {
      i++
      continue
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push(<Separator key={key++} className="my-4" />)
      i++
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length
      out.push(
        createElement(
          `h${Math.min(level + 1, 6)}`,
          { key: key++, className: cn(HEADING_CLASS[level - 1], "mb-1 mt-4 tracking-tight text-foreground first:mt-0") },
          renderInline(heading[2], `h${key}`),
        ),
      )
      i++
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""))
        i++
      }
      out.push(
        <blockquote key={key++} className="border-l-2 border-primer/40 pl-3 italic text-muted-foreground">
          {renderInline(body.join(" "), `bq${key}`)}
        </blockquote>,
      )
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""))
        i++
      }
      out.push(
        <ul key={key++} className="list-disc space-y-1 pl-5 marker:text-muted-foreground/60">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `ul${key}-${idx}`)}</li>
          ))}
        </ul>,
      )
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""))
        i++
      }
      out.push(
        <ol key={key++} className="list-decimal space-y-1 pl-5 marker:text-muted-foreground/60">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `ol${key}-${idx}`)}</li>
          ))}
        </ol>,
      )
      continue
    }

    const para: string[] = []
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isStructural(lines[i])) {
      para.push(lines[i])
      i++
    }
    out.push(<p key={key++}>{renderInline(para.join(" "), `p${key}`)}</p>)
  }

  return out
}

export function Markdown({ source, className }: { source: string; className?: string }): React.JSX.Element {
  return <div className={cn("space-y-3 text-sm leading-relaxed [overflow-wrap:anywhere]", className)}>{parseBlocks(source)}</div>
}

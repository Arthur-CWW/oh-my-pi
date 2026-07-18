import { useMemo, useState, type ReactNode } from "react"
import { ArrowLeft, Check, Circle, Copy, ExternalLink, FileText, GitBranch, History, Loader2 } from "lucide-react"
import { useLiveSession, useStateDoc } from "@/data/use-statedoc"
import type { Issue } from "@/data/types"
import { Button } from "@/components/ui/button"

export interface SessionViewSession {
  readonly id?: string
  readonly sessionId?: string
  readonly name?: string
  readonly spawnName?: string
  readonly state?: string
  readonly status?: string
  readonly workstream?: string
  readonly objective?: string
  readonly summary?: string
  readonly todoHead?: string
  readonly todo_head?: string
  readonly claims?: readonly unknown[] | string
  readonly journal?: string
  readonly journalPath?: string
  readonly sessionJournal?: string
  readonly session_journal?: string
  readonly version?: string
  readonly digest?: string
  readonly buildDigest?: string
  readonly build_digest?: string
  readonly versionDigest?: string
  readonly version_digest?: string
  readonly lastSeen?: string
  readonly last_seen?: string
  readonly freshness?: string
  readonly createdAt?: string
}

export interface SessionViewProps {
  readonly sessionId?: string
  readonly session?: SessionViewSession | Issue | null
  readonly issue?: Issue | null
}

interface NormalizedSession {
  readonly sessionId: string
  readonly name: string
  readonly state: string
  readonly workstream: string
  readonly objective: string
  readonly summary: string
  readonly todoHead: string
  readonly claims: readonly string[]
  readonly journalPath: string
  readonly version: string
  readonly digest: string
  readonly freshness: string
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = stringValue(record[key])
    if (value) return value
  }
  return ""
}

function normalizeClaims(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.flatMap((claim) => {
    if (typeof claim === "string") return claim.trim() ? [claim.trim()] : []
    if (claim !== null && typeof claim === "object") {
      const text = firstString(claim as Record<string, unknown>, ["name", "id", "claim", "text", "description"])
      return text ? [text] : []
    }
    return []
  })
}

function normalizeSession(value: unknown, fallbackId: string): NormalizedSession | null {
  const record = recordOf(value)
  const sessionId = firstString(record, ["sessionId", "session_id", "id"]) || fallbackId
  if (!sessionId) return null
  const statusRecord = record.status !== null && typeof record.status === "object" ? recordOf(record.status) : {}
  const state = firstString(record, ["state", "status"]) || firstString(statusRecord, ["name", "id"]) || "unknown"
  return {
    sessionId,
    name: firstString(record, ["name", "displayName", "display_name", "spawnName", "spawn_name", "title"]) || sessionId,
    state,
    workstream: firstString(record, ["workstream"]),
    objective: firstString(record, ["objective"]),
    summary: firstString(record, ["summary", "title"]),
    todoHead: firstString(record, ["todoHead", "todo_head"]),
    claims: normalizeClaims(record.claims),
    journalPath: firstString(record, ["journalPath", "journal_path", "journal", "sessionJournal", "session_journal"]),
    version: firstString(record, ["version", "clientVersion", "client_version", "serverVersion", "server_version"]),
    digest: firstString(record, ["digest", "buildDigest", "build_digest", "versionDigest", "version_digest"]),
    freshness: firstString(record, ["lastSeen", "last_seen", "freshness", "createdAt", "created_at"]),
  }
}

function routeSessionId(): string {
  if (typeof window === "undefined") return ""
  const match = window.location.hash.match(/^#\/session\/(.+)$/)
  if (!match?.[1]) return ""
  try {
    return decodeURIComponent(match[1]).trim()
  } catch {
    return match[1].trim()
  }
}

function safeHref(value: string): string | null {
  const href = value.trim()
  if (!href || /[\u0000-\u001f]/.test(href)) return null
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^(?:https?:|mailto:|history:|omp:)/i.test(href)) return null
  if (/^(?:https?:|mailto:|history:|omp:)/i.test(href) || /^(?:[./]|#)/.test(href) || !href.includes(":")) return href
  return null
}

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  const token = /`([^`\n]*)`|\[([^\]\n]+)\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g
  const output: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = token.exec(value)) !== null) {
    if (match.index > cursor) output.push(value.slice(cursor, match.index))
    if (match[1] !== undefined) {
      output.push(<code key={`${keyPrefix}-code-${match.index}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">{match[1]}</code>)
    } else {
      const label = match[2] ?? ""
      const href = safeHref(match[3] ?? "")
      output.push(href === null ? label : <a key={`${keyPrefix}-link-${match.index}`} href={href} className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary" rel={/^https?:/i.test(href) ? "noreferrer" : undefined}>{label}</a>)
    }
    cursor = match.index + match[0].length
  }
  if (cursor < value.length) output.push(value.slice(cursor))
  return output
}

/** Render the deliberately small, safe markdown subset used by state documents. */
export function renderMarkdownSubset(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const output: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ""
    if (/^\s*```/.test(line)) {
      const language = line.replace(/^\s*```/, "").trim()
      const code: string[] = []
      const start = index
      index += 1
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "")
        index += 1
      }
      if (index < lines.length) index += 1
      output.push(<pre key={`fence-${start}`} className="overflow-x-auto rounded-lg border border-border/70 bg-muted/35 p-3 text-xs leading-5"><code className={language ? `language-${language}` : undefined}>{code.join("\n")}</code></pre>)
      continue
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/)
    if (heading) {
      const level = heading[1]?.length ?? 1
      const children = renderInline(heading[2] ?? "", `heading-${index}`)
      const headingClass = level === 1 ? "text-xl font-semibold" : level === 2 ? "text-lg font-semibold" : "font-semibold"
      if (level === 1) output.push(<h1 key={`heading-${index}`} className={headingClass}>{children}</h1>)
      else if (level === 2) output.push(<h2 key={`heading-${index}`} className={headingClass}>{children}</h2>)
      else if (level === 3) output.push(<h3 key={`heading-${index}`} className={headingClass}>{children}</h3>)
      else if (level === 4) output.push(<h4 key={`heading-${index}`} className={headingClass}>{children}</h4>)
      else if (level === 5) output.push(<h5 key={`heading-${index}`} className={headingClass}>{children}</h5>)
      else output.push(<h6 key={`heading-${index}`} className={headingClass}>{children}</h6>)
      index += 1
      continue
    }
    const listMarker = line.match(/^\s*([-*+])\s+(.+)$/) ?? line.match(/^\s*(\d+)[.)]\s+(.+)$/)
    if (listMarker) {
      const ordered = /^\d+$/.test(listMarker[1] ?? "")
      const items: ReactNode[] = []
      const listStart = index
      while (index < lines.length) {
        const current = lines[index] ?? ""
        const match = ordered ? current.match(/^\s*\d+[.)]\s+(.+)$/) : current.match(/^\s*[-*+]\s+(.+)$/)
        if (!match) break
        items.push(<li key={`item-${index}`}>{renderInline(match[1] ?? "", `item-${index}`)}</li>)
        index += 1
      }
      if (ordered) output.push(<ol key={`list-${listStart}`} className="list-decimal space-y-1 pl-5">{items}</ol>)
      else output.push(<ul key={`list-${listStart}`} className="list-disc space-y-1 pl-5">{items}</ul>)
      continue
    }
    if (line.trim() === "") {
      index += 1
      continue
    }
    const paragraph: string[] = []
    const paragraphStart = index
    while (index < lines.length) {
      const current = lines[index] ?? ""
      if (current.trim() === "" || /^\s*```/.test(current) || /^\s{0,3}#{1,6}\s+/.test(current) || /^\s*[-*+]\s+/.test(current) || /^\s*\d+[.)]\s+/.test(current)) break
      paragraph.push(current)
      index += 1
    }
    if (paragraph.length > 0) output.push(<p key={`paragraph-${paragraphStart}`} className="leading-7 text-foreground/90">{renderInline(paragraph.join("\n"), `paragraph-${paragraphStart}`)}</p>)
  }
  return output
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function formatFreshness(value: string): string {
  if (!value) return "Freshness unavailable"
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return value
  const elapsed = Math.max(0, Date.now() - timestamp)
  if (elapsed < 60_000) return "Just now"
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function stateDotClass(state: string): string {
  const normalized = state.toLowerCase().replace(/[\-_]+/g, " ")
  if (normalized.includes("work") || normalized.includes("run") || normalized.includes("progress")) return "bg-emerald-500"
  if (normalized.includes("wait") || normalized.includes("input")) return "bg-amber-400"
  if (normalized.includes("idle") || normalized.includes("done") || normalized.includes("complete")) return "bg-sky-400"
  if (normalized.includes("hold") || normalized.includes("pause")) return "bg-muted-foreground"
  return "bg-violet-400"
}

function Property({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 border-b border-border/50 py-2.5 last:border-b-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="min-w-0 break-words text-xs text-foreground/90">{value || "—"}</dd></div>
}

async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fall through to the older browser path.
    }
  }
  const input = document.createElement("textarea")
  input.value = value
  input.setAttribute("readonly", "")
  input.style.position = "fixed"
  input.style.opacity = "0"
  document.body.append(input)
  input.select()
  let copied = false
  try {
    copied = document.execCommand("copy")
  } catch {
    copied = false
  }
  input.remove()
  return copied
}

function CopySnippet({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return <div className="flex items-start gap-2 rounded-md border border-border/70 bg-muted/20 p-2"><code className="min-w-0 flex-1 break-all whitespace-pre-wrap text-[11px] leading-5 text-foreground/80">{value}</code><Button type="button" variant="ghost" size="icon" className="size-7 shrink-0" aria-label={`Copy ${label}`} title={`Copy ${label}`} onClick={() => { void copyText(value).then(setCopied) }}>{copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}</Button></div>
}

export default function SessionView({ sessionId: propSessionId, session: providedSession, issue }: SessionViewProps) {
  const routeId = propSessionId?.trim() || routeSessionId()
  const rawSession = useLiveSession(routeId)
  const source = rawSession.row ?? providedSession ?? issue
  const session = useMemo(() => normalizeSession(source, routeId), [source, routeId])
  const stateDoc = useStateDoc(session?.sessionId)
  const markdownNodes = useMemo(() => stateDoc.markdown === null ? [] : renderMarkdownSubset(stateDoc.markdown), [stateDoc.markdown])

  if (!session && rawSession.loading) return <div className="flex min-h-full items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading session…</div>
  if (!session) return <div className="flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center"><Circle className="size-8 text-muted-foreground" /><h1 className="text-lg font-semibold">Session not found</h1><p className="max-w-md text-sm text-muted-foreground">This session is no longer reporting to the fleet.</p><Button asChild variant="outline" size="sm"><a href="#/"><ArrowLeft className="size-3.5" />Back to fleet</a></Button></div>

  const historyUri = `history://${session.sessionId}`
  const labelCommand = `omp fleet label ${shellQuote(session.sessionId)} --summary ${shellQuote(session.summary || "<summary>")}`
  return <div className="min-h-full bg-container text-foreground">
    <header className="border-b border-border/70 px-5 py-4 sm:px-8"><div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3"><a href="#/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"><ArrowLeft className="size-3.5" />Fleet</a><span className="text-muted-foreground/50">/</span><span className="font-mono text-xs text-muted-foreground">{session.sessionId}</span><span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"><span className={`size-2 rounded-full ${stateDotClass(session.state)}`} aria-hidden="true" />{session.state}</span></div><div className="mx-auto mt-4 flex max-w-7xl flex-wrap items-end gap-x-4 gap-y-2"><div className="min-w-0 flex-1"><h1 className="truncate text-2xl font-semibold tracking-tight">{session.name}</h1><div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{session.workstream && <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5"><GitBranch className="size-3" />{session.workstream}</span>}<span>{session.version ? `v${session.version}` : "Version unknown"}</span><span className="text-muted-foreground/50">·</span><span>{session.digest ? `digest ${session.digest}` : "digest unavailable"}</span><span className="text-muted-foreground/50">·</span><span>{formatFreshness(session.freshness)}</span></div></div></div></header>
    <main className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:px-8"><article className="min-w-0"><div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"><FileText className="size-3.5" />State document</div>{stateDoc.status === "loading" && stateDoc.markdown === null && <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading state document…</div>}{stateDoc.status === "missing" && <div className="rounded-lg border border-dashed border-border bg-muted/15 p-6 text-sm text-muted-foreground">No state document yet for this session.</div>}{stateDoc.status === "error" && stateDoc.markdown === null && <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">State document could not be loaded. The next refresh will retry.</div>}{stateDoc.status === "error" && stateDoc.markdown !== null && <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-500">Showing the last state document; refresh will retry.</div>}{stateDoc.status === "ready" && stateDoc.markdown === "" && <div className="rounded-lg border border-dashed border-border bg-muted/15 p-6 text-sm text-muted-foreground">State document is empty.</div>}{stateDoc.markdown !== null && stateDoc.markdown !== "" && <div className="space-y-5 text-sm">{markdownNodes}</div>}</article><aside className="min-w-0 space-y-6 lg:border-l lg:border-border/60 lg:pl-6"><section><h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Properties</h2><dl><Property label="Summary" value={session.summary} /><Property label="Todo head" value={session.todoHead} /><Property label="Objective" value={session.objective} />{session.claims.length > 0 && <Property label="Claims" value={session.claims.join(", ")} />}<Property label="Journal path" value={session.journalPath} /></dl></section><section><h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Copyable snippets</h2><div className="space-y-2"><CopySnippet value={historyUri} label="history URI" /><CopySnippet value={labelCommand} label="fleet label command" /></div><a href={historyUri} className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><History className="size-3" />Open history URI<ExternalLink className="size-3" /></a></section></aside></main>
  </div>
}

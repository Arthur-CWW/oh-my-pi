#!/usr/bin/env bun
/** Public following lead miner for @pleometric. Concurrency 1, first 200 rows, 1-3s jitter, stop on 403/429. */
import { mkdir, writeFile } from "node:fs/promises"

const BASE_URL = "https://nitter.tiekoetter.com"
const OUT_PATH = "data/inspiration/pleometric/leads.json"
const USER_AGENT = "curl/8.0"
const KEYWORDS = [
  "shader",
  "glsl",
  "webgl",
  "three.js",
  "threejs",
  "houdini",
  "touchdesigner",
  "motion",
  "generative",
  "creative code",
  "creative coding",
  "p5.js",
  "processing",
  "visual",
  "graphics",
]

interface Lead {
  handle: string
  name: string
  bio: string
  why: string
}

async function main(): Promise<void> {
  const leads: Lead[] = []
  const seen = new Set<string>()
  const walls: string[] = []
  let pages = 0
  let scanned = 0
  let url: string | undefined = `${BASE_URL}/pleometric/following`

  while (url && scanned < 200 && pages < 10) {
    const response = await fetch(url, { headers: { accept: "text/html,application/xhtml+xml", "user-agent": USER_AGENT } })
    const body = await response.text()
    pages += 1
    if (response.status === 429 || response.status === 403) {
      walls.push(`${response.status} at ${url}`)
      break
    }
    if (!response.ok) {
      walls.push(`${response.status} at ${url}`)
      break
    }

    const chunks = body.split(/<div class="timeline-item" data-username="/g)
    for (let i = 1; i < chunks.length && scanned < 200; i += 1) {
      const chunk = chunks[i]
      const handle = chunk.split('"')[0]
      if (!handle || seen.has(handle)) continue
      seen.add(handle)
      scanned += 1
      const name = htmlText(chunk.match(/<a class="fullname"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "")
      const bio = htmlText(chunk.match(/<div class="tweet-content media-body"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "")
      const haystack = `${handle} ${name} ${bio}`.toLowerCase()
      const hits = KEYWORDS.filter((keyword) => haystack.includes(keyword))
      if (hits.length > 0) {
        leads.push({ handle, name, bio, why: `Matched public following bio/name keyword(s): ${hits.join(", ")}` })
      }
    }

    url = nextCursorUrl(body, url)
    if (url && scanned < 200) await sleep(1000 + Math.floor(Math.random() * 2001))
  }

  await mkdir("data/inspiration/pleometric", { recursive: true })
  await writeFile(
    OUT_PATH,
    `${JSON.stringify({ schemaVersion: "creative-leads.v1", source: "pleometric-following", generatedAt: new Date().toISOString(), leads }, null, 2)}\n`,
  )
  console.log(JSON.stringify({ pages, scanned, leads: leads.length, walls }, null, 2))
}

function nextCursorUrl(html: string, currentUrl: string): string | undefined {
  const rawHref = html.match(/<div class="show-more">\s*<a href="([^"]*cursor=[^"]+)"/)?.[1]
  if (!rawHref) return undefined
  const href = decodeHtml(rawHref)
  if (/^https?:\/\//i.test(href)) return href
  if (href.startsWith("?")) return `${BASE_URL}${new URL(currentUrl).pathname}${href}`
  return `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`
}

function htmlText(html: string): string {
  return decodeHtml(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

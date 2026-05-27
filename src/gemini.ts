import { readFileSync } from "node:fs"
import { basename } from "node:path"
import { Effect, Result, Schedule } from "effect"
import { geminiApiKey } from "./config"
import { readCookies } from "./cookies"
import { GeminiError, toErrorMessage } from "./schemas"
import type { CookieMap } from "./schemas"

const API = "https://generativelanguage.googleapis.com/v1beta"
const WEB = "https://gemini.google.com/app"
const STREAM = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
const UPLOAD = "https://content-push.googleapis.com/upload"
const PUSH_ID = "feeds/mcudyrk2a4khkz"
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const MODELS: Record<string, string> = {
  "gemini-3-pro": '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
  "gemini-2.5-pro": '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
  "gemini-2.5-flash": '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
}

const REQ_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS"]

function timeout(sig: AbortSignal | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms)
  return sig ? AbortSignal.any([sig, t]) : t
}

function cookieStr(cookies: CookieMap): string {
  return Object.entries(cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("; ")
}

function nested(o: unknown, path: number[]): unknown {
  let cur = o
  for (const i of path) {
    if (cur == null || !Array.isArray(cur)) return undefined
    cur = cur[i]
  }
  return cur
}

export function isApiAvailable(): boolean { return geminiApiKey() !== null }

// ─── Gemini REST API ──────────────────────────────────────────────────

export interface ApiOpts {
  model?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export const queryApi = Effect.fn("queryApi")(function* (
  prompt: string,
  opts: ApiOpts & { grounding?: boolean; urlContext?: boolean } = {},
) {
  const key = geminiApiKey()
  if (!key) return yield* new GeminiError({ reason: "GEMINI_API_KEY not configured" })

  const model = opts.model ?? "gemini-3-flash-preview"
  const sig = timeout(opts.signal, opts.timeoutMs ?? 60000)

  const tools: unknown[] = []
  if (opts.grounding) tools.push({ google_search: {} })
  if (opts.urlContext) tools.push({ url_context: {} })

  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(`${API}/models/${model}:generateContent?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          ...(tools.length ? { tools } : {}),
        }),
        signal: sig,
      }),
    catch: (err) => new GeminiError({ reason: `Request: ${toErrorMessage(err)}` }),
  })

  if (!response.ok) {
    const body = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: () => "(failed)",
    })
    return yield* new GeminiError({ reason: `Gemini API ${response.status}: ${body.slice(0, 200)}` })
  }

  const data = yield* Effect.tryPromise({
    try: () => response.json() as Promise<{
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> }
        groundingMetadata?: {
          groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>
        }
      }>
    }>,
    catch: (err) => new GeminiError({ reason: `Parse: ${toErrorMessage(err)}` }),
  })

  const parts = data.candidates?.[0]?.content?.parts
  if (!parts?.length) return yield* new GeminiError({ reason: "Empty response" })

  let text = parts.map((p) => p.text ?? "").filter(Boolean).join("\n")

  const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks
  if (chunks?.length) {
    const sources = chunks
      .filter((c) => c.web?.uri)
      .map((c) => `- [${c.web!.title ?? c.web!.uri}](${c.web!.uri})`)
    if (sources.length) text += "\n\nSources:\n" + sources.join("\n")
  }

  return text
})

// ─── Gemini Web ───────────────────────────────────────────────────────

export interface WebOpts {
  model?: string
  files?: string[]
  signal?: AbortSignal
  timeoutMs?: number
}

export const isWebAvailable = Effect.fn("isWebAvailable")(function* () {
  const r = yield* readCookies()
  return REQ_COOKIES.every((n) => Boolean(r.cookies[n])) ? r.cookies : null
})

export const queryWeb = Effect.fn("queryWeb")(function* (
  prompt: string,
  cookies: CookieMap,
  opts: WebOpts = {},
) {
  const model = opts.model && MODELS[opts.model] ? opts.model : "gemini-2.5-flash"
  const sig = timeout(opts.signal, opts.timeoutMs ?? 120000)

  // Auth token
  let url = WEB
  let token = ""
  for (let i = 0; i <= 10; i++) {
    const r = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          headers: { "user-agent": UA, cookie: cookieStr(cookies) },
          redirect: "manual",
          signal: sig,
        }),
      catch: (err) => new GeminiError({ reason: `Web auth: ${toErrorMessage(err)}` }),
    })

    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location")
      if (loc) { url = new URL(loc, url).toString(); continue }
    }

    const html = yield* Effect.tryPromise({
      try: () => r.text(),
      catch: (err) => new GeminiError({ reason: `Web auth read: ${toErrorMessage(err)}` }),
    })

    for (const key of ["SNlM0e", "thykhd"]) {
      const m = html.match(new RegExp(`"${key}":"(.*?)"`))
      if (m?.[1]) { token = m[1]; break }
    }
    if (token) break
  }
  if (!token) return yield* new GeminiError({ reason: "Unable to authenticate with Gemini Web" })

  // Upload files
  const uploaded: Array<{ id: string; name: string }> = []
  if (opts.files?.length) {
    for (const fp of opts.files) {
      const data = readFileSync(fp)
      const name = basename(fp)
      const boundary = "----FB" + Math.random().toString(36).slice(2)
      const hdr = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      const ftr = `\r\n--${boundary}--\r\n`
      const body = Buffer.concat([Buffer.from(hdr, "utf-8"), data, Buffer.from(ftr, "utf-8")])

      const r = yield* Effect.tryPromise({
        try: () =>
          fetch(UPLOAD, {
            method: "POST",
            headers: {
              "content-type": `multipart/form-data; boundary=${boundary}`,
              "push-id": PUSH_ID,
              "user-agent": UA,
              cookie: cookieStr(cookies),
            },
            body,
            signal: sig,
          }),
        catch: (err) => new GeminiError({ reason: `Upload: ${toErrorMessage(err)}` }),
      })
      if (!r.ok) {
        const txt = yield* Effect.tryPromise({ try: () => r.text(), catch: () => "(failed)" })
        return yield* new GeminiError({ reason: `Upload ${r.status}: ${txt.slice(0, 150)}` })
      }
      const id = yield* Effect.tryPromise({
        try: () => r.text(),
        catch: (err) => new GeminiError({ reason: `Upload read: ${toErrorMessage(err)}` }),
      })
      uploaded.push({ id, name })
    }
  }

  // Build request
  const payload = uploaded.length
    ? [prompt, 0, null, uploaded.map((f) => [[f.id, 1]])]
    : [prompt]
  const fReq = JSON.stringify([null, JSON.stringify([payload, null, null])])
  const params = new URLSearchParams()
  params.set("at", token)
  params.set("f.req", fReq)

  const res = yield* Effect.tryPromise({
    try: () =>
      fetch(STREAM, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=utf-8",
          host: "gemini.google.com", origin: "https://gemini.google.com",
          referer: "https://gemini.google.com/", "x-same-domain": "1",
          "user-agent": UA, cookie: cookieStr(cookies),
          "x-goog-ext-525001261-jspb": MODELS[model],
        },
        body: params.toString(),
        signal: sig,
      }),
    catch: (err) => new GeminiError({ reason: `Web request: ${toErrorMessage(err)}` }),
  }).pipe(Effect.retry(Schedule.recurs(1)))

  const raw = yield* Effect.tryPromise({
    try: () => res.text(),
    catch: (err) => new GeminiError({ reason: `Read: ${toErrorMessage(err)}` }),
  })

  if (!res.ok) return yield* new GeminiError({ reason: `Gemini Web returned ${res.status}` })

  return yield* Effect.try({
    try: () => {
      const start = raw.indexOf("["), end = raw.lastIndexOf("]")
      if (start === -1 || end <= start) throw new Error("No JSON in response")
      const json = JSON.parse(raw.slice(start, end + 1)) as unknown[]

      const code = nested(json, [0, 5, 2, 0, 1, 0])
      if (typeof code === "number" && code > 0) {
        if (code === 1052 && model !== "gemini-2.5-flash") {
          throw new GeminiError({ reason: `Model ${model} unavailable (code 1052)` })
        }
        throw new Error(`Gemini Web error code: ${code}`)
      }

      for (const part of json) {
        const b = nested(part, [2])
        if (typeof b !== "string") continue
        try {
          const parsed = JSON.parse(b)
          const cands = nested(parsed, [4])
          if (!Array.isArray(cands) || !cands.length) continue
          const txt = nested(cands[0], [1, 0])
          if (typeof txt === "string" && txt.length > 0) return txt
        } catch { /* nop */ }
      }
      throw new Error("No text in Gemini Web response")
    },
    catch: (err) => new GeminiError({ reason: `Parse: ${toErrorMessage(err)}` }),
  })
})

import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Schema } from "effect"
import { type JimengFetch, type JimengFetchResponse } from "./client"
import { JimengError, jimengError } from "./errors"

export type JimengHttpTransportMode = "live" | "record" | "replay" | "fixture" | "cdp-fetch"

export interface JimengHttpCassetteRequest {
  method: string
  url: string
  bodySha256: string | null
}

export interface JimengHttpCassetteResponse {
  ok: boolean
  status: number
  bodyBase64: string
}

export interface JimengHttpCassetteEntry {
  id: string
  request: JimengHttpCassetteRequest
  response: JimengHttpCassetteResponse
}

export interface JimengHttpCassette {
  version: 1
  generatedAtIso: string
  updatedAtIso: string
  entries: JimengHttpCassetteEntry[]
}

export interface JimengHttpTransportInfo {
  mode: JimengHttpTransportMode
  cassettePath: string | null
}

export interface JimengHttpTransport {
  fetch: JimengFetch
  info: JimengHttpTransportInfo
}

export interface JimengHttpTransportOptions {
  mode?: JimengHttpTransportMode
  cassettePath?: string
  fetch?: JimengFetch
  nowIso?: () => string
}

const TransportModeValues = ["live", "record", "replay", "fixture", "cdp-fetch"] as const

const CassetteRequestSchema = Schema.Struct({
  method: Schema.String,
  url: Schema.String,
  bodySha256: Schema.optional(Schema.NullOr(Schema.String)),
})

const CassetteResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  status: Schema.Number,
  bodyBase64: Schema.String,
})

const CassetteEntrySchema = Schema.Struct({
  id: Schema.String,
  request: CassetteRequestSchema,
  response: CassetteResponseSchema,
})

const CassetteSchema = Schema.Struct({
  version: Schema.Number,
  generatedAtIso: Schema.String,
  updatedAtIso: Schema.String,
  entries: Schema.Array(CassetteEntrySchema),
})

type JimengHttpCassetteWire = Schema.Schema.Type<typeof CassetteSchema>

export function parseJimengHttpTransportMode(value: string | undefined): JimengHttpTransportMode {
  if (!value) return "live"
  if (TransportModeValues.includes(value as JimengHttpTransportMode)) return value as JimengHttpTransportMode
  throw jimengError({
    category: "validation",
    code: "JIMENG_HTTP_TRANSPORT_MODE_INVALID",
    message: `Jimeng HTTP transport mode must be one of: ${TransportModeValues.join(", ")}.`,
    retryable: false,
    details: { value },
  })
}

export function createJimengHttpTransport(options: JimengHttpTransportOptions = {}): JimengHttpTransport {
  const mode = options.mode ?? "live"
  const baseFetch: JimengFetch = options.fetch ?? fetch
  const cassettePath = options.cassettePath ? path.resolve(options.cassettePath) : null
  const nowIso = options.nowIso ?? (() => new Date().toISOString())

  if (mode === "live") {
    return {
      fetch: baseFetch,
      info: { mode, cassettePath: null },
    }
  }

  if (mode === "cdp-fetch") {
    if (!options.fetch) {
      throw jimengError({
        category: "validation",
        code: "JIMENG_BROWSER_FETCH_REQUIRED",
        message: "Jimeng HTTP transport mode \"cdp-fetch\" requires an injected browser fetch.",
        retryable: false,
        details: { mode },
      })
    }
    return {
      fetch: baseFetch,
      info: { mode, cassettePath: null },
    }
  }

  if (!cassettePath) {
    throw jimengError({
      category: "validation",
      code: "JIMENG_CASSETTE_PATH_REQUIRED",
      message: `Jimeng HTTP transport mode "${mode}" requires a cassette path.`,
      retryable: false,
      details: { mode },
    })
  }

  if (mode === "record") {
    let cassette = existsSync(cassettePath)
      ? readJimengHttpCassette(cassettePath)
      : createEmptyCassette(nowIso())

    return {
      info: { mode, cassettePath },
      fetch: async (url, init) => {
        const request = await buildCassetteRequest(url, init)
        const response = await baseFetch(url, init)
        const bytes = new Uint8Array(await response.arrayBuffer())
        cassette = {
          ...cassette,
          updatedAtIso: nowIso(),
          entries: [
            ...cassette.entries,
            {
              id: cassetteEntryId(request, cassette.entries.length),
              request,
              response: {
                ok: response.ok,
                status: response.status,
                bodyBase64: Buffer.from(bytes).toString("base64"),
              },
            },
          ],
        }
        writeJimengHttpCassette(cassettePath, cassette)
        return responseFromBytes(response.status, response.ok, bytes)
      },
    }
  }

  const cassette = readJimengHttpCassette(cassettePath)
  const cursors = new Map<string, number>()

  return {
    info: { mode, cassettePath },
    fetch: async (url, init) => {
      const request = await buildCassetteRequest(url, init)
      const key = cassetteRequestKey(request)
      const startIndex = mode === "fixture" ? 0 : cursors.get(key) ?? 0
      const match = findCassetteEntry(cassette.entries, request, startIndex)
      if (!match) {
        throw jimengError({
          category: "transport",
          code: "JIMENG_CASSETTE_MISS",
          message: `No Jimeng cassette entry matched ${request.method} ${request.url}.`,
          retryable: false,
          details: {
            mode,
            cassettePath,
            method: request.method,
            url: request.url,
            bodySha256: request.bodySha256,
          },
        })
      }
      if (mode === "replay") cursors.set(key, match.index + 1)
      return responseFromBytes(
        match.entry.response.status,
        match.entry.response.ok,
        Buffer.from(match.entry.response.bodyBase64, "base64"),
      )
    },
  }
}

export function readJimengHttpCassette(file: string): JimengHttpCassette {
  const text = readFileSync(file, "utf8")
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw cassetteInvalidError(file, error instanceof Error ? error.message : String(error))
  }

  let decoded: JimengHttpCassetteWire
  try {
    decoded = Schema.decodeUnknownSync(CassetteSchema)(parsed)
  } catch (error) {
    throw cassetteInvalidError(file, error instanceof Error ? error.message : String(error))
  }

  if (decoded.version !== 1) {
    throw cassetteInvalidError(file, `Unsupported cassette version: ${decoded.version}`)
  }

  return {
    version: 1,
    generatedAtIso: decoded.generatedAtIso,
    updatedAtIso: decoded.updatedAtIso,
    entries: decoded.entries.map((entry) => ({
      id: entry.id,
      request: {
        method: entry.request.method,
        url: entry.request.url,
        bodySha256: entry.request.bodySha256 ?? null,
      },
      response: entry.response,
    })),
  }
}

export function writeJimengHttpCassette(file: string, cassette: JimengHttpCassette): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(cassette, null, 2)}\n`)
}

function createEmptyCassette(nowIso: string): JimengHttpCassette {
  return {
    version: 1,
    generatedAtIso: nowIso,
    updatedAtIso: nowIso,
    entries: [],
  }
}

async function buildCassetteRequest(url: string, init?: RequestInit): Promise<JimengHttpCassetteRequest> {
  return {
    method: String(init?.method ?? "GET").toUpperCase(),
    url,
    bodySha256: await requestBodySha256(init?.body),
  }
}

async function requestBodySha256(body: BodyInit | null | undefined): Promise<string | null> {
  if (body === undefined || body === null) return null
  if (typeof body === "string") return sha256Bytes(new TextEncoder().encode(body))
  if (body instanceof URLSearchParams) return sha256Bytes(new TextEncoder().encode(body.toString()))
  if (body instanceof ArrayBuffer) return sha256Bytes(new Uint8Array(body))
  if (ArrayBuffer.isView(body)) return sha256Bytes(new Uint8Array(body.buffer, body.byteOffset, body.byteLength))
  if (body instanceof Blob) return sha256Bytes(new Uint8Array(await body.arrayBuffer()))
  throw jimengError({
    category: "validation",
    code: "JIMENG_CASSETTE_BODY_UNSUPPORTED",
    message: "Jimeng cassette transport only supports string, URLSearchParams, ArrayBuffer, typed-array, Blob, or empty request bodies.",
    retryable: false,
    details: { bodyKind: Object.prototype.toString.call(body) },
  })
}

function responseFromBytes(status: number, ok: boolean, bytes: Uint8Array): JimengFetchResponse {
  const stable = new Uint8Array(bytes)
  return {
    ok,
    status,
    text: async () => new TextDecoder().decode(stable),
    arrayBuffer: async () => stable.buffer.slice(stable.byteOffset, stable.byteOffset + stable.byteLength),
  }
}

function findCassetteEntry(
  entries: JimengHttpCassetteEntry[],
  request: JimengHttpCassetteRequest,
  startIndex: number,
): { entry: JimengHttpCassetteEntry; index: number } | null {
  for (let index = startIndex; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry && sameCassetteRequest(entry.request, request)) return { entry, index }
  }
  return null
}

function sameCassetteRequest(left: JimengHttpCassetteRequest, right: JimengHttpCassetteRequest): boolean {
  return left.method === right.method && left.url === right.url && (left.bodySha256 ?? null) === (right.bodySha256 ?? null)
}

function cassetteEntryId(request: JimengHttpCassetteRequest, index: number): string {
  return sha256String(`${index}\n${request.method}\n${request.url}\n${request.bodySha256 ?? ""}`).slice(0, 16)
}

function cassetteRequestKey(request: JimengHttpCassetteRequest): string {
  return `${request.method}\n${request.url}\n${request.bodySha256 ?? ""}`
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex")
}

function sha256String(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function cassetteInvalidError(file: string, error: string): JimengError {
  return jimengError({
    category: "upstream",
    code: "JIMENG_CASSETTE_INVALID",
    message: `Jimeng HTTP cassette is invalid: ${file}`,
    retryable: false,
    details: {
      file,
      error,
    },
  })
}

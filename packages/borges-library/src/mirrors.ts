import { Effect, Result } from "effect"
import type { HttpClient } from "effect/unstable/http"
import { HttpClient as HttpClientService } from "effect/unstable/http"
import { FetchError, ParseError } from "./errors"

export const DEFAULT_OPEN_SLUM_URL = "https://open-slum.org/"

export type MirrorGroup = "anna" | "libgen"

export interface MirrorCandidate {
  group: MirrorGroup
  name: string
  url: string
  validCert?: boolean
  certExpiryDaysRemaining?: number
  source: "open-slum"
}

export interface OpenSlumDiscoveryOptions {
  statusPageUrl?: string
  groups?: readonly MirrorGroup[]
}

interface OpenSlumMonitor {
  name?: unknown
  url?: unknown
  validCert?: unknown
  certExpiryDaysRemaining?: unknown
}

interface OpenSlumGroup {
  name?: unknown
  monitorList?: unknown
}

export interface OpenSlumPreloadData {
  publicGroupList?: OpenSlumGroup[]
}

const CHALLENGE_OR_ERROR_MARKERS = [
  "captcha",
  "recaptcha",
  "hcaptcha",
  "cf-browser-verify",
  "checking your browser",
  "just a moment",
  "cloudflare ray id",
  "cloudflare challenge",
  "ddos-guard",
  "access denied",
  "error 1020",
  "temporarily unavailable",
  "service unavailable",
]

const BLOCKED_STATUSES = new Set([401, 403, 451])

export function isChallengeOrErrorHtml(html: string, status?: number): boolean {
  const sample = html.slice(0, 8192).toLowerCase()
  if (BLOCKED_STATUSES.has(status ?? 0) && /<html|<!doctype html|captcha|challenge|access denied|forbidden/i.test(html)) {
    return true
  }
  return CHALLENGE_OR_ERROR_MARKERS.some((marker) => sample.includes(marker))
}

function extractPreloadLiteral(html: string): string {
  const assignment = html.match(/window\.preloadData\s*=\s*/)
  if (!assignment?.index && assignment?.index !== 0) {
    throw new Error("OpenSLUM preload data assignment not found")
  }

  let index = assignment.index + assignment[0].length
  while (index < html.length && /\s/.test(html[index]!)) index++
  if (html[index] !== "{") throw new Error("OpenSLUM preload data object not found")

  const start = index
  let depth = 0
  let quote: "'" | '"' | undefined
  let escaped = false
  for (; index < html.length; index++) {
    const char = html[index]!
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        quote = undefined
      }
      continue
    }

    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === "{") depth++
    if (char === "}") {
      depth--
      if (depth === 0) return html.slice(start, index + 1)
    }
  }

  throw new Error("OpenSLUM preload data object is unterminated")
}

function readHex(input: string, offset: number, length: number): string | undefined {
  const value = input.slice(offset, offset + length)
  return /^[0-9a-f]+$/i.test(value) && value.length === length ? value : undefined
}

function parseJsString(input: string, start: number): { value: string; end: number } {
  const quote = input[start]
  if (quote !== "'" && quote !== '"') throw new Error("Expected JavaScript string")

  let value = ""
  for (let index = start + 1; index < input.length; index++) {
    const char = input[index]!
    if (char === quote) return { value, end: index + 1 }
    if (char !== "\\") {
      value += char
      continue
    }

    const escaped = input[++index]
    if (escaped === undefined) throw new Error("Unterminated JavaScript escape sequence")
    switch (escaped) {
      case "b":
        value += "\b"
        break
      case "f":
        value += "\f"
        break
      case "n":
        value += "\n"
        break
      case "r":
        value += "\r"
        break
      case "t":
        value += "\t"
        break
      case "v":
        value += "\v"
        break
      case "0":
        value += "\0"
        break
      case "x": {
        const hex = readHex(input, index + 1, 2)
        if (!hex) throw new Error("Invalid JavaScript hex escape")
        value += String.fromCharCode(Number.parseInt(hex, 16))
        index += 2
        break
      }
      case "u": {
        if (input[index + 1] === "{") {
          const close = input.indexOf("}", index + 2)
          if (close === -1) throw new Error("Invalid JavaScript unicode escape")
          const hex = input.slice(index + 2, close)
          if (!/^[0-9a-f]+$/i.test(hex)) throw new Error("Invalid JavaScript unicode escape")
          value += String.fromCodePoint(Number.parseInt(hex, 16))
          index = close
          break
        }
        const hex = readHex(input, index + 1, 4)
        if (!hex) throw new Error("Invalid JavaScript unicode escape")
        value += String.fromCharCode(Number.parseInt(hex, 16))
        index += 4
        break
      }
      case "\n":
        break
      case "\r":
        if (input[index + 1] === "\n") index++
        break
      default:
        value += escaped
        break
    }
  }

  throw new Error("Unterminated JavaScript string")
}

function previousSignificantChar(input: string, offset: number): string | undefined {
  for (let index = offset - 1; index >= 0; index--) {
    const char = input[index]!
    if (!/\s/.test(char)) return char
  }
  return undefined
}

function readIdentifier(input: string, start: number): { value: string; end: number } | undefined {
  if (!/[A-Za-z_$]/.test(input[start]!)) return undefined
  let end = start + 1
  while (end < input.length && /[A-Za-z0-9_$]/.test(input[end]!)) end++
  return { value: input.slice(start, end), end }
}

function isObjectKey(input: string, start: number, end: number): boolean {
  const previous = previousSignificantChar(input, start)
  if (previous !== "{" && previous !== ",") return false
  let lookahead = end
  while (lookahead < input.length && /\s/.test(input[lookahead]!)) lookahead++
  return input[lookahead] === ":"
}

function jsObjectLiteralToJson(input: string): string {
  let output = ""
  for (let index = 0; index < input.length; ) {
    const char = input[index]!
    if (char === "'" || char === '"') {
      const parsed = parseJsString(input, index)
      output += JSON.stringify(parsed.value)
      index = parsed.end
      continue
    }

    const identifier = readIdentifier(input, index)
    if (identifier && isObjectKey(input, index, identifier.end)) {
      output += JSON.stringify(identifier.value)
      index = identifier.end
      continue
    }

    if (char === ",") {
      let lookahead = index + 1
      while (lookahead < input.length && /\s/.test(input[lookahead]!)) lookahead++
      if (input[lookahead] === "}" || input[lookahead] === "]") {
        index++
        continue
      }
    }

    output += char
    index++
  }
  return output
}

export function parseOpenSlumPreloadData(html: string): OpenSlumPreloadData {
  const literal = extractPreloadLiteral(html)
  const parsed = JSON.parse(jsObjectLiteralToJson(literal)) as unknown
  if (!parsed || typeof parsed !== "object") throw new Error("OpenSLUM preload data is not an object")
  return parsed as OpenSlumPreloadData
}

function groupForName(name: string): MirrorGroup | undefined {
  const normalized = name.toLowerCase()
  if (normalized.includes("anna")) return "anna"
  if (normalized.includes("library genesis") || normalized.includes("libgen") || normalized === "lg+") return "libgen"
  return undefined
}

function normalizeMirrorUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
    const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")
    return `${url.protocol}//${url.host}${pathname}`
  } catch {
    return undefined
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

export function rankMirrorCandidates(candidates: readonly MirrorCandidate[]): MirrorCandidate[] {
  return [...candidates].sort((a, b) => {
    const aHttps = a.url.startsWith("https://") ? 1 : 0
    const bHttps = b.url.startsWith("https://") ? 1 : 0
    if (aHttps !== bHttps) return bHttps - aHttps

    const aCert = a.validCert === true ? 1 : a.validCert === false ? -1 : 0
    const bCert = b.validCert === true ? 1 : b.validCert === false ? -1 : 0
    if (aCert !== bCert) return bCert - aCert

    const aDays = a.certExpiryDaysRemaining ?? -1
    const bDays = b.certExpiryDaysRemaining ?? -1
    if (aDays !== bDays) return bDays - aDays

    return a.name.localeCompare(b.name)
  })
}

export function extractOpenSlumMirrors(
  preloadData: OpenSlumPreloadData,
  groups: readonly MirrorGroup[] = ["anna", "libgen"],
): MirrorCandidate[] {
  const allowedGroups = new Set(groups)
  const byUrl = new Map<string, MirrorCandidate>()

  for (const publicGroup of preloadData.publicGroupList ?? []) {
    const groupName = asString(publicGroup.name)
    if (!groupName) continue
    const group = groupForName(groupName)
    if (!group || !allowedGroups.has(group)) continue
    if (!Array.isArray(publicGroup.monitorList)) continue

    for (const monitor of publicGroup.monitorList as OpenSlumMonitor[]) {
      const url = asString(monitor.url)
      const normalizedUrl = url ? normalizeMirrorUrl(url) : undefined
      if (!normalizedUrl) continue

      const candidate: MirrorCandidate = {
        group,
        name: asString(monitor.name) ?? normalizedUrl,
        url: normalizedUrl,
        validCert: asBoolean(monitor.validCert),
        certExpiryDaysRemaining: asNumber(monitor.certExpiryDaysRemaining),
        source: "open-slum",
      }
      const existing = byUrl.get(normalizedUrl)
      if (!existing || rankMirrorCandidates([existing, candidate])[0] === candidate) {
        byUrl.set(normalizedUrl, candidate)
      }
    }
  }

  return rankMirrorCandidates([...byUrl.values()])
}

export function discoverOpenSlumMirrors(
  options: OpenSlumDiscoveryOptions = {},
): Effect.Effect<MirrorCandidate[], FetchError | ParseError, HttpClient.HttpClient> {
  const statusPageUrl = options.statusPageUrl ?? DEFAULT_OPEN_SLUM_URL
  return Effect.gen(function* () {
    const responseResult = yield* Effect.result(
      HttpClientService.get(statusPageUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BorgesLibrary/1.0)" },
      }).pipe(Effect.timeout("15 seconds")),
    )
    if (!Result.isSuccess(responseResult)) {
      return yield* new FetchError({ message: `OpenSLUM mirror discovery failed: ${String(responseResult.failure)}` })
    }

    const response = responseResult.success
    if (response.status < 200 || response.status >= 300) {
      return yield* new FetchError({ message: `OpenSLUM mirror discovery failed with status: ${response.status}` })
    }

    const textResult = yield* Effect.result(response.text)
    if (!Result.isSuccess(textResult)) {
      return yield* new FetchError({ message: `Failed to read OpenSLUM response body: ${String(textResult.failure)}` })
    }

    try {
      return extractOpenSlumMirrors(parseOpenSlumPreloadData(textResult.success), options.groups)
    } catch (cause) {
      return yield* new ParseError({ message: `Failed to parse OpenSLUM preload data: ${String(cause)}` })
    }
  })
}

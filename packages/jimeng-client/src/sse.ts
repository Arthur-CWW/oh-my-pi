export interface ParsedSseEvent {
  id: string | null
  event: string | null
  data: string
  retry: number | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseSseText(text: string): ParsedSseEvent[] {
  if (!text) return []

  const events: ParsedSseEvent[] = []
  let current = createSseAccumulator()

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine === "") {
      const built = buildEvent(current)
      if (built) events.push(built)
      current = createSseAccumulator()
      continue
    }

    if (rawLine.startsWith(":")) continue

    const { field, value } = parseFieldLine(rawLine)
    switch (field) {
      case "event":
        current.event = value
        break
      case "data":
        current.data.push(value)
        break
      case "id":
        current.id = value
        break
      case "retry":
        if (/^\d+$/.test(value)) current.retry = Number(value)
        break
      default:
        break
    }
  }

  const trailing = buildEvent(current)
  if (trailing) events.push(trailing)
  return events
}

export function extractSubmitIdFromSseText(text: string): string | null {
  if (!text) return null

  for (const event of parseSseText(text)) {
    const fromEventData = extractSubmitIdFromPayload(event.data)
    if (fromEventData) return fromEventData
  }

  return extractSubmitIdFromPayload(text)
}

export function extractImageSubmitInfoFromSseText(text: string): { code: number; msg: string | null } | null {
  if (!text) return null

  for (const event of parseSseText(text)) {
    const fromEventData = extractSubmitInfoFromPayload(event.data)
    if (fromEventData) return fromEventData
  }

  return extractSubmitInfoFromPayload(text)
}

function createSseAccumulator(): { id: string | null; event: string | null; data: string[]; retry: number | null } {
  return { id: null, event: null, data: [], retry: null }
}

function buildEvent(acc: { id: string | null; event: string | null; data: string[]; retry: number | null }): ParsedSseEvent | null {
  if (acc.data.length === 0) return null
  return { id: acc.id, event: acc.event, data: acc.data.join("\n"), retry: acc.retry }
}

function parseFieldLine(rawLine: string): { field: string; value: string } {
  const colon = rawLine.indexOf(":")
  if (colon < 0) return { field: rawLine, value: "" }

  const field = rawLine.slice(0, colon)
  const rawValue = rawLine.slice(colon + 1)
  return { field, value: rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue }
}

function extractSubmitIdFromPayload(payload: string): string | null {
  const parsed = safeJson(payload)
  const fromParsed = findSubmitId(parsed)
  if (fromParsed) return fromParsed

  for (const fragment of extractJsonObjectFragments(payload)) {
    const fromFragment = findSubmitId(safeJson(fragment))
    if (fromFragment) return fromFragment
  }

  return findSubmitIdInText(payload)
}

function extractSubmitInfoFromPayload(payload: string): { code: number; msg: string | null } | null {
  const parsed = safeJson(payload)
  const fromParsed = findSubmitInfo(parsed)
  if (fromParsed) return fromParsed

  for (const fragment of extractJsonObjectFragments(payload)) {
    const fromFragment = findSubmitInfo(safeJson(fragment))
    if (fromFragment) return fromFragment
  }

  return findSubmitInfoInText(payload)
}

function findSubmitId(value: unknown): string | null {
  if (!value) return null

  if (typeof value === "string") {
    const parsed = safeJson(value)
    if (parsed !== value) {
      const nested = findSubmitId(parsed)
      if (nested) return nested
    }

    for (const fragment of extractJsonObjectFragments(value)) {
      const nested = findSubmitId(safeJson(fragment))
      if (nested) return nested
    }

    return findSubmitIdInText(value)
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findSubmitId(item)
      if (nested) return nested
    }
    return null
  }

  if (!isRecord(value)) return null

  const direct = asUuid(value.submit_id ?? value.submitId)
  if (direct) return direct

  for (const nested of Object.values(value)) {
    const resolved = findSubmitId(nested)
    if (resolved) return resolved
  }

  return null
}

function findSubmitInfo(value: unknown): { code: number; msg: string | null } | null {
  if (!value) return null

  if (typeof value === "string") {
    const parsed = safeJson(value)
    if (parsed !== value) {
      const nested = findSubmitInfo(parsed)
      if (nested) return nested
    }

    for (const fragment of extractJsonObjectFragments(value)) {
      const nested = findSubmitInfo(safeJson(fragment))
      if (nested) return nested
    }

    return findSubmitInfoInText(value)
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findSubmitInfo(item)
      if (nested) return nested
    }
    return null
  }

  if (!isRecord(value)) return null

  const direct = normalizeSubmitInfo(value.submit_info ?? value.submitInfo)
  if (direct) return direct

  for (const nested of Object.values(value)) {
    const resolved = findSubmitInfo(nested)
    if (resolved) return resolved
  }

  return null
}

function normalizeSubmitInfo(value: unknown): { code: number; msg: string | null } | null {
  if (!isRecord(value)) return null

  const codeRaw = value.code
  const code = typeof codeRaw === "number" ? codeRaw : typeof codeRaw === "string" && /^\d+$/.test(codeRaw) ? Number(codeRaw) : null
  if (code === null) return null

  const msgRaw = value.msg ?? value.message
  return { code, msg: typeof msgRaw === "string" ? msgRaw : null }
}

function findSubmitIdInText(value: string): string | null {
  const normalized = value.replaceAll('\\"', '"')
  const keyed = normalized.match(/"submit_id"\s*:\s*"([^"]+)"/i) ?? normalized.match(/"submitId"\s*:\s*"([^"]+)"/i)
  return asUuid(keyed?.[1])
}

function findSubmitInfoInText(value: string): { code: number; msg: string | null } | null {
  const normalized = value.replaceAll('\\"', '"')
  const match = normalized.match(
    /"submit_info"\s*:\s*\{[^{}]*"code"\s*:\s*(\d+)(?:[^{}]*"(?:msg|message)"\s*:\s*"([^"]*)")?[^{}]*\}/i,
  )

  if (!match?.[1]) return null
  return { code: Number(match[1]), msg: match[2] ?? null }
}

function asUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function extractJsonObjectFragments(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === "\\") {
        escaped = true
        continue
      }
      if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === "{") {
      if (depth === 0) start = i
      depth += 1
      continue
    }

    if (char === "}") {
      if (depth > 0) {
        depth -= 1
        if (depth === 0 && start >= 0) {
          out.push(value.slice(start, i + 1))
          start = -1
        }
      }
    }
  }

  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

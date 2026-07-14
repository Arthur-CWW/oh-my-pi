export type ExpandedPaste = { marker: string; content: string; start: number; end: number }
export type PasteMarker = { id: number; marker: string; start: number; end: number }

export const PASTE_MARKER_PATTERN = /\[Paste #\d+(?:, (?:\+\d+ lines|\d+ chars))?\]|\[paste #\d+(?: (?:\+\d+ lines|\d+ chars))?\]/g

export function pasteId(marker: string): number {
  return Number.parseInt(marker.match(/\d+/)?.[0] ?? "0", 10)
}

export function pasteMarkerAt(line: string, col: number): { start: number; end: number } | undefined {
  for (const match of line.matchAll(PASTE_MARKER_PATTERN)) {
    const start = match.index
    const end = start + match[0].length
    if (col >= start && col < end) return { start, end }
  }
  return undefined
}

export function pasteMarkerAtCursor(line: string, cursorCol: number, lineStart: number): PasteMarker | undefined {
  for (const match of line.matchAll(PASTE_MARKER_PATTERN)) {
    const start = match.index
    const end = start + match[0].length
    if (cursorCol < start) return undefined
    if (cursorCol <= end) {
      const idText = match[0].match(/\d+/)?.[0]
      if (idText === undefined) return undefined
      return { id: Number.parseInt(idText, 10), marker: match[0], start: lineStart + start, end: lineStart + end }
    }
  }
  return undefined
}

export function expandedPasteAt(pastes: ExpandedPaste[], cursorOffset: number): ExpandedPaste | undefined {
  return [...pastes].reverse().find((paste) => cursorOffset >= paste.start && cursorOffset <= paste.end)
}

export function extractExpandedContent(before: string, after: string, start: number, markerEnd: number): string | undefined {
  const prefix = before.slice(0, start)
  const suffix = before.slice(markerEnd)
  if (!after.startsWith(prefix) || !after.endsWith(suffix)) return undefined
  const contentEnd = after.length - suffix.length
  if (contentEnd < prefix.length) return undefined
  return after.slice(prefix.length, contentEnd)
}

export function inferPasteContents(text: string, editorText: string, expandedText: string): Map<number, string> | undefined {
  if (text !== editorText && !editorText.startsWith(text)) return undefined
  if (expandedText === editorText) return undefined

  const matches = [...editorText.matchAll(PASTE_MARKER_PATTERN)]
  if (matches.length === 0) return undefined

  const inferred = new Map<number, string>()
  let originalCursor = 0
  let expandedCursor = 0

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]!
    const markerStart = match.index
    const marker = match[0]
    const literalBefore = editorText.slice(originalCursor, markerStart)
    if (literalBefore) {
      if (!expandedText.startsWith(literalBefore, expandedCursor)) return inferred.size > 0 ? inferred : undefined
      expandedCursor += literalBefore.length
    }

    const markerEnd = markerStart + marker.length
    const nextMarkerStart = matches[index + 1]?.index ?? editorText.length
    const literalAfter = editorText.slice(markerEnd, nextMarkerStart)
    const contentEnd = literalAfter
      ? expandedText.indexOf(literalAfter, expandedCursor)
      : index === matches.length - 1
        ? expandedText.length
        : expandedCursor
    if (contentEnd < expandedCursor) return inferred.size > 0 ? inferred : undefined

    inferred.set(markerStart, expandedText.slice(expandedCursor, contentEnd))
    expandedCursor = contentEnd
    originalCursor = markerEnd
  }

  return inferred
}

export function expandPasteMarkerText(
  text: string,
  inferredPastes: Map<number, string> | undefined,
  getPasteContent: (id: number) => string | undefined,
  updatePasteContent: (id: number, content: string) => void,
): { text: string; changed: boolean; expansions: ExpandedPaste[] } {
  const expansions: ExpandedPaste[] = []
  let offsetDelta = 0
  const expanded = text.replace(PASTE_MARKER_PATTERN, (marker: string, matchOffset: number) => {
    const idText = marker.match(/\d+/)?.[0]
    const pasteId = idText === undefined ? 0 : Number.parseInt(idText, 10)
    const content = idText === undefined ? undefined : getPasteContent(pasteId) ?? inferredPastes?.get(matchOffset)
    if (content === undefined) return marker
    const adjustedStart = matchOffset + offsetDelta
    const end = adjustedStart + content.length
    if (idText !== undefined) updatePasteContent(pasteId, content)
    expansions.push({ marker, content, start: adjustedStart, end })
    offsetDelta += content.length - marker.length
    return content
  })
  return { text: expanded, changed: expansions.length > 0, expansions }
}

export function collapseExpandedPasteText(
  pastes: ExpandedPaste[],
  text: string,
  updatePasteContent: (id: number, content: string) => void,
): { text: string; changed: boolean } {
  let next = text
  let changed = false
  for (const paste of [...pastes].sort((a, b) => b.start - a.start)) {
    const start = Math.max(0, Math.min(paste.start, next.length))
    const end = Math.max(start, Math.min(paste.end, next.length))
    const content = next.slice(start, end)
    updatePasteContent(pasteId(paste.marker), content)
    next = `${next.slice(0, start)}${paste.marker}${next.slice(end)}`
    changed = true
  }
  return { text: next, changed }
}

export function rebaseExpandedPastes(pastes: ExpandedPaste[], before: string, after: string): void {
  if (before === after || pastes.length === 0) return

  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let beforeEnd = before.length
  let afterEnd = after.length
  while (beforeEnd > prefix && afterEnd > prefix && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd--
    afterEnd--
  }

  const insertion = prefix === beforeEnd
  const delta = after.length - before.length
  for (const paste of pastes) {
    const beforeChangeEndsBefore = beforeEnd < paste.start || (beforeEnd === paste.start && !insertion)
    const afterChangeStartsAfter = prefix > paste.end || (prefix === paste.end && !insertion)
    if (beforeChangeEndsBefore) {
      paste.start += delta
      paste.end += delta
    } else if (!afterChangeStartsAfter) {
      if (prefix < paste.start) paste.start = prefix
      paste.end = Math.max(paste.start, paste.end + delta)
    }
    paste.content = after.slice(Math.max(0, Math.min(paste.start, after.length)), Math.max(paste.start, Math.min(paste.end, after.length)))
  }
}

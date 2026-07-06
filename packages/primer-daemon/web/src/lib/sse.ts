export interface SseEvent {
  /** The `event:` field, defaulting to "message" when the frame omits one. */
  event: string
  /** Joined `data:` field(s); multi-line data is rejoined with newlines. */
  data: string
}

/**
 * Incremental Server-Sent-Events frame parser. Feed it decoded text chunks in
 * arrival order and it invokes `onEvent` once per complete frame. Copes with
 * CRLF line endings, multi-line `data:` fields, comment lines, and frames that
 * straddle chunk boundaries by retaining the partial trailing line.
 */
export function createSseParser(onEvent: (event: SseEvent) => void): (chunk: string) => void {
  let buffer = ""
  let eventType = ""
  let dataLines: string[] = []

  const dispatch = (): void => {
    // Per spec: an empty data buffer dispatches nothing; still reset the type.
    if (dataLines.length === 0) {
      eventType = ""
      return
    }
    onEvent({ event: eventType || "message", data: dataLines.join("\n") })
    eventType = ""
    dataLines = []
  }

  const handleLine = (line: string): void => {
    if (line === "") {
      dispatch()
      return
    }
    if (line.startsWith(":")) return // comment / heartbeat
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? "" : line.slice(colon + 1)
    if (value.startsWith(" ")) value = value.slice(1)
    if (field === "event") eventType = value
    else if (field === "data") dataLines.push(value)
    // `id` / `retry` fields are irrelevant to this contract and ignored.
  }

  return (chunk: string): void => {
    buffer += chunk
    let newlineIdx = buffer.indexOf("\n")
    while (newlineIdx !== -1) {
      let line = buffer.slice(0, newlineIdx)
      buffer = buffer.slice(newlineIdx + 1)
      if (line.endsWith("\r")) line = line.slice(0, -1)
      handleLine(line)
      newlineIdx = buffer.indexOf("\n")
    }
  }
}

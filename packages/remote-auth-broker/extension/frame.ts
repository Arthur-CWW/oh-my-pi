import { MAX_FRAME_BYTES } from "./protocol.ts"

const FRAME_HEADER_BYTES = 4
const UTF8_ENCODER = new TextEncoder()
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true })

export type FrameErrorKind = "truncated" | "oversize" | "trailing" | "invalid-utf8" | "invalid-json"

export class FrameError extends Error {
  readonly kind: FrameErrorKind

  constructor(kind: FrameErrorKind, message: string) {
    super(message)
    this.name = "FrameError"
    this.kind = kind
  }
}

function frameLength(header: Uint8Array): number {
  return new DataView(header.buffer, header.byteOffset, FRAME_HEADER_BYTES).getUint32(0, false)
}
function assertJsonValue(value: unknown, ancestors: Set<object> = new Set(), depth = 0): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return
  if (typeof value === "number") {
    if (Number.isFinite(value)) return
    throw new FrameError("invalid-json", "Value contains a non-finite number")
  }
  if (typeof value !== "object") {
    throw new FrameError("invalid-json", "Value contains a non-JSON type")
  }
  if (depth >= 128) throw new FrameError("invalid-json", "Value exceeds the JSON nesting bound")
  if (ancestors.has(value)) throw new FrameError("invalid-json", "Value contains a cycle")

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value)
      if (ownKeys.length !== value.length + 1) {
        throw new FrameError("invalid-json", "JSON arrays must not contain holes or custom properties")
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new FrameError("invalid-json", "JSON arrays must not contain holes or custom properties")
        }
        const element: unknown = Reflect.get(value, index)
        assertJsonValue(element, ancestors, depth + 1)
      }
      return
    }

    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new FrameError("invalid-json", "Value contains a non-JSON object")
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new FrameError("invalid-json", "JSON objects must use string keys")
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw new FrameError("invalid-json", "JSON objects must contain enumerable data properties")
      }
      const propertyValue: unknown = descriptor.value
      assertJsonValue(propertyValue, ancestors, depth + 1)
    }
  } finally {
    ancestors.delete(value)
  }
}


export function encodeFrame(payload: Uint8Array): Uint8Array {
  if (payload.byteLength > MAX_FRAME_BYTES) {
    throw new FrameError("oversize", `Frame payload exceeds ${MAX_FRAME_BYTES} bytes`)
  }
  const frame = new Uint8Array(FRAME_HEADER_BYTES + payload.byteLength)
  new DataView(frame.buffer).setUint32(0, payload.byteLength, false)
  frame.set(payload, FRAME_HEADER_BYTES)
  return frame
}

export function encodeJsonFrame(value: unknown): Uint8Array {
  assertJsonValue(value)
  let json: string | undefined
  try {
    json = JSON.stringify(value)
  } catch {
    throw new FrameError("invalid-json", "Value is not JSON serializable")
  }
  if (json === undefined) throw new FrameError("invalid-json", "Value has no JSON representation")
  return encodeFrame(UTF8_ENCODER.encode(json))
}

export function decodeFramePayload(frame: Uint8Array): Uint8Array {
  if (frame.byteLength < FRAME_HEADER_BYTES) {
    throw new FrameError("truncated", "Frame header is truncated")
  }
  const length = frameLength(frame.subarray(0, FRAME_HEADER_BYTES))
  if (length > MAX_FRAME_BYTES) {
    throw new FrameError("oversize", `Frame payload exceeds ${MAX_FRAME_BYTES} bytes`)
  }
  const expectedLength = FRAME_HEADER_BYTES + length
  if (frame.byteLength < expectedLength) {
    throw new FrameError("truncated", "Frame payload is truncated")
  }
  if (frame.byteLength > expectedLength) {
    throw new FrameError("trailing", "Bytes follow the complete frame")
  }
  return frame.subarray(FRAME_HEADER_BYTES)
}

export function decodeJsonPayload(payload: Uint8Array): unknown {
  if (payload.byteLength > MAX_FRAME_BYTES) {
    throw new FrameError("oversize", `Frame payload exceeds ${MAX_FRAME_BYTES} bytes`)
  }
  let text: string
  try {
    text = UTF8_DECODER.decode(payload)
  } catch {
    throw new FrameError("invalid-utf8", "Frame payload is not valid UTF-8")
  }
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    throw new FrameError("invalid-json", "Frame payload is not valid JSON")
  }
}

export function decodeJsonFrame(frame: Uint8Array): unknown {
  return decodeJsonPayload(decodeFramePayload(frame))
}

export class IncrementalFrameDecoder {
  readonly #header = new Uint8Array(FRAME_HEADER_BYTES)
  #headerBytes = 0
  #payload: Uint8Array | undefined
  #payloadBytes = 0
  #failed = false

  push(chunk: Uint8Array): readonly Uint8Array[] {
    if (this.#failed) throw new FrameError("truncated", "Frame decoder is no longer usable")
    const completed: Uint8Array[] = []
    let offset = 0
    try {
      while (offset < chunk.byteLength) {
        if (this.#payload === undefined) {
          const headerRemaining = FRAME_HEADER_BYTES - this.#headerBytes
          const copied = Math.min(headerRemaining, chunk.byteLength - offset)
          this.#header.set(chunk.subarray(offset, offset + copied), this.#headerBytes)
          this.#headerBytes += copied
          offset += copied
          if (this.#headerBytes < FRAME_HEADER_BYTES) continue

          const length = frameLength(this.#header)
          if (length > MAX_FRAME_BYTES) {
            throw new FrameError("oversize", `Frame payload exceeds ${MAX_FRAME_BYTES} bytes`)
          }
          this.#payload = new Uint8Array(length)
          this.#payloadBytes = 0
          if (length === 0) {
            completed.push(this.#payload)
            this.#payload = undefined
            this.#headerBytes = 0
          }
          continue
        }

        const payloadRemaining = this.#payload.byteLength - this.#payloadBytes
        const copied = Math.min(payloadRemaining, chunk.byteLength - offset)
        this.#payload.set(chunk.subarray(offset, offset + copied), this.#payloadBytes)
        this.#payloadBytes += copied
        offset += copied
        if (this.#payloadBytes === this.#payload.byteLength) {
          completed.push(this.#payload)
          this.#payload = undefined
          this.#payloadBytes = 0
          this.#headerBytes = 0
        }
      }
      return completed
    } catch (error) {
      this.#failed = true
      throw error
    }
  }

  finish(): void {
    if (this.#failed) throw new FrameError("truncated", "Frame decoder is no longer usable")
    if (this.#headerBytes !== 0 || this.#payload !== undefined) {
      this.#failed = true
      throw new FrameError("truncated", "Input ended in the middle of a frame")
    }
  }
}

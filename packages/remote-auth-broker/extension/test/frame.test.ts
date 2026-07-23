import { describe, expect, test } from "bun:test"
import {
  FrameError,
  IncrementalFrameDecoder,
  decodeFramePayload,
  decodeJsonFrame,
  decodeJsonPayload,
  encodeFrame,
  encodeJsonFrame,
  type FrameErrorKind,
} from "../frame.ts"
import { MAX_FRAME_BYTES } from "../protocol.ts"

const UTF8_ENCODER = new TextEncoder()

function expectFrameError(action: () => unknown, kind: FrameErrorKind): void {
  try {
    action()
    throw new Error("Expected frame operation to fail")
  } catch (error) {
    expect(error).toBeInstanceOf(FrameError)
    if (!(error instanceof FrameError)) return
    expect(error.kind).toBe(kind)
    expect(error.message.length).toBeLessThanOrEqual(96)
  }
}

function concatenate(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

describe("four-byte big-endian JSON framing", () => {
  test("encodes and decodes one exact frame", () => {
    const value = { protocolVersion: 1, action: "status" }
    const frame = encodeJsonFrame(value)
    const expectedLength = UTF8_ENCODER.encode(JSON.stringify(value)).byteLength
    expect(Array.from(frame.subarray(0, 4))).toEqual([
      (expectedLength >>> 24) & 0xff,
      (expectedLength >>> 16) & 0xff,
      (expectedLength >>> 8) & 0xff,
      expectedLength & 0xff,
    ])
    expect(decodeJsonFrame(frame)).toEqual(value)
    expect(decodeFramePayload(frame).byteLength).toBe(expectedLength)
  })

  test("accepts the maximum payload and rejects one byte more", () => {
    const maximum = new Uint8Array(MAX_FRAME_BYTES)
    expect(encodeFrame(maximum).byteLength).toBe(MAX_FRAME_BYTES + 4)
    expectFrameError(() => encodeFrame(new Uint8Array(MAX_FRAME_BYTES + 1)), "oversize")
    expectFrameError(() => decodeJsonPayload(new Uint8Array(MAX_FRAME_BYTES + 1)), "oversize")

    const oversizeHeader = new Uint8Array(4)
    new DataView(oversizeHeader.buffer).setUint32(0, MAX_FRAME_BYTES + 1, false)
    expectFrameError(() => decodeFramePayload(oversizeHeader), "oversize")
  })

  test("rejects truncated and trailing frames", () => {
    expectFrameError(() => decodeFramePayload(Uint8Array.of(0, 0, 0)), "truncated")
    expectFrameError(() => decodeFramePayload(Uint8Array.of(0, 0, 0, 2, 0)), "truncated")
    expectFrameError(() => decodeFramePayload(Uint8Array.of(0, 0, 0, 0, 0)), "trailing")
  })

  test("rejects invalid UTF-8 and invalid JSON", () => {
    expectFrameError(() => decodeJsonFrame(encodeFrame(Uint8Array.of(0xc3, 0x28))), "invalid-utf8")
    expectFrameError(() => decodeJsonFrame(encodeFrame(UTF8_ENCODER.encode("{"))), "invalid-json")
  })

  test("rejects values JSON.stringify would silently alter", () => {
    expectFrameError(() => encodeJsonFrame(Number.NaN), "invalid-json")
    expectFrameError(() => encodeJsonFrame(Number.POSITIVE_INFINITY), "invalid-json")
    expectFrameError(() => encodeJsonFrame(undefined), "invalid-json")
    expectFrameError(() => encodeJsonFrame([1, , 3]), "invalid-json")
    expectFrameError(() => encodeJsonFrame(new Date(0)), "invalid-json")

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expectFrameError(() => encodeJsonFrame(cyclic), "invalid-json")
  })
})

describe("incremental frame decoding", () => {
  test("handles split headers, split payloads, and multiple frames", () => {
    const firstPayload = UTF8_ENCODER.encode("first")
    const secondPayload = UTF8_ENCODER.encode("second")
    const stream = concatenate(encodeFrame(firstPayload), encodeFrame(secondPayload))
    const decoder = new IncrementalFrameDecoder()
    const completed: Uint8Array[] = []

    const boundaries = [0, 1, 2, 5, 8, stream.byteLength]
    for (let index = 1; index < boundaries.length; index += 1) {
      const previous = boundaries[index - 1]
      const boundary = boundaries[index]
      if (previous === undefined || boundary === undefined) throw new Error("Invalid test boundary")
      completed.push(...decoder.push(stream.subarray(previous, boundary)))
    }
    decoder.finish()

    expect(completed).toEqual([firstPayload, secondPayload])
  })

  test("finish rejects a partial frame and poisons the decoder", () => {
    const decoder = new IncrementalFrameDecoder()
    expect(decoder.push(Uint8Array.of(0, 0))).toEqual([])
    expectFrameError(() => decoder.finish(), "truncated")
    expectFrameError(() => decoder.push(Uint8Array.of(0, 0)), "truncated")
  })

  test("an oversize declaration poisons the decoder", () => {
    const decoder = new IncrementalFrameDecoder()
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, MAX_FRAME_BYTES + 1, false)
    expectFrameError(() => decoder.push(header), "oversize")
    expectFrameError(() => decoder.finish(), "truncated")
  })
})

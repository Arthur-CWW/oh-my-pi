import { describe, expect, test } from "bun:test"
import { extractImageSubmitInfoFromSseText, extractSubmitIdFromSseText } from "../src/sse"

describe("extractSubmitIdFromSseText", () => {
  test("extracts from normal data json", () => {
    const text = [
      "event: message",
      'data: {"data":{"submit_id":"11111111-2222-4333-8444-555555555555"}}',
      "",
    ].join("\n")

    expect(extractSubmitIdFromSseText(text)).toBe("11111111-2222-4333-8444-555555555555")
  })

  test("extracts from nested stringified arguments", () => {
    const text = [
      "event: delta",
      'data: {"arguments":"{\\"submit_id\\":\\"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\\"}"}',
      "",
    ].join("\n")

    expect(extractSubmitIdFromSseText(text)).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
  })

  test("extracts from mixed payload fragment", () => {
    const text = [
      "event: message",
      'data: prefix random {"foo":1,"submitId":"99999999-8888-4777-8666-555555555555"} suffix',
      "",
    ].join("\n")

    expect(extractSubmitIdFromSseText(text)).toBe("99999999-8888-4777-8666-555555555555")
  })

  test("prefers keyed submit_id over unrelated id UUIDs", () => {
    const text = [
      "event: message",
      'data: {"id":"7fd28969-20fa-4353-bd3b-d48d673cb453","metadata":{"conversation_id":"13501406-e3fc-a4c8-af9b-85da8a26861f"},"submit_id":"29a8b2bc-90a9-4912-b0fc-04c1c67d971d"}',
      "",
    ].join("\n")

    expect(extractSubmitIdFromSseText(text)).toBe("29a8b2bc-90a9-4912-b0fc-04c1c67d971d")
  })

  test("returns null when only unrelated UUIDs exist", () => {
    const text = [
      "event: message",
      'data: {"id":"7fd28969-20fa-4353-bd3b-d48d673cb453","other":"5db6bd5e-d357-4333-8ac5-20e2476709c5"}',
      "",
    ].join("\n")

    expect(extractSubmitIdFromSseText(text)).toBe(null)
  })
})

describe("extractImageSubmitInfoFromSseText", () => {
  test("extracts submit_info from nested content", () => {
    const text = [
      "event: delta",
      'data: {"value":"{\\"submit_info\\":{\\"code\\":1017,\\"msg\\":\\"CheckPermission\\"},\\"submit_id\\":\\"29a8b2bc-90a9-4912-b0fc-04c1c67d971d\\"}"}',
      "",
    ].join("\n")

    expect(extractImageSubmitInfoFromSseText(text)).toEqual({
      code: 1017,
      msg: "CheckPermission",
    })
  })
})

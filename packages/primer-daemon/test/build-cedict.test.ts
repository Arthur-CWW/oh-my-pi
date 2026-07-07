import { describe, expect, test } from "bun:test"
import { parseCjkviIds } from "../scripts/build-cedict"

describe("parseCjkviIds", () => {
  test("extracts component chars for direct decompositions", () => {
    const entries = parseCjkviIds(["U+597D\t好\t⿰女子", "U+8BCD\t词\t⿰讠司", "U+4E0D\t不\t⿱一③[X]"].join("\n"))
    expect(entries).toEqual([
      { char: "好", ids: "⿰女子", components: ["女", "子"] },
      { char: "词", ids: "⿰讠司", components: ["讠", "司"] },
      { char: "不", ids: "⿱一③", components: ["一", "③"] },
    ])
  })

  test("flattens nested branches to character components while keeping ids", () => {
    const [entry] = parseCjkviIds("U+6538\t攸\t⿰⿰亻丨攵")
    expect(entry).toEqual({ char: "攸", ids: "⿰⿰亻丨攵", components: ["亻", "丨", "攵"] })
  })

  test("leaves undecomposed characters with no components", () => {
    const [entry] = parseCjkviIds("U+2462\t③\t③")
    expect(entry).toEqual({ char: "③", ids: "③", components: [] })
  })
})

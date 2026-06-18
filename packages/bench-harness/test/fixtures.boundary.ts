import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodeBenchPacket, type BenchPacket } from "../src/index"

export function readFixturePacket(name: string): BenchPacket {
  const fixturePath = join(import.meta.dirname || "", "../fixtures", `${name}.json`)
  const rawData = JSON.parse(readFileSync(fixturePath, "utf8"))
  return decodeBenchPacket(rawData)
}

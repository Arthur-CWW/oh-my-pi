import { readFileSync } from "node:fs"
import path from "node:path"

const fixtureRoot = path.resolve(import.meta.dir, "../../fixtures")

export function readMediaContractFixture(kind: "valid" | "invalid", fixtureName: string): unknown {
  const fixturePath = path.join(fixtureRoot, kind, fixtureName)
  return JSON.parse(readFileSync(fixturePath, "utf8")) as unknown
}


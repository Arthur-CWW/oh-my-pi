import { expect, test } from "bun:test"

import { axisId, optionalTrustLabels, parseAxis, renderEvidenceResult } from "../src/evidence-cli"

test("evidence CLI parses explicit, semantic frontier axes", () => {
  const parsed = parseAxis("metric-quality:quality.score:score:maximize:mean:conservative")

  expect(parsed).not.toBeInstanceOf(Error)
  if (parsed instanceof Error) {
    throw parsed
  }
  expect(parsed).toEqual({
    metricDefinitionId: "metric-quality",
    metricKey: "quality.score",
    unit: "score",
    direction: "maximize",
    reducer: "mean",
    boundsMode: "conservative",
  })
  expect(axisId(parsed)).toEqual(expect.any(String))
})

test("evidence CLI rejects incomplete or ambiguous axis selectors", () => {
  expect(parseAxis("quality.score:score:maximize")).toBeInstanceOf(Error)
  expect(parseAxis("-:cost.usd:USD:sideways:latest:point")).toBeInstanceOf(Error)
  expect(parseAxis(":::maximize:mean:point")).toBeInstanceOf(Error)
  expect(parseAxis("-::USD:minimize:latest:point")).toBeInstanceOf(Error)
  expect(parseAxis("-:cost.usd::minimize:latest:point")).toBeInstanceOf(Error)
})

test("evidence CLI omits an unfiltered trust constraint", () => {
  expect(optionalTrustLabels([])).toBeUndefined()
  expect(optionalTrustLabels(["primary"])).toEqual(["primary"])
})

test("evidence CLI separates JSON and table output", () => {
  const rows = [{ id: "source-1", title: "Primary source" }]

  expect(renderEvidenceResult(rows, true)).toBe(`${JSON.stringify(rows)}\n`)
  expect(renderEvidenceResult(rows, false)).toBe("result\n------\n{\"id\":\"source-1\",\"title\":\"Primary source\"}\n")
})

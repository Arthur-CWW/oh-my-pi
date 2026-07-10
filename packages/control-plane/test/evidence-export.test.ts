import { expect, test } from "bun:test"

import {
  exportFrontierCsv,
  exportFrontierJson,
  exportFrontierSvg,
} from "../src/evidence-export"
import { frontierAxisId, type FrontierAxis, type FrontierResult } from "../src/frontier"

const qualityAxis: FrontierAxis = {
  metricDefinitionId: "quality-v1",
  metricKey: "quality.score",
  unit: "percent",
  direction: "maximize",
  reducer: "mean",
  boundsMode: "point",
}
const costAxis: FrontierAxis = {
  metricKey: "cost.usd",
  unit: "USD",
  direction: "minimize",
  reducer: "sum",
  boundsMode: "point",
}
const latencyAxis: FrontierAxis = {
  metricKey: "latency.ms",
  unit: "ms",
  direction: "minimize",
  reducer: "latest",
  boundsMode: "conservative",
}

const qualityId = frontierAxisId(qualityAxis)
const costId = frontierAxisId(costAxis)

const result: FrontierResult = {
  query: {
    workClass: "implementation",
    axes: [qualityAxis, costAxis, latencyAxis],
    includeIncomplete: true,
    trustLabels: ["local", "official"],
  },
  candidates: [
    {
      identity: {
        participants: [{ ordinal: 0, role: "primary", provider: "Acme & Co", model: "fast <model>", modelVersion: "2026.07", account: null, effort: "high" }],
        harnessProfile: "harness-a",
        toolProfile: "tools-a",
        contextProfile: null,
      },
      axes: [
        axisValue(qualityAxis, 91.2, ["measure-2", "measure-1"], ["run-2", "run-1"], ["source-2", "source-1"]),
        axisValue(costAxis, 0.021, ["cost-1"], ["run-1"], ["source-1"]),
        axisValue(latencyAxis, 1_400, ["latency-1"], ["run-1"], ["source-1"]),
      ],
      status: "frontier",
      dominatedBy: [],
      missingAxes: [],
    },
    {
      identity: {
        participants: [{ ordinal: 0, role: "primary", provider: "Beta", model: "careful", modelVersion: null, account: "team,shared", effort: null }],
        harnessProfile: "harness-b",
        toolProfile: null,
        contextProfile: null,
      },
      axes: [
        axisValue(qualityAxis, 89.1, ["measure-3"], ["run-3"], ["source-3"]),
        axisValue(costAxis, 0.031, ["cost-2"], ["run-3"], ["source-3"]),
        axisValue(latencyAxis, 1_800, ["latency-2"], ["run-3"], ["source-3"]),
      ],
      status: "dominated",
      dominatedBy: [{
        participants: [{ ordinal: 0, role: "primary", provider: "Acme & Co", model: "fast <model>", modelVersion: "2026.07", account: null, effort: "high" }],
        harnessProfile: "harness-a",
        toolProfile: "tools-a",
        contextProfile: null,
      }],
      missingAxes: [],
    },
    {
      identity: {
        participants: [{ ordinal: 0, role: "primary", provider: "Gamma", model: "partial", modelVersion: null, account: null, effort: null }],
        harnessProfile: null,
        toolProfile: null,
        contextProfile: null,
      },
      axes: [
        axisValue(qualityAxis, 95, ["measure-4"], ["run-4"], ["source-4"]),
        axisValue(costAxis, 0.02, ["cost-3"], ["run-4"], ["source-4"]),
      ],
      status: "incomplete",
      dominatedBy: [],
      missingAxes: [2],
    },
  ],
}

test("frontier JSON and RFC 4180 CSV are byte-stable", () => {
  const json = exportFrontierJson(result)
  const csv = exportFrontierCsv(result)

  expect(exportFrontierJson(result)).toBe(json)
  expect(exportFrontierCsv(result)).toBe(csv)
  expect(json.endsWith("\n")).toBe(true)
  expect(csv.endsWith("\r\n")).toBe(true)
  expect(csv).toContain(`"team,shared"`)
  expect(csv).toContain(`"[""measure-1"",""measure-2""]"`)
  expect(json.indexOf("source-1")).toBeLessThan(json.indexOf("source-2"))
})

test("SVG is a byte-stable labelled two-dimensional projection with escaped text", () => {
  const svg = exportFrontierSvg(result, { xAxis: costId, yAxis: qualityId })

  expect(exportFrontierSvg(result, { xAxis: costId, yAxis: qualityId })).toBe(svg)
  expect(svg).toContain("Two-dimensional projection of an N-dimensional frontier result")
  expect(svg).toContain("Pairwise non-dominated line only")
  expect(svg).toContain("Acme &amp; Co/fast &lt;model&gt;")
  expect(svg).toContain("fill=\"#ffffff\"")
  expect(svg).toContain("stroke-dasharray=\"5 4\"")
  expect(svg).toContain("width=\"960\" height=\"640\"")
})

test("SVG positions conservative projections by comparison values", () => {
  const conservativeResult: FrontierResult = {
    ...result,
    candidates: result.candidates.map((candidate, candidateIndex) => ({
      ...candidate,
      axes: candidate.axes.map((value) => value.axis.metricKey === "cost.usd"
        ? { ...value, comparisonValue: 100 + candidateIndex * 100 }
        : value),
    })),
  }

  const svg = exportFrontierSvg(conservativeResult, { xAxis: costId, yAxis: qualityId })
  expect(svg).toContain(">145<")
  expect(svg).not.toBe(exportFrontierSvg(result, { xAxis: costId, yAxis: qualityId }))
})

test("SVG requires two distinct axes from the supplied frontier query", () => {
  expect(() => exportFrontierSvg(result, { xAxis: qualityId, yAxis: qualityId })).toThrow("must differ")
  expect(() => exportFrontierSvg(result, { xAxis: "missing", yAxis: qualityId })).toThrow("not in frontier query")
})

function axisValue(axis: FrontierAxis, value: number, measurementIds: readonly string[], runIds: readonly string[], sourceIds: readonly string[]) {
  return {
    axis,
    value,
    comparisonValue: value,
    lowerBound: null,
    upperBound: null,
    sampleSize: 1,
    measurementIds,
    runIds,
    sourceIds,
    trustLabels: ["local"],
  }
}

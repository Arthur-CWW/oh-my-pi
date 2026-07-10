import {
  frontierAxisId,
  type FrontierAxis,
  type FrontierAxisValue,
  type FrontierCandidate,
  type FrontierCandidateIdentity,
  type FrontierParticipant,
  type FrontierResult,
} from "./frontier"

const SVG_WIDTH = 960
const SVG_HEIGHT = 640
const SVG_MARGIN = { top: 72, right: 252, bottom: 88, left: 100 }
const TICK_COUNT = 5
const PALETTE = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#000000", "#F0E442"] as const

export interface FrontierSvgProjection {
  /** Stable `frontierAxisId` of the horizontal axis. */
  readonly xAxis: string
  /** Stable `frontierAxisId` of the vertical axis. */
  readonly yAxis: string
}

/** Produces canonical JSON bytes for a computed frontier result. */
export function exportFrontierJson(result: FrontierResult): string {
  return `${JSON.stringify(canonicalResult(result))}\n`
}

/** Produces RFC 4180 CSV bytes with a deterministic, query-axis-derived header. */
export function exportFrontierCsv(result: FrontierResult): string {
  const axisIds = result.query.axes.map(frontierAxisId)
  const header = [
    "candidate", "status", "missingAxes", "participants", "harnessProfile", "toolProfile", "contextProfile",
    ...axisIds.flatMap((axisId) => [
      `${axisId}.value`, `${axisId}.comparisonValue`, `${axisId}.lowerBound`, `${axisId}.upperBound`,
      `${axisId}.sampleSize`, `${axisId}.measurementIds`, `${axisId}.runIds`, `${axisId}.sourceIds`, `${axisId}.trustLabels`,
    ]),
  ]
  const rows = canonicalCandidates(result).map((candidate) => {
    const values = new Map<string, FrontierAxisValue>(candidate.axes.map((axis) => [frontierAxisId(axis.axis), axis] as const))
    return [
      identityKey(candidate.identity),
      candidate.status,
      candidate.missingAxes.join(" "),
      JSON.stringify(canonicalParticipants(candidate.identity.participants)),
      nullableText(candidate.identity.harnessProfile),
      nullableText(candidate.identity.toolProfile),
      nullableText(candidate.identity.contextProfile),
      ...axisIds.flatMap((axisId) => csvAxisCells(values.get(axisId))),
    ]
  })
  return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`
}

/**
 * Renders a dependency-free two-dimensional projection of an N-dimensional result.
 * The plotted non-dominated line is recomputed only for this selected pair and is
 * explicitly not a replacement for the complete N-dimensional frontier result.
 */
export function exportFrontierSvg(result: FrontierResult, projection: FrontierSvgProjection): string {
  const xAxis = axisById(result.query.axes, projection.xAxis)
  const yAxis = axisById(result.query.axes, projection.yAxis)
  if (projection.xAxis === projection.yAxis) throw new Error("SVG x and y axes must differ")

  const points = canonicalCandidates(result).map((candidate) => ({
    candidate,
    x: axisValue(candidate, projection.xAxis),
    y: axisValue(candidate, projection.yAxis),
  }))
  const positioned = points.filter((point): point is SvgPoint => point.x !== null && point.y !== null)
  if (positioned.length === 0) throw new Error("SVG projection has no candidates with both selected axes")

  const xDomain = scaleDomain(positioned.map((point) => point.x.comparisonValue))
  const yDomain = scaleDomain(positioned.map((point) => point.y.comparisonValue))
  const plotWidth = SVG_WIDTH - SVG_MARGIN.left - SVG_MARGIN.right
  const plotHeight = SVG_HEIGHT - SVG_MARGIN.top - SVG_MARGIN.bottom
  const xScale = makeScale(xDomain, SVG_MARGIN.left, SVG_MARGIN.left + plotWidth)
  const yScale = makeScale(yDomain, SVG_MARGIN.top + plotHeight, SVG_MARGIN.top)
  const xTicks = ticks(xDomain, TICK_COUNT)
  const yTicks = ticks(yDomain, TICK_COUNT)
  const complete = positioned.filter((point) => point.candidate.status !== "incomplete")
  const pairFrontier = twoDimensionalFrontier(complete, xAxis, yAxis)
  const stair = staircase(pairFrontier, xScale, yScale, xAxis, yAxis)

  const lines: string[] = []
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-labelledby="title description">`)
  lines.push(`<title id="title">Two-dimensional Pareto projection</title>`)
  lines.push(`<desc id="description">Two-dimensional projection of an N-dimensional frontier result. The stepped line is non-dominated only for the selected axes.</desc>`)
  lines.push(`<rect width="100%" height="100%" fill="#ffffff"/>`)
  lines.push(`<text x="${SVG_MARGIN.left}" y="30" font-family="system-ui, sans-serif" font-size="20" font-weight="600">Two-dimensional projection of an N-dimensional frontier result</text>`)
  lines.push(`<text x="${SVG_MARGIN.left}" y="52" font-family="system-ui, sans-serif" font-size="12" fill="#444444">Pairwise non-dominated line only; JSON and CSV retain the authoritative complete-case result.</text>`)
  lines.push(`<rect x="${SVG_MARGIN.left}" y="${SVG_MARGIN.top}" width="${plotWidth}" height="${plotHeight}" fill="#ffffff" stroke="#222222"/>`)

  for (const tick of xTicks) {
    const x = xScale(tick)
    const coordinate = formatCoordinate(x)
    lines.push(`<line x1="${coordinate}" y1="${SVG_MARGIN.top}" x2="${coordinate}" y2="${SVG_MARGIN.top + plotHeight}" stroke="#e6e6e6"/>`)
    lines.push(`<text x="${coordinate}" y="${SVG_MARGIN.top + plotHeight + 22}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11">${xmlEscape(formatNumber(tick))}</text>`)
  }
  for (const tick of yTicks) {
    const y = yScale(tick)
    const coordinate = formatCoordinate(y)
    lines.push(`<line x1="${SVG_MARGIN.left}" y1="${coordinate}" x2="${SVG_MARGIN.left + plotWidth}" y2="${coordinate}" stroke="#e6e6e6"/>`)
    lines.push(`<text x="${SVG_MARGIN.left - 10}" y="${formatCoordinate(y + 4)}" text-anchor="end" font-family="system-ui, sans-serif" font-size="11">${xmlEscape(formatNumber(tick))}</text>`)
  }
  if (stair !== "") lines.push(`<path d="${stair}" fill="none" stroke="#333333" stroke-width="1.5" stroke-dasharray="5 4"/>`)

  for (const point of positioned) {
    const x = formatCoordinate(xScale(point.x.comparisonValue))
    const y = formatCoordinate(yScale(point.y.comparisonValue))
    const color = candidateColor(point.candidate.identity)
    const incomplete = point.candidate.status === "incomplete"
    const shape = incomplete
      ? `<circle cx="${x}" cy="${y}" r="5" fill="#ffffff" stroke="${color}" stroke-width="2"/>`
      : `<circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="#ffffff" stroke-width="1.25"/>`
    lines.push(`<g><title>${xmlEscape(candidateLabel(point.candidate.identity))}: ${xmlEscape(point.candidate.status)}</title>${shape}</g>`)
  }

  lines.push(`<text x="${SVG_MARGIN.left + plotWidth / 2}" y="${SVG_HEIGHT - 24}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13">${xmlEscape(axisLabel(xAxis))}</text>`)
  lines.push(`<text x="22" y="${SVG_MARGIN.top + plotHeight / 2}" text-anchor="middle" transform="rotate(-90 22 ${SVG_MARGIN.top + plotHeight / 2})" font-family="system-ui, sans-serif" font-size="13">${xmlEscape(axisLabel(yAxis))}</text>`)
  lines.push(`<g font-family="system-ui, sans-serif" font-size="11">`)
  canonicalCandidates(result).forEach((candidate, index) => {
    const y = SVG_MARGIN.top + 18 + index * 20
    const color = candidateColor(candidate.identity)
    const hollow = candidate.status === "incomplete"
    lines.push(`<circle cx="${SVG_MARGIN.left + plotWidth + 16}" cy="${y - 4}" r="4" fill="${hollow ? "#ffffff" : color}" stroke="${color}"/>`)
    lines.push(`<text x="${SVG_MARGIN.left + plotWidth + 28}" y="${y}" fill="#222222">${xmlEscape(candidateLabel(candidate.identity))} (${xmlEscape(candidate.status)})</text>`)
  })
  lines.push(`</g></svg>\n`)
  return lines.join("\n")
}

function canonicalResult(result: FrontierResult): object {
  return {
    query: canonicalQuery(result),
    candidates: canonicalCandidates(result).map(canonicalCandidate),
  }
}

function canonicalQuery(result: FrontierResult): object {
  const query = result.query
  return {
    workClass: query.workClass,
    axes: query.axes.map(canonicalAxis),
    includeIncomplete: query.includeIncomplete === true,
    since: nullableNumber(query.since),
    until: nullableNumber(query.until),
    evidenceKind: query.evidenceKind ?? null,
    trustLabels: query.trustLabels === undefined ? null : [...query.trustLabels].sort(compareText),
    taskModality: query.taskModality ?? null,
    harnessProfile: query.harnessProfile === undefined ? null : query.harnessProfile,
    toolProfile: query.toolProfile === undefined ? null : query.toolProfile,
    contextProfile: query.contextProfile === undefined ? null : query.contextProfile,
    provider: query.provider ?? null,
    model: query.model ?? null,
    account: query.account === undefined ? null : query.account,
    effort: query.effort === undefined ? null : query.effort,
  }
}

function canonicalCandidates(result: FrontierResult): FrontierCandidate[] {
  return [...result.candidates].sort((left, right) => statusRank(left.status) - statusRank(right.status) || compareText(identityKey(left.identity), identityKey(right.identity)))
}

function canonicalCandidate(candidate: FrontierCandidate): object {
  return {
    identity: canonicalIdentity(candidate.identity),
    axes: [...candidate.axes].sort((left, right) => compareText(frontierAxisId(left.axis), frontierAxisId(right.axis))).map(canonicalAxisValue),
    status: candidate.status,
    dominatedBy: [...candidate.dominatedBy].sort((left, right) => compareText(identityKey(left), identityKey(right))).map(canonicalIdentity),
    missingAxes: [...candidate.missingAxes].sort((left, right) => left - right),
  }
}

function canonicalAxisValue(value: FrontierAxisValue): object {
  return {
    axis: canonicalAxis(value.axis),
    value: canonicalNumber(value.value),
    comparisonValue: canonicalNumber(value.comparisonValue),
    lowerBound: nullableNumber(value.lowerBound),
    upperBound: nullableNumber(value.upperBound),
    sampleSize: nullableNumber(value.sampleSize),
    measurementIds: [...value.measurementIds].sort(compareText),
    runIds: [...value.runIds].sort(compareText),
    sourceIds: [...value.sourceIds].sort(compareText),
    trustLabels: [...value.trustLabels].sort(compareText),
  }
}

function canonicalAxis(axis: FrontierAxis): object {
  return {
    id: frontierAxisId(axis),
    metricDefinitionId: axis.metricDefinitionId ?? null,
    metricKey: axis.metricKey,
    unit: axis.unit,
    direction: axis.direction,
    reducer: axis.reducer,
    boundsMode: axis.boundsMode,
  }
}

function canonicalIdentity(identity: FrontierCandidateIdentity): object {
  return {
    participants: canonicalParticipants(identity.participants),
    harnessProfile: identity.harnessProfile,
    toolProfile: identity.toolProfile,
    contextProfile: identity.contextProfile,
  }
}

function canonicalParticipants(participants: readonly FrontierParticipant[]): object[] {
  return [...participants].sort((left, right) => left.ordinal - right.ordinal).map((participant) => ({
    ordinal: participant.ordinal,
    role: participant.role,
    provider: participant.provider,
    model: participant.model,
    modelVersion: participant.modelVersion,
    account: participant.account,
    effort: participant.effort,
  }))
}

function csvAxisCells(axis: FrontierAxisValue | undefined): string[] {
  if (axis === undefined) return ["", "", "", "", "", "", "", "", ""]
  return [
    formatNumber(axis.value), formatNumber(axis.comparisonValue), nullableNumberText(axis.lowerBound), nullableNumberText(axis.upperBound),
    nullableNumberText(axis.sampleSize), JSON.stringify([...axis.measurementIds].sort(compareText)), JSON.stringify([...axis.runIds].sort(compareText)),
    JSON.stringify([...axis.sourceIds].sort(compareText)), JSON.stringify([...axis.trustLabels].sort(compareText)),
  ]
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll("\"", "\"\"")}"` : value
}

function axisById(axes: readonly FrontierAxis[], id: string): FrontierAxis {
  const axis = axes.find((candidate) => frontierAxisId(candidate) === id)
  if (axis === undefined) throw new Error(`SVG axis is not in frontier query: ${id}`)
  return axis
}

function axisValue(candidate: FrontierCandidate, axisId: string): FrontierAxisValue | null {
  return candidate.axes.find((value) => frontierAxisId(value.axis) === axisId) ?? null
}

interface SvgPoint {
  readonly candidate: FrontierCandidate
  readonly x: FrontierAxisValue
  readonly y: FrontierAxisValue
}
function twoDimensionalFrontier(points: readonly SvgPoint[], xAxis: FrontierAxis, yAxis: FrontierAxis): SvgPoint[] {
  return points.filter((candidate) => !points.some((other) => other !== candidate && dominatesPair(other, candidate, xAxis, yAxis)))
    .sort((left, right) => compareForAxis(left.x.comparisonValue, right.x.comparisonValue, xAxis.direction) || compareForAxis(left.y.comparisonValue, right.y.comparisonValue, yAxis.direction) || compareText(identityKey(left.candidate.identity), identityKey(right.candidate.identity)))
}

function dominatesPair(left: SvgPoint, right: SvgPoint, xAxis: FrontierAxis, yAxis: FrontierAxis): boolean {
  const x = compareForAxis(left.x.comparisonValue, right.x.comparisonValue, xAxis.direction)
  const y = compareForAxis(left.y.comparisonValue, right.y.comparisonValue, yAxis.direction)
  return x <= 0 && y <= 0 && (x < 0 || y < 0)
}

function staircase(points: readonly SvgPoint[], xScale: (value: number) => number, yScale: (value: number) => number, xAxis: FrontierAxis, yAxis: FrontierAxis): string {
  if (points.length === 0) return ""
  const sorted = [...points].sort((left, right) => compareForAxis(left.x.comparisonValue, right.x.comparisonValue, xAxis.direction) || compareForAxis(left.y.comparisonValue, right.y.comparisonValue, yAxis.direction) || compareText(identityKey(left.candidate.identity), identityKey(right.candidate.identity)))
  const start = sorted[0]!
  let path = `M ${formatCoordinate(xScale(start.x.comparisonValue))} ${formatCoordinate(yScale(start.y.comparisonValue))}`
  for (const point of sorted.slice(1)) {
    path += ` H ${formatCoordinate(xScale(point.x.comparisonValue))} V ${formatCoordinate(yScale(point.y.comparisonValue))}`
  }
  return path
}

function scaleDomain(values: readonly number[]): readonly [number, number] {
  const low = Math.min(...values)
  const high = Math.max(...values)
  if (low === high) {
    const padding = low === 0 ? 1 : Math.abs(low) * 0.05
    return [low - padding, high + padding]
  }
  const padding = (high - low) * 0.05
  return [low - padding, high + padding]
}

function makeScale(domain: readonly [number, number], start: number, end: number): (value: number) => number {
  const span = domain[1] - domain[0]
  return (value) => start + ((value - domain[0]) / span) * (end - start)
}

function ticks(domain: readonly [number, number], count: number): number[] {
  const step = (domain[1] - domain[0]) / (count - 1)
  return Array.from({ length: count }, (_, index) => domain[0] + step * index)
}

function candidateColor(identity: FrontierCandidateIdentity): string {
  return PALETTE[hashText(identityKey(identity)) % PALETTE.length]!
}

function hashText(text: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function identityKey(identity: FrontierCandidateIdentity): string {
  return JSON.stringify(canonicalIdentity(identity))
}

function candidateLabel(identity: FrontierCandidateIdentity): string {
  return identity.participants.map((participant) => `${participant.role}: ${participant.provider}/${participant.model}${participant.modelVersion === null ? "" : `@${participant.modelVersion}`}${participant.effort === null ? "" : ` (${participant.effort})`}`).join(" + ")
}

function axisLabel(axis: FrontierAxis): string {
  return `${axis.metricKey} (${axis.unit}; ${axis.direction}; ${axis.reducer}; ${axis.boundsMode})`
}

function compareForAxis(left: number, right: number, direction: FrontierAxis["direction"]): number {
  return direction === "maximize" ? right - left : left - right
}

function statusRank(status: FrontierCandidate["status"]): number {
  return status === "frontier" ? 0 : status === "dominated" ? 1 : 2
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalNumber(value: number): number {
  if (!Number.isFinite(value)) throw new Error("frontier export requires finite numbers")
  return Object.is(value, -0) ? 0 : value
}

function nullableNumber(value: number | undefined | null): number | null {
  return value === undefined || value === null ? null : canonicalNumber(value)
}

function nullableText(value: string | null): string {
  return value ?? ""
}

function nullableNumberText(value: number | null): string {
  return value === null ? "" : formatNumber(value)
}

function formatNumber(value: number): string {
  const normalized = canonicalNumber(value)
  return String(normalized)
}

function formatCoordinate(value: number): string {
  return formatNumber(Math.round(value * 1_000) / 1_000)
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&apos;")
}

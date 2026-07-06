const MINUTE = 60
const HOUR = MINUTE * 60
const DAY = HOUR * 24
const WEEK = DAY * 7
const MONTH = DAY * 30
const YEAR = DAY * 365

function parse(input: string | number | Date | null | undefined): number | null {
  if (input === null || input === undefined) return null
  const ms = input instanceof Date ? input.getTime() : typeof input === "number" ? input : Date.parse(input)
  return Number.isNaN(ms) ? null : ms
}

/** Compact, dense form for chips and metadata: "now", "12m ago", "3h ago", "in 2d". */
export function relativeShort(input: string | number | Date | null | undefined, now: number = Date.now()): string {
  const then = parse(input)
  if (then === null) return "—"
  const deltaSec = Math.round((now - then) / 1000)
  const past = deltaSec >= 0
  const abs = Math.abs(deltaSec)
  if (abs < 45) return "now"

  let value: number
  let unit: string
  if (abs < HOUR) {
    value = abs / MINUTE
    unit = "m"
  } else if (abs < DAY) {
    value = abs / HOUR
    unit = "h"
  } else if (abs < WEEK) {
    value = abs / DAY
    unit = "d"
  } else if (abs < MONTH) {
    value = abs / WEEK
    unit = "w"
  } else if (abs < YEAR) {
    value = abs / MONTH
    unit = "mo"
  } else {
    value = abs / YEAR
    unit = "y"
  }

  const label = `${Math.round(value)}${unit}`
  return past ? `${label} ago` : `in ${label}`
}

/** Milliseconds of age for staleness coloring; null when unparseable. */
export function ageMs(input: string | number | Date | null | undefined, now: number = Date.now()): number | null {
  const then = parse(input)
  return then === null ? null : now - then
}

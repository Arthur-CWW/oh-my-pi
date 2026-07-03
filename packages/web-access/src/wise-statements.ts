import { Effect, Schema } from "effect"
import { toErrorMessage } from "./schemas"

export type WiseStatementsAction = "config" | "profiles" | "balances" | "statement"
export type WiseStatementType = "COMPACT" | "FLAT"

export interface WiseStatementsConfig {
  apiToken: string
  sandbox: boolean
}

export interface WiseStatementsInput {
  action: WiseStatementsAction
  apiToken?: string
  token?: string
  sandbox?: boolean
  profileId?: string
  balanceId?: string
  currency?: string
  intervalStart?: string
  intervalEnd?: string
  statementType?: WiseStatementType
}

export interface WiseStatementsResult {
  action: WiseStatementsAction
  text: string
  details: WiseStatementsDetails
}

export type WiseStatementsDetails =
  | { action: "config"; token: string; baseUrl: string; sandbox: boolean }
  | { action: "profiles"; token: string; baseUrl: string; profiles: ReadonlyArray<WiseProfile> }
  | { action: "balances"; token: string; baseUrl: string; profileId: string; balances: ReadonlyArray<WiseBalance> }
  | { action: "statement"; token: string; baseUrl: string; profileId: string; balanceId: string; statement: WiseStatement }

export class WiseStatementsError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = "WiseStatementsError"
    this.status = status
  }
}

const MAX_STATEMENT_INTERVAL_DAYS = 469
const WISE_LIVE_BASE_URL = "https://api.wise.com"
const WISE_SANDBOX_BASE_URL = "https://api.wise-sandbox.com"

const WiseMoney = Schema.Struct({
  value: Schema.Number,
  currency: Schema.String,
})
export type WiseMoney = typeof WiseMoney.Type

const WiseProfile = Schema.Struct({
  id: Schema.Number,
  type: Schema.optional(Schema.String),
})
export type WiseProfile = typeof WiseProfile.Type

const WiseBalance = Schema.Struct({
  id: Schema.Number,
  currency: Schema.String,
  type: Schema.String,
  amount: Schema.optional(WiseMoney),
})
export type WiseBalance = typeof WiseBalance.Type

const WiseStatementTransactionDetails = Schema.Struct({
  type: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
})
export type WiseStatementTransactionDetails = typeof WiseStatementTransactionDetails.Type

const WiseStatementTransaction = Schema.Struct({
  type: Schema.optional(Schema.String),
  date: Schema.String,
  amount: WiseMoney,
  totalFees: Schema.optional(WiseMoney),
  runningBalance: Schema.optional(WiseMoney),
  referenceNumber: Schema.optional(Schema.String),
  details: Schema.optional(WiseStatementTransactionDetails),
})
export type WiseStatementTransaction = typeof WiseStatementTransaction.Type

const WiseStatement = Schema.Struct({
  currency: Schema.optional(Schema.String),
  intervalStart: Schema.optional(Schema.String),
  intervalEnd: Schema.optional(Schema.String),
  transactions: Schema.Array(WiseStatementTransaction),
})
export type WiseStatement = typeof WiseStatement.Type

const WiseProfilesResponse = Schema.Array(WiseProfile)
const WiseBalancesResponse = Schema.Array(WiseBalance)

export function redactWiseToken(token: string): string {
  const trimmed = token.trim()
  if (trimmed.length <= 8) return "…"
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`
}

export function redactWiseTokenText(text: string, token?: string): string {
  const trimmed = token?.trim()
  if (!trimmed) return text
  return text.split(trimmed).join(redactWiseToken(trimmed))
}

export function loadWiseStatementsConfig(
  env: Record<string, string | undefined>,
  overrides: { apiToken?: string; token?: string; sandbox?: boolean } = {},
): WiseStatementsConfig {
  const apiToken = overrides.apiToken?.trim() || overrides.token?.trim() || env.WISE_API_TOKEN?.trim() || env.WISE_TOKEN?.trim() || ""
  return {
    apiToken,
    sandbox: overrides.sandbox === true,
  }
}

export function wiseApiBaseUrl(sandbox: boolean): string {
  return sandbox ? WISE_SANDBOX_BASE_URL : WISE_LIVE_BASE_URL
}

function isAllowedWisePath(pathname: string): boolean {
  return pathname === "/v1/profiles"
    || /^\/v4\/profiles\/[^/]+\/balances$/.test(pathname)
    || /^\/v1\/profiles\/[^/]+\/balance-statements\/[^/]+\/statement\.json$/.test(pathname)
}

export function isAllowedWiseUrl(url: URL, sandbox: boolean): boolean {
  const allowedHost = url.protocol === "https:"
    && (url.hostname === "api.wise.com" || (sandbox && url.hostname === "api.wise-sandbox.com"))
  return allowedHost && isAllowedWisePath(url.pathname)
}

export function assertWiseRequestAllowed(method: string, url: URL, sandbox: boolean): void {
  if (method !== "GET") throw new WiseStatementsError(`Wise API request method ${method} is not allowed; this tool is read-only GET-only.`)
  if (!isAllowedWiseUrl(url, sandbox)) throw new WiseStatementsError(`Wise API URL is not allowlisted: ${url.origin}${url.pathname}`)
}

export function buildWiseApiUrl(pathname: string, query: Record<string, string>, sandbox: boolean): URL {
  if (!pathname.startsWith("/")) throw new WiseStatementsError("Wise API path must be absolute.")
  const url = new URL(pathname, wiseApiBaseUrl(sandbox))
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  assertWiseRequestAllowed("GET", url, sandbox)
  return url
}

export function validateWiseStatementInterval(intervalStart: string, intervalEnd: string): void {
  const startMs = Date.parse(intervalStart)
  const endMs = Date.parse(intervalEnd)
  if (!Number.isFinite(startMs)) throw new WiseStatementsError("Wise statement intervalStart must be an ISO date/time string.")
  if (!Number.isFinite(endMs)) throw new WiseStatementsError("Wise statement intervalEnd must be an ISO date/time string.")
  if (endMs < startMs) throw new WiseStatementsError("Wise statement intervalEnd must be on or after intervalStart.")
  const intervalDays = (endMs - startMs) / (24 * 60 * 60 * 1000)
  if (intervalDays > MAX_STATEMENT_INTERVAL_DAYS) {
    throw new WiseStatementsError(`Wise statement intervals must be ${MAX_STATEMENT_INTERVAL_DAYS} days or shorter.`)
  }
}

export function decodeWiseProfiles(value: unknown): ReadonlyArray<WiseProfile> {
  return Schema.decodeUnknownSync(WiseProfilesResponse)(value)
}

export function decodeWiseBalances(value: unknown): ReadonlyArray<WiseBalance> {
  return Schema.decodeUnknownSync(WiseBalancesResponse)(value)
}

export function decodeWiseStatement(value: unknown): WiseStatement {
  return Schema.decodeUnknownSync(WiseStatement)(value)
}

const wiseApiGet = Effect.fn("wiseApiGet")(function* (token: string, path: string, query: Record<string, string>, sandbox: boolean) {
  if (!token.trim()) return yield* Effect.fail(new WiseStatementsError("Missing Wise API token. Set WISE_API_TOKEN or WISE_TOKEN, or pass apiToken."))
  const url = buildWiseApiUrl(path, query, sandbox)
  const response = yield* Effect.tryPromise({
    try: () => fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
    }),
    catch: (err) => new WiseStatementsError(`Wise API GET ${url.origin}${url.pathname} request failed: ${redactWiseTokenText(toErrorMessage(err), token)}`),
  })
  const text = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: (err) => new WiseStatementsError(`Wise API GET ${url.origin}${url.pathname} response read failed: ${redactWiseTokenText(toErrorMessage(err), token)}`, response.status),
  })
  const parsed = yield* Effect.try({
    try: () => text ? JSON.parse(text) as unknown : null,
    catch: (err) => new WiseStatementsError(`Wise API GET ${url.origin}${url.pathname} returned invalid JSON: ${redactWiseTokenText(toErrorMessage(err), token)}`, response.status),
  })
  if (!response.ok) return yield* Effect.fail(new WiseStatementsError(`Wise API GET ${url.origin}${url.pathname} failed with HTTP ${response.status}.`, response.status))
  return parsed
})

export const fetchWiseProfiles = Effect.fn("fetchWiseProfiles")(function* (token: string, sandbox: boolean) {
  const value = yield* wiseApiGet(token, "/v1/profiles", {}, sandbox)
  return yield* Effect.try({
    try: () => decodeWiseProfiles(value),
    catch: (err) => new WiseStatementsError(`Wise profiles response decode failed: ${toErrorMessage(err)}`),
  })
})

export const fetchWiseBalances = Effect.fn("fetchWiseBalances")(function* (token: string, profileId: string, sandbox: boolean) {
  const path = `/v4/profiles/${encodeURIComponent(profileId)}/balances`
  const value = yield* wiseApiGet(token, path, { types: "STANDARD,SAVINGS" }, sandbox)
  return yield* Effect.try({
    try: () => decodeWiseBalances(value),
    catch: (err) => new WiseStatementsError(`Wise balances response decode failed: ${toErrorMessage(err)}`),
  })
})

export const fetchWiseStatement = Effect.fn("fetchWiseStatement")(function* (
  token: string,
  input: { profileId: string; balanceId: string; currency: string; intervalStart: string; intervalEnd: string; statementType?: WiseStatementType; sandbox: boolean },
) {
  validateWiseStatementInterval(input.intervalStart, input.intervalEnd)
  const path = `/v1/profiles/${encodeURIComponent(input.profileId)}/balance-statements/${encodeURIComponent(input.balanceId)}/statement.json`
  const value = yield* wiseApiGet(token, path, {
    currency: input.currency,
    intervalStart: input.intervalStart,
    intervalEnd: input.intervalEnd,
    type: input.statementType ?? "COMPACT",
  }, input.sandbox)
  return yield* Effect.try({
    try: () => decodeWiseStatement(value),
    catch: (err) => new WiseStatementsError(`Wise statement response decode failed: ${toErrorMessage(err)}`),
  })
})

function requireParam(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new WiseStatementsError(`Missing Wise ${name}.`)
  return value.trim()
}

function formatProfiles(profiles: ReadonlyArray<WiseProfile>): string {
  if (profiles.length === 0) return "No Wise profiles returned."
  return [`${profiles.length} Wise profile(s):`, ...profiles.map((profile) => `- ${profile.id}${profile.type ? ` (${profile.type})` : ""}`)].join("\n")
}

function formatBalances(balances: ReadonlyArray<WiseBalance>): string {
  if (balances.length === 0) return "No Wise STANDARD or SAVINGS balances returned."
  return [`${balances.length} Wise balance(s):`, ...balances.map((balance) => {
    const amount = balance.amount ? ` · ${balance.amount.value} ${balance.amount.currency}` : ""
    return `- ${balance.id} ${balance.currency} ${balance.type}${amount}`
  })].join("\n")
}

function formatStatement(statement: WiseStatement): string {
  const transactionCount = statement.transactions.length
  const currency = statement.currency ? ` ${statement.currency}` : ""
  const range = statement.intervalStart && statement.intervalEnd ? ` from ${statement.intervalStart} to ${statement.intervalEnd}` : ""
  const lines = [`Wise statement${currency}${range}: ${transactionCount} transaction(s).`]
  for (const transaction of statement.transactions.slice(0, 20)) {
    const description = transaction.details?.description ? ` — ${transaction.details.description.replace(/\s+/g, " ").slice(0, 160)}` : ""
    const reference = transaction.referenceNumber ? ` #${transaction.referenceNumber}` : ""
    lines.push(`- ${transaction.date}${reference}: ${transaction.amount.value} ${transaction.amount.currency}${description}`)
  }
  if (transactionCount > 20) lines.push(`... ${transactionCount - 20} more transaction(s) omitted from text summary; details include decoded transactions.`)
  return lines.join("\n")
}

export const runWiseStatementsAction = Effect.fn("runWiseStatementsAction")(function* (
  input: WiseStatementsInput,
  env: Record<string, string | undefined> = process.env,
) {
  const config = loadWiseStatementsConfig(env, input)
  const tokenSummary = config.apiToken ? redactWiseToken(config.apiToken) : "<missing>"
  const baseUrl = wiseApiBaseUrl(config.sandbox)

  if (input.action === "config") {
    const details: WiseStatementsDetails = { action: "config", token: tokenSummary, baseUrl, sandbox: config.sandbox }
    return {
      action: "config",
      text: ["Wise statements config:", `token: ${details.token}`, `base_url: ${details.baseUrl}`, `sandbox: ${details.sandbox}`].join("\n"),
      details,
    }
  }

  const token = config.apiToken
  if (input.action === "profiles") {
    const profiles = yield* fetchWiseProfiles(token, config.sandbox)
    const details: WiseStatementsDetails = { action: "profiles", token: tokenSummary, baseUrl, profiles }
    return { action: "profiles", text: formatProfiles(profiles), details }
  }

  if (input.action === "balances") {
    const profileId = requireParam(input.profileId, "profileId")
    const balances = yield* fetchWiseBalances(token, profileId, config.sandbox)
    const details: WiseStatementsDetails = { action: "balances", token: tokenSummary, baseUrl, profileId, balances }
    return { action: "balances", text: formatBalances(balances), details }
  }

  const profileId = requireParam(input.profileId, "profileId")
  const balanceId = requireParam(input.balanceId, "balanceId")
  const currency = requireParam(input.currency, "currency")
  const intervalStart = requireParam(input.intervalStart, "intervalStart")
  const intervalEnd = requireParam(input.intervalEnd, "intervalEnd")
  const statement = yield* fetchWiseStatement(token, {
    profileId,
    balanceId,
    currency,
    intervalStart,
    intervalEnd,
    statementType: input.statementType,
    sandbox: config.sandbox,
  })
  const details: WiseStatementsDetails = { action: "statement", token: tokenSummary, baseUrl, profileId, balanceId, statement }
  return { action: "statement", text: formatStatement(statement), details }
})

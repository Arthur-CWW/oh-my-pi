import { createHash } from "node:crypto"
import { z } from "zod"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJimengContract, parseJsonText } from "./schema"

const USER_CREDIT_ENDPOINT = "/commerce/v1/benefits/user_credit"
const DEFAULT_REFERER = "https://jimeng.jianying.com/ai-tool/image/generate"
const PLATFORM_CODE = "7"
const APP_VERSION = "8.4.0"

const OptionalNumber = z.number().nullable().optional()

const UserCreditWireSchema = z.object({
  gift_credit: OptionalNumber,
  giftCredit: OptionalNumber,
  purchase_credit: OptionalNumber,
  purchaseCredit: OptionalNumber,
  vip_credit: OptionalNumber,
  vipCredit: OptionalNumber,
}).passthrough()

const UserCreditDataWireSchema = z.object({
  credit: UserCreditWireSchema.nullable().optional(),
  credits_detail: z.unknown().nullable().optional(),
  creditsDetail: z.unknown().nullable().optional(),
}).passthrough()

export interface JimengAccountCredit {
  giftCredit: number
  purchaseCredit: number
  vipCredit: number
  totalCredit: number
}

export interface JimengAccountCreditResult {
  endpoint: typeof USER_CREDIT_ENDPOINT
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  credit: JimengAccountCredit
  creditsDetailKind: string | null
  body: JsonValue
}

export async function fetchJimengAccountCredit(input: {
  client?: JimengClient
  session: JimengSessionBundle
  nowMs?: number
}): Promise<JimengAccountCreditResult> {
  const request: JsonObject = {}
  const client = input.client ?? new JimengClient()
  const response = await client.requestText(`https://jimeng.jianying.com${USER_CREDIT_ENDPOINT}`, {
    method: "POST",
    headers: buildJimengCommerceSignedHeaders(input.session, {
      endpoint: USER_CREDIT_ENDPOINT,
      nowMs: input.nowMs,
      referer: DEFAULT_REFERER,
    }),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, "account credit")
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, "account credit")
  const parsed = parseJimengAccountCreditBody(body)
  return {
    endpoint: USER_CREDIT_ENDPOINT,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    ...parsed,
    body,
  }
}

export function parseJimengAccountCreditBody(body: JsonValue): {
  credit: JimengAccountCredit
  creditsDetailKind: string | null
} {
  const envelope = parseJimengApiEnvelope(body, "account credit")
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_RESPONSE_DATA_MAP_CHANGED",
      message: "account credit response data was not an object map.",
      retryable: false,
      details: { operation: "account credit", data_kind: Array.isArray(envelope.data) ? "array" : typeof envelope.data },
    })
  }
  const data = parseJimengContract(UserCreditDataWireSchema, envelope.data, "account credit")
  if (!data.credit) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_RESPONSE_CREDIT_CHANGED",
      message: "account credit response did not include data.credit.",
      retryable: false,
      details: { operation: "account credit" },
    })
  }
  const giftCredit = numberValue(data.credit.gift_credit) ?? numberValue(data.credit.giftCredit)
  const purchaseCredit = numberValue(data.credit.purchase_credit) ?? numberValue(data.credit.purchaseCredit)
  const vipCredit = numberValue(data.credit.vip_credit) ?? numberValue(data.credit.vipCredit)
  if (giftCredit === undefined || purchaseCredit === undefined || vipCredit === undefined) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_RESPONSE_CREDIT_FIELDS_CHANGED",
      message: "account credit response missing gift/purchase/vip credit fields.",
      retryable: false,
      details: { operation: "account credit" },
    })
  }
  const creditsDetail = data.credits_detail ?? data.creditsDetail
  return {
    credit: {
      giftCredit,
      purchaseCredit,
      vipCredit,
      totalCredit: giftCredit + purchaseCredit + vipCredit,
    },
    creditsDetailKind: kindOf(creditsDetail),
  }
}

export function summarizeJimengAccountCredit(result: JimengAccountCreditResult): JsonObject {
  return {
    endpoint: result.endpoint,
    http_status: result.httpStatus,
    ret: result.ret,
    errmsg: result.errmsg,
    response_text_sha256: result.responseTextSha256,
    request: result.request,
    credit: {
      gift_credit: result.credit.giftCredit,
      purchase_credit: result.credit.purchaseCredit,
      vip_credit: result.credit.vipCredit,
      total_credit: result.credit.totalCredit,
    },
    credits_detail_kind: result.creditsDetailKind,
  }
}

export function buildJimengCommerceSignedHeaders(
  session: JimengSessionBundle,
  options: { endpoint: string; nowMs?: number; referer?: string },
): Record<string, string> {
  const deviceTime = Math.floor((options.nowMs ?? Date.now()) / 1000)
  const sign = createHash("md5")
    .update(`9e2c|${options.endpoint.slice(-7)}|${PLATFORM_CODE}|${APP_VERSION}|${deviceTime}||11ac`)
    .digest("hex")
  return {
    "content-type": "application/json",
    accept: "application/json, text/plain, */*",
    "user-agent": session.userAgent ?? "Mozilla/5.0",
    origin: "https://jimeng.jianying.com",
    referer: options.referer ?? session.referer ?? DEFAULT_REFERER,
    cookie: session.cookie,
    lan: "zh-Hans",
    pf: PLATFORM_CODE,
    loc: "cn",
    appid: "513695",
    appvr: APP_VERSION,
    "app-sdk-version": "48.0.0",
    "x-platform": "pc",
    "device-time": String(deviceTime),
    sign,
    "sign-ver": "1",
    tdid: "",
  }
}

function assertJimengSuccess(body: JsonValue, operation: string): void {
  const ret = retValue(body)
  if (ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_API_REJECTED",
    message: `${operation} failed (ret=${String(ret ?? "missing")}, errmsg=${errmsgValue(body) ?? "missing"})`,
    retryable: ret === 1014 || ret === "1014",
    details: { operation, ret: ret ?? null, errmsg: errmsgValue(body) ?? null },
  })
}

function retValue(body: JsonValue): string | number | null {
  return body && typeof body === "object" && !Array.isArray(body)
    && (typeof body.ret === "string" || typeof body.ret === "number")
    ? body.ret
    : null
}

function errmsgValue(body: JsonValue): string | null {
  return body && typeof body === "object" && !Array.isArray(body) && typeof body.errmsg === "string" ? body.errmsg : null
}

function numberValue(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function kindOf(value: unknown): string | null {
  if (value === undefined) return null
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

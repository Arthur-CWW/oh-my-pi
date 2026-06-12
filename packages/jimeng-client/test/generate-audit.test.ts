import { existsSync, mkdtempSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, test } from "bun:test"
import {
  buildJimengGenerateAuditPlan,
  compareJimengRequestPlanWithRawNetwork,
  createJimengHttpTransport,
  executeJimengGenerateAudit,
  JimengError,
  parseJimengGenerateAuditMaterialsJson,
  summarizeJimengGenerateAuditPlan,
  summarizeJimengGenerateAuditResult,
  validateJimengGenerateAuditRequest,
  type JsonObject,
} from "../src"

const session = {
  cookie: "sessionid=test",
  userAgent: "Mozilla/5.0 Test",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/generate/",
}

describe("Jimeng generate-audit dry-run plan", () => {
  test("builds the frontend material pre-audit request transform", () => {
    const materials = parseJimengGenerateAuditMaterialsJson([
      { type: "image", uri: "tos-cn-i-tb4s082cfz/persona.png", itemId: "image-item-1" },
      { type: "video", uri: "v03870g10004d8k1u4nog65hb08dnhig", itemId: 42 },
      { type: "audio", uri: "v0audio123" },
      { type: "subject", subjectDataId: "subject-data-1" },
    ])
    const plan = buildJimengGenerateAuditPlan({
      materials,
      extraRequest: {
        audit_scene: "ImageGenerate",
      },
    })

    expect(plan.endpoint).toBe("/mweb/v1/execute_generate_audit")
    expect(plan.method).toBe("POST")
    expect(plan.request).toEqual({
      audit_scene: "ImageGenerate",
      material_list: [
        { material_type: 1, uri: "tos-cn-i-tb4s082cfz/persona.png", item_id: "image-item-1" },
        { material_type: 2, vid: "v03870g10004d8k1u4nog65hb08dnhig", item_id: 42 },
        { material_type: 3, vid: "v0audio123" },
        { material_type: 4, subject_data_id: "subject-data-1" },
      ],
    })
    expect(summarizeJimengGenerateAuditPlan(plan)).toMatchObject({
      endpoint: "/mweb/v1/execute_generate_audit",
      material_count: 4,
      material_counts: { image: 1, video: 1, audio: 1, subject: 1 },
      material_types: [1, 2, 3, 4],
      live_submit: false,
    })
  })

  test("supports numeric material enum input and validates required paths", () => {
    const plan = buildJimengGenerateAuditPlan({
      materials: parseJimengGenerateAuditMaterialsJson([
        { type: 1, uri: "tos-cn-i-tb4s082cfz/reference.png" },
        { type: 4, subjectDataId: 123456789 },
      ]),
    })

    expect(() => validateJimengGenerateAuditRequest(plan.request)).not.toThrow()

    const broken = {
      material_list: [
        { material_type: 1 },
      ],
    } satisfies JsonObject
    expect(() => validateJimengGenerateAuditRequest(broken)).toThrow(JimengError)
  })

  test("rejects empty materials, missing per-type ids, and reserved extra body fields", () => {
    expect(() => buildJimengGenerateAuditPlan({ materials: [] })).toThrow("requires at least one material")
    expect(() => buildJimengGenerateAuditPlan({
      materials: parseJimengGenerateAuditMaterialsJson([{ type: "video", uri: " " }]),
    })).toThrow("video material uri is required")
    expect(() => buildJimengGenerateAuditPlan({
      materials: parseJimengGenerateAuditMaterialsJson([{ type: "subject" }]),
    })).toThrow("Subject audit material requires subjectDataId")
    expect(() => buildJimengGenerateAuditPlan({
      materials: parseJimengGenerateAuditMaterialsJson([{ type: "image", uri: "tos-cn-i/a.png" }]),
      extraRequest: { material_list: [] },
    })).toThrow("owns material_list")
  })

  test("matches a dry-run plan against passive raw-network capture with generic request-plan compare", () => {
    const plan = buildJimengGenerateAuditPlan({
      materials: parseJimengGenerateAuditMaterialsJson([
        { type: "image", uri: "tos-cn-i-tb4s082cfz/persona.png", itemId: "image-item-1" },
        { type: "subject", subjectDataId: "subject-data-1" },
      ]),
    })
    const result = compareJimengRequestPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify({
        command: "generate-audit-plan",
        endpoint: plan.endpoint,
        request: plan.request,
      }),
      rawNetworkText: jsonl(rawRequestEvent("audit-1", "/mweb/v1/execute_generate_audit", {
        ...plan.request,
        provider_added_optional_field: true,
      })),
    })

    expect(result.match).toBe(true)
    expect(result.plan_endpoint).toBe("/mweb/v1/execute_generate_audit")
    expect(result.plan_request_keys).toEqual(["material_list"])
    expect(result.candidates[0]?.request_match).toBe(true)
  })

  test("executes and summarizes audit responses through the typed client", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const result = await executeJimengGenerateAudit({
      fetch: mockFetch(JSON.stringify(generateAuditBody()), requests),
      session,
      audit: {
        materials: parseJimengGenerateAuditMaterialsJson([
          { type: "image", uri: "tos-cn-i-tb4s082cfz/persona.png", itemId: "image-item-1" },
          { type: "subject", subjectDataId: "subject-data-1" },
        ]),
        extraRequest: {
          audit_scene: "ImageGenerate",
        },
      },
    })

    expect(requests[0]?.url).toContain("/mweb/v1/execute_generate_audit")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      audit_scene: "ImageGenerate",
      material_list: [
        { material_type: 1, uri: "tos-cn-i-tb4s082cfz/persona.png", item_id: "image-item-1" },
        { material_type: 4, subject_data_id: "subject-data-1" },
      ],
    })
    expect(result.materialResults).toEqual([
      {
        materialType: 1,
        uri: "tos-cn-i-tb4s082cfz/persona.png",
        vid: null,
        itemId: "image-item-1",
        subjectDataId: null,
        status: null,
        auditStatus: "pass",
        rejectReason: null,
        keys: ["audit_status", "item_id", "material_type", "uri"],
      },
      {
        materialType: 4,
        uri: null,
        vid: null,
        itemId: null,
        subjectDataId: "subject-data-1",
        status: 1,
        auditStatus: null,
        rejectReason: null,
        keys: ["status", "subject_data_id"],
      },
    ])
    expect(summarizeJimengGenerateAuditResult(result)).toMatchObject({
      endpoint: "/mweb/v1/execute_generate_audit",
      ret: "0",
      material_result_count: 2,
    })
  })

  test("records and replays audit transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-generate-audit-cassette-"))
    const cassettePath = path.join(dir, "generate-audit.json")
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const recordTransport = createJimengHttpTransport({
      mode: "record",
      cassettePath,
      fetch: mockFetch(JSON.stringify(generateAuditBody()), requests),
      nowIso: () => "2026-06-12T00:00:00.000Z",
    })

    const audit = {
      materials: parseJimengGenerateAuditMaterialsJson([
        { type: "video", uri: "v03870g10004d8k1u4nog65hb08dnhig", itemId: "video-item-1" },
      ]),
    }
    const recorded = await executeJimengGenerateAudit({
      fetch: recordTransport.fetch,
      session,
      audit,
    })

    expect(recorded.materialResults).toHaveLength(2)
    expect(existsSync(cassettePath)).toBe(true)

    const replayTransport = createJimengHttpTransport({
      mode: "replay",
      cassettePath,
      fetch: failIfLiveFetch,
    })
    const replayed = await executeJimengGenerateAudit({
      fetch: replayTransport.fetch,
      session,
      audit,
    })

    expect(replayed.responseTextSha256).toBe(recorded.responseTextSha256)
    expect(replayed.materialResults).toEqual(recorded.materialResults)
  })

  test("rejects provider errors in audit responses", async () => {
    await expect(executeJimengGenerateAudit({
      fetch: mockFetch(JSON.stringify({ ret: 1000, errmsg: "invalid parameter" })),
      session,
      audit: {
        materials: parseJimengGenerateAuditMaterialsJson([
          { type: "audio", uri: "v0audio123" },
        ]),
      },
    })).rejects.toThrow("ret=1000")
  })
})

function rawRequestEvent(requestId: string, endpoint: string, submitBody: JsonObject) {
  return {
    kind: "cdpEvent",
    method: "Network.requestWillBeSent",
    params: {
      requestId,
      request: {
        url: `https://jimeng.jianying.com${endpoint}?aid=513695`,
        method: "POST",
        postData: JSON.stringify(submitBody),
      },
    },
  }
}

function jsonl(...events: object[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
}

function generateAuditBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      material_result_list: [
        {
          material_type: 1,
          uri: "tos-cn-i-tb4s082cfz/persona.png",
          item_id: "image-item-1",
          audit_status: "pass",
        },
        {
          subject_data_id: "subject-data-1",
          status: 1,
        },
      ],
      pass: true,
    },
  }
}

function mockFetch(body: string, requests: Array<{ url: string; init?: RequestInit }> = []) {
  return async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    return responseFromText(body)
  }
}

async function failIfLiveFetch(): Promise<never> {
  throw new Error("unexpected live fetch")
}

function responseFromText(body: string) {
  const bytes = new TextEncoder().encode(body)
  return {
    ok: true,
    status: 200,
    async text() {
      return body
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
  }
}

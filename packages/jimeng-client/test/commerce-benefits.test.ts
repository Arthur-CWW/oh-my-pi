import { createHash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengCommerceBenefitsRequest,
  createJimengHttpTransport,
  fetchJimengCommerceBenefits,
  JimengClient,
  JimengError,
  parseJimengCommerceBenefitEndpoints,
  parseJimengCommerceBenefitMetadataBody,
  parseJimengCommerceUserBenefitBody,
  readJimengHttpCassette,
  summarizeJimengCommerceBenefits,
  type JimengFetch,
  type JimengSessionBundle,
  type JsonObject,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng commerce benefits", () => {
  test("builds the frontend benefit query wire body", () => {
    expect(buildJimengCommerceBenefitsRequest()).toEqual({
      query_list: [
        { resource_type: "aigc", resource_id: "get_all", benefit_type_list: [] },
        { resource_type: "normal_func", resource_id: "get_all", benefit_type_list: [] },
      ],
    })
  })

  test("parses endpoint selector flags", () => {
    expect(parseJimengCommerceBenefitEndpoints(undefined)).toEqual(["metadata", "user-benefits"])
    expect(parseJimengCommerceBenefitEndpoints("metadata,user-benefits,metadata")).toEqual(["metadata", "user-benefits"])
    expect(() => parseJimengCommerceBenefitEndpoints("trade")).toThrow(JimengError)
  })

  test("parses and summarizes benefit metadata and user benefits", () => {
    const metadata = parseJimengCommerceBenefitMetadataBody(metadataBody())
    expect(metadata.metadataCount).toBe(2)
    expect(metadata.items[0]).toMatchObject({
      resourceType: "aigc",
      resourceId: "lip_sync",
      benefitTypes: ["lip_sync"],
      units: ["second"],
      useModes: ["use"],
    })

    const userBenefits = parseJimengCommerceUserBenefitBody(userBenefitsBody())
    expect(userBenefits).toMatchObject({
      totalCredits: 0,
      enablePreview: false,
      creditsDetailKind: "object",
      assetCount: 2,
    })
    expect(userBenefits.assets[0]).toMatchObject({
      resourceType: "aigc",
      resourceId: "generate_img",
      benefitType: "image_controlnet_pose",
      quotaAll: 0,
      quotaLeft: 0,
      payModes: ["UserCredit"],
      roles: ["all"],
    })

    const summary = summarizeJimengCommerceBenefits({
      requestedEndpoints: ["metadata", "user-benefits"],
      request: buildJimengCommerceBenefitsRequest(),
      metadata: {
        endpoint: "/commerce/v3/resource/benefit_metadata",
        httpStatus: 200,
        ret: "0",
        errmsg: "success",
        responseTextSha256: "metadata-hash",
        request: buildJimengCommerceBenefitsRequest(),
        body: metadataBody(),
        ...metadata,
      },
      userBenefits: {
        endpoint: "/commerce/v3/benefits/batch_get_user_benefit",
        httpStatus: 200,
        ret: "0",
        errmsg: "success",
        responseTextSha256: "benefits-hash",
        request: buildJimengCommerceBenefitsRequest(),
        body: userBenefitsBody(),
        ...userBenefits,
      },
    })

    expect(summary).toMatchObject({
      metadata: {
        metadata_count: 2,
        resource_ids: ["common_ai", "lip_sync"],
        benefit_types: ["common_ai_times", "lip_sync"],
      },
      user_benefits: {
        asset_count: 2,
        benefit_types: ["image_controlnet_canny", "image_controlnet_pose"],
        pay_modes: ["Subscribe", "UserCredit"],
      },
    })
    expect(JSON.stringify(summary)).not.toContain("sid=")
  })

  test("fetches signed metadata and user benefits", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(requests),
    })

    const result = await fetchJimengCommerceBenefits({
      client,
      session,
      nowMs: 1_771_234_567_000,
    })

    expect(requests.map((request) => request.url)).toEqual([
      "https://jimeng.jianying.com/commerce/v3/resource/benefit_metadata",
      "https://jimeng.jianying.com/commerce/v3/benefits/batch_get_user_benefit",
    ])
    for (const request of requests) {
      expect(JSON.parse(String(request.init?.body))).toEqual(buildJimengCommerceBenefitsRequest())
      const headers = request.init?.headers as Record<string, string>
      const endpoint = new URL(request.url).pathname
      expect(headers.sign).toBe(createHash("md5").update(`9e2c|${endpoint.slice(-7)}|7|8.4.0|1771234567||11ac`).digest("hex"))
    }
    expect(result.metadata?.metadataCount).toBe(2)
    expect(result.userBenefits?.assetCount).toBe(2)
  })

  test("records and replays commerce benefits through HTTP cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-commerce-benefits-cassette-"))
    const cassettePath = path.join(dir, "commerce-benefits.json")
    const requests: Array<{ url: string; init?: RequestInit }> = []
    try {
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        nowIso: () => "2026-06-11T00:00:00.000Z",
        fetch: mockFetch(requests),
      })

      await fetchJimengCommerceBenefits({
        fetch: recordTransport.fetch,
        session,
        nowMs: 1_771_234_567_000,
      })

      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(2)
      expect(requests.map((request) => request.url)).toEqual([
        "https://jimeng.jianying.com/commerce/v3/resource/benefit_metadata",
        "https://jimeng.jianying.com/commerce/v3/benefits/batch_get_user_benefit",
      ])

      const replayTransport = createJimengHttpTransport({ mode: "replay", cassettePath })
      const replayed = await fetchJimengCommerceBenefits({
        fetch: replayTransport.fetch,
        session,
        nowMs: 1_771_234_567_000,
      })
      const summary = summarizeJimengCommerceBenefits(replayed)

      expect(replayed.metadata?.metadataCount).toBe(2)
      expect(replayed.userBenefits?.assetCount).toBe(2)
      expect(JSON.stringify(summary)).not.toContain("sid=")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("fails loudly when required response paths disappear", () => {
    expect(() => parseJimengCommerceBenefitMetadataBody({
      ret: "0",
      errmsg: "success",
      data: { other_list: [] },
    })).toThrow(JimengError)

    expect(() => parseJimengCommerceUserBenefitBody({
      ret: "0",
      errmsg: "success",
      data: { total_credits: 0 },
    })).toThrow(JimengError)
  })
})

function metadataBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      metadata_list: [
        {
          resource_type: "aigc",
          resource_id: "lip_sync",
          benefits_pay_strategy: [
            { benefit_type: "lip_sync", benefit_id: 1, unit: "second", use_mode: "use" },
          ],
          extra_provider_field: true,
        },
        {
          resource_type: "normal_func",
          resource_id: "common_ai",
          benefits_pay_strategy: [
            { benefit_type: "common_ai_times", benefit_id: 2, unit: "count", use_mode: "use" },
          ],
          benefits_display_resource: [{ title: "Common AI" }],
        },
      ],
    },
  }
}

function userBenefitsBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      total_credits: 0,
      enable_preview: false,
      credits_detail: {},
      asset_list: [
        {
          resource_type: "aigc",
          resource_id: "generate_img",
          benefit_type: "image_controlnet_pose",
          benefit_item_id: 10,
          quota_all: 0,
          quota_left: 0,
          asset_details: [
            { pay_mode: "UserCredit", quota_all: 0, quota_left: 0, role: "all" },
          ],
        },
        {
          resource_type: "aigc",
          resource_id: "generate_img",
          benefit_type: "image_controlnet_canny",
          benefit_item_id: 11,
          quota_all: 5,
          quota_left: 2,
          asset_details: [
            { pay_mode: "Subscribe", quota_all: 5, quota_left: 2, role: "vip" },
          ],
        },
      ],
    },
  }
}

function mockFetch(requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    const body = url.includes("benefit_metadata") ? metadataBody() : userBenefitsBody()
    const text = JSON.stringify(body)
    return {
      ok: true,
      status: 200,
      text: async () => text,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    }
  }
}

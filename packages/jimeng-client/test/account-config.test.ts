import { describe, expect, test } from "bun:test"
import {
  buildJimengAccountConfigRequest,
  fetchJimengAccountConfig,
  JimengClient,
  JimengError,
  parseJimengAccountConfigEndpoints,
  summarizeJimengAccountConfig,
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

describe("Jimeng account config helpers", () => {
  test("parses endpoint flags and builds empty wire requests", () => {
    expect(parseJimengAccountConfigEndpoints(undefined)).toEqual(["settings", "ug-info", "invite-status"])
    expect(parseJimengAccountConfigEndpoints("ug-info,settings,ug-info")).toEqual(["ug-info", "settings"])
    expect(() => parseJimengAccountConfigEndpoints("panel")).toThrow("account-config --endpoints must be settings, ug-info, invite-status, or all")

    expect(buildJimengAccountConfigRequest("settings")).toEqual({})
    expect(buildJimengAccountConfigRequest("ug-info")).toEqual({})
    expect(buildJimengAccountConfigRequest("invite-status")).toEqual({})
  })

  test("fetches and summarizes settings, registration, and invite status", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify(settingsBody()),
        JSON.stringify(ugInfoBody()),
        JSON.stringify(inviteStatusBody()),
      ], requests),
    })

    const result = await fetchJimengAccountConfig({ client, session })
    const summary = summarizeJimengAccountConfig(result)

    expect(requests.map((request) => request.url)).toEqual([
      expect.stringContaining("/mweb/v1/get_settings"),
      expect.stringContaining("/mweb/v1/get_ug_info"),
      expect.stringContaining("/mweb/v1/get_invite_status"),
    ])
    expect(requests.map((request) => JSON.parse(String(request.init?.body)))).toEqual([{}, {}, {}])
    expect(summary).toMatchObject({
      endpoints: ["settings", "ug-info", "invite-status"],
      result_count: 3,
      results: [
        {
          endpoint_id: "settings",
          user_custom_settings: {
            aigc_compliance_confirmed: true,
            allow_remake: false,
            close_watermark: true,
            work_sharing_allowed: true,
            work_remix_permission: 2,
          },
          permission_setting_count: 2,
        },
        {
          endpoint_id: "ug-info",
          is_web_registered: true,
        },
        {
          endpoint_id: "invite-status",
          invite_status: 1,
        },
      ],
    })
    expect(JSON.stringify(summary)).not.toContain("https://signed.example.invalid")
  })

  test("rejects provider errors and required contract drift", async () => {
    const errorClient = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify({ ret: "1000", errmsg: "invalid parameter", data: {} }),
      ], []),
    })
    await expect(fetchJimengAccountConfig({
      client: errorClient,
      session,
      query: { endpoints: ["settings"] },
    })).rejects.toBeInstanceOf(JimengError)

    const driftClient = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify({ ret: "0", errmsg: "success", data: { user_custom_settings: { allow_remake: true } } }),
      ], []),
    })
    await expect(fetchJimengAccountConfig({
      client: driftClient,
      session,
      query: { endpoints: ["settings"] },
    })).rejects.toThrow("required fields")
  })
})

function settingsBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      user_custom_settings: {
        aigc_compliance_confirmed: true,
        allow_remake: false,
        close_watermark: true,
        work_sharing_allowed: true,
        work_remix_permission: 2,
        work_sequel_permission: 1,
        show_favorites: true,
        show_followers: false,
        show_following: true,
        show_likes: false,
        additive_provider_field: "ok",
      },
      settings_extra: {
        permission_settings: [
          { name: "download", link: "https://signed.example.invalid/a" },
          { name: "share" },
        ],
      },
    },
  }
}

function ugInfoBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      is_web_registered: true,
      additive_provider_field: "ok",
    },
  }
}

function inviteStatusBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      invite_status: 1,
      additive_provider_field: "ok",
    },
  }
}

function mockFetchSequence(bodies: string[], requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  let index = 0
  return async (url, init) => {
    requests.push({ url, init })
    const body = bodies[index] ?? bodies.at(-1) ?? "{}"
    index += 1
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } })
  }
}

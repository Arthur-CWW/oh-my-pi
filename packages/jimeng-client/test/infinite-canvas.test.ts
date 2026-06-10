import { describe, expect, test } from "bun:test"
import {
  buildJimengCanvasCustomRatiosRequest,
  buildJimengCanvasConversationListRequest,
  buildJimengCanvasProjectDetailRequest,
  buildJimengCanvasProjectListRequest,
  fetchJimengInfiniteCanvas,
  JimengClient,
  JimengError,
  parseJimengInfiniteCanvasEndpoints,
  summarizeJimengInfiniteCanvas,
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

describe("Jimeng infinite canvas read helpers", () => {
  test("parses endpoint flags and builds wire requests", () => {
    expect(parseJimengInfiniteCanvasEndpoints(undefined)).toEqual(["projects", "detail", "ratios", "conversations"])
    expect(parseJimengInfiniteCanvasEndpoints("ratios,projects,ratios")).toEqual(["ratios", "projects"])
    expect(() => parseJimengInfiniteCanvasEndpoints("conversation")).toThrow("infinite-canvas --endpoints must be projects, detail, ratios, conversations, or all")

    expect(buildJimengCanvasProjectListRequest({ cursor: 20, limit: 5, imageInfo: false, onlyFavorite: true })).toEqual({
      cursor: 20,
      limit: 5,
      imageInfo: false,
      onlyFavorite: true,
    })
    expect(buildJimengCanvasProjectDetailRequest({ projectId: "8544774599436", needDraftResource: true })).toEqual({
      project_id: "8544774599436",
      option: { need_draft_resource: true },
    })
    expect(buildJimengCanvasCustomRatiosRequest({ userId: "2033447352671660" })).toEqual({
      user_id: "2033447352671660",
    })
    expect(buildJimengCanvasConversationListRequest({ projectId: "8544774599436", offset: 10, limit: 5 })).toEqual({
      project_id: "8544774599436",
      offset: 10,
      count: 5,
    })
  })

  test("fetches projects, infers dependent ids, and summarizes without raw draft JSON", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify(projectListBody()),
        JSON.stringify(projectDetailBody()),
        JSON.stringify(customRatiosBody()),
        JSON.stringify(conversationListBody()),
      ], requests),
    })

    const result = await fetchJimengInfiniteCanvas({
      client,
      session,
      query: { endpoints: ["projects", "detail", "ratios", "conversations"], limit: 20 },
    })
    const summary = summarizeJimengInfiniteCanvas(result)

    expect(requests.map((request) => request.url)).toEqual([
      expect.stringContaining("/mweb/v1/infinite_canvas/list_project"),
      expect.stringContaining("/mweb/v1/infinite_canvas/project_detail"),
      expect.stringContaining("/mweb/v1/infinite_canvas/v1/get_canvas_custom_ratio"),
      expect.stringContaining("/mweb/v1/infinite_canvas/get_conversation_list"),
    ])
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      cursor: 0,
      limit: 20,
      imageInfo: true,
      onlyFavorite: false,
    })
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      project_id: "8544774599436",
      option: { need_draft_resource: false },
    })
    expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({
      user_id: "2033447352671660",
    })
    expect(JSON.parse(String(requests[3]?.init?.body))).toEqual({
      project_id: "8544774599436",
      offset: 0,
      count: 20,
    })
    expect(summary).toMatchObject({
      projects: {
        project_count: 1,
        has_more: false,
        items: [
          {
            id: "8544774599436",
            name: "未命名项目",
            creator_user_id_sha256: expect.any(String),
          },
        ],
      },
      detail: {
        mode: 1,
        project: {
          id: "8544774599436",
          draft: {
            draft_id: "8448339004172",
            latest_version: "1",
            draft_meta_version: "0.0.1",
            layer_count: 1,
            reference_count: 1,
            ai_generator_reference_count: 1,
          },
        },
      },
      ratios: {
        ratio_count: 1,
        items: [{ id: "ratio-1", name: "Tall", width: 1080, height: 1920 }],
      },
      conversations: {
        conversation_count: 1,
        items: [{ id: "conversation-1", title: "Storyboard", create_time_ms: 1771218000000, modify_time_ms: 1771219000000 }],
      },
    })
    const summaryText = JSON.stringify(summary)
    expect(summaryText).not.toContain("2033447352671660")
    expect(summaryText).not.toContain("\"layers\"")
    expect(summaryText).not.toContain("signed.example.invalid")
  })

  test("skips dependent endpoints when there is no project to infer from", async () => {
    const client = new JimengClient({
      fetch: mockFetchSequence([JSON.stringify(emptyProjectListBody())], []),
    })

    const result = await fetchJimengInfiniteCanvas({
      client,
      session,
      query: { endpoints: ["detail", "ratios", "conversations"] },
    })

    expect(result.results.map((item) => item.endpointId)).toEqual(["projects"])
    expect(result.skipped).toEqual([
      { endpoint: "detail", reason: "missing project id; project list returned no projects and --projectId was not supplied" },
      { endpoint: "ratios", reason: "missing user id; project list returned no creator_user_id and --userId was not supplied" },
      { endpoint: "conversations", reason: "missing project id; project list returned no projects and --projectId was not supplied" },
    ])
  })

  test("fails loudly when required project list path disappears", async () => {
    const client = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify({ ret: "0", errmsg: "success", data: { extra_new_field: true } }),
      ], []),
    })

    await expect(fetchJimengInfiniteCanvas({
      client,
      session,
      query: { endpoints: ["projects"] },
    })).rejects.toBeInstanceOf(JimengError)
  })
})

function projectListBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      projects: [
        {
          id: "8544774599436",
          creator_user_id: "2033447352671660",
          name: "未命名项目",
          create_time_ms: 1771217957000,
          modify_time_ms: 1771217957000,
          status: 1,
          is_favorite: false,
          cover_url: "https://signed.example.invalid/canvas-cover.png?x-signature=secret",
        },
      ],
      next_cursor: 20,
      has_more: false,
    },
  }
}

function emptyProjectListBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      projects: [],
      next_cursor: 0,
      has_more: false,
    },
  }
}

function projectDetailBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      project: {
        id: "8544774599436",
        creator_user_id: "2033447352671660",
        name: "未命名项目",
        draft: {
          draft_id: "8448339004172",
          latest_version: "1",
          draft: JSON.stringify({
            meta: { version: "0.0.1" },
            layers: [{ id: "layer-1", preview_url: "https://signed.example.invalid/layer.png?x-signature=secret" }],
            references: { "ref-1": {} },
            aiGeneratorReference: { "gen-1": {} },
          }),
        },
        create_time_ms: 1771217957000,
        modify_time_ms: 1771217957000,
        status: 1,
        is_favorite: false,
      },
      draft_resources: {
        images: { "image-1": { url: "https://signed.example.invalid/image.png?x-signature=secret" } },
      },
      mode: 1,
    },
  }
}

function customRatiosBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      custom_ratio_infos: [
        {
          ratio_id: "ratio-1",
          ratio_name: "Tall",
          width: "1080",
          height: "1920",
          ignored_new_field: true,
        },
      ],
    },
  }
}

function conversationListBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: [
      {
        conversation_id: "conversation-1",
        title: "Storyboard",
        create_time_ms: 1771218000000,
        update_time_ms: 1771219000000,
        provider_added_field: { keep: true },
      },
    ],
  }
}

function mockFetchSequence(texts: string[], requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url, init })
    const text = texts.shift()
    return new Response(text ?? "{}", { status: 200 })
  }
}

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengLocalItemsRequest,
  createJimengHttpTransport,
  fetchJimengLocalItems,
  JimengClient,
  JimengError,
  parseJimengLocalItemIds,
  readJimengHttpCassette,
  summarizeJimengLocalItems,
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

describe("Jimeng local item details", () => {
  test("parses ids and builds exact wire request shape", () => {
    expect(parseJimengLocalItemIds("7649332406457060634, 7649332406457077018,7649332406457060634"))
      .toEqual(["7649332406457060634", "7649332406457077018"])
    expect(parseJimengLocalItemIds(undefined)).toBeUndefined()
    expect(() => parseJimengLocalItemIds(",")).toThrow(JimengError)
    expect(buildJimengLocalItemsRequest(["7649332406457060634", "7649332406457077018"])).toEqual({
      item_id_list: ["7649332406457060634", "7649332406457077018"],
    })
  })

  test("fetches and summarizes current-account generated item details", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify(localItemsBody()), requests),
    })

    const result = await fetchJimengLocalItems({
      client,
      session,
      itemIds: ["7649332406457060634", "7649332406457077018"],
    })
    const summary = summarizeJimengLocalItems(result)

    expect(requests[0]?.url).toContain("/mweb/v1/get_local_item_list")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      item_id_list: ["7649332406457060634", "7649332406457077018"],
    })
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toMatchObject({
      id: "7649332406457060634",
      description: "K-beauty UGC creator reference image",
      prompt: "K-beauty UGC creator reference image",
      modelReqKey: "high_aes_general_v50",
      imageUri: "tos-cn-i-tb4s082cfz/image-1",
      imageWidth: 2048,
      imageHeight: 2048,
      coverUri: "tos-cn-i-tb4s082cfz/image-1",
    })
    expect(summary).toMatchObject({
      endpoint: "/mweb/v1/get_local_item_list",
      item_count: 2,
      items: [
        expect.objectContaining({
          id: "7649332406457060634",
          image_url_present: true,
          cover_url_present: true,
        }),
        expect.objectContaining({
          id: "7649332406457077018",
        }),
      ],
    })
    const summaryText = JSON.stringify(summary)
    expect(summaryText).not.toContain("signed.example.invalid")
    expect(summaryText).not.toContain("X-Amz-Signature")
  })

  test("can fetch through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-local-items-cassette-"))
    try {
      const cassettePath = path.join(dir, "local-items.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetch(JSON.stringify(localItemsBody()), requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })
      const itemIds = ["7649332406457060634", "7649332406457077018"]

      const recorded = await fetchJimengLocalItems({
        fetch: recordTransport.fetch,
        session,
        itemIds,
      })

      expect(recorded.items).toHaveLength(2)
      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(1)
      expect(requests).toHaveLength(1)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayed = await fetchJimengLocalItems({
        fetch: replayTransport.fetch,
        session,
        itemIds,
      })

      expect(summarizeJimengLocalItems(replayed)).toMatchObject({
        endpoint: "/mweb/v1/get_local_item_list",
        item_count: 2,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("rejects provider errors and required contract drift", async () => {
    const errorClient = new JimengClient({
      fetch: mockFetch(JSON.stringify({ ret: "3005", errmsg: "item not found", data: {} }), []),
    })
    await expect(fetchJimengLocalItems({
      client: errorClient,
      session,
      itemIds: ["missing-item"],
    })).rejects.toThrow("ret=3005")

    const driftClient = new JimengClient({
      fetch: mockFetch(JSON.stringify({ ret: "0", errmsg: "success", data: { rows: [] } }), []),
    })
    await expect(fetchJimengLocalItems({
      client: driftClient,
      session,
      itemIds: ["7649332406457060634"],
    })).rejects.toThrow("item_list fields")
  })
})

function mockFetch(responseText: string, requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url: String(url), init })
    return new Response(responseText, {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
}

function localItemsBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      item_list: [
        localItem("7649332406457060634", "tos-cn-i-tb4s082cfz/image-1"),
        localItem("7649332406457077018", "tos-cn-i-tb4s082cfz/image-2"),
      ],
      additive_provider_field: true,
    },
  }
}

function localItem(id: string, imageUri: string): JsonObject {
  return {
    common_attr: {
      id,
      effect_id: id,
      effect_type: 9,
      title: "",
      description: "K-beauty UGC creator reference image",
      cover_uri: imageUri,
      cover_url: "https://signed.example.invalid/cover.webp?X-Amz-Signature=secret",
      cover_width: 640,
      cover_height: 640,
      local_item_id: id,
      has_published: false,
      additive_provider_field: true,
    },
    image: {
      large_images: [{
        image_uri: imageUri,
        image_url: "https://signed.example.invalid/image.png?X-Amz-Signature=secret",
        width: 2048,
        height: 2048,
        format: "png",
      }],
    },
    aigc_image_params: {
      generate_type: 1,
      first_generate_type: 1,
      image_type: 9,
      text2image_params: {
        prompt: "K-beauty UGC creator reference image",
        model_config: {
          model_req_key: "high_aes_general_v50",
          model_name: "Image 5.0 Lite",
        },
      },
    },
    statistic: {
      favorite_num: 0,
      usage_num: 0,
    },
  }
}

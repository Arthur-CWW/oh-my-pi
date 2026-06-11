import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengWorkspaceByIdsRequest,
  buildJimengWorkspaceListRequest,
  createJimengHttpTransport,
  fetchJimengWorkspaceContext,
  JimengClient,
  JimengError,
  parseJimengWorkspaceContextEndpoints,
  readJimengHttpCassette,
  summarizeJimengWorkspaceContext,
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

describe("Jimeng workspace context helpers", () => {
  test("parses endpoint flags and builds wire requests", () => {
    expect(parseJimengWorkspaceContextEndpoints(undefined)).toEqual(["list", "get-by-ids"])
    expect(parseJimengWorkspaceContextEndpoints("get-by-ids,list,get-by-ids")).toEqual(["get-by-ids", "list"])
    expect(() => parseJimengWorkspaceContextEndpoints("detail")).toThrow("workspace-context --endpoints must be list, get-by-ids, or all")

    expect(buildJimengWorkspaceListRequest({ offset: 10, limit: 5 })).toEqual({
      offset: 10,
      limit: 5,
    })
    expect(buildJimengWorkspaceByIdsRequest(["14199856180236"])).toEqual({
      workspace_ids: ["14199856180236"],
    })
  })

  test("fetches list, infers ids for lookup, and redacts user ids in summary", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify(workspaceListBody()),
        JSON.stringify(workspaceByIdsBody()),
      ], requests),
    })

    const result = await fetchJimengWorkspaceContext({
      client,
      session,
      query: { endpoints: ["list", "get-by-ids"], limit: 20 },
    })
    const summary = summarizeJimengWorkspaceContext(result)

    expect(requests.map((request) => request.url)).toEqual([
      expect.stringContaining("/mweb/v1/workspace/list"),
      expect.stringContaining("/mweb/v1/workspace/get_by_ids"),
    ])
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      offset: 0,
      limit: 20,
    })
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      workspace_ids: ["14199856180236"],
    })
    expect(summary).toMatchObject({
      list: {
        workspace_count: 1,
        total: 1,
        has_more: false,
        items: [
          {
            id: "14199856180236",
            name: "UGC Studio",
            role: "owner",
            owner_user_id_sha256: expect.any(String),
          },
        ],
      },
      get_by_ids: {
        workspace_count: 1,
        request: {
          workspace_id_count: 1,
          workspace_ids_sha256: [expect.any(String)],
        },
      },
    })
    const summaryText = JSON.stringify(summary)
    expect(summaryText).not.toContain("2033447352671660")
    expect(summaryText).not.toContain("owner-user-1")
    expect(summaryText).not.toContain("https://signed.example.invalid")
  })

  test("can fetch inferred lookup through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-workspace-context-cassette-"))
    try {
      const cassettePath = path.join(dir, "workspace-context.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetchSequence([
          JSON.stringify(workspaceListBody()),
          JSON.stringify(workspaceByIdsBody()),
        ], requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })

      const recorded = await fetchJimengWorkspaceContext({
        fetch: recordTransport.fetch,
        session,
        query: { endpoints: ["list", "get-by-ids"], limit: 20 },
      })

      expect(recorded.results.map((item) => item.endpointId)).toEqual(["list", "get-by-ids"])
      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(2)
      expect(requests).toHaveLength(2)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayed = await fetchJimengWorkspaceContext({
        fetch: replayTransport.fetch,
        session,
        query: { endpoints: ["list", "get-by-ids"], limit: 20 },
      })

      expect(summarizeJimengWorkspaceContext(replayed)).toMatchObject({
        result_count: 2,
        list: { workspace_count: 1 },
        get_by_ids: { workspace_count: 1 },
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("uses supplied workspace ids without first listing", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetchSequence([JSON.stringify(workspaceByIdsBody())], requests),
    })

    const result = await fetchJimengWorkspaceContext({
      client,
      session,
      query: { endpoints: ["get-by-ids"], workspaceIds: ["14199856180236"] },
    })

    expect(result.results.map((item) => item.endpointId)).toEqual(["get-by-ids"])
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      workspace_ids: ["14199856180236"],
    })
  })

  test("skips get-by-ids when no ids can be inferred", async () => {
    const client = new JimengClient({
      fetch: mockFetchSequence([JSON.stringify(emptyWorkspaceListBody())], []),
    })

    const result = await fetchJimengWorkspaceContext({
      client,
      session,
      query: { endpoints: ["get-by-ids"] },
    })

    expect(result.results.map((item) => item.endpointId)).toEqual(["list"])
    expect(result.skipped).toEqual([
      { endpoint: "get-by-ids", reason: "missing workspace ids; workspace list returned no ids and --workspaceIds was not supplied" },
    ])
  })

  test("fails loudly when required list path disappears", async () => {
    const client = new JimengClient({
      fetch: mockFetchSequence([
        JSON.stringify({ ret: "0", errmsg: "success", data: { extra_new_field: true } }),
      ], []),
    })

    await expect(fetchJimengWorkspaceContext({
      client,
      session,
      query: { endpoints: ["list"] },
    })).rejects.toBeInstanceOf(JimengError)
  })
})

function workspaceListBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      workspaces: [
        {
          workspace_id: "14199856180236",
          name: "UGC Studio",
          description: "Local UGC workspace",
          role: "owner",
          owner_user_id: "owner-user-1",
          creator_user_id: "2033447352671660",
          user_id: "2033447352671660",
          member_count: 1,
          status: 1,
          workspace_type: 2,
          create_time_ms: 1771217957000,
          update_time_ms: 1771218957000,
          is_default: true,
          cover_url: "https://signed.example.invalid/workspace.png?x-signature=secret",
        },
      ],
      total: 1,
      has_more: false,
    },
  }
}

function workspaceByIdsBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      workspace_map: {
        "14199856180236": {
          workspace_id: "14199856180236",
          name: "UGC Studio",
          role: "owner",
          owner_user_id: "owner-user-1",
          member_count: 1,
          status: 1,
        },
      },
    },
  }
}

function emptyWorkspaceListBody(): JsonObject {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      workspaces: [],
      total: 0,
      has_more: false,
    },
  }
}

function mockFetchSequence(bodies: string[], requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  let index = 0
  return async (url, init) => {
    requests.push({ url, init })
    const body = bodies[index]
    index += 1
    if (body === undefined) throw new Error(`unexpected request ${url}`)
    return {
      ok: true,
      status: 200,
      async text() {
        return body
      },
      async arrayBuffer() {
        return new TextEncoder().encode(body).buffer
      },
    }
  }
}

import { describe, expect, test } from "bun:test"
import {
  JimengClient,
  JimengError,
  buildJimengAsyncTasksRequest,
  buildJimengStoryExportPlan,
  buildJimengStoryRecordsRequest,
  fetchJimengAsyncTasks,
  fetchJimengStoryRecords,
  parseJimengStoryIds,
  summarizeJimengAsyncTasks,
  summarizeJimengStoryExportPlan,
  summarizeJimengStoryRecords,
  type JimengFetch,
  type JimengSessionBundle,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng story archive helpers", () => {
  test("builds guarded story and async-task request bodies", () => {
    expect(parseJimengStoryIds("story-1, story-1, story-2")).toEqual(["story-1", "story-2"])
    expect(buildJimengStoryRecordsRequest(["story-1", "story-1", "story-2"])).toEqual({
      story_id_list: ["story-1", "story-2"],
    })
    expect(buildJimengAsyncTasksRequest(["task-1", "task-2", "task-1"])).toEqual({
      task_id_list: ["task-1", "task-2"],
    })
    expect(() => buildJimengStoryRecordsRequest([])).toThrow(JimengError)
    expect(() => buildJimengAsyncTasksRequest([])).toThrow(JimengError)
  })

  test("builds a dry-run story export task plan without submitting", () => {
    const plan = buildJimengStoryExportPlan({
      submitId: "submit-1",
      storyIds: ["story-1", "story-2"],
    })

    expect(plan).toEqual({
      endpoint: "/mweb/v1/submit_async_task",
      method: "POST",
      request: {
        type: "pack_story_mode",
        submit_id: "submit-1",
        payload: JSON.stringify({ story_id_list: ["story-1", "story-2"] }),
      },
      payloadObject: { story_id_list: ["story-1", "story-2"] },
    })
    expect(summarizeJimengStoryExportPlan(plan)).toMatchObject({
      endpoint: "/mweb/v1/submit_async_task",
      live_submit: false,
    })
  })

  test("fetches story records and redacts signed cover URLs from summary", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          story_map: {
            "story-1": {
              story_id: "story-1",
              draft_id: "draft-1",
              story_version: "draft-version-1",
              name: "K beauty archive",
              desc: "Routine reference set",
              cover: {
                image_uri: "tos-cn-i/story-cover",
                image_url: "https://signed.example.invalid/story.png?x-signature=secret",
                width: 720,
                height: 1280,
                format: "png",
              },
            },
          },
        },
      }), requests),
    })

    const result = await fetchJimengStoryRecords({ client, session, storyIds: ["story-1"] })
    const summary = summarizeJimengStoryRecords(result)

    expect(requests[0]?.url).toContain("/mweb/v1/mget_story")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ story_id_list: ["story-1"] })
    expect(result.stories[0]).toMatchObject({
      storyId: "story-1",
      draftId: "draft-1",
      name: "K beauty archive",
      coverWidth: 720,
      coverHeight: 1280,
    })
    expect(summary).toMatchObject({
      story_count: 1,
      stories: [expect.objectContaining({ cover_url_present: true })],
    })
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature")
  })

  test("fetches async export tasks and keeps download URLs out of summary", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const payload = {
      result: {
        downloadUrl: "https://signed.example.invalid/export.zip?x-signature=secret",
        missMaterialItem: [{ id: "missing-1" }],
      },
    }
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          task_map: {
            "task-1": {
              status: 50,
              payload: JSON.stringify(payload),
            },
          },
        },
      }), requests),
    })

    const result = await fetchJimengAsyncTasks({ client, session, taskIds: ["task-1"] })
    const summary = summarizeJimengAsyncTasks(result)

    expect(requests[0]?.url).toContain("/mweb/v1/mget_async_task")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ task_id_list: ["task-1"] })
    expect(result.tasks[0]).toMatchObject({
      taskId: "task-1",
      status: 50,
      downloadUrlPresent: true,
      missingMaterialCount: 1,
    })
    expect(summary).toMatchObject({
      task_count: 1,
      tasks: [expect.objectContaining({ download_url_present: true, missing_material_count: 1 })],
    })
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature")
  })
})

function mockFetch(text: string, requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url, init })
    return new Response(text, { status: 200 })
  }
}

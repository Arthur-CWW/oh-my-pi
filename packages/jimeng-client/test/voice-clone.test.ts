import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  createJimengHttpTransport,
  JimengClient,
  JimengCloneVoiceStatus,
  JimengError,
  buildJimengClonedVoiceDeleteRequest,
  buildJimengClonedVoiceUpdateRequest,
  buildJimengClonedVoicesRequest,
  buildJimengVoiceCloneSubmitRequest,
  buildJimengVoiceTaskQueryRequest,
  deleteJimengClonedVoice,
  fetchJimengClonedVoices,
  queryJimengVoiceTasks,
  readJimengHttpCassette,
  submitJimengVoiceClone,
  summarizeJimengClonedVoiceMutation,
  summarizeJimengClonedVoices,
  summarizeJimengVoiceCloneSubmit,
  summarizeJimengVoiceTaskQuery,
  updateJimengClonedVoice,
  validateJimengClonedVoiceDeleteRequest,
  validateJimengClonedVoiceUpdateRequest,
  validateJimengVoiceCloneSubmitRequest,
  validateJimengVoiceTaskQueryRequest,
  type JimengFetch,
  type JimengSessionBundle,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng voice clone helpers", () => {
  test("builds frontend-compatible cloned voice list requests", () => {
    expect(buildJimengClonedVoicesRequest()).toEqual({
      offset: 0,
      count: 50,
      effect_type: 218,
      filter_opt: { clone_voice_status: [1, 2] },
      pack_local_item_opt: { need_favorite_info: true },
    })
    expect(buildJimengClonedVoicesRequest({
      offset: 5,
      limit: 10,
      statuses: [JimengCloneVoiceStatus.Success, JimengCloneVoiceStatus.Success, JimengCloneVoiceStatus.Fail],
      needFavoriteInfo: false,
    })).toEqual({
      offset: 5,
      count: 10,
      effect_type: 218,
      filter_opt: { clone_voice_status: [2, 3] },
      pack_local_item_opt: { need_favorite_info: false },
    })
    expect(() => buildJimengClonedVoicesRequest({ offset: -1 })).toThrow(JimengError)
    expect(() => buildJimengClonedVoicesRequest({ limit: 101 })).toThrow(JimengError)
  })

  test("builds voice clone submit/query/update/delete requests", () => {
    expect(buildJimengVoiceCloneSubmitRequest({
      submitId: "submit-1",
      audio: {
        vid: "v03870g10004d8k1u4nog65hb08dnhig",
        audioUrl: "https://signed.example.invalid/audio.mp3?x-signature=secret",
        duration: 5,
        title: "reference.mp3",
      },
      name: "Kbeauty voice",
    })).toEqual({
      submit_id: "submit-1",
      scene: 1,
      voice_clone: {
        audio: {
          vid: "v03870g10004d8k1u4nog65hb08dnhig",
          audio_url: "https://signed.example.invalid/audio.mp3?x-signature=secret",
          duration: 5,
          title: "reference.mp3",
        },
        name: "Kbeauty voice",
      },
    })
    expect(buildJimengVoiceTaskQueryRequest({ taskIds: ["task-1", "task-1", "task-2"] })).toEqual({
      task_id_list: ["task-1", "task-2"],
    })
    expect(buildJimengClonedVoiceUpdateRequest({ voiceId: "voice-1", name: "Renamed voice" })).toEqual({
      local_item_id: "voice-1",
      name: "Renamed voice",
    })
    expect(buildJimengClonedVoiceDeleteRequest({ voiceId: "voice-1" })).toEqual({
      local_item_id: "voice-1",
    })
    expect(() => buildJimengVoiceCloneSubmitRequest({ audio: { vid: "" }, name: "Voice" })).toThrow(JimengError)
    expect(() => buildJimengVoiceTaskQueryRequest({ taskIds: [] })).toThrow(JimengError)
    expect(() => buildJimengClonedVoiceUpdateRequest({ voiceId: "voice-1", name: "" })).toThrow(JimengError)
  })

  test("requires observed voice clone audio metadata", () => {
    expect(() => buildJimengVoiceCloneSubmitRequest({
      submitId: "submit-missing-metadata",
      audio: { vid: "v0personaVoiceAudio", title: "persona-reference.wav" },
      name: "Kbeauty voice",
    })).toThrow(JimengError)
    expect(() => validateJimengVoiceCloneSubmitRequest({
      submit_id: "fixture-voice-submit",
      scene: 1,
      voice_clone: {
        audio: { vid: "v0personaVoiceAudio" },
        name: "packet disposable voice",
      },
    })).toThrow(JimengError)
  })

  test("validates observed voice clone dry-run request contracts", () => {
    const submitRequest = {
      submit_id: "fixture-voice-submit",
      scene: 1,
      voice_clone: {
        audio: {
          vid: "v0personaVoiceAudio",
          duration: 3,
          title: "persona-reference.wav",
        },
        name: "packet disposable voice",
      },
    }
    const queryRequest = { task_id_list: ["fixture-voice-task"] }

    expect(() => validateJimengVoiceCloneSubmitRequest(submitRequest)).not.toThrow()
    expect(() => validateJimengVoiceTaskQueryRequest(queryRequest)).not.toThrow()
    expect(() => validateJimengClonedVoiceUpdateRequest({ local_item_id: "voice-1", name: "renamed" })).not.toThrow()
    expect(() => validateJimengClonedVoiceDeleteRequest({ local_item_id: "voice-1" })).not.toThrow()
    expect(() => validateJimengVoiceCloneSubmitRequest({
      ...submitRequest,
      voice_clone: { audio: { vid: "" }, name: "packet disposable voice" },
    })).toThrow(JimengError)
    expect(() => validateJimengVoiceTaskQueryRequest({ task_id_list: [] })).toThrow(JimengError)
  })

  test("fetches cloned voices and summarizes without signed media URLs", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          has_more: false,
          next_offset: 0,
          item_list: [
            clonedVoiceItem({
              id: "voice-1",
              title: "Kbeauty voice",
              status: 2,
              failCode: null,
              isFavorite: true,
            }),
          ],
        },
      }), requests),
    })

    const result = await fetchJimengClonedVoices({
      client,
      session,
      query: { limit: 10, statuses: [JimengCloneVoiceStatus.Success] },
    })
    const summary = summarizeJimengClonedVoices(result)

    expect(requests[0]?.url).toContain("/mweb/v1/get_user_local_item_list")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      offset: 0,
      count: 10,
      effect_type: 218,
      filter_opt: { clone_voice_status: [2] },
      pack_local_item_opt: { need_favorite_info: true },
    })
    expect(result.voices).toEqual([
      {
        id: "voice-1",
        name: "Kbeauty voice",
        isFavorite: true,
        effectType: 218,
        itemPlatform: 2,
        status: 2,
        failCode: null,
      },
    ])
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).toContain("success")
  })

  test("submits voice clone through mocked endpoint", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          status: 20,
          fail_code: 0,
          voice_clone_result: {
            item: clonedVoiceItem({
              id: "voice-1",
              title: "Kbeauty voice",
              status: 2,
              failCode: null,
              isFavorite: false,
            }),
          },
        },
      }), requests),
    })

    const result = await submitJimengVoiceClone({
      client,
      session,
      voiceClone: {
        submitId: "submit-1",
        audio: { vid: "v03870g10004d8k1u4nog65hb08dnhig", duration: 5, title: "reference.mp3" },
        name: "Kbeauty voice",
      },
    })
    const summary = summarizeJimengVoiceCloneSubmit(result)

    expect(requests[0]?.url).toContain("/mweb/v1/voice/submit_task")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      submit_id: "submit-1",
      scene: 1,
      voice_clone: {
        audio: {
          vid: "v03870g10004d8k1u4nog65hb08dnhig",
          duration: 5,
          title: "reference.mp3",
        },
        name: "Kbeauty voice",
      },
    })
    expect(result.voice?.id).toBe("voice-1")
    expect(summary.voice).toMatchObject({ id: "voice-1", status_label: "success" })
  })

  test("queries voice tasks through mocked endpoint", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          task_list: [
            {
              task_id: "task-1",
              status: 20,
              voice_conversion_result: { task_id: "task-1", data: { audio: { vid: "audio-vid" } } },
            },
          ],
        },
      }), requests),
    })

    const result = await queryJimengVoiceTasks({ client, session, taskIds: ["task-1"] })
    const summary = summarizeJimengVoiceTaskQuery(result)

    expect(requests[0]?.url).toContain("/mweb/v1/voice/query_task")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ task_id_list: ["task-1"] })
    expect(summary).toMatchObject({
      task_count: 1,
      tasks: [{ task_id: "task-1", status: 20, has_voice_conversion_result: true }],
    })
  })

  test("updates and deletes cloned voices through mocked endpoints", async () => {
    const updateRequests: Array<{ url: string; init?: RequestInit }> = []
    const updateClient = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          item: clonedVoiceItem({
            id: "voice-1",
            title: "Renamed voice",
            status: 2,
            failCode: null,
            isFavorite: false,
          }),
        },
      }), updateRequests),
    })

    const update = await updateJimengClonedVoice({
      client: updateClient,
      session,
      voice: { voiceId: "voice-1", name: "Renamed voice" },
    })

    expect(updateRequests[0]?.url).toContain("/mweb/v1/voice/update")
    expect(JSON.parse(String(updateRequests[0]?.init?.body))).toEqual({ local_item_id: "voice-1", name: "Renamed voice" })
    expect(summarizeJimengClonedVoiceMutation(update).voice).toMatchObject({ id: "voice-1", name: "Renamed voice" })

    const deleteRequests: Array<{ url: string; init?: RequestInit }> = []
    const deleteClient = new JimengClient({
      fetch: mockFetch(JSON.stringify({ ret: "0", errmsg: "success", data: {} }), deleteRequests),
    })
    const deleted = await deleteJimengClonedVoice({ client: deleteClient, session, voiceId: "voice-1" })

    expect(deleteRequests[0]?.url).toContain("/mweb/v1/voice/delete")
    expect(JSON.parse(String(deleteRequests[0]?.init?.body))).toEqual({ local_item_id: "voice-1" })
    expect(summarizeJimengClonedVoiceMutation(deleted).ret).toBe("0")
  })

  test("can run voice clone APIs through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-voice-clone-cassette-"))
    try {
      const cassettePath = path.join(dir, "voice-clone.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetchSequence([
          JSON.stringify(clonedVoicesBody()),
          JSON.stringify(voiceCloneSubmitBody()),
          JSON.stringify(voiceTaskQueryBody()),
          JSON.stringify(voiceUpdateBody()),
          JSON.stringify({ ret: "0", errmsg: "success", data: {} }),
        ], requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })

      const voices = await fetchJimengClonedVoices({
        fetch: recordTransport.fetch,
        session,
        query: { limit: 10, statuses: [JimengCloneVoiceStatus.Success] },
      })
      const submitted = await submitJimengVoiceClone({
        fetch: recordTransport.fetch,
        session,
        voiceClone: {
          submitId: "submit-1",
          audio: { vid: "v03870g10004d8k1u4nog65hb08dnhig", duration: 5, title: "reference.mp3" },
          name: "Kbeauty voice",
        },
      })
      const queried = await queryJimengVoiceTasks({
        fetch: recordTransport.fetch,
        session,
        taskIds: ["task-1"],
      })
      const updated = await updateJimengClonedVoice({
        fetch: recordTransport.fetch,
        session,
        voice: { voiceId: "voice-1", name: "Renamed voice" },
      })
      const deleted = await deleteJimengClonedVoice({
        fetch: recordTransport.fetch,
        session,
        voiceId: "voice-1",
      })

      expect(voices.voices).toHaveLength(1)
      expect(submitted.voice?.id).toBe("voice-1")
      expect(queried.tasks).toHaveLength(1)
      expect(updated.voice?.name).toBe("Renamed voice")
      expect(deleted.ret).toBe("0")
      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(5)
      expect(requests).toHaveLength(5)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayedVoices = await fetchJimengClonedVoices({
        fetch: replayTransport.fetch,
        session,
        query: { limit: 10, statuses: [JimengCloneVoiceStatus.Success] },
      })
      const replayedSubmitted = await submitJimengVoiceClone({
        fetch: replayTransport.fetch,
        session,
        voiceClone: {
          submitId: "submit-1",
          audio: { vid: "v03870g10004d8k1u4nog65hb08dnhig", duration: 5, title: "reference.mp3" },
          name: "Kbeauty voice",
        },
      })
      const replayedQueried = await queryJimengVoiceTasks({
        fetch: replayTransport.fetch,
        session,
        taskIds: ["task-1"],
      })
      const replayedUpdated = await updateJimengClonedVoice({
        fetch: replayTransport.fetch,
        session,
        voice: { voiceId: "voice-1", name: "Renamed voice" },
      })
      const replayedDeleted = await deleteJimengClonedVoice({
        fetch: replayTransport.fetch,
        session,
        voiceId: "voice-1",
      })
      const summaries = [
        summarizeJimengClonedVoices(replayedVoices),
        summarizeJimengVoiceCloneSubmit(replayedSubmitted),
        summarizeJimengVoiceTaskQuery(replayedQueried),
        summarizeJimengClonedVoiceMutation(replayedUpdated),
        summarizeJimengClonedVoiceMutation(replayedDeleted),
      ]

      expect(summaries[0]).toMatchObject({ voice_count: 1 })
      expect(summaries[1]).toMatchObject({ voice: { id: "voice-1", status_label: "success" } })
      expect(summaries[2]).toMatchObject({ task_count: 1 })
      expect(summaries[3]).toMatchObject({ voice: { id: "voice-1", name: "Renamed voice" } })
      expect(summaries[4]).toMatchObject({ ret: "0" })
      expect(JSON.stringify(summaries)).not.toContain("signed.example.invalid")
      expect(JSON.stringify(summaries)).not.toContain("x-signature")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function clonedVoiceItem(input: {
  id: string
  title: string
  status: number
  failCode: number | null
  isFavorite: boolean
}): Record<string, unknown> {
  return {
    common_attr: {
      id: input.id,
      title: input.title,
      effect_type: 218,
    },
    extra: {
      is_favorite: input.isFavorite,
      audio_url: "https://signed.example.invalid/audio.mp3?x-signature=secret",
    },
    clone_voice_info: {
      status: input.status,
      fail_code: input.failCode,
    },
  }
}

function clonedVoicesBody() {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      has_more: false,
      next_offset: 0,
      item_list: [
        clonedVoiceItem({
          id: "voice-1",
          title: "Kbeauty voice",
          status: 2,
          failCode: null,
          isFavorite: true,
        }),
      ],
    },
  }
}

function voiceCloneSubmitBody() {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      status: 20,
      fail_code: 0,
      voice_clone_result: {
        item: clonedVoiceItem({
          id: "voice-1",
          title: "Kbeauty voice",
          status: 2,
          failCode: null,
          isFavorite: false,
        }),
      },
    },
  }
}

function voiceTaskQueryBody() {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      task_list: [
        {
          task_id: "task-1",
          status: 20,
          voice_conversion_result: { task_id: "task-1", data: { audio: { vid: "audio-vid" } } },
        },
      ],
    },
  }
}

function voiceUpdateBody() {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      item: clonedVoiceItem({
        id: "voice-1",
        title: "Renamed voice",
        status: 2,
        failCode: null,
        isFavorite: false,
      }),
    },
  }
}

function mockFetch(text: string, requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  return async (url, init) => {
    requests.push({ url, init })
    return new Response(text, { status: 200 })
  }
}

function mockFetchSequence(texts: string[], requests: Array<{ url: string; init?: RequestInit }>): JimengFetch {
  let index = 0
  return async (url, init) => {
    requests.push({ url, init })
    const text = texts[index]
    index += 1
    if (text === undefined) throw new Error(`unexpected request ${url}`)
    return new Response(text, { status: 200 })
  }
}

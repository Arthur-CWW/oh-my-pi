import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import {
  buildJimengSubjectDeleteRequest,
  buildJimengSubjectUpdateRequest,
  buildJimengSubjectVoiceRequest,
  buildJimengSubjectCreateRequest,
  buildJimengSubjectsRequest,
  createJimengSubject,
  createJimengHttpTransport,
  deleteJimengSubjects,
  fetchJimengImagesByUri,
  fetchJimengSubjects,
  generateJimengSubjectVoice,
  JimengClient,
  JimengError,
  readJimengHttpCassette,
  subjectImageReferenceFromUploadSummary,
  submitJimengImageAuditJob,
  summarizeJimengImageByUri,
  summarizeJimengSubjectCreate,
  summarizeJimengSubjectDelete,
  summarizeJimengSubjectUpdate,
  summarizeJimengSubjectVoice,
  summarizeJimengSubjects,
  updateJimengSubject,
  validateJimengSubjectVoiceRequest,
  type JimengFetch,
  type JimengImageUploadSummary,
  type JimengSessionBundle,
} from "../src"

const session: JimengSessionBundle = {
  cookie: "sid=test",
  userAgent: "UnitTest/1.0",
  origin: "https://jimeng.jianying.com",
  referer: "https://jimeng.jianying.com/ai-tool/home/",
}

describe("Jimeng subject/persona helpers", () => {
  test("builds and validates subject list requests", () => {
    expect(buildJimengSubjectsRequest()).toEqual({ cursor: 0, limit: 20 })
    expect(buildJimengSubjectsRequest({ cursor: 10, limit: 50 })).toEqual({ cursor: 10, limit: 50 })
    expect(buildJimengSubjectsRequest({
      cursor: 0,
      limit: 20,
      keyword: "  skincare  ",
      subjectIds: ["subject-1", "subject-1", "subject-2"],
      onlyFavorite: true,
      workspaceId: 14199856180236,
    })).toEqual({
      cursor: 0,
      limit: 20,
      keyword: "skincare",
      subject_id_list: ["subject-1", "subject-2"],
      only_favorite: true,
      workspace_id: 14199856180236,
    })
    expect(() => buildJimengSubjectsRequest({ cursor: -1 })).toThrow(JimengError)
    expect(() => buildJimengSubjectsRequest({ limit: 101 })).toThrow(JimengError)
  })

  test("builds and validates subject create requests", () => {
    expect(buildJimengSubjectCreateRequest({
      name: "K-beauty UGC",
      description: "Polished skincare creator",
      workspaceId: 14199856180236,
      mainImage: {
        imageUri: "tos-cn-i-tb4s082cfz/ref.png",
        imageUrl: "https://signed.example.invalid/ref.png?x-signature=secret",
        width: 1024,
        height: 1536,
      },
    })).toEqual({
      content: {
        name: "K-beauty UGC",
        description: "Polished skincare creator",
        main_image: {
          width: 1024,
          height: 1536,
          image_uri: "tos-cn-i-tb4s082cfz/ref.png",
          image_url: "https://signed.example.invalid/ref.png?x-signature=secret",
        },
      },
      workspace_id: 14199856180236,
    })
    expect(() => buildJimengSubjectCreateRequest({
      name: "",
      workspaceId: 1,
      mainImage: { imageUri: "tos-cn-i-tb4s082cfz/ref.png", width: 1, height: 1 },
    })).toThrow(JimengError)
    expect(() => buildJimengSubjectCreateRequest({
      name: "K-beauty UGC",
      workspaceId: 0,
      mainImage: { imageUri: "tos-cn-i-tb4s082cfz/ref.png", width: 1, height: 1 },
    })).toThrow(JimengError)
  })

  test("builds subject update, delete, and generate-voice requests", () => {
    expect(buildJimengSubjectUpdateRequest({
      subjectId: "subject-1",
      content: {
        name: "K-beauty tuned",
        description: "Updated persona note",
        mainImage: {
          imageUri: "tos-cn-i-tb4s082cfz/ref.png",
          width: 1024,
          height: 1536,
        },
      },
    })).toEqual({
      subject_id: "subject-1",
      content: {
        name: "K-beauty tuned",
        description: "Updated persona note",
        main_image: {
          width: 1024,
          height: 1536,
          image_uri: "tos-cn-i-tb4s082cfz/ref.png",
        },
      },
    })
    expect(buildJimengSubjectDeleteRequest({ subjectIds: ["subject-1"] })).toEqual({ subject_id: "subject-1" })
    expect(buildJimengSubjectDeleteRequest({ subjectIds: ["subject-1", "subject-2"] })).toEqual({ subject_id_list: ["subject-1", "subject-2"] })
    expect(buildJimengSubjectVoiceRequest({ imageUri: "tos-cn-i-tb4s082cfz/ref.png" })).toEqual({ image_uri: "tos-cn-i-tb4s082cfz/ref.png" })
    expect(() => buildJimengSubjectUpdateRequest({ subjectId: "", content: { name: "Persona" } })).toThrow(JimengError)
    expect(() => buildJimengSubjectUpdateRequest({ subjectId: "subject-1", content: {} })).toThrow(JimengError)
    expect(() => buildJimengSubjectDeleteRequest({ subjectIds: [] })).toThrow(JimengError)
  })

  test("validates observed subject voice dry-run request contract", () => {
    const request = { image_uri: "tos-cn-i-tb4s082cfz/kbeauty-host.png" }
    expect(() => validateJimengSubjectVoiceRequest(request)).not.toThrow()
    expect(() => validateJimengSubjectVoiceRequest({ image_uri: "" })).toThrow(JimengError)
  })

  test("submits image audit jobs before subject creation", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({ ret: "0", errmsg: "success" }), requests),
    })

    const result = await submitJimengImageAuditJob({
      client,
      session,
      imageUris: ["tos-cn-i-tb4s082cfz/ref.png"],
    })

    expect(requests[0]?.url).toContain("/mweb/v1/imagex/submit_audit_job")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ uri_list: ["tos-cn-i-tb4s082cfz/ref.png"] })
    expect(result.ret).toBe("0")
  })

  test("fetches image lookup metadata by provider URI", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        uri2image: {
          "tos-cn-i-tb4s082cfz/ref.png": {
            image_uri: "tos-cn-i-tb4s082cfz/ref.png",
            image_url: "https://signed.example.invalid/ref.png?x-signature=secret",
            width: 0,
            height: 0,
            format: "",
          },
        },
      }), requests),
    })

    const result = await fetchJimengImagesByUri({
      client,
      session: { ...session, cookie: `${session.cookie}; _tea_web_id=web-123` },
      imageUris: ["tos-cn-i-tb4s082cfz/ref.png"],
    })
    const summary = summarizeJimengImageByUri(result)

    expect(requests[0]?.url).toContain("/mweb/v1/get_image_by_uri")
    expect(requests[0]?.url).toContain("web_id=web-123")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ uris: ["tos-cn-i-tb4s082cfz/ref.png"] })
    expect(result.images[0]).toEqual({
      imageUri: "tos-cn-i-tb4s082cfz/ref.png",
      imageUrl: "https://signed.example.invalid/ref.png?x-signature=secret",
      width: null,
      height: null,
      format: null,
    })
    expect(JSON.stringify(summary)).toContain("image_url_present")
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
  })

  test("creates a subject and summarizes without signed media URLs", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          subject_id: "subject-1",
          data_id: "data-1",
          content: {
            name: "K-beauty UGC",
            description: "Polished skincare creator",
            main_image: {
              image_uri: "tos-cn-i-tb4s082cfz/ref.png",
              image_url: "https://signed.example.invalid/ref.png?x-signature=secret",
              width: 1024,
              height: 1536,
            },
          },
          subject_control: { status: 0, enabled: true },
          create_time: 1781049529864,
          update_time: 1781049529864,
          workspace_id: 14199856180236,
        },
      }), requests),
    })

    const result = await createJimengSubject({
      client,
      session,
      subject: {
        name: "K-beauty UGC",
        description: "Polished skincare creator",
        workspaceId: 14199856180236,
        mainImage: {
          imageUri: "tos-cn-i-tb4s082cfz/ref.png",
          imageUrl: "https://signed.example.invalid/ref.png?x-signature=secret",
          width: 1024,
          height: 1536,
        },
      },
    })
    const summary = summarizeJimengSubjectCreate(result)

    expect(requests[0]?.url).toContain("/mweb/v1/dreamina_subject/create")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      content: {
        name: "K-beauty UGC",
        description: "Polished skincare creator",
        main_image: {
          width: 1024,
          height: 1536,
          image_uri: "tos-cn-i-tb4s082cfz/ref.png",
          image_url: "https://signed.example.invalid/ref.png?x-signature=secret",
        },
      },
      workspace_id: 14199856180236,
    })
    expect(result.subjectId).toBe("subject-1")
    expect(result.dataId).toBe("data-1")
    expect(result.subject?.subjectId).toBe("subject-1")
    expect(result.subject?.name).toBe("K-beauty UGC")
    expect(JSON.stringify(summary)).toContain("image_url_present")
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature")
  })

  test("updates a subject and summarizes without signed media URLs", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          subject_id: "subject-1",
          content: {
            name: "K-beauty tuned",
            description: "Updated persona note",
            main_image: {
              image_uri: "tos-cn-i-tb4s082cfz/ref.png",
              image_url: "https://signed.example.invalid/ref.png?x-signature=secret",
              width: 1024,
              height: 1536,
            },
          },
          subject_control: { status: 0, editable: true },
        },
      }), requests),
    })

    const result = await updateJimengSubject({
      client,
      session,
      subject: {
        subjectId: "subject-1",
        content: {
          name: "K-beauty tuned",
          description: "Updated persona note",
          mainImage: {
            imageUri: "tos-cn-i-tb4s082cfz/ref.png",
            imageUrl: "https://signed.example.invalid/ref.png?x-signature=secret",
            width: 1024,
            height: 1536,
          },
        },
      },
    })
    const summary = summarizeJimengSubjectUpdate(result)

    expect(requests[0]?.url).toContain("/mweb/v1/dreamina_subject/update")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      subject_id: "subject-1",
      content: {
        name: "K-beauty tuned",
        description: "Updated persona note",
        main_image: {
          width: 1024,
          height: 1536,
          image_uri: "tos-cn-i-tb4s082cfz/ref.png",
          image_url: "https://signed.example.invalid/ref.png?x-signature=secret",
        },
      },
    })
    expect(result.subjectId).toBe("subject-1")
    expect(result.subject?.status).toBe(0)
    expect(JSON.stringify(summary)).toContain("image_url_present")
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature")
  })

  test("deletes subjects and normalizes delete summaries", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({ ret: "0", errmsg: "success", data: {} }), requests),
    })

    const result = await deleteJimengSubjects({
      client,
      session,
      subjectIds: ["subject-1", "subject-2"],
    })
    const summary = summarizeJimengSubjectDelete(result)

    expect(requests[0]?.url).toContain("/mweb/v1/dreamina_subject/delete")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ subject_id_list: ["subject-1", "subject-2"] })
    expect(result.deletedSubjectIds).toEqual(["subject-1", "subject-2"])
    expect(summary.deleted_subject_count).toBe(2)
  })

  test("plans subject voice generation and redacts signed audio URLs", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          audio_info: {
            vid: "voice-video-1",
            audio_url: "https://signed.example.invalid/audio.mp3?x-signature=secret",
            duration: 3.2,
            duration_ms: 3200,
          },
        },
      }), requests),
    })

    const result = await generateJimengSubjectVoice({
      client,
      session,
      imageUri: "tos-cn-i-tb4s082cfz/ref.png",
    })
    const summary = summarizeJimengSubjectVoice(result)

    expect(requests[0]?.url).toContain("/mweb/v1/dreamina_subject/generate_voice")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ image_uri: "tos-cn-i-tb4s082cfz/ref.png" })
    expect(result.audioInfo?.vid).toBe("voice-video-1")
    expect(summary.audio_info).toEqual({
      vid: "voice-video-1",
      audio_url_present: true,
      duration: 3.2,
      duration_ms: 3200,
    })
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature")
  })

  test("derives subject image references from ImageX upload summaries", () => {
    expect(subjectImageReferenceFromUploadSummary(imageUploadSummary(), "https://signed.example.invalid/ref.png")).toEqual({
      imageUri: "tos-cn-i-tb4s082cfz/ref.png",
      width: 1024,
      height: 1536,
      imageUrl: "https://signed.example.invalid/ref.png",
    })
    expect(() => subjectImageReferenceFromUploadSummary({
      ...imageUploadSummary(),
      pluginResults: [],
    })).toThrow(JimengError)
  })

  test("fetches saved subjects and normalizes durable persona fields", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: "0",
        errmsg: "success",
        data: {
          next_cursor: 20,
          has_more: true,
          data_list: [{
            subject_id: "subject-1",
            name: "K-beauty host",
            desc: "Polished skincare creator",
            status: 1,
            create_time: "1781000000",
            cover_image: {
              image_uri: "tos-cn-i-tb4s082cfz/cover.png",
              image_url: "https://signed.example.invalid/cover.png?X-Amz-Signature=secret",
            },
            image_list: [
              { image_uri: "tos-cn-i-tb4s082cfz/ref-1.png" },
              { image: { uri: "tos-cn-i-tb4s082cfz/ref-2.png" } },
            ],
            voice_list: [
              { id_info: { id: "voice-1" } },
              { tone_id: "voice-2" },
            ],
          }],
        },
      }), requests),
    })

    const result = await fetchJimengSubjects({
      client,
      session,
      query: { cursor: 0, limit: 20 },
    })

    expect(requests[0]?.url).toContain("/mweb/v1/dreamina_subject/get")
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({ cursor: 0, limit: 20 })
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe(20)
    expect(result.subjects).toEqual([{
      subjectId: "subject-1",
      name: "K-beauty host",
      description: "Polished skincare creator",
      status: 1,
      createTime: "1781000000",
      updateTime: null,
      coverImageUri: "tos-cn-i-tb4s082cfz/cover.png",
      coverImageUrl: "https://signed.example.invalid/cover.png?X-Amz-Signature=secret",
      imageUris: ["tos-cn-i-tb4s082cfz/ref-1.png", "tos-cn-i-tb4s082cfz/ref-2.png"],
      voiceIds: ["voice-1", "voice-2"],
    }])
  })

  test("summarizes subjects without signed media URLs", async () => {
    const client = new JimengClient({
      fetch: mockFetch(JSON.stringify({
        ret: 0,
        errmsg: "success",
        data: {
          next_cursor: 0,
          has_more: false,
          data_list: [{
            id: "subject-1",
            title: "Persona",
            coverImageUrl: "https://signed.example.invalid/cover.png?X-Amz-Signature=secret",
            coverImageUri: "tos-cn-i-tb4s082cfz/cover.png",
          }],
        },
      }), []),
    })

    const result = await fetchJimengSubjects({ client, session })
    const summary = summarizeJimengSubjects(result)

    expect(summary.subject_count).toBe(1)
    expect(JSON.stringify(summary)).toContain("cover_image_url_present")
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("X-Amz-Signature")
  })

  test("can run subject/persona APIs through recorded and replayed HTTP transport cassettes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jimeng-subjects-cassette-"))
    try {
      const cassettePath = path.join(dir, "subjects.json")
      const requests: Array<{ url: string; init?: RequestInit }> = []
      const recordTransport = createJimengHttpTransport({
        mode: "record",
        cassettePath,
        fetch: mockFetchSequence([
          JSON.stringify(subjectListBody()),
          JSON.stringify({ ret: "0", errmsg: "success" }),
          JSON.stringify(imageLookupBody()),
          JSON.stringify(subjectCreateBody()),
          JSON.stringify(subjectUpdateBody()),
          JSON.stringify({ ret: "0", errmsg: "success", data: {} }),
          JSON.stringify(subjectVoiceBody()),
        ], requests),
        nowIso: () => "2026-06-11T00:00:00.000Z",
      })
      const sessionWithWebId = { ...session, cookie: `${session.cookie}; _tea_web_id=web-123` }
      const mainImage = {
        imageUri: "tos-cn-i-tb4s082cfz/ref.png",
        imageUrl: "https://signed.example.invalid/ref.png?x-signature=secret",
        width: 1024,
        height: 1536,
      }

      const subjects = await fetchJimengSubjects({
        fetch: recordTransport.fetch,
        session,
        query: { cursor: 0, limit: 20 },
      })
      const audit = await submitJimengImageAuditJob({
        fetch: recordTransport.fetch,
        session,
        imageUris: [mainImage.imageUri],
      })
      const lookup = await fetchJimengImagesByUri({
        fetch: recordTransport.fetch,
        session: sessionWithWebId,
        imageUris: [mainImage.imageUri],
      })
      const created = await createJimengSubject({
        fetch: recordTransport.fetch,
        session,
        subject: {
          name: "K-beauty UGC",
          description: "Polished skincare creator",
          workspaceId: 14199856180236,
          mainImage,
        },
      })
      const updated = await updateJimengSubject({
        fetch: recordTransport.fetch,
        session,
        subject: {
          subjectId: "subject-1",
          content: {
            name: "K-beauty tuned",
            description: "Updated persona note",
            mainImage,
          },
        },
      })
      const deleted = await deleteJimengSubjects({
        fetch: recordTransport.fetch,
        session,
        subjectIds: ["subject-1"],
      })
      const voice = await generateJimengSubjectVoice({
        fetch: recordTransport.fetch,
        session,
        imageUri: mainImage.imageUri,
      })

      expect(subjects.subjects).toHaveLength(1)
      expect(audit.ret).toBe("0")
      expect(lookup.images).toHaveLength(1)
      expect(created.subjectId).toBe("subject-1")
      expect(updated.subjectId).toBe("subject-1")
      expect(deleted.deletedSubjectIds).toEqual(["subject-1"])
      expect(voice.audioInfo?.vid).toBe("voice-video-1")
      expect(readJimengHttpCassette(cassettePath).entries).toHaveLength(7)
      expect(requests).toHaveLength(7)

      const replayTransport = createJimengHttpTransport({
        mode: "replay",
        cassettePath,
      })
      const replayedSubjects = await fetchJimengSubjects({
        fetch: replayTransport.fetch,
        session,
        query: { cursor: 0, limit: 20 },
      })
      const replayedAudit = await submitJimengImageAuditJob({
        fetch: replayTransport.fetch,
        session,
        imageUris: [mainImage.imageUri],
      })
      const replayedLookup = await fetchJimengImagesByUri({
        fetch: replayTransport.fetch,
        session: sessionWithWebId,
        imageUris: [mainImage.imageUri],
      })
      const replayedCreated = await createJimengSubject({
        fetch: replayTransport.fetch,
        session,
        subject: {
          name: "K-beauty UGC",
          description: "Polished skincare creator",
          workspaceId: 14199856180236,
          mainImage,
        },
      })
      const replayedUpdated = await updateJimengSubject({
        fetch: replayTransport.fetch,
        session,
        subject: {
          subjectId: "subject-1",
          content: {
            name: "K-beauty tuned",
            description: "Updated persona note",
            mainImage,
          },
        },
      })
      const replayedDeleted = await deleteJimengSubjects({
        fetch: replayTransport.fetch,
        session,
        subjectIds: ["subject-1"],
      })
      const replayedVoice = await generateJimengSubjectVoice({
        fetch: replayTransport.fetch,
        session,
        imageUri: mainImage.imageUri,
      })
      const summaries = [
        summarizeJimengSubjects(replayedSubjects),
        summarizeJimengImageByUri(replayedLookup),
        summarizeJimengSubjectCreate(replayedCreated),
        summarizeJimengSubjectUpdate(replayedUpdated),
        summarizeJimengSubjectDelete(replayedDeleted),
        summarizeJimengSubjectVoice(replayedVoice),
      ]

      expect(replayedAudit.ret).toBe("0")
      expect(summaries[0]).toMatchObject({ subject_count: 1 })
      expect(summaries[2]).toMatchObject({ subject_id: "subject-1" })
      expect(summaries[4]).toMatchObject({ deleted_subject_count: 1 })
      expect(summaries[5]).toMatchObject({
        audio_info: {
          vid: "voice-video-1",
          audio_url_present: true,
        },
      })
      expect(JSON.stringify(summaries)).not.toContain("signed.example.invalid")
      expect(JSON.stringify(summaries)).not.toContain("x-signature")
      expect(JSON.stringify(summaries)).not.toContain("X-Amz-Signature")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function imageUploadSummary(): JimengImageUploadSummary {
  return {
    fileName: "ref.png",
    contentType: "image/png",
    bytes: 1234,
    serviceId: "tb4s082cfz",
    storeUri: "tos-cn-i-tb4s082cfz/ref.png",
    imageUris: ["tos-cn-i-tb4s082cfz/ref.png"],
    uploadStatus: 200,
    uploadCrc32: "abc123",
    pluginResults: [{
      imageUri: "tos-cn-i-tb4s082cfz/ref.png",
      imageWidth: 1024,
      imageHeight: 1536,
      imageFormat: "png",
      imageSize: 1234,
    }],
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

function subjectListBody() {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      next_cursor: 20,
      has_more: true,
      data_list: [{
        subject_id: "subject-1",
        name: "K-beauty host",
        desc: "Polished skincare creator",
        status: 1,
        create_time: "1781000000",
        cover_image: {
          image_uri: "tos-cn-i-tb4s082cfz/cover.png",
          image_url: "https://signed.example.invalid/cover.png?X-Amz-Signature=secret",
        },
        image_list: [{ image_uri: "tos-cn-i-tb4s082cfz/ref.png" }],
        voice_list: [{ tone_id: "voice-1" }],
      }],
    },
  }
}

function imageLookupBody() {
  return {
    ret: "0",
    errmsg: "success",
    uri2image: {
      "tos-cn-i-tb4s082cfz/ref.png": {
        image_uri: "tos-cn-i-tb4s082cfz/ref.png",
        image_url: "https://signed.example.invalid/ref.png?x-signature=secret",
        width: 1024,
        height: 1536,
        format: "png",
      },
    },
  }
}

function subjectCreateBody() {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      subject_id: "subject-1",
      data_id: "data-1",
      content: {
        name: "K-beauty UGC",
        description: "Polished skincare creator",
        main_image: {
          image_uri: "tos-cn-i-tb4s082cfz/ref.png",
          image_url: "https://signed.example.invalid/ref.png?x-signature=secret",
          width: 1024,
          height: 1536,
        },
      },
      subject_control: { status: 0, enabled: true },
      workspace_id: 14199856180236,
    },
  }
}

function subjectUpdateBody() {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      subject_id: "subject-1",
      content: {
        name: "K-beauty tuned",
        description: "Updated persona note",
        main_image: {
          image_uri: "tos-cn-i-tb4s082cfz/ref.png",
          image_url: "https://signed.example.invalid/ref.png?x-signature=secret",
          width: 1024,
          height: 1536,
        },
      },
      subject_control: { status: 0, editable: true },
    },
  }
}

function subjectVoiceBody() {
  return {
    ret: "0",
    errmsg: "success",
    data: {
      audio_info: {
        vid: "voice-video-1",
        audio_url: "https://signed.example.invalid/audio.mp3?x-signature=secret",
        duration: 3.2,
        duration_ms: 3200,
      },
    },
  }
}

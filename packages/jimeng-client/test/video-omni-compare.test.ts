import { describe, expect, test } from "bun:test"
import {
  buildJimengVideoOmniReferencePlan,
  compareJimengVideoOmniPlanWithCaptureTemplate,
  compareJimengVideoOmniPlanWithRawNetwork,
  parseJimengVideoOmniMaterialsJson,
  summarizeJimengVideoOmniCompare,
} from "../src"

describe("Jimeng omni-reference video capture compare", () => {
  test("matches an omni-reference dry-run plan against raw-network submit capture while ignoring generated ids", () => {
    const plan = buildOmniPlan()
    const capturedRequest = rewriteGeneratedIds(plan.request)
    const result = compareJimengVideoOmniPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify(planOutput(plan)),
      rawNetworkText: jsonl(rawRequestEvent("req-omni-1", capturedRequest)),
    })

    expect(result.match).toBe(true)
    expect(result.plan_model_req_key).toBe("dreamina_seedance_40_pro")
    expect(result.plan_material_count).toBe(2)
    expect(result.plan_meta_count).toBe(4)
    expect(result.candidates[0]?.endpoint_match).toBe(true)
    expect(result.candidates[0]?.model_req_key_match).toBe(true)
    expect(result.candidates[0]?.material_list_match).toBe(true)
    expect(result.candidates[0]?.meta_list_match).toBe(true)
    expect(result.candidates[0]?.metrics_match).toBe(true)
    expect(result.candidates[0]?.difference_count).toBe(0)
  })

  test("matches an omni-reference dry-run plan against a capture-template request", () => {
    const plan = buildOmniPlan()
    const captureTemplate = {
      entries: [
        {
          kind: "request",
          url: "https://jimeng.jianying.com/mweb/v1/aigc_draft/generate?aid=513695",
          postData: JSON.stringify(rewriteGeneratedIds(plan.request)),
        },
      ],
    }

    const result = compareJimengVideoOmniPlanWithCaptureTemplate({
      dryRunPlanText: JSON.stringify(planOutput(plan)),
      captureTemplateText: JSON.stringify(captureTemplate),
    })

    expect(result.match).toBe(true)
    expect(result.candidates[0]?.video_input_match).toBe(true)
    expect(result.candidates[0]?.video_task_extra_match).toBe(true)
  })

  test("reports omni material and meta drift without leaking provider refs", () => {
    const plan = buildOmniPlan({
      personaUri: "tos-cn-i-secret/persona.png",
      referenceVid: "v03870g10004secret",
    })
    const capturedRequest = mutateOmniDraft(plan.request, (draft) => {
      const component = objectArrayField(draft, "component_list")[0]!
      const abilities = objectField(component, "abilities")
      const genVideo = objectField(abilities, "gen_video")
      const params = objectField(genVideo, "text_to_video_params")
      const videoInput = objectArrayField(params, "video_gen_inputs")[0]!
      const unified = objectField(videoInput, "unified_edit_input")
      const materials = objectArrayField(unified, "material_list")
      objectField(materials[0]!, "image_info").image_uri = "https://signed.example.invalid/private-persona.png?x-signature=secret"
      objectField(materials[1]!, "video_info").duration = 9000
      objectField(objectArrayField(unified, "meta_list")[2]!, "material_ref").material_idx = 0
    })
    const result = compareJimengVideoOmniPlanWithRawNetwork({
      dryRunPlanText: JSON.stringify(planOutput(plan)),
      rawNetworkText: jsonl(rawRequestEvent("req-omni-1", capturedRequest)),
    })
    const summary = summarizeJimengVideoOmniCompare(result)
    const differencePaths = result.candidates[0]?.differences.map((difference) => difference.path) ?? []

    expect(result.match).toBe(false)
    expect(differencePaths).toContain("material_list.0.image_info.image_uri")
    expect(differencePaths).toContain("material_list.1.video_info.duration")
    expect(differencePaths).toContain("meta_list.2.material_ref.material_idx")
    expect(JSON.stringify(summary)).not.toContain("tos-cn-i-secret")
    expect(JSON.stringify(summary)).not.toContain("v03870g10004secret")
    expect(JSON.stringify(summary)).not.toContain("signed.example.invalid")
    expect(JSON.stringify(summary)).not.toContain("x-signature")
  })
})

function buildOmniPlan(input: { personaUri?: string, referenceVid?: string } = {}) {
  return buildJimengVideoOmniReferencePlan({
    prompt: "@image_file_1 as the new Korean beauty host, mimic the timing and hand motion from @video_file_1, swap the hook to a cushion foundation CTA",
    materials: parseJimengVideoOmniMaterialsJson([
      {
        type: "image",
        fieldName: "image_file_1",
        uri: input.personaUri ?? "tos-cn-i-tb4s082cfz/persona.png",
        width: 1080,
        height: 1920,
        format: "png",
      },
      {
        type: "video",
        fieldName: "video_file_1",
        vid: input.referenceVid ?? "v03870g10004d8k1u4nog65hb08dnhig",
        width: 1080,
        height: 1920,
        durationSec: 8,
      },
    ]),
    modelVersion: "jimeng-video-seedance-2.0",
    ratio: "9:16",
    durationSec: 8,
    fps: 24,
    seed: 20260611,
    submitId: "submit-omni-reference",
    nowMs: 1781073939000,
  })
}

function planOutput(plan: ReturnType<typeof buildJimengVideoOmniReferencePlan>) {
  return {
    command: "omni-video-plan",
    endpoint: plan.endpoint,
    method: plan.method,
    query: plan.query,
    request: plan.request,
    draft_content: plan.draftContent,
    metrics_extra: plan.metricsExtra,
    material_list: plan.materialList,
    meta_list: plan.metaList,
    live_submit: false,
  }
}

function rewriteGeneratedIds(request: object): object {
  const next = JSON.parse(JSON.stringify(request))
  next.submit_id = "captured-submit-id"
  const draft = JSON.parse(next.draft_content)
  rewriteIdFields(draft)
  next.draft_content = JSON.stringify(draft)
  return next
}

function rewriteIdFields(value: MutableJson): void {
  if (!value || typeof value !== "object") return
  if (Array.isArray(value)) {
    for (const item of value) rewriteIdFields(item)
    return
  }
  const record = value
  for (const key of Object.keys(record)) {
    if (key === "id" || key.endsWith("_id")) {
      record[key] = `captured-${key}`
      continue
    }
    const child = record[key]
    if (child !== undefined) rewriteIdFields(child)
  }
}

function mutateOmniDraft(request: object, mutate: (draft: MutableJsonObject) => void): object {
  const next = JSON.parse(JSON.stringify(request))
  const draft = JSON.parse(next.draft_content) as MutableJsonObject
  mutate(draft)
  next.draft_content = JSON.stringify(draft)
  return next
}

type MutableJsonObject = { [key: string]: MutableJson }
type MutableJson = MutableJsonObject | MutableJson[] | string | number | boolean | null

function objectField(object: MutableJsonObject, key: string): MutableJsonObject {
  const value = object[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Expected object field ${key}`)
  return value
}

function objectArrayField(object: MutableJsonObject, key: string): MutableJsonObject[] {
  const value = object[key]
  if (!Array.isArray(value)) throw new Error(`Expected array field ${key}`)
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Expected object item in ${key}`)
    return item
  })
}

function rawRequestEvent(requestId: string, submitBody: object) {
  return {
    kind: "cdpEvent",
    method: "Network.requestWillBeSent",
    params: {
      requestId,
      request: {
        url: "https://jimeng.jianying.com/mweb/v1/aigc_draft/generate?aid=513695",
        method: "POST",
        postData: JSON.stringify(submitBody),
      },
    },
  }
}

function jsonl(...events: object[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`
}

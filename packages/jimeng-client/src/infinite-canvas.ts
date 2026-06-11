import { createHash } from "node:crypto"
import { z } from "zod"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient, type JimengFetch } from "./client"
import { buildJimengEndpointProbeHeaders } from "./endpoint-probe"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { JimengJsonObjectSchema, parseJimengApiEnvelope, parseJimengContract, parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=CN&web_version=7.5.0&da_version=3.3.17"
const OptionalString = z.string().nullable().optional()
const OptionalNumber = z.number().nullable().optional()
const OptionalBoolean = z.boolean().nullable().optional()

const CanvasDraftWireSchema = z.object({
  draft_id: OptionalString,
  draftId: OptionalString,
  latest_version: OptionalString,
  latestVersion: OptionalString,
  draft: OptionalString,
}).passthrough()

const CanvasProjectWireSchema = z.object({
  id: OptionalString,
  creator_user_id: OptionalString,
  creatorUserId: OptionalString,
  name: OptionalString,
  draft: CanvasDraftWireSchema.nullable().optional(),
  create_time_ms: OptionalNumber,
  createTimeMs: OptionalNumber,
  modify_time_ms: OptionalNumber,
  modifyTimeMs: OptionalNumber,
  status: OptionalNumber,
  is_favorite: OptionalBoolean,
  isFavorite: OptionalBoolean,
}).passthrough()

const CanvasProjectListDataWireSchema = z.object({
  projects: z.array(CanvasProjectWireSchema).nullable().optional(),
  next_cursor: OptionalNumber,
  nextCursor: OptionalNumber,
  has_more: OptionalBoolean,
  hasMore: OptionalBoolean,
}).passthrough()

const CanvasProjectDetailDataWireSchema = z.object({
  project: CanvasProjectWireSchema.nullable().optional(),
  mode: OptionalNumber,
  draft_resources: JimengJsonObjectSchema.nullable().optional(),
  draftResources: JimengJsonObjectSchema.nullable().optional(),
}).passthrough()

const CustomRatioWireSchema = z.object({
  id: OptionalString,
  ratio_id: OptionalString,
  ratioId: OptionalString,
  ratio_name: OptionalString,
  ratioName: OptionalString,
  name: OptionalString,
  width: z.union([z.string(), z.number()]).nullable().optional(),
  height: z.union([z.string(), z.number()]).nullable().optional(),
}).passthrough()

const CustomRatioDataWireSchema = z.object({
  custom_ratio_infos: z.array(CustomRatioWireSchema).nullable().optional(),
  customRatioInfos: z.array(CustomRatioWireSchema).nullable().optional(),
}).passthrough()

const ConversationWireSchema = z.object({
  id: OptionalString,
  conversation_id: OptionalString,
  conversationId: OptionalString,
  title: OptionalString,
  name: OptionalString,
  create_time_ms: OptionalNumber,
  createTimeMs: OptionalNumber,
  modify_time_ms: OptionalNumber,
  modifyTimeMs: OptionalNumber,
  update_time_ms: OptionalNumber,
  updateTimeMs: OptionalNumber,
}).passthrough()

export type JimengInfiniteCanvasEndpoint = "projects" | "detail" | "ratios" | "conversations"

export interface JimengInfiniteCanvasQuery {
  endpoints?: JimengInfiniteCanvasEndpoint[]
  cursor?: number
  limit?: number
  offset?: number
  imageInfo?: boolean
  onlyFavorite?: boolean
  projectId?: string
  userId?: string
  needDraftResource?: boolean
}

export interface JimengCanvasDraftSummary {
  draftId: string | null
  latestVersion: string | null
  draftTextSha256: string | null
  draftMetaVersion: string | null
  layerCount: number | null
  referenceCount: number | null
  aiGeneratorReferenceCount: number | null
}

export interface JimengCanvasProject {
  id: string
  creatorUserId: string | null
  name: string | null
  status: number | null
  isFavorite: boolean | null
  createTimeMs: number | null
  modifyTimeMs: number | null
  draft: JimengCanvasDraftSummary | null
}

export interface JimengCanvasCustomRatio {
  id: string | null
  name: string | null
  width: number | null
  height: number | null
}

export interface JimengCanvasConversation {
  id: string | null
  title: string | null
  createTimeMs: number | null
  modifyTimeMs: number | null
}

export interface JimengInfiniteCanvasResult {
  endpoint: "/mweb/v1/infinite_canvas/list_project" | "/mweb/v1/infinite_canvas/project_detail" | "/mweb/v1/infinite_canvas/v1/get_canvas_custom_ratio" | "/mweb/v1/infinite_canvas/get_conversation_list"
  endpointId: JimengInfiniteCanvasEndpoint
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  body: JsonValue
  projects?: JimengCanvasProject[]
  project?: JimengCanvasProject | null
  mode?: number | null
  draftResourceKeys?: string[]
  hasMore?: boolean | null
  nextCursor?: number | null
  customRatios?: JimengCanvasCustomRatio[]
  conversations?: JimengCanvasConversation[]
}

export interface JimengInfiniteCanvasBundle {
  endpoints: JimengInfiniteCanvasEndpoint[]
  results: JimengInfiniteCanvasResult[]
  skipped: Array<{ endpoint: JimengInfiniteCanvasEndpoint; reason: string }>
}

export function parseJimengInfiniteCanvasEndpoints(value: string | undefined): JimengInfiniteCanvasEndpoint[] {
  if (!value || value === "all") return ["projects", "detail", "ratios", "conversations"]
  const values = value.split(",").map((part) => part.trim()).filter(Boolean)
  const allowed = new Set<JimengInfiniteCanvasEndpoint>(["projects", "detail", "ratios", "conversations"])
  const endpoints: JimengInfiniteCanvasEndpoint[] = []
  for (const endpoint of values) {
    if (!allowed.has(endpoint as JimengInfiniteCanvasEndpoint)) {
      throw jimengError({
        category: "validation",
        code: "INFINITE_CANVAS_ENDPOINT_INVALID",
        message: "infinite-canvas --endpoints must be projects, detail, ratios, conversations, or all.",
        retryable: false,
        details: { endpoint, allowed: Array.from(allowed) },
      })
    }
    endpoints.push(endpoint as JimengInfiniteCanvasEndpoint)
  }
  return Array.from(new Set(endpoints))
}

export function buildJimengCanvasProjectListRequest(query: JimengInfiniteCanvasQuery = {}): JsonObject {
  return {
    cursor: query.cursor ?? 0,
    limit: query.limit ?? 20,
    imageInfo: query.imageInfo ?? true,
    onlyFavorite: query.onlyFavorite ?? false,
  }
}

export function buildJimengCanvasProjectDetailRequest(query: JimengInfiniteCanvasQuery & { projectId: string }): JsonObject {
  return {
    project_id: query.projectId,
    option: {
      need_draft_resource: query.needDraftResource ?? false,
    },
  }
}

export function buildJimengCanvasCustomRatiosRequest(query: JimengInfiniteCanvasQuery & { userId: string }): JsonObject {
  return { user_id: query.userId }
}

export function buildJimengCanvasConversationListRequest(query: JimengInfiniteCanvasQuery & { projectId: string }): JsonObject {
  return {
    project_id: query.projectId,
    offset: query.offset ?? 0,
    count: query.limit ?? 20,
  }
}

export async function fetchJimengInfiniteCanvas(input: {
  client?: JimengClient
  fetch?: JimengFetch
  session: JimengSessionBundle
  query?: JimengInfiniteCanvasQuery
}): Promise<JimengInfiniteCanvasBundle> {
  const requestedEndpoints = input.query?.endpoints ?? parseJimengInfiniteCanvasEndpoints(undefined)
  const client = input.client ?? new JimengClient({ fetch: input.fetch })
  const results: JimengInfiniteCanvasResult[] = []
  const skipped: JimengInfiniteCanvasBundle["skipped"] = []
  const needProjectList = requestedEndpoints.includes("projects")
    || (requestedEndpoints.includes("detail") && !input.query?.projectId)
    || (requestedEndpoints.includes("ratios") && !input.query?.userId)
    || (requestedEndpoints.includes("conversations") && !input.query?.projectId)

  let projects: JimengCanvasProject[] = []
  if (needProjectList) {
    const result = await fetchCanvasProjects({ client, session: input.session, query: input.query })
    results.push(result)
    projects = result.projects ?? []
  }

  const projectId = input.query?.projectId ?? projects[0]?.id
  const userId = input.query?.userId ?? projects[0]?.creatorUserId ?? null

  if (requestedEndpoints.includes("detail")) {
    if (!projectId) {
      skipped.push({ endpoint: "detail", reason: "missing project id; project list returned no projects and --projectId was not supplied" })
    } else {
      results.push(await fetchCanvasProjectDetail({
        client,
        session: input.session,
        query: { ...input.query, projectId },
      }))
    }
  }

  if (requestedEndpoints.includes("ratios")) {
    if (!userId) {
      skipped.push({ endpoint: "ratios", reason: "missing user id; project list returned no creator_user_id and --userId was not supplied" })
    } else {
      results.push(await fetchCanvasCustomRatios({
        client,
        session: input.session,
        query: { ...input.query, userId },
      }))
    }
  }

  if (requestedEndpoints.includes("conversations")) {
    if (!projectId) {
      skipped.push({ endpoint: "conversations", reason: "missing project id; project list returned no projects and --projectId was not supplied" })
    } else {
      results.push(await fetchCanvasConversations({
        client,
        session: input.session,
        query: { ...input.query, projectId },
      }))
    }
  }

  return { endpoints: requestedEndpoints, results, skipped }
}

export function summarizeJimengInfiniteCanvas(bundle: JimengInfiniteCanvasBundle): JsonObject {
  const projects = bundle.results.find((result) => result.endpointId === "projects")
  const detail = bundle.results.find((result) => result.endpointId === "detail")
  const ratios = bundle.results.find((result) => result.endpointId === "ratios")
  const conversations = bundle.results.find((result) => result.endpointId === "conversations")
  return {
    endpoints: bundle.endpoints,
    result_count: bundle.results.length,
    skipped: bundle.skipped,
    projects: projects ? {
      http_status: projects.httpStatus,
      ret: projects.ret,
      errmsg: projects.errmsg,
      response_text_sha256: projects.responseTextSha256,
      request: projects.request,
      project_count: projects.projects?.length ?? 0,
      has_more: projects.hasMore ?? null,
      next_cursor: projects.nextCursor ?? null,
      items: (projects.projects ?? []).map(summarizeProject),
    } : null,
    detail: detail ? {
      http_status: detail.httpStatus,
      ret: detail.ret,
      errmsg: detail.errmsg,
      response_text_sha256: detail.responseTextSha256,
      request: detail.request,
      mode: detail.mode ?? null,
      draft_resource_keys: detail.draftResourceKeys ?? [],
      project: detail.project ? summarizeProject(detail.project) : null,
    } : null,
    ratios: ratios ? {
      http_status: ratios.httpStatus,
      ret: ratios.ret,
      errmsg: ratios.errmsg,
      response_text_sha256: ratios.responseTextSha256,
      request: {
        user_id_sha256: stringValue(ratios.request.user_id) ? sha256(stringValue(ratios.request.user_id)!) : null,
      },
      ratio_count: ratios.customRatios?.length ?? 0,
      items: (ratios.customRatios ?? []).map((ratio) => ({
        id: ratio.id,
        name: ratio.name,
        width: ratio.width,
        height: ratio.height,
      })),
    } : null,
    conversations: conversations ? {
      http_status: conversations.httpStatus,
      ret: conversations.ret,
      errmsg: conversations.errmsg,
      response_text_sha256: conversations.responseTextSha256,
      request: conversations.request,
      conversation_count: conversations.conversations?.length ?? 0,
      items: (conversations.conversations ?? []).map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        create_time_ms: conversation.createTimeMs,
        modify_time_ms: conversation.modifyTimeMs,
      })),
    } : null,
  }
}

async function fetchCanvasProjects(input: {
  client: JimengClient
  session: JimengSessionBundle
  query?: JimengInfiniteCanvasQuery
}): Promise<JimengInfiniteCanvasResult> {
  const request = buildJimengCanvasProjectListRequest(input.query)
  const response = await requestJimengCanvas({
    client: input.client,
    session: input.session,
    endpoint: "/mweb/v1/infinite_canvas/list_project",
    request,
  })
  const data = parseJimengContract(CanvasProjectListDataWireSchema, dataMap(response.body, "infinite canvas projects"), "infinite canvas projects")
  if (!data.projects) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_CANVAS_PROJECTS_MISSING",
      message: "infinite canvas project list response did not include data.projects.",
      retryable: false,
      details: { operation: "infinite canvas projects" },
    })
  }
  const projects = data.projects.map(parseProject).filter((project): project is JimengCanvasProject => !!project)
  return {
    endpoint: "/mweb/v1/infinite_canvas/list_project",
    endpointId: "projects",
    ...response,
    request,
    projects,
    hasMore: booleanValue(data.has_more) ?? booleanValue(data.hasMore),
    nextCursor: numberValue(data.next_cursor) ?? numberValue(data.nextCursor),
  }
}

async function fetchCanvasProjectDetail(input: {
  client: JimengClient
  session: JimengSessionBundle
  query: JimengInfiniteCanvasQuery & { projectId: string }
}): Promise<JimengInfiniteCanvasResult> {
  const request = buildJimengCanvasProjectDetailRequest(input.query)
  const response = await requestJimengCanvas({
    client: input.client,
    session: input.session,
    endpoint: "/mweb/v1/infinite_canvas/project_detail",
    request,
  })
  const data = parseJimengContract(CanvasProjectDetailDataWireSchema, dataMap(response.body, "infinite canvas project detail"), "infinite canvas project detail")
  if (!data.project) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_CANVAS_DETAIL_PROJECT_MISSING",
      message: "infinite canvas project detail response did not include data.project.",
      retryable: false,
      details: { operation: "infinite canvas project detail" },
    })
  }
  const draftResources = data.draft_resources ?? data.draftResources ?? {}
  return {
    endpoint: "/mweb/v1/infinite_canvas/project_detail",
    endpointId: "detail",
    ...response,
    request,
    project: parseProject(data.project),
    mode: numberValue(data.mode),
    draftResourceKeys: Object.keys(draftResources).sort(),
  }
}

async function fetchCanvasCustomRatios(input: {
  client: JimengClient
  session: JimengSessionBundle
  query: JimengInfiniteCanvasQuery & { userId: string }
}): Promise<JimengInfiniteCanvasResult> {
  const request = buildJimengCanvasCustomRatiosRequest(input.query)
  const response = await requestJimengCanvas({
    client: input.client,
    session: input.session,
    endpoint: "/mweb/v1/infinite_canvas/v1/get_canvas_custom_ratio",
    request,
  })
  const data = parseJimengContract(CustomRatioDataWireSchema, dataMap(response.body, "infinite canvas custom ratios"), "infinite canvas custom ratios")
  const customRatios = (data.custom_ratio_infos ?? data.customRatioInfos ?? []).map(parseCustomRatio)
  return {
    endpoint: "/mweb/v1/infinite_canvas/v1/get_canvas_custom_ratio",
    endpointId: "ratios",
    ...response,
    request,
    customRatios,
  }
}

async function fetchCanvasConversations(input: {
  client: JimengClient
  session: JimengSessionBundle
  query: JimengInfiniteCanvasQuery & { projectId: string }
}): Promise<JimengInfiniteCanvasResult> {
  const request = buildJimengCanvasConversationListRequest(input.query)
  const response = await requestJimengCanvas({
    client: input.client,
    session: input.session,
    endpoint: "/mweb/v1/infinite_canvas/get_conversation_list",
    request,
  })
  const data = parseConversationListData(response.body)
  return {
    endpoint: "/mweb/v1/infinite_canvas/get_conversation_list",
    endpointId: "conversations",
    ...response,
    request,
    conversations: data.map(parseConversation),
  }
}

async function requestJimengCanvas(input: {
  client: JimengClient
  session: JimengSessionBundle
  endpoint: JimengInfiniteCanvasResult["endpoint"]
  request: JsonObject
}): Promise<Omit<JimengInfiniteCanvasResult, "endpoint" | "endpointId" | "request">> {
  const response = await input.client.requestText(`https://jimeng.jianying.com${input.endpoint}?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildJimengEndpointProbeHeaders(input.session),
    body: JSON.stringify(input.request),
  })
  const body = parseJsonText(response.text, input.endpoint)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, input.endpoint)
  return {
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    body,
  }
}

function parseProject(project: z.infer<typeof CanvasProjectWireSchema>): JimengCanvasProject | null {
  const id = stringValue(project.id)
  if (!id) return null
  return {
    id,
    creatorUserId: stringValue(project.creator_user_id) ?? stringValue(project.creatorUserId),
    name: stringValue(project.name),
    status: numberValue(project.status),
    isFavorite: booleanValue(project.is_favorite) ?? booleanValue(project.isFavorite),
    createTimeMs: numberValue(project.create_time_ms) ?? numberValue(project.createTimeMs),
    modifyTimeMs: numberValue(project.modify_time_ms) ?? numberValue(project.modifyTimeMs),
    draft: project.draft ? parseDraft(project.draft) : null,
  }
}

function parseDraft(draft: z.infer<typeof CanvasDraftWireSchema>): JimengCanvasDraftSummary {
  const draftText = stringValue(draft.draft)
  const parsed = draftText ? safeParseDraft(draftText) : null
  const parsedRecord = asRecord(parsed)
  const references = asRecord(parsedRecord?.references)
  const generatorReferences = asRecord(parsedRecord?.aiGeneratorReference)
  const meta = asRecord(parsedRecord?.meta)
  return {
    draftId: stringValue(draft.draft_id) ?? stringValue(draft.draftId),
    latestVersion: stringValue(draft.latest_version) ?? stringValue(draft.latestVersion),
    draftTextSha256: draftText ? sha256(draftText) : null,
    draftMetaVersion: stringValue(meta?.version),
    layerCount: Array.isArray(parsedRecord?.layers) ? parsedRecord.layers.length : null,
    referenceCount: references ? Object.keys(references).length : null,
    aiGeneratorReferenceCount: generatorReferences ? Object.keys(generatorReferences).length : null,
  }
}

function parseCustomRatio(ratio: z.infer<typeof CustomRatioWireSchema>): JimengCanvasCustomRatio {
  return {
    id: stringValue(ratio.id) ?? stringValue(ratio.ratio_id) ?? stringValue(ratio.ratioId),
    name: stringValue(ratio.ratio_name) ?? stringValue(ratio.ratioName) ?? stringValue(ratio.name),
    width: numericValue(ratio.width),
    height: numericValue(ratio.height),
  }
}

function parseConversation(conversation: z.infer<typeof ConversationWireSchema>): JimengCanvasConversation {
  return {
    id: stringValue(conversation.conversation_id) ?? stringValue(conversation.conversationId) ?? stringValue(conversation.id),
    title: stringValue(conversation.title) ?? stringValue(conversation.name),
    createTimeMs: numberValue(conversation.create_time_ms) ?? numberValue(conversation.createTimeMs),
    modifyTimeMs: numberValue(conversation.modify_time_ms) ?? numberValue(conversation.modifyTimeMs) ?? numberValue(conversation.update_time_ms) ?? numberValue(conversation.updateTimeMs),
  }
}

function parseConversationListData(body: JsonValue): Array<z.infer<typeof ConversationWireSchema>> {
  const envelope = parseJimengApiEnvelope(body, "infinite canvas conversation list")
  if (!Array.isArray(envelope.data)) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_CANVAS_CONVERSATION_LIST_CHANGED",
      message: "infinite canvas conversation list response data was not an array.",
      retryable: false,
      details: { operation: "infinite canvas conversation list", data_kind: typeof envelope.data },
    })
  }
  return envelope.data.map((item) => parseJimengContract(ConversationWireSchema, item, "infinite canvas conversation list"))
}

function summarizeProject(project: JimengCanvasProject): JsonObject {
  return {
    id: project.id,
    creator_user_id_sha256: project.creatorUserId ? sha256(project.creatorUserId) : null,
    name: project.name,
    status: project.status,
    is_favorite: project.isFavorite,
    create_time_ms: project.createTimeMs,
    modify_time_ms: project.modifyTimeMs,
    draft: project.draft ? {
      draft_id: project.draft.draftId,
      latest_version: project.draft.latestVersion,
      draft_text_sha256: project.draft.draftTextSha256,
      draft_meta_version: project.draft.draftMetaVersion,
      layer_count: project.draft.layerCount,
      reference_count: project.draft.referenceCount,
      ai_generator_reference_count: project.draft.aiGeneratorReferenceCount,
    } : null,
  }
}

function dataMap(body: JsonValue, operation: string): JsonObject {
  const envelope = parseJimengApiEnvelope(body, operation)
  if (envelope.data && typeof envelope.data === "object" && !Array.isArray(envelope.data)) {
    return envelope.data
  }
  throw jimengError({
    category: "upstream",
    code: "JIMENG_RESPONSE_DATA_MAP_CHANGED",
    message: `${operation} response data was not an object map.`,
    retryable: false,
    details: { operation, data_kind: Array.isArray(envelope.data) ? "array" : typeof envelope.data },
  })
}

function assertJimengSuccess(body: JsonValue, operation: string): void {
  const ret = retValue(body)
  if (ret === "0" || ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_API_REJECTED",
    message: `${operation} failed (ret=${String(ret ?? "missing")}, errmsg=${errmsgValue(body) ?? "missing"})`,
    retryable: false,
    details: { operation, ret, errmsg: errmsgValue(body) },
  })
}

function safeParseDraft(text: string): JsonValue | null {
  try {
    return JSON.parse(text) as JsonValue
  } catch {
    return null
  }
}

function retValue(body: JsonValue): string | number | null {
  const value = asRecord(body)?.ret
  return typeof value === "string" || typeof value === "number" ? value : null
}

function errmsgValue(body: JsonValue): string | null {
  return stringValue(asRecord(body)?.errmsg)
}

function asRecord(value: JsonValue | undefined | null): JsonObject | null {
  return !!value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function numericValue(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function booleanValue(value: JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

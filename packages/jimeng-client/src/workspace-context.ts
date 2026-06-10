import { createHash } from "node:crypto"
import { z } from "zod"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { buildJimengEndpointProbeHeaders } from "./endpoint-probe"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import { parseJimengApiEnvelope, parseJimengContract, parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=CN&web_version=7.5.0&da_version=3.3.17"
const OptionalString = z.string().nullable().optional()
const OptionalNumber = z.number().nullable().optional()
const OptionalBoolean = z.boolean().nullable().optional()

const WorkspaceWireSchema = z.object({
  id: OptionalString,
  workspace_id: OptionalString,
  workspaceId: OptionalString,
  name: OptionalString,
  description: OptionalString,
  role: OptionalString,
  workspace_type: OptionalNumber,
  workspaceType: OptionalNumber,
  status: OptionalNumber,
  owner_user_id: OptionalString,
  ownerUserId: OptionalString,
  creator_user_id: OptionalString,
  creatorUserId: OptionalString,
  user_id: OptionalString,
  userId: OptionalString,
  member_count: OptionalNumber,
  memberCount: OptionalNumber,
  create_time_ms: OptionalNumber,
  createTimeMs: OptionalNumber,
  update_time_ms: OptionalNumber,
  updateTimeMs: OptionalNumber,
  modify_time_ms: OptionalNumber,
  modifyTimeMs: OptionalNumber,
  is_default: OptionalBoolean,
  isDefault: OptionalBoolean,
}).passthrough()

const WorkspaceListDataWireSchema = z.object({
  workspaces: z.array(WorkspaceWireSchema).nullable().optional(),
  workspace_list: z.array(WorkspaceWireSchema).nullable().optional(),
  workspaceList: z.array(WorkspaceWireSchema).nullable().optional(),
  list: z.array(WorkspaceWireSchema).nullable().optional(),
  total: OptionalNumber,
  has_more: OptionalBoolean,
  hasMore: OptionalBoolean,
}).passthrough()

const WorkspaceByIdsDataWireSchema = z.object({
  workspace_map: z.record(z.string(), WorkspaceWireSchema).nullable().optional(),
  workspaceMap: z.record(z.string(), WorkspaceWireSchema).nullable().optional(),
  workspaces: z.array(WorkspaceWireSchema).nullable().optional(),
  list: z.array(WorkspaceWireSchema).nullable().optional(),
}).passthrough()

export type JimengWorkspaceContextEndpoint = "list" | "get-by-ids"

export interface JimengWorkspaceContextQuery {
  endpoints?: JimengWorkspaceContextEndpoint[]
  offset?: number
  limit?: number
  workspaceIds?: string[]
}

export interface JimengWorkspaceContextWorkspace {
  id: string
  name: string | null
  description: string | null
  role: string | null
  workspaceType: number | null
  status: number | null
  ownerUserId: string | null
  creatorUserId: string | null
  userId: string | null
  memberCount: number | null
  createTimeMs: number | null
  updateTimeMs: number | null
  isDefault: boolean | null
}

export interface JimengWorkspaceContextResult {
  endpoint: "/mweb/v1/workspace/list" | "/mweb/v1/workspace/get_by_ids"
  endpointId: JimengWorkspaceContextEndpoint
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  body: JsonValue
  workspaces: JimengWorkspaceContextWorkspace[]
  total?: number | null
  hasMore?: boolean | null
}

export interface JimengWorkspaceContextBundle {
  endpoints: JimengWorkspaceContextEndpoint[]
  results: JimengWorkspaceContextResult[]
  skipped: Array<{ endpoint: JimengWorkspaceContextEndpoint; reason: string }>
}

export function parseJimengWorkspaceContextEndpoints(value: string | undefined): JimengWorkspaceContextEndpoint[] {
  if (!value || value === "all") return ["list", "get-by-ids"]
  const values = value.split(",").map((part) => part.trim()).filter(Boolean)
  const allowed = new Set<JimengWorkspaceContextEndpoint>(["list", "get-by-ids"])
  const endpoints: JimengWorkspaceContextEndpoint[] = []
  for (const endpoint of values) {
    if (!allowed.has(endpoint as JimengWorkspaceContextEndpoint)) {
      throw jimengError({
        category: "validation",
        code: "WORKSPACE_CONTEXT_ENDPOINT_INVALID",
        message: "workspace-context --endpoints must be list, get-by-ids, or all.",
        retryable: false,
        details: { endpoint, allowed: Array.from(allowed) },
      })
    }
    endpoints.push(endpoint as JimengWorkspaceContextEndpoint)
  }
  return Array.from(new Set(endpoints))
}

export function buildJimengWorkspaceListRequest(query: JimengWorkspaceContextQuery = {}): JsonObject {
  return {
    offset: query.offset ?? 0,
    limit: query.limit ?? 20,
  }
}

export function buildJimengWorkspaceByIdsRequest(workspaceIds: string[]): JsonObject {
  return { workspace_ids: workspaceIds }
}

export async function fetchJimengWorkspaceContext(input: {
  client?: JimengClient
  session: JimengSessionBundle
  query?: JimengWorkspaceContextQuery
}): Promise<JimengWorkspaceContextBundle> {
  const endpoints = input.query?.endpoints ?? parseJimengWorkspaceContextEndpoints(undefined)
  const client = input.client ?? new JimengClient()
  const results: JimengWorkspaceContextResult[] = []
  const skipped: JimengWorkspaceContextBundle["skipped"] = []
  const needList = endpoints.includes("list") || (endpoints.includes("get-by-ids") && !input.query?.workspaceIds?.length)

  let listedWorkspaces: JimengWorkspaceContextWorkspace[] = []
  if (needList) {
    const listResult = await fetchWorkspaceList({ client, session: input.session, query: input.query })
    results.push(listResult)
    listedWorkspaces = listResult.workspaces
  }

  if (endpoints.includes("get-by-ids")) {
    const workspaceIds = input.query?.workspaceIds?.length
      ? input.query.workspaceIds
      : listedWorkspaces.map((workspace) => workspace.id).filter(Boolean)
    if (workspaceIds.length === 0) {
      skipped.push({ endpoint: "get-by-ids", reason: "missing workspace ids; workspace list returned no ids and --workspaceIds was not supplied" })
    } else {
      results.push(await fetchWorkspaceByIds({ client, session: input.session, workspaceIds }))
    }
  }

  return { endpoints, results, skipped }
}

export function summarizeJimengWorkspaceContext(bundle: JimengWorkspaceContextBundle): JsonObject {
  const list = bundle.results.find((result) => result.endpointId === "list")
  const byIds = bundle.results.find((result) => result.endpointId === "get-by-ids")
  return {
    endpoints: bundle.endpoints,
    result_count: bundle.results.length,
    skipped: bundle.skipped,
    list: list ? {
      http_status: list.httpStatus,
      ret: list.ret,
      errmsg: list.errmsg,
      response_text_sha256: list.responseTextSha256,
      request: list.request,
      workspace_count: list.workspaces.length,
      total: list.total ?? null,
      has_more: list.hasMore ?? null,
      items: list.workspaces.map(summarizeWorkspace),
    } : null,
    get_by_ids: byIds ? {
      http_status: byIds.httpStatus,
      ret: byIds.ret,
      errmsg: byIds.errmsg,
      response_text_sha256: byIds.responseTextSha256,
      request: {
        workspace_id_count: Array.isArray(byIds.request.workspace_ids) ? byIds.request.workspace_ids.length : null,
        workspace_ids_sha256: Array.isArray(byIds.request.workspace_ids)
          ? byIds.request.workspace_ids.map((id) => typeof id === "string" ? sha256(id) : null)
          : [],
      },
      workspace_count: byIds.workspaces.length,
      items: byIds.workspaces.map(summarizeWorkspace),
    } : null,
  }
}

async function fetchWorkspaceList(input: {
  client: JimengClient
  session: JimengSessionBundle
  query?: JimengWorkspaceContextQuery
}): Promise<JimengWorkspaceContextResult> {
  const request = buildJimengWorkspaceListRequest(input.query)
  const response = await requestWorkspace({
    client: input.client,
    session: input.session,
    endpoint: "/mweb/v1/workspace/list",
    endpointId: "list",
    request,
  })
  const data = parseJimengContract(WorkspaceListDataWireSchema, dataMap(response.body, "workspace list"), "workspace list")
  const rawWorkspaces = data.workspaces ?? data.workspace_list ?? data.workspaceList ?? data.list
  if (!rawWorkspaces) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_WORKSPACE_LIST_MISSING",
      message: "workspace list response did not include data.workspaces.",
      retryable: false,
      details: { operation: "workspace list" },
    })
  }
  return {
    endpoint: "/mweb/v1/workspace/list",
    endpointId: "list",
    ...response,
    request,
    workspaces: rawWorkspaces.map(parseWorkspace).filter((workspace): workspace is JimengWorkspaceContextWorkspace => !!workspace),
    total: numberValue(data.total),
    hasMore: booleanValue(data.has_more) ?? booleanValue(data.hasMore),
  }
}

async function fetchWorkspaceByIds(input: {
  client: JimengClient
  session: JimengSessionBundle
  workspaceIds: string[]
}): Promise<JimengWorkspaceContextResult> {
  const request = buildJimengWorkspaceByIdsRequest(input.workspaceIds)
  const response = await requestWorkspace({
    client: input.client,
    session: input.session,
    endpoint: "/mweb/v1/workspace/get_by_ids",
    endpointId: "get-by-ids",
    request,
  })
  const data = parseJimengContract(WorkspaceByIdsDataWireSchema, dataMap(response.body, "workspace get by ids"), "workspace get by ids")
  const workspaceMap = data.workspace_map ?? data.workspaceMap
  const rawWorkspaces = workspaceMap ? Object.values(workspaceMap) : data.workspaces ?? data.list
  if (!rawWorkspaces) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_WORKSPACE_BY_IDS_MISSING",
      message: "workspace get-by-ids response did not include data.workspace_map.",
      retryable: false,
      details: { operation: "workspace get by ids" },
    })
  }
  return {
    endpoint: "/mweb/v1/workspace/get_by_ids",
    endpointId: "get-by-ids",
    ...response,
    request,
    workspaces: rawWorkspaces.map(parseWorkspace).filter((workspace): workspace is JimengWorkspaceContextWorkspace => !!workspace),
  }
}

async function requestWorkspace(input: {
  client: JimengClient
  session: JimengSessionBundle
  endpoint: JimengWorkspaceContextResult["endpoint"]
  endpointId: JimengWorkspaceContextEndpoint
  request: JsonObject
}): Promise<Omit<JimengWorkspaceContextResult, "endpoint" | "endpointId" | "request" | "workspaces">> {
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

function parseWorkspace(workspace: z.infer<typeof WorkspaceWireSchema>): JimengWorkspaceContextWorkspace | null {
  const id = stringValue(workspace.workspace_id) ?? stringValue(workspace.workspaceId) ?? stringValue(workspace.id)
  if (!id) return null
  return {
    id,
    name: stringValue(workspace.name),
    description: stringValue(workspace.description),
    role: stringValue(workspace.role),
    workspaceType: numberValue(workspace.workspace_type) ?? numberValue(workspace.workspaceType),
    status: numberValue(workspace.status),
    ownerUserId: stringValue(workspace.owner_user_id) ?? stringValue(workspace.ownerUserId),
    creatorUserId: stringValue(workspace.creator_user_id) ?? stringValue(workspace.creatorUserId),
    userId: stringValue(workspace.user_id) ?? stringValue(workspace.userId),
    memberCount: numberValue(workspace.member_count) ?? numberValue(workspace.memberCount),
    createTimeMs: numberValue(workspace.create_time_ms) ?? numberValue(workspace.createTimeMs),
    updateTimeMs: numberValue(workspace.update_time_ms) ?? numberValue(workspace.updateTimeMs) ?? numberValue(workspace.modify_time_ms) ?? numberValue(workspace.modifyTimeMs),
    isDefault: booleanValue(workspace.is_default) ?? booleanValue(workspace.isDefault),
  }
}

function summarizeWorkspace(workspace: JimengWorkspaceContextWorkspace): JsonObject {
  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    role: workspace.role,
    workspace_type: workspace.workspaceType,
    status: workspace.status,
    owner_user_id_sha256: workspace.ownerUserId ? sha256(workspace.ownerUserId) : null,
    creator_user_id_sha256: workspace.creatorUserId ? sha256(workspace.creatorUserId) : null,
    user_id_sha256: workspace.userId ? sha256(workspace.userId) : null,
    member_count: workspace.memberCount,
    create_time_ms: workspace.createTimeMs,
    update_time_ms: workspace.updateTimeMs,
    is_default: workspace.isDefault,
  }
}

function assertJimengSuccess(body: JsonValue, operation: string): void {
  const envelope = parseJimengApiEnvelope(body, operation)
  if (envelope.ret === undefined || envelope.ret === null || envelope.ret === "0" || envelope.ret === 0) return
  throw jimengError({
    category: "upstream",
    code: "JIMENG_RESPONSE_RET_NONZERO",
    message: `${operation} returned ret=${String(envelope.ret)} errmsg=${envelope.errmsg ?? "unknown"}.`,
    retryable: false,
    details: { ret: envelope.ret, errmsg: envelope.errmsg ?? null },
  })
}

function dataMap(body: JsonValue, operation: string): JsonObject {
  const envelope = parseJimengApiEnvelope(body, operation)
  if (envelope.data && typeof envelope.data === "object" && !Array.isArray(envelope.data)) return envelope.data
  throw jimengError({
    category: "upstream",
    code: "JIMENG_RESPONSE_DATA_MAP_CHANGED",
    message: `${operation} response data was not an object map.`,
    retryable: false,
    details: { operation, data_kind: Array.isArray(envelope.data) ? "array" : typeof envelope.data },
  })
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function retValue(body: JsonValue): string | number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const ret = body.ret
  return typeof ret === "string" || typeof ret === "number" ? ret : null
}

function errmsgValue(body: JsonValue): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  return typeof body.errmsg === "string" ? body.errmsg : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

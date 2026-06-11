import { createHash } from "node:crypto"
import { Schema } from "effect"
import { type JimengSessionBundle } from "./capture"
import { assertNoRiskError, JimengClient } from "./client"
import { buildJimengEndpointProbeHeaders } from "./endpoint-probe"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"
import {
  JimengResearchItemWireSchema,
  normalizeJimengResearchItem,
  summarizeJimengResearchItem,
  type JimengResearchSearchItem,
} from "./research-search"
import { parseJimengApiEnvelope, parseJsonText } from "./schema"

const DEFAULT_QUERY = "aid=513695&device_platform=web&region=CN&web_version=7.5.0&da_version=3.3.17"
const OptionalString = Schema.optional(Schema.NullOr(Schema.String))
const OptionalNumber = Schema.optional(Schema.NullOr(Schema.Number))
const OptionalBoolean = Schema.optional(Schema.NullOr(Schema.Boolean))
const OptionalId = Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number])))

const ProfileUserWireSchema = Schema.Struct({
  name: Schema.String,
  avatar_url: OptionalString,
  uid: Schema.Union([Schema.String, Schema.Number]),
  sec_uid: Schema.String,
  description: OptionalString,
  total_materials_usage: OptionalNumber,
  total_materials_favorite: OptionalNumber,
  total_materials_like: OptionalNumber,
  editor_pick_count: OptionalNumber,
  follow: OptionalNumber,
  fans: OptionalNumber,
  has_followed: OptionalBoolean,
  followed_req_uid: OptionalBoolean,
  status: OptionalNumber,
  is_block: OptionalBoolean,
  is_blocked: OptionalBoolean,
  show_followers: OptionalBoolean,
  show_following: OptionalBoolean,
  show_likes: OptionalBoolean,
  show_favorites: OptionalBoolean,
})

const ProfileItemListWireSchema = Schema.Struct({
  item_list: Schema.Array(JimengResearchItemWireSchema),
  has_more: Schema.Boolean,
  next_offset: Schema.Number,
  total_count: OptionalNumber,
})

const ProfileFollowListWireSchema = Schema.Struct({
  user_list: Schema.Array(ProfileUserWireSchema),
  has_more: Schema.Boolean,
  next_offset: Schema.Number,
})

const ProfileStoryCoverWireSchema = Schema.Struct({
  image_uri: OptionalString,
  image_url: OptionalString,
  uri: OptionalString,
  url: OptionalString,
  width: OptionalNumber,
  height: OptionalNumber,
  format: OptionalString,
})

const ProfileStoryWireSchema = Schema.Struct({
  draft_id: OptionalId,
  draftId: OptionalId,
  story_id: OptionalId,
  storyId: OptionalId,
  id: OptionalId,
  name: OptionalString,
  desc: OptionalString,
  description: OptionalString,
  cover: Schema.optional(Schema.NullOr(ProfileStoryCoverWireSchema)),
  story_version: OptionalId,
  storyVersion: OptionalId,
  create_at: OptionalNumber,
  createAt: OptionalNumber,
  create_time: OptionalNumber,
  modify_at: OptionalNumber,
  modifyAt: OptionalNumber,
  update_time: OptionalNumber,
  has_favored: OptionalBoolean,
  hasFavored: OptionalBoolean,
})

const ProfileStoryListWireSchema = Schema.Struct({
  story_list: Schema.Array(ProfileStoryWireSchema),
  has_more: Schema.Boolean,
  next_offset: Schema.Number,
})

type ProfileUserWire = Schema.Schema.Type<typeof ProfileUserWireSchema>
type ProfileStoryWire = Schema.Schema.Type<typeof ProfileStoryWireSchema>

export type JimengProfileResearchEndpoint =
  | "profile"
  | "homepage"
  | "favorites"
  | "stories"
  | "following"
  | "followers"
  | "item"

export interface JimengProfileResearchQuery {
  endpoints?: JimengProfileResearchEndpoint[]
  secUid?: string
  publishedItemId?: string
  count?: number
  offset?: number
  imageTypeList?: number[]
  feedRefer?: string
}

export interface JimengProfileResearchProfile {
  name: string
  uid: string | null
  uidWasUnsafeNumber: boolean
  secUid: string
  description: string | null
  avatarUrl: string | null
  totalMaterialsUsage: number | null
  totalMaterialsFavorite: number | null
  totalMaterialsLike: number | null
  editorPickCount: number | null
  followingCount: number | null
  followerCount: number | null
  hasFollowed: boolean | null
  status: number | null
  isBlock: boolean | null
  isBlocked: boolean | null
  showFollowers: boolean | null
  showFollowing: boolean | null
  showLikes: boolean | null
  showFavorites: boolean | null
}

export interface JimengProfileResearchStory {
  storyId: string | null
  storyIdWasUnsafeNumber: boolean
  draftId: string | null
  draftIdWasUnsafeNumber: boolean
  name: string | null
  description: string | null
  storyVersion: string | null
  storyVersionWasUnsafeNumber: boolean
  createAt: number | null
  modifyAt: number | null
  hasFavored: boolean | null
  coverUri: string | null
  coverUrl: string | null
  coverWidth: number | null
  coverHeight: number | null
  coverFormat: string | null
}

export interface JimengProfileResearchResult {
  endpoint: string
  endpointId: JimengProfileResearchEndpoint
  scope: "public-profile" | "current-account"
  httpStatus: number
  ret: string | number | null
  errmsg: string | null
  responseTextSha256: string
  request: JsonObject
  body: JsonValue
  profile: JimengProfileResearchProfile | null
  profiles: JimengProfileResearchProfile[]
  items: JimengResearchSearchItem[]
  stories: JimengProfileResearchStory[]
  hasMore: boolean | null
  nextOffset: number | null
  totalCount: number | null
}

export interface JimengProfileResearchBundle {
  endpoints: JimengProfileResearchEndpoint[]
  results: JimengProfileResearchResult[]
  skipped: Array<{ endpoint: JimengProfileResearchEndpoint; reason: string }>
}

export function parseJimengProfileResearchEndpoints(value: string | undefined): JimengProfileResearchEndpoint[] {
  if (!value) return ["profile", "homepage", "favorites", "stories"]
  if (value === "all") return ["profile", "homepage", "favorites", "stories", "following", "followers", "item"]
  const allowed = new Set<JimengProfileResearchEndpoint>([
    "profile",
    "homepage",
    "favorites",
    "stories",
    "following",
    "followers",
    "item",
  ])
  const endpoints: JimengProfileResearchEndpoint[] = []
  for (const raw of value.split(",")) {
    const endpoint = raw.trim()
    if (!endpoint) continue
    if (!allowed.has(endpoint as JimengProfileResearchEndpoint)) {
      throw jimengError({
        category: "validation",
        code: "PROFILE_RESEARCH_ENDPOINT_INVALID",
        message: "profile-research --endpoints must use profile, homepage, favorites, stories, following, followers, item, or all.",
        retryable: false,
        details: { endpoint, allowed: Array.from(allowed) },
      })
    }
    endpoints.push(endpoint as JimengProfileResearchEndpoint)
  }
  if (endpoints.length === 0) {
    throw jimengError({
      category: "validation",
      code: "PROFILE_RESEARCH_ENDPOINT_INVALID",
      message: "profile-research --endpoints must include at least one endpoint.",
      retryable: false,
    })
  }
  return Array.from(new Set(endpoints))
}

export function parseJimengProfileImageTypeList(value: string | undefined): number[] | undefined {
  if (!value) return undefined
  const values = value.split(",").map((part) => Number(part.trim()))
  if (values.length === 0 || values.some((item) => !Number.isInteger(item) || item < 0)) {
    throw jimengError({
      category: "validation",
      code: "PROFILE_RESEARCH_IMAGE_TYPE_INVALID",
      message: "profile-research --imageTypeList must be comma-separated non-negative integers.",
      retryable: false,
      details: { value },
    })
  }
  return Array.from(new Set(values))
}

export function buildJimengProfileUserRequest(secUid: string): JsonObject {
  return { sec_uid: requireText(secUid, "--secUid") }
}

export function buildJimengProfileHomepageRequest(query: JimengProfileResearchQuery): JsonObject {
  return {
    sec_uid: requireText(query.secUid, "--secUid"),
    image_info: {},
    count: normalizeCount(query.count),
    feed_refer: query.feedRefer?.trim() || "feed_enterauto",
    image_type_list: normalizeImageTypeList(query.imageTypeList),
    offset: normalizeOffset(query.offset),
  }
}

export function buildJimengProfileFavoritesRequest(query: JimengProfileResearchQuery): JsonObject {
  return {
    sec_uid: requireText(query.secUid, "--secUid"),
    image_info: {},
    count: normalizeCount(query.count),
    image_type_list: normalizeImageTypeList(query.imageTypeList),
    offset: normalizeOffset(query.offset),
  }
}

export function buildJimengProfileStoriesRequest(query: JimengProfileResearchQuery): JsonObject {
  return {
    sec_uid: requireText(query.secUid, "--secUid"),
    count: normalizeCount(query.count),
    offset: normalizeOffset(query.offset),
  }
}

export function buildJimengProfileFollowRequest(
  endpoint: "following" | "followers",
  query: JimengProfileResearchQuery,
): JsonObject {
  return {
    list_type: endpoint === "following" ? 1 : 2,
    count: normalizeCount(query.count),
    offset: normalizeOffset(query.offset),
  }
}

export function buildJimengProfileItemRequest(publishedItemId: string): JsonObject {
  return { published_item_id: requireText(publishedItemId, "--publishedItemId") }
}

export async function fetchJimengProfileResearch(input: {
  client?: JimengClient
  session: JimengSessionBundle
  query?: JimengProfileResearchQuery
}): Promise<JimengProfileResearchBundle> {
  const query = input.query ?? {}
  const endpoints = query.endpoints ?? parseJimengProfileResearchEndpoints(undefined)
  const client = input.client ?? new JimengClient()
  const results: JimengProfileResearchResult[] = []
  const skipped: JimengProfileResearchBundle["skipped"] = []

  for (const endpoint of endpoints) {
    if (
      (endpoint === "profile" || endpoint === "homepage" || endpoint === "favorites" || endpoint === "stories")
      && !query.secUid?.trim()
    ) {
      throw validationError(`${endpoint} requires --secUid`, { endpoint })
    }
    if (endpoint === "item" && !query.publishedItemId?.trim()) {
      skipped.push({ endpoint, reason: "missing --publishedItemId" })
      continue
    }
    results.push(await fetchProfileEndpoint({ client, session: input.session, endpoint, query }))
  }

  return { endpoints, results, skipped }
}

export function summarizeJimengProfileResearch(bundle: JimengProfileResearchBundle): JsonObject {
  return {
    endpoints: bundle.endpoints,
    result_count: bundle.results.length,
    skipped: bundle.skipped,
    results: bundle.results.map((result) => ({
      endpoint: result.endpoint,
      endpoint_id: result.endpointId,
      scope: result.scope,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      profile: result.profile ? summarizeProfile(result.profile) : null,
      profile_count: result.profiles.length,
      profiles: result.profiles.map(summarizeProfile),
      item_count: result.items.length,
      items: result.items.map(summarizeJimengResearchItem),
      story_count: result.stories.length,
      stories: result.stories.map(summarizeStory),
      has_more: result.hasMore,
      next_offset: result.nextOffset,
      total_count: result.totalCount,
    })),
  }
}

async function fetchProfileEndpoint(input: {
  client: JimengClient
  session: JimengSessionBundle
  endpoint: JimengProfileResearchEndpoint
  query: JimengProfileResearchQuery
}): Promise<JimengProfileResearchResult> {
  const endpointPath = endpointPathFor(input.endpoint)
  const request = requestFor(input.endpoint, input.query)
  const response = await input.client.requestText(`https://jimeng.jianying.com${endpointPath}?${DEFAULT_QUERY}`, {
    method: "POST",
    headers: buildJimengEndpointProbeHeaders(input.session),
    body: JSON.stringify(request),
  })
  const body = parseJsonText(response.text, endpointPath)
  assertNoRiskError(body, response.text)
  assertJimengSuccess(body, endpointPath)
  const data = dataMap(body, endpointPath)
  const common = {
    endpoint: endpointPath,
    endpointId: input.endpoint,
    scope: input.endpoint === "following" || input.endpoint === "followers"
      ? "current-account" as const
      : "public-profile" as const,
    httpStatus: response.status,
    ret: retValue(body),
    errmsg: errmsgValue(body),
    responseTextSha256: sha256(response.text),
    request,
    body,
  }

  if (input.endpoint === "profile") {
    const profile = normalizeProfile(decodeContract(ProfileUserWireSchema, data, endpointPath))
    return {
      ...common,
      profile,
      profiles: [],
      items: [],
      stories: [],
      hasMore: null,
      nextOffset: null,
      totalCount: null,
    }
  }

  if (input.endpoint === "following" || input.endpoint === "followers") {
    const decoded = decodeContract(ProfileFollowListWireSchema, data, endpointPath)
    return {
      ...common,
      profile: null,
      profiles: decoded.user_list.map(normalizeProfile),
      items: [],
      stories: [],
      hasMore: decoded.has_more,
      nextOffset: decoded.next_offset,
      totalCount: null,
    }
  }

  if (input.endpoint === "item") {
    const decoded = decodeContract(JimengResearchItemWireSchema, data, endpointPath)
    return {
      ...common,
      profile: null,
      profiles: [],
      items: [normalizeJimengResearchItem(decoded)],
      stories: [],
      hasMore: null,
      nextOffset: null,
      totalCount: null,
    }
  }

  if (input.endpoint === "stories") {
    const decoded = decodeContract(ProfileStoryListWireSchema, data, endpointPath)
    return {
      ...common,
      profile: null,
      profiles: [],
      items: [],
      stories: decoded.story_list.map(normalizeStory),
      hasMore: decoded.has_more,
      nextOffset: decoded.next_offset,
      totalCount: null,
    }
  }

  const decoded = decodeContract(ProfileItemListWireSchema, data, endpointPath)
  return {
    ...common,
    profile: null,
    profiles: [],
    items: decoded.item_list.map(normalizeJimengResearchItem),
    stories: [],
    hasMore: decoded.has_more,
    nextOffset: decoded.next_offset,
    totalCount: finiteNumber(decoded.total_count),
  }
}

function requestFor(endpoint: JimengProfileResearchEndpoint, query: JimengProfileResearchQuery): JsonObject {
  switch (endpoint) {
    case "profile":
      return buildJimengProfileUserRequest(requireText(query.secUid, "--secUid"))
    case "homepage":
      return buildJimengProfileHomepageRequest(query)
    case "favorites":
      return buildJimengProfileFavoritesRequest(query)
    case "stories":
      return buildJimengProfileStoriesRequest(query)
    case "following":
    case "followers":
      return buildJimengProfileFollowRequest(endpoint, query)
    case "item":
      return buildJimengProfileItemRequest(requireText(query.publishedItemId, "--publishedItemId"))
  }
}

function endpointPathFor(endpoint: JimengProfileResearchEndpoint): string {
  switch (endpoint) {
    case "profile":
      return "/mweb/v1/get_user_info"
    case "homepage":
      return "/mweb/v1/get_homepage"
    case "favorites":
      return "/mweb/v1/get_favorite_list"
    case "stories":
      return "/mweb/v1/get_user_story_list"
    case "following":
    case "followers":
      return "/mweb/v1/get_follow_list"
    case "item":
      return "/mweb/v1/get_item_info"
  }
}

function normalizeProfile(profile: ProfileUserWire): JimengProfileResearchProfile {
  const uid = normalizeId(profile.uid)
  return {
    name: profile.name.trim(),
    uid: uid.value,
    uidWasUnsafeNumber: uid.unsafe,
    secUid: profile.sec_uid,
    description: cleanString(profile.description),
    avatarUrl: cleanString(profile.avatar_url),
    totalMaterialsUsage: finiteNumber(profile.total_materials_usage),
    totalMaterialsFavorite: finiteNumber(profile.total_materials_favorite),
    totalMaterialsLike: finiteNumber(profile.total_materials_like),
    editorPickCount: finiteNumber(profile.editor_pick_count),
    followingCount: finiteNumber(profile.follow),
    followerCount: finiteNumber(profile.fans),
    hasFollowed: booleanValue(profile.has_followed),
    status: finiteNumber(profile.status),
    isBlock: booleanValue(profile.is_block),
    isBlocked: booleanValue(profile.is_blocked),
    showFollowers: booleanValue(profile.show_followers),
    showFollowing: booleanValue(profile.show_following),
    showLikes: booleanValue(profile.show_likes),
    showFavorites: booleanValue(profile.show_favorites),
  }
}

function normalizeStory(story: ProfileStoryWire): JimengProfileResearchStory {
  const storyId = normalizeOptionalId(story.story_id ?? story.storyId ?? story.id)
  const draftId = normalizeOptionalId(story.draft_id ?? story.draftId)
  const storyVersion = normalizeOptionalId(story.story_version ?? story.storyVersion)
  const cover = story.cover ?? null
  return {
    storyId: storyId.value,
    storyIdWasUnsafeNumber: storyId.unsafe,
    draftId: draftId.value,
    draftIdWasUnsafeNumber: draftId.unsafe,
    name: cleanString(story.name),
    description: cleanString(story.desc ?? story.description),
    storyVersion: storyVersion.value,
    storyVersionWasUnsafeNumber: storyVersion.unsafe,
    createAt: finiteNumber(story.create_at ?? story.createAt ?? story.create_time),
    modifyAt: finiteNumber(story.modify_at ?? story.modifyAt ?? story.update_time),
    hasFavored: booleanValue(story.has_favored ?? story.hasFavored),
    coverUri: cleanString(cover?.image_uri ?? cover?.uri),
    coverUrl: cleanString(cover?.image_url ?? cover?.url),
    coverWidth: finiteNumber(cover?.width),
    coverHeight: finiteNumber(cover?.height),
    coverFormat: cleanString(cover?.format),
  }
}

function summarizeProfile(profile: JimengProfileResearchProfile): JsonObject {
  return {
    name: profile.name,
    uid: profile.uid,
    uid_was_unsafe_number: profile.uidWasUnsafeNumber,
    sec_uid: profile.secUid,
    description: profile.description,
    avatar_url_present: !!profile.avatarUrl,
    total_materials_usage: profile.totalMaterialsUsage,
    total_materials_favorite: profile.totalMaterialsFavorite,
    total_materials_like: profile.totalMaterialsLike,
    editor_pick_count: profile.editorPickCount,
    following_count: profile.followingCount,
    follower_count: profile.followerCount,
    has_followed: profile.hasFollowed,
    status: profile.status,
    is_block: profile.isBlock,
    is_blocked: profile.isBlocked,
    show_followers: profile.showFollowers,
    show_following: profile.showFollowing,
    show_likes: profile.showLikes,
    show_favorites: profile.showFavorites,
  }
}

function summarizeStory(story: JimengProfileResearchStory): JsonObject {
  return {
    story_id: story.storyId,
    story_id_was_unsafe_number: story.storyIdWasUnsafeNumber,
    draft_id: story.draftId,
    draft_id_was_unsafe_number: story.draftIdWasUnsafeNumber,
    name: story.name,
    description: story.description,
    story_version: story.storyVersion,
    story_version_was_unsafe_number: story.storyVersionWasUnsafeNumber,
    create_at: story.createAt,
    modify_at: story.modifyAt,
    has_favored: story.hasFavored,
    cover_uri: story.coverUri,
    cover_url_present: !!story.coverUrl,
    cover_width: story.coverWidth,
    cover_height: story.coverHeight,
    cover_format: story.coverFormat,
  }
}

function decodeContract<A>(schema: Schema.Decoder<A>, value: JsonValue, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    throw jimengError({
      category: "upstream",
      code: "JIMENG_PROFILE_RESEARCH_CONTRACT_CHANGED",
      message: `${operation}: Jimeng profile research response did not match required fields.`,
      retryable: false,
      details: {
        operation,
        error: error instanceof Error ? error.message : String(error),
      },
    })
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

function requireText(value: string | undefined, flag: string): string {
  const normalized = value?.trim()
  if (normalized) return normalized
  throw validationError(`profile-research ${flag} must be a non-empty string`, { flag })
}

function normalizeCount(value = 12): number {
  if (!Number.isInteger(value) || value < 1 || value > 50) {
    throw validationError("profile-research --limit must be an integer from 1 to 50", { value })
  }
  return value
}

function normalizeOffset(value = 0): number {
  if (!Number.isInteger(value) || value < 0) {
    throw validationError("profile-research --offset must be a non-negative integer", { value })
  }
  return value
}

function normalizeImageTypeList(value: number[] | undefined): number[] {
  const normalized = value ?? [3, 4, 7]
  if (normalized.length === 0 || normalized.some((item) => !Number.isInteger(item) || item < 0)) {
    throw validationError("profile-research image type list must contain non-negative integers", {
      image_type_list: normalized,
    })
  }
  return Array.from(new Set(normalized))
}

function normalizeId(value: string | number): { value: string | null; unsafe: boolean } {
  if (typeof value === "string" && value.length > 0) return { value, unsafe: false }
  if (typeof value === "number" && Number.isSafeInteger(value)) return { value: String(value), unsafe: false }
  return { value: null, unsafe: typeof value === "number" && Number.isFinite(value) }
}

function normalizeOptionalId(value: string | number | null | undefined): { value: string | null; unsafe: boolean } {
  if (typeof value === "string" || typeof value === "number") return normalizeId(value)
  return { value: null, unsafe: false }
}

function validationError(message: string, details: JsonObject): ReturnType<typeof jimengError> {
  return jimengError({
    category: "validation",
    code: "PROFILE_RESEARCH_INPUT_INVALID",
    message,
    retryable: false,
    details,
  })
}

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanValue(value: boolean | null | undefined): boolean | null {
  return typeof value === "boolean" ? value : null
}

function retValue(body: JsonValue): string | number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  return typeof body.ret === "string" || typeof body.ret === "number" ? body.ret : null
}

function errmsgValue(body: JsonValue): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  return typeof body.errmsg === "string" ? body.errmsg : null
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

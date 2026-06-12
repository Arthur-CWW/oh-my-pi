#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  buildJimengAssetsRequest,
  fetchJimengAssets,
  parseJimengAssetTypes,
  summarizeJimengAssets,
  workspaceIdFromJimengSession,
} from "./assets"
import {
  buildJimengAgentConfigRequest,
  buildJimengAgentSkillsRequest,
  fetchJimengAgentCatalog,
  parseJimengAgentCatalogEndpoints,
  summarizeJimengAgentCatalog,
} from "./agent-catalog"
import {
  fetchJimengAccountCredit,
  summarizeJimengAccountCredit,
} from "./account-credit"
import {
  buildJimengCommerceBenefitsRequest,
  fetchJimengCommerceBenefits,
  parseJimengCommerceBenefitEndpoints,
  summarizeJimengCommerceBenefits,
} from "./commerce-benefits"
import {
  buildJimengCommercePricingRequest,
  fetchJimengCommercePricing,
  parseJimengCommercePricingEndpoints,
  summarizeJimengCommercePricing,
} from "./commerce-pricing"
import { loadJimengSessionFromBrowser } from "./browser-session"
import {
  buildCapCutCollectionTemplatesRequest,
  buildSingleCapCutEndpointProbeVariant,
  buildCapCutTemplateCollectionsRequest,
  buildCapCutTemplateCategoriesRequest,
  buildCapCutTemplateDetailRequest,
  capCutTemplateStaticCatalogUrls,
  fetchCapCutCollectionTemplates,
  fetchCapCutTemplateCollections,
  fetchCapCutTemplateCategories,
  fetchCapCutTemplateDetail,
  fetchCapCutTemplateStaticCatalog,
  parseCapCutEndpointProbeVariants,
  runCapCutEndpointProbe,
  summarizeCapCutCollectionTemplates,
  summarizeCapCutEndpointProbe,
  summarizeCapCutTemplateCollections,
  summarizeCapCutTemplateCategories,
  summarizeCapCutTemplateDetail,
  summarizeCapCutTemplateStaticCatalog,
} from "./capcut-templates"
import {
  buildCapCutEditorCatalogRequest,
  capCutEditorCatalogEndpointPath,
  fetchCapCutEditorCatalog,
  parseCapCutEditorCatalogEndpoints,
  summarizeCapCutEditorCatalog,
} from "./lv-editor-catalog"
import {
  analyzeJimengNetworkCaptureFile,
  writeJimengCaptureAnalysisMarkdown,
} from "./capture-analyzer"
import {
  inferJimengContractsFromPath,
  writeJimengContractInferenceOutputs,
} from "./contract-infer"
import {
  buildJimengDiscoveryWorklist,
  readJimengCaptureAnalysisFile,
  readJimengEndpointProbeCandidateFile,
  summarizeJimengDiscoveryWorklist,
  writeJimengDiscoveryWorklistMarkdown,
} from "./discovery-worklist"
import {
  fetchVoiceLibraryFromCapture,
  fetchLipSyncConfigs,
  generateTextToSpeech,
  getDefaultVoiceLibraryCapturePath,
  parseCatalogEndpointIds,
  runCatalogProbe,
  summarizeLipSyncConfigs,
  summarizeVoiceLibrary,
  type JimengVoiceCatalogItem,
} from "./catalog"
import { prepareFromCapture, redactHeaders, type CaptureFile, type JimengOp, type JimengSessionBundle } from "./capture"
import { JimengClient } from "./client"
import { JimengError } from "./errors"
import {
  buildJimengDiscoveryKnownEndpointMap,
  parseJimengDiscoveryTriageDecisions,
  summarizeJimengDiscoveryTriageCoverage,
  writeJimengDiscoveryTriageCoverageMarkdown,
  type JimengDiscoveryTriageDecision,
} from "./endpoint-registry"
import {
  buildExploreRequestBody,
  buildShortVideoExploreQuery,
  fetchExploreTemplates,
  fetchOverseasShortVideos,
  parseExploreWorkTypes,
  redactExploreTemplateItems,
  summarizeExploreShortVideos,
  summarizeExploreTemplates,
} from "./explore"
import {
  buildSingleEndpointProbeVariant,
  parseJimengEndpointProbeVariants,
  runJimengEndpointProbe,
  summarizeJimengEndpointProbe,
} from "./endpoint-probe"
import {
  createJimengHttpTransport,
  parseJimengHttpTransportMode,
  type JimengHttpTransportMode,
} from "./http-transport"
import {
  runJimengRateProbe,
  summarizeJimengRateProbe,
} from "./rate-probe"
import {
  buildJimengLipSyncImagePlan,
  buildJimengLipSyncVideoPlan,
  lipSyncImageReferenceFromUploadSummary,
  lipSyncVideoReferenceFromUploadSummary,
  type JimengLipSyncImageReference,
  type JimengLipSyncVideoReference,
} from "./lip-sync"
import {
  compareJimengLipSyncPlanWithCaptureTemplate,
  compareJimengLipSyncPlanWithRawNetwork,
  summarizeJimengLipSyncCompare,
} from "./lip-sync-compare"
import {
  compareJimengRequestPlanWithCaptureTemplate,
  compareJimengRequestPlanWithRawNetwork,
  summarizeJimengRequestPlanCompare,
} from "./request-plan-compare"
import {
  locateJimengStaticEndpoints,
  parseJimengStaticLocatorEndpoints,
  parseJimengStaticLocatorQueries,
  summarizeJimengStaticLocator,
  writeJimengStaticLocatorMarkdown,
} from "./static-locator"
import {
  inventoryJimengStaticApis,
  summarizeJimengStaticInventory,
  writeJimengStaticInventoryMarkdown,
} from "./static-inventory"
import {
  buildJimengHistoryQueueInfoRequest,
  fetchJimengHistoryQueueInfo,
  parseJimengHistoryIdsFlag,
  summarizeJimengHistoryQueueInfo,
} from "./history-queue"
import {
  buildJimengHistoryListRequest,
  fetchJimengHistoryList,
  parseJimengHistoryFilterTypeListFlag,
  summarizeJimengHistoryList,
} from "./history-list"
import {
  buildJimengHistoryRecordsRequest,
  fetchJimengHistoryRecords,
  parseJimengIdCsvFlag,
  summarizeJimengHistoryRecords,
} from "./history-records"
import {
  buildJimengImageModelsRequest,
  fetchJimengImageModels,
  summarizeJimengImageModels,
} from "./image-models"
import {
  buildJimengText2ImageDirectPlan,
  summarizeJimengText2ImageDirectPlan,
} from "./text2image-plan"
import {
  compareJimengText2ImageDirectPlanWithCaptureTemplate,
  compareJimengText2ImageDirectPlanWithRawNetwork,
  summarizeJimengText2ImageDirectCompare,
} from "./text2image-plan-compare"
import {
  buildJimengVideoDirectPlan,
  buildJimengVideoOmniReferencePlan,
  parseJimengVideoOmniMaterialsJson,
  summarizeJimengVideoDirectPlan,
  summarizeJimengVideoOmniReferencePlan,
} from "./video-plan"
import {
  buildJimengGenerateAuditPlan,
  parseJimengGenerateAuditMaterialsJson,
  summarizeJimengGenerateAuditPlan,
} from "./generate-audit"
import {
  buildJimengGenerationContractReport,
  writeJimengGenerationContractReportOutputs,
} from "./generation-contract"
import {
  buildJimengMixAudioVideoPlan,
  parseJimengMixAudioInputListJson,
  parseJimengMixAudioJsonObject,
  summarizeJimengMixAudioVideoPlan,
} from "./mix-audio"
import {
  buildJimengVideoPreprocessPlan,
  buildJimengVideoPreprocessQueryPlan,
  parseJimengVideoPreprocessBodyJson,
  parseJimengVideoPreprocessImageUris,
  summarizeJimengVideoPreprocessPlan,
  summarizeJimengVideoPreprocessQueryPlan,
  type JimengVideoPreprocessMode,
} from "./video-preprocess"
import {
  compareJimengVideoDirectPlanWithCaptureTemplate,
  compareJimengVideoDirectPlanWithRawNetwork,
  summarizeJimengVideoDirectCompare,
} from "./video-plan-compare"
import {
  compareJimengVideoOmniPlanWithCaptureTemplate,
  compareJimengVideoOmniPlanWithRawNetwork,
  summarizeJimengVideoOmniCompare,
} from "./video-omni-compare"
import {
  buildJimengCanvasCustomRatiosRequest,
  buildJimengCanvasConversationListRequest,
  buildJimengCanvasProjectDetailRequest,
  buildJimengCanvasProjectListRequest,
  fetchJimengInfiniteCanvas,
  parseJimengInfiniteCanvasEndpoints,
  summarizeJimengInfiniteCanvas,
} from "./infinite-canvas"
import {
  buildJimengWorkspaceByIdsRequest,
  buildJimengWorkspaceListRequest,
  fetchJimengWorkspaceContext,
  parseJimengWorkspaceContextEndpoints,
  summarizeJimengWorkspaceContext,
} from "./workspace-context"
import {
  buildJimengResearchGuessRequest,
  buildJimengResearchSuggestRequest,
  fetchJimengResearchKeywords,
  parseJimengResearchKeywordChannels,
  parseJimengResearchKeywordEndpoints,
  summarizeJimengResearchKeywords,
} from "./research-keywords"
import {
  buildJimengResearchSearchRequest,
  fetchJimengResearchSearch,
  parseJimengResearchAssetType,
  parseJimengResearchSearchChannel,
  parseJimengResearchShowTypeList,
  summarizeJimengResearchSearch,
} from "./research-search"
import {
  buildJimengProfileBatchItemsRequest,
  buildJimengProfileFavoritesRequest,
  buildJimengProfileFollowRequest,
  buildJimengProfileHomepageRequest,
  buildJimengProfileItemRequest,
  buildJimengProfileStoriesRequest,
  buildJimengProfileUserRequest,
  fetchJimengProfileResearch,
  parseJimengPublishedItemIds,
  parseJimengProfileImageTypeList,
  parseJimengProfileResearchEndpoints,
  summarizeJimengProfileResearch,
} from "./profile-research"
import {
  buildJimengLocalItemsRequest,
  fetchJimengLocalItems,
  parseJimengLocalItemIds,
  summarizeJimengLocalItems,
} from "./local-items"
import {
  buildJimengAsyncTasksRequest,
  buildJimengStoryExportPlan,
  buildJimengStoryRecordsRequest,
  fetchJimengAsyncTasks,
  fetchJimengStoryRecords,
  parseJimengStoryIds,
  summarizeJimengAsyncTasks,
  summarizeJimengStoryExportPlan,
  summarizeJimengStoryRecords,
} from "./story-archive"
import {
  buildJimengAccountConfigRequest,
  fetchJimengAccountConfig,
  parseJimengAccountConfigEndpoints,
  summarizeJimengAccountConfig,
} from "./account-config"
import {
  buildJimengRuntimeConfigRequest,
  fetchJimengRuntimeConfig,
  parseJimengRuntimeConfigEndpoints,
  summarizeJimengRuntimeConfig,
} from "./runtime-config"
import {
  buildJimengVideoInfoRequest,
  fetchJimengVideoInfo,
  parseJimengVidCsvFlag,
  summarizeJimengVideoInfo,
} from "./video-info"
import {
  buildJimengControlNetSaveParams,
  defaultControlNetPreviewBabiParam,
  defaultPoseDetectBabiParam,
  detectJimengPose,
  generateJimengControlNetPreview,
  parseJimengControlNetFitMode,
  parseJimengControlNetKind,
  summarizeControlNetReferenceInspection,
} from "./reference-controls"
import {
  defaultFaceRecognizeBabiParam,
  defaultImageDescriptionBabiParam,
  describeJimengImage,
  recognizeJimengImageFaces,
  summarizeReferenceImageInspection,
  type JsonObject,
  type JsonValue,
} from "./reference-image"
import {
  defaultObjectSegmentationBabiParam,
  jimengObjectSegmentationModes,
  parseJimengObjectSegmentationCommandMode,
  segmentJimengObject,
  summarizeObjectSegmentation,
  type JimengObjectSegmentationResult,
} from "./reference-segmentation"
import {
  buildJimengSubjectCreateRequest,
  buildJimengSubjectDeleteRequest,
  buildJimengSubjectUpdateRequest,
  buildJimengSubjectVoiceRequest,
  buildJimengSubjectsRequest,
  createJimengSubject,
  deleteJimengSubjects,
  fetchJimengImagesByUri,
  fetchJimengSubjects,
  subjectImageReferenceFromUploadSummary,
  submitJimengImageAuditJob,
  summarizeJimengImageByUri,
  summarizeJimengSubjectCreate,
  summarizeJimengSubjectDelete,
  summarizeJimengSubjectUpdate,
  summarizeJimengSubjects,
  updateJimengSubject,
  type JimengSubjectImageReference,
} from "./subjects"
import { getJimengUploadToken, parseUploadTokenScene, uploadJimengImage, uploadJimengVideo, type JimengImageUploadResult, type JimengVideoUploadResult } from "./upload"
import {
  JimengCloneVoiceStatus,
  buildJimengClonedVoiceDeleteRequest,
  buildJimengClonedVoiceUpdateRequest,
  buildJimengClonedVoicesRequest,
  buildJimengVoiceCloneSubmitRequest,
  buildJimengVoiceTaskQueryRequest,
  fetchJimengClonedVoices,
  queryJimengVoiceTasks,
  summarizeJimengClonedVoices,
  summarizeJimengVoiceTaskQuery,
  type JimengCloneVoiceStatusValue,
} from "./voice-clone"

const DEFAULT_CDP_URL = "http://127.0.0.1:9340"

const USAGE = `Usage: jimeng-browser-proxy <command> [options]

Browser-backed Jimeng proxy for the dedicated background Helium/CDP profile.
It refreshes the live frontend session from the browser, then uses the direct client.

Commands:
  session       Save a fresh session bundle from the logged-in Jimeng browser profile
  capture-analyze Analyze raw CDP network JSONL into ranked endpoint/probe candidates
  discovery-worklist Merge capture analysis/static hints into prioritized next API work
  static-locate Locate endpoint request builders in local source/bundle roots
  static-inventory Inventory frontend API endpoints from local source/bundle roots
  contract-infer Infer schema/test/registry scaffolds from saved proof JSON/artifacts
  generation-contract Validate/summarize saved live generation proof result JSON
  triage-coverage Summarize keep/maybe/skip endpoint registry coverage and remaining gaps
  catalog       Probe non-generating model/tool/persona/voice config endpoints
  agent-catalog Fetch normalized agent skills and image/video model catalog
  image-models  Fetch no-spend image generation model/config catalog
  text2image-plan Build a no-spend direct text-to-image submit body
  text2image-compare Offline compare a direct text-to-image dry-run plan against captured UI submit
  text2video-plan Build a no-spend direct text/image/frames-to-video submit body
  text2video-compare Offline compare a direct video dry-run plan against captured UI submit
  omni-video-plan Build a dry-run Seedance omni-reference mixed image/video submit body
  omni-video-compare Offline compare an omni-reference dry-run plan against captured UI submit
  generate-audit-plan Build a dry-run generation material pre-audit body
  mix-audio-plan Build a dry-run audio/video mix task request body and babi_param query
  video-preprocess-plan Build a dry-run lip-sync/digital-human pre-process task body
  video-preprocess-query-plan Build a dry-run lip-sync/digital-human pre-process result lookup body
  request-plan-compare Offline compare a simple dry-run request plan against captured UI traffic
  account-credit Fetch signed no-spend account credit balance
  commerce-benefits Fetch signed no-spend benefit metadata and user benefit rows
  commerce-pricing Fetch signed no-spend VIP and credit price lists
  account-config Fetch no-spend current-account settings, registration, and invite flags
  runtime-config Fetch no-spend frontend runtime, banner, helpdesk, and ASR config reads
  workspace-context Fetch no-spend workspace list and workspace-id context
  research-keywords Fetch no-spend search suggestions and guessed research keywords
  research-search Fetch no-spend inspiration, short-film, or workspace asset search results
  profile-research Fetch no-spend public profile/reference works and current-account follow lists
  local-items  Fetch no-spend current-account unpublished/generated item details by local item id
  story-records Fetch no-spend story/archive records by explicit story id
  async-tasks  Fetch no-spend async export task status by explicit task id
  story-export-plan Build a dry-run story export async-task submit body
  infinite-canvas Fetch no-spend infinite-canvas project/detail/ratio metadata
  lip-sync-config Fetch no-spend digital-human/lip-sync model configs
  lip-sync-compare Offline compare a lip-sync dry-run plan against captured UI submit
  voices        Fetch the built-in voice library from a captured signed feed request
  voice-clones  Fetch current user's cloned voice assets without generation spend
  voice-clone-submit Dry-run a custom voice clone submit request from an uploaded audio vid
  voice-clone-query Dry-run/query voice task ids
  voice-clone-update Dry-run cloned voice rename request
  voice-clone-delete Dry-run cloned voice delete request
  tts           Generate one MP3 text-to-speech sample from a voice id
  sample-voices Generate sequential MP3 samples for voices from the built-in library
  endpoint-probe Probe/replay one endpoint with JSON body variants and shape summaries
  rate-probe    Measure bounded no-spend endpoint concurrency/rate behavior
  assets        Fetch workspace/workbench asset history without generation spend
  history-list  Fetch read-only paginated generation history list
  history-queue Fetch read-only queue/progress details for one or more history ids
  history-records Fetch read-only completed/history records by submit id or history id
  video-info    Fetch read-only VOD video metadata by vid
  templates     Fetch no-spend Explore/template examples for prompt/template mining
  short-videos  Fetch no-spend Explore short videos for reference/profile mining
  overseas-short-videos Fetch no-spend feed_short_video examples for overseas/reference mining
  capcut-probe Probe/replay one signed read-oriented CapCut/LV endpoint with JSON variants
  capcut-categories Fetch no-spend CapCut commercial template categories
  capcut-collections Fetch no-spend CapCut template collection ids/categories
  capcut-collection-templates Fetch no-spend CapCut template rows for a collection id
  capcut-template-detail Fetch no-spend CapCut template detail by template web id
  capcut-template-metadata Fetch public CapCut template ratios and scene metadata
  capcut-editor-catalog Fetch no-spend LV editor fonts/effects/colors catalog
  subjects      Fetch saved Jimeng subject/persona records without generation spend
  describe-image Upload/use an image URI, then describe it and detect faces
  controlnet-preview Upload/use an image URI, then build pose/depth/canny preview refs
  object-mask   Upload/use an image URI, then segment salient object masks
  upload-token  Fetch temporary upload credentials for image/video/file upload scenes
  upload-image  Upload a local image to Jimeng ImageX and return a provider URI
  upload-video  Upload a local video to Jimeng VOD and return a provider video reference
  subject-create Create a saved Jimeng subject/persona from a main reference image
  subject-update Update a saved Jimeng subject/persona's editable content
  subject-delete Delete one or more saved Jimeng subject/persona records
  subject-generate-voice Dry-run subject voice-generation request from an image URI
  text2image    Submit text-to-image from a captured workbench/agent template
  text2video    Submit text-to-video from a captured workbench template
  image2video   Upload/use a first-frame image URI, then submit image-to-video
  frames2video  Upload/use first and end-frame image URIs, then submit image-to-video
  lip-sync      Dry-run image/avatar or VOD video-reference lip-sync payload plan from text/voice

Options:
  --cdp <url>                   CDP URL (default: ${DEFAULT_CDP_URL})
  --target-url <substring>      Existing Jimeng page URL/title substring (default: jimeng.jianying.com)
  --session <file>              Load a saved session bundle instead of refreshing from CDP
  --session-out <file>          session command output (default: data/jimeng-lab/raw/session-bundle-current.json)
  --capture <file>              Capture template JSON for generation/compare commands
  --rawNetwork <file>           raw-network.jsonl from jimeng-network-recorder for capture-analyze
  --captureDir <dir>            Capture directory containing raw-network.jsonl for capture-analyze/*-compare
  --analysis <file[,file]>       capture-analyze normalized analysis JSON for discovery-worklist
  --probeCandidates <file[,file]> Raw endpoint-probe candidate JSON for discovery-worklist
  --staticRoot <dir[,dir]>      Optional source/bundle roots to search for exact endpoint string hints
  --input <file|dir>             Proof/cassette directory or JSON file for contract-infer/generation-contract
  --symbol <name[,name]>         Static-locate symbols/request-builder names to search beside endpoints
  --staticQuery <term[,term]>     Static-locate arbitrary source/bundle search terms
  --contextLines <n>            Snippet context lines for static-locate (default: 3)
  --includeRisky                Include generate/upload/mutate/payment endpoints in replay candidate JSON
  --includeKnown                Include already-covered endpoints in discovery-worklist/static-inventory
  --decisions <ids>             Triage decisions for triage-coverage: keep,maybe,skip (default: keep)
  --plan <file>                 Dry-run plan JSON for *-compare commands
  --endpoint <path|url>          Endpoint path or full URL for endpoint-probe/request-plan-compare
  --method <GET|POST>            HTTP method for endpoint-probe/capcut-probe (default: POST)
  --query <query>                Query string override for endpoint-probe
  --body <json>                  Single JSON body for endpoint-probe/capcut-probe
                                  generate-audit-plan uses this as extra top-level request JSON
                                  mix-audio-plan uses this as the frontend camel/snake body before snake-case conversion
  --materials <json|file>         JSON material list for generate-audit-plan
                                  omni-video-plan uses image/video refs with fieldName, uri/vid, width/height, durationSec
  --babiParam <json|file>         JSON babiParam object for mix-audio-plan query param
  --videoItemId <id>              Generated video item id for mix-audio-plan shortcut body
  --inputList <json|file>         Batch mix-audio-plan input list with audioVid/videoItemId rows
  --mode <value>                  video-preprocess mode: image-create-avatar, voice-recommendation, audio-detect, audio-silence, raw
  --imageUris <json|file>         JSON array of image URIs for video-preprocess voice recommendations
  --detectionScene <value>        Optional image-create-avatar detection_scene field
  --batch <true|false>            Build mix-audio-plan for /mix_audio_videos instead of /mix_audio_video
  --variants <json|file>         Probe variants JSON array or object with variants
  --transport <mode>             Shared HTTP transport: live, record, replay, fixture (default: live)
  --cassette <file>              Cassette path for record/replay/fixture transport
  --requests <n>                 Total requests for rate-probe (default: --limit or 12)
  --concurrency <n>              Concurrent workers for rate-probe (default: 1)
  --delayMs <ms>                 Optional per-request delay for rate-probe workers
  --endpoints <ids|all>          Catalog endpoints, comma-separated (default: all)
                                  agent-catalog accepts skills,config,all
                                  infinite-canvas accepts projects,detail,ratios,conversations,all
                                  account-config accepts settings,ug-info,invite-status,all
                                  commerce-pricing accepts vip,credit,all
                                  runtime-config accepts experiment-params,home-header-banner,help-desk-entrance,asr-token,asr-hotwords,all
                                  research-keywords accepts suggest,guess,all
                                  profile-research accepts profile,homepage,favorites,stories,following,followers,item,items,all
  --channels <ids|all>           Research channels: inspiration,short-film,asset,all
  --channel <id>                 research-search channel: inspiration, short-film, or asset
  --searchId <id>                research-search continuation search id
  --source <value>               research-search source (default: search)
  --assetType <name|id>          Asset search type: image,video,story,canvas,audio,document,canvas-project
  --blockIndex <n>               Asset search block index (default: 0)
  --showTypeList <csv>           Optional asset search show_type_list integers
  --secUid <id>                  Public profile sec_uid for profile-research
  --publishedItemId <id>         Published work id for profile-research item detail
  --publishedItemIds <csv>       Published work ids for profile-research batch item details
  --itemIds <csv>                Local generated item ids for local-items
  --storyIds <csv>               Story/archive ids for story-records or story-export-plan
  --imageTypeList <csv>          Profile homepage/favorites image type filters (default: 3,4,7)
  --needIntentionMark <bool>     Inspiration/short-film intention-mark option (default: true)
  --isInsertFrame <bool>         Optional asset search insert-frame filter
  --hideStoryAgentResult <bool>  Optional asset search story-agent filter
  --beginTimeStamp <n>           Optional asset search lower timestamp bound
  --language <value>             Optional research/profile language filter
  --text <text>                 TTS/sample-voices text
  --voice-id <id>               TTS voice id from voices command
  --voice-title <title>         Optional display title for TTS output filename
  --voice-statuses <csv>         Cloned voice statuses: generating,success,fail or 1,2,3
  --audioVid <vid>              Uploaded audio VOD vid for voice clone submit
  --audioUrl <url>              Optional uploaded audio preview URL for voice clone submit
  --audioDurationSec <sec>      Optional uploaded audio duration for voice clone submit
  --audioTitle <title>          Optional uploaded audio title for voice clone submit
  --taskIds <csv>               Voice task ids for voice-clone-query
  --tone-key <key>               Optional lip-sync voice display/key field
  --tone-category-id <id>        Optional lip-sync voice category id
  --tone-category-key <key>      Optional lip-sync voice category key
  --speed <n>                    TTS/lip-sync speech speed (default: 1.0)
  --item-platform <n>           Voice item platform (default: 1, Loki/built-in)
  --limit <n>                   sample-voices limit or Explore count
  --offset <n>                  Explore offset (default: 0)
  --imageInfo <bool>            Infinite-canvas project list imageInfo flag (default: true)
  --projectId <id>              Infinite-canvas project id for detail lookup
  --userId <id>                 Infinite-canvas user id for custom ratios lookup
  --workspaceIds <ids>          Comma-separated workspace ids for workspace-context get-by-ids
  --needDraftResource <bool>    Infinite-canvas detail draft resource flag (default: false)
  --asset-types <csv>           Assets types for get_asset_list (default: 1,2,5,6,7,8,9,10,12)
  --asset-mode <value>          Assets mode for get_asset_list (default: workbench)
  --submitId <id>               Submit id for history-records
  --submitIds <csv>             Submit ids for history-records
                                  video-preprocess-query-plan uses submit ids from pre_process tasks
  --historyId <id>              History id for history-queue
  --historyIds <csv>            History ids for history-queue/history-records
  --vids <csv>                  VOD vids for video-info
  --direction <n>               Assets list direction (default: 1)
  --filter-types <csv>           History-list filter_type_list values
  --order-by <n>                Assets list order_by option (default: 0)
  --endTimeStamp <n>            Assets pagination timestamp/cursor (default: 0)
  --includeStoryAgentResult     Do not hide story-agent results in assets query
  --cursor <n>                  Subject/persona list cursor (default: 0)
  --keyword <text>              Research suggestion or subject/persona list search keyword
  --subjectId <id>              Subject/persona id for update/delete
  --subjectIds <csv>            Subject/persona ids for filtered list or batch delete
  --onlyFavorite                Subject/persona list favorite filter
  --category-id <n>             Explore category id (default: 11222)
  --work-types <csv>            templates work types: video,image,canvas,short_video
  --feed-refer <value>          Explore feed refer, e.g. feed_refresh, feed_enterauto, or feed_loadmore
  --capcut-lan <value>          CapCut template request language header (default: en)
  --capcut-loc <value>          CapCut template request location header (default: us)
  --collection-id <n>           CapCut collection id for capcut-collection-templates
  --template-id <id>            CapCut template web id for capcut-template-detail
  --category-type <value>       CapCut collection category_type request field
  --scale <n>                   CapCut collection scale request field
  --canvasWidth <n>             CapCut collection canvas width request field
  --canvasHeight <n>            CapCut collection canvas height request field
  --needDraft                   Request draft data in capcut-template-detail
  --isClientFilter <true|false> Image model config client filtering (default: true)
  --needBetaModel <true|false>  Include beta image models (default: true)
  --needCache <true|false>      Common config query needCache (default: true)
  --needRefresh <true|false>    Common config query needRefresh (default: false)
  --resolution <1k|2k|4k>       Direct text2image-plan large image resolution (default: 2k)
  --sampleStrength <0..1>       Direct text2image-plan prompt strength (default: 0.5)
  --negativePrompt <text>       Direct text2image-plan negative prompt
  --intelligentRatio <bool>     Direct text2image-plan intelligent ratio mode (default: false)
  --panel <value>               LV editor catalog panel (default: fonts)
  --category <value>            LV editor catalog category (default: all)
  --lang <value>                LV editor catalog language (default: en)
  --region <value>              LV editor catalog region (default: US)
  --scene <image|video|file|n>   upload-token scene (default: image)
  --file <path>                  Local media file for upload-image/upload-video; alias for --image in image2video
  --video <path>                 Local reference video for lip-sync; uploads to VOD in dry-run planning
  --imageUri <uri>               Existing Jimeng/ImageX provider URI for describe-image
  --noDescription                Skip get_image_description in describe-image
  --noFaces                      Skip face_recognize in describe-image
  --control <pose|depth|canny>    ControlNet reference kind (default: pose)
  --strength <n>                 ControlNet strength as 0.01..1 or 1..100 (default: 60)
  --fitMode <value>              ControlNet save fit mode: center_crop or adapt_to_canvas
  --noPoseDetect                 Skip pose_detect even when --control pose
  --mode <canvas|default|both>    Object-mask saliency_seg mode (default: both)
  --vid <vid>                    Existing VOD vid for lip-sync
  --videoUri <uri>               Existing VOD/tos provider URI for lip-sync
  --videoWidth <n>               Existing reference video width for lip-sync
  --videoHeight <n>              Existing reference video height for lip-sync
  --videoDurationSec <sec>       Existing reference video duration for lip-sync
  --videoMode <value>            Lip-sync/video-plan videoMode override from a confirmed frontend capture
  --fps <n>                      Direct text2video-plan frame rate (default: 24)
  --imageWidth <n>               Existing provider image width for lip-sync image/avatar mode
  --imageHeight <n>              Existing provider image height for lip-sync image/avatar mode
  --imageUrl <url>               Optional existing provider image preview URL for lip-sync image/avatar mode
  --name <text>                  Subject/persona name, max 20 chars
  --description <text>           Subject/persona description
  --workspaceId <id>             Jimeng workspace id for subject/persona creation
  --image <path>                 Local first-frame image for image2video or image/avatar lip-sync
  --lastImage <path>             Local end-frame image for frames2video
  --firstFrameUri <uri>          Existing Jimeng/ImageX provider URI for image2video
  --lastFrameUri <uri>           Existing provider URI for end-frame experiments
  --ratio <ratio>                Video aspect ratio flag patched into text_to_video_params
  --videoResolution <value>      Video resolution value patched into video_gen_inputs and sceneOptions
  --modelVersion <value>         Confirmed shorthand model version, e.g. 3.0fast
  --modelReqKey <value>          Raw confirmed model_req_key override
  --seed <n>                     Deterministic seed, 0..4294967295
  --prompt <text>               Generation prompt
  --outDir <dir>                Output directory (default: data/jimeng-lab/browser-proxy)
  --dryRun                      Write patched plan only; image2video still uploads --image to obtain a provider URI
  --noDownload                  Submit/poll but do not download artifacts
  --pollIntervalMs <ms>         Poll interval (default: 3000)
  --maxPolls <n>                Max polls (default: 30)
  --durationSec <sec>           Video duration seconds for text2video (default from capture/client)

Examples:
  jimeng-browser-proxy capture-analyze \\
    --rawNetwork data/jimeng-captures/20260610-subject-create-ui/raw-network.jsonl \\
    --staticRoot packages/jimeng-client/src \\
    --outDir data/jimeng-lab/capture-analysis-subject-create

  jimeng-browser-proxy discovery-worklist \\
    --analysis data/jimeng-lab/capture-analysis-subject-create/normalized/capture-analyze-<stamp>-analysis.json \\
    --probeCandidates data/jimeng-lab/capture-analysis-subject-create/raw/capture-analyze-<stamp>-endpoint-probe-candidates.json \\
    --staticRoot packages/jimeng-client/src \\
    --outDir data/jimeng-lab/discovery-worklist-subject-create

  jimeng-browser-proxy static-locate \\
    --analysis data/jimeng-lab/capture-analysis-subject-create/normalized/capture-analyze-<stamp>-analysis.json \\
    --staticRoot packages/jimeng-client/src \\
    --outDir data/jimeng-lab/static-locate-subject-create

  jimeng-browser-proxy video-preprocess-plan \\
    --mode image-create-avatar \\
    --submitId avatar-detect-1 \\
    --imageUri tos-cn-i-tb4s082cfz/k-beauty-host.png \\
    --outDir data/jimeng-lab/video-preprocess-plan

  jimeng-browser-proxy static-inventory \\
    --staticRoot data/jimeng-lab/js-sweep/files,packages/jimeng-client/src \\
    --outDir data/jimeng-lab/static-inventory

  jimeng-browser-proxy contract-infer \\
    --input data/jimeng-lab/proof-20260612-live-generation-matrix \\
    --endpoint /mweb/v1/aigc_draft/generate \\
    --outDir data/jimeng-lab/proof-20260612-live-generation-matrix/contract-infer

  jimeng-browser-proxy generation-contract \\
    --input data/jimeng-lab/proof-20260612-live-generation-matrix \\
    --outDir data/jimeng-lab/proof-20260612-live-generation-matrix/generation-contract

  jimeng-browser-proxy session

  jimeng-browser-proxy agent-catalog \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --endpoints skills,config \\
    --outDir data/jimeng-lab/cli-agent-catalog-smoke

  jimeng-browser-proxy text2image \\
    --capture data/jimeng-captures/<run>/capture-template.raw.json \\
    --prompt "韩系美妆健身UGC创作者，手机自拍，无文字，无水印" \\
    --dryRun

  jimeng-browser-proxy text2image-plan \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --prompt "韩系美妆达人在自然光卧室里展示补水精华，真实手机自拍感，无文字，无水印" \\
    --modelVersion jimeng-5.0 \\
    --resolution 2k \\
    --ratio 9:16 \\
    --sampleStrength 0.5

  jimeng-browser-proxy text2image-compare \\
    --plan data/jimeng-lab/text2image-plan/raw/text2image-plan-<run>-dry-run-plan.json \\
    --rawNetwork data/jimeng-captures/<capture>/raw-network.jsonl \\
    --outDir data/jimeng-lab/text2image-compare

  jimeng-browser-proxy voices \\
    --capture data/jimeng-captures/<run>/capture-template.raw.json

  jimeng-browser-proxy voice-clones \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --limit 50 \\
    --outDir data/jimeng-lab/cli-voice-clones-smoke

  jimeng-browser-proxy voice-clone-submit \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --audioVid v03870g10004d8k1u4nog65hb08dnhig \\
    --name "Kbeauty reference voice" \\
    --dryRun

  jimeng-browser-proxy request-plan-compare \\
    --plan data/jimeng-lab/voice-clone/raw/voice-clone-submit-<run>-dry-run-plan.json \\
    --rawNetwork data/jimeng-captures/<capture>/raw-network.jsonl \\
    --outDir data/jimeng-lab/request-plan-compare

  jimeng-browser-proxy endpoint-probe \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --endpoint /mweb/v1/get_video_by_vid \\
    --variants '[{"name":"vids","body":{"vids":["v03870g10004d8k1u4nog65hb08dnhig"]}},{"name":"vid","body":{"vid":"v03870g10004d8k1u4nog65hb08dnhig"}}]' \\
    --outDir data/jimeng-lab/endpoint-probe-video-info

  jimeng-browser-proxy rate-probe \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --endpoint /mweb/v1/get_common_config \\
    --body '{"is_client_filter":true,"need_beta_model":true,"need_cache":true,"need_refresh":false}' \\
    --requests 12 \\
    --concurrency 3 \\
    --outDir data/jimeng-lab/rate-probe-common-config

  jimeng-browser-proxy assets \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --limit 10 \\
    --outDir data/jimeng-lab/cli-assets-smoke

  jimeng-browser-proxy local-items \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --itemIds 7649332406457060634 \\
    --outDir data/jimeng-lab/cli-local-items-smoke

  jimeng-browser-proxy history-list \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --limit 10 \\
    --filter-types 1,10 \\
    --outDir data/jimeng-lab/cli-history-list-smoke

  jimeng-browser-proxy history-queue \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --historyId 39148697060354 \\
    --outDir data/jimeng-lab/cli-history-queue-smoke

  jimeng-browser-proxy history-records \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --submitId a6bbee65-bed0-4e5b-aaf1-5ab466137b82 \\
    --outDir data/jimeng-lab/cli-history-records-smoke

  jimeng-browser-proxy video-info \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --vid v03870g10004d8k1u4nog65hb08dnhig \\
    --outDir data/jimeng-lab/cli-video-info-smoke

  jimeng-browser-proxy lip-sync-config \\
    --outDir data/jimeng-lab/cli-lip-sync-config-smoke

  jimeng-browser-proxy lip-sync-compare \\
    --plan data/jimeng-lab/proof-20260610-lip-sync-vod-plan/raw/lip-sync-20260609145310-83bdpg-dry-run-plan.json \\
    --rawNetwork data/jimeng-captures/<capture>/raw-network.jsonl \\
    --outDir data/jimeng-lab/lip-sync-compare

  jimeng-browser-proxy text2video-compare \\
    --plan data/jimeng-lab/text2video-plan/raw/text2video-plan-<run>-dry-run-plan.json \\
    --rawNetwork data/jimeng-captures/<capture>/raw-network.jsonl \\
    --outDir data/jimeng-lab/text2video-compare

  jimeng-browser-proxy omni-video-plan \\
    --prompt "@image_file_1 as the new host, mimic timing and hand motion from @video_file_1, Korean beauty UGC phone video" \\
    --materials '[{"type":"image","fieldName":"image_file_1","uri":"tos-cn-i-tb4s082cfz/persona.png","width":1080,"height":1920},{"type":"video","fieldName":"video_file_1","vid":"v03870g10004d8k1u4nog65hb08dnhig","width":1080,"height":1920,"durationSec":8}]' \\
    --modelVersion jimeng-video-seedance-2.0 \\
    --durationSec 8 \\
    --outDir data/jimeng-lab/omni-video-plan

  jimeng-browser-proxy omni-video-compare \\
    --plan data/jimeng-lab/omni-video-plan/raw/omni-video-plan-<run>-dry-run-plan.json \\
    --rawNetwork data/jimeng-captures/<capture>/raw-network.jsonl \\
    --outDir data/jimeng-lab/omni-video-compare

  jimeng-browser-proxy tts \\
    --voice-id 7597003459665072686 \\
    --text "这条视频值得试一下。"

  jimeng-browser-proxy upload-token --scene image

  jimeng-browser-proxy templates \\
    --limit 10 \\
    --category-id 11222 \\
    --work-types image,video,canvas

  jimeng-browser-proxy short-videos \\
    --limit 5 \\
    --category-id 11222 \\
    --feed-refer feed_enterauto

  jimeng-browser-proxy overseas-short-videos \\
    --limit 5 \\
    --category-id 11222 \\
    --outDir data/jimeng-lab/cli-overseas-short-videos-smoke

  jimeng-browser-proxy capcut-categories \\
    --outDir data/jimeng-lab/cli-capcut-categories-smoke

  jimeng-browser-proxy capcut-collections \\
    --outDir data/jimeng-lab/cli-capcut-collections-smoke

  jimeng-browser-proxy capcut-collection-templates \\
    --collection-id 10034 \\
    --limit 5 \\
    --outDir data/jimeng-lab/cli-capcut-collection-templates-smoke

  jimeng-browser-proxy capcut-template-detail \\
    --template-id 7369116096600771846 \\
    --outDir data/jimeng-lab/cli-capcut-template-detail-smoke

  jimeng-browser-proxy capcut-probe \\
    --endpoint /lv/v1/cc_web/plane/fuzzy_search_templates \\
    --body '{"sdk_version":"16.1.0","keyword":"makeup"}' \\
    --outDir data/jimeng-lab/cli-capcut-probe-smoke

  jimeng-browser-proxy capcut-probe \\
    --endpoint /lv/v1/editor/template/recent_list \\
    --body '{"count":5,"lang":"en"}' \\
    --outDir data/jimeng-lab/cli-lv-template-recent-probe

  jimeng-browser-proxy capcut-template-metadata \\
    --outDir data/jimeng-lab/cli-capcut-template-metadata-smoke

  jimeng-browser-proxy image-models \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --outDir data/jimeng-lab/cli-image-models-smoke

  jimeng-browser-proxy commerce-benefits \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --endpoints metadata,user-benefits \\
    --outDir data/jimeng-lab/cli-commerce-benefits-smoke

  jimeng-browser-proxy account-config \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --endpoints all \\
    --outDir data/jimeng-lab/cli-account-config-smoke

  jimeng-browser-proxy runtime-config \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --endpoints all \\
    --outDir data/jimeng-lab/cli-runtime-config-smoke

  jimeng-browser-proxy workspace-context \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --endpoints list,get-by-ids \\
    --limit 20 \\
    --outDir data/jimeng-lab/cli-workspace-context-smoke

  jimeng-browser-proxy research-keywords \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --endpoints suggest,guess \\
    --channels inspiration,short-film,asset \\
    --keyword "韩系美妆" \\
    --limit 10 \\
    --outDir data/jimeng-lab/cli-research-keywords-smoke

  jimeng-browser-proxy research-search \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --channel short-film \\
    --keyword "韩系美妆" \\
    --limit 12 \\
    --outDir data/jimeng-lab/cli-research-search-smoke

  jimeng-browser-proxy subjects \\
    --limit 20 \\
    --outDir data/jimeng-lab/cli-subjects-smoke

  jimeng-browser-proxy describe-image \\
    --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \\
    --outDir data/jimeng-lab/cli-reference-image-smoke

  jimeng-browser-proxy controlnet-preview \\
    --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \\
    --control pose \\
    --outDir data/jimeng-lab/cli-controlnet-preview-smoke

  jimeng-browser-proxy object-mask \\
    --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \\
    --mode both \\
    --outDir data/jimeng-lab/cli-object-mask-smoke

  jimeng-browser-proxy upload-image \\
    --file data/jimeng-lab/image-upload-probe/aws4-live/proof-1x1.png \\
    --outDir data/jimeng-lab/cli-image-upload-smoke

  jimeng-browser-proxy upload-video \\
    --file data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4 \\
    --outDir data/jimeng-lab/cli-video-upload-smoke

  jimeng-browser-proxy subject-create \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --workspaceId 14199856180236 \\
    --name "K-beauty UGC persona" \\
    --description "韩系美妆健身UGC创作者，真实手机自拍参考图。" \\
    --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png

  jimeng-browser-proxy subject-update \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --subjectId 12352249053442 \\
    --name "CLI Kbeauty UGC tuned" \\
    --description "韩系美妆健身UGC创作者，真实手机自拍参考图。" \\
    --imageUri tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png \\
    --imageWidth 2048 \\
    --imageHeight 2048

  jimeng-browser-proxy subject-delete \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --subjectId 12352249053442 \\
    --dryRun

  jimeng-browser-proxy subject-generate-voice \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --imageUri tos-cn-i-tb4s082cfz/d56ac871b3a94f77bc83ac84a861ede6.png \\
    --dryRun

  jimeng-browser-proxy image2video \\
    --capture data/jimeng-captures/<run>/capture-template.raw.json \\
    --image data/tiktok-catalogue/mynameissico/2026-05-21_7642426706115972365.jpg \\
    --prompt "韩系美妆达人自拍风格，干净卧室自然光，前三秒有明确痛点钩子，无字幕，无水印" \\
    --durationSec 3 \\
    --dryRun

  jimeng-browser-proxy frames2video \\
    --capture data/jimeng-captures/<run>/capture-template.raw.json \\
    --image data/jimeng-lab/references/start.png \\
    --lastImage data/jimeng-lab/references/end.png \\
    --prompt "韩系美妆达人从自然站姿走到产品特写，真实手机拍摄感，无字幕，无水印" \\
    --durationSec 5 \\
    --dryRun

  jimeng-browser-proxy lip-sync \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --video data/jimeng-lab/proof-20260609-image2video-live/artifacts/aa83d0e1-a20c-4b85-ab59-ee3a7894296f-00.mp4 \\
    --voice-id 7597003459665072686 \\
    --text "三秒告诉你为什么这款补水精华适合熬夜后的底妆。" \\
    --dryRun

  jimeng-browser-proxy lip-sync \\
    --session data/jimeng-lab/raw/session-bundle-current.json \\
    --image data/jimeng-lab/ugc-studio-kbeauty-image/artifacts/jimeng-kbeauty-01.png \\
    --voice-id 7597003459665072686 \\
    --text "三秒告诉你为什么这款补水精华适合熬夜后的底妆。" \\
    --dryRun

Live generation uses the browser session but does not foreground the browser. Keep concurrency at 1.`

interface CliArgs {
  command:
    | "session"
    | "capture-analyze"
    | "discovery-worklist"
    | "static-locate"
    | "static-inventory"
    | "contract-infer"
    | "generation-contract"
    | "triage-coverage"
    | "catalog"
    | "agent-catalog"
    | "image-models"
    | "text2image-plan"
    | "text2image-compare"
    | "text2video-plan"
    | "text2video-compare"
    | "omni-video-plan"
    | "omni-video-compare"
    | "generate-audit-plan"
    | "mix-audio-plan"
    | "video-preprocess-plan"
    | "video-preprocess-query-plan"
    | "request-plan-compare"
    | "account-credit"
    | "commerce-benefits"
    | "commerce-pricing"
    | "account-config"
    | "runtime-config"
    | "workspace-context"
    | "research-keywords"
    | "research-search"
    | "profile-research"
    | "local-items"
    | "story-records"
    | "async-tasks"
    | "story-export-plan"
    | "infinite-canvas"
    | "endpoint-probe"
    | "rate-probe"
    | "lip-sync-config"
    | "lip-sync-compare"
    | "voices"
    | "voice-clones"
    | "voice-clone-submit"
    | "voice-clone-query"
    | "voice-clone-update"
    | "voice-clone-delete"
    | "tts"
    | "sample-voices"
    | "assets"
    | "history-list"
    | "history-queue"
    | "history-records"
    | "video-info"
    | "templates"
    | "short-videos"
    | "overseas-short-videos"
    | "capcut-probe"
    | "capcut-categories"
    | "capcut-collections"
    | "capcut-collection-templates"
    | "capcut-template-detail"
    | "capcut-template-metadata"
    | "capcut-editor-catalog"
    | "subjects"
    | "describe-image"
    | "controlnet-preview"
    | "object-mask"
    | "upload-token"
    | "upload-image"
    | "upload-video"
    | "subject-create"
    | "subject-update"
    | "subject-delete"
    | "subject-generate-voice"
    | "text2image"
    | "text2video"
    | "image2video"
    | "frames2video"
    | "lip-sync"
  cdpUrl: string
  targetUrl?: string
  session?: string
  sessionOut: string
  capture?: string
  rawNetwork?: string
  captureDir?: string
  input?: string
  analysisFiles?: string[]
  probeCandidateFiles?: string[]
  staticRoots?: string[]
  staticQueries?: string[]
  contextLines?: number
  includeRisky: boolean
  includeKnown: boolean
  decisions: JimengDiscoveryTriageDecision[]
  plan?: string
  endpoint?: string
  method?: "GET" | "POST"
  query?: string
  body?: string
  materials?: string
  babiParam?: string
  videoItemId?: string
  inputList?: string
  videoPreprocessMode?: JimengVideoPreprocessMode
  imageUris?: string
  detectionScene?: string
  batch?: boolean
  variants?: string
  transportMode: JimengHttpTransportMode
  cassette?: string
  requests?: number
  concurrency?: number
  delayMs?: number
  endpoints?: string
  channels?: string
  searchId?: string
  source?: string
  assetType?: string
  blockIndex?: number
  showTypeList?: number[]
  secUid?: string
  language?: string
  publishedItemId?: string
  publishedItemIds?: string[]
  itemIds?: string[]
  storyIds?: string[]
  imageTypeList?: number[]
  needIntentionMark?: boolean
  isInsertFrame?: boolean
  hideStoryAgentResult?: boolean
  beginTimeStamp?: number
  text?: string
  voiceId?: string
  voiceTitle?: string
  voiceStatuses?: string[]
  audioVid?: string
  audioUrl?: string
  audioDurationSec?: number
  audioTitle?: string
  taskIds?: string[]
  toneKey?: string
  toneCategoryId?: string
  toneCategoryKey?: string
  speed?: number
  itemPlatform?: number
  limit?: number
  offset?: number
  assetTypes?: number[]
  filterTypes?: number[]
  assetMode?: string
  submitId?: string
  submitIds?: string[]
  historyId?: string
  historyIds?: string[]
  vids?: string[]
  direction?: number
  orderBy?: number
  endTimeStamp?: number
  includeStoryAgentResult?: boolean
  cursor?: number
  keyword?: string
  subjectId?: string
  subjectIds?: string[]
  onlyFavorite?: boolean
  imageInfo?: boolean
  projectId?: string
  userId?: string
  workspaceIds?: string[]
  needDraftResource?: boolean
  categoryId?: number
  workTypes?: string
  feedRefer?: string
  capcutLan?: string
  capcutLoc?: string
  capcutCollectionId?: number
  capcutTemplateId?: string
  capcutCategoryType?: string | number
  capcutScale?: number
  canvasWidth?: number
  canvasHeight?: number
  needDraft?: boolean
  isClientFilter?: boolean
  needBetaModel?: boolean
  needCache?: boolean
  needRefresh?: boolean
  panel?: string
  category?: string
  lang?: string
  region?: string
  scene?: string
  file?: string
  video?: string
  imageUri?: string
  noDescription: boolean
  noFaces: boolean
  control?: string
  strength?: number
  fitMode?: string
  noPoseDetect: boolean
  maskMode?: string
  vid?: string
  videoUri?: string
  videoWidth?: number
  videoHeight?: number
  videoDurationSec?: number
  videoMode?: string
  imageWidth?: number
  imageHeight?: number
  imageUrl?: string
  name?: string
  description?: string
  workspaceId?: number
  image?: string
  lastImage?: string
  firstFrameUri?: string
  lastFrameUri?: string
  ratio?: string
  videoResolution?: string
  resolution?: string
  fps?: number
  modelVersion?: string
  modelReqKey?: string
  seed?: number
  sampleStrength?: number
  negativePrompt?: string
  intelligentRatio?: boolean
  prompt?: string
  outDir: string
  dryRun: boolean
  noDownload: boolean
  pollIntervalMs: number
  maxPolls: number
  durationSec?: number
}

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)

  if (args.command === "session") {
    const session = await loadJimengSessionFromBrowser({ cdpUrl: args.cdpUrl, targetUrl: args.targetUrl })
    const file = path.resolve(args.sessionOut)
    mkdirSync(path.dirname(file), { recursive: true })
    writeJson(file, session)
    console.log(`[jimeng-browser-proxy] session saved: ${file}`)
    return
  }

  if (args.command === "capture-analyze") {
    const rawNetworkFile = resolveRawNetworkFile(args)
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `capture-analyze-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const analysis = analyzeJimengNetworkCaptureFile({
      rawNetworkFile,
      staticRoots: args.staticRoots,
      limit: args.limit,
      includeRisky: args.includeRisky,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-analysis.json`), analysis)
    writeJson(path.join(dirs.rawDir, `${runId}-endpoint-probe-candidates.json`), {
      source_path: analysis.source_path,
      generated_at_iso: analysis.analyzed_at_iso,
      candidates: analysis.endpoint_probe_candidates,
      warning: "Local-only replay bodies. Re-check risk_class before replaying generate, upload, mutate, or payment endpoints.",
    })
    writeFileSync(path.join(dirs.normalizedDir, `${runId}-summary.md`), writeJimengCaptureAnalysisMarkdown(analysis), "utf8")
    console.log(`[jimeng-browser-proxy] capture-analyze saved candidates=${analysis.candidates.length} replay=${analysis.endpoint_probe_candidates.length}`)
    return
  }

  if (args.command === "discovery-worklist") {
    const analysisFiles = args.analysisFiles ?? []
    if (analysisFiles.length === 0) throw new Error("discovery-worklist requires --analysis")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `discovery-worklist-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const analyses = analysisFiles.map(readJimengCaptureAnalysisFile)
    const probeCandidates = (args.probeCandidateFiles ?? []).flatMap(readJimengEndpointProbeCandidateFile)
    const worklist = buildJimengDiscoveryWorklist({
      analyses,
      analysisFiles: analysisFiles.map((file) => path.resolve(file)),
      probeCandidates,
      staticRoots: args.staticRoots,
      includeKnown: args.includeKnown,
    })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), worklist)
    const exportedVariants = worklist.probe_variant_exports.map((candidate) => {
      const file = path.join(dirs.rawDir, `${runId}-${slug(candidate.endpoint)}-variants.json`)
      writeJson(file, {
        endpoint: candidate.endpoint,
        method: candidate.method,
        query: candidate.query,
        risk_class: candidate.risk_class,
        variants: candidate.variants,
      })
      return {
        endpoint: candidate.endpoint,
        method: candidate.method,
        query: candidate.query,
        risk_class: candidate.risk_class,
        replay_safe_by_default: candidate.replay_safe_by_default,
        variant_count: candidate.variant_count,
        file,
      }
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengDiscoveryWorklist(worklist),
      exported_probe_variants: exportedVariants,
    })
    writeFileSync(path.join(dirs.normalizedDir, `${runId}-summary.md`), writeJimengDiscoveryWorklistMarkdown(worklist), "utf8")
    console.log(`[jimeng-browser-proxy] discovery-worklist saved items=${worklist.work_item_count} probe_exports=${exportedVariants.length}`)
    return
  }

  if (args.command === "static-locate") {
    const endpoints = parseJimengStaticLocatorEndpoints(args.endpoint)
    const queries = args.staticQueries ?? []
    const analysisFiles = args.analysisFiles ?? []
    if ((args.staticRoots ?? []).length === 0) throw new Error("static-locate requires --staticRoot")
    if (endpoints.length === 0 && analysisFiles.length === 0 && queries.length === 0) throw new Error("static-locate requires --endpoint, --analysis, --query, or --symbol")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `static-locate-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const result = locateJimengStaticEndpoints({
      staticRoots: args.staticRoots ?? [],
      endpoints,
      queries,
      analysisFiles,
      contextLines: args.contextLines,
      limitPerEndpoint: args.limit,
    })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), result)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengStaticLocator(result),
    })
    writeFileSync(path.join(dirs.normalizedDir, `${runId}-summary.md`), writeJimengStaticLocatorMarkdown(result), "utf8")
    console.log(`[jimeng-browser-proxy] static-locate saved endpoints=${result.endpoints.length} occurrences=${result.endpointResults.reduce((sum, item) => sum + item.occurrenceCount, 0)}`)
    return
  }

  if (args.command === "static-inventory") {
    if ((args.staticRoots ?? []).length === 0) throw new Error("static-inventory requires --staticRoot")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `static-inventory-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const result = inventoryJimengStaticApis({
      staticRoots: args.staticRoots ?? [],
      includeKnown: args.includeKnown,
      limit: args.limit,
    })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), result)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengStaticInventory(result),
    })
    writeFileSync(path.join(dirs.normalizedDir, `${runId}-summary.md`), writeJimengStaticInventoryMarkdown(result), "utf8")
    console.log(`[jimeng-browser-proxy] static-inventory saved resources=${result.totalResourceCount} included=${result.includedResourceCount} high_value_gaps=${result.highValueGapCount}`)
    return
  }

  if (args.command === "contract-infer") {
    if (!args.input) throw new Error("contract-infer requires --input")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const outDir = path.join(dirs.normalizedDir, "contract")
    const inference = inferJimengContractsFromPath({
      inputPath: args.input,
      endpoint: args.endpoint,
      outDir,
    })
    const files = writeJimengContractInferenceOutputs(inference, outDir)
    writeJson(path.join(dirs.rawDir, "contract-infer-inputs.json"), {
      command: args.command,
      input: path.resolve(args.input),
      endpoint: args.endpoint ?? null,
      output_files: files,
    })
    console.log(`[jimeng-browser-proxy] contract-infer saved endpoints=${inference.endpoints.length} documents=${inference.file_count} artifacts=${inference.artifact_count}`)
    return
  }

  if (args.command === "generation-contract") {
    if (!args.input) throw new Error("generation-contract requires --input")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const outDir = path.join(dirs.normalizedDir, "generation-contract")
    const report = buildJimengGenerationContractReport(args.input)
    const files = writeJimengGenerationContractReportOutputs(report, outDir)
    writeJson(path.join(dirs.rawDir, "generation-contract-inputs.json"), {
      command: args.command,
      input: path.resolve(args.input),
      output_files: files,
    })
    console.log(`[jimeng-browser-proxy] generation-contract saved proofs=${report.proof_count} skipped=${report.skipped_json_count}`)
    return
  }

  if (args.command === "triage-coverage") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `triage-coverage-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const coverage = summarizeJimengDiscoveryTriageCoverage({ decisions: args.decisions })
    const knownByEndpoint = buildJimengDiscoveryKnownEndpointMap()
    writeJson(path.join(dirs.rawDir, `${runId}.json`), coverage)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      decisions: coverage.decisions,
      family_count: coverage.familyCount,
      unique_endpoint_count: coverage.uniqueEndpointCount,
      missing_endpoint_count: coverage.missingEndpointCount,
      status_counts: coverage.statusCounts,
      value_ranked_gaps: coverage.valueRankedGaps.map((gap) => ({
        value_rank: gap.valueRank,
        workflow: gap.workflow,
        implementation_rank: gap.implementationRank,
        family_id: gap.familyId,
        family_title: gap.familyTitle,
        endpoint: gap.endpoint,
        status: gap.status,
        command: gap.command,
        note: gap.note,
        evidence: gap.evidence,
        next_probe: gap.nextProbe,
      })),
      families: coverage.families.map((family) => ({
        id: family.id,
        decision: family.decision,
        title: family.title,
        endpoint_count: family.endpointCount,
        status_counts: family.statusCounts,
        not_implemented_count: family.notImplementedEndpoints.length,
        not_implemented_endpoints: family.notImplementedEndpoints,
        not_implemented: family.notImplementedEndpoints.map((endpoint) => {
          const row = knownByEndpoint.get(endpoint)
          return {
            endpoint,
            status: row?.status ?? "missing",
            command: row?.command ?? null,
            note: row?.note ?? null,
            evidence: row?.evidence ?? [],
            next_probe: row?.nextProbe ?? null,
          }
        }),
      })),
    })
    writeFileSync(path.join(dirs.normalizedDir, `${runId}-summary.md`), writeJimengDiscoveryTriageCoverageMarkdown(coverage), "utf8")
    console.log(`[jimeng-browser-proxy] triage-coverage saved decisions=${coverage.decisions.join(",")} families=${coverage.familyCount} missing=${coverage.missingEndpointCount}`)
    return
  }

  if (args.command === "text2image-plan") {
    if (!args.prompt) throw new Error("text2image-plan requires --prompt")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `text2image-plan-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const plan = buildJimengText2ImageDirectPlan({
      prompt: args.prompt,
      modelVersion: args.modelVersion,
      modelReqKey: args.modelReqKey,
      resolution: args.resolution,
      ratio: args.ratio,
      sampleStrength: args.sampleStrength,
      negativePrompt: args.negativePrompt,
      intelligentRatio: args.intelligentRatio,
      seed: args.seed,
      submitId: args.submitId,
    })
    writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
      command: args.command,
      endpoint: plan.endpoint,
      method: plan.method,
      query: plan.query,
      request: plan.request,
      draft_content: plan.draftContent,
      metrics_extra: plan.metricsExtra,
      live_submit: false,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengText2ImageDirectPlan(plan),
    })
    console.log(`[jimeng-browser-proxy] text2image-plan saved model=${plan.modelReqKey} resolution=${plan.resolution} ratio=${plan.ratio} live_submit=false`)
    return
  }

  if (args.command === "text2image-compare") {
    if (!args.plan) throw new Error("text2image-compare requires --plan")
    if (!args.rawNetwork && !args.captureDir && !args.capture) {
      throw new Error("text2image-compare requires --rawNetwork, --captureDir, or --capture")
    }
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `text2image-compare-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const dryRunPlanText = readFileSync(path.resolve(args.plan), "utf8")
    const result = args.capture
      ? compareJimengText2ImageDirectPlanWithCaptureTemplate({
        dryRunPlanText,
        captureTemplateText: readFileSync(path.resolve(args.capture), "utf8"),
      })
      : compareJimengText2ImageDirectPlanWithRawNetwork({
        dryRunPlanText,
        rawNetworkText: readFileSync(resolveRawNetworkFile(args), "utf8"),
      })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), result)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengText2ImageDirectCompare(result),
    })
    console.log(`[jimeng-browser-proxy] text2image-compare saved match=${result.match} candidates=${result.candidate_count}`)
    return
  }

  if (args.command === "text2video-plan") {
    if (!args.prompt) throw new Error("text2video-plan requires --prompt")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `text2video-plan-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const videoMode = args.videoMode ? Number(args.videoMode) : undefined
    const plan = buildJimengVideoDirectPlan({
      prompt: args.prompt,
      modelVersion: args.modelVersion,
      modelReqKey: args.modelReqKey,
      ratio: args.ratio,
      videoResolution: args.videoResolution,
      durationSec: args.durationSec,
      fps: args.fps,
      videoMode,
      seed: args.seed,
      submitId: args.submitId,
      firstFrameUri: args.firstFrameUri,
      lastFrameUri: args.lastFrameUri,
    })
    writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
      command: args.command,
      endpoint: plan.endpoint,
      method: plan.method,
      query: plan.query,
      request: plan.request,
      draft_content: plan.draftContent,
      metrics_extra: plan.metricsExtra,
      live_submit: false,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengVideoDirectPlan(plan),
    })
    console.log(`[jimeng-browser-proxy] text2video-plan saved model=${plan.modelReqKey} resolution=${plan.videoResolution} ratio=${plan.ratio} duration=${plan.durationSec}s live_submit=false`)
    return
  }

  if (args.command === "omni-video-plan") {
    if (!args.prompt) throw new Error("omni-video-plan requires --prompt")
    if (!args.materials) throw new Error("omni-video-plan requires --materials")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `omni-video-plan-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const materialJson = JSON.parse(readInlineOrFile(args.materials)) as JsonValue
    const plan = buildJimengVideoOmniReferencePlan({
      prompt: args.prompt,
      materials: parseJimengVideoOmniMaterialsJson(materialJson),
      modelVersion: args.modelVersion,
      modelReqKey: args.modelReqKey,
      ratio: args.ratio,
      durationSec: args.durationSec,
      fps: args.fps,
      seed: args.seed,
      submitId: args.submitId,
    })
    writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
      command: args.command,
      endpoint: plan.endpoint,
      method: plan.method,
      query: plan.query,
      request: plan.request,
      draft_content: plan.draftContent,
      metrics_extra: plan.metricsExtra,
      material_list: plan.materialList,
      meta_list: plan.metaList,
      live_submit: false,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengVideoOmniReferencePlan(plan),
    })
    console.log(`[jimeng-browser-proxy] omni-video-plan saved model=${plan.modelReqKey} materials=${plan.materialList.length} duration=${plan.durationSec}s live_submit=false`)
    return
  }

  if (args.command === "omni-video-compare") {
    if (!args.plan) throw new Error("omni-video-compare requires --plan")
    if (!args.rawNetwork && !args.captureDir && !args.capture) {
      throw new Error("omni-video-compare requires --rawNetwork, --captureDir, or --capture")
    }
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `omni-video-compare-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const dryRunPlanText = readFileSync(path.resolve(args.plan), "utf8")
    const result = args.capture
      ? compareJimengVideoOmniPlanWithCaptureTemplate({
        dryRunPlanText,
        captureTemplateText: readFileSync(path.resolve(args.capture), "utf8"),
      })
      : compareJimengVideoOmniPlanWithRawNetwork({
        dryRunPlanText,
        rawNetworkText: readFileSync(resolveRawNetworkFile(args), "utf8"),
      })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), result)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengVideoOmniCompare(result),
    })
    console.log(`[jimeng-browser-proxy] omni-video-compare saved match=${result.match} candidates=${result.candidate_count}`)
    return
  }

  if (args.command === "text2video-compare") {
    if (!args.plan) throw new Error("text2video-compare requires --plan")
    if (!args.rawNetwork && !args.captureDir && !args.capture) {
      throw new Error("text2video-compare requires --rawNetwork, --captureDir, or --capture")
    }
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `text2video-compare-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const dryRunPlanText = readFileSync(path.resolve(args.plan), "utf8")
    const result = args.capture
      ? compareJimengVideoDirectPlanWithCaptureTemplate({
        dryRunPlanText,
        captureTemplateText: readFileSync(path.resolve(args.capture), "utf8"),
      })
      : compareJimengVideoDirectPlanWithRawNetwork({
        dryRunPlanText,
        rawNetworkText: readFileSync(resolveRawNetworkFile(args), "utf8"),
      })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), result)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengVideoDirectCompare(result),
    })
    console.log(`[jimeng-browser-proxy] text2video-compare saved match=${result.match} candidates=${result.candidate_count}`)
    return
  }

  if (args.command === "generate-audit-plan") {
    if (!args.materials) throw new Error("generate-audit-plan requires --materials")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `generate-audit-plan-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const materialJson = JSON.parse(readInlineOrFile(args.materials)) as JsonValue
    const plan = buildJimengGenerateAuditPlan({
      materials: parseJimengGenerateAuditMaterialsJson(materialJson),
      extraRequest: parseJsonObjectFlag(args.body, "--body"),
    })
    writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
      command: args.command,
      endpoint: plan.endpoint,
      method: plan.method,
      query: plan.query,
      request: plan.request,
      material_list: plan.materialList,
      live_submit: false,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengGenerateAuditPlan(plan),
    })
    console.log(`[jimeng-browser-proxy] generate-audit-plan saved materials=${plan.materialList.length} live_submit=false`)
    return
  }

  if (args.command === "mix-audio-plan") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `mix-audio-plan-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const bodyJson = args.body
      ? parseJimengMixAudioJsonObject(JSON.parse(readInlineOrFile(args.body)) as JsonValue, "mix-audio body")
      : undefined
    const babiParamJson = args.babiParam
      ? parseJimengMixAudioJsonObject(JSON.parse(readInlineOrFile(args.babiParam)) as JsonValue, "mix-audio babiParam")
      : undefined
    const inputListJson = args.inputList
      ? parseJimengMixAudioInputListJson(JSON.parse(readInlineOrFile(args.inputList)) as JsonValue)
      : undefined
    const plan = buildJimengMixAudioVideoPlan({
      mode: args.batch ? "batch" : undefined,
      audioVid: args.audioVid,
      videoItemId: args.videoItemId,
      inputList: inputListJson,
      body: bodyJson,
      babiParam: babiParamJson,
    })
    writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
      command: args.command,
      endpoint: plan.endpoint,
      method: plan.method,
      request: plan.request,
      query_params: plan.queryParams,
      live_submit: false,
      static_evidence: "frontend submitMixAudioVideoTask omits babiParam from body, snake-cases the remaining body, and sends JSON.stringify(babiParam) as query babi_param",
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengMixAudioVideoPlan(plan),
    })
    console.log(`[jimeng-browser-proxy] mix-audio-plan saved endpoint=${plan.endpoint} mode=${plan.mode} inputs=${plan.inputCount} live_submit=false`)
    return
  }

  if (args.command === "video-preprocess-plan") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `video-preprocess-plan-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const bodyJson = args.body
      ? parseJimengVideoPreprocessBodyJson(JSON.parse(readInlineOrFile(args.body)) as JsonValue)
      : undefined
    const imageUrisJson = args.imageUris
      ? parseJimengVideoPreprocessImageUris(JSON.parse(readInlineOrFile(args.imageUris)) as JsonValue)
      : undefined
    const plan = buildJimengVideoPreprocessPlan({
      mode: args.videoPreprocessMode,
      submitId: args.submitId,
      imageUri: args.imageUri,
      imageUris: imageUrisJson,
      audioVid: args.audioVid,
      prompt: args.prompt,
      detectionScene: args.detectionScene,
      body: bodyJson,
    })
    writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
      command: args.command,
      endpoint: plan.endpoint,
      method: plan.method,
      request: plan.request,
      input_list: plan.inputList,
      live_submit: false,
      static_evidence: "frontend video-preprocessing-data-service snake-cases { inputList } into input_list and posts it to /mweb/v1/video_generate/pre_process; useful lip-sync scenes include ImageCreateAvatar=2, LipSyncAudioDetect=5, LipSyncAudioSilence=6, and LipSyncVoiceRecommendation=7",
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengVideoPreprocessPlan(plan),
    })
    console.log(`[jimeng-browser-proxy] video-preprocess-plan saved mode=${plan.mode} inputs=${plan.inputCount} live_submit=false`)
    return
  }

  if (args.command === "video-preprocess-query-plan") {
    const submitIds = args.submitIds ?? (args.submitId ? [args.submitId] : [])
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `video-preprocess-query-plan-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const plan = buildJimengVideoPreprocessQueryPlan(submitIds)
    writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
      command: args.command,
      endpoint: plan.endpoint,
      method: plan.method,
      request: plan.request,
      live_submit: false,
      static_evidence: "frontend video-preprocessing-data-service snake-cases { submitIdList } into submit_id_list and posts it to /mweb/v1/video_generate/mget_pre_process_result",
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengVideoPreprocessQueryPlan(plan),
    })
    console.log(`[jimeng-browser-proxy] video-preprocess-query-plan saved submitIds=${plan.submitIds.length} live_submit=false`)
    return
  }

  if (args.command === "request-plan-compare") {
    if (!args.plan) throw new Error("request-plan-compare requires --plan")
    if (!args.rawNetwork && !args.captureDir && !args.capture) {
      throw new Error("request-plan-compare requires --rawNetwork, --captureDir, or --capture")
    }
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `request-plan-compare-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const dryRunPlanText = readFileSync(path.resolve(args.plan), "utf8")
    const result = args.capture
      ? compareJimengRequestPlanWithCaptureTemplate({
        dryRunPlanText,
        captureTemplateText: readFileSync(path.resolve(args.capture), "utf8"),
        endpoint: args.endpoint,
      })
      : compareJimengRequestPlanWithRawNetwork({
        dryRunPlanText,
        rawNetworkText: readFileSync(resolveRawNetworkFile(args), "utf8"),
        endpoint: args.endpoint,
      })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), result)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengRequestPlanCompare(result),
    })
    console.log(`[jimeng-browser-proxy] request-plan-compare saved endpoint=${result.plan_endpoint} match=${result.match} candidates=${result.candidate_count}`)
    return
  }

  if (args.command === "lip-sync-compare") {
    if (!args.plan) throw new Error("lip-sync-compare requires --plan")
    if (!args.rawNetwork && !args.captureDir && !args.capture) {
      throw new Error("lip-sync-compare requires --rawNetwork, --captureDir, or --capture")
    }
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `lip-sync-compare-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const dryRunPlanText = readFileSync(path.resolve(args.plan), "utf8")
    const result = args.capture
      ? compareJimengLipSyncPlanWithCaptureTemplate({
        dryRunPlanText,
        captureTemplateText: readFileSync(path.resolve(args.capture), "utf8"),
      })
      : compareJimengLipSyncPlanWithRawNetwork({
        dryRunPlanText,
        rawNetworkText: readFileSync(resolveRawNetworkFile(args), "utf8"),
      })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), result)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengLipSyncCompare(result),
    })
    console.log(`[jimeng-browser-proxy] lip-sync-compare saved match=${result.match} candidates=${result.candidate_count}`)
    return
  }

  if (args.command === "capcut-collections") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = {
      categoryType: args.capcutCategoryType,
      scale: args.capcutScale,
      canvasWidth: args.canvasWidth,
      canvasHeight: args.canvasHeight,
      lan: args.capcutLan,
      loc: args.capcutLoc,
    }
    const request = buildCapCutTemplateCollectionsRequest(query)
    const runId = `capcut-collections-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: ["/lv/v1/cc_web/plane/get_collections"],
        host: "https://edit-api-sg.capcut.com",
        query,
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session_required: false,
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/lv/v1/cc_web/plane/get_collections",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
      })
      console.log("[jimeng-browser-proxy] capcut-collections dry run saved")
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchCapCutTemplateCollections({ fetch: transport.fetch, query })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      log_id: result.logId,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeCapCutTemplateCollections(result),
    })
    console.log(`[jimeng-browser-proxy] capcut-collections saved count=${result.collections.length}`)
    return
  }

  if (args.command === "capcut-collection-templates") {
    if (!args.capcutCollectionId) throw new Error("capcut-collection-templates requires --collection-id")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = {
      collectionId: args.capcutCollectionId,
      count: args.limit ?? 20,
      cursor: args.cursor,
      lan: args.capcutLan,
      loc: args.capcutLoc,
      lang: args.capcutLan,
    }
    const request = buildCapCutCollectionTemplatesRequest(query)
    const runId = `capcut-collection-templates-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: ["/lv/v1/cc_web/plane/get_collection_templates"],
        host: "https://edit-api-sg.capcut.com",
        query,
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session_required: false,
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/lv/v1/cc_web/plane/get_collection_templates",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
      })
      console.log("[jimeng-browser-proxy] capcut-collection-templates dry run saved")
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchCapCutCollectionTemplates({ fetch: transport.fetch, query })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      log_id: result.logId,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeCapCutCollectionTemplates(result),
    })
    console.log(`[jimeng-browser-proxy] capcut-collection-templates saved count=${result.templates.length} hasMore=${result.hasMore ?? "unknown"}`)
    return
  }

  if (args.command === "capcut-template-detail") {
    if (!args.capcutTemplateId) throw new Error("capcut-template-detail requires --template-id")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = {
      templateId: args.capcutTemplateId,
      needDraft: args.needDraft ?? false,
      lan: args.capcutLan,
      loc: args.capcutLoc,
      lang: args.capcutLan,
      region: args.capcutLoc,
    }
    const request = buildCapCutTemplateDetailRequest(query)
    const runId = `capcut-template-detail-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: ["/lv/v1/cc_web/plane/get_template_detail"],
        host: "https://edit-api-sg.capcut.com",
        query,
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session_required: false,
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/lv/v1/cc_web/plane/get_template_detail",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
      })
      console.log("[jimeng-browser-proxy] capcut-template-detail dry run saved")
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchCapCutTemplateDetail({ fetch: transport.fetch, query })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      log_id: result.logId,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeCapCutTemplateDetail(result),
    })
    console.log(`[jimeng-browser-proxy] capcut-template-detail saved templateId=${result.detail.templateId} templateUrl=${result.detail.templateUrlPresent ? "yes" : "no"}`)
    return
  }

  if (args.command === "capcut-template-metadata") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const urls = capCutTemplateStaticCatalogUrls()
    const runId = `capcut-template-metadata-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: [
          `GET ${urls.ratioCatalogUrl}`,
          `GET ${urls.sceneCatalogUrl}`,
        ],
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session_required: false,
      })
      console.log(`[jimeng-browser-proxy] capcut-template-metadata dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchCapCutTemplateStaticCatalog({ fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      ratio_catalog_url: result.ratioCatalogUrl,
      scene_catalog_url: result.sceneCatalogUrl,
      ratios_http_status: result.ratiosHttpStatus,
      scenes_http_status: result.scenesHttpStatus,
      ratios_response_text_sha256: result.ratiosResponseTextSha256,
      scenes_response_text_sha256: result.scenesResponseTextSha256,
      ratios_body: result.ratiosBody,
      scenes_body: result.scenesBody,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeCapCutTemplateStaticCatalog(result),
    })
    console.log(`[jimeng-browser-proxy] capcut-template-metadata saved ratios=${result.ratios.length} scenes=${result.scenes.length}`)
    return
  }

  if (args.command === "capcut-editor-catalog") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const endpoints = parseCapCutEditorCatalogEndpoints(args.endpoints)
    const query = {
      endpoints,
      panel: args.panel,
      category: args.category,
      limit: args.limit,
      offset: args.offset,
      lang: args.lang,
      region: args.region,
      lan: args.capcutLan,
      loc: args.capcutLoc,
    }
    const requests = Object.fromEntries(endpoints.map((endpoint) => [endpoint, {
      endpoint: capCutEditorCatalogEndpointPath(endpoint),
      request: buildCapCutEditorCatalogRequest(endpoint, query),
    }]))
    const runId = `capcut-editor-catalog-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: endpoints.map(capCutEditorCatalogEndpointPath),
        host: "https://edit-api-sg.capcut.com",
        query,
        requests,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session_required: false,
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoints,
        requests,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
      })
      console.log(`[jimeng-browser-proxy] capcut-editor-catalog dry run saved endpoints=${endpoints.join(",")}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchCapCutEditorCatalog({ fetch: transport.fetch, query })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      endpoints: result.endpoints,
      results: result.results.map((item) => ({
        endpoint_id: item.endpointId,
        endpoint: item.endpoint,
        host: item.host,
        http_status: item.httpStatus,
        ret: item.ret,
        errmsg: item.errmsg,
        status_code: item.statusCode,
        status_message: item.statusMessage,
        response_text_sha256: item.responseTextSha256,
        request: item.request,
        body: item.body,
      })),
    })
    const summary = summarizeCapCutEditorCatalog(result)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary,
    })
    const totals = result.results.reduce((acc, item) => ({
      categories: acc.categories + item.categoryCount,
      effects: acc.effects + item.effectCount,
      palettes: acc.palettes + item.paletteCount,
    }), { categories: 0, effects: 0, palettes: 0 })
    console.log(`[jimeng-browser-proxy] capcut-editor-catalog saved endpoints=${result.endpoints.join(",")} categories=${totals.categories} effects=${totals.effects} palettes=${totals.palettes}`)
    return
  }

  if (args.command === "capcut-probe") {
    if (!args.endpoint) throw new Error("capcut-probe requires --endpoint")
    if (!args.body && !args.variants) throw new Error("capcut-probe requires --body or --variants")
    const variants = args.variants
      ? parseCapCutEndpointProbeVariants(readInlineOrFile(args.variants))
      : buildSingleCapCutEndpointProbeVariant(args.body!)
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `capcut-probe-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const probe = {
      endpoint: args.endpoint,
      method: args.method,
      variants,
      lan: args.capcutLan,
      loc: args.capcutLoc,
    }
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        host: "https://edit-api-sg.capcut.com",
        probe,
        warning: "Local-only signed CapCut replay plan. Use only read-oriented /lv/v1/cc_web/* endpoints.",
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        probe: {
          endpoint: probe.endpoint,
          method: probe.method ?? "POST",
          variant_count: probe.variants.length,
          capcut_lan: probe.lan ?? "en",
          capcut_loc: probe.loc ?? "us",
        },
      })
      console.log(`[jimeng-browser-proxy] capcut-probe dry run saved variants=${variants.length}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await runCapCutEndpointProbe({ fetch: transport.fetch, probe })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      endpoint: result.endpoint,
      url: result.url,
      method: result.method,
      results: result.results.map((item) => ({
        name: item.name,
        request_body: item.requestBody,
        http_status: item.httpStatus,
        ret: item.ret,
        errmsg: item.errmsg,
        response_text_sha256: item.responseTextSha256,
        body: item.body,
      })),
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeCapCutEndpointProbe(result),
    })
    console.log(`[jimeng-browser-proxy] capcut-probe saved variants=${result.results.length} rets=${result.results.map((item) => `${item.name}:${item.ret ?? "none"}`).join(",")}`)
    return
  }

  if (args.command === "voice-clone-submit") {
    if (!args.dryRun) throw new Error("voice-clone-submit live submit is disabled until explicit spend approval/capture; pass --dryRun")
    if (!args.audioVid) throw new Error("voice-clone-submit requires --audioVid from upload-video/audio upload")
    if (!args.name) throw new Error("voice-clone-submit requires --name")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const request = buildJimengVoiceCloneSubmitRequest({
      audio: {
        vid: args.audioVid,
        audioUrl: args.audioUrl,
        duration: args.audioDurationSec,
        title: args.audioTitle,
      },
      name: args.name,
    })
    const runId = `voice-clone-submit-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const plan = {
      command: args.command,
      status: "dry-run-only",
      reason: "Frontend bundle confirms /mweb/v1/voice/submit_task scene=1 for voice cloning, but live submit may consume quota or create account assets. Capture/approve the UI flow before enabling.",
      endpoint_sequence: ["/mweb/v1/voice/submit_task"],
      request,
      transport: {
        mode: args.transportMode,
        cassette_path: cassettePath ?? null,
      },
      browser_session_required: false,
    }
    writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), plan)
    console.log(`[jimeng-browser-proxy] voice-clone-submit dry run saved`)
    return
  }

  if (args.command === "voice-clone-query" && args.dryRun) {
    const taskIds = args.taskIds ?? []
    if (taskIds.length === 0) throw new Error("voice-clone-query requires --taskIds")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const request = buildJimengVoiceTaskQueryRequest({ taskIds })
    const runId = `voice-clone-query-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const plan = {
      command: args.command,
      status: "dry-run",
      reason: "Task query shape is frontend-confirmed; live query is no-spend once a real task id is available.",
      endpoint_sequence: ["/mweb/v1/voice/query_task"],
      request,
      transport: {
        mode: args.transportMode,
        cassette_path: cassettePath ?? null,
      },
      browser_session_required: false,
    }
    writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), plan)
    console.log(`[jimeng-browser-proxy] voice-clone-query dry run saved`)
    return
  }

  if (args.command === "voice-clone-update") {
    if (!args.dryRun) throw new Error("voice-clone-update live mutation is disabled until a disposable cloned voice fixture exists; pass --dryRun")
    if (!args.voiceId) throw new Error("voice-clone-update requires --voice-id")
    if (!args.name) throw new Error("voice-clone-update requires --name")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const request = buildJimengClonedVoiceUpdateRequest({ voiceId: args.voiceId, name: args.name })
    const runId = `voice-clone-update-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const plan = {
      command: args.command,
      status: "dry-run-only",
      reason: "Update mutates account voice assets; enable live only after a real cloned voice fixture exists and Arthur approves mutation.",
      endpoint_sequence: ["/mweb/v1/voice/update"],
      request,
      transport: {
        mode: args.transportMode,
        cassette_path: cassettePath ?? null,
      },
      browser_session_required: false,
    }
    writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), plan)
    console.log(`[jimeng-browser-proxy] voice-clone-update dry run saved`)
    return
  }

  if (args.command === "voice-clone-delete") {
    if (!args.dryRun) throw new Error("voice-clone-delete live mutation is disabled until a disposable cloned voice fixture exists; pass --dryRun")
    if (!args.voiceId) throw new Error("voice-clone-delete requires --voice-id")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const request = buildJimengClonedVoiceDeleteRequest({ voiceId: args.voiceId })
    const runId = `voice-clone-delete-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const plan = {
      command: args.command,
      status: "dry-run-only",
      reason: "Delete mutates account voice assets; enable live only after a disposable cloned voice fixture exists and Arthur approves mutation.",
      endpoint_sequence: ["/mweb/v1/voice/delete"],
      request,
      transport: {
        mode: args.transportMode,
        cassette_path: cassettePath ?? null,
      },
      browser_session_required: false,
    }
    writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), plan)
    console.log(`[jimeng-browser-proxy] voice-clone-delete dry run saved`)
    return
  }

  if (args.command === "subject-generate-voice") {
    if (!args.dryRun) throw new Error("subject-generate-voice live submit is disabled until explicit spend approval/capture; pass --dryRun")
    if (!args.imageUri) throw new Error("subject-generate-voice requires --imageUri")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `subject-generate-voice-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const request = buildJimengSubjectVoiceRequest({ imageUri: args.imageUri })
    const plan = {
      command: args.command,
      status: "dry-run-only",
      reason: "Frontend bundle confirms /mweb/v1/dreamina_subject/generate_voice accepts imageUri, but live generation may consume quota and still needs explicit spend approval or a captured UI submit.",
      endpoint_sequence: ["/mweb/v1/dreamina_subject/generate_voice"],
      request,
      transport: {
        mode: args.transportMode,
        cassette_path: cassettePath ?? null,
      },
      browser_session_required: false,
    }
    writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), plan)
    console.log(`[jimeng-browser-proxy] subject-generate-voice dry run saved`)
    return
  }

  const session = await loadSession(args)

  if (args.command === "endpoint-probe") {
    if (!args.endpoint) throw new Error("endpoint-probe requires --endpoint")
    if (!args.body && !args.variants) throw new Error("endpoint-probe requires --body or --variants")
    const variants = args.variants
      ? parseJimengEndpointProbeVariants(readInlineOrFile(args.variants))
      : buildSingleEndpointProbeVariant(args.body!)
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `endpoint-probe-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const probe = {
      endpoint: args.endpoint,
      method: args.method,
      query: args.query,
      variants,
    }
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        probe,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        probe: {
          endpoint: probe.endpoint,
          method: probe.method ?? "POST",
          query: probe.query ?? null,
          variant_count: probe.variants.length,
          variants: probe.variants.map((variant) => ({ name: variant.name })),
        },
      })
      console.log(`[jimeng-browser-proxy] endpoint-probe dry run saved variants=${variants.length}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await runJimengEndpointProbe({
      fetch: transport.fetch,
      session,
      probe,
    })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      endpoint: result.endpoint,
      url: result.url,
      method: result.method,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      results: result.results.map((item) => ({
        name: item.name,
        request_body: item.requestBody,
        http_status: item.httpStatus,
        ret: item.ret,
        errmsg: item.errmsg,
        response_text_sha256: item.responseTextSha256,
        body: item.body,
      })),
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengEndpointProbe(result),
    })
    console.log(`[jimeng-browser-proxy] endpoint-probe saved variants=${result.results.length} rets=${result.results.map((item) => `${item.name}:${item.ret ?? "none"}`).join(",")}`)
    return
  }

  if (args.command === "account-credit") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `account-credit-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/commerce/v1/benefits/user_credit",
        method: "POST",
        request: {},
        signed_headers: ["device-time", "sign", "sign-ver"],
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/commerce/v1/benefits/user_credit",
        method: "POST",
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        dry_run: true,
      })
      console.log("[jimeng-browser-proxy] account-credit dry run saved")
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengAccountCredit({ fetch: transport.fetch, session })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengAccountCredit(result),
    })
    console.log(`[jimeng-browser-proxy] account-credit saved total=${result.credit.totalCredit} gift=${result.credit.giftCredit} purchase=${result.credit.purchaseCredit} vip=${result.credit.vipCredit}`)
    return
  }

  if (args.command === "commerce-benefits") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `commerce-benefits-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const endpoints = parseJimengCommerceBenefitEndpoints(args.endpoints)
    const request = buildJimengCommerceBenefitsRequest()
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: endpoints.map((endpoint) => endpoint === "metadata"
          ? "/commerce/v3/resource/benefit_metadata"
          : "/commerce/v3/benefits/batch_get_user_benefit"),
        method: "POST",
        request,
        signed_headers: ["device-time", "sign", "sign-ver"],
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoints,
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        dry_run: true,
      })
      console.log(`[jimeng-browser-proxy] commerce-benefits dry run saved endpoints=${endpoints.join(",")}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengCommerceBenefits({ fetch: transport.fetch, session, endpoints, request })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      requested_endpoints: result.requestedEndpoints,
      request: result.request,
      metadata: result.metadata ? {
        endpoint: result.metadata.endpoint,
        http_status: result.metadata.httpStatus,
        ret: result.metadata.ret,
        errmsg: result.metadata.errmsg,
        response_text_sha256: result.metadata.responseTextSha256,
        body: result.metadata.body,
      } : null,
      user_benefits: result.userBenefits ? {
        endpoint: result.userBenefits.endpoint,
        http_status: result.userBenefits.httpStatus,
        ret: result.userBenefits.ret,
        errmsg: result.userBenefits.errmsg,
        response_text_sha256: result.userBenefits.responseTextSha256,
        body: result.userBenefits.body,
      } : null,
    })
    const summary = summarizeJimengCommerceBenefits(result)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary,
    })
    console.log(`[jimeng-browser-proxy] commerce-benefits saved metadata=${result.metadata?.metadataCount ?? "skip"} user_assets=${result.userBenefits?.assetCount ?? "skip"}`)
    return
  }

  if (args.command === "commerce-pricing") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `commerce-pricing-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const endpoints = parseJimengCommercePricingEndpoints(args.endpoints)
    const requests = endpoints.map((endpoint) => ({
      endpoint,
      path: endpoint === "vip" ? "/commerce/v1/subscription/price_list" : "/commerce/v1/purchase/price_list",
      body: buildJimengCommercePricingRequest(endpoint),
    }))
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: requests.map((request) => request.path),
        method: "POST",
        requests,
        signed_headers: ["device-time", "sign", "sign-ver"],
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
        live_request: false,
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoints,
        requests,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        dry_run: true,
      })
      console.log(`[jimeng-browser-proxy] commerce-pricing dry run saved endpoints=${endpoints.join(",")}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengCommercePricing({ fetch: transport.fetch, session, query: { endpoints } })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      requested_endpoints: result.endpoints,
      results: result.results.map((item) => ({
        endpoint: item.endpoint,
        endpoint_id: item.endpointId,
        http_status: item.httpStatus,
        ret: item.ret,
        errmsg: item.errmsg,
        response_text_sha256: item.responseTextSha256,
        request: item.request,
        body: item.body,
      })),
    })
    const summary = summarizeJimengCommercePricing(result)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary,
    })
    console.log(`[jimeng-browser-proxy] commerce-pricing saved ${result.results.map((item) => `${item.endpointId}=${item.items.length}`).join(" ")}`)
    return
  }

  if (args.command === "account-config") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const endpoints = parseJimengAccountConfigEndpoints(args.endpoints)
    const runId = `account-config-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: endpoints.map((endpoint) => {
          if (endpoint === "settings") return "/mweb/v1/get_settings"
          if (endpoint === "ug-info") return "/mweb/v1/get_ug_info"
          return "/mweb/v1/get_invite_status"
        }),
        method: "POST",
        requests: endpoints.map((endpoint) => ({
          endpoint,
          body: buildJimengAccountConfigRequest(endpoint),
        })),
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
        live_request: false,
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoints,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        requests: endpoints.map((endpoint) => ({
          endpoint,
          body: buildJimengAccountConfigRequest(endpoint),
        })),
        dry_run: true,
      })
      console.log(`[jimeng-browser-proxy] account-config dry run saved endpoints=${endpoints.join(",")}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengAccountConfig({ session, query: { endpoints }, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      endpoints: result.endpoints,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      results: result.results.map((item) => ({
        endpoint: item.endpoint,
        endpoint_id: item.endpointId,
        http_status: item.httpStatus,
        ret: item.ret,
        errmsg: item.errmsg,
        response_text_sha256: item.responseTextSha256,
        request: item.request,
        body: item.body,
      })),
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengAccountConfig(result),
    })
    console.log(`[jimeng-browser-proxy] account-config saved endpoints=${result.results.map((item) => item.endpointId).join(",")}`)
    return
  }

  if (args.command === "runtime-config") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const endpoints = parseJimengRuntimeConfigEndpoints(args.endpoints)
    const runId = `runtime-config-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: endpoints.map((endpoint) => {
          if (endpoint === "experiment-params") return "/mweb/v1/get_experiment_params"
          if (endpoint === "home-header-banner") return "/mweb/v1/get_home_header_banner_config"
          if (endpoint === "help-desk-entrance") return "/mweb/v1/get_help_desk_entrance"
          if (endpoint === "asr-token") return "/mweb/v1/speech/asr_token"
          return "/mweb/v1/speech/asr_hotwords"
        }),
        method: "POST",
        requests: endpoints.map((endpoint) => ({
          endpoint,
          body: buildJimengRuntimeConfigRequest(endpoint),
        })),
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
        live_request: false,
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoints,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        requests: endpoints.map((endpoint) => ({
          endpoint,
          body: buildJimengRuntimeConfigRequest(endpoint),
        })),
        dry_run: true,
      })
      console.log(`[jimeng-browser-proxy] runtime-config dry run saved endpoints=${endpoints.join(",")}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengRuntimeConfig({ session, query: { endpoints }, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      endpoints: result.endpoints,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      results: result.results.map((item) => ({
        endpoint: item.endpoint,
        endpoint_id: item.endpointId,
        http_status: item.httpStatus,
        ret: item.ret,
        errmsg: item.errmsg,
        response_text_sha256: item.responseTextSha256,
        request: item.request,
        body: item.body,
      })),
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengRuntimeConfig(result),
    })
    console.log(`[jimeng-browser-proxy] runtime-config saved endpoints=${result.results.map((item) => item.endpointId).join(",")}`)
    return
  }

  if (args.command === "rate-probe") {
    if (!args.endpoint) throw new Error("rate-probe requires --endpoint")
    if (!args.body && !args.variants) throw new Error("rate-probe requires --body or --variants")
    const variants = args.variants
      ? parseJimengEndpointProbeVariants(readInlineOrFile(args.variants))
      : buildSingleEndpointProbeVariant(args.body!)
    const requestCount = args.requests ?? args.limit ?? 12
    const concurrency = args.concurrency ?? 1
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `rate-probe-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const probe = {
      endpoint: args.endpoint,
      method: args.method,
      query: args.query,
      variants,
      requestCount,
      concurrency,
      delayMs: args.delayMs ?? 0,
      includeRisky: args.includeRisky,
    }
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        probe,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
        warning: probe.includeRisky
          ? "includeRisky is enabled; this may call paid, mutating, or generating endpoints."
          : "Default mode rejects likely paid/mutating/generating endpoints.",
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        probe: {
          endpoint: probe.endpoint,
          method: probe.method ?? "POST",
          query: probe.query ?? null,
          variant_count: probe.variants.length,
          requests: probe.requestCount,
          concurrency: probe.concurrency,
          delay_ms: probe.delayMs,
          include_risky: probe.includeRisky,
          variants: probe.variants.map((variant) => ({ name: variant.name })),
        },
      })
      console.log(`[jimeng-browser-proxy] rate-probe dry run saved requests=${requestCount} concurrency=${concurrency}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await runJimengRateProbe({ fetch: transport.fetch, session, probe })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      ...result,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengRateProbe(result),
    })
    console.log(`[jimeng-browser-proxy] rate-probe saved completed=${result.attempts.length}/${result.requestCount} concurrency=${result.concurrency} stopped=${result.stopped}${result.stopReason ? ` reason=${result.stopReason}` : ""}`)
    return
  }

  if (args.command === "agent-catalog") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const endpoints = parseJimengAgentCatalogEndpoints(args.endpoints)
    const runId = `agent-catalog-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const requests = {
      skills: buildJimengAgentSkillsRequest(),
      config: buildJimengAgentConfigRequest(),
    }
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: endpoints.map((endpoint) => endpoint === "skills"
          ? "/mweb/v1/creation_agent/v2/skill/list"
          : "/mweb/v1/creation_agent/v2/get_agent_config"),
        requests,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoints,
        requests,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
      })
      console.log(`[jimeng-browser-proxy] agent-catalog dry run saved endpoints=${endpoints.join(",")}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengAgentCatalog({ session, endpoints, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      endpoints: result.endpoints,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      results: result.results.map((item) => ({
        endpoint: item.endpoint,
        endpoint_id: item.endpointId,
        http_status: item.httpStatus,
        ret: item.ret,
        errmsg: item.errmsg,
        response_text_sha256: item.responseTextSha256,
        request: item.request,
        body: item.body,
      })),
    })
    const summary = summarizeJimengAgentCatalog(result)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary,
    })
    const summaryRecord = summary.config && typeof summary.config === "object" && !Array.isArray(summary.config) ? summary.config : {}
    console.log(`[jimeng-browser-proxy] agent-catalog saved endpoints=${result.endpoints.join(",")} imageModels=${summaryRecord.image_model_count ?? "n/a"} videoModels=${summaryRecord.video_model_count ?? "n/a"}`)
    return
  }

  if (args.command === "image-models") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = {
      isClientFilter: args.isClientFilter,
      needBetaModel: args.needBetaModel,
      needCache: args.needCache,
      needRefresh: args.needRefresh,
    }
    const request = buildJimengImageModelsRequest(query)
    const runId = `image-models-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: ["/mweb/v1/get_common_config"],
        query,
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_common_config",
        query,
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
      })
      console.log(`[jimeng-browser-proxy] image-models dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengImageModels({ session, query, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      endpoint: result.endpoint,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      query: result.query,
      request: result.request,
      body: result.body,
    })
    const summary = summarizeJimengImageModels(result)
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary,
    })
    console.log(`[jimeng-browser-proxy] image-models saved models=${result.modelCount} default=${result.defaultModelIndex ?? "none"}`)
    return
  }

  if (args.command === "workspace-context") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const endpoints = parseJimengWorkspaceContextEndpoints(args.endpoints)
    const query = {
      endpoints,
      offset: args.offset,
      limit: args.limit,
      workspaceIds: args.workspaceIds,
    }
    const runId = `workspace-context-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: endpoints.map((endpoint) => endpoint === "list"
          ? "/mweb/v1/workspace/list"
          : "/mweb/v1/workspace/get_by_ids"),
        query,
        requests: {
          list: endpoints.includes("list") || (endpoints.includes("get-by-ids") && !args.workspaceIds?.length)
            ? buildJimengWorkspaceListRequest(query)
            : null,
          get_by_ids: args.workspaceIds?.length
            ? buildJimengWorkspaceByIdsRequest(args.workspaceIds)
            : { inferred_from_workspace_list: true },
        },
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoints,
        query: {
          ...query,
          workspaceIds: query.workspaceIds ? query.workspaceIds.map((id) => ({ sha256: sha256(id) })) : undefined,
        },
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        dry_run: true,
      })
      console.log(`[jimeng-browser-proxy] workspace-context dry run saved endpoints=${endpoints.join(",")}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengWorkspaceContext({ session, query, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      endpoints: result.endpoints,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      skipped: result.skipped,
      results: result.results.map((item) => ({
        endpoint: item.endpoint,
        endpoint_id: item.endpointId,
        http_status: item.httpStatus,
        ret: item.ret,
        errmsg: item.errmsg,
        response_text_sha256: item.responseTextSha256,
        request: item.request,
        body: item.body,
      })),
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengWorkspaceContext(result),
    })
    const listResult = result.results.find((item) => item.endpointId === "list")
    const byIdsResult = result.results.find((item) => item.endpointId === "get-by-ids")
    console.log(`[jimeng-browser-proxy] workspace-context saved endpoints=${result.results.map((item) => item.endpointId).join(",")} listed=${listResult?.workspaces.length ?? "n/a"} by_ids=${byIdsResult?.workspaces.length ?? "n/a"} skipped=${result.skipped.length}`)
    return
  }

  if (args.command === "research-keywords") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const endpoints = parseJimengResearchKeywordEndpoints(args.endpoints)
    const channels = parseJimengResearchKeywordChannels(args.channels)
    const query = {
      endpoints,
      channels,
      keyword: args.keyword,
      count: args.limit,
    }
    const runId = `research-keywords-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      const requests = endpoints.flatMap((endpoint) => channels.map((channel) => {
        if (endpoint === "suggest" && channel === "asset") {
          return {
            endpoint,
            channel,
            skipped: true,
            reason: "Jimeng returns ret=1000 invalid parameter for asset suggestions",
          }
        }
        return {
          endpoint,
          channel,
          path: endpoint === "suggest" ? "/mweb/search/v1/sug" : "/mweb/search/v1/guess",
          request: endpoint === "suggest"
            ? buildJimengResearchSuggestRequest(channel, args.keyword ?? "")
            : buildJimengResearchGuessRequest(channel, args.limit ?? 10),
        }
      }))
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: requests.flatMap((request) => "path" in request ? [request.path] : []),
        query,
        requests,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoints,
        channels,
        keyword: args.keyword ?? null,
        count: args.limit ?? 10,
        requests,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        dry_run: true,
      })
      console.log(`[jimeng-browser-proxy] research-keywords dry run saved requests=${requests.filter((request) => "path" in request).length}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengResearchKeywords({ session, query, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      endpoints: result.endpoints,
      channels: result.channels,
      keyword: result.keyword,
      count: result.count,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      skipped: result.skipped,
      results: result.results.map((item) => ({
        endpoint: item.endpoint,
        endpoint_id: item.endpointId,
        channel: item.channel,
        wire_channel: item.wireChannel,
        http_status: item.httpStatus,
        ret: item.ret,
        errmsg: item.errmsg,
        response_text_sha256: item.responseTextSha256,
        request: item.request,
        body: item.body,
      })),
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengResearchKeywords(result),
    })
    console.log(`[jimeng-browser-proxy] research-keywords saved results=${result.results.length} items=${result.results.reduce((sum, item) => sum + item.items.length, 0)} skipped=${result.skipped.length}`)
    return
  }

  if (args.command === "research-search") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const channel = parseJimengResearchSearchChannel(args.channels)
    const query = {
      channel,
      keyword: args.keyword,
      count: args.limit,
      cursor: args.cursor,
      searchId: args.searchId,
      source: args.source,
      workspaceId: args.workspaceId,
      needIntentionMark: args.needIntentionMark,
      assetType: parseJimengResearchAssetType(args.assetType),
      blockIndex: args.blockIndex,
      onlyFavorited: args.onlyFavorite,
      showTypeList: args.showTypeList,
      isInsertFrame: args.isInsertFrame,
      hideStoryAgentResult: args.hideStoryAgentResult,
      beginTimeStamp: args.beginTimeStamp,
      endTimeStamp: args.endTimeStamp,
    }
    const request = buildJimengResearchSearchRequest(query)
    const runId = `research-search-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/search/v1/search",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
        live_request: false,
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/mweb/search/v1/search",
        channel,
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        dry_run: true,
      })
      console.log(`[jimeng-browser-proxy] research-search dry run saved channel=${channel}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengResearchSearch({ session, query, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      endpoint: result.endpoint,
      channel: result.channel,
      wire_channel: result.wireChannel,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      search_id: result.searchId,
      has_more: result.hasMore,
      next_cursor: result.nextCursor,
      can_search_deeper: result.canSearchDeeper,
      cache_sync_token_present: result.cacheSyncTokenPresent,
      decryption_applied: result.decryptionApplied,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengResearchSearch(result),
    })
    console.log(`[jimeng-browser-proxy] research-search saved channel=${channel} items=${result.items.length} assets=${result.assets.length} has_more=${result.hasMore}`)
    return
  }

  if (args.command === "profile-research") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const endpoints = parseJimengProfileResearchEndpoints(args.endpoints)
    const query = {
      endpoints,
      secUid: args.secUid,
      publishedItemId: args.publishedItemId,
      publishedItemIds: args.publishedItemIds,
      count: args.limit,
      offset: args.offset,
      imageTypeList: args.imageTypeList,
      feedRefer: args.feedRefer,
    }
    const requests = endpoints.flatMap((endpoint) => {
      if (endpoint === "item" && !args.publishedItemId) return []
      if (endpoint === "items" && !args.publishedItemIds?.length) return []
      const request = endpoint === "profile"
        ? buildJimengProfileUserRequest(args.secUid ?? "")
        : endpoint === "homepage"
          ? buildJimengProfileHomepageRequest(query)
          : endpoint === "favorites"
            ? buildJimengProfileFavoritesRequest(query)
            : endpoint === "stories"
              ? buildJimengProfileStoriesRequest(query)
              : endpoint === "following" || endpoint === "followers"
                ? buildJimengProfileFollowRequest(endpoint, query)
                : endpoint === "item"
                  ? buildJimengProfileItemRequest(args.publishedItemId ?? "")
                  : buildJimengProfileBatchItemsRequest(args.publishedItemIds ?? [])
      const pathName = endpoint === "profile"
        ? "/mweb/v1/get_user_info"
        : endpoint === "homepage"
          ? "/mweb/v1/get_homepage"
          : endpoint === "favorites"
            ? "/mweb/v1/get_favorite_list"
            : endpoint === "stories"
              ? "/mweb/v1/get_user_story_list"
              : endpoint === "following" || endpoint === "followers"
                ? "/mweb/v1/get_follow_list"
                : endpoint === "item"
                  ? "/mweb/v1/get_item_info"
                  : "/mweb/v1/mget_item_info"
      return [{ endpoint, path: pathName, request }]
    })
    const runId = `profile-research-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: requests.map((request) => request.path),
        requests,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        skipped: [
          ...(endpoints.includes("item") && !args.publishedItemId
            ? [{ endpoint: "item", reason: "missing --publishedItemId" }]
            : []),
          ...(endpoints.includes("items") && !args.publishedItemIds?.length
            ? [{ endpoint: "items", reason: "missing --publishedItemIds" }]
            : []),
        ],
        browser_session: redactSession(session),
        live_request: false,
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoints,
        requests,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        dry_run: true,
      })
      console.log(`[jimeng-browser-proxy] profile-research dry run saved requests=${requests.length}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengProfileResearch({ session, query, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      endpoints: result.endpoints,
      skipped: result.skipped,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      results: result.results.map((item) => ({
        endpoint: item.endpoint,
        endpoint_id: item.endpointId,
        scope: item.scope,
        http_status: item.httpStatus,
        ret: item.ret,
        errmsg: item.errmsg,
        response_text_sha256: item.responseTextSha256,
        request: item.request,
        body: item.body,
      })),
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengProfileResearch(result),
    })
    console.log(`[jimeng-browser-proxy] profile-research saved results=${result.results.length} items=${result.results.reduce((sum, item) => sum + item.items.length, 0)} profiles=${result.results.reduce((sum, item) => sum + item.profiles.length + (item.profile ? 1 : 0), 0)} skipped=${result.skipped.length}`)
    return
  }

  if (args.command === "local-items") {
    if (!args.itemIds?.length) throw new Error("--itemIds is required for local-items")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const request = buildJimengLocalItemsRequest(args.itemIds)
    const runId = `local-items-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_local_item_list",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
        live_request: false,
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_local_item_list",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        dry_run: true,
      })
      console.log(`[jimeng-browser-proxy] local-items dry run saved item_ids=${args.itemIds.length}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengLocalItems({ session, itemIds: args.itemIds, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      endpoint: result.endpoint,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengLocalItems(result),
    })
    console.log(`[jimeng-browser-proxy] local-items saved items=${result.items.length}`)
    return
  }

  if (args.command === "story-records") {
    if (!args.storyIds?.length) throw new Error("--storyIds is required for story-records")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const request = buildJimengStoryRecordsRequest(args.storyIds)
    const runId = `story-records-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/mget_story",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
        live_request: false,
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/mweb/v1/mget_story",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        dry_run: true,
      })
      console.log(`[jimeng-browser-proxy] story-records dry run saved story_ids=${args.storyIds.length}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengStoryRecords({ session, storyIds: args.storyIds, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      endpoint: result.endpoint,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengStoryRecords(result),
    })
    console.log(`[jimeng-browser-proxy] story-records saved stories=${result.stories.length}`)
    return
  }

  if (args.command === "async-tasks") {
    const taskIds = args.taskIds ?? []
    if (taskIds.length === 0) throw new Error("--taskIds is required for async-tasks")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const request = buildJimengAsyncTasksRequest(taskIds)
    const runId = `async-tasks-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/mget_async_task",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
        live_request: false,
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/mweb/v1/mget_async_task",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        dry_run: true,
      })
      console.log(`[jimeng-browser-proxy] async-tasks dry run saved task_ids=${taskIds.length}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengAsyncTasks({ session, taskIds, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      endpoint: result.endpoint,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengAsyncTasks(result),
    })
    console.log(`[jimeng-browser-proxy] async-tasks saved tasks=${result.tasks.length}`)
    return
  }

  if (args.command === "story-export-plan") {
    if (!args.dryRun) throw new Error("story-export-plan is dry-run only because /mweb/v1/submit_async_task creates export task state; pass --dryRun")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const plan = buildJimengStoryExportPlan({
      submitId: args.submitId,
      storyIds: args.storyIds,
      payload: parseJsonObjectFlag(args.body, "--body"),
    })
    const runId = `story-export-plan-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
      command: args.command,
      endpoint: plan.endpoint,
      method: plan.method,
      request: plan.request,
      payload_object: plan.payloadObject,
      browser_session: redactSession(session),
      live_submit: false,
      warning: "No request was sent. /mweb/v1/submit_async_task creates an export task and needs approval or a disposable fixture.",
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      summary: summarizeJimengStoryExportPlan(plan),
    })
    console.log(`[jimeng-browser-proxy] story-export-plan dry run saved submit_id=${String(plan.request.submit_id)}`)
    return
  }

  if (args.command === "infinite-canvas") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const endpoints = parseJimengInfiniteCanvasEndpoints(args.endpoints)
    const query = {
      endpoints,
      cursor: args.cursor,
      offset: args.offset,
      limit: args.limit,
      imageInfo: args.imageInfo,
      onlyFavorite: args.onlyFavorite,
      projectId: args.projectId,
      userId: args.userId,
      needDraftResource: args.needDraftResource,
    }
    const runId = `infinite-canvas-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: endpoints.map((endpoint) => endpoint === "projects"
          ? "/mweb/v1/infinite_canvas/list_project"
          : endpoint === "detail"
            ? "/mweb/v1/infinite_canvas/project_detail"
            : endpoint === "ratios"
              ? "/mweb/v1/infinite_canvas/v1/get_canvas_custom_ratio"
              : "/mweb/v1/infinite_canvas/get_conversation_list"),
        query,
        requests: {
          projects: endpoints.includes("projects") || endpoints.includes("detail") || endpoints.includes("ratios") || endpoints.includes("conversations")
            ? buildJimengCanvasProjectListRequest(query)
            : null,
          detail: args.projectId ? buildJimengCanvasProjectDetailRequest({ ...query, projectId: args.projectId }) : { inferred_from_first_project: true },
          ratios: args.userId ? buildJimengCanvasCustomRatiosRequest({ ...query, userId: args.userId }) : { inferred_from_first_project_creator_user_id: true },
          conversations: args.projectId ? buildJimengCanvasConversationListRequest({ ...query, projectId: args.projectId }) : { inferred_from_first_project: true },
        },
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoints,
        query,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
      })
      console.log(`[jimeng-browser-proxy] infinite-canvas dry run saved endpoints=${endpoints.join(",")}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengInfiniteCanvas({ session, query, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      endpoints: result.endpoints,
      skipped: result.skipped,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      results: result.results.map((item) => ({
        endpoint: item.endpoint,
        endpoint_id: item.endpointId,
        http_status: item.httpStatus,
        ret: item.ret,
        errmsg: item.errmsg,
        response_text_sha256: item.responseTextSha256,
        request: item.request,
        body: item.body,
      })),
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengInfiniteCanvas(result),
    })
    const projectResult = result.results.find((item) => item.endpointId === "projects")
    const detailResult = result.results.find((item) => item.endpointId === "detail")
    const ratioResult = result.results.find((item) => item.endpointId === "ratios")
    const conversationResult = result.results.find((item) => item.endpointId === "conversations")
    console.log(`[jimeng-browser-proxy] infinite-canvas saved endpoints=${result.results.map((item) => item.endpointId).join(",")} projects=${projectResult?.projects?.length ?? "n/a"} detail=${detailResult?.project ? "yes" : "no"} ratios=${ratioResult?.customRatios?.length ?? "n/a"} conversations=${conversationResult?.conversations?.length ?? "n/a"} skipped=${result.skipped.length}`)
    return
  }

  if (args.command === "catalog") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const endpointIds = parseCatalogEndpointIds(args.endpoints)
    const runId = `catalog-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_ids: endpointIds,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] catalog dry run saved endpoints=${endpointIds.length}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const results = await runCatalogProbe({ fetch: transport.fetch, session, endpointIds })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      results,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      results: results.map((result) => ({
        endpoint: result.endpoint,
        description: result.description,
        http_status: result.httpStatus,
        ret: result.ret,
        errmsg: result.errmsg,
        response_text_sha256: result.responseTextSha256,
        summary: result.summary,
      })),
    })
    console.log(`[jimeng-browser-proxy] catalog saved endpoints=${results.length}`)
    return
  }

  if (args.command === "lip-sync-config") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `lip-sync-config-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: [
          "/mweb/v1/video_generate/get_common_config scene=lip_sync_image_generate_video",
          "/mweb/v1/video_generate/get_common_config scene=lip_sync_video_generate_video",
        ],
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] lip-sync-config dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchLipSyncConfigs({ fetch: transport.fetch, session })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      image: {
        url: result.image.url,
        http_status: result.image.httpStatus,
        ret: result.image.ret,
        errmsg: result.image.errmsg,
        response_text_sha256: result.image.responseTextSha256,
        body: result.image.body,
      },
      video: {
        url: result.video.url,
        http_status: result.video.httpStatus,
        ret: result.video.ret,
        errmsg: result.video.errmsg,
        response_text_sha256: result.video.responseTextSha256,
        body: result.video.body,
      },
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeLipSyncConfigs(result),
    })
    const imageModels = Array.isArray(result.image.summary.models) ? result.image.summary.models.length : 0
    const videoModels = Array.isArray(result.video.summary.models) ? result.video.summary.models.length : 0
    console.log(`[jimeng-browser-proxy] lip-sync-config saved imageModels=${imageModels} videoModels=${videoModels}`)
    return
  }

  if (args.command === "voices") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const capture = readVoiceCapture(args.capture)
    const runId = `voices-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchVoiceLibraryFromCapture({ fetch: transport.fetch, session, capture })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      response_text_sha256: result.responseTextSha256,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-voices.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      response_text_sha256: result.responseTextSha256,
      summary: summarizeVoiceLibrary(result.voices),
      voices: result.voices,
    })
    console.log(`[jimeng-browser-proxy] voices saved count=${result.voices.length}`)
    return
  }

  if (args.command === "voice-clones") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = {
      offset: args.offset,
      limit: args.limit,
      statuses: parseVoiceCloneStatuses(args.voiceStatuses),
    }
    const request = buildJimengClonedVoicesRequest(query)
    const runId = `voice-clones-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_user_local_item_list",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] voice-clones dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengClonedVoices({ fetch: transport.fetch, session, query })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengClonedVoices(result),
    })
    console.log(`[jimeng-browser-proxy] voice-clones saved count=${result.voices.length} nextOffset=${result.nextOffset ?? "none"} hasMore=${result.hasMore ?? "unknown"}`)
    return
  }

  if (args.command === "voice-clone-query") {
    const taskIds = args.taskIds ?? []
    if (taskIds.length === 0) throw new Error("voice-clone-query requires --taskIds")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const request = buildJimengVoiceTaskQueryRequest({ taskIds })
    const runId = `voice-clone-query-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const plan = {
      command: args.command,
      endpoint_sequence: ["/mweb/v1/voice/query_task"],
      request,
      transport: {
        mode: args.transportMode,
        cassette_path: cassettePath ?? null,
      },
      browser_session: redactSession(session),
    }
    if (args.dryRun) {
      const dryRunPlan = {
        ...plan,
        status: "dry-run",
        reason: "Task query shape is frontend-confirmed; live query is no-spend once a real task id is available.",
      }
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), dryRunPlan)
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), dryRunPlan)
      console.log(`[jimeng-browser-proxy] voice-clone-query dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await queryJimengVoiceTasks({ fetch: transport.fetch, session, taskIds })
    writeJson(path.join(dirs.rawDir, `${runId}-raw.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengVoiceTaskQuery(result),
    })
    console.log(`[jimeng-browser-proxy] voice-clone-query saved tasks=${result.tasks.length}`)
    return
  }

  if (args.command === "tts") {
    if (!args.voiceId) throw new Error("--voice-id is required")
    const text = args.text ?? "这条视频值得试一下。"
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `tts-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const plan = {
      command: args.command,
      endpoint: "/mweb/v1/tts_generate",
      text,
      voice_id: args.voiceId,
      voice_title: args.voiceTitle,
      item_platform: args.itemPlatform ?? 1,
      transport: {
        mode: args.transportMode,
        cassette_path: cassettePath ?? null,
      },
      browser_session: redactSession(session),
    }
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
      console.log(`[jimeng-browser-proxy] tts dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await generateTextToSpeech({
      fetch: transport.fetch,
      session,
      tts: { text, voiceId: args.voiceId, itemPlatform: args.itemPlatform },
    })
    const file = path.join(dirs.artifactsDir, `${slug(`${args.voiceTitle ?? "voice"}-${args.voiceId}`)}.mp3`)
    writeFileSync(file, Buffer.from(result.audioBytes))
    writeJson(path.join(dirs.normalizedDir, `${runId}-result.json`), redactJimengProofForNormalized({
      ...plan,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      artifact: file,
      bytes: result.audioBytes.length,
    }))
    console.log(`[jimeng-browser-proxy] tts saved: ${file}`)
    return
  }

  if (args.command === "sample-voices") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `sample-voices-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const capture = readVoiceCapture(args.capture)
    const library = await fetchVoiceLibraryFromCapture({ fetch: transport.fetch, session, capture })
    const text = args.text ?? "这条视频值得试一下。"
    const voices = typeof args.limit === "number" ? library.voices.slice(0, args.limit) : library.voices
    const plan = {
      command: args.command,
      endpoint: "/mweb/v1/tts_generate",
      text,
      voice_count: voices.length,
      dry_run: args.dryRun,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      browser_session: redactSession(session),
    }
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), { ...plan, voices })
      console.log(`[jimeng-browser-proxy] sample-voices dry run saved count=${voices.length}`)
      return
    }

    const samples: Array<{
      index: number
      voice: JimengVoiceCatalogItem
      file: string
      bytes: number
      ret: string | number | null
      errmsg: string | null
      response_text_sha256: string
    }> = []
    for (let i = 0; i < voices.length; i += 1) {
      const voice = voices[i]!
      const result = await generateTextToSpeech({
        fetch: transport.fetch,
        session,
        tts: { text, voiceId: voice.id, itemPlatform: voice.itemPlatform },
      })
      const file = path.join(dirs.artifactsDir, `${String(i + 1).padStart(3, "0")}-${slug(`${voice.title}-${voice.id}`)}.mp3`)
      writeFileSync(file, Buffer.from(result.audioBytes))
      samples.push({
        index: i + 1,
        voice,
        file,
        bytes: result.audioBytes.length,
        ret: result.ret,
        errmsg: result.errmsg,
        response_text_sha256: result.responseTextSha256,
      })
      if ((i + 1) % 10 === 0 || i === voices.length - 1) {
        console.log(`[jimeng-browser-proxy] sampled voices ${i + 1}/${voices.length}`)
      }
    }
    writeJson(path.join(dirs.normalizedDir, `${runId}-result.json`), {
      ...plan,
      voice_library_sha256: library.responseTextSha256,
      samples,
    })
    console.log(`[jimeng-browser-proxy] sample-voices done count=${samples.length}`)
    return
  }

  if (args.command === "assets") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = {
      count: args.limit,
      direction: args.direction,
      mode: args.assetMode,
      assetTypes: args.assetTypes,
      workspaceId: args.workspaceId ?? workspaceIdFromJimengSession(session),
      orderBy: args.orderBy,
      onlyFavorited: args.onlyFavorite,
      endTimeStamp: args.endTimeStamp,
      hideStoryAgentResult: args.includeStoryAgentResult ? false : undefined,
    }
    const request = buildJimengAssetsRequest(query)
    const runId = `assets-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_asset_list",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_asset_list",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
      })
      console.log(`[jimeng-browser-proxy] assets dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengAssets({ session, query, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengAssets(result),
    })
    console.log(`[jimeng-browser-proxy] assets saved count=${result.assets.length} nextOffset=${result.nextOffset ?? "none"} hasMore=${result.hasMore ?? "unknown"}`)
    return
  }

  if (args.command === "history-list") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = {
      offset: args.offset,
      limit: args.limit,
      direction: args.direction,
      workspaceId: args.workspaceId ?? workspaceIdFromJimengSession(session),
      filterTypeList: args.filterTypes,
      orderBy: args.orderBy,
      hideStoryAgentResult: args.hideStoryAgentResult,
      imageResolutionStrategy: args.filterTypes && args.filterTypes.length > 0 ? {
        enableCommon: true,
        enableSmartCrop: true,
      } : undefined,
    }
    const request = buildJimengHistoryListRequest(query)
    const runId = `history-list-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_history",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_history",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
      })
      console.log(`[jimeng-browser-proxy] history-list dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengHistoryList({ session, query, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengHistoryList(result),
    })
    console.log(`[jimeng-browser-proxy] history-list saved count=${result.records.length} nextOffset=${result.nextOffset ?? "none"} hasMore=${result.hasMore ?? "unknown"}`)
    return
  }

  if (args.command === "history-queue") {
    const historyIds = args.historyIds ?? (args.historyId ? [args.historyId] : [])
    if (historyIds.length === 0) throw new Error("history-queue requires --historyId or --historyIds")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const request = buildJimengHistoryQueueInfoRequest({ historyIds })
    const runId = `history-queue-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_history_queue_info",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_history_queue_info",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
      })
      console.log(`[jimeng-browser-proxy] history-queue dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengHistoryQueueInfo({ session, historyIds, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengHistoryQueueInfo(result),
    })
    console.log(`[jimeng-browser-proxy] history-queue saved count=${result.entries.length} statuses=${result.entries.map((entry) => `${entry.historyId}:${entry.queueInfo?.queueStatus ?? "none"}`).join(",")}`)
    return
  }

  if (args.command === "history-records") {
    const submitIds = args.submitIds ?? (args.submitId ? [args.submitId] : [])
    const historyIds = args.historyIds ?? (args.historyId ? [args.historyId] : [])
    if (submitIds.length === 0 && historyIds.length === 0) {
      throw new Error("history-records requires --submitId, --submitIds, --historyId, or --historyIds")
    }
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = { submitIds, historyIds }
    const request = buildJimengHistoryRecordsRequest(query)
    const runId = `history-records-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_history_by_ids",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_history_by_ids",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
      })
      console.log(`[jimeng-browser-proxy] history-records dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengHistoryRecords({ session, query, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengHistoryRecords(result),
    })
    console.log(`[jimeng-browser-proxy] history-records saved count=${result.records.length} statuses=${result.records.map((record) => `${record.lookupKey}:${record.status ?? "none"}`).join(",")}`)
    return
  }

  if (args.command === "video-info") {
    const vids = args.vids ?? (args.vid ? [args.vid] : [])
    if (vids.length === 0) {
      throw new Error("video-info requires --vid or --vids")
    }
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = { vids }
    const request = buildJimengVideoInfoRequest(query)
    const runId = `video-info-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_video_by_vid",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_video_by_vid",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
      })
      console.log(`[jimeng-browser-proxy] video-info dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengVideoInfo({ session, query, fetch: transport.fetch })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengVideoInfo(result),
    })
    console.log(`[jimeng-browser-proxy] video-info saved count=${result.videos.length} vids=${result.videos.map((video) => `${video.lookupVid}:${video.definition ?? "none"}`).join(",")}`)
    return
  }

  if (args.command === "templates") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = {
      count: args.limit,
      offset: args.offset,
      categoryId: args.categoryId,
      workTypes: parseExploreWorkTypes(args.workTypes),
      feedRefer: args.feedRefer,
    }
    const request = buildExploreRequestBody(query)
    const runId = `templates-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_explore",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] templates dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchExploreTemplates({ fetch: transport.fetch, session, query })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeExploreTemplates(result),
      items: redactExploreTemplateItems(result.items),
    })
    console.log(`[jimeng-browser-proxy] templates saved count=${result.items.length} nextOffset=${result.nextOffset ?? "none"}`)
    return
  }

  if (args.command === "short-videos") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = buildShortVideoExploreQuery({
      count: args.limit,
      offset: args.offset,
      categoryId: args.categoryId,
      feedRefer: args.feedRefer,
    })
    const request = buildExploreRequestBody(query)
    const runId = `short-videos-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_explore",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] short-videos dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchExploreTemplates({ fetch: transport.fetch, session, query })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeExploreShortVideos(result),
      items: redactExploreTemplateItems(result.items),
    })
    console.log(`[jimeng-browser-proxy] short-videos saved count=${result.items.length} nextOffset=${result.nextOffset ?? "none"}`)
    return
  }

  if (args.command === "overseas-short-videos") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = buildShortVideoExploreQuery({
      count: args.limit,
      offset: args.offset,
      categoryId: args.categoryId,
      feedRefer: args.feedRefer,
    })
    const request = buildExploreRequestBody(query)
    const runId = `overseas-short-videos-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/feed_short_video",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] overseas-short-videos dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchOverseasShortVideos({ fetch: transport.fetch, session, query })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoint: result.endpoint,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeExploreShortVideos(result),
      items: redactExploreTemplateItems(result.items),
    })
    console.log(`[jimeng-browser-proxy] overseas-short-videos saved count=${result.items.length} nextOffset=${result.nextOffset ?? "none"}`)
    return
  }

  if (args.command === "capcut-categories") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const request = buildCapCutTemplateCategoriesRequest()
    const runId = `capcut-categories-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        host: "https://edit-api-sg.capcut.com",
        endpoint: "/lv/v1/cc_web/plane/get_categories",
        request,
        capcut_lan: args.capcutLan ?? "en",
        capcut_loc: args.capcutLoc ?? "us",
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] capcut-categories dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchCapCutTemplateCategories({
      fetch: transport.fetch,
      session,
      query: {
        lan: args.capcutLan,
        loc: args.capcutLoc,
      },
    })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      host: result.host,
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      log_id: result.logId,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoint: result.endpoint,
      host: result.host,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      request: result.request,
      summary: summarizeCapCutTemplateCategories(result),
    })
    console.log(`[jimeng-browser-proxy] capcut-categories saved count=${result.categories.length}`)
    return
  }

  if (args.command === "subjects") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const query = {
      cursor: args.cursor,
      limit: args.limit,
      keyword: args.keyword,
      subjectIds: args.subjectIds,
      onlyFavorite: args.onlyFavorite,
      workspaceId: args.workspaceId,
    }
    const request = buildJimengSubjectsRequest(query)
    const runId = `subjects-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/dreamina_subject/get",
        request,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] subjects dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await fetchJimengSubjects({ fetch: transport.fetch, session, query })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      summary: summarizeJimengSubjects(result),
    })
    console.log(`[jimeng-browser-proxy] subjects saved count=${result.subjects.length} nextCursor=${result.nextCursor ?? "none"} hasMore=${result.hasMore ?? "unknown"}`)
    return
  }

  if (args.command === "subject-update") {
    if (!args.subjectId) throw new Error("--subjectId is required for subject-update")
    if (!args.name && args.description === undefined && !args.image && !args.file && !args.imageUri) {
      throw new Error("subject-update requires at least one of --name, --description, --image/--file, or --imageUri")
    }
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const sourceFile = args.image ?? args.file
    const runId = `subject-update-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (sourceFile && args.imageUri) {
      throw new Error("subject-update accepts either a local --image/--file or existing --imageUri, not both")
    }

    const existingReference = sourceFile ? null : (args.imageUri ? subjectImageReferenceFromArgs(args, "subject-update") : null)
    const dryRunContent = {
      ...(args.name ? { name: args.name } : {}),
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(existingReference ? { mainImage: existingReference } : {}),
    }
    const dryRunRequest = sourceFile ? null : buildJimengSubjectUpdateRequest({
      subjectId: args.subjectId,
      content: dryRunContent,
    })
    const plan = {
      command: args.command,
      endpoint_sequence: [
        ...(sourceFile ? [
          "/mweb/v1/get_upload_token scene=2",
          "ImageX ApplyImageUpload",
          "ImageX direct POST /upload/v1/{StoreUri}",
          "ImageX CommitImageUpload",
          "/mweb/v1/imagex/submit_audit_job",
          "/mweb/v1/get_image_by_uri",
        ] : [
          ...(existingReference && !existingReference.imageUrl ? ["/mweb/v1/get_image_by_uri"] : []),
        ]),
        "/mweb/v1/dreamina_subject/update",
      ],
      source_file: sourceFile ? path.resolve(sourceFile) : undefined,
      subject_id: args.subjectId,
      existing_image_uri: args.imageUri,
      name_present: !!args.name,
      description_present: args.description !== undefined,
      request: dryRunRequest ? redactSignedUrls(dryRunRequest) : undefined,
      transport: {
        mode: args.transportMode,
        cassette_path: cassettePath ?? null,
      },
      browser_session: redactSession(session),
    }
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
      console.log(`[jimeng-browser-proxy] subject-update dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    let mainImage: JimengSubjectImageReference | undefined = existingReference ?? undefined
    let uploadSummary: ReferenceUploadSummary | null = null
    let audit: Awaited<ReturnType<typeof submitJimengImageAuditJob>> | null = null
    let imageLookup: Awaited<ReturnType<typeof fetchJimengImagesByUri>> | null = null
    if (sourceFile) {
      uploadSummary = await uploadReferenceImage({
        session,
        dirs,
        runId,
        role: "subject_main_image",
        index: 0,
        sourceFile,
      })
      audit = await submitJimengImageAuditJob({
        fetch: transport.fetch,
        session,
        imageUris: [uploadSummary.uri],
      })
      writeJson(path.join(dirs.rawDir, `${runId}-audit-raw.json`), {
        http_status: audit.httpStatus,
        ret: audit.ret,
        errmsg: audit.errmsg,
        response_text_sha256: audit.responseTextSha256,
        request: audit.request,
        body: audit.body,
      })
      imageLookup = await fetchJimengImagesByUri({
        fetch: transport.fetch,
        session,
        imageUris: [uploadSummary.uri],
      })
      writeJson(path.join(dirs.rawDir, `${runId}-image-lookup-raw.json`), {
        http_status: imageLookup.httpStatus,
        ret: imageLookup.ret,
        errmsg: imageLookup.errmsg,
        response_text_sha256: imageLookup.responseTextSha256,
        request: imageLookup.request,
        body: imageLookup.body,
      })
      mainImage = subjectImageReferenceFromUploadSummary(uploadSummary.image_upload, imageLookup.images[0]?.imageUrl ?? args.imageUrl)
    } else if (mainImage && !mainImage.imageUrl) {
      imageLookup = await fetchJimengImagesByUri({
        fetch: transport.fetch,
        session,
        imageUris: [mainImage.imageUri],
      })
      writeJson(path.join(dirs.rawDir, `${runId}-image-lookup-raw.json`), {
        http_status: imageLookup.httpStatus,
        ret: imageLookup.ret,
        errmsg: imageLookup.errmsg,
        response_text_sha256: imageLookup.responseTextSha256,
        request: imageLookup.request,
        body: imageLookup.body,
      })
      const imageUrl = imageLookup.images[0]?.imageUrl
      if (imageUrl) mainImage = { ...mainImage, imageUrl }
    }

    const result = await updateJimengSubject({
      fetch: transport.fetch,
      session,
      subject: {
        subjectId: args.subjectId,
        content: {
          ...(args.name ? { name: args.name } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(mainImage ? { mainImage } : {}),
        },
      },
    })
    writeJson(path.join(dirs.rawDir, `${runId}-raw.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      ...plan,
      request: redactSignedUrls(result.request),
      reference_upload: uploadSummary,
      audit: audit ? {
        endpoint: audit.endpoint,
        http_status: audit.httpStatus,
        ret: audit.ret,
        errmsg: audit.errmsg,
        response_text_sha256: audit.responseTextSha256,
        request: audit.request,
      } : null,
      image_lookup: imageLookup ? summarizeJimengImageByUri(imageLookup) : null,
      summary: summarizeJimengSubjectUpdate(result),
    })
    console.log(`[jimeng-browser-proxy] subject-update saved subjectId=${result.subjectId ?? "missing"}`)
    return
  }

  if (args.command === "subject-delete") {
    const subjectIds = args.subjectIds ?? (args.subjectId ? [args.subjectId] : [])
    if (subjectIds.length === 0) throw new Error("subject-delete requires --subjectId or --subjectIds")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `subject-delete-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const request = buildJimengSubjectDeleteRequest({ subjectIds })
    const plan = {
      command: args.command,
      endpoint_sequence: ["/mweb/v1/dreamina_subject/delete"],
      request,
      subject_ids: subjectIds,
      transport: {
        mode: args.transportMode,
        cassette_path: cassettePath ?? null,
      },
      browser_session: redactSession(session),
    }
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
      console.log(`[jimeng-browser-proxy] subject-delete dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await deleteJimengSubjects({ fetch: transport.fetch, session, subjectIds })
    writeJson(path.join(dirs.rawDir, `${runId}-raw.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      ...plan,
      summary: summarizeJimengSubjectDelete(result),
    })
    console.log(`[jimeng-browser-proxy] subject-delete saved count=${result.deletedSubjectIds.length}`)
    return
  }

  if (args.command === "describe-image") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const sourceFile = args.image ?? args.file
    const runId = `describe-image-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const requestedImageUri = args.imageUri
    const endpoints = [
      ...(args.noDescription ? [] : ["/mweb/v1/get_image_description"]),
      ...(args.noFaces ? [] : ["/mweb/v1/face_recognize"]),
    ]
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (!sourceFile && !requestedImageUri) throw new Error("describe-image requires --image, --file, or --imageUri")
    if (endpoints.length === 0) throw new Error("describe-image has nothing to do when both --noDescription and --noFaces are passed")

    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: [
          ...(sourceFile ? ["/mweb/v1/get_upload_token scene=2", "ImageX ApplyImageUpload", "ImageX direct POST /upload/v1/{StoreUri}", "ImageX CommitImageUpload"] : []),
          ...endpoints,
        ],
        source_file: sourceFile ? path.resolve(sourceFile) : undefined,
        image_uri: requestedImageUri,
        requests: {
          description: args.noDescription || !requestedImageUri ? undefined : { file_uri: requestedImageUri },
          face_recognition: args.noFaces || !requestedImageUri ? undefined : { image_uri_list: [requestedImageUri] },
        },
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] describe-image dry run saved`)
      return
    }

    let imageUri = requestedImageUri
    let imageUpload: object | null = null
    if (sourceFile) {
      const resolvedSourceFile = path.resolve(sourceFile)
      const bytes = readFileSync(resolvedSourceFile)
      const artifactFile = path.join(dirs.artifactsDir, `${runId}-${path.basename(resolvedSourceFile)}`)
      writeFileSync(artifactFile, bytes)
      const uploaded = await uploadJimengImage({
        session,
        image: {
          fileName: path.basename(resolvedSourceFile),
          bytes,
        },
      })
      writeJson(path.join(dirs.rawDir, `${runId}-upload-raw.json`), {
        token: {
          http_status: uploaded.token.httpStatus,
          response_text_sha256: uploaded.token.responseTextSha256,
          body: uploaded.token.body,
        },
        apply: {
          http_status: uploaded.apply.httpStatus,
          response_text_sha256: uploaded.apply.responseTextSha256,
          body: uploaded.apply.body,
        },
        upload: {
          http_status: uploaded.upload.httpStatus,
          response_text_sha256: uploaded.upload.responseTextSha256,
          body: uploaded.upload.body,
        },
        commit: {
          http_status: uploaded.commit.httpStatus,
          response_text_sha256: uploaded.commit.responseTextSha256,
          body: uploaded.commit.body,
        },
      })
      imageUri = uploaded.summary.imageUris[0]
      imageUpload = {
        source_file: resolvedSourceFile,
        artifact_copy: artifactFile,
        image_upload: uploaded.summary,
      }
    }
    if (!imageUri) throw new Error("Image upload did not return an image URI")

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const description = args.noDescription
      ? null
      : await describeJimengImage({
        fetch: transport.fetch,
        session,
        imageUri,
        babiParam: defaultImageDescriptionBabiParam(),
      })
    const faceRecognition = args.noFaces
      ? null
      : await recognizeJimengImageFaces({
        fetch: transport.fetch,
        session,
        imageUri,
        babiParam: defaultFaceRecognizeBabiParam(),
      })
    const inspection = { imageUri, description, faceRecognition }

    writeJson(path.join(dirs.rawDir, `${runId}-raw.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      description: description ? {
        http_status: description.httpStatus,
        ret: description.ret,
        errmsg: description.errmsg,
        response_text_sha256: description.responseTextSha256,
        request: description.request,
        body: description.body,
      } : null,
      face_recognition: faceRecognition ? {
        http_status: faceRecognition.httpStatus,
        ret: faceRecognition.ret,
        errmsg: faceRecognition.errmsg,
        response_text_sha256: faceRecognition.responseTextSha256,
        request: faceRecognition.request,
        body: faceRecognition.body,
      } : null,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoints,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      image_upload: imageUpload,
      image_uri: imageUri,
      description: description ? {
        http_status: description.httpStatus,
        ret: description.ret,
        errmsg: description.errmsg,
        response_text_sha256: description.responseTextSha256,
        description: description.description,
      } : null,
      face_recognition: faceRecognition ? {
        http_status: faceRecognition.httpStatus,
        ret: faceRecognition.ret,
        errmsg: faceRecognition.errmsg,
        response_text_sha256: faceRecognition.responseTextSha256,
        faces: faceRecognition.faces,
      } : null,
      summary: summarizeReferenceImageInspection(inspection),
    })
    console.log(`[jimeng-browser-proxy] describe-image saved description=${description?.description ? "yes" : "no"} faces=${faceRecognition?.faces.length ?? 0}`)
    return
  }

  if (args.command === "controlnet-preview") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const sourceFile = args.image ?? args.file
    const runId = `controlnet-preview-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const requestedImageUri = args.imageUri
    const control = parseJimengControlNetKind(args.control)
    const fitMode = parseJimengControlNetFitMode(args.fitMode)
    const endpoints = [
      "/mweb/v1/blend_preview",
      ...(control === "pose" && !args.noPoseDetect ? ["/mweb/v1/pose_detect"] : []),
    ]
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (!sourceFile && !requestedImageUri) throw new Error("controlnet-preview requires --image, --file, or --imageUri")

    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: [
          ...(sourceFile ? ["/mweb/v1/get_upload_token scene=2", "ImageX ApplyImageUpload", "ImageX direct POST /upload/v1/{StoreUri}", "ImageX CommitImageUpload"] : []),
          ...endpoints,
        ],
        source_file: sourceFile ? path.resolve(sourceFile) : undefined,
        image_uri: requestedImageUri,
        control,
        fit_mode: fitMode,
        strength: args.strength,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] controlnet-preview dry run saved`)
      return
    }

    let imageUri = requestedImageUri
    let imageUpload: object | null = null
    if (sourceFile) {
      const upload = await uploadReferenceImage({
        session,
        dirs,
        runId,
        role: "controlnet_reference",
        index: 0,
        sourceFile,
      })
      imageUri = upload.uri
      imageUpload = upload
    }
    if (!imageUri) throw new Error("Image upload did not return an image URI")

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const preview = await generateJimengControlNetPreview({
      fetch: transport.fetch,
      session,
      imageUri,
      control,
      strength: args.strength,
      babiParam: defaultControlNetPreviewBabiParam(control),
    })
    const poseDetection = control === "pose" && !args.noPoseDetect
      ? await detectJimengPose({
        fetch: transport.fetch,
        session,
        imageUri,
        babiParam: defaultPoseDetectBabiParam(),
      })
      : null
    const saveParams = buildJimengControlNetSaveParams({
      imageUri,
      control,
      strength: preview.strength,
      previewImageUri: preview.previewImageUri,
      previewImageUrl: preview.previewImageUrl,
      fitMode,
    })
    let previewArtifact: string | null = null
    if (preview.previewImageUrl && !args.noDownload) {
      previewArtifact = path.join(dirs.artifactsDir, `${runId}-${control}-preview.png`)
      const bytes = await new JimengClient().download(preview.previewImageUrl)
      writeFileSync(previewArtifact, Buffer.from(bytes))
    }
    const inspection = { imageUri, control, fitMode, preview, poseDetection, saveParams }

    writeJson(path.join(dirs.rawDir, `${runId}-raw.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      preview: {
        http_status: preview.httpStatus,
        ret: preview.ret,
        errmsg: preview.errmsg,
        response_text_sha256: preview.responseTextSha256,
        request: preview.request,
        body: preview.body,
      },
      pose_detection: poseDetection ? {
        http_status: poseDetection.httpStatus,
        ret: poseDetection.ret,
        errmsg: poseDetection.errmsg,
        response_text_sha256: poseDetection.responseTextSha256,
        request: poseDetection.request,
        body: poseDetection.body,
      } : null,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoints,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      image_upload: imageUpload,
      image_uri: imageUri,
      control,
      fit_mode: fitMode,
      preview: {
        http_status: preview.httpStatus,
        ret: preview.ret,
        errmsg: preview.errmsg,
        response_text_sha256: preview.responseTextSha256,
        request: preview.request,
        preview_image_uri: preview.previewImageUri,
        preview_image_url_present: !!preview.previewImageUrl,
        preview_artifact: previewArtifact,
      },
      pose_detection: poseDetection ? {
        http_status: poseDetection.httpStatus,
        ret: poseDetection.ret,
        errmsg: poseDetection.errmsg,
        response_text_sha256: poseDetection.responseTextSha256,
        request: poseDetection.request,
        is_pose: poseDetection.isPose,
      } : null,
      summary: summarizeControlNetReferenceInspection(inspection),
    })
    console.log(`[jimeng-browser-proxy] controlnet-preview saved control=${control} preview_uri=${preview.previewImageUri ?? "missing"} pose=${poseDetection?.isPose ?? "n/a"}`)
    return
  }

  if (args.command === "object-mask") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const sourceFile = args.image ?? args.file
    const runId = `object-mask-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const requestedImageUri = args.imageUri
    const commandMode = parseJimengObjectSegmentationCommandMode(args.maskMode)
    const modes = jimengObjectSegmentationModes(commandMode)
    const endpoints = modes.map((mode) => `/mweb/v1/saliency_seg${mode === "canvas" ? " mode=canvas" : " default"}`)
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (!sourceFile && !requestedImageUri) throw new Error("object-mask requires --image, --file, or --imageUri")

    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint_sequence: [
          ...(sourceFile ? ["/mweb/v1/get_upload_token scene=2", "ImageX ApplyImageUpload", "ImageX direct POST /upload/v1/{StoreUri}", "ImageX CommitImageUpload"] : []),
          ...endpoints,
        ],
        source_file: sourceFile ? path.resolve(sourceFile) : undefined,
        image_uri: requestedImageUri,
        mode: commandMode,
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] object-mask dry run saved`)
      return
    }

    let imageUri = requestedImageUri
    let imageUpload: object | null = null
    if (sourceFile) {
      const upload = await uploadReferenceImage({
        session,
        dirs,
        runId,
        role: "object_mask_reference",
        index: 0,
        sourceFile,
      })
      imageUri = upload.uri
      imageUpload = upload
    }
    if (!imageUri) throw new Error("Image upload did not return an image URI")

    const results: JimengObjectSegmentationResult[] = []
    const downloadedMasks: Array<{ mode: string; index: number; saved_file: string; mask_uri: string | null }> = []
    const client = new JimengClient()
    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    for (const mode of modes) {
      const result = await segmentJimengObject({
        fetch: transport.fetch,
        session,
        imageUri,
        mode,
        babiParam: defaultObjectSegmentationBabiParam(),
      })
      results.push(result)
      if (!args.noDownload) {
        for (let i = 0; i < result.masks.length; i += 1) {
          const mask = result.masks[i]!
          if (!mask.maskUrl) continue
          const file = path.join(dirs.artifactsDir, `${runId}-${mode}-mask-${String(i + 1).padStart(2, "0")}.png`)
          const bytes = await client.download(mask.maskUrl)
          writeFileSync(file, Buffer.from(bytes))
          downloadedMasks.push({ mode, index: i, saved_file: file, mask_uri: mask.maskUri })
        }
      }
    }

    writeJson(path.join(dirs.rawDir, `${runId}-raw.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      results: results.map((result) => ({
        mode: result.mode,
        http_status: result.httpStatus,
        ret: result.ret,
        errmsg: result.errmsg,
        response_text_sha256: result.responseTextSha256,
        request: result.request,
        body: result.body,
      })),
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: args.command,
      endpoints,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      image_upload: imageUpload,
      image_uri: imageUri,
      mode: commandMode,
      requests: results.map((result) => result.request),
      downloaded_masks: downloadedMasks,
      summary: summarizeObjectSegmentation(results),
    })
    console.log(`[jimeng-browser-proxy] object-mask saved mode=${commandMode} masks=${results.map((result) => `${result.mode}:${result.masks.length}`).join(",")}`)
    return
  }

  if (args.command === "upload-token") {
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const scene = parseUploadTokenScene(args.scene)
    const runId = `upload-token-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), {
        command: args.command,
        endpoint: "/mweb/v1/get_upload_token",
        method: "POST",
        request: { scene },
        transport: {
          mode: args.transportMode,
          cassette_path: cassettePath ?? null,
        },
        browser_session: redactSession(session),
      })
      console.log(`[jimeng-browser-proxy] upload-token dry run saved scene=${scene}`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await getJimengUploadToken({ fetch: transport.fetch, session, token: { scene } })
    writeJson(path.join(dirs.rawDir, `${runId}.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      response_text_sha256: result.responseTextSha256,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      scene,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      summary: result.summary,
    })
    console.log(`[jimeng-browser-proxy] upload-token saved scene=${scene}`)
    return
  }

  if (args.command === "upload-image") {
    if (!args.file) throw new Error("--file is required")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const sourceFile = path.resolve(args.file)
    const bytes = readFileSync(sourceFile)
    const runId = `upload-image-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const artifactFile = path.join(dirs.artifactsDir, path.basename(sourceFile))
    writeFileSync(artifactFile, bytes)
    const plan = {
      command: args.command,
      endpoint_sequence: [
        "/mweb/v1/get_upload_token",
        "ImageX ApplyImageUpload",
        "ImageX direct POST /upload/v1/{StoreUri}",
        "ImageX CommitImageUpload",
      ],
      source_file: sourceFile,
      artifact_copy: artifactFile,
      file_name: path.basename(sourceFile),
      bytes: bytes.byteLength,
      transport: {
        mode: args.transportMode,
        cassette_path: cassettePath ?? null,
      },
      browser_session: redactSession(session),
    }
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
      console.log(`[jimeng-browser-proxy] upload-image dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await uploadJimengImage({
      fetch: transport.fetch,
      session,
      image: {
        fileName: path.basename(sourceFile),
        bytes,
      },
    })
    writeJson(path.join(dirs.rawDir, `${runId}-raw.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      token: {
        http_status: result.token.httpStatus,
        response_text_sha256: result.token.responseTextSha256,
        body: result.token.body,
      },
      apply: {
        http_status: result.apply.httpStatus,
        response_text_sha256: result.apply.responseTextSha256,
        body: result.apply.body,
      },
      upload: {
        http_status: result.upload.httpStatus,
        response_text_sha256: result.upload.responseTextSha256,
        body: result.upload.body,
      },
      commit: {
        http_status: result.commit.httpStatus,
        response_text_sha256: result.commit.responseTextSha256,
        body: result.commit.body,
      },
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      ...plan,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      token_summary: result.token.summary,
      image_upload: result.summary,
    })
    console.log(`[jimeng-browser-proxy] upload-image saved uri=${result.summary.imageUris[0] ?? "missing"}`)
    return
  }

  if (args.command === "upload-video") {
    if (!args.file) throw new Error("--file is required")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const sourceFile = path.resolve(args.file)
    const bytes = readFileSync(sourceFile)
    const runId = `upload-video-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    const artifactFile = path.join(dirs.artifactsDir, path.basename(sourceFile))
    writeFileSync(artifactFile, bytes)
    const plan = {
      command: args.command,
      endpoint_sequence: [
        "/mweb/v1/get_upload_token scene=1",
        "VOD ApplyUploadInner",
        "VOD direct POST /upload/v1/{StoreUri}",
        "VOD CommitUploadInner",
      ],
      source_file: sourceFile,
      artifact_copy: artifactFile,
      file_name: path.basename(sourceFile),
      bytes: bytes.byteLength,
      transport: {
        mode: args.transportMode,
        cassette_path: cassettePath ?? null,
      },
      browser_session: redactSession(session),
    }
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
      console.log(`[jimeng-browser-proxy] upload-video dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    const result = await uploadJimengVideo({
      fetch: transport.fetch,
      session,
      video: {
        fileName: path.basename(sourceFile),
        bytes,
      },
    })
    writeJson(path.join(dirs.rawDir, `${runId}-raw.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      token: {
        http_status: result.token.httpStatus,
        response_text_sha256: result.token.responseTextSha256,
        body: result.token.body,
      },
      apply: {
        http_status: result.apply.httpStatus,
        response_text_sha256: result.apply.responseTextSha256,
        body: result.apply.body,
      },
      upload: {
        http_status: result.upload.httpStatus,
        response_text_sha256: result.upload.responseTextSha256,
        body: result.upload.body,
      },
      commit: {
        http_status: result.commit.httpStatus,
        response_text_sha256: result.commit.responseTextSha256,
        body: result.commit.body,
      },
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      ...plan,
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      token_summary: result.token.summary,
      video_upload: result.summary,
    })
    console.log(`[jimeng-browser-proxy] upload-video saved vid=${result.summary.vid ?? "missing"} storeUri=${result.summary.storeUri}`)
    return
  }

  if (args.command === "subject-create") {
    if (!args.name) throw new Error("--name is required for subject-create")
    if (!args.workspaceId) throw new Error("--workspaceId is required for subject-create")
    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const sourceFile = args.image ?? args.file
    const runId = `subject-create-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const cassettePath = resolveJimengHttpCassettePath(args, dirs, runId)
    if (sourceFile && args.imageUri) {
      throw new Error("subject-create accepts either a local --image/--file or existing --imageUri, not both")
    }
    if (!sourceFile && !args.imageUri) {
      throw new Error("subject-create requires --image, --file, or existing --imageUri with --imageWidth and --imageHeight")
    }

    const existingReference = sourceFile ? null : subjectImageReferenceFromArgs(args, "subject-create")
    const dryRunRequest = existingReference ? buildJimengSubjectCreateRequest({
      name: args.name,
      description: args.description,
      workspaceId: args.workspaceId,
      mainImage: existingReference,
    }) : null
    const plan = {
      command: args.command,
      endpoint_sequence: [
        ...(sourceFile ? [
          "/mweb/v1/get_upload_token scene=2",
          "ImageX ApplyImageUpload",
          "ImageX direct POST /upload/v1/{StoreUri}",
          "ImageX CommitImageUpload",
          "/mweb/v1/imagex/submit_audit_job",
          "/mweb/v1/get_image_by_uri",
        ] : [
          ...(existingReference?.imageUrl ? [] : ["/mweb/v1/get_image_by_uri"]),
        ]),
        "/mweb/v1/dreamina_subject/create",
      ],
      source_file: sourceFile ? path.resolve(sourceFile) : undefined,
      existing_image_uri: args.imageUri,
      workspace_id: args.workspaceId,
      name: args.name,
      description_present: args.description !== undefined,
      request: dryRunRequest ? redactSignedUrls(dryRunRequest) : undefined,
      transport: {
        mode: args.transportMode,
        cassette_path: cassettePath ?? null,
      },
      browser_session: redactSession(session),
    }
    if (args.dryRun) {
      writeJson(path.join(dirs.rawDir, `${runId}-dry-run-plan.json`), plan)
      console.log(`[jimeng-browser-proxy] subject-create dry run saved`)
      return
    }

    const transport = createJimengHttpTransport({
      mode: args.transportMode,
      cassettePath,
    })
    let mainImage: JimengSubjectImageReference
    let uploadSummary: ReferenceUploadSummary | null = null
    let audit: Awaited<ReturnType<typeof submitJimengImageAuditJob>> | null = null
    let imageLookup: Awaited<ReturnType<typeof fetchJimengImagesByUri>> | null = null
    if (sourceFile) {
      uploadSummary = await uploadReferenceImage({
        session,
        dirs,
        runId,
        role: "subject_main_image",
        index: 0,
        sourceFile,
      })
      audit = await submitJimengImageAuditJob({
        fetch: transport.fetch,
        session,
        imageUris: [uploadSummary.uri],
      })
      writeJson(path.join(dirs.rawDir, `${runId}-audit-raw.json`), {
        http_status: audit.httpStatus,
        ret: audit.ret,
        errmsg: audit.errmsg,
        response_text_sha256: audit.responseTextSha256,
        request: audit.request,
        body: audit.body,
      })
      imageLookup = await fetchJimengImagesByUri({
        fetch: transport.fetch,
        session,
        imageUris: [uploadSummary.uri],
      })
      writeJson(path.join(dirs.rawDir, `${runId}-image-lookup-raw.json`), {
        http_status: imageLookup.httpStatus,
        ret: imageLookup.ret,
        errmsg: imageLookup.errmsg,
        response_text_sha256: imageLookup.responseTextSha256,
        request: imageLookup.request,
        body: imageLookup.body,
      })
      mainImage = subjectImageReferenceFromUploadSummary(uploadSummary.image_upload, imageLookup.images[0]?.imageUrl ?? args.imageUrl)
    } else {
      mainImage = existingReference!
      if (!mainImage.imageUrl) {
        imageLookup = await fetchJimengImagesByUri({
          fetch: transport.fetch,
          session,
          imageUris: [mainImage.imageUri],
        })
        writeJson(path.join(dirs.rawDir, `${runId}-image-lookup-raw.json`), {
          http_status: imageLookup.httpStatus,
          ret: imageLookup.ret,
          errmsg: imageLookup.errmsg,
          response_text_sha256: imageLookup.responseTextSha256,
          request: imageLookup.request,
          body: imageLookup.body,
        })
        const imageUrl = imageLookup.images[0]?.imageUrl
        if (imageUrl) mainImage = { ...mainImage, imageUrl }
      }
    }

    const result = await createJimengSubject({
      fetch: transport.fetch,
      session,
      subject: {
        name: args.name,
        description: args.description,
        workspaceId: args.workspaceId,
        mainImage,
      },
    })
    writeJson(path.join(dirs.rawDir, `${runId}-raw.json`), {
      transport: {
        mode: transport.info.mode,
        cassette_path: transport.info.cassettePath,
      },
      http_status: result.httpStatus,
      ret: result.ret,
      errmsg: result.errmsg,
      response_text_sha256: result.responseTextSha256,
      request: result.request,
      body: result.body,
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      ...plan,
      request: redactSignedUrls(result.request),
      reference_upload: uploadSummary,
      audit: audit ? {
        endpoint: audit.endpoint,
        http_status: audit.httpStatus,
        ret: audit.ret,
        errmsg: audit.errmsg,
        response_text_sha256: audit.responseTextSha256,
        request: audit.request,
      } : null,
      image_lookup: imageLookup ? summarizeJimengImageByUri(imageLookup) : null,
      main_image: {
        image_uri: mainImage.imageUri,
        width: mainImage.width,
        height: mainImage.height,
        image_url_present: !!mainImage.imageUrl,
      },
      summary: summarizeJimengSubjectCreate(result),
    })
    console.log(`[jimeng-browser-proxy] subject-create saved subjectId=${result.subjectId ?? "missing"}`)
    return
  }

  if (args.command === "lip-sync") {
    if (!args.dryRun) {
      throw new Error("lip-sync live submit is not implemented yet; pass --dryRun to write the confirmed provider-input plan")
    }
    if (!args.voiceId) throw new Error("--voice-id is required for lip-sync text-to-speech planning")

    const dirs = ensureOutputDirs(path.resolve(args.outDir))
    const runId = `lip-sync-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
    const hasImageInput = !!args.image || !!args.imageUri
    const hasVideoInput = !!args.video || !!args.vid || !!args.videoUri || (!!args.file && !hasImageInput)
    if (hasImageInput && hasVideoInput) {
      throw new Error("lip-sync accepts either image/avatar input (--image or --imageUri) or video input (--video/--file or --vid), not both")
    }
    const ttsInfo = {
      sourceType: "text-to-speech" as const,
      text: args.text ?? "三秒告诉你为什么这款补水精华适合熬夜后的底妆。",
      speed: args.speed ?? 1,
      toneId: args.voiceId,
      toneKey: args.toneKey ?? args.voiceTitle,
      toneCategoryId: args.toneCategoryId,
      toneCategoryKey: args.toneCategoryKey,
    }

    if (hasImageInput) {
      const referenceUploads: ReferenceUploadSummary[] = []
      const imageUpload = args.image
        ? await uploadReferenceImage({
          session,
          dirs,
          runId,
          role: "lip_sync_image",
          index: 0,
          sourceFile: args.image,
        })
        : undefined
      if (imageUpload) referenceUploads.push(imageUpload)
      const imageReference = imageUpload
        ? lipSyncImageReferenceFromUploadSummary(imageUpload.image_upload)
        : lipSyncImageReferenceFromArgs(args)

      const plan = buildJimengLipSyncImagePlan({
        prompt: args.prompt,
        modelReqKey: args.modelReqKey,
        videoMode: args.videoMode,
        image: imageReference,
        ttsInfo,
      })
      const file = path.join(dirs.rawDir, `${runId}-dry-run-plan.json`)
      writeJson(file, {
        plan,
        reference_uploads: referenceUploads,
        browser_session: redactSession(session),
      })
      writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
        command: "lip-sync",
        mode: plan.mode,
        status: plan.status,
        reason: plan.reason,
        model_req_key: plan.modelReqKey,
        image_reference: imageReference,
        tts_info: plan.providerInput.videoGenInputs.i2vOpt.realmanAvatar.ttsInfo,
        reference_uploads: referenceUploads.map((upload) => ({
          index: upload.index,
          role: upload.role,
          source_file: upload.source_file,
          artifact_copy: upload.artifact_copy,
          uri: upload.uri,
          width: upload.image_upload.pluginResults[0]?.imageWidth ?? null,
          height: upload.image_upload.pluginResults[0]?.imageHeight ?? null,
        })),
        next_probe: plan.nextProbe,
      })
      console.log(`[jimeng-browser-proxy] lip-sync image dry run saved: ${file}`)
      return
    }

    const referenceUploads: ReferenceVideoUploadSummary[] = []
    const videoFile = args.video ?? args.file
    const videoUpload = videoFile
      ? await uploadReferenceVideo({
        session,
        dirs,
        runId,
        role: "lip_sync_video",
        index: 0,
        sourceFile: videoFile,
      })
      : undefined
    if (videoUpload) referenceUploads.push(videoUpload)
    const videoReference = videoUpload
      ? lipSyncVideoReferenceFromUploadSummary(videoUpload.video_upload)
      : lipSyncVideoReferenceFromArgs(args)

    const plan = buildJimengLipSyncVideoPlan({
      prompt: args.prompt,
      modelReqKey: args.modelReqKey,
      videoMode: args.videoMode,
      video: videoReference,
      ttsInfo,
    })
    const file = path.join(dirs.rawDir, `${runId}-dry-run-plan.json`)
    writeJson(file, {
      plan,
      reference_uploads: referenceUploads,
      browser_session: redactSession(session),
    })
    writeJson(path.join(dirs.normalizedDir, `${runId}-summary.json`), {
      command: "lip-sync",
      mode: plan.mode,
      status: plan.status,
      reason: plan.reason,
      model_req_key: plan.modelReqKey,
      video_reference: videoReference,
      tts_info: plan.providerInput.videoGenInputs.v2vOpt.lipSyncUserVideo.ttsInfo,
      reference_uploads: referenceUploads.map((upload) => ({
        index: upload.index,
        role: upload.role,
        source_file: upload.source_file,
        artifact_copy: upload.artifact_copy,
        vid: upload.video_upload.vid,
        uri: upload.video_upload.uri,
        width: upload.video_upload.width,
        height: upload.video_upload.height,
        duration: upload.video_upload.duration,
      })),
      next_probe: plan.nextProbe,
    })
    console.log(`[jimeng-browser-proxy] lip-sync dry run saved: ${file}`)
    return
  }

  if (!args.capture) throw new Error("--capture is required")

  const op: JimengOp = args.command === "text2image" ? "image" : "video"
  const runId = `${args.command}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`
  const dirs = ensureOutputDirs(path.resolve(args.outDir))
  const capture = readJson(args.capture) as CaptureFile
  const referenceUploads: ReferenceUploadSummary[] = []
  let firstFrameUri = args.firstFrameUri
  let lastFrameUri = args.lastFrameUri

  if (args.command === "image2video" || args.command === "frames2video") {
    const imageFile = args.image ?? args.file
    if (imageFile) {
      const upload = await uploadReferenceImage({
        session,
        dirs,
        runId,
        role: "first_frame",
        index: 0,
        sourceFile: imageFile,
      })
      referenceUploads.push(upload)
      firstFrameUri = upload.uri
    }

    if (!firstFrameUri) {
      throw new Error(`${args.command} requires --image, --file, or --firstFrameUri`)
    }

    if (args.command === "frames2video") {
      if (args.lastImage) {
        const upload = await uploadReferenceImage({
          session,
          dirs,
          runId,
          role: "end_frame",
          index: 1,
          sourceFile: args.lastImage,
        })
        referenceUploads.push(upload)
        lastFrameUri = upload.uri
      }

      if (!lastFrameUri) {
        throw new Error("frames2video requires --lastImage or --lastFrameUri")
      }
    }
  }

  const prepared = prepareFromCapture({
    op,
    capture,
    session,
    prompt: args.prompt,
    durationSec: args.durationSec,
    firstFrameUri,
    lastFrameUri,
    ratio: args.ratio,
    videoResolution: args.videoResolution,
    modelVersion: args.modelVersion,
    modelReqKey: args.modelReqKey,
    seed: args.seed,
  })

  const plan = {
    command: args.command,
    op: prepared.op,
    submit_kind: prepared.submitKind,
    poll_kind: prepared.pollKind,
    submit_id: prepared.submitId,
    submit_url: prepared.submitUrl,
    poll_url: prepared.pollUrl,
    submit_headers: redactHeaders(prepared.submitHeaders),
    poll_headers: redactHeaders(prepared.pollHeaders),
    submit_body: prepared.submitBody,
    poll_body: prepared.pollBody,
    terminal_status: prepared.terminalStatus,
    reference_uploads: referenceUploads,
    browser_session: redactSession(session),
  }

  if (args.dryRun) {
    const file = path.join(dirs.rawDir, `${runId}-dry-run-plan.json`)
    writeJson(file, plan)
    console.log(`[jimeng-browser-proxy] dry run saved: ${file}`)
    return
  }

  const client = new JimengClient()
  console.log(`[jimeng-browser-proxy] live submit command=${args.command} submitKind=${prepared.submitKind} pollKind=${prepared.pollKind}`)
  const submit = await client.submitPrepared(prepared)
  writeJson(path.join(dirs.rawDir, `${runId}-submit.json`), submit)
  console.log(`[jimeng-browser-proxy] submit accepted submitId=${submit.submitId} historyId=${submit.historyId ?? "n/a"}`)

  const poll = await client.pollUntilTerminal({
    pollUrl: prepared.pollUrl,
    pollHeaders: prepared.pollHeaders,
    submitId: submit.submitId,
    terminalStatus: prepared.terminalStatus,
    pollKind: prepared.pollKind,
    pollBody: prepared.pollBody,
    pollIntervalMs: args.pollIntervalMs,
    maxPolls: args.maxPolls,
  })
  writeJson(path.join(dirs.rawDir, `${runId}-poll.json`), poll)
  console.log(`[jimeng-browser-proxy] poll complete status=${poll.record.status ?? "unknown"} trace=${poll.trace.length}`)

  const artifacts = args.noDownload ? [] : await client.downloadArtifacts(prepared.op, poll.record)
  const manifest = []
  for (let i = 0; i < artifacts.length; i += 1) {
    const artifact = artifacts[i]!
    const ext = artifact.kind === "video" ? "mp4" : "png"
    const file = path.join(dirs.artifactsDir, `${submit.submitId}-${String(i).padStart(2, "0")}.${ext}`)
    writeFileSync(file, Buffer.from(artifact.bytes))
    manifest.push({ kind: artifact.kind, url: artifact.url, saved_file: file })
  }

  writeJson(path.join(dirs.normalizedDir, `${runId}-result.json`), redactJimengProofForNormalized({ plan, submit, pollTrace: poll.trace, artifacts: manifest }))
  console.log(`[jimeng-browser-proxy] done artifacts=${manifest.length}`)
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    console.log(USAGE)
    process.exit(0)
  }

  const command = argv[0]
  if (
    command !== "session"
    && command !== "capture-analyze"
    && command !== "discovery-worklist"
    && command !== "static-locate"
    && command !== "static-inventory"
    && command !== "contract-infer"
    && command !== "generation-contract"
    && command !== "triage-coverage"
    && command !== "catalog"
    && command !== "agent-catalog"
    && command !== "image-models"
    && command !== "text2image-plan"
    && command !== "text2image-compare"
    && command !== "text2video-plan"
    && command !== "text2video-compare"
    && command !== "omni-video-plan"
    && command !== "omni-video-compare"
    && command !== "generate-audit-plan"
    && command !== "mix-audio-plan"
    && command !== "video-preprocess-plan"
    && command !== "video-preprocess-query-plan"
    && command !== "request-plan-compare"
    && command !== "account-credit"
    && command !== "commerce-benefits"
    && command !== "commerce-pricing"
    && command !== "account-config"
    && command !== "runtime-config"
    && command !== "workspace-context"
    && command !== "research-keywords"
    && command !== "research-search"
    && command !== "profile-research"
    && command !== "local-items"
    && command !== "story-records"
    && command !== "async-tasks"
    && command !== "story-export-plan"
    && command !== "infinite-canvas"
    && command !== "endpoint-probe"
    && command !== "rate-probe"
    && command !== "lip-sync-config"
    && command !== "lip-sync-compare"
    && command !== "voices"
    && command !== "voice-clones"
    && command !== "voice-clone-submit"
    && command !== "voice-clone-query"
    && command !== "voice-clone-update"
    && command !== "voice-clone-delete"
    && command !== "tts"
    && command !== "sample-voices"
    && command !== "assets"
    && command !== "history-list"
    && command !== "history-queue"
    && command !== "history-records"
    && command !== "video-info"
    && command !== "templates"
    && command !== "short-videos"
    && command !== "overseas-short-videos"
    && command !== "capcut-probe"
    && command !== "capcut-categories"
    && command !== "capcut-collections"
    && command !== "capcut-collection-templates"
    && command !== "capcut-template-detail"
    && command !== "capcut-template-metadata"
    && command !== "capcut-editor-catalog"
    && command !== "subjects"
    && command !== "describe-image"
    && command !== "controlnet-preview"
    && command !== "object-mask"
    && command !== "upload-token"
    && command !== "upload-image"
    && command !== "upload-video"
    && command !== "subject-create"
    && command !== "subject-update"
    && command !== "subject-delete"
    && command !== "subject-generate-voice"
    && command !== "text2image"
    && command !== "text2video"
    && command !== "image2video"
    && command !== "frames2video"
    && command !== "lip-sync"
  ) {
    throw new Error(`Unknown command: ${String(command)}`)
  }

  const flags = parseJimengBrowserProxyFlags(argv.slice(1))
  const method = parseEndpointProbeMethod(flags.method)
  const transportMode = parseJimengHttpTransportMode(flags.transport ?? flags.transportMode ?? flags["transport-mode"])
  const durationSec = flags.durationSec
  const videoWidth = flags.videoWidth ? Number(flags.videoWidth) : undefined
  const videoHeight = flags.videoHeight ? Number(flags.videoHeight) : undefined
  const videoDurationSec = flags.videoDurationSec ? Number(flags.videoDurationSec) : undefined
  const audioDurationSec = flags.audioDurationSec ? Number(flags.audioDurationSec) : undefined
  const imageWidth = flags.imageWidth ? Number(flags.imageWidth) : undefined
  const imageHeight = flags.imageHeight ? Number(flags.imageHeight) : undefined
  const canvasWidth = flags.canvasWidth ? Number(flags.canvasWidth) : undefined
  const canvasHeight = flags.canvasHeight ? Number(flags.canvasHeight) : undefined
  const capcutScale = flags.scale ? Number(flags.scale) : undefined
  const capcutCollectionId = flags["collection-id"] ? Number(flags["collection-id"]) : undefined
  const workspaceIdValue = flags.workspaceId ?? flags["workspace-id"]
  const workspaceId = workspaceIdValue ? Number(workspaceIdValue) : undefined
  const speed = flags.speed ? Number(flags.speed) : undefined
  const strength = flags.strength ? Number(flags.strength) : undefined
  const sampleStrength = flags.sampleStrength ? Number(flags.sampleStrength) : undefined
  const fps = flags.fps ? Number(flags.fps) : undefined
  const contextLinesValue = flags.contextLines ?? flags["context-lines"]
  const contextLines = contextLinesValue ? Number(contextLinesValue) : undefined
  const seed = flags.seed ? Number(flags.seed) : undefined
  const itemPlatform = flags["item-platform"] ? Number(flags["item-platform"]) : undefined
  const limit = flags.limit ? Number(flags.limit) : undefined
  const requests = flags.requests ? Number(flags.requests) : undefined
  const concurrency = flags.concurrency ? Number(flags.concurrency) : undefined
  const delayMs = flags.delayMs ? Number(flags.delayMs) : undefined
  const offset = flags.offset ? Number(flags.offset) : undefined
  const cursor = flags.cursor ? Number(flags.cursor) : undefined
  const categoryId = flags["category-id"] ? Number(flags["category-id"]) : undefined
  const assetTypes = parseJimengAssetTypes(flags["asset-types"])
  const filterTypes = parseJimengHistoryFilterTypeListFlag(flags["filter-types"])
  const submitIds = parseJimengIdCsvFlag(flags.submitIds)
  const historyIds = parseJimengHistoryIdsFlag(flags.historyIds)
  const vids = parseJimengVidCsvFlag(flags.vids)
  const direction = flags.direction ? Number(flags.direction) : undefined
  const orderBy = flags["order-by"] ? Number(flags["order-by"]) : undefined
  const endTimeStamp = flags.endTimeStamp ? Number(flags.endTimeStamp) : undefined
  const beginTimeStamp = flags.beginTimeStamp ? Number(flags.beginTimeStamp) : undefined
  const blockIndex = flags.blockIndex ? Number(flags.blockIndex) : undefined
  const isClientFilter = parseOptionalBooleanFlag(flags.isClientFilter, "--isClientFilter")
  const needBetaModel = parseOptionalBooleanFlag(flags.needBetaModel, "--needBetaModel")
  const needCache = parseOptionalBooleanFlag(flags.needCache, "--needCache")
  const needRefresh = parseOptionalBooleanFlag(flags.needRefresh, "--needRefresh")
  const imageInfo = parseOptionalBooleanFlag(flags.imageInfo, "--imageInfo")
  const needDraftResource = parseOptionalBooleanFlag(flags.needDraftResource, "--needDraftResource")
  const intelligentRatio = parseOptionalBooleanFlag(flags.intelligentRatio, "--intelligentRatio")
  const onlyFavorite = parseOptionalBooleanFlag(flags.onlyFavorite, "--onlyFavorite")
  const needIntentionMark = parseOptionalBooleanFlag(flags.needIntentionMark, "--needIntentionMark")
  const isInsertFrame = parseOptionalBooleanFlag(flags.isInsertFrame, "--isInsertFrame")
  const hideStoryAgentResult = parseOptionalBooleanFlag(flags.hideStoryAgentResult, "--hideStoryAgentResult")
  const decisions = parseJimengDiscoveryTriageDecisions(flags.decisions)
  if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)) {
    throw new Error("--seed must be an integer from 0 to 4294967295")
  }
  if (itemPlatform !== undefined && (!Number.isInteger(itemPlatform) || itemPlatform < 1)) {
    throw new Error("--item-platform must be a positive integer")
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error("--limit must be a positive integer")
  }
  if (requests !== undefined && (!Number.isInteger(requests) || requests < 1)) {
    throw new Error("--requests must be a positive integer")
  }
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
    throw new Error("--concurrency must be a positive integer")
  }
  if (delayMs !== undefined && (!Number.isInteger(delayMs) || delayMs < 0)) {
    throw new Error("--delayMs must be a non-negative integer")
  }
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 0)) {
    throw new Error("--offset must be a non-negative integer")
  }
  if (cursor !== undefined && (!Number.isInteger(cursor) || cursor < 0)) {
    throw new Error("--cursor must be a non-negative integer")
  }
  if (categoryId !== undefined && (!Number.isInteger(categoryId) || categoryId < 1)) {
    throw new Error("--category-id must be a positive integer")
  }
  if (direction !== undefined && !Number.isInteger(direction)) {
    throw new Error("--direction must be an integer")
  }
  if (orderBy !== undefined && !Number.isInteger(orderBy)) {
    throw new Error("--order-by must be an integer")
  }
  if (endTimeStamp !== undefined && (!Number.isFinite(endTimeStamp) || endTimeStamp < 0)) {
    throw new Error("--endTimeStamp must be a non-negative number")
  }
  if (beginTimeStamp !== undefined && (!Number.isFinite(beginTimeStamp) || beginTimeStamp < 0)) {
    throw new Error("--beginTimeStamp must be a non-negative number")
  }
  if (blockIndex !== undefined && (!Number.isInteger(blockIndex) || blockIndex < 0)) {
    throw new Error("--blockIndex must be a non-negative integer")
  }
  if (videoWidth !== undefined && (!Number.isInteger(videoWidth) || videoWidth < 1)) {
    throw new Error("--videoWidth must be a positive integer")
  }
  if (videoHeight !== undefined && (!Number.isInteger(videoHeight) || videoHeight < 1)) {
    throw new Error("--videoHeight must be a positive integer")
  }
  if (videoDurationSec !== undefined && (!Number.isFinite(videoDurationSec) || videoDurationSec <= 0)) {
    throw new Error("--videoDurationSec must be a positive number")
  }
  if (audioDurationSec !== undefined && (!Number.isFinite(audioDurationSec) || audioDurationSec <= 0)) {
    throw new Error("--audioDurationSec must be a positive number")
  }
  if (imageWidth !== undefined && (!Number.isInteger(imageWidth) || imageWidth < 1)) {
    throw new Error("--imageWidth must be a positive integer")
  }
  if (imageHeight !== undefined && (!Number.isInteger(imageHeight) || imageHeight < 1)) {
    throw new Error("--imageHeight must be a positive integer")
  }
  if (canvasWidth !== undefined && (!Number.isInteger(canvasWidth) || canvasWidth < 1)) {
    throw new Error("--canvasWidth must be a positive integer")
  }
  if (canvasHeight !== undefined && (!Number.isInteger(canvasHeight) || canvasHeight < 1)) {
    throw new Error("--canvasHeight must be a positive integer")
  }
  if (capcutScale !== undefined && (!Number.isFinite(capcutScale) || capcutScale <= 0)) {
    throw new Error("--scale must be a positive number")
  }
  if (capcutCollectionId !== undefined && (!Number.isInteger(capcutCollectionId) || capcutCollectionId < 1)) {
    throw new Error("--collection-id must be a positive integer")
  }
  if (workspaceId !== undefined && (!Number.isInteger(workspaceId) || workspaceId < (command === "research-search" ? 0 : 1))) {
    throw new Error(command === "research-search"
      ? "--workspaceId must be a non-negative integer for research-search"
      : "--workspaceId must be a positive integer")
  }
  if (speed !== undefined && (!Number.isFinite(speed) || speed < 0.5 || speed > 2)) {
    throw new Error("--speed must be a number from 0.5 to 2")
  }
  if (strength !== undefined && (!Number.isFinite(strength) || strength <= 0 || strength > 100)) {
    throw new Error("--strength must be a number from 0.01..1 or 1..100")
  }
  if (sampleStrength !== undefined && (!Number.isFinite(sampleStrength) || sampleStrength < 0 || sampleStrength > 1)) {
    throw new Error("--sampleStrength must be a number from 0 to 1")
  }
  if (fps !== undefined && (!Number.isInteger(fps) || fps < 1 || fps > 60)) {
    throw new Error("--fps must be an integer from 1 to 60")
  }
  if (contextLines !== undefined && (!Number.isInteger(contextLines) || contextLines < 0 || contextLines > 20)) {
    throw new Error("--contextLines must be an integer from 0..20")
  }
  return {
    command,
    cdpUrl: flags.cdp ?? DEFAULT_CDP_URL,
    targetUrl: flags["target-url"],
    session: flags.session,
    sessionOut: flags["session-out"] ?? "data/jimeng-lab/raw/session-bundle-current.json",
    capture: flags.capture,
    rawNetwork: flags.rawNetwork ?? flags["raw-network"],
    captureDir: flags.captureDir ?? flags["capture-dir"],
    input: flags.input,
    analysisFiles: parseCsvFlag(flags.analysis),
    probeCandidateFiles: parseCsvFlag(flags.probeCandidates ?? flags["probe-candidates"]),
    staticRoots: parseCsvFlag(flags.staticRoot ?? flags["static-root"]),
    staticQueries: command === "static-locate" ? parseJimengStaticLocatorQueries(flags.staticQuery ?? flags["static-query"] ?? flags.symbol ?? flags.query) : undefined,
    contextLines,
    includeRisky: flags.includeRisky === "true" || flags["include-risky"] === "true",
    includeKnown: flags.includeKnown === "true" || flags["include-known"] === "true",
    decisions,
    plan: flags.plan,
    endpoint: flags.endpoint,
    method,
    query: command === "static-locate" ? undefined : flags.query,
    body: flags.body,
    materials: flags.materials,
    babiParam: flags.babiParam,
    videoItemId: flags.videoItemId,
    inputList: flags.inputList,
    videoPreprocessMode: command === "video-preprocess-plan" ? parseJimengVideoPreprocessMode(flags.mode) : undefined,
    imageUris: flags.imageUris,
    detectionScene: flags.detectionScene,
    batch: parseOptionalBooleanFlag(flags.batch, "--batch"),
    variants: flags.variants,
    transportMode,
    cassette: flags.cassette,
    requests,
    concurrency,
    delayMs,
    endpoints: flags.endpoints,
    channels: flags.channel ?? flags.channels,
    searchId: flags.searchId,
    source: flags.source,
    assetType: flags.assetType,
    blockIndex,
    showTypeList: parseJimengResearchShowTypeList(flags.showTypeList),
    secUid: flags.secUid,
    language: flags.language,
    publishedItemId: flags.publishedItemId,
    publishedItemIds: parseJimengPublishedItemIds(flags.publishedItemIds),
    itemIds: parseJimengLocalItemIds(flags.itemIds),
    storyIds: parseJimengStoryIds(flags.storyIds),
    imageTypeList: parseJimengProfileImageTypeList(flags.imageTypeList),
    needIntentionMark,
    isInsertFrame,
    hideStoryAgentResult,
    beginTimeStamp,
    text: flags.text,
    voiceId: flags["voice-id"],
    voiceTitle: flags["voice-title"],
    voiceStatuses: parseCsvFlag(flags["voice-statuses"]),
    audioVid: flags.audioVid,
    audioUrl: flags.audioUrl,
    audioDurationSec,
    audioTitle: flags.audioTitle,
    taskIds: parseCsvFlag(flags.taskIds),
    toneKey: flags["tone-key"],
    toneCategoryId: flags["tone-category-id"],
    toneCategoryKey: flags["tone-category-key"],
    speed,
    itemPlatform,
    limit,
    offset,
    assetTypes,
    filterTypes,
    assetMode: flags["asset-mode"],
    submitId: flags.submitId,
    submitIds,
    historyId: flags.historyId,
    historyIds,
    vids,
    direction,
    orderBy,
    endTimeStamp,
    includeStoryAgentResult: flags.includeStoryAgentResult === "true",
    cursor,
    keyword: flags.keyword,
    subjectId: flags.subjectId,
    subjectIds: parseCsvFlag(flags.subjectIds),
    onlyFavorite,
    imageInfo,
    projectId: flags.projectId,
    userId: flags.userId,
    workspaceIds: parseCsvFlag(flags.workspaceIds),
    needDraftResource,
    categoryId,
    workTypes: flags["work-types"],
    feedRefer: flags["feed-refer"],
    capcutLan: flags["capcut-lan"],
    capcutLoc: flags["capcut-loc"],
    capcutCollectionId,
    capcutTemplateId: flags["template-id"],
    capcutCategoryType: parseMaybeNumberFlag(flags["category-type"]),
    capcutScale,
    canvasWidth,
    canvasHeight,
    needDraft: flags.needDraft === "true",
    isClientFilter,
    needBetaModel,
    needCache,
    needRefresh,
    panel: flags.panel,
    category: flags.category,
    lang: flags.lang,
    region: flags.region,
    scene: flags.scene,
    file: flags.file,
    video: flags.video,
    imageUri: flags.imageUri,
    noDescription: flags.noDescription === "true",
    noFaces: flags.noFaces === "true",
    control: flags.control,
    strength,
    fitMode: flags.fitMode,
    noPoseDetect: flags.noPoseDetect === "true",
    maskMode: flags.mode,
    vid: flags.vid,
    videoUri: flags.videoUri,
    videoWidth,
    videoHeight,
    videoDurationSec,
    videoMode: flags.videoMode,
    imageWidth,
    imageHeight,
    imageUrl: flags.imageUrl,
    name: flags.name,
    description: flags.description,
    workspaceId,
    image: flags.image,
    lastImage: flags.lastImage,
    firstFrameUri: flags.firstFrameUri,
    lastFrameUri: flags.lastFrameUri,
    ratio: flags.ratio,
    videoResolution: flags.videoResolution,
    resolution: flags.resolution,
    fps,
    modelVersion: flags.modelVersion,
    modelReqKey: flags.modelReqKey,
    seed,
    sampleStrength,
    negativePrompt: flags.negativePrompt,
    intelligentRatio,
    prompt: flags.prompt,
    outDir: flags.outDir ?? "data/jimeng-lab/browser-proxy",
    dryRun: flags.dryRun === "true",
    noDownload: flags.noDownload === "true",
    pollIntervalMs: Number(flags.pollIntervalMs ?? 3000),
    maxPolls: Number(flags.maxPolls ?? 30),
    durationSec: durationSec ? Number(durationSec) : undefined,
  }
}

function loadSession(args: CliArgs): Promise<JimengSessionBundle> | JimengSessionBundle {
  if (args.session) return readJson(args.session) as JimengSessionBundle
  return loadJimengSessionFromBrowser({ cdpUrl: args.cdpUrl, targetUrl: args.targetUrl })
}

function resolveRawNetworkFile(args: CliArgs): string {
  const file = args.rawNetwork
    ? path.resolve(args.rawNetwork)
    : args.captureDir
      ? path.resolve(args.captureDir, "raw-network.jsonl")
      : null
  if (!file) throw new Error("capture-analyze requires --rawNetwork or --captureDir")
  if (!existsSync(file)) throw new Error(`raw-network.jsonl not found: ${file}`)
  return file
}

export function parseJimengBrowserProxyFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token?.startsWith("--")) continue

    const eq = token.indexOf("=")
    if (eq > 2) {
      flags[token.slice(2, eq)] = token.slice(eq + 1)
      continue
    }

    const key = token.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next
      i += 1
    } else {
      flags[key] = "true"
    }
  }
  return flags
}

function parseCsvFlag(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  const items = value.split(",").map((item) => item.trim()).filter(Boolean)
  return items.length > 0 ? items : undefined
}

function parseJimengVideoPreprocessMode(value: string | undefined): JimengVideoPreprocessMode | undefined {
  if (value === undefined) return undefined
  if (
    value === "image-create-avatar"
    || value === "voice-recommendation"
    || value === "audio-detect"
    || value === "audio-silence"
    || value === "raw"
  ) {
    return value
  }
  throw new Error("--mode for video-preprocess-plan must be image-create-avatar, voice-recommendation, audio-detect, audio-silence, or raw")
}

function parseEndpointProbeMethod(value: string | undefined): "GET" | "POST" | undefined {
  if (!value) return undefined
  const normalized = value.trim().toUpperCase()
  if (normalized === "GET" || normalized === "POST") return normalized
  throw new Error("--method must be GET or POST")
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function parseOptionalBooleanFlag(value: string | undefined, flagName: string): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === "true") return true
  if (normalized === "false") return false
  throw new Error(`${flagName} must be true or false`)
}

function parseMaybeNumberFlag(value: string | undefined): string | number | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim()
  if (normalized.length === 0) return undefined
  const numeric = Number(normalized)
  return Number.isFinite(numeric) && String(numeric) === normalized ? numeric : normalized
}

function readInlineOrFile(value: string): string {
  if (value.startsWith("@")) return readFileSync(path.resolve(value.slice(1)), "utf8")
  if ((value.endsWith(".json") || value.endsWith(".jsonl")) && existsSync(path.resolve(value))) {
    return readFileSync(path.resolve(value), "utf8")
  }
  return value
}

function parseJsonObjectFlag(value: string | undefined, flagName: string): JsonObject | undefined {
  if (!value) return undefined
  const parsed = JSON.parse(readInlineOrFile(value)) as JsonValue
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed
  throw new Error(`${flagName} must be a JSON object`)
}

function parseVoiceCloneStatuses(values: string[] | undefined): JimengCloneVoiceStatusValue[] | undefined {
  if (!values) return undefined
  return values.map((value) => {
    const normalized = value.trim().toLowerCase()
    if (normalized === "generating" || normalized === "1") return JimengCloneVoiceStatus.Generating
    if (normalized === "success" || normalized === "2") return JimengCloneVoiceStatus.Success
    if (normalized === "fail" || normalized === "failed" || normalized === "3") return JimengCloneVoiceStatus.Fail
    throw new Error(`Unknown cloned voice status: ${value}`)
  })
}

interface OutputDirs {
  rawDir: string
  normalizedDir: string
  artifactsDir: string
}

interface ReferenceUploadSummary {
  index: number
  role: ReferenceImageRole
  source_file: string
  artifact_copy: string
  raw_file: string
  uri: string
  image_upload: JimengImageUploadResult["summary"]
}

type ReferenceImageRole = "first_frame" | "end_frame" | "controlnet_reference" | "object_mask_reference" | "lip_sync_image" | "subject_main_image"

interface ReferenceVideoUploadSummary {
  index: number
  role: ReferenceVideoRole
  source_file: string
  artifact_copy: string
  raw_file: string
  video_upload: JimengVideoUploadResult["summary"]
}

type ReferenceVideoRole = "lip_sync_video"

async function uploadReferenceImage(input: {
  session: JimengSessionBundle
  dirs: OutputDirs
  runId: string
  role: ReferenceImageRole
  index: number
  sourceFile: string
}): Promise<ReferenceUploadSummary> {
  const sourceFile = path.resolve(input.sourceFile)
  const bytes = readFileSync(sourceFile)
  const artifactFile = path.join(input.dirs.artifactsDir, `${input.runId}-${input.role}-${path.basename(sourceFile)}`)
  writeFileSync(artifactFile, bytes)

  const result = await uploadJimengImage({
    session: input.session,
    image: {
      fileName: path.basename(sourceFile),
      bytes,
    },
  })
  const rawFile = path.join(input.dirs.rawDir, `${input.runId}-reference-upload-${input.index}-raw.json`)
  writeJson(rawFile, {
    token: {
      http_status: result.token.httpStatus,
      response_text_sha256: result.token.responseTextSha256,
      body: result.token.body,
    },
    apply: {
      http_status: result.apply.httpStatus,
      response_text_sha256: result.apply.responseTextSha256,
      body: result.apply.body,
    },
    upload: {
      http_status: result.upload.httpStatus,
      response_text_sha256: result.upload.responseTextSha256,
      body: result.upload.body,
    },
    commit: {
      http_status: result.commit.httpStatus,
      response_text_sha256: result.commit.responseTextSha256,
      body: result.commit.body,
    },
  })

  const uri = result.summary.imageUris[0]
  if (!uri) {
    throw new Error("Image upload did not return an image URI")
  }

  return {
    index: input.index,
    role: input.role,
    source_file: sourceFile,
    artifact_copy: artifactFile,
    raw_file: rawFile,
    uri,
    image_upload: result.summary,
  }
}

async function uploadReferenceVideo(input: {
  session: JimengSessionBundle
  dirs: OutputDirs
  runId: string
  role: ReferenceVideoRole
  index: number
  sourceFile: string
}): Promise<ReferenceVideoUploadSummary> {
  const sourceFile = path.resolve(input.sourceFile)
  const bytes = readFileSync(sourceFile)
  const artifactFile = path.join(input.dirs.artifactsDir, `${input.runId}-${input.role}-${path.basename(sourceFile)}`)
  writeFileSync(artifactFile, bytes)

  const result = await uploadJimengVideo({
    session: input.session,
    video: {
      fileName: path.basename(sourceFile),
      bytes,
    },
  })
  const rawFile = path.join(input.dirs.rawDir, `${input.runId}-reference-video-upload-${input.index}-raw.json`)
  writeJson(rawFile, {
    token: {
      http_status: result.token.httpStatus,
      response_text_sha256: result.token.responseTextSha256,
      body: result.token.body,
    },
    apply: {
      http_status: result.apply.httpStatus,
      response_text_sha256: result.apply.responseTextSha256,
      body: result.apply.body,
    },
    upload: {
      http_status: result.upload.httpStatus,
      response_text_sha256: result.upload.responseTextSha256,
      body: result.upload.body,
    },
    commit: {
      http_status: result.commit.httpStatus,
      response_text_sha256: result.commit.responseTextSha256,
      body: result.commit.body,
    },
  })

  const summary: ReferenceVideoUploadSummary = {
    index: input.index,
    role: input.role,
    source_file: sourceFile,
    artifact_copy: artifactFile,
    raw_file: rawFile,
    video_upload: result.summary,
  }
  writeJson(path.join(input.dirs.normalizedDir, `${input.runId}-reference-video-upload-${input.index}-summary.json`), summary)
  return summary
}

function lipSyncVideoReferenceFromArgs(args: CliArgs): JimengLipSyncVideoReference {
  if (!args.vid || !args.videoWidth || !args.videoHeight || !args.videoDurationSec) {
    throw new Error("lip-sync requires --video/--file or existing --vid with --videoWidth, --videoHeight, and --videoDurationSec")
  }

  return {
    vid: args.vid,
    uri: args.videoUri ?? null,
    width: args.videoWidth,
    height: args.videoHeight,
    duration: args.videoDurationSec,
  }
}

function lipSyncImageReferenceFromArgs(args: CliArgs): JimengLipSyncImageReference {
  if (!args.imageUri || !args.imageWidth || !args.imageHeight) {
    throw new Error("lip-sync image/avatar mode requires --image or existing --imageUri with --imageWidth and --imageHeight")
  }

  return {
    uri: args.imageUri,
    ...(args.imageUrl ? { url: args.imageUrl } : {}),
    width: args.imageWidth,
    height: args.imageHeight,
  }
}

function subjectImageReferenceFromArgs(args: CliArgs, command: "subject-create" | "subject-update"): JimengSubjectImageReference {
  if (!args.imageUri || !args.imageWidth || !args.imageHeight) {
    throw new Error(`${command} existing-image mode requires --imageUri with --imageWidth and --imageHeight`)
  }

  return {
    imageUri: args.imageUri,
    width: args.imageWidth,
    height: args.imageHeight,
    ...(args.imageUrl ? { imageUrl: args.imageUrl } : {}),
  }
}

// Boundary helper: CLI proof redaction recursively accepts decoded provider/proof data.
// ast-grep-ignore: no-unsafe-any-unknown-ts
export function redactJimengProofForNormalized(value: unknown): JsonValue {
  if (value === undefined) return null
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map(redactJimengProofForNormalized)
  if (typeof value !== "object") return String(value)
  const out: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveProofKey(key)) {
      out[key] = typeof entry === "string" ? `[REDACTED ${entry.length} chars]` : "[REDACTED]"
    } else if (typeof entry === "string" && (isUrlProofKey(key) || hasSensitiveUrlToken(entry))) {
      out[key] = redactProofUrl(entry)
    } else {
      out[key] = redactJimengProofForNormalized(entry)
    }
  }
  return out
}

function redactSignedUrls(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(redactSignedUrls)
  if (!value || typeof value !== "object") return value
  const out: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (/url/i.test(key) && typeof entry === "string") {
      out[key] = "[SIGNED_URL_REDACTED]"
    } else {
      out[key] = redactSignedUrls(entry)
    }
  }
  return out
}

function isSensitiveProofKey(key: string): boolean {
  return /cookie|authorization|msToken|verifyFp|sessionid|sid_guard|a_bogus|x-signature|secret/i.test(key)
}

function isUrlProofKey(key: string): boolean {
  return /url$/i.test(key) || /^url$/i.test(key)
}

function hasSensitiveUrlToken(value: string): boolean {
  return /[?&](msToken|a_bogus|x-signature|x-expires|X-Amz|lk3s)=/i.test(value)
}

function redactProofUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.hostname.endsWith("jimeng.jianying.com")) {
      return `${url.origin}${url.pathname}${url.search ? "?[REDACTED_QUERY]" : ""}`
    }
    return "[SIGNED_URL_REDACTED]"
  } catch {
    return hasSensitiveUrlToken(value) ? "[SIGNED_URL_REDACTED]" : value
  }
}

function ensureOutputDirs(outDir: string): { rawDir: string; normalizedDir: string; artifactsDir: string } {
  const rawDir = path.join(outDir, "raw")
  const normalizedDir = path.join(outDir, "normalized")
  const artifactsDir = path.join(outDir, "artifacts")
  mkdirSync(rawDir, { recursive: true })
  mkdirSync(normalizedDir, { recursive: true })
  mkdirSync(artifactsDir, { recursive: true })
  return { rawDir, normalizedDir, artifactsDir }
}

function resolveJimengHttpCassettePath(
  args: Pick<CliArgs, "transportMode" | "cassette">,
  dirs: { rawDir: string },
  runId: string,
): string | undefined {
  if (args.transportMode === "live") return undefined
  return path.resolve(args.cassette ?? path.join(dirs.rawDir, `${runId}-cassette.json`))
}

function readVoiceCapture(file: string | undefined): CaptureFile {
  const captureFile = file ?? getDefaultVoiceLibraryCapturePath()
  return readJson(captureFile) as CaptureFile
}

// Boundary helper: callers decode/cast each JSON file according to command-specific contracts.
// ast-grep-ignore: no-unsafe-any-unknown-ts
function readJson(file: string): unknown {
  return JSON.parse(readFileSync(path.resolve(file), "utf8"))
}

// Boundary helper: CLI proof writers persist typed command summaries and raw provider envelopes.
// ast-grep-ignore: no-unsafe-any-unknown-ts
function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function redactSession(session: JimengSessionBundle): JimengSessionBundle {
  return {
    ...session,
    cookie: `[REDACTED ${session.cookie.length} chars]`,
  }
}

function slug(value: string): string {
  const normalized = value
    .replace(/[\\/:*"<>|\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
  return normalized || "jimeng"
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    if (error instanceof JimengError) {
      console.error(JSON.stringify(error.toJSON(), null, 2))
      process.exit(error.retryable ? 2 : 1)
    }
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

# Jimeng API Triage

This file is the fast decision layer for Jimeng/Dreamina reverse engineering. It answers: which API families matter for the UGC app, which are optional, and which should stay parked unless the product direction changes.

Evidence paths can point at ignored `data/**` proof bundles; do not commit raw cookies, signed URLs, or private account payloads.

## Quick Response Format

When pruning the queue, use short family ids:

```txt
keep: G1,G2,P1,V1,L1,R1,R2,T1,A1
maybe: C1,Q1,I1,S1,O1
skip: W1,N1,U1,D1,M1,P2,X1
```

`keep` means implement typed service/CLI support. `maybe` means keep cataloged but do not actively build. `skip` means leave as `cataloged_only` or `blocked` with a reason.

The machine-readable mirror for these family IDs lives in `packages/jimeng-client/src/endpoint-registry.ts`. Run `jimeng-browser-proxy triage-coverage --decisions keep` to materialize the current registry coverage as JSON and Markdown. The latest keep-family report has 62 unique endpoints, 0 missing registry rows, 40 implemented endpoints, 4 partial endpoints, 4 dry-run-only endpoints, and 15 blocked endpoints. Unfinished keep-family rows must carry evidence paths and a concrete next probe in the registry; Vitest snapshots cover the normalized gap object and generated Markdown report.

## Priority Model

Rank work by UGC workflow value first, then implementation speed. No-spend availability is a safety and approval constraint, not the priority function. The first question for a slice is: "What useful UGC workflow does this unlock or prove?" not "Can this be done without spend?" Do not choose the fastest no-spend W6 endpoint while a higher-value generation, persona/voice, lip-sync, reference-control, or template-mining gap is available; instead ask for approval or build adjacent tests/examples inside that same high-value family.

Current highest-value order:

1. Generation parity and useful examples: text/image/video submit, first/end-frame, multi-frame, reference/multimodal generation, polling, download, and artifact proof.
2. Persona and voice: subject voice generation, custom voice clone lifecycle, applying voices to scripts, and reusable persona-profile examples.
3. Lip-sync and digital human: image/avatar and VOD lip-sync submit parity, pre-process/result flows, and talking-head UGC examples.
4. Reference controls: pose/depth/canny/style/reference transfer, masks, face/reference validation, and person-swap workflows.
5. Template mining: CapCut/Jimeng search, batch, presets, hook/caption/template extraction, and faceless profile/template copying.
6. Supporting metadata reads: history, assets, story/archive, runtime, quota, notices, panels. Build these when they unblock a higher-value workflow; otherwise keep them cataloged.

If the next highest-value step requires paid generation, account mutation, unsafe credential access, visible UI, or fresh background capture, ask for explicit approval with the exact command, expected examples, and proof output path instead of switching to a lower-value no-spend endpoint. If useful no-spend work is needed while waiting, keep it inside the same high-value family through dry-run plans, compare gates, schemas, fixtures, and representative examples that match workflows we would actually run.

When account spend or passive capture is approved, use the fast extraction loop in `docs/plans/jimeng-fast-contract-extraction.md`: run a small value-ranked matrix, save raw/normalized JSON and useful artifacts, infer schemas/scaffolds from the saved contracts, then replay tests from fixtures. Manual dry-run planners are fallback or compare-gate tools, not the default way to implement every remaining endpoint.

## Keep

| ID | Family | Why it matters |
|---|---|---|
| G1 | Text/image/video generation | Core ad asset creation: text-to-image, text-to-video, image-to-video, frames-to-video, multimodal/reference generation. |
| G2 | Upload and provider asset references | Required for local reference images, VOD videos, first/end frames, pose references, and source media. |
| P1 | Persona/subject lifecycle | Core generated influencer workflow: saved persona records, image-backed subject creation, subject update/delete, subject voice generation. |
| V1 | Voice and speech | Built-in voice catalog, TTS, cloned voices, voice clone submit/query/update/delete. Needed for scripted UGC and persona consistency. |
| L1 | Lip-sync / digital human | Talking-head UGC path. Keep request builders, config, compare gates, and eventual live submit behind approval. |
| R1 | Reference profile research | Public profile works, item detail, homepage/favorites/stories. Needed for reference-profile remix and style/template mining. |
| R2 | Reference controls | Pose, depth, canny, style/reference images, face/image description, object masks. Needed for pose/style transfer and consistency. |
| T1 | CapCut/template mining | Commercial template search, collections, presets, details, ratios, and scene metadata. Useful for faceless profiles and hook/template extraction. |
| A1 | Assets/history/queue/video info | Job status, completed artifacts, metadata lookup, and artifact download plumbing. |

## Maybe

| ID | Family | Decision |
|---|---|---|
| C1 | Commerce/quota/benefits/pricing | Useful for spend gating and account UX, but not content generation. Keep read-only support; do not chase trade/refund/payment flows. |
| Q1 | Runtime/config/model catalogs | Useful implementation metadata. Keep when it supports request builders; avoid treating every config endpoint as a feature. |
| I1 | Infinite canvas | Potentially useful if the editor/workflow graph leans into Jimeng canvas projects. Otherwise keep read-only metadata and park mutating flows. |
| S1 | Story/archive/export | Useful if we export bundles or stories. Keep read-only details; live export/create/update/delete needs explicit approval. |
| O1 | Rate/concurrency probes | Operational tool only. Use to protect live work, not as a product feature. |

## Skip Or Back Burner

| ID | Family | Decision |
|---|---|---|
| W1 | Weekly challenges / activities | Back burner. These are Jimeng activity/contest pages, not generation APIs. Useful later only for trend/contest/brief mining. |
| N1 | Notices, panels, banners, helpdesk | Mostly UI chrome/config. Keep only if needed for auth, feature flags, or model access. |
| U1 | URL shortener | Low-value utility endpoint. Do not build CLI surface unless a workflow requires it. |
| D1 | CapCut account-token/data-sync credentials | Credential-sensitive. Do not replay or persist raw output without a dedicated credential-safe flow. |
| M1 | Mutating LV asset/template/draft endpoints | Skip until there is a disposable workspace/template fixture and explicit approval. |
| P2 | Payment/order/refund flows | Not needed for UGC generation; risky and account-specific. |
| X1 | Surveys, remove history, update BGM, cancel/accelerate | Mutating or task-state dependent. Only revisit for a concrete UX requirement. |

## Weekly Challenges Examples

Decision: `W1` is `cataloged_only`. It should not have an active CLI command right now.

Proof bundles:

- `data/jimeng-lab/proof-20260611-probe-weekly-challenge-list/`
- `data/jimeng-lab/proof-20260611-probe-weekly-challenge-detail/`
- Static request-builder trace: `data/jimeng-lab/proof-20260611-static-locate-safe-read-gaps/`

API shape:

- `POST /mweb/v1/get_weekly_challenge_list`
- empty request returned `ret=0`, `act_info_list.length=156`
- useful fields: `act_key`, `act_name`, `act_status`, `act_work_type_list`, `act_start_time`, `act_end_time`, `act_submit_work_num`, `act_reward`
- `POST /mweb/v1/get_weekly_challenge_detail`
- required request field: `act_key`
- wrong keys like `activity_key` or `activity_id` returned `weekly challenge not found`

Concrete examples from the local proof:

| act_key | act_name | work type | status | submissions | reward/context |
|---|---|---|---|---:|---|
| `2026-289-dreamina-weekly-challenge` | `抖音 AI 创作大赛` | `short_video` | `in_progress` | 217 | Douyin AI creation contest, 4M RMB cash and 20M Jimeng credits |
| `2026-288-dreamina-weekly-challenge` | `2026大学生AI艺术季·AI影像创作单元` | `short_video` | `in_progress` | 240 | Student AI art / AI video unit |
| `2026-176-dreamina-weekly-challenge` | `VITA SHORTS 2026：AI 短片竞赛单元征稿` | `short_video` | `in_progress` | 1260 | AI short-film competition and festival path |
| `2026-133-dreamina-weekly-challenge` | `大学生广告艺术节学院奖 即梦AI青年创意大赛（视频类）` | `short_video` | `in_evaluation` | 3891 | Advertising/creative contest |
| `2024-143-dreamina-weekly-challenge` | `Y600 Pro万级长续航AI大赛` | `short_video` | `in_evaluation` | 1572 | Brand/product campaign contest |

Why it is not important now:

- It does not create images, videos, voices, personas, templates, or jobs.
- It is mostly contest metadata and submission rules.
- It may become useful later for niche research, trend mining, or brand-brief extraction, but that is downstream of the core UGC generation client.

## Generation Compare Gates

- Direct image plans: use `jimeng-browser-proxy text2image-plan` to build a no-session dry-run request and `jimeng-browser-proxy text2image-compare` to compare it against a passive raw CDP/capture-template submit request before live submit is claimed.
- Direct video plans: use `jimeng-browser-proxy text2video-plan` to build a no-session dry-run request and `jimeng-browser-proxy text2video-compare` to compare it against a passive raw CDP/capture-template submit request before live submit is claimed.
- Simple dry-run request plans, including subject voice generation and voice clone submit/query/update/delete, can use `jimeng-browser-proxy request-plan-compare` to compare the planned request body against passive raw CDP/capture-template traffic without live provider calls.
- Lip-sync plans: keep using `jimeng-browser-proxy lip-sync-compare` because the meaningful payload is nested under provider-specific `videoGenInputs`.

## Latest Gap Notes

- 2026-06-12 fast-loop seed: a bounded live generation matrix under `data/jimeng-lab/proof-20260612-live-generation-matrix/manifest.md` spent 24 credits and produced one TTS MP3 plus four MP4 outputs for useful UGC/Korean-beauty/faceless examples. Use that bundle, and future bundles like it, as contract-inference input before hand-writing more request planners.
- `G1 /mweb/v1/aigc_draft/generate` now has a dry-run `omni-video-plan` plus `omni-video-compare` for Seedance all-around reference generation. It models mixed image/video `unified_edit_input.material_list`, prompt `@field` references in `meta_list`, and `functionMode="omni_reference"` for reference-profile/persona-swap workflows. Live replay still needs passive frontend capture compare through the semantic compare gate and explicit approval because it can spend credits.
- `G1 /mweb/v1/execute_generate_audit` is now dry-run-only rather than fully blocked. `generate-audit-plan` models the frontend material transform for image/video/audio/subject inputs and can be compared against passive UI traffic through `request-plan-compare`. Live replay still needs a fresh generation capture proving the complete top-level request context.
- `V1 /mweb/v1/mix_audio_video` and `/mweb/v1/mix_audio_videos` are now dry-run-only rather than fully blocked. `mix-audio-plan` models the frontend body/query transform for applying an audio/voice track to one or more generated video items, and `request-plan-compare` now validates optional `query_params` such as `babi_param`. Live replay still needs passive UI capture compare and explicit approval because it creates task state.
- `R1 /mweb/v1/mget_story` remains partial rather than implemented. The `story-records` typed client and replay tests exist, but a 2026-06-11 sweep over three existing followed profiles (`PUAI`, `小波登`, `就扶墙老师`) returned `ret=0` with `story_count=0`; promotion still needs a public profile or UI capture with a non-empty story list. Treat this as supporting audit evidence, not a reason to prioritize story/archive reads over generation, persona/voice, lip-sync, reference controls, or template mining.

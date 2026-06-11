# Jimeng API Triage

This file is the fast decision layer for Jimeng/Dreamina reverse engineering. It answers: which API families matter for the UGC app, which are optional, and which should stay parked unless the product direction changes.

Evidence paths can point at ignored `data/**` proof bundles; do not commit raw cookies, signed URLs, or private account payloads.

## Quick Response Format

When pruning the queue, use short family ids:

```txt
keep: G1,G2,P1,V1,R1,T1
maybe: C1,Q1
skip: L1,N1,U1
```

`keep` means implement typed service/CLI support. `maybe` means keep cataloged but do not actively build. `skip` means leave as `cataloged_only` or `blocked` with a reason.

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

# Jimeng Triage Coverage

- Decisions: keep
- Families: 9
- Unique endpoints: 62
- Missing endpoints: 0

| ID | Decision | Family | Endpoints | Statuses | Not implemented |
|---|---|---|---:|---|---:|
| G1 | keep | Text/image/video generation | 3 | implemented=1, partial=2 | 2 |
| G2 | keep | Upload and provider asset references | 5 | implemented=4, blocked=1 | 1 |
| P1 | keep | Persona/subject lifecycle | 5 | implemented=4, dry_run_only=1 | 1 |
| V1 | keep | Voice and speech | 9 | implemented=2, partial=2, dry_run_only=5 | 7 |
| L1 | keep | Lip-sync / digital human | 6 | implemented=1, partial=2, blocked=3 | 5 |
| R1 | keep | Reference profile research | 8 | implemented=7, partial=1 | 1 |
| R2 | keep | Reference controls | 5 | implemented=5 | 0 |
| T1 | keep | CapCut/template mining | 16 | implemented=10, blocked=6 | 6 |
| A1 | keep | Assets/history/queue/video info | 6 | implemented=6 | 0 |

## Value-Ranked Remaining Work

1. Generation parity and artifact proof - `G1 /mweb/v1/aigc_draft/generate` - partial command=text2image-plan/text2image-compare/text2video-plan/omni-video-plan/text2video-compare/omni-video-compare/generation-contract/text2video/image2video/frames2video/lip-sync - Unified generation submit; direct image/video, first/end-frame, and Seedance omni-reference request builders are dry-run covered with semantic compare gates; saved live text/image-to-video proofs are now schema-validated by generation-contract; live lip-sync/end-frame/omni-reference still require capture compare or approval-gated submit.
   - Next probe: Repeat the matrix/infer/promote loop for lip-sync, end-frame, multi-frame, or omni-reference generation, then run the matching compare gate before any approval-gated live submit.
1. Generation parity and artifact proof - `G1 /mweb/v1/execute_generate_audit` - partial command=generate-audit-plan/request-plan-compare/executeJimengGenerateAudit - Generation pre-audit material transform is modeled and typed client replay is covered by cassettes; live replay still needs passive UI capture compare for the full frontend submit context.
   - Next probe: Passively capture the frontend material-audit request around a generation submit, compare it with generate-audit-plan using request-plan-compare, then record/replay executeJimengGenerateAudit with the captured provider response before any approved live replay.
1. Generation parity and artifact proof - `G2 /mweb/v1/mpack_image` - blocked - Packs image material through dreamina-material-data-service; capture the exact caller input shape before promotion.
   - Next probe: Passively capture an image-pack/material-data-service UI flow, then replay only with cassette redaction after the exact caller input shape is known.
2. Persona and voice - `V1 /mweb/v1/feed` - partial command=voices - Built-in voice library replay is implemented for captured signed feed requests.
   - Next probe: Refresh a signed voice-library feed request from passive UI capture and record/replay the voices command without relying on stale capture templates.
2. Persona and voice - `V1 /mweb/v1/voice/query_task` - partial command=voice-clone-query/request-plan-compare - Query command exists; live proof needs a real task id, and dry-run request shape can be compared offline against UI captures.
   - Next probe: Use a real task id from an approved voice-clone submit flow, then record/replay voice-clone-query as a cassette-backed read.
2. Persona and voice - `P1 /mweb/v1/dreamina_subject/generate_voice` - dry_run_only command=subject-generate-voice/request-plan-compare - Subject voice generation may consume quota; dry-run request shape can be compared offline against UI captures before approval.
   - Next probe: Capture a subject generate-voice UI submit and compare it with subject-generate-voice dry-run using request-plan-compare before any approved live voice generation.
2. Persona and voice - `V1 /mweb/v1/mix_audio_video` - dry_run_only command=mix-audio-plan/request-plan-compare - Single audio/video mix task request transform is dry-run covered with body snake-case plus optional babi_param query compare; live replay creates task state and needs capture approval.
   - Next probe: Capture a single audio/video mix UI submit, then compare it with mix-audio-plan using request-plan-compare before any approval-gated live replay because it creates task state.
2. Persona and voice - `V1 /mweb/v1/mix_audio_videos` - dry_run_only command=mix-audio-plan/request-plan-compare - Batch audio/video mix task request transform is dry-run covered with input_list plus optional babi_param query compare; live replay creates task state and needs capture approval.
   - Next probe: Capture a batch audio/video mix UI submit, then compare it with mix-audio-plan --batch using request-plan-compare before any approval-gated live replay because it creates task state.
2. Persona and voice - `V1 /mweb/v1/voice/delete` - dry_run_only command=voice-clone-delete/request-plan-compare - Mutates cloned voice assets; dry-run request shape can be compared offline against UI captures.
   - Next probe: Capture or create a disposable cloned voice asset, compare voice-clone-delete dry-run against the UI request, then require approval before mutation.
2. Persona and voice - `V1 /mweb/v1/voice/submit_task` - dry_run_only command=voice-clone-submit/request-plan-compare - Voice clone submit may create assets or consume quota; dry-run request shape can be compared offline against UI captures.
   - Next probe: Capture a voice-clone submit UI request with disposable source audio and compare the dry-run plan before any approved asset-creating submit.
2. Persona and voice - `V1 /mweb/v1/voice/update` - dry_run_only command=voice-clone-update/request-plan-compare - Mutates cloned voice assets; dry-run request shape can be compared offline against UI captures.
   - Next probe: Capture or create a disposable cloned voice asset, compare voice-clone-update dry-run against the UI request, then require approval before mutation.
3. Lip-sync / digital human - `L1 /mweb/v1/video_generate/mget_pre_process_result` - partial command=video-preprocess-query-plan/request-plan-compare/fetchJimengVideoPreprocessResults - Pre-process result lookup body is modeled by submit_id_list and has typed service/cassette replay coverage; live replay needs task ids from a captured or approved pre_process flow.
   - Next probe: Use task ids from a captured or approved video_generate/pre_process flow, compare with video-preprocess-query-plan, then record/replay through fetchJimengVideoPreprocessResults.
3. Lip-sync / digital human - `L1 /mweb/v1/video_generate/pre_process` - partial command=video-preprocess-plan/request-plan-compare/submitJimengVideoPreprocess - Frontend data service pre-process task body is modeled for avatar image checks, voice recommendation, audio detect, and audio silence checks; typed service and cassette replay exist, but live replay creates task state and needs passive capture compare plus approval.
   - Next probe: Passively capture the video pre-process submit flow, compare it with video-preprocess-plan using request-plan-compare, then record/replay through submitJimengVideoPreprocess only after explicit approval because it creates task state.
3. Lip-sync / digital human - `L1 /mweb/v1/video_generate/face_auth/skip` - blocked - Seedance face-auth skip submit task can create provider-side task state; capture exact UI payload and approval context before live replay.
   - Next probe: Capture the Seedance face-auth skip flow, compare payloads offline, and require explicit approval before live replay because it can create provider-side task state.
3. Lip-sync / digital human - `L1 /mweb/v1/video_generate/face_auth/skip/query` - blocked - Face-auth skip status query depends on a task id from video_generate/face_auth/skip; capture that flow before promotion.
   - Next probe: Use a task id from a captured face_auth/skip flow and record/replay the paired status query.
3. Lip-sync / digital human - `L1 /mweb/v1/video_generate/get_switch_model_queue_info` - blocked - No-spend probes with empty, model_req_key, model_req_keys, and scene bodies returned ret=1000 invalid parameter; capture the exact frontend switch-model queue body before promotion.
   - Next probe: Capture the frontend switch-model queue request from the lip-sync/video UI and replay the exact body through endpoint-probe record/replay.
5. Template and niche mining - `T1 /lv/v1/cc_web/plane/batch_get_collection_templates` - blocked - Signed no-spend probes returned ret=1000 param error across object, list, and nested collection variants; capture the exact batch row UI payload before promotion.
   - Next probe: Capture the collection-row batch UI payload and compare it against the signed no-spend variants that returned ret=1000.
5. Template and niche mining - `T1 /lv/v1/cc_web/plane/fuzzy_search_templates` - blocked - Signed no-spend probes returned ret=0 with empty lists for guessed keyword/title bodies; capture a non-empty fuzzy-search UI request before promotion.
   - Next probe: Capture a non-empty fuzzy-search UI request and replay the exact signed body instead of guessed keyword/title variants.
5. Template and niche mining - `T1 /lv/v1/cc_web/plane/get_collection_presets` - blocked - Signed no-spend probes using confirmed collection ids returned ret=1015 check login error; capture the exact preset UI call and required auth/header context before promotion.
   - Next probe: Capture a preset-list UI request with the required LV auth/header context, then replay with a confirmed collection id.
5. Template and niche mining - `T1 /lv/v1/cc_web/plane/preset_template_detail` - blocked - Preset detail depends on get_collection_presets data, but preset listing currently returns ret=1015 in safe probes; capture a real preset UI flow before promotion.
   - Next probe: First unblock get_collection_presets, then use a real preset id from that listing to record/replay preset_template_detail.
5. Template and niche mining - `T1 /lv/v1/cc_web/replicate/get_search_words` - blocked - Signed no-spend probes returned ret=0 but only region metadata, not usable search words; capture a UI call that returns keyword data before promotion.
   - Next probe: Passively capture the CapCut replicate search UI call that returns keyword data, then replay with signed CapCut headers and a cassette.
5. Template and niche mining - `T1 /lv/v1/cc_web/replicate/search_templates` - blocked - Signed no-spend probes returned ret=1000 param error across recovered keyword/category/search-id variants; capture an exact template-search UI request before promotion.
   - Next probe: Capture an exact CapCut template-search UI request including keyword/category/search-id fields, then add a typed replay fixture.
6. Supporting metadata reads - `R1 /mweb/v1/mget_story` - partial command=story-records - No-spend story detail lookup by story_id_list is implemented; live proof still needs real story ids from a non-empty story list or UI capture.
   - Next probe: Find or capture a public profile with a non-empty story list, then run story-records with real story_id_list values and record/replay the cassette; the 2026-06-11 no-spend sweep over three followed profiles returned ret=0 with story_count=0.

## Not Implemented Endpoints

### G1 Text/image/video generation

- `/mweb/v1/aigc_draft/generate` - partial command=text2image-plan/text2image-compare/text2video-plan/omni-video-plan/text2video-compare/omni-video-compare/generation-contract/text2video/image2video/frames2video/lip-sync - Unified generation submit; direct image/video, first/end-frame, and Seedance omni-reference request builders are dry-run covered with semantic compare gates; saved live text/image-to-video proofs are now schema-validated by generation-contract; live lip-sync/end-frame/omni-reference still require capture compare or approval-gated submit.
  - Evidence: `docs/qa/jimeng-direct-compare-gates-20260611.md`; `docs/qa/jimeng-omni-video-plan-20260611.md`; `data/jimeng-lab/proof-20260610-text2image-plan-direct/`; `data/jimeng-lab/text2video-plan-current/`; `data/jimeng-lab/proof-20260610-subscription-api-live-check/`; `data/jimeng-lab/proof-20260611-omni-video-plan/`; `data/jimeng-lab/proof-20260612-live-generation-matrix/contract-infer/normalized/contract/`; `data/jimeng-lab/proof-20260612-live-generation-matrix/generation-contract/normalized/generation-contract/`
  - Next probe: Repeat the matrix/infer/promote loop for lip-sync, end-frame, multi-frame, or omni-reference generation, then run the matching compare gate before any approval-gated live submit.
- `/mweb/v1/execute_generate_audit` - partial command=generate-audit-plan/request-plan-compare/executeJimengGenerateAudit - Generation pre-audit material transform is modeled and typed client replay is covered by cassettes; live replay still needs passive UI capture compare for the full frontend submit context.
  - Evidence: `docs/qa/jimeng-generate-audit-plan-20260611.md`; `docs/qa/jimeng-generate-audit-client-20260612.md`; `data/jimeng-lab/proof-20260611-static-locate-media-helper-blockers/`; `data/jimeng-lab/proof-20260611-static-inventory-media-helper-blockers/`
  - Next probe: Passively capture the frontend material-audit request around a generation submit, compare it with generate-audit-plan using request-plan-compare, then record/replay executeJimengGenerateAudit with the captured provider response before any approved live replay.

### G2 Upload and provider asset references

- `/mweb/v1/mpack_image` - blocked - Packs image material through dreamina-material-data-service; capture the exact caller input shape before promotion.
  - Evidence: `data/jimeng-lab/proof-20260611-static-locate-media-helper-blockers/`; `data/jimeng-lab/proof-20260611-static-inventory-media-helper-blockers/`
  - Next probe: Passively capture an image-pack/material-data-service UI flow, then replay only with cassette redaction after the exact caller input shape is known.

### P1 Persona/subject lifecycle

- `/mweb/v1/dreamina_subject/generate_voice` - dry_run_only command=subject-generate-voice/request-plan-compare - Subject voice generation may consume quota; dry-run request shape can be compared offline against UI captures before approval.
  - Evidence: `docs/qa/jimeng-request-plan-compare-20260611.md`; `data/jimeng-lab/proof-20260610-subject-lifecycle/`; `data/jimeng-lab/cli-request-plan-compare-smoke/`
  - Next probe: Capture a subject generate-voice UI submit and compare it with subject-generate-voice dry-run using request-plan-compare before any approved live voice generation.

### V1 Voice and speech

- `/mweb/v1/voice/submit_task` - dry_run_only command=voice-clone-submit/request-plan-compare - Voice clone submit may create assets or consume quota; dry-run request shape can be compared offline against UI captures.
  - Evidence: `docs/qa/jimeng-request-plan-compare-20260611.md`; `data/jimeng-lab/proof-20260610-voice-clone/`; `data/jimeng-lab/cli-request-plan-compare-smoke/`
  - Next probe: Capture a voice-clone submit UI request with disposable source audio and compare the dry-run plan before any approved asset-creating submit.
- `/mweb/v1/voice/query_task` - partial command=voice-clone-query/request-plan-compare - Query command exists; live proof needs a real task id, and dry-run request shape can be compared offline against UI captures.
  - Evidence: `docs/qa/jimeng-request-plan-compare-20260611.md`; `data/jimeng-lab/proof-20260610-voice-clone/`
  - Next probe: Use a real task id from an approved voice-clone submit flow, then record/replay voice-clone-query as a cassette-backed read.
- `/mweb/v1/voice/update` - dry_run_only command=voice-clone-update/request-plan-compare - Mutates cloned voice assets; dry-run request shape can be compared offline against UI captures.
  - Evidence: `docs/qa/jimeng-request-plan-compare-20260611.md`; `data/jimeng-lab/proof-20260610-voice-clone/`; `data/jimeng-lab/cli-request-plan-compare-smoke/`
  - Next probe: Capture or create a disposable cloned voice asset, compare voice-clone-update dry-run against the UI request, then require approval before mutation.
- `/mweb/v1/voice/delete` - dry_run_only command=voice-clone-delete/request-plan-compare - Mutates cloned voice assets; dry-run request shape can be compared offline against UI captures.
  - Evidence: `docs/qa/jimeng-request-plan-compare-20260611.md`; `data/jimeng-lab/proof-20260610-voice-clone/`; `data/jimeng-lab/cli-request-plan-compare-smoke/`
  - Next probe: Capture or create a disposable cloned voice asset, compare voice-clone-delete dry-run against the UI request, then require approval before mutation.
- `/mweb/v1/feed` - partial command=voices - Built-in voice library replay is implemented for captured signed feed requests.
  - Evidence: `data/jimeng-lab/cli-voices-smoke/`; `data/jimeng-lab/cli-voices-smoke-2/`; `data/jimeng-lab/voice-library-samples/`
  - Next probe: Refresh a signed voice-library feed request from passive UI capture and record/replay the voices command without relying on stale capture templates.
- `/mweb/v1/mix_audio_video` - dry_run_only command=mix-audio-plan/request-plan-compare - Single audio/video mix task request transform is dry-run covered with body snake-case plus optional babi_param query compare; live replay creates task state and needs capture approval.
  - Evidence: `docs/qa/jimeng-mix-audio-plan-20260611.md`; `data/jimeng-lab/proof-20260611-static-locate-media-helper-blockers/`; `data/jimeng-lab/proof-20260611-static-inventory-media-helper-blockers/`; `data/jimeng-lab/proof-20260611-mix-audio-plan/`
  - Next probe: Capture a single audio/video mix UI submit, then compare it with mix-audio-plan using request-plan-compare before any approval-gated live replay because it creates task state.
- `/mweb/v1/mix_audio_videos` - dry_run_only command=mix-audio-plan/request-plan-compare - Batch audio/video mix task request transform is dry-run covered with input_list plus optional babi_param query compare; live replay creates task state and needs capture approval.
  - Evidence: `docs/qa/jimeng-mix-audio-plan-20260611.md`; `data/jimeng-lab/proof-20260611-static-locate-media-helper-blockers/`; `data/jimeng-lab/proof-20260611-static-inventory-media-helper-blockers/`; `data/jimeng-lab/proof-20260611-mix-audio-plan/`
  - Next probe: Capture a batch audio/video mix UI submit, then compare it with mix-audio-plan --batch using request-plan-compare before any approval-gated live replay because it creates task state.

### L1 Lip-sync / digital human

- `/mweb/v1/video_generate/get_switch_model_queue_info` - blocked - No-spend probes with empty, model_req_key, model_req_keys, and scene bodies returned ret=1000 invalid parameter; capture the exact frontend switch-model queue body before promotion.
  - Evidence: `data/jimeng-lab/proof-20260610-static-locate-video-generate-helpers/`; `data/jimeng-lab/proof-20260610-switch-model-queue-probe/`
  - Next probe: Capture the frontend switch-model queue request from the lip-sync/video UI and replay the exact body through endpoint-probe record/replay.
- `/mweb/v1/video_generate/pre_process` - partial command=video-preprocess-plan/request-plan-compare/submitJimengVideoPreprocess - Frontend data service pre-process task body is modeled for avatar image checks, voice recommendation, audio detect, and audio silence checks; typed service and cassette replay exist, but live replay creates task state and needs passive capture compare plus approval.
  - Evidence: `docs/qa/jimeng-video-preprocess-plan-20260612.md`; `docs/qa/jimeng-lip-sync-human-preprocess-client-20260612.md`; `data/jimeng-lab/proof-20260610-static-locate-video-generate-helpers/`; `data/jimeng-lab/proof-20260612-video-preprocess-plan/`; `data/jimeng-lab/proof-20260612-lip-sync-human-contract-infer/preprocess/`
  - Next probe: Passively capture the video pre-process submit flow, compare it with video-preprocess-plan using request-plan-compare, then record/replay through submitJimengVideoPreprocess only after explicit approval because it creates task state.
- `/mweb/v1/video_generate/mget_pre_process_result` - partial command=video-preprocess-query-plan/request-plan-compare/fetchJimengVideoPreprocessResults - Pre-process result lookup body is modeled by submit_id_list and has typed service/cassette replay coverage; live replay needs task ids from a captured or approved pre_process flow.
  - Evidence: `docs/qa/jimeng-video-preprocess-plan-20260612.md`; `docs/qa/jimeng-lip-sync-human-preprocess-client-20260612.md`; `data/jimeng-lab/proof-20260610-static-locate-video-generate-helpers/`; `data/jimeng-lab/proof-20260612-video-preprocess-query-plan/`; `data/jimeng-lab/proof-20260612-lip-sync-human-contract-infer/preprocess-query/`
  - Next probe: Use task ids from a captured or approved video_generate/pre_process flow, compare with video-preprocess-query-plan, then record/replay through fetchJimengVideoPreprocessResults.
- `/mweb/v1/video_generate/face_auth/skip` - blocked - Seedance face-auth skip submit task can create provider-side task state; capture exact UI payload and approval context before live replay.
  - Evidence: `data/jimeng-lab/proof-20260610-static-locate-video-generate-helpers/`
  - Next probe: Capture the Seedance face-auth skip flow, compare payloads offline, and require explicit approval before live replay because it can create provider-side task state.
- `/mweb/v1/video_generate/face_auth/skip/query` - blocked - Face-auth skip status query depends on a task id from video_generate/face_auth/skip; capture that flow before promotion.
  - Evidence: `data/jimeng-lab/proof-20260610-static-locate-video-generate-helpers/`
  - Next probe: Use a task id from a captured face_auth/skip flow and record/replay the paired status query.

### R1 Reference profile research

- `/mweb/v1/mget_story` - partial command=story-records - No-spend story detail lookup by story_id_list is implemented; live proof still needs real story ids from a non-empty story list or UI capture.
  - Evidence: `data/jimeng-lab/proof-20260611-probe-user-story-list/`; `data/jimeng-lab/proof-20260611-story-archive-dryrun/`; `data/jimeng-lab/proof-20260611-static-inventory-story-archive/`; `data/jimeng-lab/proof-20260611-profile-story-sweep-puai/`; `data/jimeng-lab/proof-20260611-profile-story-sweep-xiaobodeng/`; `data/jimeng-lab/proof-20260611-profile-story-sweep-fuqiang/`
  - Next probe: Find or capture a public profile with a non-empty story list, then run story-records with real story_id_list values and record/replay the cassette; the 2026-06-11 no-spend sweep over three followed profiles returned ret=0 with story_count=0.

### T1 CapCut/template mining

- `/lv/v1/cc_web/replicate/get_search_words` - blocked - Signed no-spend probes returned ret=0 but only region metadata, not usable search words; capture a UI call that returns keyword data before promotion.
  - Evidence: `data/jimeng-lab/proof-20260610-capcut-search-words-probe/`; `data/jimeng-lab/proof-20260610-capcut-probe-hot-words/`
  - Next probe: Passively capture the CapCut replicate search UI call that returns keyword data, then replay with signed CapCut headers and a cassette.
- `/lv/v1/cc_web/replicate/search_templates` - blocked - Signed no-spend probes returned ret=1000 param error across recovered keyword/category/search-id variants; capture an exact template-search UI request before promotion.
  - Evidence: `data/jimeng-lab/proof-20260610-capcut-probe-search/`; `data/jimeng-lab/proof-20260610-capcut-probe-search-templates-v2/`
  - Next probe: Capture an exact CapCut template-search UI request including keyword/category/search-id fields, then add a typed replay fixture.
- `/lv/v1/cc_web/plane/batch_get_collection_templates` - blocked - Signed no-spend probes returned ret=1000 param error across object, list, and nested collection variants; capture the exact batch row UI payload before promotion.
  - Evidence: `data/jimeng-lab/proof-20260610-capcut-probe-batch-collection-templates/`; `data/jimeng-lab/proof-20260610-capcut-probe-batch-collection-templates-v2/`
  - Next probe: Capture the collection-row batch UI payload and compare it against the signed no-spend variants that returned ret=1000.
- `/lv/v1/cc_web/plane/get_collection_presets` - blocked - Signed no-spend probes using confirmed collection ids returned ret=1015 check login error; capture the exact preset UI call and required auth/header context before promotion.
  - Evidence: `data/jimeng-lab/proof-20260610-capcut-probe-presets/`; `data/jimeng-lab/proof-20260610-capcut-probe-presets-confirmed-collection/`
  - Next probe: Capture a preset-list UI request with the required LV auth/header context, then replay with a confirmed collection id.
- `/lv/v1/cc_web/plane/preset_template_detail` - blocked - Preset detail depends on get_collection_presets data, but preset listing currently returns ret=1015 in safe probes; capture a real preset UI flow before promotion.
  - Evidence: `data/jimeng-lab/proof-20260610-capcut-probe-template-detail/`; `data/jimeng-lab/proof-20260610-capcut-probe-presets-confirmed-collection/`
  - Next probe: First unblock get_collection_presets, then use a real preset id from that listing to record/replay preset_template_detail.
- `/lv/v1/cc_web/plane/fuzzy_search_templates` - blocked - Signed no-spend probes returned ret=0 with empty lists for guessed keyword/title bodies; capture a non-empty fuzzy-search UI request before promotion.
  - Evidence: `data/jimeng-lab/proof-20260610-capcut-probe-fuzzy/`
  - Next probe: Capture a non-empty fuzzy-search UI request and replay the exact signed body instead of guessed keyword/title variants.


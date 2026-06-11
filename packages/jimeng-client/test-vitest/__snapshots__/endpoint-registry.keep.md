# Jimeng Triage Coverage

- Decisions: keep
- Families: 9
- Unique endpoints: 62
- Missing endpoints: 0

| ID | Decision | Family | Endpoints | Statuses | Not implemented |
|---|---|---|---:|---|---:|
| G1 | keep | Text/image/video generation | 3 | implemented=1, partial=1, blocked=1 | 2 |
| G2 | keep | Upload and provider asset references | 5 | implemented=4, blocked=1 | 1 |
| P1 | keep | Persona/subject lifecycle | 5 | implemented=4, dry_run_only=1 | 1 |
| V1 | keep | Voice and speech | 9 | implemented=2, partial=2, dry_run_only=3, blocked=2 | 7 |
| L1 | keep | Lip-sync / digital human | 6 | implemented=1, blocked=5 | 5 |
| R1 | keep | Reference profile research | 8 | implemented=7, partial=1 | 1 |
| R2 | keep | Reference controls | 5 | implemented=5 | 0 |
| T1 | keep | CapCut/template mining | 16 | implemented=10, blocked=6 | 6 |
| A1 | keep | Assets/history/queue/video info | 6 | implemented=6 | 0 |

## Not Implemented Endpoints

### G1 Text/image/video generation

- `/mweb/v1/aigc_draft/generate` - partial command=text2image-plan/text2image-compare/text2video-plan/text2video-compare/text2video/image2video/frames2video/lip-sync - Unified generation submit; direct image/video request builders and direct capture compares are dry-run covered; live lip-sync/end-frame still require capture compare or approval-gated submit.
- `/mweb/v1/execute_generate_audit` - blocked - Generation pre-audit posts image/video/audio/subject material lists; capture exact material payload before replay.

### G2 Upload and provider asset references

- `/mweb/v1/mpack_image` - blocked - Packs image material through dreamina-material-data-service; capture the exact caller input shape before promotion.

### P1 Persona/subject lifecycle

- `/mweb/v1/dreamina_subject/generate_voice` - dry_run_only command=subject-generate-voice/request-plan-compare - Subject voice generation may consume quota; dry-run request shape can be compared offline against UI captures before approval.

### V1 Voice and speech

- `/mweb/v1/voice/submit_task` - dry_run_only command=voice-clone-submit/request-plan-compare - Voice clone submit may create assets or consume quota; dry-run request shape can be compared offline against UI captures.
- `/mweb/v1/voice/query_task` - partial command=voice-clone-query/request-plan-compare - Query command exists; live proof needs a real task id, and dry-run request shape can be compared offline against UI captures.
- `/mweb/v1/voice/update` - dry_run_only command=voice-clone-update/request-plan-compare - Mutates cloned voice assets; dry-run request shape can be compared offline against UI captures.
- `/mweb/v1/voice/delete` - dry_run_only command=voice-clone-delete/request-plan-compare - Mutates cloned voice assets; dry-run request shape can be compared offline against UI captures.
- `/mweb/v1/feed` - partial command=voices - Built-in voice library replay is implemented for captured signed feed requests.
- `/mweb/v1/mix_audio_video` - blocked - Submits a single audio/video mix task and returns task status; capture exact babiParam/body from UI before any live replay.
- `/mweb/v1/mix_audio_videos` - blocked - Submits batch audio/video mix tasks and returns submit ids; capture exact babiParam/body from UI before any live replay.

### L1 Lip-sync / digital human

- `/mweb/v1/video_generate/get_switch_model_queue_info` - blocked - No-spend probes with empty, model_req_key, model_req_keys, and scene bodies returned ret=1000 invalid parameter; capture the exact frontend switch-model queue body before promotion.
- `/mweb/v1/video_generate/pre_process` - blocked - Frontend data service submits a video pre-process task; capture the exact UI flow and payload before any live replay.
- `/mweb/v1/video_generate/mget_pre_process_result` - blocked - Read path depends on task ids from video_generate/pre_process; capture a matching pre-process UI flow before promotion.
- `/mweb/v1/video_generate/face_auth/skip` - blocked - Seedance face-auth skip submit task can create provider-side task state; capture exact UI payload and approval context before live replay.
- `/mweb/v1/video_generate/face_auth/skip/query` - blocked - Face-auth skip status query depends on a task id from video_generate/face_auth/skip; capture that flow before promotion.

### R1 Reference profile research

- `/mweb/v1/mget_story` - partial command=story-records - No-spend story detail lookup by story_id_list is implemented; live proof still needs real story ids from a non-empty story list or UI capture.

### T1 CapCut/template mining

- `/lv/v1/cc_web/replicate/get_search_words` - blocked - Signed no-spend probes returned ret=0 but only region metadata, not usable search words; capture a UI call that returns keyword data before promotion.
- `/lv/v1/cc_web/replicate/search_templates` - blocked - Signed no-spend probes returned ret=1000 param error across recovered keyword/category/search-id variants; capture an exact template-search UI request before promotion.
- `/lv/v1/cc_web/plane/batch_get_collection_templates` - blocked - Signed no-spend probes returned ret=1000 param error across object, list, and nested collection variants; capture the exact batch row UI payload before promotion.
- `/lv/v1/cc_web/plane/get_collection_presets` - blocked - Signed no-spend probes using confirmed collection ids returned ret=1015 check login error; capture the exact preset UI call and required auth/header context before promotion.
- `/lv/v1/cc_web/plane/preset_template_detail` - blocked - Preset detail depends on get_collection_presets data, but preset listing currently returns ret=1015 in safe probes; capture a real preset UI flow before promotion.
- `/lv/v1/cc_web/plane/fuzzy_search_templates` - blocked - Signed no-spend probes returned ret=0 with empty lists for guessed keyword/title bodies; capture a non-empty fuzzy-search UI request before promotion.


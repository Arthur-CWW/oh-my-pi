# Jimeng live Effect generation proof — 2026-06-13

## Approval / risk

Arthur approved spending credits for this Jimeng proof wave on 2026-06-13 and asked to stop detouring into no-spend dry-run planning. This run uses direct API submit/poll/download and writes local proof artifacts under an ignored `data/**` directory.

- Expected provider impact: credits spent for one text-to-video job and one text-to-image job; server-side generation history records created in the logged-in account.
- Concurrency: sequential, one generation at a time.
- Stop condition: risk-control/shark errors, auth failure, or provider submit failure.
- Artifact root: `data/jimeng-lab/proof-20260613-live-effect-generation/`.

## Exact live commands

```bash
mise exec -- bun packages/jimeng-client/src/dreamina-compatible-cli.ts text2video \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --session-bundle data/jimeng-lab/raw/session-bundle-current.json \
  --prompt "Korean beauty creator GRWM product hook, handheld phone selfie, soft morning window light, realistic UGC, no captions, no watermark" \
  --duration=3 \
  --ratio=9:16 \
  --model_version=3.0fast \
  --outDir data/jimeng-lab/proof-20260613-live-effect-generation

mise exec -- bun packages/jimeng-client/src/dreamina-compatible-cli.ts text2image \
  --capture data/jimeng-captures/20260609095503-text2image-submit/capture-template.raw.json \
  --session-bundle data/jimeng-lab/raw/session-bundle-current.json \
  --prompt "Premium protein powder UGC product still on a kitchen counter, soft natural morning light, realistic creator aesthetic, no text, no watermark" \
  --ratio=1:1 \
  --outDir data/jimeng-lab/proof-20260613-live-effect-generation
```

## Results

### Original live Effect proof root

- Text-to-video submit/poll/download succeeded.
- Submit id: `34e913f3-7190-44cf-8d67-6fb6d624c7e9`.
- Artifact: `data/jimeng-lab/proof-20260613-live-effect-generation/artifacts/34e913f3-7190-44cf-8d67-6fb6d624c7e9-00.mp4`.
- Normalized result: `data/jimeng-lab/proof-20260613-live-effect-generation/normalized/text2video-20260613101545-q8u1l1-result.json`.
- `ffprobe` result: H.264 video, `704x1248`, `3.016667s`, `2918739` bytes.
- Text-to-image submit failed against the current compatibility capture with provider `ret=3018`, `errmsg=permission denied`, surfaced as `WORKBENCH_SUBMIT_MISSING_IDS`. Treat text-to-image live compatibility as not proven until the image capture/template is refreshed.

### Mandarin prompt / English dialogue live proof

Exact command:

```bash
mise exec -- bun packages/jimeng-client/src/dreamina-compatible-cli.ts text2video \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --session-bundle data/jimeng-lab/raw/session-bundle-current.json \
  --prompt '韩系美妆创作者的手机自拍视频，清晨窗边自然光，真实UGC质感，人物看向镜头用英文说：“This serum makes my skin look awake in ten seconds.” 画面不要字幕，不要水印。' \
  --duration=3 \
  --ratio=9:16 \
  --model_version=3.0fast \
  --outDir data/jimeng-lab/proof-20260613-live-mandarin-english-dialogue
```

Observed output:

- Submit id: `56d80d10-d0ca-42c8-bc9b-0302f66f1192`.
- History id: `36088031597068`.
- Poll status: `50`.
- Poll trace entries: `10`.
- Artifact: `data/jimeng-lab/proof-20260613-live-mandarin-english-dialogue/artifacts/56d80d10-d0ca-42c8-bc9b-0302f66f1192-00.mp4`.
- Normalized result: `data/jimeng-lab/proof-20260613-live-mandarin-english-dialogue/normalized/text2video-20260613103414-f4iegr-result.json`.
- `ffprobe` result: H.264 video, `704x1248`, `3.016667s`, `2841862` bytes.

Renderer output:

```bash
bun packages/jimeng-client/src/browser-proxy-cli.ts proof-report \
  --input data/jimeng-lab/proof-20260613-live-mandarin-english-dialogue \
  --title 'Jimeng Mandarin prompt proof — English dialogue'
```

- HTML report index: `data/jimeng-lab/proof-20260613-live-mandarin-english-dialogue/report/index.html`.
- Function-specific HTML report: `data/jimeng-lab/proof-20260613-live-mandarin-english-dialogue/report/functions/text2video-video.html`.
- Markdown report: `data/jimeng-lab/proof-20260613-live-mandarin-english-dialogue/report/index.md`.
- Original live Effect proof report index: `data/jimeng-lab/proof-20260613-live-effect-generation/report/index.html`.
- Original live Effect function report: `data/jimeng-lab/proof-20260613-live-effect-generation/report/functions/text2video-video.html`.

Artifact dashboard:

```bash
bun packages/jimeng-client/src/artifact-dashboard.ts ingest-proof \
  --db data/jimeng-lab/artifact-log.sqlite \
  --proofRoot data/jimeng-lab/proof-20260613-live-mandarin-english-dialogue \
  --worker Main \
  --command "mise exec -- bun packages/jimeng-client/src/dreamina-compatible-cli.ts text2video --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json --session-bundle data/jimeng-lab/raw/session-bundle-current.json --prompt '韩系美妆创作者的手机自拍视频，清晨窗边自然光，真实UGC质感，人物看向镜头用英文说：\"This serum makes my skin look awake in ten seconds.\" 画面不要字幕，不要水印。' --duration=3 --ratio=9:16 --model_version=3.0fast --outDir data/jimeng-lab/proof-20260613-live-mandarin-english-dialogue"

bun packages/jimeng-client/src/artifact-dashboard.ts status \
  --db data/jimeng-lab/artifact-log.sqlite \
  --id gen-parity \
  --title "Generation parity" \
  --status partial \
  --owner Main \
  --category jimeng-api \
  --summary "Text-to-video direct submit/poll/download is live-proven; text-to-image compatibility submit failed with provider ret=3018 permission denied." \
  --next "Refresh text-to-image capture/template, then rerun approved live submit."

bun packages/jimeng-client/src/artifact-dashboard.ts serve \
  --db data/jimeng-lab/artifact-log.sqlite \
  --root . \
  --port 4189
```

New live/dry-run commands can skip the separate `ingest-proof` step and update the same dashboard DB directly:

```bash
mise exec -- bun packages/jimeng-client/src/dreamina-compatible-cli.ts text2video \
  --capture data/jimeng-lab/raw/jimeng-network-capture-video-01.json \
  --session-bundle data/jimeng-lab/raw/session-bundle-current.json \
  --prompt '韩系美妆创作者的手机自拍视频，清晨窗边自然光，真实UGC质感，人物看向镜头用英文说：“This serum makes my skin look awake in ten seconds.” 画面不要字幕，不要水印。' \
  --duration=3 \
  --ratio=9:16 \
  --model_version=3.0fast \
  --outDir data/jimeng-lab/proof-20260613-live-mandarin-english-dialogue \
  --artifact-db data/jimeng-lab/artifact-log.sqlite \
  --worker Main \
  --artifact-notes "Mandarin prompt with English dialogue"
```

- Live dashboard: `http://127.0.0.1:4188/`.
- Function route example: `http://127.0.0.1:4188/function/text2video%20%2F%20video`.
- SQLite registry: `data/jimeng-lab/artifact-log.sqlite`.
- Screenshot proof: `data/jimeng-lab/artifact-dashboard-smoke.png`.
- Dashboard status rows now separate implementation state from generated artifacts. Workers can update the same SQLite DB through `artifact-dashboard.ts status`, `artifact-dashboard.ts ingest-proof`, or `jimeng-dreamina --artifact-db`.
- Media viewers are selected by MIME: video/audio playable, images visible, other files linked.
- Review shortcuts: `j`/`n` next run, `k`/`p` previous run, `h`/`l` previous/next function, `[`/`]` previous/next artifact, `/` focus the function filter.
Status note: the CLI/API is not fully complete across all Jimeng functions. Text-to-video direct submit/poll/download is live-proven. Text-to-image now has a live-proven browser-backed CLI path: fresh UI submit capture matched the dry-run plan on stable fields, `jimeng-browser-proxy text2image --transport cdp-ui` completed submit/poll/download with four downloaded images, and the `gen-parity` packet is now done. The remaining direct text-to-image gap is endpoint-level: patched direct replay and `--transport cdp-fetch` still hit `ret=3018`, so the browser signer/runtime path remains a classified follow-up. Persona/voice, reference-controls, and template-mining are done; lip-sync remains capture-blocked.

Validation after dashboard subroutes/shortcuts, direct CLI artifact logging, per-function renderer, Effect wrapper, and SQLite limiter changes:

```txt
packages/jimeng-client$ bun test test/dreamina-compatible-cli-artifact-log.test.ts
2 pass, 0 fail

packages/jimeng-client$ bun run test
314 pass, 0 fail

packages/jimeng-client$ bun run typecheck
passed

Browser QA at http://127.0.0.1:4189/
Observed function route /function/text2video%20%2F%20video, shortcut help text, playable video controls, selected run state, and /api snapshot continuity.
```

## Packet implementation wave after tooling fix

Subagents advanced four Jimeng packets without live calls:

- `JimengGenParityWorker`: `text2image` Dreamina compatibility is now explicit partial, not incorrectly "implemented"; it requires refreshed `/mweb/v1/aigc_draft/generate` workbench text-to-image capture and rejects stale `/mweb/v1/creation_agent/v2/conversation`-only captures with typed errors.
- `JimengPersonaVoiceWorker`: subject voice, voice clone submit/query/update/delete, mix-audio request/query params, and persona-voice contract inference now have tighter Effect Schema/fixture-derived coverage.
- `JimengLipSyncWorker`: lip-sync image/avatar and VOD plans now validate model/duration/TTS consistency, video-preprocess task bodies are schema-covered, contract inference tags lip-sync/preprocess packet slices, and live submit remains typed unsupported until a real UI submit capture proves parity.
- `JimengReferenceWorker`: pose/depth/canny reference controls have observed-provider evidence helpers, style is explicitly catalog-only until a preview/save_params capture exists, reference-image builders cover description/face recognition, segmentation tests cover alternate mask containers/no-object rejection, and agent catalog summaries expose reference coverage.

Validation after packet wave:

```txt
packages/jimeng-client$ bun test test/generation-contract.test.ts test/text2image-plan.test.ts test/dreamina-compatible-cli-artifact-log.test.ts test/voice-clone.test.ts test/subjects.test.ts test/mix-audio.test.ts test/contract-infer.test.ts test/lip-sync.test.ts test/lip-sync-compare.test.ts test/video-preprocess.test.ts test/reference-controls.test.ts test/reference-image.test.ts test/reference-segmentation.test.ts test/agent-catalog.test.ts
95 pass, 0 fail

packages/jimeng-client$ bun run test
322 pass, 0 fail

packages/jimeng-client$ bun run typecheck
passed

packages/jimeng-client$ bun run test:vitest
6 files passed, 9 tests passed
```

## SQLite packet ledger

`data/jimeng-lab/artifact-log.sqlite` is now the source of truth for Jimeng packet/workstream status. The dashboard reads packet rows before legacy work items, and `jimeng-artifacts packet set|get|next` owns packet state transitions.

Implementation notes:

- `packages/jimeng-client/src/artifact-log.ts` defines the packet ledger and Drizzle table mappings over Bun SQLite.
- The artifact/workstream client keeps raw SQL only for database initialization/index creation; CRUD/query paths use Drizzle where practical.
- Effect-returning packet/snapshot helpers are exposed for orchestration code that wants an Effect boundary.
- `packet next` only returns claimable packets: `todo`, `review`, or `unknown`; claimed `in_progress`, `blocked`, `done`, and `skipped` rows are skipped.

Seeded current packet rows after fresh review:

```txt
gen-parity: done; browser-backed text2image submit/poll/download is live-proven and remaining direct signer gap is classified as endpoint-level partial follow-up.
persona-voice: done; reviewer passed after required voice audio metadata and mix-audio babi_param fixes.
lip-sync-human: blocked; UI submit capture needed before live submit claim.
reference-controls: done; reviewer passed, with style/reference gaps explicitly parked until provider capture.
template-mining: done; reviewer passed typed non-mutating CapCut/Jimeng template parsing and blocked-reason handling.
```


## Browser-proxy artifact DB logging and template proof

`jimeng-browser-proxy` now writes proof runs directly into `data/jimeng-lab/artifact-log.sqlite` via `--artifact-db`, `--worker`, and `--artifact-notes`. This covers no-spend browser-proxy proof commands, not only `jimeng-dreamina` generation runs.

Logged no-spend template-mining proofs:

```txt
data/jimeng-lab/proof-20260613-template-mining-metadata/              capcut-template-metadata; ratios=6, scenes=33
data/jimeng-lab/proof-20260613-template-mining-collections/           capcut-collections; collections=35
data/jimeng-lab/proof-20260613-template-mining-collection-templates/  capcut-collection-templates; collection_id=12038, rows=5, has_more=true
```

Text-to-image unblock diagnostics:

```txt
data/jimeng-lab/proof-20260613-text2image-unblock/account-credit/              ret=0, total_credit=3954
data/jimeng-lab/proof-20260613-text2image-unblock/image-models/                ret=0, model high_aes_general_v50 available
data/jimeng-captures/20260613-goal-text2image-submit-refresh/                  fresh UI /mweb/v1/aigc_draft/generate submit capture
data/jimeng-lab/proof-20260613-goal-text2image-ui-history/                     UI submit completed, history_id=36088036919564, status=50, 4 image items, 2048x2048
data/jimeng-lab/proof-20260613-goal-text2image-compare-v2/                     stable body compare match=true after ignoring volatile seed/ids
data/jimeng-lab/proof-20260613-goal-text2image-direct/                         patched direct replay still ret=3018 permission denied
data/jimeng-lab/proof-20260613-goal-text2image-cdp-fetch/                      browser-delegated page.fetch path still ret=3018 permission denied
data/jimeng-lab/proof-20260613-goal-text2image-cdp-ui/                         browser UI delegated submit/poll/download succeeded, 4 downloaded PNG artifacts
```

Conclusion: text-to-image is no longer blocked as a user-facing CLI workflow. It is blocked only as a pure direct replay/signature problem: stale body/schema, auth, credits, and model access are ruled out; both patched direct replay and `cdp-fetch` still fail with `ret=3018`, while the browser UI delegated path succeeds through the live frontend runtime.

Validation after this update:

```txt
bun test packages/jimeng-client/test/http-transport.test.ts packages/jimeng-client/test/client.test.ts packages/jimeng-client/test/text2image-plan-compare.test.ts packages/jimeng-client/test/endpoint-registry.test.ts
25 pass, 0 fail

bun run --cwd packages/jimeng-client typecheck
passed

bun run --cwd packages/jimeng-client test
331 pass, 0 fail

bun run --cwd packages/jimeng-client test:vitest
6 files passed, 9 tests passed
```
Validation:

```txt
packages/jimeng-client$ bun test test/artifact-dashboard.test.ts
3 pass, 0 fail

packages/jimeng-client$ bun run test
323 pass, 0 fail

packages/jimeng-client$ bun run typecheck
passed

packages/jimeng-client$ bun run test:vitest
6 files passed, 9 tests passed
```

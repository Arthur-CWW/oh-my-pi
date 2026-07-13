> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-10T03-31-32-592Z_019f4a14-9c70-7000-abd0-20957c2aad05/local/omp-agent-runtime-consolidation-plan.md

# OMP agent runtime consolidation plan

## Context

Remove stale provider/model-named agents and make OMP’s bundled role agents the only task taxonomy. Route ordinary workers to GPT-5.6 Terra, keep Sol for orchestration/escalation, keep Ultra out because it duplicates OMP fan-out, and make live, parked, and historical children swappable without showing old journals as active agents. Replace the default CuaDriver path with the installed Codex Computer Use runtime, then prove it by creating, rigging, coloring, and privately recording a Peter Griffin model in Blender.

## Approach

1. **Finish the started GPT-5.6 capability cutover.** Preserve the current catalog/AI/agent/Python changes that separate endpoint wire effort from Codex orchestration. `ReasoningEffort` may round-trip an endpoint-advertised literal; `CodexOrchestrationLevel.Ultra` and `model.codex.supportsUltraOrchestration` derive only from `multi_agent_version === "v2"`. Complete the remaining coding-agent narrowings in `src/thinking.ts` and `src/sdk.ts`: legacy `Effort` maps stay closed to their supported literals, while model-capability/Codex boundaries use `ReasoningEffort`. Do not add `Ultra` to `ThinkingLevel`, the selector, `/thinking`, or task routing; a single worker uses `max` when longer reasoning is needed.

2. **Delete custom provider/model-branded agents.** Remove, without aliases:
   - User scope: `~/.omp/agent/agents/{gpt-implementer,kimi-implementer,kimi-researcher,authenticated-web-kimi,maintenance-kimi,reveng-scout-kimi,noumena-designer}.md`.
   - Project scope: `.omp/agents/{jimeng-gemini-worker,jimeng-kimi-worker,prose-deepseek-v4-pro,prose-glm-5-2}.md`.
   Keep only bundled `task`, `quick_task`, `explore`, `plan`, `reviewer`, `designer`, `librarian`, and `oracle`. Route implementation, maintenance, Jimeng, authenticated-web, and prose packets through `task` with a specialist `role`, file contract, tool allowlist, and optional model override; use `explore` or `librarian` for read-only work. `gpt-implementer` disappears entirely: it pins GPT-5.5 and wrongly autoloads Computer Use into general implementation.

3. **Normalize active routing to GPT-5.6 roles.** Update `~/.omp/agent/config.yml`, `.omp/config.yml`, `.omp/fable-config.yml`, `.omp/companion-config.yml`, `.omp/playground-config.yml`, and `.omp/primer-config.yml` to this map: `default = openai-codex/gpt-5.6-sol`, `smol/task = openai-codex/gpt-5.6-terra`, `slow/plan/advisor = openai-codex/gpt-5.6-sol`; preserve the current deliberate vision/designer provider choices. Set Terra medium as the normal worker default; use Terra high only to preserve high-effort historical work or for a specifically hard bounded packet. Remove invalid custom roles (`implementer`, `research`, `maintenance`, `authenticated_web`) and every GPT-5.5 fallback. Keep provider fallbacks only on valid built-in roles. Set `serviceTier: none` globally and in overlays, and set embedded Codex runs to `service_tier="default"`; `/fast status` must be off everywhere. Update stale GPT-5.5/Fable reset comments, `~/.omp/agent/runtime-preferences/priority.json`, and `src/web/search/providers/codex.ts` so runtime fallbacks prefer Terra rather than GPT-5.5. Preserve GPT-5.5 display abbreviations solely for old transcript rendering. Update active runbooks/skills that invoke removed names; leave incident reports and old handoffs unchanged as historical evidence.

4. **Separate active/revivable children from immutable history.** Add a versioned child lifecycle record carrying `agentId`, `childSessionFile`, `parentSessionFile`, `state` (`running|idle|parked|completed|failed|interrupted`), `updatedAt`, and optional `modelId`/`thinkingLevel`. Append it when `TaskExecutor` starts, parks, resumes, interrupts, completes, or fails a child. Change `reAdoptDirectChildren()` to register only the newest non-terminal record for a uniquely owned direct child; legacy journals without lifecycle records become history-only. Remove `AgentHub.registerPersistedSubagents()` so opening Agent Hub cannot promote every child JSONL to `parked`. Keep all JSONL files. Extend `history://` indexing to expose active and archived children separately, while IRC, Agent Hub, job lists, and re-adoption show only live/revivable entries. Restarting OMP after install clears the current in-memory historical clutter without deleting transcripts.

5. **Make `job setModel` work for active, parked, and historical direct children.** Retain and review the historical-hotswap edits already present in the dirty tree rather than duplicating them. The `JobTool` context must receive the parent `SessionManager`/session path plus model registry/settings. Resolution order is: live background job, registered parked child, then a unique direct-child journal owned by the current parent. A historical-only match may be mutated only after direct-child ownership, non-collision, and model/effort validation. `SessionManager` appends one atomic model-change transaction containing model, thinking/effort, requested-by source, previous route, new route, timestamp, and a custom audit entry; it must not auto-revive the child or rewrite prior JSONL. Unknown IDs, duplicate IDs, foreign-parent journals, and unsupported model/effort combinations fail without writes. Add focused tests for the live path, parked path, historical high→Terra-high, medium→Terra-medium, unknown, collision, and foreign-parent cases. Then migrate every direct historical GPT-5.5 child through this product path—currently `OpenDesignRefreshPod`, `ResumeAuthEscape`, `ResumeCodexRotation`, `ResumeCtrlS`, `ResumeEvalAbort`, `ResumeExtensionLoader`, and `SkillInventoryPod`—to `openai-codex/gpt-5.6-terra:high`; a full journal scan must catch any additional GPT-5.5 child and preserve its existing effort.

6. **Add one constrained Codex Computer Use boundary, not another OMP agent type.** Create self-contained `packages/computer-use-bridge` with its own `package.json`, scripts, schemas, tests, and README; add it to `.omp/config.yml` as an extension without touching the root package manifest. Register one `computer_use` tool whose actions are `run`, `resume`, `status`, and `interrupt`, with fields `name`, `prompt`, optional `threadId`, `cwd`, `model`, and `effort`. Defaults are `openai-codex/gpt-5.6-sol`, `high`, and standard service tier. Reject `Ultra` explicitly because it is client-side nested orchestration; accept `medium|high|xhigh|max` only. Resolve `/Applications/Codex.app/Contents/Resources/codex`, launch `codex exec --json` under `packages/agent-mux`, capture its thread ID/transcript/exit state, and resume with the same Codex thread. OMP remains the sole decomposer; the embedded prompt forbids spawning Codex subagents and limits execution to the installed `computer-use` plugin via `node_repl`. Never clone the private protocol, never use the unauthenticated direct MCP path, never bypass approval, and return the existing `-10000`/app-permission error verbatim when the Codex host has not authorized an app.

7. **Cleanly remove the default CuaDriver tool path.** Stop registering `registerComputerUse` and `registerCuaDriver` from `packages/web-access/src/index.ts`; delete their dedicated source/tests after the new bridge passes its smoke test, and update that package’s README/exports. Disable the active global `cua-driver` skill link and update `browser-control`/`background-browser-automation` guidance so OpenAI GUI work routes through the new Codex boundary. Do not leave an alias named `native_gui` or a second prompt-level GUI tool. CuaDriver may remain installed as an external utility, but it is no longer an advertised OMP tool or autoloaded skill.


8. **Build a fail-closed app-window recorder.** Create self-contained Swift package `packages/window-recorder` with `Sources/WindowRecorder/{main.swift,CLI.swift,WindowResolver.swift,Recorder.swift,Manifest.swift}` and unit tests for argument decoding/window ambiguity/manifest encoding. `list` reports shareable on-screen windows; `record --bundle-id org.blenderfoundation.blender --output <mp4> --manifest <json> [--cursor]` requires exactly one matching Blender window. Capture with `SCContentFilter(desktopIndependentWindow:)` and `SCStream`; encode H.264 MP4 with `AVAssetWriter`, no audio, cursor off by default, and `AVVideoScalingModeResizeAspectFill` to center-crop to 1080×1920. Do not use `sourceRect` for single-window capture. Write a ready manifest only after the first accepted frame; include bundle ID, window ID/title, start/end timestamps, dimensions, frame count, dropped-frame count, codec, cursor/audio flags, output SHA-256, and terminal status. Handle SIGINT/SIGTERM by draining and finalizing the writer. If the target is missing/ambiguous, Screen Recording permission is absent, the window is replaced, or frames stop, fail closed—never fall back to display capture. Run the recorder under `agent-mux` so CMux/terminal closure cannot terminate it.

9. **Run the Blender proof through that boundary.** Use the existing reference at `local/blender-peter-proof/reference/peter-reference.jpg`; verify its recorded SHA before work. Start `window-recorder` under an `agent-mux` session named `BlenderCapture`, wait for its ready manifest, then invoke `computer_use run` as `BlenderPeter` with Sol/high and fast mode off. The fixed prompt requires GUI-only Blender interaction—no Bpy, Blender MCP, shell-generated geometry, or nested agents—and these saved checkpoints: reference setup; full-body primitive blockout; sculpted head/torso/limbs with voxel remesh; manual low-poly retopology with face, shoulder, elbow, hip, knee, and ankle loops; UVs; separate skin/hair/shirt/pants/shoes/eye materials matching the reference; glasses, collar, belt, shoes, eyes, nose, ears, and hair; named humanoid armature; parenting/weights; corrected deformation pose; three-point lighting; vertical camera; final render; `.blend` and `.glb` export. Save `peter_00_reference.blend` through `peter_09_final.blend`, `peter_final.glb`, and `peter_final.png` under `local/blender-peter-proof/artifacts/`. Stop `BlenderCapture` only after Codex exits and Blender has saved; verify the MP4 contains Blender alone, no desktop/other-app frames, no audio, and continuous modeling activity. Preserve Codex JSONL/thread ID and recorder manifest beside the artifacts.

10. **Cleanup only after the behavior works.** Update the control-plane/routing docs, relevant package READMEs/changelogs, skill inventory, `TASKS.md`, and proof ledger to describe the eight-role taxonomy, archived-history semantics, historical hotswap audit, Codex boundary, and recorder rerun commands. Remove superseded code/comments/config keys rather than keeping compatibility shims. Install the rebuilt OMP binary only after package gates pass, restart once to exercise re-adoption, then migrate the historical GPT-5.5 journals and generate the Blender proof.

## Critical files & anchors

- `vendor/oh-my-pi/packages/coding-agent/src/task/executor.ts` — append lifecycle transitions and supply the owner-aware hotswap context.
- `vendor/oh-my-pi/packages/coding-agent/src/task/re-adopt.ts` — admit only uniquely owned non-terminal children; no legacy-journal promotion.
- `vendor/oh-my-pi/packages/coding-agent/src/ui/agent-hub.ts` — remove persisted-journal registration from the active roster.
- `vendor/oh-my-pi/packages/coding-agent/src/tools/job.ts` — resolve and atomically persist live/parked/historical `setModel` requests.
- `packages/computer-use-bridge/src/index.ts` and `packages/window-recorder/Sources/WindowRecorder/Recorder.swift` — the single external GUI boundary and single-window ScreenCaptureKit recorder.


## Verification

1. Existing capability packages:
   - `cd vendor/oh-my-pi/packages/catalog && bun test test/codex-discovery.test.ts test/model-thinking.test.ts && bun run check:types`
   - `cd vendor/oh-my-pi/packages/ai && bun test test/openai-codex.test.ts test/openai-codex-stream.test.ts test/auth-gateway-openai-chat.test.ts && bun run check:types`
   - `cd vendor/oh-my-pi/packages/agent && bun test test/agent.test.ts test/compaction-thinking-level.test.ts && bun run check:types`
   - Run the focused Python exact-effort suite in `vendor/oh-my-pi/python`, including case-normalization and custom-literal preservation.
2. Coding-agent gate:
   - `cd vendor/oh-my-pi/packages/coding-agent && bun run check:types`
   - Run the existing focused task/eval suite plus new lifecycle, re-adoption, Agent Hub, job-hotswap, history-index, ownership-collision, and exact-effort tests. Assert Ultra is absent from OMP selectors and that an endpoint-advertised literal still round-trips at the provider boundary.
3. Taxonomy/config smoke:
   - Import `discoverAgents()` with Bun against the real project/user roots and assert that no custom definition is discovered and the names equal the eight bundled roles.
   - Search active configs/runbooks for `gpt-5.5`, `gpt-implementer`, the removed Kimi/Jimeng/prose names, and invalid model-role keys; expected matches are zero outside explicitly historical evidence fixtures/docs.
   - Start a fresh OMP process, verify `/fast status` is off, invoke one default `task`, and assert the route event selects Terra medium.
4. Lifecycle/hotswap behavior:
   - Build fixtures containing a running child, terminal child, legacy child, duplicate ID, and foreign-parent child. After restart, only the running direct child appears in IRC/Agent Hub/job surfaces; all remain readable through `history://`.
   - Run `job setModel` against live, parked, and historical fixtures. Assert one atomic append, preserved effort, route audit, no transcript rewrite, no auto-revival, and no write on unknown/collision/foreign-parent failures.
   - Scan real direct children after migration and assert no latest effective route uses `openai-codex/gpt-5.5`.
5. Package gates:
   - `cd packages/control-plane && bun run check`
   - `cd packages/agent-mux && bun run check`
   - `cd packages/web-access && bun run check`
   - `cd packages/computer-use-bridge && bun run check`
   - `cd packages/window-recorder && swift test && swift build -c release`
6. Computer Use/recorder smoke before Blender:
   - Run the bridge’s `status`, `run`, `resume`, and `interrupt` integration test against the installed Codex executable with a read-only Blender-state prompt; assert thread continuity and agent-mux ownership. A direct MCP attempt is not part of the gate.
   - Record a 10-second Blender-only clip, briefly cover Blender with another app, and inspect sampled frames plus `ffprobe`: resolution 1080×1920, H.264 video only, zero audio streams, no desktop/covering-app pixels, valid duration/frame count, and matching manifest SHA-256.
7. Blender end-to-end proof:
   - Open `peter_09_final.blend` in Blender and inspect the scene/Outliner for meshes, materials, armature, UVs, and named checkpoints; pose joints through the UI to confirm weighted deformation.
   - Open/import `peter_final.glb`, render the final camera, and compare the saved render with the reference for recognizable silhouette/colors/clothing/accessories.
   - Scrub/sample the full MP4 from first to last frame. Confirm only the Blender window appears, no permission dialogs or other apps leak, no audio track exists, the capture spans the complete modeled workflow, and the manifest reports a successful finalization with matching checksum.

## Assumptions & contingencies

- The installed Codex Computer Use plugin and Codex CLI are the supported authentication boundary. The prior direct OMP MCP failure (`Computer Use server error -10000: Sender process is not authenticated`) is not worked around. If Blender permission is denied, stop and request approval in the Codex host; never forge or bypass it.
- Existing child JSONL without the new lifecycle record is retained but treated as archived history. This intentionally favors a clean active roster over guessing that an old process is resumable.
- The current seven known GPT-5.5 historical children all used high effort and therefore migrate to Terra high; any newly discovered journal preserves its own validated effort instead of being forced high.
- OBS and CuaDriver recording are out of scope. ScreenCaptureKit window capture is the only publishable video path; missing macOS Screen Recording permission is a hard stop rather than a display-capture fallback.
- The working tree already contains successful control-plane, agent-mux, catalog, AI, agent, Python, ownership, eval-abort, and historical-hotswap work. Implementation reviews and completes those edits; it does not reset or duplicate them.


## Addendum: Papercut QC loop

Add a first-class `papercut` reporting path during the learning-loop phase. This is distinct from `report_tool_issue`: `report_tool_issue` remains for malformed or incorrect harness tool behavior, while `papercut` captures confirmed workflow/repo friction that agents currently push through silently.

Implementation contract:
- CLI/tool fields: `kind` (`tool|repo|docs|test|workflow|config|agent`), `severity` (`low|medium|high`), `message`, optional `commandOrTool`, `cwdOrPackage`, `evidenceArtifactId`, and `suggestedFix`.
- Store append-only JSONL plus a control-plane SQLite projection with `timestamp`, `agentId`, `modelId`, `sessionId`, `package`, `kind`, `severity`, `fingerprint`, `message`, `evidence`, `suggestedFix`, and `status` (`new|recurring|fixed|wontfix`).
- Fingerprint by normalized kind/package/tool/message shape so repeated papercuts aggregate instead of spamming `TASKS.md`.
- Agents report after pushing through and verifying the friction, never as a substitute for completing the assigned work.
- Dashboard shows newest and recurring papercuts; only reviewed recurring/high-severity items become TASKS candidates.

Verification adds focused tests for schema decoding, fingerprint stability, duplicate aggregation, dashboard projection, and the invariant that a papercut report cannot mark the original task complete or suppress failed verification.


## Addendum: Immediate plan-mode model correction

Confirmed active global config at `/Users/arthur/.omp/agent/config.yml`: `modelRoles.default` is already `openai-codex/gpt-5.6-sol:high`, but `modelRoles.plan` and `modelRoles.complex` are still `openai-codex/gpt-5.5`, and `retry.fallbackChains.{task,implementer,maintenance}` still fall back to `openai-codex/gpt-5.5`. Project `.omp/config.yml` overrides `task` to Terra medium but does not override `plan`, so entering plan mode can route the active session to GPT-5.5 even though normal/default routing is Sol. Execution must make the first config edit a minimal route hotfix: set global `modelRoles.plan`, `modelRoles.complex`, and any GPT-5.5 retry fallback still intended for OpenAI to GPT-5.6 (`plan/complex = openai-codex/gpt-5.6-sol:high`; worker fallbacks = openai-codex/gpt-5.6-terra:medium`), then restart/reload OMP routing before broad implementation. This hotfix is independent of the larger agent taxonomy cleanup and prevents the approved-plan executor from continuing on the wrong model lane.

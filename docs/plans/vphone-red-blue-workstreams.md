# VPhone Red/Blue Workstreams

This plan keeps the vphone detectability work split into a coordinator, a defensive measurement app, an authorized local lab harness, a safety/docs lane, and a follow-up QA proof lane. Implementation lanes may run in parallel when their owner paths are disjoint, but they exchange only documented build commands, run manifests, safety decisions, and proof artifacts.

## Lane Table

| Lane | Scope | Owner paths | Outputs |
|---|---|---|---|
| `coordinator` | Owns the DAG, dispatch order, merge decisions, validation gates, and final reviewer handoff. | `docs/plans/vphone-red-blue-workstreams.md`, `docs/plans/vphone-red-blue-goal.md` | Updated orchestration docs, accepted proof ledger entries, final handoff summary |
| `blue-detection-app` | Buildable SwiftUI iOS app that records touch, behavior, sensor/environment, scoring, and exportable logs for our own lab. | `packages/ios-control/src/DetectionApp/**` | `.app` build products, exported `DetectionLogs/*.jsonl`, screenshots or review notes under `artifacts/vphone-red-blue/blue-app/<run-id>/` |
| `red-detectability-lab` | Controlled measurement harness that drives only our Detection App in the local vphone VM and captures comparable run manifests/results. | `packages/ios-control/src/vphone_lab.py`, package-local harness docs/tests if assigned | `manifest.json`, harness stdout/stderr, normalized measurements, and copied app logs under `artifacts/vphone-red-blue/red-lab/<run-id>/` |
| `safety-docs-lane` | Keeps safety copy, scope boundaries, and operator-facing instructions aligned with authorized local-lab measurement only. | `docs/plans/vphone-red-blue-*.md`, package-local safety docs if explicitly assigned | Safety-boundary wording, out-of-scope decisions, reviewer notes |
| `follow-up-qa-proof` | Runs only after implementation lanes are accepted; gathers focused proof artifacts and maps results back to reviewer questions. | `docs/qa/vphone-red-blue-<date>.md` if coordinator requests a committed sanitized note; ignored raw artifacts under `artifacts/vphone-red-blue/**` | Proof ledger, artifact inventory, sanitized QA note when requested |


## Max-Parallel Orchestration DAG

The coordinator may spawn the maximum number of non-conflicting subagents by following this DAG. Each node owns only its listed paths; if a change needs another node's path, the worker must stop and ask the coordinator to transfer ownership or create a narrow integration task.

Adjacency list:

```txt
C0-coordinator -> B1-blue-detection-app
C0-coordinator -> R1-red-lab-harness
C0-coordinator -> S1-safety-docs-lane
B1-blue-detection-app -> Q1-follow-up-qa-proof
R1-red-lab-harness -> Q1-follow-up-qa-proof
S1-safety-docs-lane -> Q1-follow-up-qa-proof
```

Maximum parallel width is **3 workers** in Wave 1 (`B1`, `R1`, `S1`). `Q1` is intentionally serialized after all three upstream lanes because it consumes their contracts and proof artifacts.

### Nodes and Dependencies

| Node | Owner | May edit | Must not edit | Depends on | Completion payload |
|---|---|---|---|---|---|
| `C0-coordinator` | Coordinator | This plan and assigned goal/handoff docs | App source, harness source, VM state, unrelated dirty files | None | Active DAG, owner map, accepted/blocked status per node |
| `B1-blue-detection-app` | Blue app worker | `packages/ios-control/src/DetectionApp/**` | `src/vphone_lab.py`, VM state, safety copy outside assigned files | `C0` | Changed files, app build command, bundle/scheme details, exported-log schema, recommended focused validation |
| `R1-red-lab-harness` | Red lab worker | `packages/ios-control/src/vphone_lab.py` and explicitly assigned package-local harness docs/tests | Detection app source, safety copy outside assigned files, running VM lifecycle | `C0` | Changed files, CLI usage, manifest schema, run-output paths, recommended focused validation |
| `S1-safety-docs-lane` | Safety/docs worker | Safety wording in assigned docs only | App source, harness source, unassigned docs, task trackers | `C0` | Boundary changes, disallowed-action list, reviewer-facing caveats |
| `Q1-follow-up-qa-proof` | QA proof worker or coordinator | Sanitized QA note if requested; ignored artifacts under `artifacts/vphone-red-blue/**` | Implementation source except coordinator-approved narrow fixes, VM stop/restart, unrelated dirty files | `B1`, `R1`, `S1` accepted | Proof ledger, artifact inventory, commands actually run, failures with owner routing |

### Parallel Waves

1. **Wave 0: Coordinate.** Run `C0` alone long enough to freeze owner paths, red-team boundary, and acceptance commands. No worker starts from stale ownership.
2. **Wave 1: Maximum safe parallelism.** Run `B1`, `R1`, and `S1` together. These lanes have disjoint owner paths and can progress without touching the running vphone VM lifecycle.
3. **Wave 2: Merge and focused validation.** Coordinator reviews payloads, resolves ownership questions, and runs only the focused lane validations listed in this document. Skip project-wide gates, formatters, package-manager churn, `sudo`, VM stop/restart, and unrelated cleanup.
4. **Wave 3: QA proof.** Start `Q1` only after the coordinator accepts `B1`, `R1`, and `S1`. QA may collect artifacts from both lanes but does not broaden red-team scope or mutate implementation files without a new coordinator-owned task.

### Merge Gates

- **Path gate:** each worker's diff must be limited to its `May edit` paths. Any cross-path dependency becomes a coordinator-owned integration decision before merge.
- **Safety gate:** no change may add third-party app interaction, stealth/evasion instructions, VM patching, kernel/boot-arg changes, AMFI/SIP changes, or `sudo` requirements.
- **Contract gate:** blue must publish the app build command and log schema before red or QA treats detector output as consumable; red must publish the CLI/manifest schema before QA treats harness output as comparable.
- **Artifact gate:** raw run artifacts stay under `artifacts/vphone-red-blue/**` unless the coordinator explicitly requests a sanitized committed QA note.
- **Validation gate:** coordinator runs only the focused lane checks in the table below; broad formatters, project-wide tests, package-manager churn, and unrelated gates are not acceptance substitutes.

### Validation Gates

| Gate | When | Command or proof | Pass signal | Failure routes to |
|---|---|---|---|---|
| `V-blue-list` | After `B1` claims project-shape changes | `xcodebuild -list -project packages/ios-control/src/DetectionApp/DetectionApp.xcodeproj` | Scheme/project is discoverable | `B1` |
| `V-blue-build` | After `B1` claims buildability | Focused Detection App simulator build listed below | Debug simulator build completes; current asset-catalog/runtime-selection failures are `B1` fixes | `B1` |
| `V-red-help` | After `R1` claims CLI import/path fixes | `cd packages/ios-control && python3 src/vphone_lab.py --help` | Help text exits successfully; direct-script stdlib-shadowing failures are `R1` fixes | `R1` |
| `V-safety-scope` | After `S1` changes wording | Coordinator review of changed safety text | Text preserves authorized local-lab-only scope and excludes third-party stealth/evasion guidance | `S1` |
| `V-qa-proof` | After `Q1` collects artifacts | Proof ledger plus artifact inventory paths | Every accepted implementation lane has a focused proof result or a routed blocker | Coordinator or original lane owner |

### Conflict Rules

- First worker to discover a needed shared edit reports it to the coordinator instead of editing across ownership.
- If blue changes exported log fields after red has consumed them, blue must include a schema note and the coordinator routes any red parser update as a follow-up dependency.
- If red changes manifest fields after QA has started, red must include a manifest note and QA pauses comparison until the coordinator accepts the updated contract.
- Safety wording has veto priority over implementation convenience: any ambiguous red-team instruction is narrowed to authorized local-lab measurement of the Detection App only.
- The running vphone VM is an external resource, not an owned file. Workers may recommend commands, but only the coordinator-approved run lane may interact with it, and no lane may stop, restart, patch, or weaken the host or VM.

## Blue Team Detection App

Purpose: make our own iOS app a reliable detector surface for controlled lab measurement.

First slices:

- Keep the app buildable from `packages/ios-control/src/DetectionApp/DetectionApp.xcodeproj`.
- Preserve visible scoring/debug output so reviewers can see which signal families changed.
- Export structured logs with timestamps, scenario/run labels when available, per-layer scores, active flags, and raw-safe touch/behavior summaries.
- Treat detector thresholds as calibration knobs backed by artifacts, not as claims about external apps.

Non-goals:

- No App Store distribution, production telemetry, third-party SDKs, or remote upload.
- No detection claims beyond what this app measures in our controlled VM or simulator.
- No hidden anti-user behavior; the app is a transparent blue-team measurement tool.

Validation commands for coordinator:

```sh
xcodebuild -list -project packages/ios-control/src/DetectionApp/DetectionApp.xcodeproj
xcodebuild -project packages/ios-control/src/DetectionApp/DetectionApp.xcodeproj \
  -scheme DetectionApp \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  build
```

## Red Team Detectability Lab

Purpose: measure how our own harness appears to our own app, then reduce accidental lab artifacts that would make measurements noisy or non-repeatable.

Allowed work:

- Run labeled scenarios against the Detection App only.
- Capture run metadata: scenario, command, app build label, VM/device label, WDA endpoint, start/end times, harness config, and artifact paths.
- Compare baseline modes so blue-team detector changes can be reviewed against repeatable evidence.
- Reduce self-inflicted lab noise such as missing waits, inconsistent labels, unstructured output, or accidental launch path differences.

Explicitly disallowed:

- No stealth/evasion guidance for third-party apps or abuse-prevention systems.
- No bypass matrices or instructions for concealing jailbreak, automation, VM, WDA, XCTest, HID, or environment signals from external targets.
- No vphone VM mutation, kernel patching, boot-arg changes, AMFI/SIP changes, or `sudo`.
- No interaction with third-party apps during measurement.

Validation command for coordinator:

```sh
cd packages/ios-control
python3 src/vphone_lab.py --help
```

Controlled VM run command, only after coordinator approval to use the already-running VM:

```sh
cd packages/ios-control
python3 src/vphone_lab.py --scenario baseline --out ../../artifacts/vphone-red-blue/red-lab/<run-id>
```

## Proof Artifact Contract

Each measurement run should create or collect:

```txt
artifacts/vphone-red-blue/<lane>/<run-id>/
  manifest.json          # scenario, commands, build label, VM/device label, timestamps
  harness.log            # red harness stdout/stderr or equivalent transcript
  detection-log.jsonl    # copied/exported app log when available
  screenshots/           # optional reviewer screenshots
  notes.md               # optional short reviewer note, no secrets
```

Committed docs may link to these paths, but raw artifacts remain ignored unless the coordinator explicitly asks for a sanitized QA note.

## Handoff Protocol

- **Worker to coordinator:** changed files, invariant preserved, concrete commands, artifact paths, and any unrun recommended validation.
- **Blue to red:** app build command, bundle id/install path, expected log export path, and detector schema/fields that red can consume.
- **Red to blue:** scenario manifest, normalized observations, copied app logs, and suspected detector-noise issues phrased as calibration questions.
- **Coordinator merge gate:** run the focused commands above, copy proof artifacts into the agreed roots, and update only coordinator-owned handoff docs when status materially changes.

If a proposed action would require third-party app interaction, host security weakening, VM patching, or external evasion advice, stop that action and route it back to the coordinator as out of scope.

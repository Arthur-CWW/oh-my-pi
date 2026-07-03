# VPhone Red/Blue Goal

## Outcome

Turn vphone detectability into a bounded red-team/blue-team program with two clearly separated lanes:

1. **Blue Team Detection App** builds and runs our own iOS app that measures VM, automation, touch, timing, sensor, and logging signals inside the controlled vphone lab.
2. **Red Team Detectability Lab** measures those signals against our own app and VM, then reduces self-inflicted lab artifacts such as harness jitter, incomplete run metadata, brittle install steps, or accidental XCTest/WDA launch leakage.

The program is successful when a reviewer can build the app, run an authorized local measurement session, collect logs, and compare runs from stable artifacts without touching third-party apps or bypassing third-party abuse-prevention systems.

## Safety Boundary

- Authorized targets only: `packages/ios-control/src/DetectionApp/**`, the local vphone VM already under our control, and local harness code under `packages/ios-control/**`.
- Red-team work is **local measurement only**. It may compare harness modes and remove accidental lab noise in our own setup; it must not provide stealth/evasion instructions for App Store apps, banking apps, games, social platforms, anti-fraud systems, or external services.
- Do not stop, reboot, reconfigure, or patch the running vphone VM from this workstream unless the coordinator explicitly assigns that operation.
- Do not use `sudo`, global AMFI boot-args, provider accounts, proxies, or third-party production apps as part of this program.
- Proof artifacts must be sanitized: no credentials, private captures, account tokens, raw device secrets, or third-party app data.

## Owner Paths

| Lane | Owner paths | Proof artifact roots |
|---|---|---|
| Blue Team Detection App | `packages/ios-control/src/DetectionApp/**` | `artifacts/vphone-red-blue/blue-app/<run-id>/`, plus exported app logs copied from `Documents/DetectionLogs/` |
| Red Team Detectability Lab | `packages/ios-control/src/vphone_lab.py`, focused harness tests/docs under `packages/ios-control/**` | `artifacts/vphone-red-blue/red-lab/<run-id>/` |
| Coordination docs | `docs/plans/vphone-red-blue-goal.md`, `docs/plans/vphone-red-blue-workstreams.md`, `docs/plans/README.md`, `TASKS.md` | `docs/qa/vphone-red-blue-*.md` if the coordinator asks for a committed QA note |

## Explicit Non-goals

- No bypass recipes for third-party detection, risk scoring, rate limits, jailbreak checks, device attestation, bot defenses, or abuse-prevention systems.
- No claims that a harness mode is hidden from detection. The only allowed claim is what our blue app measured in our lab, with artifacts.
- No new vphone kernel patches, AMFI/SIP changes, boot-arg changes, or host security weakening.
- No broad rewrite of `packages/ios-control`; first slices should make the blue app buildable and the red harness measurable.
- No project-wide gates from workers; the coordinator runs focused validation after integration.

## Concrete Next Commands

Coordinator/reviewer commands after the sibling implementation slices land:

```sh
# Blue app project visibility.
xcodebuild -list -project packages/ios-control/src/DetectionApp/DetectionApp.xcodeproj

# Blue app simulator build smoke; does not require touching the running VM.
xcodebuild -project packages/ios-control/src/DetectionApp/DetectionApp.xcodeproj \
  -scheme DetectionApp \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  build

# Red lab CLI surface smoke; stdlib-only harness help.
cd packages/ios-control
python3 src/vphone_lab.py --help
```

Manual VM measurement, only when the coordinator is ready to use the controlled VM:

```sh
# Install the built app to the authorized local VM, then run a labeled harness session.
xcrun devicectl device install app --device <VM_UDID> <path-to-DetectionApp.app>
cd packages/ios-control
python3 src/vphone_lab.py --scenario baseline --out ../../artifacts/vphone-red-blue/red-lab/<run-id>
```

## Handoff Protocol

1. Each lane returns changed files, exact commands run or recommended, and proof artifact paths.
2. Blue hands off the app bundle/build command, expected bundle id, and where exported detection logs land.
3. Red hands off the scenario name, harness config, timestamps, device identifier label, and normalized measurement output path.
4. Coordinator copies app logs and harness output into `artifacts/vphone-red-blue/<lane>/<run-id>/`, then records any committed QA summary separately if needed.
5. If red observations suggest a blue detector is noisy, file it as a detector-calibration issue; do not convert it into third-party evasion guidance.

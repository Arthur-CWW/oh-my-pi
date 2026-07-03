# VPhone Red/Blue Workstream QA — 2026-06-25

## Claim

The vphone red/blue detectability workstream is now concrete and runnable enough for parallel follow-up lanes:

- goal/workstream docs define separate blue-team and red-team ownership boundaries;
- blue-team DetectionApp has an Xcode project and builds as an iOS simulator target;
- red-team local lab harness has stdlib-only tests and CLI help;
- safety copy keeps red-team work scoped to authorized local measurement against our own app/VM.

## Commands run

```sh
python3 -m unittest packages/ios-control/tests/test_vphone_lab.py
```

Result: passed, `Ran 5 tests` / `OK`.

```sh
cd packages/ios-control && python3 src/vphone_lab.py --help >/dev/null
```

Result: passed.

```sh
xcodebuild -list -project packages/ios-control/src/DetectionApp/DetectionApp.xcodeproj
```

Result: passed; project exposes target and scheme `DetectionApp`.

```sh
xcodebuild -project packages/ios-control/src/DetectionApp/DetectionApp.xcodeproj \
  -target DetectionApp \
  -configuration Debug \
  -sdk iphonesimulator \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Result: passed; `** BUILD SUCCEEDED **`.

## Environment notes

- Installed simulator runtime is iOS 16.4, while Xcode SDK is iOS 26.2.
- Scheme/destination builds that require an installed iOS 26.2 simulator destination fail locally before compilation.
- The validated build gate therefore uses the target-level simulator build above, which compiles and links the app without requiring an installed matching simulator runtime.

## Safety boundary verified

Changed red/blue docs and harness copy state that work is authorized local measurement only:

- no third-party app interaction;
- no stealth/evasion guidance;
- no VM mutation, kernel patching, boot-arg changes, AMFI/SIP changes, or `sudo`;
- raw proof artifacts stay under ignored `artifacts/vphone-red-blue/**` unless sanitized later.

## Next runnable lane

After installing the built app into the controlled vphone VM, run a labeled harness script:

```sh
cd packages/ios-control
python3 src/vphone_lab.py ./lab-actions.jsonl ../../artifacts/vphone-red-blue/red-lab/<run-id> \
  --socket /Users/arthur/agents/vphone-cli/vm/vphone.sock \
  --profile lab-micro \
  --seed 42
```

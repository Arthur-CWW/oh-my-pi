# iOS QA Controller MVP

Local-first MVP for an owned/supervised iOS QA controller with a human-in-the-loop web console and hash-chained audit log.

This is intentionally **not** a stealth or anti-detection system. It is for owned QA devices, supervised/MDM-managed where possible, with explicit operator attribution and auditability.

## What works now

- HTTP server + browser console.
- Device discovery through `xcrun xctrace list devices` and optional `cfgutil list`.
- Audited tap/type/swipe/snapshot API endpoints.
- Hash-chained JSONL audit log under `state/audit.jsonl`.
- Dry-run action mode by default when WDA is not configured.
- Optional WDA proxy mapping via `IOS_QA_WDA_MAP`.
- Smoke test that starts the controller, calls health/devices, submits an audited tap, and verifies the audit hash.

## Run

```bash
cd ~/agents/apps/ios-qa-controller
npm run check
npm run smoke
npm start
open http://127.0.0.1:4777
```

## Configure a physical iPhone/iPad

1. Install/launch prerequisites on the Mac:
   - Xcode installed and selected with `xcode-select -p`.
   - Device plugged in by USB, unlocked, trusted, and Developer Mode enabled if required.
   - Device should be organization-owned and supervised for fleet use.
2. Start WebDriverAgent for the device using Appium, Xcode, `go-ios runwda`, or an existing lab runner.
3. Expose WDA locally, then start this controller with a UDID mapping:

```bash
IOS_QA_WDA_MAP='<UDID>=http://127.0.0.1:8100' npm start
```

Without `IOS_QA_WDA_MAP`, actions are still accepted but recorded as dry-run audit events.

## API

```http
GET  /api/health
GET  /api/devices
GET  /api/audit?limit=100
POST /api/devices/:udid/actions/tap    { "x": 120, "y": 300 } or { "x_norm": 0.5, "y_norm": 0.5 }
POST /api/devices/:udid/actions/type   { "text": "hello" }
POST /api/devices/:udid/actions/swipe  { ...WDA drag body... }
POST /api/devices/:udid/snapshot
```

Set `X-Operator-Id` on API calls to attribute actions to a human/operator. The web console uses `local-browser`.

## Audit model

Each event stores:

- `event_id`
- timestamp
- actor
- device UDID
- action payload
- backend/WDA result or dry-run reason
- `hash_prev`
- `hash_this`

The hash chain is a tamper-evidence primitive. For production, ship the JSONL log and artifacts to immutable storage.

## Next setup steps

### WebDriverAgent/Appium

Install Appium and XCUITest driver if not already installed:

```bash
npm install -g appium
appium driver install xcuitest
appium driver doctor xcuitest
```

Then configure signing for WebDriverAgent using your Apple Developer Team ID. Follow Appium's real-device configuration guide and prefer a dedicated QA signing identity/profile.

### Supervision/MDM

For a real fleet:

1. Add devices to Apple Business Manager / Apple School Manager.
2. Enroll with Automated Device Enrollment into your MDM.
3. Apply baseline profiles: Wi-Fi, certificates, restrictions, app install policy.
4. Verify `DeviceInformation`, `SecurityInfo`, `InstalledApplicationList`, and `ProfileList` before each run.
5. Use App Lock / Single App Mode only when the run requires kiosk behavior.

### Live video

This MVP has a placeholder phone surface. Wire one of these into the panel next:

- WDA screenshot polling or MJPEG stream.
- `go-ios screenshot` / stream where compatible.
- Mac USB capture/QuickTime/AVFoundation pipeline encoded to WebRTC.
- External camera as ground-truth audit evidence.

### Rack hardening

- Managed USB hubs with per-port reset.
- Smart PDU for host/hub recovery.
- Physical labels and inventory mapping.
- Optional button actuators for unrecoverable device states.
- Per-device quarantine state.

## Boundaries

Use this only for authorized QA on owned/supervised devices. Do not use it to bypass anti-automation, impersonate users, or hide testing from systems you do not control.

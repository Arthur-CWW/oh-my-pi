# iOS Computer Use

AI-agent-driven iPhone control — like Hermes `computer_use`, but for iOS.

```
macOS Agent → [iosctl / Python API] → WDA HTTP → iPhone running WebDriverAgent
                                                    ↳ Screenshots
                                                    ↳ Tap / Swipe / Type
                                                    ↳ Accessibility element tree
```

## Quick Start

### 1. Install WebDriverAgent on your iPhone

```bash
# Clone WDA
git clone https://github.com/appium/WebDriverAgent.git
cd WebDriverAgent

# Open in Xcode, select your device, configure signing
# Build and run WebDriverAgentRunner

# Or use go-ios (no Xcode needed):
brew install go-ios  # or: npm install -g go-ios
ios runwda
```

### 2. Forward WDA port from iPhone to Mac

```bash
# Via USB (iproxy from libimobiledevice):
brew install libimobiledevice
iprox 8100 8100

# Via go-ios:
ios forward 8100 8100
```

### 3. Use the CLI

```bash
# Check connection
python3 cli.py health

# Take an annotated screenshot with element numbers
python3 cli.py capture

# Tap element #5
python3 cli.py click --element=5

# Type text
python3 cli.py type "Hello from AI"

# Scroll down
python3 cli.py scroll down --amount=2

# Launch Safari
python3 cli.py launch com.apple.mobilesafari

# Press Home
python3 cli.py home
```

## Python API

```python
from src.ios_computer_use import iOSComputerUse

ios = iOSComputerUse(
    wda_url="http://localhost:8100",
    humanize=True,  # Human-like timing, curves, typos
)

# Capture screen + elements (SOM: Set-of-Mark)
result = ios.action("capture")
for el in result["capture"]["elements"]:
    print(f"  #{el['index']}: {el['role']} '{el['label']}'")

# Click element #3
ios.action("click", {"element": 3})

# Type with human-like timing
ios.action("type", {"text": "Hello World"})

# Scroll down
ios.action("scroll", {"direction": "down", "amount": 3})

# Swipe from point A to point B
ios.action("swipe", {"from_coordinate": [200, 400], "to_coordinate": [200, 100]})
```

## Architecture

### Action Interface (mirrors Hermes `computer_use`)

| Action | Parameters | Description |
|--------|-----------|-------------|
| `capture` | — | Screenshot + annotated element tree |
| `click` | `element` or `coordinate` | Tap element or point |
| `double_click` | `element` or `coordinate` | Double tap |
| `long_press` | `element` or `coordinate`, `duration` | Long press |
| `swipe` | `from_coordinate`, `to_coordinate` | Swipe between points |
| `scroll` | `direction` (up/down/left/right), `amount` | Scroll |
| `type` | `text` | Type text |
| `key` | `keys` | Press key (home, escape) |
| `home` | — | Press Home button |
| `launch_app` | `bundle_id` | Launch app |
| `wait` | `seconds` | Pause |

All actions accept `capture_after: true` to get a follow-up screenshot.

### Backends

| Backend | Status | Use When |
|---------|--------|----------|
| **WDA** (facebook-wda) | ✅ Working | Primary backend. Needs WDA running on device. |
| **go-ios** | Planned | Cross-platform, no Xcode dependency. |
| **pymobiledevice3** | Planned | Pure Python, supports iOS 17+. |
| **Lab device input** | Planned | Owned-device QA comparison path with its own measurable artifacts. |

## QA Realism Layer

The `Humanizer` wrapper adds bounded variance to inputs so owned-device QA
measurements are not dominated by self-inflicted lab artifacts:

| Feature | What it does |
|---------|--------------|
| **Timing** | Random 100-400ms delays between actions |
| **Tap duration** | Random 50-150ms hold time |
| **Coordinate jitter** | ±3px random offset per tap |
| **Swipe curves** | Bezier curves instead of straight lines |
| **Scroll deceleration** | Ease-out cubic curve for natural scrolling |
| **Typing speed** | 40-80 WPM with per-character variance |
| **Typos** | 2% chance of wrong key + correction |
| **Key-specific timing** | Spaces/punctuation slower; uppercase slower |

Configure or disable:
```python
from src.humanize import HumanizeConfig
ios = iOSComputerUse(humanize_config=HumanizeConfig(
    enabled=True,
    typo_rate=0.0,
    action_delay_ms=(50, 100),
))
```

## Controlled Detectability Measurement

This package is for authorized QA on owned devices, including our own
blue-team detection surfaces. It should help measure what our automation
stack exposes and reduce self-inflicted lab artifacts. Do not apply it
to third-party app-store, banking, game, or abuse-prevention controls
outside the local lab.

| Method | What it exercises | Lab artifact to measure | Scope note |
|--------|-------------------|-------------------------|------------|
| **WDA tap** (this tool) | WebDriverAgent/XCTest-driven UI events | UIKit touch properties and XCTest/session markers may differ from direct use | Supported for owned QA |
| **XCTest launch + WDA** | App launched by XCTest runner | `isRunningXCUITest` and launch environment can be visible to the app under test | Measure explicitly; avoid accidental launch-mode contamination when not testing it |
| **Accessibility APIs** | iOS accessibility event paths | Event routing and timing differ from WDA and direct touch | Useful comparison for accessibility QA only |
| **AssistiveTouch** | System accessibility-assisted input | System settings, overlays, and event routing can become part of the measurement | Owned-device comparison only |
| **USB HID device** | External lab hardware input path | Device setup, transport latency, and fixture behavior can add their own artifacts | Requires a controlled hardware lab |
| **Jailbreak / OS instrumentation** | Modified OS event or observation path | The modified OS state is itself a major artifact | Out of scope for this package unless separately approved for owned research devices |
| **Physical actuator** | Real mechanical interaction with the device | Fixture timing, alignment, and repeatability can dominate results | Slow, expensive, useful only as a lab baseline |

### Signals our blue-team app can measure

A controlled measurement app can inspect signals such as:

1. `ProcessInfo.processInfo.isRunningXCUITest` when the app is launched under XCTest
2. Touch event `type` and `subtype`
3. Touch properties such as `force`, `majorRadius`, and related metadata
4. Timing and coordinate distributions that are too regular for the scenario

### Reducing self-inflicted lab artifacts

1. **Choose launch mode deliberately** — decide whether the test is measuring XCTest launch state or ordinary foreground control.
2. **Use bounded timing variance** — avoid machine-constant delays when the goal is realistic QA measurement.
3. **Use bounded coordinate jitter** — avoid tapping the exact same pixel when measuring user-flow robustness.

These controls improve the quality of our own measurements. They are
measurement hygiene only, and do not authorize use against third-party
automation or abuse-prevention checks.

### vphone local lab harness

`src/vphone_lab.py` is a stdlib-only red-team/blue-team measurement
harness for our local vphone VM. It sends only the vphone-cli Unix socket
protocol actions `tap`, `swipe`, `key`, and `screenshot`, plus local
`wait`/`delay` script rows. Every run writes a manifest and labels the
work as controlled local detectability measurement, not stealth or bypass
work for third-party apps.

Example JSONL script:

```jsonl
{"action":"tap","x":120,"y":420}
{"action":"swipe","from":[220,700],"to":[220,260],"duration_ms":300}
{"action":"key","key":"home"}
{"action":"screenshot"}
{"action":"wait","seconds":0.5}
```

Run it from `packages/ios-control`:

```bash
python3 src/vphone_lab.py ./lab-actions.jsonl ./lab-output \
  --socket /tmp/vphone.sock \
  --profile lab-micro \
  --seed 42
```

Or from the repository root:

```bash
python3 packages/ios-control/src/vphone_lab.py \
  packages/ios-control/lab-actions.jsonl \
  packages/ios-control/lab-output \
  --socket /tmp/vphone.sock
```

Profiles are bounded lab-measurement controls: `none`, `lab-micro`, and
`lab-slow`. Use them only to compare our own blue-team app measurements
across repeatable local conditions.

Focused harness tests are stdlib-only:

```bash
python3 -m unittest packages/ios-control/tests/test_vphone_lab.py
```

## Hermes Integration

### As a Hermes Tool

This can be wired as a Hermes tool that AI agents call directly:

```python
# In a Hermes tool file:
from agents.packages.ios_control.src.ios_computer_use import iOSComputerUse

ios = iOSComputerUse(wda_url=os.getenv("IOS_WDA_URL", "http://localhost:8100"))

def ios_computer_use(action: str, **params) -> str:
    result = ios.action(action, params)
    return json.dumps(result)
```

The tool schema matches `computer_use` so models already know how to use it.

### As an MCP Server

For IDE integration (Claude Code, Codex, etc.):

```python
# mcp_server.py — expose as MCP tools
```

### As a Standalone Agent

```bash
# Give the agent a goal, it drives the phone
echo "Open Safari, search for 'weather in Tokyo', and screenshot the result" | \
  python3 -c "
import sys
from src.ios_computer_use import iOSComputerUse
ios = iOSComputerUse()
# Agent loop: capture → decide action → execute → repeat
"
```

## Prerequisites

### macOS
```bash
# Core tools
brew install libimobiledevice ios-deploy

# Python deps
pip3 install --break-system-packages facebook-wda pymobiledevice3

# Optional: go-ios for cross-platform use
npm install -g go-ios

# Optional: tidevice3 (newer alternative to tidevice)
pip3 install --break-system-packages tidevice3
```

### iPhone
- iOS 14+ (WDA works on iOS 12+)
- Developer Mode enabled (Settings → Privacy & Security → Developer Mode)
- WebDriverAgent installed and running
- USB or WiFi connection to Mac

### Setting up WebDriverAgent

```bash
git clone https://github.com/appium/WebDriverAgent.git
cd WebDriverAgent

# Open WebDriverAgent.xcodeproj in Xcode
# Select WebDriverAgentRunner scheme
# Select your iPhone as target
# Set Team in Signing & Capabilities
# Build & Run (Cmd+R)

# Or headless via go-ios:
ios runwda
```

## Verification

```bash
# Check everything
python3 cli.py health
# {"connected": true, "wda_version": "10.3.0", ...}

# Take a screenshot
python3 cli.py capture
# Screenshot saved: /tmp/ios-capture-annotated.png

# Verify elements are detected
python3 -c "
from src.ios_computer_use import iOSComputerUse
ios = iOSComputerUse()
r = ios.action('capture')
print(f'{r[\"capture\"][\"total_elements\"]} interactive elements found')
for e in r['capture']['elements'][:5]:
    print(f'  #{e[\"index\"]}: {e[\"role\"]} \"{e[\"label\"]}\"')
"
```

## Common Bundle IDs

| App | Bundle ID |
|-----|-----------|
| Safari | `com.apple.mobilesafari` |
| Settings | `com.apple.Preferences` |
| Messages | `com.apple.MobileSMS` |
| Photos | `com.apple.mobileslideshow` |
| Camera | `com.apple.camera` |
| Maps | `com.apple.Maps` |
| Notes | `com.apple.mobilenotes` |
| Calendar | `com.apple.mobilecal` |
| Mail | `com.apple.mobilemail` |
| App Store | `com.apple.AppStore` |
| Spotify | `com.spotify.client` |
| YouTube | `com.google.ios.youtube` |
| WhatsApp | `net.whatsapp.WhatsApp` |
| Instagram | `com.burbn.instagram` |

## Files

```
packages/ios-control/
├── README.md              # This file
├── cli.py                 # CLI tool (iosctl)
├── src/
│   ├── __init__.py
│   ├── types.py           # Action/CaptureResult/Element types
│   ├── humanize.py        # QA realism input wrapper
│   ├── ios_computer_use.py # Main Computer Use interface
│   ├── vphone_lab.py      # Controlled local vphone lab harness
│   └── backends/
│       ├── __init__.py
│       └── wda.py         # WebDriverAgent backend
└── tests/
    └── test_vphone_lab.py # Stdlib fake-client harness tests
```

## Next Steps

- [ ] Test with physical iPhone + WDA
- [ ] Add AssistiveTouch backend for owned-device QA comparisons
- [ ] Add USB HID lab backend for controlled fixture comparisons
- [ ] Build Hermes tool integration
- [ ] Build MCP server for IDE integration
- [ ] Add visual diff / change detection between captures
- [ ] Add app-specific element maps for common apps

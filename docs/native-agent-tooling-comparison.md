# Native App Automation & Testing Tooling Comparison (Detailed)

_Last updated: 2026-02-26_

## Why this document

You asked for a **hacker-friendly, real-time, scriptable** native automation stack (closer to Puppeteer CLI vibes), and a detailed comparison of what already exists.

This doc compares current tools by:

- automation model (semantic/accessibility vs input vs vision)
- practical features already available
- usage examples
- ecosystem health signals

---

## Quick reality check

There is no single, mature OSS tool today that cleanly gives all of this at once:

1. cross-platform native control,
2. semantic accessibility automation,
3. low-level input fallback,
4. vision fallback,
5. white-box debugging integration,
6. excellent CLI/REPL ergonomics.

Existing tools are strong, but each covers only part of that surface.

---

## Ecosystem health snapshot (selected repos)

Source: GitHub GraphQL metadata (stars/issues/PRs).

| Repo                          |  Stars |     Open Issues | Closed Issues | Open PRs | Merged PRs | Last Push (UTC) |
| ----------------------------- | -----: | --------------: | ------------: | -------: | ---------: | --------------- |
| bytedance/UI-TARS-desktop     | 28,285 |             303 |           216 |       40 |      1,069 | 2026-02-24      |
| appium/appium-mac2-driver     |    169 |              40 |           105 |        0 |        188 | 2026-02-16      |
| appium/appium-windows-driver  |    165 |              24 |            46 |        0 |        212 | 2026-02-16      |
| microsoft/WinAppDriver        |  3,994 |           1,105 |           840 |       49 |         35 | 2025-04-14      |
| KDE/selenium-webdriver-at-spi |      5 | issues disabled |             0 |        0 |          0 | 2026-02-17      |
| asweigart/pyautogui           | 12,307 |             504 |           256 |       73 |         61 | 2024-08-20      |
| nut-tree/nut.js               |  2,762 |              32 |           330 |        7 |        189 | 2024-05-01      |
| RaiMan/SikuliX1               |  3,136 |             126 |           351 |        6 |        124 | 2026-01-21      |
| Hammerspoon/hammerspoon       | 14,532 |             642 |         1,955 |       10 |        888 | 2025-12-24      |
| AutoHotkey/AutoHotkey         | 11,995 | issues disabled |             0 |       15 |        126 | 2026-02-13      |
| jordansissel/xdotool          |  3,731 |             292 |            76 |       34 |         86 | 2026-02-06      |
| microsoft/playwright          | 83,064 |             582 |        16,481 |       23 |     16,210 | 2026-02-26      |

---

## Capability matrix (practical)

Legend: ✅ strong, ⚠️ partial, ❌ weak/not target.

| Tool                                 | Semantic tree (a11y)                 | Input control | Vision/image match | Window mgmt | Scriptability                  | Cross-platform          |
| ------------------------------------ | ------------------------------------ | ------------- | ------------------ | ----------- | ------------------------------ | ----------------------- |
| Appium Mac2                          | ✅ (XCTest/WebDriver)                | ✅            | ❌                 | ⚠️          | ✅ (all Selenium/Appium langs) | ❌ (mac only)           |
| Appium Windows Driver + WinAppDriver | ✅ (UIA via WAD)                     | ✅            | ❌                 | ⚠️          | ✅                             | ❌ (Windows only)       |
| Selenium AT-SPI (KDE)                | ✅ (AT-SPI/WebDriver)                | ✅            | ❌                 | ⚠️          | ✅                             | ❌ (Linux only)         |
| dogtail                              | ✅ (AT-SPI)                          | ✅            | ❌                 | ⚠️          | ✅ (Python)                    | ❌ (Linux-first)        |
| PyAutoGUI                            | ❌                                   | ✅            | ⚠️ (screen locate) | ❌          | ✅ (Python)                    | ✅                      |
| nut.js                               | ⚠️ (some window/UI element support)  | ✅            | ✅                 | ✅          | ✅ (Node/TS)                   | ✅                      |
| SikuliX                              | ❌                                   | ✅            | ✅✅               | ❌          | ✅ (Sikuli/Jython/Java)        | ✅                      |
| Hammerspoon                          | ✅ (mac APIs, via modules)           | ✅            | ⚠️                 | ✅          | ✅ (Lua)                       | ❌ (mac only)           |
| AutoHotkey                           | ⚠️ (Windows UI automation + scripts) | ✅✅          | ⚠️                 | ✅          | ✅ (AHK script)                | ❌ (Windows only)       |
| xdotool                              | ❌                                   | ✅✅          | ❌                 | ✅ (X11)    | ✅ (shell)                     | ❌ (X11 only)           |
| Playwright Electron                  | ⚠️ (renderer + Electron context)     | ✅            | ❌                 | ⚠️          | ✅ (Node)                      | ⚠️ (Electron apps only) |

---

## Detailed tool profiles + usage examples

## 1) Appium Mac2 Driver (macOS, semantic-first)

Repo: `appium/appium-mac2-driver`

### What it already has

- Appium driver for macOS using **Apple XCTest**.
- W3C WebDriver-based API + Appium ecosystem clients.
- Session capabilities for app launch/attach (`bundleId`, `appPath`, `arguments`, `environment`).
- Driver-specific commands (examples in README include `macos: click`, right click, double click, drag variants, etc.).
- `appium driver doctor mac2` checks many setup prerequisites.

### Usage example

```bash
appium driver install mac2
appium
```

```python
from appium import webdriver

caps = {
  "platformName": "mac",
  "appium:automationName": "mac2",
  "appium:bundleId": "com.apple.TextEdit"
}

driver = webdriver.Remote("http://127.0.0.1:4723", options=caps)
driver.execute_script("macos: click", {"x": 300, "y": 200})
```

### Limits

- macOS only.
- Setup quality depends on Xcode/XCTest environment + macOS permissions.

---

## 2) Appium Windows Driver (proxy) + WinAppDriver backend

Repos: `appium/appium-windows-driver`, `microsoft/WinAppDriver`

### What it already has

- Appium-side driver that proxies to WinAppDriver.
- Supports UWP, WinForms, WPF, Win32 app automation (per WinAppDriver docs).
- Capability-based launch/attach (`app`, `appTopLevelWindow`, etc.).
- Windows driver README includes pre/post PowerShell execution support.

### Usage example

```bash
appium driver install windows
appium driver run windows install-wad
appium
```

```python
from appium import webdriver

caps = {
  "platformName": "windows",
  "appium:automationName": "windows",
  "appium:app": r"C:\\Windows\\System32\\notepad.exe"
}

driver = webdriver.Remote("http://127.0.0.1:4723", options=caps)
```

### Limits

- Heavy dependency on WinAppDriver state.
- WinAppDriver has long-standing maintenance concerns/backlog.

---

## 3) Selenium WebDriver AT-SPI (Linux semantic path)

Repo: `KDE/selenium-webdriver-at-spi`

### What it already has

- Linux WebDriver implementation over **AT-SPI2** accessibility.
- Selenium/Appium-style black-box GUI testing intent.
- Designed to avoid fragile pixel-only testing where possible.

### Usage idea (Selenium/Appium style)

```python
# Pseudocode style: use Selenium/Appium client + Linux WebDriver endpoint
# to locate and interact with accessible UI elements.
```

### Limits

- Linux-only path.
- Smaller ecosystem/docs footprint than Appium mac/windows paths.

---

## 4) dogtail (Linux accessibility automation, Python)

Repo: `deepin-community/dogtail` (and upstream GitLab ecosystem)

### What it already has

- Python automation against desktop apps through accessibility APIs.
- AT-SPI hierarchy browsing tooling (historically includes sniff/recorder tooling).
- Supports GNOME/GTK and, via accessibility plugins, broader app stacks.

### Usage example (typical style)

```python
from dogtail.tree import root

app = root.application('gedit')
frame = app.child(roleName='frame')
frame.typeText('hello')
```

### Limits

- Linux desktop/accessibility stack quality varies by distro/session.

---

## 5) PyAutoGUI (cross-platform, input-first)

Repo: `asweigart/pyautogui`

### What it already has

- Cross-platform mouse + keyboard automation in Python.
- Typing/hotkeys/mouse motion/click/scroll primitives.
- Screenshot APIs and image location helpers.

### Usage example (from README style)

```python
import pyautogui

pyautogui.moveTo(100, 150)
pyautogui.click()
pyautogui.write('Hello world!', interval=0.1)
pyautogui.hotkey('ctrl', 'c')
```

### Limits

- Less semantic than accessibility-first systems.
- README notes multi-monitor reliability caveats (primary monitor focus).

---

## 6) nut.js (Node/TS native UI toolkit)

Repo: `nut-tree/nut.js`

### What it already has

- Cross-platform native UI automation/testing for Node.
- Mouse/keyboard/clipboard APIs.
- Window operations (enumerate/focus/resize/reposition, etc.).
- Screen-based operations including image matching support (provider dependent).

### Usage example

```ts
import { screen, Region, mouse, straightTo, Point } from "@nut-tree/nut-js";

await screen.highlight(new Region(100, 200, 300, 400));
await mouse.move(straightTo(new Point(500, 300)));
```

### Limits

- Still input/vision-heavy in many real workflows unless paired with semantic backends.

---

## 7) SikuliX (vision-first)

Repo: `RaiMan/SikuliX1`

### What it already has

- Desktop automation through image recognition (OpenCV).
- Works where internal UI semantics are inaccessible.
- Mouse/keyboard actioning tied to visual targets.

### Usage example (Sikuli style)

```python
click("save_button.png")
type("Hello")
```

### Important note

- Project README currently indicates development pauses/suspensions in parts of timeline.

---

## 8) Hammerspoon (macOS automation shell via Lua)

Repo: `Hammerspoon/hammerspoon`

### What it already has

- Native macOS automation via Lua and system API bridges.
- Strong for hotkeys, windowing, app automation workflows.
- Good fit for hacker-style interactive scripting.

### Usage example

```lua
hs.hotkey.bind({"cmd", "alt"}, "R", function()
  hs.reload()
end)

hs.hotkey.bind({"cmd", "alt"}, "N", function()
  hs.application.launchOrFocus("Notes")
end)
```

### Limits

- macOS only.

---

## 9) AutoHotkey (Windows automation scripting)

Repo: `AutoHotkey/AutoHotkey`

### What it already has

- Hotkeys/macros/remapping and Windows automation scripting.
- Excellent interactive scripting ergonomics for local operator workflows.
- Huge ecosystem of practical scripts.

### Usage example

```ahk
^!n::Run "notepad.exe"
^!h::Send "Hello from AHK!"
```

### Limits

- Windows only.

---

## 10) xdotool (X11 hacker CLI)

Repo: `jordansissel/xdotool`

### What it already has

- Extremely scriptable CLI for X11 mouse/keyboard/window control.
- Works very well in shell pipelines and one-liners.
- Window search/activate/resize, keystroke injection.

### Usage examples (from README style)

```bash
xdotool type "Hello world"
xdotool key ctrl+l
xdotool search "Mozilla Firefox" windowactivate --sync key --clearmodifiers ctrl+l
```

### Limits

- X11-centric; Wayland limitations are explicit in README.

---

## 11) Playwright Electron (for Electron apps you own/test)

Repo: `microsoft/playwright` (`docs/src/api/class-electron.md`)

### What it already has

- Electron app launch + control APIs from Playwright.
- Access to main process evaluation + renderer automation.
- Useful when app is Electron and you want Puppeteer-like flow.

### Usage example (from docs style)

```js
const { _electron: electron } = require("playwright");
const app = await electron.launch({ args: ["main.js"] });
const window = await app.firstWindow();
await window.click("text=Click me");
await app.close();
```

### Limits

- Explicitly marked **experimental** in docs.
- Only for Electron apps, not arbitrary native apps.

---

## 12) Reference stacks relevant to your target architecture

## Ghostty (`ghostty-org/ghostty`)

What they already do:

- macOS native UI tests (XCUITest targets in `macos/GhosttyUITests`)
- Linux Nix VM integration tests (`nix/tests.nix`)
- visual acceptance tests with screenshot diffing (`test/run.sh`)

Takeaway:

- Mature teams combine multiple methods (unit + native UI + VM/live + visual) rather than forcing one framework.

## UI-TARS-desktop (`bytedance/UI-TARS-desktop`)

What it already has:

- Local operator stack for computer/browser automation
- `@computer-use/nut-js` based local desktop operator
- Browser operator stack in same ecosystem

Takeaway:

- Good example of agentic runtime structure, but still backend-limited by platform/tool choices.

---

## Which existing tools best match a “hacker CLI” vibe?

If you optimize for immediate terminal scriptability:

- **Linux (X11):** `xdotool` + AT-SPI tools (for semantic checks)
- **macOS:** Hammerspoon + AX tooling + optional Appium Mac2 for formalized sessions
- **Windows:** AutoHotkey for raw scripting + UIA/Appium for semantic actions
- **Cross-platform Node:** `nut.js` as a practical baseline

Then add:

- trace logging,
- assertions,
- replay,
- semantic-first fallback chain,

…to build your own higher-power local agent runtime.

---

## Bottom line for your project

What already exists is enough to build a powerful system quickly, but not as one perfect product.

Most realistic architecture:

1. native backend per OS,
2. thin common CLI/event protocol,
3. semantic → vision → input fallback,
4. same runner for black-box and white-box modes,
5. first-class trace/replay for debugging.

That gives you the Puppeteer-like workflow feel while preserving full native power and transparency.

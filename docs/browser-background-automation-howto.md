# Background Browser Automation How-To

Use this note as context for future agents when the goal is to automate a logged-in browser without stealing focus from the user.

## 2026-06-09 Status

CuaDriver is now the preferred default for background browser GUI/visual automation on Arthur's Mac. Use this CDP note when the task needs browser protocol access: DOM JavaScript, network/API inspection, cookies, target/session management, or frontend provider adapters like `llm_frontend_browser`.

## Goal

Control a browser without bringing it to the foreground. Prefer CuaDriver for visible GUI interaction and CDP for protocol-level work. Do not use normal foreground browser automation unless the user explicitly asks to watch or interact manually.

## Recommended Setup

For CDP work, use a dedicated Chromium-family app/profile for automation. Helium worked well because it can run separately from the user's normal Chrome profile.

Preferred shape:

```bash
open -g -na "Helium" --args \
  --remote-debugging-port=9338 \
  --user-data-dir="$HOME/.pi/pi-web-access/helium-chatgpt-profile" \
  --no-first-run \
  --no-default-browser-check \
  about:blank
```

Important details:

- `-g` tells macOS not to bring the app to the foreground.
- `-n` opens a separate app instance.
- `-a "Helium"` chooses the app.
- `--remote-debugging-port=...` exposes CDP.
- `--user-data-dir=...` keeps cookies/session state in a dedicated automation profile.
- Use a separate port/profile per provider or task if needed.

Before launching, first check whether CDP is already alive:

```bash
curl -fsS http://127.0.0.1:9338/json/version >/dev/null
```

If it is already alive, do not launch again.

## CDP Pattern That Avoids Focus Stealing

Connect to the existing browser over CDP. Create tabs through the browser target with `Target.createTarget` and `background: true`.

```ts
import puppeteer from "puppeteer-core"

const browser = await puppeteer.connect({
  browserURL: "http://127.0.0.1:9338",
})

const browserTarget = browser.targets().find((target) => target.type() === "browser")
if (!browserTarget) throw new Error("No browser target")

const client = await browserTarget.createCDPSession()
const created = await client.send("Target.createTarget", {
  url: "https://chatgpt.com/",
  background: true,
})
await client.detach()

const target = await browser.waitForTarget(
  (candidate) => (candidate as any)._targetId === created.targetId,
  { timeout: 10_000 },
)
const page = await target.page()
```

When reusing an existing target, attach to it. Do not activate it.

```ts
const target = browser.targets().find((candidate) => {
  try {
    return new URL(candidate.url()).hostname === "chatgpt.com"
  } catch {
    return false
  }
})

const page = await target?.page()
```

## Actions To Avoid

These commonly bring the browser to the foreground or make focus behavior unpredictable:

- `page.bringToFront()`
- `Target.activateTarget`
- `Target.openDevTools`
- WebDriver BiDi `browsingContext.activate`
- `--auto-open-devtools-for-tabs`
- `browser.newPage()` when the page may become selected
- `open https://...` without `-g`
- `open -a "Chrome" ...` without `-g`
- `osascript -e 'tell application "Chrome" to activate'`
- AppleScript UI scripting for browser actions
- macOS Accessibility click/type automation for browser actions
- Playwright/Puppeteer `launch({ headless: false })` for an interactive browser unless the user accepts foreground launch
- Reusing the user's main Chrome profile for automation

## API Reversing Without DevTools UI

Do not open DevTools for network/API reversing. DevTools UI is just a CDP client; use CDP directly.

Passive monitoring APIs:

- `Network.requestWillBeSent`
- `Network.responseReceived`
- `Network.loadingFinished`
- `Network.getResponseBody`
- `Network.getRequestPostData`
- `Network.webSocketFrameReceived`
- `Network.webSocketFrameSent`

Active interception/filtering APIs:

- `Fetch.enable`
- `Fetch.requestPaused`
- `Fetch.continueRequest`
- `Fetch.failRequest`
- `Fetch.fulfillRequest`
- `Network.setBlockedURLs`

Minimal response recorder:

```ts
const cdp = await page.target().createCDPSession()
await cdp.send("Network.enable", {
  maxTotalBufferSize: 100_000_000,
  maxResourceBufferSize: 20_000_000,
})

const requests = new Map<string, any>()
cdp.on("Network.requestWillBeSent", (event) => {
  requests.set(event.requestId, {
    method: event.request.method,
    postData: event.request.postData,
    type: event.type,
    url: event.request.url,
  })
})
cdp.on("Network.responseReceived", (event) => {
  const req = requests.get(event.requestId)
  if (!req) return
  req.mimeType = event.response.mimeType
  req.status = event.response.status
})
cdp.on("Network.loadingFinished", async (event) => {
  const req = requests.get(event.requestId)
  if (!req) return
  if (!/\/api\/|graphql|json/i.test(`${req.url} ${req.mimeType ?? ""}`)) return
  const body = await cdp.send("Network.getResponseBody", { requestId: event.requestId }).catch(() => null)
  if (!body) return
  const responseBody = body.base64Encoded
    ? Buffer.from(body.body, "base64").toString("utf8")
    : body.body
  console.log({ ...req, responseBody })
})
```

For service-worker-heavy apps:

```ts
await cdp.send("Network.setBypassServiceWorker", { bypass: true })
```

## Safer Interaction Pattern

Prefer DOM and CDP input over OS-level UI input.

Use DOM evaluation for finding elements:

```ts
const buttonText = await page.evaluate(() => {
  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
  }

  const button = Array.from(document.querySelectorAll("button, a, [role='button']"))
    .find((el) => visible(el) && /send/i.test(el.getAttribute("aria-label") ?? el.textContent ?? ""))

  ;(button as HTMLElement | undefined)?.click()
  return button?.textContent ?? null
})
```

Use CDP text insertion instead of OS keyboard typing:

```ts
const client = await page.target().createCDPSession()
await client.send("Input.insertText", { text: prompt })
await client.detach()
```

`page.mouse.click(...)` and DOM `element.click()` can work through CDP without using the macOS foreground app, but use them only after attaching to a background target. Do not use Computer Use or Accessibility clicks for this browser if focus must remain untouched.

## Existing-Target Reuse Rule

If there is already a provider tab, reuse it in the background:

```ts
const existing = browser.targets().find((target) => {
  try {
    return new URL(target.url()).hostname === "chatgpt.com"
  } catch {
    return false
  }
})

if (existing) {
  const page = await existing.page()
  // Do work. Do not activate target.
}
```

Only create a new target if no suitable tab exists:

```ts
await client.send("Target.createTarget", {
  url: "https://chatgpt.com/",
  background: true,
})
```

## Practical Agent Prompt

Paste this into future agent context:

```text
When automating Chrome/Chromium, do not steal focus from my current app. Use a dedicated Chromium-family browser/profile and CDP.

Launch only if CDP is not already available:
open -g -na "Helium" --args --remote-debugging-port=9338 --user-data-dir="$HOME/.pi/pi-web-access/helium-chatgpt-profile" --no-first-run --no-default-browser-check about:blank

Connect with puppeteer-core using browserURL http://127.0.0.1:9338. Create tabs via the browser target's CDP session with Target.createTarget({ url, background: true }). Reuse existing provider tabs when present. Never call page.bringToFront(), Target.activateTarget, AppleScript activate, macOS Accessibility click/type, or open a URL without -g. Prefer DOM evaluation and CDP Input.insertText for interactions.
```

## Notes

- First-time login may still require visible/manual browser work. After login, reuse the same dedicated profile.
- If the browser is already in the foreground because the user brought it forward, CDP automation should not force it back or move focus elsewhere.
- Some sites keep generating in staged states like `Thinking` or `Finalizing answer`; do not treat short preambles as final responses.

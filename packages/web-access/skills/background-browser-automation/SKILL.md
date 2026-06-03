---
name: background-browser-automation
description: Background-safe browser automation guidance for Playwright, Puppeteer, Chrome DevTools Protocol, browser scraping, API reverse engineering, and network request inspection. Use when automating browsers or debugging web apps without stealing focus.
---

# Background Browser Automation

Use this skill when browser work must not disturb the human's current desktop.

## Decision tree

1. If the page can be fetched statically, prefer `web_search` or `fetch_content`.
2. If a visible browser is not required, use headless Playwright/Puppeteer.
3. If a logged-in or headed browser is required, connect to an existing guarded CDP browser/profile and create/reuse background targets.
4. If true isolation is required, use a separate user session, remote Linux browser worker, or VM. Do not rely on same-session macOS focus prevention.

## Hard rules

Do not use these unless the user explicitly asks to foreground a browser:

- `page.bringToFront()`
- CDP `Target.activateTarget`
- CDP `Target.openDevTools`
- WebDriver BiDi `browsingContext.activate`
- `--auto-open-devtools-for-tabs`
- macOS `open` without `-g`/`-j` for browser URLs/apps
- AppleScript `activate` for browser automation
- OS-level click/type automation when CDP/DOM APIs can do the job

If foreground browser control is explicitly intended, say so and use the local override:

```bash
AGENT_ALLOW_FOREGROUND_BROWSER=1 <command>
```

## CDP background tab pattern

Connect to the browser target and create pages in the background:

```ts
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9339" })
const browserTarget = browser.targets().find((target) => target.type() === "browser")
if (!browserTarget) throw new Error("No browser target")

const client = await browserTarget.createCDPSession()
const created = await client.send("Target.createTarget", {
  url: "https://example.com/",
  background: true,
})
await client.detach()

const target = await browser.waitForTarget(
  (candidate) => (candidate as any)._targetId === created.targetId,
  { timeout: 10_000 },
)
const page = await target.page()
```

Do not call `Target.activateTarget` after this.

## API reversing without DevTools UI

DevTools UI is just a CDP client. For network/API reversing, attach your own CDP session.

Useful passive events:

- `Network.requestWillBeSent`
- `Network.requestWillBeSentExtraInfo`
- `Network.responseReceived`
- `Network.responseReceivedExtraInfo`
- `Network.loadingFinished`
- `Network.getResponseBody`
- `Network.getRequestPostData`
- `Network.webSocketFrameReceived`
- `Network.webSocketFrameSent`

Useful active interception APIs:

- `Fetch.enable`
- `Fetch.requestPaused`
- `Fetch.continueRequest`
- `Fetch.failRequest`
- `Fetch.fulfillRequest`
- `Network.setBlockedURLs`

Minimal recorder:

```ts
const cdp = await page.target().createCDPSession()
await cdp.send("Network.enable", {
  maxTotalBufferSize: 100_000_000,
  maxResourceBufferSize: 20_000_000,
})
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true })

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

  try {
    const body = await cdp.send("Network.getResponseBody", { requestId: event.requestId })
    const text = body.base64Encoded
      ? Buffer.from(body.body, "base64").toString("utf8")
      : body.body
    console.log({ ...req, responseBody: text })
  } catch {
    // Redirects, preflights, cached responses, and opaque responses may not have bodies.
  }
})
```

For service-worker-heavy apps, consider:

```ts
await cdp.send("Network.setBypassServiceWorker", { bypass: true })
```

## Remote Ubuntu desktop note

A remote Ubuntu desktop is useful for isolation only if the agent controls the browser through Playwright/CDP over SSH or a stable service endpoint. VNC/RDP-style visual clicking is usually less reliable for LLM tools because latency, focus, resolution, clipboard, and window-manager state become part of the task. Prefer a remote CDP/Playwright worker over remote GUI clicks.

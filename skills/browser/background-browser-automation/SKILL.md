---
name: background-browser-automation
description: Background-safe browser automation guidance with CuaDriver first, plus Playwright/Puppeteer/CDP patterns for DOM, scraping, API reveng, and network request inspection. Use when automating browsers or debugging web apps without stealing focus.
---

# Background Browser Automation

Use this skill when browser work must not disturb the human's current desktop.

## Decision tree

1. If the page can be fetched statically, prefer `web_search` or `fetch_content`.
2. If a visible browser is not required, use headless Playwright/Puppeteer.
3. If a logged-in or headed browser must be controlled on Arthur's Mac, prefer CuaDriver via the `cua-driver` skill and the `computer_use` tool so the target window can be inspected and acted on without raising or stealing focus.
4. Use CDP/Playwright/Puppeteer or the OMP browser tool when the task specifically needs DOM execution, CDP network capture, cookies, protocol-level API reversing, frontend provider adapters such as `llm_frontend_browser`, Electron remote-debugging protocol truth, or replay debugging against an existing logged-in browser profile. The repo's Helium/CDP browser-use profile in `packages/browser-use` is one such CDP option.
5. If true isolation is required, use a separate user session, remote Linux browser worker, or VM. Do not rely on same-session macOS focus prevention.

## Local default

For visual/GUI browser automation, use CuaDriver through the `cua-driver` skill and the `computer_use` tool. CuaDriver owns the private macOS/SkyLight behavior; do not reimplement that in this repo.
Do not treat browser-use/Helium as the default for visual GUI control; reach for it only when the task is protocol-level work.

For protocol-level DOM/network/cookies/Electron remote-debugging work, use CDP/Playwright/Puppeteer or the OMP browser tool. The clean-room browser-use package in `packages/browser-use` is the local CDP option; it defaults to Helium on macOS, launches via `open -g -na`, and creates new tabs through CDP background targets.
Start or reuse the profile:

```bash
bun run browser-use:helium
```

Create a background tab:

```bash
bun run browser-use:helium -- https://example.com/
```

Then use the `browser_*` Pi tools from `packages/browser-use/index.ts` when available. For raw Puppeteer/CDP scripts, follow the background target pattern below.
## Electron app note

For Electron apps, prefer CuaDriver (`cua-driver` / `computer_use`) when the task involves native menus, settings dialogs, or any UI that is not rendered as a web page. Attach via CDP only after the app has been launched with remote debugging enabled and only when you need DOM, network, cookie, or protocol-level truth.

## Hard rules

Do not use these unless the user explicitly asks to foreground a browser:

- `page.bringToFront()`
- CDP `Target.activateTarget`
- CDP `Target.openDevTools`
- WebDriver BiDi `browsingContext.activate`
- `--auto-open-devtools-for-tabs`
- `browser.newPage()` when a background CDP target is possible
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

## SOP: Authenticated Profile Capture-and-Replay

Use this SOP when a site behaves differently once a real logged-in browser session has settled, or when headless/CDP-only automation can reach the page but cannot reproduce the successful authenticated request.

Applies to Helium, Chrome, and Firefox-profile-based work. The browser choice matters less than the winning pattern: reuse the already-authenticated profile, keep the browser running in background/non-headless mode, capture the exact successful request, then replay that request directly.

### 1. Start with the cheapest path

1. Try static fetches or headless/background CDP first when the task is clearly read-only and unauthenticated.
2. Stay headless-only if the site is already working and you can prove the needed DOM state, cookies, and network requests are present.
3. Switch to this SOP as soon as any of these appear:
   - the page only works after a human-login session or long-lived browser profile is reused
   - headless mode shows missing cookies, blank data, login loops, CAPTCHA/risk detours, or different request bodies
   - the visible app state settles but the equivalent headless replay keeps failing
   - you need to tell whether the blocker is request-payload drift or provider-side denial

### 2. Reuse the logged-in profile instead of re-automating login

1. Pick the browser/profile that already succeeds for the human: Helium, Chrome, or Firefox.
2. Reuse that profile/session in a background, non-headless browser launch. Do not foreground the window unless explicitly asked.
3. Treat the browser as the source of truth for cookies, local storage, service-worker state, feature flags, and post-login redirects.

### 3. Split tools by job

- Use CuaDriver when you need background visual/GUI/AX inspection: confirm that the right account is logged in, the right workspace is selected, a modal/banner/risk prompt is present, or the page has visibly finished settling.
- Use headed CDP when you need DOM execution, cookie/session inspection, request bodies, response bodies, initiators, and timing/network truth.
- Do not force one tool to do the other's job. CuaDriver answers “what state is the real UI in?”; headed CDP answers “what exactly was sent and returned?”.

### 4. Capture the exact successful request

1. Attach CDP to the already-running background browser/profile.
2. Enable passive network capture before the action that matters.
3. Use CuaDriver if needed to verify hidden/background UI state before the submit step.
4. Trigger the real workflow once in the authenticated browser.
5. Save the exact request that succeeds, including:
   - method and URL
   - headers as sent on the wire, especially auth, CSRF, origin, referer, and browser-client hints
   - post body or query payload
   - cookies/session context tied to the profile
   - response status, headers, and body
   - nearby precursor requests when the final request depends on freshly issued tokens, uploads, or draft/task ids

### 5. Save artifacts before you start guessing

Save enough evidence that another worker can continue without reopening the browser:

- raw network log or equivalent CDP event dump
- one normalized request/response summary for the winning request
- cookie/storage notes only when they are required for replay reasoning
- screenshot or CuaDriver-observed note for any visible blocker or settled UI state that matters
- the exact browser/profile used: Helium profile path, Chrome profile name/path, or Firefox profile name/path
- replay attempt notes that distinguish “captured browser request” from “hand-built variant”

### 6. Replay outside the browser

1. Reissue the captured request directly with the same method, URL, critical headers, cookies, and body.
2. Start from the closest possible replay to the captured browser request; do not simplify early.
3. Only after a matching replay exists should you reduce headers/body fields to find the minimal contract.
4. The goal is a direct request path that no longer depends on browser automation for the steady-state workflow.

### 7. Decide: payload parity bug or provider denial

Treat it as **payload parity** when:

- the browser-submitted request succeeds but direct replay fails
- response codes/messages change when you restore omitted headers, cookies, IDs, or nested body fields
- a hidden precursor artifact such as CSRF token, upload key, draft id, workspace id, or experiment flag is missing from replay

Treat it as **provider denial** when:

- the direct replay is byte-for-byte or semantically identical to the captured request and still fails
- replayed requests from the same authenticated session return explicit policy/risk/permission/account errors
- the browser itself starts failing with the same denial after capture, indicating the issue is no longer browser-state drift

If unsure, compare the captured browser request and replay attempt field by field until the remaining difference is only provider behavior, not your client.

### 8. Exit condition

This SOP is complete when you have either:

- a direct replay that reproduces the successful browser request without ongoing browser dependence, or
- a proof bundle showing that the remaining blocker is provider denial rather than missing request parity.

## Remote Ubuntu desktop note

A remote Ubuntu desktop is useful for isolation only if the agent controls the browser through Playwright/CDP over SSH or a stable service endpoint. VNC/RDP-style visual clicking is usually less reliable for LLM tools because latency, focus, resolution, clipboard, and window-manager state become part of the task. Prefer a remote CDP/Playwright worker over remote GUI clicks.

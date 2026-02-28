# Playwright vs Puppeteer vs DevTools/CDP stack (implementation report)

_Last updated: 2026-02-26_

## Repos pulled locally (vendor)

- `vendor/playwright` @ `4ce4c97a04259219935ecef79181350b1ae6243a`
- `vendor/puppeteer` @ `98dd158c404d0fb844657bab7b55e502ff5088ef`
- `vendor/chrome-devtools-mcp` @ `080bcf6f666b1b4ae350d43b8904ad9488fcae13`
- `vendor/devtools-frontend` @ `a718fd59205c847882992a8aec65f5e23ed93a7c`
- `vendor/devtools-protocol` @ `708011cf331866c59cf75dd80aaf368ec726d191`

---

## TL;DR answers to your direct questions

- **Does Playwright call Puppeteer for Chromium?**
  - **No.** Playwright has its own client/server protocol + Chromium transport/connection stack (`Connection`, `CRConnection`, `CRBrowser`).
- **Which has more official Electron support?**
  - **Playwright** (first-party Electron API), but explicitly marked **experimental**.
  - Puppeteer has no equivalent first-party Electron API surface in core (browser support type is `'chrome' | 'firefox'`).
- **Do these stacks use internal/private APIs?**
  - **chrome-devtools-mcp:** yes, it imports `puppeteer-core/internal/*` and DevTools frontend internals.
  - **Playwright:** uses patched browser builds (Firefox/WebKit) and custom protocols for those engines.
- **Can CDP be used in browser extensions?**
  - **Yes**, via `chrome.debugger`, but access is restricted to a subset of CDP domains and requires `"debugger"` permission.

---

## 1) What CDP is (in practice)

CDP (Chrome DevTools Protocol) is a structured RPC/event protocol organized by **domains** (Page, Network, Runtime, Target, Tracing, etc.).

Evidence:
- DevTools frontend protocol doc defines a **domain** as a group of CDP methods/events and explains backend **agents/handlers** implementing domains:
  - https://github.com/ChromeDevTools/devtools-frontend/blob/a718fd59205c847882992a8aec65f5e23ed93a7c/docs/devtools-protocol.md#L5-L25
- `devtools-protocol` repo is the protocol schema/types package (JSON/PDL/types), not the runtime browser implementation:
  - https://github.com/ChromeDevTools/devtools-protocol/blob/708011cf331866c59cf75dd80aaf368ec726d191/package.json#L1-L16
  - https://github.com/ChromeDevTools/devtools-protocol/blob/708011cf331866c59cf75dd80aaf368ec726d191/README.md#L1-L16

---

## 2) How Playwright is implemented

### Architecture

Playwright uses its own object-RPC protocol between client and server (`guid`, `method`, `params`, message ids), not Puppeteer’s API:
- Client connection message format + dispatch:
  - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/packages/playwright-core/src/client/connection.ts#L136-L205

For Chromium, Playwright directly manages CDP transport/connection internally:
- Connect-over-CDP implementation:
  - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/packages/playwright-core/src/server/chromium/chromium.ts#L79-L107
- Own Chromium connection/session stack (`CRConnection`, `CRSession`, `CDPSession`):
  - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/packages/playwright-core/src/server/chromium/crConnection.ts#L40-L238
- Playwright controls remote debugging pipe itself:
  - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/packages/playwright-core/src/server/chromium/chromium.ts#L303-L317

### API surfaces and limits

Playwright protocol vs CDP are explicitly different in docs:
- `BrowserType.connect` (Playwright protocol to Playwright-launched browser server):
  - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/docs/src/api/class-browsertype.md#L88-L103
- `connectOverCDP` is Chromium-only and lower fidelity:
  - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/docs/src/api/class-browsertype.md#L148-L163
- `BrowserContext.newCDPSession` is Chromium-only:
  - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/docs/src/api/class-browsercontext.md#L968-L975

### Browser-engine specifics (important)

Playwright Firefox/WebKit are not just stock branded binaries in the supported path:
- Firefox/Safari branded builds note (relies on patches):
  - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/docs/src/browsers.md#L584-L590
- Firefox launch path uses Juggler pipe:
  - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/packages/playwright-core/src/server/firefox/firefox.ts#L92-L116
- WebKit uses its own connection/session plumbing:
  - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/packages/playwright-core/src/server/webkit/wkConnection.ts#L69-L81

### Electron in Playwright

- Electron API exists and is first-party, but marked experimental:
  - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/docs/src/api/class-electron.md#L1-L6
- Supported Electron versions are explicitly documented:
  - https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/docs/src/api/class-electron.md#L43-L47

---

## 3) How Puppeteer is implemented

### Architecture

Puppeteer is primarily a CDP/BiDi client stack:
- Doc says Chrome/Firefox over DevTools Protocol or WebDriver BiDi:
  - https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/docs/guides/what-is-puppeteer.md#L1-L7
- Supported browser type is `'chrome' | 'firefox'`:
  - https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/packages/puppeteer-core/src/common/SupportedBrowser.ts#L7-L12
- Protocol options explicitly include `'cdp' | 'webDriverBiDi'`:
  - https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/packages/puppeteer-core/src/common/ConnectOptions.ts#L21-L22

Launcher behavior:
- Firefox defaults to BiDi and rejects CDP for Firefox:
  - https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/packages/puppeteer-core/src/node/BrowserLauncher.ts#L101-L107
- Chrome path can create direct CDP browser (`CdpBrowser._create`) or BiDi-over-CDP:
  - https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/packages/puppeteer-core/src/node/BrowserLauncher.ts#L196-L219

CDP transport implementation imports `devtools-protocol` types directly:
- https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/packages/puppeteer-core/src/cdp/Connection.ts#L7-L11
- https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/packages/puppeteer-core/src/cdp/Connection.ts#L147-L159

### API surfaces and limits

Extensions:
- Puppeteer has explicit extension guide.
- Limitation: cannot evaluate in content-script isolated world:
  - https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/docs/guides/chrome-extensions.md#L114
- Launch constraint for extension-path list in Chrome requires pipe mode:
  - https://github.com/puppeteer/puppeteer/blob/98dd158c404d0fb844657bab7b55e502ff5088ef/packages/puppeteer-core/src/node/BrowserLauncher.ts#L254-L258

Electron in Puppeteer:
- No first-party Electron browser target type in core (`SupportedBrowser` remains chrome/firefox).
- Long-running Electron support request still open:
  - https://github.com/puppeteer/puppeteer/issues/4283

---

## 4) How `chrome-devtools-mcp` is implemented

`chrome-devtools-mcp` is a composition layer over Puppeteer + DevTools frontend components.

Evidence:
- README explicitly states it uses DevTools frontend for performance insights and Puppeteer for automation:
  - https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/080bcf6f666b1b4ae350d43b8904ad9488fcae13/README.md#L14-L21
- Package dependencies include both `puppeteer` and `chrome-devtools-frontend`:
  - https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/080bcf6f666b1b4ae350d43b8904ad9488fcae13/package.json#L57-L66
- It re-exports `puppeteer-core` and imports internal Puppeteer modules (`puppeteer-core/internal/...`):
  - https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/080bcf6f666b1b4ae350d43b8904ad9488fcae13/src/third_party/index.ts#L30-L42
- Browser connect/launch is done through Puppeteer APIs:
  - https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/080bcf6f666b1b4ae350d43b8904ad9488fcae13/src/browser.ts#L60-L121
  - https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/080bcf6f666b1b4ae350d43b8904ad9488fcae13/src/browser.ts#L216-L231
- It adapts Puppeteer CDP sessions to DevTools CDPConnection interface:
  - https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/080bcf6f666b1b4ae350d43b8904ad9488fcae13/src/DevToolsConnectionAdapter.ts#L12-L66

Interpretation: `chrome-devtools-mcp` is not a protocol implementation from scratch; it is an integration layer that leans on Puppeteer transport + DevTools frontend logic.

---

## 5) `devtools-frontend` and `devtools-protocol` roles

### `devtools-frontend`

- Contains CDP client interfaces (`send`, event observers):
  - https://github.com/ChromeDevTools/devtools-frontend/blob/a718fd59205c847882992a8aec65f5e23ed93a7c/front_end/core/protocol_client/CDPConnection.ts#L62-L76
- Transport can be embedder-host bridge (`sendMessageToBackend`) or websocket mode:
  - https://github.com/ChromeDevTools/devtools-frontend/blob/a718fd59205c847882992a8aec65f5e23ed93a7c/front_end/core/sdk/Connections.ts#L43-L49
  - https://github.com/ChromeDevTools/devtools-frontend/blob/a718fd59205c847882992a8aec65f5e23ed93a7c/front_end/core/sdk/Connections.ts#L230-L243
- MCP entrypoint is explicitly for `chrome-devtools-mcp`:
  - https://github.com/ChromeDevTools/devtools-frontend/blob/a718fd59205c847882992a8aec65f5e23ed93a7c/mcp/README.md#L1-L7
- E2E tests note DevTools frontend over CDP and Puppeteer usage:
  - https://github.com/ChromeDevTools/devtools-frontend/blob/a718fd59205c847882992a8aec65f5e23ed93a7c/test/e2e/README.md#L1-L4

### `devtools-protocol`

- Protocol definition/types package (`json`, `pdl`, `types`):
  - https://github.com/ChromeDevTools/devtools-protocol/blob/708011cf331866c59cf75dd80aaf368ec726d191/package.json#L4-L14
- PDL includes browser domains (e.g., Network/Page/Tracing):
  - https://github.com/ChromeDevTools/devtools-protocol/blob/708011cf331866c59cf75dd80aaf368ec726d191/pdl/browser_protocol.pdl#L42-L56
- JS/V8 PDL includes domains like Debugger/Runtime:
  - https://github.com/ChromeDevTools/devtools-protocol/blob/708011cf331866c59cf75dd80aaf368ec726d191/pdl/js_protocol.pdl#L63-L64
  - https://github.com/ChromeDevTools/devtools-protocol/blob/708011cf331866c59cf75dd80aaf368ec726d191/pdl/js_protocol.pdl#L1039-L1040
- Auto-roll script pulls PDLs from Chromium/V8 and regenerates JSON/types:
  - https://github.com/ChromeDevTools/devtools-protocol/blob/708011cf331866c59cf75dd80aaf368ec726d191/scripts/update-to-latest.sh#L29-L52
- `protocol-mapping.d.ts` is auto-generated:
  - https://github.com/ChromeDevTools/devtools-protocol/blob/708011cf331866c59cf75dd80aaf368ec726d191/types/protocol-mapping.d.ts#L6-L13

---

## 6) Internal/private API usage and risk profile

- **Playwright**: mostly owns its stack; for Firefox/WebKit it relies on patched browser builds and custom channels/protocols.
- **Puppeteer**: public API surface around CDP/BiDi; core implementation depends on devtools-protocol typings and @puppeteer/browsers.
- **chrome-devtools-mcp**: imports `puppeteer-core/internal/*` (internal modules), which is powerful but can be more brittle across Puppeteer internal refactors.

---

## 7) Can CDP be used in browser extensions?

Yes, via `chrome.debugger` (official transport for remote debugging protocol from extensions), with caveats:

- Requires manifest permission `"debugger"`.
- Access is restricted to specific CDP domains (not full CDP surface).
- Commands/events are routed via `sendCommand`/`onEvent` using tab-targeted debuggee IDs.

Official docs:
- `chrome.debugger` reference: https://developer.chrome.com/docs/extensions/reference/api/debugger
- Restricted domains section: https://developer.chrome.com/docs/extensions/reference/api/debugger#restricted-domains
- Permissions section: https://developer.chrome.com/docs/extensions/reference/api/debugger#permissions

Local parsed domain snapshot (from that page):
- `test-output/research-cache/chrome-debugger-restricted-domains-2026-02-26.json` (27 domains)

Also relevant operational limitation:
- Chrome security changes for remote debugging flags (`--remote-debugging-port/pipe`) with default profile restrictions from Chrome 136 onward:
  - https://developer.chrome.com/blog/remote-debugging-port

---

## 8) Practical API limitations to keep in mind

- **Playwright over CDP**: explicitly lower fidelity than Playwright protocol (`BrowserType.connect`).
- **Playwright CDP session**: Chromium-only.
- **Playwright Electron**: first-party but experimental.
- **Puppeteer extensions**: cannot evaluate in content-script isolated world.
- **CDP in extensions (`chrome.debugger`)**: restricted domain subset.
- **Remote debugging port security posture**: increasingly strict around profile isolation.

---

## 9) Suggested learning path (highest leverage)

If you want deep control with minimal confusion, learn in this order:

1. **CDP fundamentals**
   - Domain model, command/request IDs, events, session IDs (`Target.attachToTarget`).
2. **Target/session model**
   - Browser target vs page targets, child sessions, auto-attach behavior.
3. **Runtime/Page/DOM/Network/Input/Emulation** domains
   - Most day-to-day automation + debugging work lives here.
4. **Tracing/Performance/Profiler**
   - For perf diagnostics and timeline-level introspection.
5. **Framework-specific protocol layers**
   - Playwright protocol (higher-level model) vs raw CDP in Puppeteer.
6. **WebDriver BiDi**
   - Especially if you need cross-browser standardization trajectory.

---

## Final direct answer on “does Playwright call Puppeteer for Chromium?”

No. Playwright has its own transport, RPC model, and Chromium connection/session implementation. It may share historical lineage and occasionally copy specific utility typings/snippets (e.g. some BiDi third-party files note upstream Puppeteer origin), but Chromium automation in Playwright is not implemented by calling Puppeteer APIs.

Example of copied upstream note (not runtime dependency):
- https://github.com/microsoft/playwright/blob/4ce4c97a04259219935ecef79181350b1ae6243a/packages/playwright-core/src/server/bidi/third_party/bidiCommands.d.ts#L8

# Electron App CDP Runbook

## When to use this

Use CDP against an Electron app only for setup/debug UI tasks, such as:

- Navigating the app’s built-in web UI to configure settings or accounts.
- Inspecting DOM state during automation development.
- Capturing network/console logs for debugging.

For routine bot operations, use the app’s official API (REST, Gateway, SDK, etc.).

## Launch an Electron app with CDP

Most Electron apps can be launched with a remote debugging port:

```bash
/Applications/MyApp.app/Contents/MacOS/MyApp --remote-debugging-port=9222
```

Examples:

```bash
# Discord
/Applications/Discord.app/Contents/MacOS/Discord --remote-debugging-port=9222

# Slack
/Applications/Slack.app/Contents/MacOS/Slack --remote-debugging-port=9222

# VS Code
/Applications/Visual\ Studio\ Code.app/Contents/MacOS/Electron --remote-debugging-port=9222
```

Close the app normally first if it is already running. The flag only takes effect at launch.

Wait for the app to fully load and let the user log in if needed.

## Verify the CDP endpoint

Use a simple HTTP check to confirm CDP is listening:

```bash
bun --eval 'fetch("http://127.0.0.1:9222/json").then(async r=>console.log(JSON.stringify(await r.json(), null, 2))).catch(e=>console.error(e.message))'
```

You should see a JSON array of target pages.

## Connect with agent-browser

```bash
agent-browser connect 9222
agent-browser get url
agent-browser snapshot -i
```

## Connect with packages/browser-use

```bash
PI_BROWSER_USE_PORT=9222 bun packages/browser-use/index.ts
```

Or set `browserPath` to the app binary and pass the port.

## Important caveats

- Some apps may show a human-verification step on login or unusual activity. Stop and ask the user to complete it.
- CDP events are browser-level synthetic input, which is closer to real interaction than DOM mutation, but still automation.
- Do not use this path to bypass CAPTCHA, rate limits, or terms of service.
- When finished, quit the debug instance and relaunch it normally if you want a clean session.

## Alternatives

- **CuaDriver**: for Electron/native apps when you cannot or do not want to relaunch with a debug port.
- **Official APIs**: for routine bot operations, messaging, or data access.

## References

- `docs/plans/browser-control-patterns.md`
- `skill://browser-control`
- The `browser-control` skill is registered in `packages/web-access/package.json`; `skill://` URLs will resolve in a fresh OMP session/reload, not in the current cached session.

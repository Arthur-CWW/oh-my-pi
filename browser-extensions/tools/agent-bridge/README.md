# Browser Context Native Host

## Cutover operation

The tool is only the Native Messaging transport between the browser extension and the Primer browser-context daemon. Start the daemon so its Unix socket exists, then install the native-host manifest for each browser in use:

```bash
pnpm --filter @browser-extensions/agent-bridge install:chrome
pnpm --filter @browser-extensions/agent-bridge install:firefox
```

The installers register `com.agent.browser_context` in the macOS per-user Chrome and Firefox `NativeMessagingHosts` directories. Each manifest points to the absolute executable at `bin/agent-browser-context-host`. Restart the browser after installing or changing a manifest.

The host connects to `$HOME/state/browser-context/browser-context.sock`. Override that path for both browser launches and manual diagnosis with `PRIMER_BROWSER_CONTEXT_SOCKET=/absolute/path.sock`, or invoke the launcher with `--socket /absolute/path.sock`. The command-line setting takes precedence over the environment.

## Security

The host has no HTTP listener, storage, queue, tab-management command surface, or persistence. It validates each extension-to-daemon client frame and daemon-to-extension server frame against protocol v1, then forwards the original length-prefixed bytes without inspecting tab domains or retaining frame data. Zero-length, larger-than-1 MiB, truncated, malformed-JSON, invalid-UTF-8, and schema-invalid frames terminate the connection without forwarding the rejected frame. Writes wait for stream completion so a slow peer applies backpressure.

Before connecting, the host requires the socket to be a real Unix socket owned by the current user, with owner read/write access and no group or other permissions. It verifies the same socket still exists after connecting. The install script makes each `NativeMessagingHosts` directory mode `0700` and each manifest mode `0600`. Chrome is restricted to `chrome-extension://hlekmadcbjbjmhlmoadmceepfbeppkmo/`; Firefox is restricted to `tab-inbox@agent.local`. Standard output is reserved exclusively for Native Messaging frames; diagnostics go to standard error.

## Troubleshooting

- **Browser reports that the native host is missing:** rerun the matching install command, restart the browser, and confirm the repository has not moved since installation. The manifest path must remain the absolute path to the executable launcher.
- **Launcher reports that Bun is unavailable:** install Bun at `$HOME/.bun/bin/bun`, `/opt/homebrew/bin/bun`, or `/usr/local/bin/bun`, or set `BUN_BIN` to an executable absolute path in the browser environment before launching it.
- **Socket is missing or rejected:** start the Primer browser-context daemon, confirm the configured path matches, and ensure the socket is owned by the current user with mode `0600`.
- **Connection closes after a frame:** update the extension, protocol package, host, and daemon together. A truncated, oversized, malformed, wrong-direction, or protocol-invalid frame is intentionally fatal; there is no HTTP or persistence fallback.
- **Manual host diagnosis:** run `browser-extensions/tools/agent-bridge/bin/agent-browser-context-host --socket /absolute/path.sock`. Do not print anything to its standard output or feed newline-delimited JSON; input and output use 4-byte little-endian length-prefixed JSON frames.

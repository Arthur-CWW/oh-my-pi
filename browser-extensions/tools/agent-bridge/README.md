# Agent Bridge

Placeholder for a local daemon/CLI that lets agents consume browser API captures without driving the browser with Puppeteer/Playwright.

Planned responsibilities:

- Receive captures from extensions over localhost HTTP/WebSocket.
- Store capture sessions locally.
- Redact sensitive headers/cookies by default.
- Expose query APIs for Pi/LLM agents.
- Build replay recipes from observed internal API calls.
- Attach to Chrome/Helium via raw CDP and Firefox via BiDi where useful.

This belongs in `tools/` instead of `extensions/` because it is a local process, not browser-shipped code.

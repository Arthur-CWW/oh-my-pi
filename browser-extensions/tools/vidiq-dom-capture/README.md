# vidIQ DOM Capture

Captures vidIQ-injected DOM from a live YouTube tab through Chrome DevTools Protocol.

This is a reference capture tool only. It writes DOM snapshots for inspection and does not import vidIQ code into our clean-room extension.

## Usage

Launch Chrome with a remote debugging port and the profile where vidIQ is installed:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222
```

Open a YouTube watch page, then run:

```bash
pnpm capture:vidiq-dom
```

Snapshots are written under:

```text
/Users/arthur/projects/browser-extensions/reverse-engineering/vidiq-vision/captures/dom
```

Environment options:

- `CHROME_CDP_URL` defaults to `http://127.0.0.1:9222`.
- `VIDIQ_CAPTURE_URL_MATCH` defaults to `youtube.com/watch`.
- `VIDIQ_CAPTURE_LIMIT` defaults to `80`.
- `VIDIQ_CAPTURE_OUT_DIR` overrides the output directory.

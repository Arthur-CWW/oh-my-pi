# Testing Browser Extensions

## What is reliable in CI/local checks

Use static and build-level checks as the default:

```bash
pnpm check
```

This verifies:

- TypeScript types.
- Vite build output.
- Manifest references in `dist/`.
- Package/zip creation when requested.

## Why full browser smoke tests are annoying

Background browser smoke tests for unpacked extensions are brittle on macOS because:

- `open` may forward to an existing app instance if the app refuses true multi-instance behavior.
- Chrome stable ignores or restricts some extension-related flags.
- DevTools auto-open creates visible windows unless carefully quarantined.
- Headless modes often do not behave like a normal extension environment.

So the default `check` should not require a live browser.

## Manual smoke path

For the current DevTools prototype:

```bash
cd /Users/arthur/projects/browser-extensions
pnpm launch:helium:x-bookmarks
```

Then:

1. Open or reload `https://x.com/i/bookmarks`.
2. Open DevTools if it is not already open.
3. Select the **X Bookmarks** panel.
4. Confirm captures appear after X/Twitter API responses finish.

## Future automated smoke direction

Prefer a dedicated automation browser bundle/profile plus CDP/BiDi. Avoid Playwright/Puppeteer for the final agent-facing implementation, but a raw-CDP smoke helper is acceptable because it exercises the same transport we plan to use.

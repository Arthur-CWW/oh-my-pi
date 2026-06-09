# Slotok Workbench

Local-first review workbench for Slotok video-understanding evals and future remix pipeline runs.

## QA Commands

From the repo root:

```bash
bun run slotok:typecheck
bun run slotok:test
bun run slotok:smoke
bun run slotok:build
cd apps/slotok-workbench && bun run visual:qa
```

`visual:qa` starts the local daemon and Vite renderer if needed, drives the UI with Playwright, and writes proof artifacts:

- `docs/qa/slotok-visual-qa.md` — QA report and pass/fail findings
- `artifacts/slotok-visual-qa/latest/*.png` — screenshots
- `artifacts/slotok-visual-qa/latest/videos/reviewer-walkthrough.webm` — video walkthrough

For manual testing:

```bash
bun run slotok:daemon
cd apps/slotok-workbench && bun run dev:renderer
```

Then open:

```txt
http://127.0.0.1:47521/ugc-studio/
```

For UI/UX changes, the review artifact should prove the behavior, not just prove that the process exited. Prefer a short recorded walkthrough plus screenshots and assertions that cover the changed workflow.

# UGC Studio Multi-View Demo QA

Date: 2026-06-09

## Claim

`/ugc-studio/` now demonstrates the main UGC Studio workspace views instead of only a single ad-canvas/timeline editor.

Local URL during QA:

- `http://127.0.0.1:47521/ugc-studio/`

Implemented focus modes:

- Persona Atlas
- Exploration Board
- Batch Review Player
- Campaign Branch Map
- Reference Profile Remix
- Final Layer Editor
- Developer Graph

## Proof Artifacts

Screenshots:

- `docs/qa/ugc-studio-multiview-demo/01-persona-atlas.png`
- `docs/qa/ugc-studio-multiview-demo/02-exploration-board.png`
- `docs/qa/ugc-studio-multiview-demo/03-batch-review.png`
- `docs/qa/ugc-studio-multiview-demo/04-campaign-map.png`
- `docs/qa/ugc-studio-multiview-demo/05-reference-remix.png`
- `docs/qa/ugc-studio-multiview-demo/06-final-editor.png`
- `docs/qa/ugc-studio-multiview-demo/07-developer-graph.png`

Walkthrough video:

- `docs/qa/ugc-studio-multiview-demo/reviewer-walkthrough.webm`

## Commands Run

```bash
bun run slotok:typecheck
bun run slotok:test
bun run slotok:build
```

All passed.

Screenshot command:

```bash
mkdir -p docs/qa/ugc-studio-multiview-demo
bun - <<'BUN'
import { chromium } from 'playwright';
const base = 'http://127.0.0.1:47521/ugc-studio/';
const outDir = '/Users/arthur/agents/web-access/docs/qa/ugc-studio-multiview-demo';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
await page.goto(base, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${outDir}/01-persona-atlas.png`, fullPage: true });
const clicks = [
  ['Exploration Board', '02-exploration-board.png'],
  ['Batch Review Player', '03-batch-review.png'],
  ['Campaign Branch Map', '04-campaign-map.png'],
  ['Reference Profile Remix', '05-reference-remix.png'],
  ['Final Layer Editor', '06-final-editor.png'],
  ['Developer Graph', '07-developer-graph.png'],
];
for (const [label, file] of clicks) {
  await page.getByRole('button', { name: new RegExp(label) }).first().click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${outDir}/${file}`, fullPage: true });
}
await browser.close();
BUN
```

Video command:

```bash
bun - <<'BUN'
import { chromium } from 'playwright';
const outDir = '/Users/arthur/agents/web-access/docs/qa/ugc-studio-multiview-demo';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  recordVideo: { dir: outDir, size: { width: 1440, height: 960 } },
});
const page = await context.newPage();
await page.goto('http://127.0.0.1:47521/ugc-studio/', { waitUntil: 'networkidle' });
for (const label of ['Exploration Board', 'Batch Review Player', 'Campaign Branch Map', 'Reference Profile Remix', 'Final Layer Editor', 'Developer Graph', 'Persona Atlas']) {
  await page.getByRole('button', { name: new RegExp(label) }).first().click();
  await page.waitForTimeout(650);
}
const video = page.video();
await page.close();
await context.close();
await browser.close();
console.log(await video?.path());
BUN
```

## Findings

Pass:

- Default view is Persona Atlas, not the final timeline editor.
- Left sidebar has workspace, campaign, library, and developer sections.
- Right inspector has Creative and JSON modes.
- Reference Profile Remix view exposes preserve/swap/blocked fields for clean-room profile remixing.
- Final Layer Editor and Developer Graph exist as focus modes rather than default surfaces.
- Persistent command bar appears across views.

Known V1 limitations:

- Persona Atlas and Campaign Map are fixture-light; they need more cards/nodes to feel as rich as the generated design references.
- Visual media previews are placeholder gradients, not real video thumbnails.
- Reference-profile archive/decomposition is modeled only; no live TikTok/profile capture is implemented.

# UGC Studio Figma Demo QA

Date: 2026-06-09

## Claim

The new `/ugc-studio/` demo presents a Figma-like AI UGC workspace with an open canvas, floating prompt/workspace controls, modal secondary menus, selectable vertical ad artboards, and a visible video layer timeline.

## Proof Artifacts

- Main workspace screenshot: `docs/qa/ugc-studio-figma-demo/ugc-studio-1440.png`
- Layers modal screenshot: `docs/qa/ugc-studio-figma-demo/ugc-studio-layers-1440.png`

## Commands

```bash
bun run slotok:typecheck
bun run slotok:test:update
bun run dev:renderer
bunx playwright screenshot --viewport-size=1440,1000 http://127.0.0.1:47521/ugc-studio/ docs/qa/ugc-studio-figma-demo/ugc-studio-1440.png
bun -e "const { chromium } = await import('playwright'); const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto('http://127.0.0.1:47521/ugc-studio/'); await page.getByRole('button', { name: 'Layers' }).first().click(); await page.screenshot({ path: 'docs/qa/ugc-studio-figma-demo/ugc-studio-layers-1440.png', fullPage: true }); await browser.close();"
```

## Result

- Typecheck passed.
- Snapshot tests passed with one new `UgcStudio` snapshot.
- Visual proof captured for the default workspace modal and the layer-stack modal.

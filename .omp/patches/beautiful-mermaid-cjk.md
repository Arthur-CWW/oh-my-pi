# beautiful-mermaid CJK and emoji display width

## Kind

Dependency patch. Keep as a traditional patch against `beautiful-mermaid@1.1.3`.

## Target files

Global Bun install after upstream OMP install/update:

- `~/.bun/install/global/node_modules/beautiful-mermaid/dist/index.js`
- package source files under `~/.bun/install/global/node_modules/beautiful-mermaid/src/ascii/`
- `~/.bun/install/global/node_modules/beautiful-mermaid/src/text-metrics.ts`

Repo-owned patch file:

- `.omp/agent/patches/beautiful-mermaid@1.1.3.patch`

## Behavior contract

Mermaid ASCII rendering must account for grapheme display width, not JavaScript string length.

Required behavior:

1. CJK/fullwidth characters occupy two terminal cells.
2. Emoji presentation characters occupy two terminal cells.
3. ZWJ emoji clusters occupy two terminal cells as a cluster.
4. Variation-selector-16 emoji presentations are treated as width two.
5. Box layout, label centering, edge labels, actor boxes, class/entity boxes, sequence notes, legends, and chart axes use display width.
6. Canvas writes preserve wide-character placeholder cells so borders and text do not overwrite half of a wide glyph.

## Verification

Fast marker check:

- `dist/index.js` contains `WIDE_PAD`, `graphemeSegmenter`, and `displayWidth`.

Behavioral smoke shape:

- Render a Mermaid graph with a CJK node label and an ASCII node label.
- Confirm borders do not overlap the CJK glyphs and connected edges remain aligned.

## Maintenance note

This patch is version-locked to `beautiful-mermaid@1.1.3`. If upstream OMP bumps `beautiful-mermaid`, first check whether the new package already has equivalent width-aware rendering. If it does, delete this overlay. If it does not, regenerate the patch against the new package version.

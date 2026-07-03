# Legacy OMP self-heal patches

These repo-owned patch artifacts are retained as history for the retired upstream-install overlay model. The active `mise run omp-install` path now builds and installs Arthur's `~/agents/oh-my-pi` fork directly and does not apply these patches. If the upstream-download path is ever needed for archaeology, use `mise run omp-install-upstream-legacy` explicitly.

## beautiful-mermaid CJK width patch

- Patch: `beautiful-mermaid@1.1.3.patch`
- Target: global Bun install `beautiful-mermaid/dist/index.js`
- Purpose: CJK/emoji grapheme-aware display widths for Mermaid ASCII output.

This patch is version-locked to `beautiful-mermaid@1.1.3`. If upstream OMP bumps `beautiful-mermaid`, `omp-self-heal` may fail visibly during `omp update`. When that happens:

1. Check whether the new `beautiful-mermaid` already includes CJK-aware width handling (`WIDE_PAD`, `displayWidth`, or equivalent grapheme-aware logic).
2. If not, regenerate this patch against the new package version before relying on Mermaid ASCII output.

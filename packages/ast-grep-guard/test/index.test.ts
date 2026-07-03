import { describe, expect, it } from "bun:test"
import { resolve } from "node:path"
import {
  buildAstGrepScanPlan,
  extractChangedPathCandidates,
  filterTouchedCodePaths,
  formatAstGrepAdvisory,
  isStaticSlopGuardrailRule,
  parseAstGrepFindings,
} from "../src/index"

const repoRoot = resolve(import.meta.dir, "../../..")

describe("ast-grep guard helpers", () => {
  it("extracts changed paths from write and edit result shapes", () => {
    const paths = extractChangedPathCandidates(
      { path: "packages/ast-grep-guard/src/index.ts" },
      { perFileResults: [{ meta: { path: "packages/ast-grep-guard/test/index.test.ts" } }] },
    )

    expect(paths).toContain("packages/ast-grep-guard/src/index.ts")
    expect(paths).toContain("packages/ast-grep-guard/test/index.test.ts")
  })

  it("keeps touched code files inside the repo only", () => {
    const paths = filterTouchedCodePaths(
      [
        "packages/ast-grep-guard/src/index.ts",
        "workflows/tiktok-recreate/workflow.js",
        "scripts/verify-decomposition-v2-schema.py",
        "vendor/vercel/agent-skills/vercel-react-best-practices/SKILL.md",
        "https://example.com/file.ts",
        "/tmp/elsewhere.ts",
      ],
      repoRoot,
      repoRoot,
    )

    expect(paths).toEqual([
      resolve(repoRoot, "packages/ast-grep-guard/src/index.ts"),
      resolve(repoRoot, "workflows/tiktok-recreate/workflow.js"),
      resolve(repoRoot, "scripts/verify-decomposition-v2-schema.py"),
    ])
  })

  it("builds a local/global scan plan with runtime versions", () => {
    const slotokFile = resolve(repoRoot, "apps/slotok-workbench/src/renderer/ReactUgcStudio.tsx")
    const plan = buildAstGrepScanPlan(repoRoot, repoRoot, [slotokFile])

    expect(plan).not.toBeNull()
    expect(plan?.ruleDirs.some((dir) => dir.endsWith("tools/ast-grep/rules"))).toBe(true)
    expect(plan?.runtime.reactVersions).toContain("^19.2.7")
  })

  it("formats parsed findings as a concise advisory", () => {
    const findings = parseAstGrepFindings(
      '{"ruleId":"smoke","file":"packages/ast-grep-guard/src/index.ts","message":"demo finding","range":{"start":{"line":0}}}\n',
    )
    const plan = buildAstGrepScanPlan(repoRoot, repoRoot, [resolve(repoRoot, "packages/ast-grep-guard/src/index.ts")])

    if (!plan) expect.unreachable()
    expect(formatAstGrepAdvisory(findings, plan)).toContain("smoke packages/ast-grep-guard/src/index.ts:1 demo finding")
  })

  it("labels static slop guardrail findings in edit advisories", () => {
    const findings = parseAstGrepFindings(
      '{"ruleId":"no-react-static-markup-ui-tests","file":"apps/slotok-workbench/src/renderer/design-system/workbench.test.tsx","message":"Avoid testing React UI by rendering raw HTML strings","range":{"start":{"line":58}}}\n',
    )
    const plan = buildAstGrepScanPlan(repoRoot, repoRoot, [
      resolve(repoRoot, "apps/slotok-workbench/src/renderer/design-system/workbench.test.tsx"),
    ])

    if (!plan) expect.unreachable()
    expect(isStaticSlopGuardrailRule("no-react-static-markup-ui-tests")).toBe(true)
    expect(isStaticSlopGuardrailRule("smoke")).toBe(false)
    expect(formatAstGrepAdvisory(findings, plan)).toContain(
      "no-react-static-markup-ui-tests [static slop guardrail] apps/slotok-workbench/src/renderer/design-system/workbench.test.tsx:59",
    )
  })
})

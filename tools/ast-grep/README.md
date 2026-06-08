# Unsafe top-type lint

This ast-grep setup is a guardrail for LLM-friendly code. Drop new rules in `tools/ast-grep/rules/` and `bun run lint` will pick them up automatically. The existing unsafe-top-type rules are ratcheted because the repo already has legacy findings; new rule families should normally run strict from day one.

Core TypeScript/Python should not spread `any`, `unknown`, or `Any` through the codebase.

## Policy

- Core code uses concrete named types.
- External API/process/file inputs are decoded at the boundary, then exported as typed values.
- DB access either uses generated/inferred row types, or decodes rows in the repository layer.
- Boundary code lives in clearly named paths/files: `external/`, `clients/`, `db/`, `schemas/`, `*.boundary.ts`, `*.external.ts`, `*.schema.ts`, `*.boundary.py`, `*_schema.py`, etc.

Use a one-line `ast-grep-ignore` only for narrow, justified exceptions. This lint deliberately makes raw IO locations easy to grep/review; it does not prove a boundary decoded correctly by itself.

## Commands

```bash
bun run lint                               # all lint guardrails + ast-grep rule tests
bun run lint:ast-grep                      # strict ast-grep rules except ratcheted unsafe-types
bun run lint:ast-grep:tests                # require tests for each rule, then run rule tests
bun run lint:unsafe-types                  # ratcheted check on git-tracked TS/Python
bun run lint:unsafe-types:update-baseline  # refresh known legacy findings after cleanup
bun run lint:unsafe-types:strict           # fail on every current tracked unsafe-type finding
bun run lint:unsafe-types:rules            # test the ast-grep rules
```

The baseline exists so the lint can be wired into `bun run check` without requiring a repo-wide cleanup first. Delete the baseline or use the strict command once legacy findings are gone.

# vendor/ast-grep

This is a **small vendored snapshot** of upstream `ast-grep`, kept locally as a reference for rule syntax and testing semantics when maintaining this repo's ast-grep guardrails.

Upstream repository:
- https://github.com/ast-grep/ast-grep

Why this is a snapshot instead of a full checkout:
- the full upstream working tree is very large in this environment
- for this repo we mainly need local rule/schema/reference material, not the entire project history/build output

Included reference material:
- `README.md`
- `CHANGELOG.md`
- `schemas/yaml_rule.json`
- selected config / rule / verify source files under `crates/*`

Refresh workflow:
1. clone/pull upstream temporarily
2. copy the relevant docs/schema/source files into this snapshot
3. keep this vendored copy read-only unless the repo task explicitly targets ast-grep rule maintenance

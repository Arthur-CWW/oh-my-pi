# Lawful Reverse Engineering Lab Plan

## Purpose

Create a local, opt-in lab for interoperability, migration, debugging, education, and authorized security research. The lab is not a decompilation service and is not a way to clone proprietary products, bypass license/DRM/auth controls, or extract assets.

## Hard guardrails

Allowed targets only:

- software, files, devices, or databases owned by the user
- open-source projects where the license permits the planned inspection/reuse
- binaries or protocols with explicit written permission, a contract, or a compatible bug-bounty scope
- file formats and protocols analyzed for interoperability or security research
- generated fixtures and public standards

Out of scope:

- proprietary decompilation without permission
- product cloning or copying protected UI/assets/workflows
- license, activation, DRM, paywall, account, anti-cheat, or rate-limit bypass
- private API replay without permission
- extracting or redistributing proprietary assets
- malware execution outside an explicitly isolated and authorized environment

## Lab artifacts

Every lab run should produce a small, auditable bundle:

```txt
lab-run/
  authorization.md
  target-inventory.json
  observations.md
  clean-room-spec.md
  fixtures/
  fixture-manifest.json
  implementation-notes.md
  validation-report.md
  disclosure.md
```

Artifact roles:

- `authorization.md`: target name, owner, permission basis, date, allowed methods, forbidden methods, and intended output.
- `target-inventory.json`: sample paths, hashes, source URLs when applicable, versions, licenses, and redistribution status.
- `observations.md`: factual behavior notes only: inputs, outputs, schemas, symbols, state transitions, errors, timings, and hypotheses clearly labeled.
- `clean-room-spec.md`: neutral behavior/specification document suitable for implementation by someone who did not inspect protected internals.
- `fixtures/`: owned, generated, open-licensed, or explicitly redistributable samples only.
- `fixture-manifest.json`: fixture provenance, generation recipe, license, and whether it may be committed.
- `implementation-notes.md`: how the implementation follows the clean-room spec; no proprietary code snippets or protected strings unless license permits.
- `validation-report.md`: local validation matrix and edge cases exercised.
- `disclosure.md`: security-impact summary, affected versions, contact path, embargo date, and publication status when vulnerabilities are found.

## Workflow

### Phase 0: Intake and refusal gate

1. Identify the target and requested output.
2. Classify the permission basis: owned, open source, explicit permission, or public interoperable format/protocol.
3. Reject or narrow requests involving decompilation of proprietary software, license/DRM/auth bypass, product cloning, asset extraction, or unauthorized private APIs.
4. Create `authorization.md` before any target inspection.

Exit criteria:

- Target and permission basis are written down.
- Allowed and forbidden techniques are explicit.
- Samples have a lawful source.

### Phase 1: Inventory

1. Copy only permitted samples into a lab input area.
2. Record hash, version, origin, license, and redistribution status in `target-inventory.json`.
3. Mark sensitive samples as local-only and exclude them from committed fixtures.
4. Prefer public docs, source, schemas, exports, CLI help, logs, and observable behavior before binary inspection.

Exit criteria:

- Every input has provenance.
- No secrets, production dumps, license keys, or proprietary assets are in the artifact set.

### Phase 2: Observation

1. Capture black-box behavior using local, authorized inputs.
2. Record schema, protocol, file-layout, state-machine, and error behavior.
3. Separate confirmed facts from hypotheses.
4. Keep TablePlus and similar tools limited to observation of owned/permitted databases or as high-level UX/product references.

Exit criteria:

- `observations.md` can be reviewed without exposing protected implementation.
- Unknowns are listed as hypotheses, not facts.

### Phase 3: Clean-room specification

1. Convert observations into a neutral behavior/spec document.
2. Define data structures, field meanings, invariants, edge cases, and compatibility requirements.
3. Include generated examples where possible instead of copied proprietary samples.
4. Have a second implementer use only the spec when protected material was observed.

Exit criteria:

- `clean-room-spec.md` contains enough detail to implement against permitted fixtures.
- It does not include decompiled source, copied protected assets, or non-public proprietary text.

### Phase 4: Prototype implementation

1. Implement parsers, validators, import/export tools, compatibility shims, or reports from the clean-room spec.
2. Use boundary schemas for untrusted inputs and file/database records.
3. Default to read-only inputs and write generated outputs to a separate directory.
4. Fail closed on unsupported versions or malformed data.

Exit criteria:

- Prototype behavior is traceable to clean-room spec sections.
- Unsupported or unsafe inputs produce explicit errors.

### Phase 5: Validation and release review

1. Validate against owned, generated, open, or redistributable fixtures.
2. Record coverage, edge cases, and known incompatibilities in `validation-report.md`.
3. Remove local-only samples, secrets, credentials, keys, and proprietary assets.
4. For security findings, complete `disclosure.md` before public release.

Exit criteria:

- Artifact bundle is safe to share or clearly marked local-only.
- Security findings have a responsible disclosure path.

## Prototype backlog

1. Lab run manifest schema with strict required fields.
2. Fixture manifest schema and sample generator for synthetic fixtures.
3. Observation-log template that separates facts, hypotheses, and rejected theories.
4. Clean-room spec template with sections for file formats, protocols, schemas, and state machines.
5. Read-only validation harness for parsers/importers using generated fixtures.
6. Release review checklist that blocks secrets, proprietary assets, and unsupported permission bases.

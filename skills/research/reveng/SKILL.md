---
name: reveng
description: Plan and execute reveng work for owned, open-source, explicitly permitted, or public interoperability targets with clean-room documentation and artifact hygiene.
---

# RevEng

Use this skill when the user asks for reveng of an in-scope target: owned binaries, open-source projects, explicitly permitted third-party targets, documented file formats or protocols, interoperability work, vulnerability research on systems the user is authorized to test, or migration/recovery of the user's own data.

Before inspection, identify the target, why it is in scope, and the intended output.

## Scope gate

Before inspecting a target, record the permission basis in working notes or the plan:

- **Owned**: the user controls the software, device, database, file, or service account.
- **Open source**: the license permits inspection and the intended reuse.
- **Explicit permission**: contract, bug bounty, vendor authorization, published interoperability allowance, or written user confirmation for their own system.
- **Public standard**: file format, protocol, database schema, or network behavior is documented or intentionally interoperable.

If the basis is absent, stop and ask for it. Do not infer permission from availability on the internet.

## In-scope work

- Map an owned/open-source binary's file layout, symbols, build flags, ABI, or configuration format.
- Compare observed behavior against public protocol or file-format documentation.
- Build parsers, validators, importers, exporters, migration tools, or compatibility shims for documented or user-owned data.
- Perform clean-room interoperability analysis: one person documents observed behavior; another implements from that document without copying code, assets, or product-specific expression from the observed system.
- Triage crashes and security issues on authorized targets, preserving reproduction steps and disclosure notes.
- Use TablePlus or another database GUI only as observational UX/product reference for a database workbench; exclude decompilation, cloned internals, copied assets, licensing bypass, and non-public behavior.

## Out-of-scope work

- Decompiling proprietary applications or libraries without permission.
- Cloning a commercial product's UI, assets, non-public workflows, private protocols, or license checks.
- Circumventing DRM, activation, subscription gates, paywalls, account limits, anti-cheat, or access controls.
- Extracting game/app/media assets except from the user's own files where they have redistribution rights.
- Scraping authenticated sites, replaying private APIs, or bypassing rate limits as a substitute for permission.
- Publishing exploit details before an agreed disclosure path.

## Workflow

1. **Define the target and permission basis**
   - Name the binary, repository, database, file format, device, or protocol.
   - State why it is in scope.
   - State intended output: documentation, parser, migration, compatibility layer, security report, or product prototype.

2. **Choose the least invasive observation method**
   - Prefer source code, public docs, schema dumps, logs, CLI help, exported data, and black-box behavior.
   - Use binary/static inspection only for owned/open-source/permitted artifacts.
   - Do not bypass access controls to obtain samples.

3. **Separate facts from implementation**
   - Capture observed inputs, outputs, schemas, state transitions, errors, version markers, and edge cases.
   - Avoid copying proprietary code, strings, graphics, or layout details unless the source permits that reuse.
   - Mark guesses as hypotheses until verified by a sample or public source.

4. **Produce clean-room artifacts**
   - Keep an observation log with provenance and permission basis.
   - Write a behavior/spec document in neutral terms.
   - Keep test fixtures limited to owned, generated, open, or redistributable samples.
   - Implement from the behavior/spec, not from decompiled proprietary source.

5. **Validate in controlled environments**
   - Test against local samples, local databases, or authorized test environments.
   - Prefer read-only credentials and throwaway copies.
   - Run malware or unknown binaries only inside an explicitly isolated lab.

6. **Review before release**
   - Confirm every artifact has a recorded source and permission basis.
   - Remove secrets, keys, license material, non-redistributable assets, and private customer data.
   - Include disclosure/embargo notes for security findings.

## Checklists

### Scope checklist

- [ ] Target is owned, open-source, explicitly permitted, or a public interoperable format/protocol.
- [ ] Intended use is interoperability, migration, security research, recovery, debugging, or education.
- [ ] No DRM, license, authentication, paywall, rate-limit, or anti-cheat bypass is requested.
- [ ] No proprietary asset extraction or protected product cloning is requested.
- [ ] Samples are owned, generated, open licensed, or explicitly redistributable.

### Lab artifact checklist

- [ ] Target note with owner, permission basis, and date.
- [ ] Source inventory with hashes or version identifiers for every sample.
- [ ] Observation log separating facts, hypotheses, and discarded leads.
- [ ] Clean-room behavior/spec document.
- [ ] Fixture manifest identifying redistribution status.
- [ ] Implementation notes that cite the clean-room spec instead of copied internals.
- [ ] Security/disclosure notes when vulnerabilities are involved.

### Database workbench checklist

- [ ] Work only on local, owned, generated, or explicitly permitted databases.
- [ ] Default to read-only connections and copied fixtures.
- [ ] Treat TablePlus as UX/product reference only; do not copy proprietary internals or protected assets.
- [ ] Log schema observations, query behavior, import/export semantics, and error cases.
- [ ] Keep credentials, production dumps, and customer data out of committed artifacts.

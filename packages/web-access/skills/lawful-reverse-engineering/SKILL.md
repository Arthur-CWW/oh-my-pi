---
name: lawful-reverse-engineering
description: Plan and execute opt-in reverse-engineering work only for owned, open-source, or explicitly permitted targets, with clean-room documentation and strict legal/safety guardrails.
---

# Lawful Reverse Engineering

Use this skill only when the user asks for reverse engineering in a lawful, opt-in context: owned binaries, open-source projects, explicitly permitted third-party targets, documented file formats/protocols, interoperability work, vulnerability research on systems the user is authorized to test, or migration/recovery of the user's own data.

Do not use this skill to decompile proprietary software, clone products, bypass licenses, bypass DRM, extract assets, evade authentication/rate limits, remove telemetry, defeat anti-cheat, generate cracks/keygens, or reproduce private APIs without permission.

## Intake gate

Before inspecting a target, record the authorization basis in the working notes or plan:

- **Owned**: the user controls the software, device, database, file, or service account.
- **Open source**: license permits inspection and the intended reuse.
- **Explicit permission**: contract, bug bounty, vendor authorization, published interoperability allowance, or written user confirmation for their own system.
- **Public standard**: file format, protocol, database schema, or network behavior is documented or intentionally interoperable.

If the basis is absent, stop and ask for the missing authorization. Do not infer permission from availability on the internet.

## Allowed work

Good tasks:

- Map an owned/open-source binary's file layout, symbols, build flags, ABI, or configuration format.
- Compare observed behavior against public protocol or file-format documentation.
- Build parsers, validators, importers, exporters, migration tools, or compatibility shims for documented or user-owned data.
- Perform clean-room interoperability analysis: one person documents observed behavior; another implements from that document without copying protected expression.
- Triage crashes and security issues on authorized targets, preserving reproduction steps and responsible disclosure notes.
- Use TablePlus or another database GUI only as observational UX/product reference for a database workbench; never to decompile, clone proprietary implementation, extract protected assets, bypass licensing, or copy non-public behavior.

Forbidden tasks:

- Decompiling proprietary applications or libraries without permission.
- Cloning a commercial product's protected UI, assets, non-public workflows, private protocols, or license checks.
- Circumventing DRM, activation, subscription gates, paywalls, account limits, anti-cheat, or access controls.
- Extracting game/app/media assets except from the user's own files where they have rights to use them.
- Scraping authenticated sites, replaying private APIs, or bypassing rate limits as a substitute for permission.
- Publishing exploit details before an agreed disclosure path.

## Workflow

1. **Define the target and authorization**
   - Name the binary, repository, database, file format, device, or protocol.
   - State why it is in scope.
   - State intended output: documentation, parser, migration, compatibility layer, security report, or product prototype.

2. **Choose the least invasive observation method**
   - Prefer source code, public docs, schema dumps, logs, CLI help, exported data, and black-box behavior.
   - Use binary/static inspection only for owned/open-source/permitted artifacts.
   - Do not bypass access controls to obtain samples.

3. **Separate facts from implementation**
   - Capture observed inputs, outputs, schemas, state transitions, errors, version markers, and edge cases.
   - Avoid copying proprietary code, strings, graphics, or layout details unless the license permits it.
   - Mark guesses as hypotheses until verified by a sample or public source.

4. **Produce clean-room artifacts**
   - Keep an observation log with provenance and permissions.
   - Write a behavior/spec document in neutral terms.
   - Keep test fixtures limited to owned, generated, open, or redistributable samples.
   - Implement from the behavior/spec, not from decompiled proprietary source.

5. **Validate safely**
   - Test against local samples, local databases, or authorized test environments.
   - Prefer read-only credentials and throwaway copies.
   - Never run malware or unknown binaries outside an explicitly isolated lab.

6. **Review before release**
   - Confirm every artifact has a lawful source.
   - Remove secrets, keys, license material, copyrighted assets, and private customer data.
   - Include disclosure/embargo notes for security findings.

## Checklists

### Scope checklist

- [ ] Target is owned, open-source, explicitly permitted, or a public interoperable format/protocol.
- [ ] Intended use is interoperability, migration, security research, recovery, debugging, or education.
- [ ] No DRM, license, authentication, paywall, rate-limit, or anti-cheat bypass is requested.
- [ ] No proprietary asset extraction or protected product cloning is requested.
- [ ] Samples are owned, generated, open licensed, or explicitly redistributable.

### Lab artifact checklist

- [ ] Authorization note with target, owner, permission basis, and date.
- [ ] Source inventory with hashes or version identifiers for every sample.
- [ ] Observation log separating facts, hypotheses, and discarded leads.
- [ ] Clean-room behavior/spec document.
- [ ] Fixture manifest identifying redistribution status.
- [ ] Implementation notes that cite the clean-room spec instead of proprietary internals.
- [ ] Security/disclosure notes when vulnerabilities are involved.

### Database workbench checklist

- [ ] Work only on local, owned, generated, or explicitly permitted databases.
- [ ] Default to read-only connections and copied fixtures.
- [ ] Treat TablePlus as UX/product reference only; do not copy proprietary internals or protected assets.
- [ ] Log schema observations, query behavior, import/export semantics, and error cases.
- [ ] Keep credentials, production dumps, and customer data out of committed artifacts.

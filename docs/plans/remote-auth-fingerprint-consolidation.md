# Remote authentication and Touch ID consolidation

## Purpose and sequencing

This plan moves every biometric, credential, release, and deployment decision into the signed `packages/remote-auth-broker` product. Dotfiles become declarative host configuration, and skills become consumers of verified installed public status.

**This is not a prerequisite for the current GDM/Chrome activation.** Finish or roll back the existing GDM transaction, prove the graphical session and keyring, then run the existing Chrome `check` and `status` path. Do not change the helper, deployer, PAM, Chrome setup, or their recorded activation snapshot while that lane is in flight. The successor may be developed beside it, but the current lane must not be rerouted through unfinished successor commands. Browser-secret capabilities and signed sudo remain independently inactive until their own gates pass.

After the current lane closes, execute the clean cutover below. There is no compatibility-shim end state.

## Problem and root cause

The security boundary is split across four kinds of authority:

- the broker package owns the intended Swift biometric/Keychain authority, OMP adapter, Ubuntu verifiers, and release sources;
- dotfiles own imperative GDM, sudo-password, Chrome, and graphical bootstrap helpers;
- standalone sudo and Bitwarden Touch ID helpers remain callable and, in some cases, can expose or cache reusable credentials;
- skills and prose have treated mutable source-file hashes as live trust pins.

That split makes a reviewed source tree, installed bytes, running bytes, policy, and capability status disagree without a single fail-closed answer. A source hash proves only one file snapshot. Git history proves review history. SQLite can record observations. None proves which signed executable and policy are installed and running. Rewriting the helpers in another shell would preserve the same authority error.

The root cause is therefore misplaced authority, not missing fingerprint code: native Touch ID and Keychain primitives already exist in the broker, while installation, first-root bootstrap, public status, and retirement of older callers are incomplete.

## Clean end state

1. `packages/remote-auth-broker` is the sole implementation, release, installation, rollback, and public-status owner for Mac Touch ID/Keychain operations and remote-auth capabilities.
2. The Mac release is immutable and signed. Installed `remote-authctl` verifies candidate releases, installed/running identities, and signed public status against an existing trust anchor.
3. Ubuntu owns no biometric authority. It validates immutable releases and transcript-bound effects through package-owned Rust verifiers and fixed root deployment actions.
4. Dotfiles contain one nonsecret host declaration plus unrelated OS/recovery provisioning. They contain no broker executable logic, credential helper, source hash authority, password lease, or browser runtime.
5. Skills use installed `remote-authctl --help` for syntax and verified signed status for capability state. They contain no mutable helper or release digest.
6. The sudo-password bootstrap exists only for the one transition that first installs the authenticated Ubuntu root entrypoint. It is then removed; routine update/status/rollback/confirm use fixed installed actions, and later signed-sudo uses only its exact registry.
7. Standalone `remote-sudo-touchid`, `bw-touchid`, `with-bw-session`, and cached-session paths are absent once their replacement capabilities pass their independent activation gates. Git history is the archive; there is no wrapper, alias, symlink, deprecated skill, or executable backup.
8. Human presence is a separate advisory control-plane signal. It may schedule interruptions but never participates in authentication, approval, grant, or capability decisions.

## Ownership and file cutover

### Package additions and replacements

| Exact path or module | End-state responsibility |
|---|---|
| `packages/remote-auth-broker/contracts/deployment/macos-release-v1.schema.json` | Closed manifest for the sealed Mac bundle, including platform, protocol/policy versions, declared artifacts, nested code identities, inactive policy, and rollback compatibility. |
| `packages/remote-auth-broker/contracts/deployment/ubuntu-release-v1.schema.json` | Closed manifest for staged and root-owned Ubuntu releases: exact artifact set, hashes, modes, owner classes, platform, PAM baseline, and action versions. |
| `packages/remote-auth-broker/contracts/deployment/host-v1.schema.json` | Nonsecret fixed host facts only; it rejects credentials, private keys, arbitrary commands, environment injection, policy activation, and mutable release pins. |
| `packages/remote-auth-broker/contracts/deployment/status-v1.schema.json` and `Sources/RemoteAuthProtocol/DeploymentModels.swift` | One strict deployment/status protocol. Replace the old aggregate status model rather than retaining v1/v2 aliases. |
| `Sources/RemoteAuthBroker/BiometricAuthority.swift` | Sole Touch ID prompt and single-use evidence owner. Extend this module; do not create another helper target. |
| `Sources/RemoteAuthBroker/KeychainAuthority.swift` | Sole credential, signing-key, and migration owner, including signed installation-status keys and two-phase legacy credential finalization. |
| `Sources/RemoteAuthBroker/ReleaseVerifier.swift` | Verifies the trusted signer, sealed manifest/resources, exact artifacts, and canonical release digest. Candidate-bundled requirements are descriptive, not the trust anchor. |
| `Sources/RemoteAuthBroker/InstallationCoordinator.swift`, `InstallationJournal.swift`, and `InstallationStatusProvider.swift` | Transactional install/update/rollback; signed receipts; independent measurement of installed, current, and running identities. |
| `Sources/RemoteAuthBroker/HostConfiguration.swift` and `BootstrapCoordinator.swift` | Strict host decode and the only first Ubuntu root-bootstrap route. |
| `Sources/RemoteAuthBroker/CLI.swift` and `RuntimeBootstrap.swift` | Public fixed administration commands and status derived from measured installation/runtime state. |
| `scripts/macos/build.sh` and `sign.sh` | Minimal Bash build/sign bootstrap for a sealed outer bundle with explicitly verified nested code and signer identity. |
| `scripts/macos/install.sh` and `rollback.sh` | Remove after signed Swift installation and rollback are proven. Keep only a minimal POSIX first-Mac `bootstrap-install.sh` if a machine with no installed verifier must be supported; it accepts one absolute bundle, expected immutable release, and fixed signer, and installs inactive policy only. |
| `ubuntu/scripts/` and `ubuntu/crates/` | Package-owned fixed root deployment and native verifier boundary. Add versioned update/receipt behavior here; never add Linux fingerprint authority. |
| `ubuntu/assets/remote-chrome-agent.service`, `ubuntu/scripts/install-remote-chrome-system-ubuntu.sh`, and `ubuntu/scripts/remote-chrome-agent-ubuntu.sh` | Package-owned Chrome service/install runtime, moved from dotfiles after live parity proof. |

The signed Mac bundle layout is:

```text
RemoteAuthBroker.release/Contents/
  Info.plist
  MacOS/remote-authd
  MacOS/remote-authctl
  Resources/release-v1.json
  Resources/policy-inactive.json
```

Install versions under `~/Library/Application Support/RemoteAuthBroker/versions/<release-digest>/RemoteAuthBroker.release`. `current` selects a version directory; the LaunchAgent names the selected version's daemon. Sign nested executables explicitly and then the outer bundle. Do not use mutable `latest` as deployment input or `--deep` as a substitute for nested verification.

### Dotfiles become declarative

Add `/Users/arthur/dotfiles/server/ubuntu-remote/remote-auth-broker.desktop.json` as the only broker-specific dotfiles authority. The broker validates it against `host-v1`; dotfiles apply/smoke checks confirm the declaration is installed, but do not copy it back into package source.

After package parity and cutover proof, remove these executable authorities rather than forwarding them:

- `/Users/arthur/dotfiles/server/ubuntu-remote/framework-remote-sudo-askpass.sh`
- `/Users/arthur/dotfiles/server/ubuntu-remote/remote-sudo-touchid-keychain.swift`
- `/Users/arthur/dotfiles/server/ubuntu-remote/install-remote-auth-gdm-broker.sh`
- the dotfiles `setup-remote-chrome.sh` and `remote-chrome-agent.service` after their package-owned replacements prove parity
- `/Users/arthur/dotfiles/scripts/bitwarden-touchid.swift` and `with-bw-session.sh`
- `local/dotfiles-mise-shims/scripts/bitwarden-touchid.swift`, `install-bitwarden-touchid.sh`, and `with-bw-session.sh`
- `local/dotfiles-mise-shims/server/ubuntu-remote/framework-remote-sudo-askpass.sh`
- the `bw-touchid-install` mise task/bootstrap hook and stale `~/.pi/omp-bw-session.env`

Keep SSH configuration declarative. Keep `setup-remote-graphical-login.sh` only for fixed Ubuntu/GDM/RDP host provisioning, and remove its credential print/forget and saved-bootstrap-secret paths when superseded. Keep standard SSH and standard PAM as human emergency recovery, never an agent-selected fallback.

Update every old Keychain/session consumer before removal, including dotfiles account-catalog/login utilities and browser-login runbooks. The final tree and installed locations must contain no reads of `dotfiles.remote-sudo` or `dotfiles.bitwarden-touchid.*`.

## Signed release and public-status trust chain

The steady-state chain is:

1. A reviewed source revision produces a canonical closed manifest and sealed release bundle.
2. The release process signs each nested executable and the outer bundle with the expected Apple identity. The outer signature seals the manifest and inactive policy.
3. An already-installed signed `remote-authctl` holds/enforces the signer/team trust anchor, verifies the candidate bundle, and calculates the release digest from canonical sealed-manifest bytes. A valid signature from the wrong identity, ad-hoc signature, undeclared file, symlink/hardlink, wrong mode/platform, or altered resource fails closed.
4. The installation transaction writes an immutable version, receipt, `current` pointer, policy, and LaunchAgent change through a journal that can restore the exact prior state.
5. `InstallationStatusProvider` measures the receipt, `current` target, LaunchAgent program/load state, live executable/signature/digest, policy, and rollback journal independently. It must report divergence rather than copying one identity into every field.
6. `remote-authd` signs canonical status with a device-local Ed25519 installation-status Keychain key. Installed signed `remote-authctl` strictly decodes and verifies the envelope before displaying it.
7. Skills trust only that verified installed interface and status. Immutable manifests define artifact identities; host JSON defines the target. Neither skills nor canonical prose repeat live hashes.

The status payload must include installation/boot/process identity, monotonic status sequence, socket posture, installed/current/running release and source-build identities, installed/running code digests, signer identity, policy digest, update state, rollback transaction, and the exact capability rows `gdm`, `bitwardenUnlock`, `websiteAutofill`, and `signedSudo`. Each row carries state, readiness, policy digest, dependency digests, and a bounded error code. Missing rows, replayed boot/sequence, invalid signatures, or installed/running divergence fail only the affected capability closed. Status contains no credential, command output, browser data, environment, or reusable authorization material.

## One-time bootstrap transition

There are two distinct bootstrap cases:

- **First Mac install:** a minimal reviewed POSIX installer may install only an expected immutable bundle signed by the fixed production identity and leave policy inactive. From then on, signed Swift owns install/update/rollback. The bootstrap script is not a normal update path.
- **First Ubuntu root install:** installed signed `remote-authctl` loads one reviewed host declaration, verifies its own installed/running status, stages one complete immutable Ubuntu release, shows the fixed host and release in the Mac UI, and requires fresh `destructiveOneShot` Touch ID. `BootstrapCoordinator` opens SSH with a fixed argument vector, sends the already-migrated bootstrap password only to fixed remote `sudo -S`, and invokes only `bootstrap-install <lowercase-release-digest>` in the authenticated staged snapshot.

The Ubuntu route accepts no caller executable, path, shell, command string, optional argument, environment, PATH lookup, encoded script, lease, or password output. The remote transaction copies the stage to a fresh root-owned snapshot and validates the complete Ubuntu manifest before mutation.

After the installed deployer exists, `remote-authctl deployment gdm update|status|rollback|confirm` invokes only its fixed actions. When `signedSudo` activates, those actions become exact registry entries and the bootstrap-password route is removed. The legacy GDM Keychain source is deleted only after destination byte verification, real GDM proof bound to the expected release/policy, signed migration status, and fresh Touch ID finalization agree.

Do not migrate `BW_SESSION` into the broker. Browser capabilities enroll/use broker-confined credentials and the private official-extension/CDP path. Delete standalone Bitwarden services and caches only when the matching browser capability independently activates.

## Ubuntu transaction and rollback contract

`deploy-gdm-release-ubuntu.sh` becomes a fixed dispatcher for:

```text
bootstrap-install EXPECTED_RELEASE
update EXPECTED_RELEASE
status
rollback EXPECTED_CURRENT_RELEASE TRANSACTION_ID
confirm TRANSACTION_ID
```

The root-owned state records prior/current immutable releases, exact managed artifact metadata, service state, policy, PAM baseline, and transaction phase. Update preflights drift, snapshots the prior state, swaps only declared artifacts, restarts affected services, and reports `restart-required` until the new runtime is measured. PAM changes retain the five-minute automatic rollback timer and preserve exact prior bytes, owner, mode, ACLs, and xattrs. Confirmation requires the matching transaction, running release, ready sockets, exact PAM layout, and matching broker-signed capability status. Drift or an unavailable prior release stops destructive cleanup; rollback never means “delete whatever exists.”

No wildcard sudo rule, interpreter entrypoint, root shell, caller environment, writable plugin directory, or caller-selected path is added.

## Nu and Bash ownership

Nu is the default for typed, unprivileged orchestration only after one exact version is pinned and verified on Mac and Ubuntu. Authentication and recovery must not acquire a dependency on user-managed Nu.

| Surface | Owner | Reason |
|---|---|---|
| Swift build/sign bootstrap and optional first-Mac installer | Bash/POSIX | Must run before the package is installed and use fixed platform tools. |
| PAM install/confirm/rollback, Ubuntu release stage/deploy/update, systemd/SSH forced commands, Chrome system install/runtime, base OS and recovery | Bash or native Rust/Swift | Must survive missing/broken mise/Nu and preserve exact root/recovery semantics. |
| OMP adapter and protocol boundary | TypeScript | Existing typed OMP integration boundary. |
| Touch ID, Keychain, installation, signed status, Mac bootstrap coordinator | Swift | Native macOS security and code-signature boundary. |
| Ubuntu verifier, PAM module, forced ingestion, direct exact-action execution | Rust | Native locked-memory/process/PAM boundary. |
| Host selection, nonprivileged staging orchestration, status aggregation/reporting, dotfiles sync, resource reports, local maintenance client | Nu | Structured data work with no bootstrap or root authority. |
| Legacy askpass, password/session wrappers, helper installers | Delete | Migrating them would preserve the wrong authority. |

Nu rollout is independent: record actual versions on both hosts; choose one tested exact version; replace both shared dotfiles `latest` pins together; validate tracked Nu entrypoints/config on Mac then Ubuntu; retain and test rollback to the prior version. GDM, Chrome startup, deployment rollback, SSH rescue, and emergency disable must work with Nu absent from `PATH`.

## Advisory AFK presence contract

Presence is implemented in `packages/control-plane`, not in the auth broker. Add `src/presence-schema.ts` for strict v1 types, `src/presence.ts` for storage/derivation, a numbered migration in `src/migrate.ts`, exports in `src/index.ts`, and versioned CLI/API routes in `src/cli.ts` and `src/http-api.ts`. Focused tests belong in `packages/control-plane/test/presence.test.ts` and API/CLI tests.

The owner-only SQLite table stores one latest row per `(source, machineId, userId)` with exactly:

```text
schemaVersion = 1
source
machineId
userId
observedAt
expiresAt
idleMilliseconds
lockState = locked | unlocked | unknown
sessionState = active | inactive | unknown
confidence = 0..1
generation
```

Invariants:

- `expiresAt` is later than `observedAt`; expired rows never contribute to a current view.
- `idleMilliseconds` and `generation` are nonnegative integers; generation strictly increases per source key. A stale/equal generation is an idempotent replay only when the full canonical row matches, otherwise it is rejected.
- Each probe writes only its own source row. One heuristic never overwrites, merges, or deletes another source's observation.
- A query returns the contributing rows plus a derived `likely-active | likely-afk | unknown` view and bounded reasons. Conflicting fresh sources produce `unknown`, not last-writer-wins certainty.
- Lock and active-session evidence can influence the advisory view, but no field means “approved,” “authenticated,” “biometric present,” or “safe to expose UI.” Confidence is a scheduling hint, not a probability or permission.
- The API/CLI is the only write surface; consumers do not edit SQLite. Writes are same-user/owner-only, strictly decoded, transactionally upserted, and bounded by source and row size.
- Cross-host clocks are not silently trusted. Prefer per-host observation stores plus API aggregation when shared-DB contention or clock skew cannot be bounded; generation provides source ordering but does not repair timestamp freshness.
- Auth policy, grants, Touch ID prompts, capability activation, destructive-action review, and secret handling must not read presence. Presence may only defer/schedule visible UI or choose whether to present a prompt now.

Public operations are `presence observe` (source-owned write) and `presence status` (read/derive), with versioned JSON equivalents under the existing control-plane API. Unknown schema versions or invalid rows fail closed to `unknown`; they never default to AFK or approval.

## Phased execution after GDM/Chrome

### Phase 0 — close the urgent lane

Finish or roll back current GDM with PAM rollback/rescue intact; publish `gdm` active only after its own proof and review; start a fresh OMP session; establish the graphical/keyring session; run Chrome `check` and `status`. Do not wait for this consolidation, browser-secret capabilities, signed sudo, Nu, or presence.

### Phase 1 — contracts and sealed inactive release

Land closed Mac/Ubuntu release, host, and status schemas; sealed bundle/signing; signed status; independent installed/current/running measurement; Swift install/update/rollback. Install inactive and prove wrong-signer/tamper/divergence rejection before changing credential authority.

### Phase 2 — exact bootstrap and Ubuntu transactions

Land host configuration and `BootstrapCoordinator`; prove the one first-root install; extend Ubuntu update/status/rollback/confirm receipts and crash recovery. Keep the legacy helper available only as the current transition mechanism, never as fallback.

### Phase 3 — GDM path cutover

Prepare the two-phase Keychain migration, cut the live GDM deployment path to installed signed `remote-authctl`, exercise real GDM and exact rollback, then finalize/delete the legacy sudo credential/helper and obsolete skill wording. One live authority exists at every boundary.

### Phase 4 — Chrome asset ownership

Move the Chrome unit/runtime into the package, atomically switch the installed service, and prove executable/profile/keyring/loopback/streamlocal parity without Nu. Then delete the dotfiles Chrome imperative files. This asset move does not activate Bitwarden or autofill.

### Phase 5 — independent capability retirements

Activate `bitwardenUnlock`, `websiteAutofill`, and `signedSudo` separately after each proof/review/status/fresh-session gate. Immediately remove the matching old executable, Keychain service/cache, task, skill, and runbook authority; never run old and new agent authorities concurrently.

### Phase 6 — Nu and presence

Pin and roll Nu independently, then migrate only unprivileged orchestration. Implement the advisory presence store/API independently in `packages/control-plane`. Neither work participates in an auth activation dependency graph.

### Phase 7 — final documentation and absence proof

Update canonical capability rows and runbooks to the installed signed interface/status. Remove source-hash instructions and stale duplicates. Start a fresh OMP session and perform final end-to-end and absence proof.

## Acceptance, cutover, and removal criteria

The cutover is complete only when all applicable statements are proved:

- A real signed Mac release rejects wrong identity, tampered or undeclared content, invalid links/modes/platform, and candidate-selected trust anchors.
- Fresh-state install, same-release idempotence, A→B update, installed/running divergence, interruption at each mutation boundary, exact rollback, and signed-status replay/tamper tests pass with no root execution on Mac.
- The first Ubuntu bootstrap accepts only the reviewed host, immutable release, fresh destructive Touch ID, fixed SSH/sudo argv, and fixed root action; secret-canary evidence covers argv, environment, process lists, logs, SSH, receipts, journals, status, tool results, PAM/verifier state, browser, JetKVM, and screenshots.
- Ubuntu clean install, A→B update, service restart, pending-transaction refusal, PAM timeout rollback, crash recovery, exact metadata restoration, and foreign-drift refusal pass.
- Real GDM/PAM/keyring and JetKVM-sentinel proof passes with standard PAM/recovery unchanged; Chrome package parity passes without Nu.
- Each browser/sudo capability is removed from its legacy authority only after its own active signed status, proof, independent review, installation/restart, and fresh-session gate passes.
- Source and installed trees contain no legacy helper executable, wrapper, alias, symlink, LaunchAgent/service, mise task, skill authority, session cache, old Keychain item, password-output/unattended-read/lease mode, generic root shell, mutable helper digest, or caller capable of invoking them.
- Public status reports measured installed/current/running identities and capability rows; it never infers runtime identity from source, release pointer, SQLite, or prose.
- Nu rollback leaves broker, GDM, Chrome, PAM rollback, SSH rescue, and emergency disable operational.
- Presence conflict, expiry, replay, cross-source isolation, API access, and `unknown` fallback are proved; no authentication or policy code imports the presence store.

Removal is immediate once its replacement gate passes. If a gate fails, keep the old path only as the explicitly bounded transition/recovery mechanism already authorized for that phase; do not publish the replacement active and do not add a compatibility shim. Roll back the named transaction to the exact prior release/state, retain proof receipts, repair, and repeat the gate.

# Remote authentication broker

> **Capability status:** see the explicit matrix below; there is no global broker activation state
> **Decision date:** 2026-07-23
> **Runtime authority:** each capability is independently inactive unless its own complete activation gate passes
> **Agent policy:** [remote-authentication-broker skill](../../skills/fleet/remote-authentication-broker/SKILL.md)

This document is the canonical design and per-capability status authority for delegated remote GDM login, Bitwarden unlock, website autofill, and passwordless privileged execution. A capability's status grants authority only for its matching operation. It does not activate any other capability.

Related authorities: the [fingerprint and Touch ID consolidation plan](../plans/remote-auth-fingerprint-consolidation.md), [HR-250](harness-request-register.md), [DRP-012](../plans/desktop-resource-pooling.md), the [2026-07-23 garden receipt](../state/thread-gardens/2026-07-23-jetkvm-desktop-infrastructure.md), and the dated [desktop recovery incident](../state/incidents/2026-07-23-jetkvm-ubuntu-desktop-recovery.md).

Normative words such as **MUST**, **MUST NOT**, and **MAY** are requirements for any implementation that claims this policy digest.

## Capability status

| Capability | Operation | Current design status | Published policy digest | Current agent authority |
|---|---|---|---|---|
| `gdm` | `gdm-login` | `DESIGN/INACTIVE` | none | Routine GDM automation is blocked; treat the capability as incomplete infrastructure and repair its gate. |
| `bitwardenUnlock` | `bitwarden-unlock` | `DESIGN/INACTIVE` | none | Routine Bitwarden unlock is blocked; treat the capability as incomplete infrastructure and repair its gate. |
| `websiteAutofill` | `website-autofill` | `DESIGN/INACTIVE` | none | Routine credential autofill is blocked; treat the capability as incomplete infrastructure and repair its gate. |
| `signedSudo` | `sudo` | `DESIGN/INACTIVE` | none | Signed sudo is blocked; only the narrowly scoped legacy activation-bootstrap contract below may apply. |

There is no aggregate `ACTIVE` or `DESIGN/INACTIVE` broker status. For a requested operation, agents MUST evaluate only the matching capability row and its own gate. `gdm` may become `ACTIVE` after GDM-only proof, review, deployment, public status, and fresh-session prerequisites pass; it does not wait for Bitwarden, autofill, autoreview, or signed-sudo work. Conversely, active `gdm` does not authorize Bitwarden unlock, website autofill, or signed sudo.

Status ambiguity fails closed per capability. A missing row, unknown status, absent digest, missing evidence, contradictory public status, or uncertainty about which capability governs a request means that capability is inactive. An inactive capability never inherits authority from another capability and never falls back to password output, agent-visible secret handling, ordinary browser/OS input, a generic SSH shell, or broader sudo.

## Decision

Build one signed native macOS Swift authority, referred to here as `remote-authd`. It alone may:

- read credential bytes from Keychain;
- invoke Touch ID;
- create, expand, redeem, expire, and revoke grants;
- release a credential into a verified GDM or Bitwarden target;
- authorize a passwordless exact privileged action; and
- write metadata-only receipts.

OMP receives a credential-free `remote_auth` capability over an owner-only Unix socket. The OMP surface accepts typed metadata, not credential text, selectors, scripts, shell fragments, or browser data. A broker-owned, extension-free local Chrome may actuate JetKVM WebRTC/CDP, but it is not an agent browser and MUST NOT be reused for web work.

### Runtime and language boundaries

The three language implementations are deliberate runtime boundaries, not interchangeable duplicate clients:

- **TypeScript** is the OMP extension/tool adapter. It binds the live OMP ownership view, decodes typed tool input, and speaks the credential-free broker wire protocol.
- **Swift** is the macOS authority. It owns LocalAuthentication/Touch ID, Keychain, code-signature attestation, the owner-only broker socket, policy/grant state, and the private Chrome-pipe JetKVM actuator.
- **Rust** is the Ubuntu verifier boundary. It owns the locked-memory envelope verifier, forced SSH ingestion endpoint, lifecycle state, PAM module, and Linux process/cgroup checks.

All three consume one versioned closed protocol and deterministic contract-vector corpus. Cross-language parity is proved by those vectors; one runtime never reimplements another runtime's native authority. Consolidation should remove duplicated wrappers and deployment logic, not collapse these platform-specific security boundaries into a language that cannot natively own them.

The final autonomy rule is:

- Fresh Touch ID gates grant creation or expansion and each destructive or irreversible one-shot.
- A routine exact request covered by a live closed grant is redeemed unattended.
- The execution receipt states whether authorization was `delegated` or `biometric-one-shot`; it MUST NOT imply a biometric event when a standing grant was redeemed.

This supersedes the proposed model in which every routine operation prompts. It does not create broad ambient authority: every grant has a closed principal, operation, target predicate, risk ceiling, expiry, policy digest, and revocation state.

## Authorization model

### Principals and ownership

Every request binds the live OMP session ID, current owner epoch, caller PID and UID, and caller code identity/build digest. The broker verifies Unix peer credentials and the live process/code identity independently of caller-supplied fields. A session name, repository path, or inherited environment variable is not identity.

A stale owner epoch, changed process, reused request, different request body, or absent live principal is rejected before any external effect.

### Two authorization modes

`delegated` means the request redeemed an already-issued grant whose complete predicate matched at execution time. No Touch ID event is claimed for that execution.

`biometric-one-shot` means fresh Touch ID authorized that exact request and no reusable execution authority was created unless a distinct grant-creation transaction was also explicitly approved.

Creating or expanding a grant always requires fresh Touch ID. Narrowing, revoking, expiring, cancelling, forgetting, or emergency-disabling authority does not require a remote endpoint and must remain locally available. Re-enable requires Touch ID.

### Separate domains

There are exactly two signing and authorization domains:

1. `desktop-browser`: GDM login, Bitwarden unlock, and website autofill.
2. `sudo`: passwordless execution of one registered absolute executable plus exact argument vector.

They use separate signing keys, verifier policies, grant namespaces, and action allowlists. A signature, grant, nonce, or policy decision from one domain is invalid in the other.

## Closed execution request schema

Every execution request is a strict, versioned tagged union. Every object is closed: unknown or excess fields are rejected. Missing fields, duplicate set members, malformed encodings, control characters, noncanonical values, or values outside the published version bounds are rejected before authorization.

### Common request envelope

| Field | Contract |
|---|---|
| `protocolVersion` | Supported exact protocol version. No best-effort downgrade. |
| `requestId` | Unique opaque execution identifier. |
| `nonce` | High-entropy one-shot nonce; replay is terminal rejection. |
| `createdAt`, `expiresAt` | Bounded short request lifetime under the versioned schema. Expired requests never execute. |
| `principal` | Closed object: live OMP session ID, owner epoch, PID, UID, code identity, build digest. |
| `authorizationModeRequested` | Exactly `delegated` or `biometric-one-shot`. |
| `domain` | Exactly `desktop-browser` or `sudo`; must agree with the operation tag. |
| `operation` | Exactly `gdm-login`, `bitwarden-unlock`, `website-autofill`, or `sudo`. |
| `target` | Exactly one target variant matching `operation`. |
| `purpose` | Bounded sanitized text; no secrets or control characters. |
| `grantId` | Required only for `delegated`; forbidden for `biometric-one-shot`. |

The broker canonicalizes and hashes the complete accepted body. A later request with the same request ID or nonce but a different body is a conflict, never an update.

### Target variants

**GDM target**

- pinned SSH host key and machine identity;
- verifier-local boot ID;
- local user and UID;
- PAM service, expected seat, observed TTY, and local/empty RHOST state;
- GDM greeter generation;
- JetKVM device identity and controller-session generation.

The only PAM service permitted by this design is `gdm-password`.

**Bitwarden target**

- host and graphical-session identity;
- Chrome service, executable, process, dedicated profile, browser target, and window identity;
- official Bitwarden extension ID, version, source, and manifest digest;
- exact unlock UI target.

**Website-autofill target**

- every Bitwarden target field above;
- exact finite HTTPS origin set, including approved redirect and iframe origins;
- active tab, frame, form-action, and foreground/window bindings;
- an opaque credential-pairing ID that the broker can ask the official extension to fill but that does not let the agent retrieve a vault item.

Raw URLs and query strings are not request or receipt fields. The implementation derives an origin-only canonical binding inside the trusted boundary and rejects unexpected redirects, frames, actions, targets, or focus changes.

**Sudo target**

- pinned host key, machine identity, boot ID, user, and UID;
- sudo policy digest and registered action ID;
- absolute executable;
- canonical argument-vector digest.

A shell, relative executable, PATH lookup, wildcard argument, caller-selected environment, redirection, pipeline, interpreter command string, or credential-bearing argument is invalid.

## Closed grant schema

A grant is a strict closed object with:

- protocol version and grant ID;
- principal selector, including permitted session/owner/code identity scope;
- exactly one domain;
- closed operation and target predicate;
- risk ceiling;
- issue, expiry, revocation, and optional consumption timestamps;
- policy digest and broker build/code identity;
- biometric issuance evidence metadata; and
- lifecycle state.

A grant contains no secret and no raw URL. Its target predicate must be finite and inspectable; “any host”, “any command”, “any site”, arbitrary selectors, arbitrary scripts, and unconstrained future members are invalid. Policy, broker build, executable, extension, host, boot, user, profile, target, or owner drift invalidates redemption rather than widening the predicate.

## Closed receipt schema

A receipt is a strict closed metadata object with:

- protocol version, receipt ID, request ID, and optional grant ID;
- domain and operation;
- authorization mode actually used;
- hashed target fingerprint;
- state: `requested`, `authorized`, `executing`, `succeeded`, `failed`, `cancelled`, `expired`, `revoked`, or `disabled`;
- bounded error code;
- event timestamps;
- policy digest;
- broker build/code digest; and
- for a browser secret operation, a target-release disposition of `quarantined`, `destroyed`, or `closed`, bound to the request ID and browser target generation; non-browser operations use `not-applicable`.

Receipts MUST NOT contain credentials, sentinels, tokens, cookies, 2FA codes, passkey material, raw URLs or query strings, screenshots, snapshots, DOM or input values, form contents, command secrets, process environments, ciphertext/envelopes, browser storage, SSH streams, or PAM tokens. Purpose text is sanitized and bounded before persistence. Receipts are metadata only and are not an alternate debug-log channel.

State transitions are monotonic and transactionally coupled to nonce/grant consumption. A terminal request cannot return to an executable state.

## GDM path: one-shot PAM token injection

### PAM policy

Only `/etc/pam.d/gdm-password` may change. Do not change `common-auth`, `common-account`, `gdm-autologin`, fingerprint, smartcard, or `gdm-launch-environment`.

The reviewed order is:

```text
auth requisite pam_nologin.so
auth required pam_succeed_if.so user != root quiet_success
auth optional pam_gdm_broker.so mode=inject …
@include common-auth
auth optional pam_gnome_keyring.so
auth optional pam_gdm_broker.so mode=clear
@include common-account
```

The installer supplies the reviewed fixed module arguments and socket path. Both broker lines are `auth optional`, and the module MUST return `PAM_IGNORE` on every non-crash path, including successful injection and successful clearing. It MUST never return authentication success, add `pam_permit`, add success jumps, or create a separate authentication stack.

### Standard and brokered conversations

`mode=inject` calls `pam_get_authtok` once.

- If the token is not the exact versioned fixed-length broker sentinel, the module makes no verifier call, does not copy, clear, or alter the token, and returns `PAM_IGNORE`. The standard password token continues through unchanged `common-auth` and `common-account`.
- If the token is a sentinel, the module attempts one bounded local claim. On an exact claim it replaces `PAM_AUTHTOK` with the password through `pam_set_item`, records only a nonsecret per-PAM-handle injected flag, clears its receive buffer, closes the socket, and returns `PAM_IGNORE`.
- If the verifier is absent, slow, malformed, expired, replayed, disabled, or rejects any binding, the module leaves the sentinel unchanged and returns `PAM_IGNORE`. The unchanged `pam_unix` path treats it as a wrong password. The standard PAM conversation remains technically intact for emergency recovery and proof; agents do not redirect routine login to it.

`common-auth`/`pam_unix` remains the password verifier. `common-account` still enforces lockout, expiry, and account policy. `pam_gnome_keyring` receives the validated cached token exactly as on the standard password path. The post-keyring `mode=clear` hook clears `PAM_AUTHTOK` only when the per-handle injected flag exists, then returns `PAM_IGNORE`; it never clears a non-broker token.

No claim is made that the login keyring always unlocks: its password must match the account password and the installed `pam_gnome_keyring` behavior must be proven on the target image.

### Challenge, envelope, and verifier

A dedicated restricted SSH principal accepts only a forced ingestion command: no shell, PTY, forwarding, agent forwarding, accepted caller environment, or caller-selected arguments. Before envelope creation, the broker obtains a random verifier challenge and current boot ID. The verifier starts a maximum 20-second deadline measured with `CLOCK_BOOTTIME`; synchronized Mac/Ubuntu wall clocks are not trusted.
The GDM credential envelope MUST use signed HPKE/AEAD protection under the reviewed GDM keys and policy digest; encryption without the authenticated signature and complete target transcript is invalid.

The verifier challenge record and envelope form one closed cryptographic transcript. The transcript binds protocol version, verifier challenge, request ID, one-shot nonce, policy digest, sentinel hash, issue ID, ciphertext, and the complete canonical GDM target: pinned SSH host key and machine identity, verifier-local boot ID, username and UID, `gdm-password`, expected seat, observed TTY, required empty/local RHOST state, GDM greeter generation, and JetKVM device identity and controller-session generation. These values MUST be carried directly in signed AEAD data or represented by a canonical challenge-state digest included in both the AEAD associated data and signature; an unsigned server-side lookup is not a binding. The password remains ciphertext even inside SSH stdin.

The root verifier uses separate ingestion and claim Unix sockets. The ingestion side is restricted to the forced-command service principal and sees ciphertext only. The claim socket is root-only. Before storing the decrypted password in one locked, nondumpable, memory-only pending record, the verifier validates framing bounds, signature, AEAD, key allowlist, request ID/nonce uniqueness, policy digest, challenge, and every bound GDM target field against its live verifier/controller state.

On claim it obtains `SO_PEERCRED`, requires UID 0, and while the peer lives verifies that the PID is the packaged `gdm-session-worker` in the expected cgroup/ancestry. It then compares the live PAM claim and current verifier/controller state with the authenticated transcript: request ID/nonce, policy digest, service, user/UID, seat, TTY, RHOST, host/machine/boot identity, sentinel/challenge, greeter generation, and JetKVM device/controller generation must all match exactly. The pending record atomically transitions to consumed before plaintext is written; one concurrent claimant can win. Disconnect or `pam_set_item` failure consumes the record. Expiry, daemon restart, key rotation, policy change, disable, or boot change purges it.

The broker password never traverses JetKVM HID, WebRTC, Chrome/CDP, DOM, clipboard, argv, environment, stdout/stderr, logs, receipts, persistent queues/databases, or crash/core artifacts. Plaintext necessarily exists transiently in privileged broker, verifier, PAM, `pam_unix`, and keyring memory; this design does not claim perfect RAM zeroization.

## Passwordless signed sudo domain

Sudo authorization is not a credential-release path. The broker does not retrieve, transmit, or print a sudo password.

A root-owned Ubuntu verifier accepts a signed, short-lived exact-action request under the separate sudo key and policy. It atomically consumes the nonce, validates host, machine, boot, user, principal, policy digest, action ID, absolute executable, and argument-vector digest, and then calls `execve` directly with a fixed minimal environment. There is no shell, `bash -lc`, PATH lookup, generic command string, wildcard, caller environment, or credential-bearing argument.

Routine fixed actions may redeem standing grants. Destructive or irreversible exact actions require fresh Touch ID and one-shot authorization. Unknown or changed actions fail closed. This is not blanket passwordless sudo, a reusable root shell, or a general `NOPASSWD` grant.

### Model-assisted exact-action autoreview

Every typed sudo request and every typed destructive or irreversible broker action MUST pass this ordered pipeline before authorization:

1. A deterministic parser and closed schema canonicalize one exact registered action and reject shell strings, PATH lookup, wildcards, credential-bearing arguments, excess fields, target drift, stale nonce/expiry, or an absent required grant.
2. Deterministic policy assigns the hard risk floor and required authorization ceiling.
3. A dedicated semantic-review session examines the complete canonical request and bounded intent, grant, effects, preconditions, dry-run, and diff evidence. It receives the exact closed canonical action object that the broker will execute, with a digest over that complete object, rather than a summary or proposed-action prose. The reviewer runs under fixed policy instructions with read-only inspection of only those supplied inputs, approval policy `Never`, no credential-revealing or mutation tools, no nested approvals, no arbitrary MCP servers, apps, plugins, skills, memories, collaboration, or web search, and no inherited execution-policy rule or parent-session capability that could broaden access. Transcript, tool, action, and model-supplied evidence is untrusted data, never instructions or proof of authorization.
4. The broker combines both decisions. Deterministic policy is the sole permit authority. The reviewer may veto or escalate, but MUST NOT widen authority, lower risk, approve an unregistered action, infer authorization from evidence, or replace required Touch ID.

Routine registered operations inside active grants may run unattended only when deterministic policy permits and autoreview returns a structured `allow`. Destructive or irreversible operations still require fresh Touch ID and one-shot authorization even after `allow`; reviewer denial blocks them. Unknown or changed actions require policy expansion and fresh Touch ID, never model improvisation.

The broker emits a closed structured review result containing only review ID; canonical request/body digest; reviewer model/build/prompt-policy digest; `risk` (`low`, `medium`, `high`, or `critical`); `userAuthorization` (`unknown`, `low`, `medium`, or `high`); `status` (`completed`, `failed`, or `cancelled`); `outcome` (`allow`, `deny`, `escalate`, or `blocked`); `reasonCode` (`semantic_allow`, `semantic_deny`, `semantic_escalate`, `timeout`, `cancelled`, `model_failure`, `session_failure`, `provider_failure`, `transport_failure`, `parse_failure`, `missing_evidence`, `prompt_injection`, `digest_mismatch`, `truncated_input`, `omitted_security_field`, `canonical_action_unreconstructable`, or `reviewer_setup_failure`); bounded reason/rationale; attempt count; timestamps; and expiry. `completed` is valid only with a semantic `allow`, `deny`, or `escalate`; every operational or input-integrity failure has `outcome=blocked`, cancellation has `status=cancelled`, and every other blocked failure has `status=failed`. A reviewer `allow` records semantic assent only and is never an execution permit. Extra, missing, inconsistent, or malformed fields fail closed. Durable receipts MUST NOT include raw transcript, secrets, credentials, environment, URLs/query strings, shell text, or command output.

Before review, the broker MUST losslessly serialize and reconstruct the same typed canonical action object that would be executed and MUST verify its complete digest. Any truncation in a supplied review input, omission of any security-relevant field, digest mismatch, stale session, missing evidence, or inability to reconstruct the exact canonical action fails closed with its distinct `reasonCode`; none is telemetry-only. Suspected prompt injection also blocks and is recorded distinctly.

Review uses at most three attempts under one shared 90-second monotonic deadline, including backoff. A retry is permitted only for an explicitly classified transient provider or transport failure, or strict-result parse drift. A valid semantic `allow`, `deny`, or `escalate` is final and is never retried; cancellation, timeout, reviewer-setup failure, unclassified model/session failure, missing evidence, prompt injection, digest mismatch, truncation, omitted security fields, and canonical-action reconstruction failure are also never retried. Exhaustion preserves the last underlying failure `reasonCode`, attempt count, and `outcome=blocked`; it cannot become permission or a generic semantic denial.

The circuit breaker counts every non-cancelled blocked review attempt, including semantic denial or escalation and every operational or input-integrity failure. Denied and failed reviews increment the consecutive and rolling blocked-attempt counters and MUST NOT reset either counter; only a completed semantic `allow` may reset the consecutive counter, never the rolling history. Cancellation is handled separately: it immediately aborts the request and all pending retries, emits `status=cancelled`, `outcome=blocked`, and `reasonCode=cancelled`, does not count as abuse, and does not reset either breaker counter. Once the fixed threshold is reached, the broker interrupts further review in that session/turn. Agents and the broker MUST NOT evade any blocked outcome by semantically equivalent rephrasing, action splitting, alternate tooling, a new reviewer, or rerouting.

The deterministic risk lattice is:

- **routine:** registered, reversible, bounded status/restart/repair under an active grant; autoreview may allow unattended execution, while denial stops or escalates;
- **mutating:** registered, bounded install/config/write with rollback and the same exact action family and target; minimum `medium`, with Touch ID whenever deterministic policy requires it;
- **destructive:** deletion, formatting, authentication/PAM/SSH/firewall changes, account security/2FA changes, power/firmware actions, broad package removal, key rotation, payment/spend, or unbounded host impact; fresh Touch ID is mandatory, reviewer approval is advisory, and denial blocks;
- **prohibited:** credential export, profile copy, public CDP, plaintext password storage, generic root shell, arbitrary interpreter/shell, 2FA disable, or denial bypass; no override exists.

This design adapts Codex guardian's [reviewer mode](https://github.com/openai/codex/blob/44d76c6a6dd04fa2efc302b906ac8774267a1272/codex-rs/protocol/src/config_types.rs#L154-L183), [routing](https://github.com/openai/codex/blob/44d76c6a6dd04fa2efc302b906ac8774267a1272/codex-rs/core/src/guardian/review.rs#L136-L169), [untrusted-transcript and exact-action prompt](https://github.com/openai/codex/blob/44d76c6a6dd04fa2efc302b906ac8774267a1272/codex-rs/core/src/guardian/prompt.rs#L102-L240), [fail-closed review](https://github.com/openai/codex/blob/44d76c6a6dd04fa2efc302b906ac8774267a1272/codex-rs/core/src/guardian/review.rs#L222-L253), [circuit-breaker behavior](https://github.com/openai/codex/blob/44d76c6a6dd04fa2efc302b906ac8774267a1272/codex-rs/core/src/guardian/review.rs#L335-L526), and [model selection](https://github.com/openai/codex/blob/44d76c6a6dd04fa2efc302b906ac8774267a1272/codex-rs/core/src/guardian/review.rs#L645-L716). The local contract is stricter: autoreview never creates authority, overrides deterministic policy, approves an unregistered command, or substitutes for mandatory Touch ID.

The stdout-password, unattended Keychain-read, reusable lease, askpass, and root-shell paths are legacy bootstrap mechanisms, not broker capability fallbacks. They MUST be removed from the installed runtime before `signedSudo` may become active; activation of `gdm`, `bitwardenUnlock`, or `websiteAutofill` alone does not retire or authorize them.
While `signedSudo` is inactive, the only agent-authorized legacy bootstrap transport is the one-shot command path in `/Users/arthur/dotfiles/server/ubuntu-remote/framework-remote-sudo-askpass.sh` with SHA-256 `32536386cdb9300bd9d1bb99be132b0680c292a8cbc888ebe7a3bf39285c553d`, using `/Users/arthur/dotfiles/server/ubuntu-remote/remote-sudo-touchid-keychain.swift` with SHA-256 `407fd77481ea41056783b28cb98274c5730f9f77a3f8a1a67f9e11a7a0e18c22`. Its public `--help` controls argument spelling and ordering only. Agent use is limited to the direct run form with explicit host `desktop`, user `arthur`, a nonempty accurate reason, and one simple exact install, focused-proof, or repair command for an inactive capability being activated, or one exact disable/rollback command for that activation work, after `--`; the credential read for that run requires fresh Touch ID. This exception remains narrow even when another capability, including `gdm`, is active.

Every other helper mode is outside agent authority: setup/forget, password-prompt, session authorize/status/end, leases, `read-unattended`, credential caching/writes, generic or interactive root shells, and caller-selected shell syntax are forbidden. The pinned helper's fixed internal shell transport is tolerated only for that single simple exact command; it does not authorize shell metacharacters, compound commands, pipelines, redirection, substitution, encoded commands, or a root-shell session. Any path, digest, host/user, mode, purpose class, credential behavior, or command-shape widening requires a new policy review and policy digest; changed `--help` text cannot grant it.

## Browser and Bitwarden boundary

Bitwarden unlock is permitted only inside the attested official extension in the dedicated remote Chrome profile. Immediately before and after injection, the broker revalidates Chrome executable, service, graphical session, process, profile, browser target/window, extension ID/version/source/manifest digest, and unlock UI target. Any drift cancels the request and invalidates the applicable grant.

The unlock secret stays inside `remote-authd` and broker-private CDP frames. OMP, browser tools, page scripts, screenshots, DOM snapshots, accessibility trees, logs, and receipts never receive it or inspect the destination input value.

Website autofill invokes the official extension's normal active-tab autofill for one exact opaque credential-pairing ID and finite allowlisted HTTPS origin set. The broker does not read vault items or return a site password. Redirect, iframe, active-tab, frame, form-action, foreground/window, and extension state are revalidated at effect time. A changed target is a rejection, not a request to reselect automatically.

Broker-mediated Bitwarden unlock and exact-origin autofill are the only authorized routine secret paths. CAPTCHA, 2FA, passkey, recovery, payment, consent, security-setting change, account selection with material ambiguity, suspicious-login challenge, and a new origin require explicit Arthur confirmation unless a later separately reviewed capability says otherwise. Ordinary browser/CDP/CuaDriver tools are never a fallback for broker secret operations, and an inactive browser capability is infrastructure to repair rather than a reason to ask Arthur to perform the routine secret step.

A compromised approved origin can read a credential intentionally autofilled into that origin. This is an accepted explicit residual, which is why grants bind finite credential↔origin pairings and new origins require a new approval.
After Bitwarden unlock or website autofill begins, the credential-bearing browser target remains broker-quarantined from every ordinary browser, DOM, network, screenshot, accessibility, and OS-automation tool. A terminal execution receipt and target revalidation are not sufficient to release it. The broker may release the target only with a nonsecret attestation bound to the request ID and target generation that credential-bearing input, document, request, and network state has been destroyed. If that destruction cannot be attested, the broker must close the target and attest closure; ordinary automation may resume only in a fresh nonsecret target. If neither destruction nor closure can be proven, the target remains barred.

## JetKVM: singleton, nonsecret actuator

Exactly one supervised broker-owned controller owns a JetKVM device's WebRTC session. Direct cmux/OMP JetKVM pages are prohibited. The controller:

- pins device and TLS identity;
- uses a monotonically increasing owner generation;
- routes ICE to the correct session rather than a global current-session variable;
- synchronously revokes old HID ownership and resets all keys/buttons on transition;
- binds control requests to nonce, expiry, and generation;
- redacts HID payload logs; and
- exposes credential-free status, snapshot, HID, and reboot receipts.

For GDM, JetKVM selects the intended user, types only the high-entropy nonsecret sentinel into the selected password prompt, and submits. Credential bytes never enter JetKVM, Chrome, WebRTC, or HID. A stale session, focus race, or fake prompt can capture or consume only a one-shot sentinel and cause denial of service.

## Threat model and residual risks

| Threat | Required control | Residual |
|---|---|---|
| Malicious page or DOM spoofing | No secret reaches page automation; official-extension attestation; exact origin/frame/action/window binding; pre/post validation. | An approved compromised origin can read its intentionally autofilled credential. |
| Prompt substitution or focus race | Exact target/window/session checks; GDM uses only a nonsecret sentinel; drift cancels. | PAM has no cryptographic proof of visible pixels. Prompt theft may consume the attempt or cause denial of service. |
| Compromised extension | Pin official ID/version/source/manifest digest and invalidate on drift. | A correctly attested but upstream-compromised release is a supply-chain residual requiring revocation/update review. |
| Stale JetKVM/ICE session | Singleton owner generation, per-session ICE, synchronous ownership revocation, key/button reset, nonce/expiry. | Firmware/device compromise and transient nonsecret input misdelivery remain possible. |
| Replay/body swap | One-shot nonce, canonical body hash, atomic claim/consume, expiry, boot and owner-epoch binding. | Endpoint unavailability can fail an operation; it cannot authorize it. |
| Local unprivileged impersonation | Owner-only sockets, peer PID/UID and code identity, `SO_PEERCRED`, GDM worker executable/cgroup checks. | Root compromise is out of scope; root can instrument GDM and read privileged state. |
| Secret persistence/observation | No agent-visible value or persistent secret record; locked/nondumpable buffers; bounded framing; zero-before-free review; canary scan. | Plaintext exists transiently in required privileged memory; perfect compiler/library zeroization is not claimed. |
| PAM/module failure | Optional module, short local timeout, unchanged standard stack, guarded conffile patch, armed rollback. | A module crash, loader/ABI defect, or bad package can temporarily break GDM. |
| Sudo escalation | Separate key/domain, closed action registry, exact absolute executable/argv digest, direct `execve`. | A flawed allowlisted executable/action remains privileged attack surface and must be reviewed. |
| Broker compromise | Signed build/code identity, Keychain access control, policy digest, local revocation/disable, minimal surfaces. | Broker compromise is credential-authority compromise; emergency disable and key rotation limit continuation, not past disclosure. |

Machine/boot identity, PAM seat/TTY, executable path, cgroup, and owner epoch are strong contextual bindings, not remote attestation. The design makes no cryptographic pixel-identity claim.

## Lifecycle and failure semantics

The public broker surface must provide, with strict schemas:

- status and exact loaded policy/build digest;
- request submission, state, and cancellation;
- grant list, revoke, and expiry;
- credential forget;
- emergency disable; and
- Touch-ID-gated re-enable.

Cancellation, revocation, forgetting, expiry, and emergency disable are local transactions and must work while Ubuntu, Chrome, JetKVM, SSH, or providers are down. Local cancellation immediately prevents any further release for that request. Emergency disable immediately prevents every new release, invalidates grants, revokes local actuator ownership, closes private sessions where possible, and resets JetKVM keys/buttons; it never waits for a remote acknowledgement before becoming locally effective.

Local effectiveness is not a claim that already-ingested remote work was recalled. A GDM envelope already accepted by the verifier and a sudo request already consumed or passed to `execve` remain explicitly in-flight in their execution receipts. They MUST NOT receive a terminal `cancelled` or `disabled` request receipt until the verifier acknowledges that no effect can occur or authenticated verifier state establishes remote monotonic expiry or consumption and the truthful outcome. If consumption or execution occurred, the terminal state reports the actual success/failure/expiry outcome rather than retroactively claiming cancellation. While disconnected, the local control receipt may record that cancel/disable was accepted, but the affected execution receipt remains `executing`.

All endpoint errors fail closed. An unavailable or inactive routine capability is faulty or incomplete infrastructure: block the operation and route focused repair under this policy rather than asking Arthur to perform routine credential entry. Independent SSH/TTY and the unchanged standard PAM path are retained solely for emergency recovery and proof, not as agent-selected broker fallbacks. No implementation may fall back to password output, clipboard, DOM typing, OS typing, ordinary browser tools, local Chrome, generic SSH shell, or broader sudo.

## Capability-scoped proof matrix

No row may be marked complete by unit compilation alone. Every proof artifact must name the capability, running build, and capability policy digest and must contain no credential material. A capability needs only the common controls it exercises and the rows assigned to it; unrelated rows are not activation prerequisites.

| Area | Applies to | Required focused proof before that capability activates |
|---|---|---|
| Schema and principal | all capabilities, scoped to the operation under review | Strict decode and excess-field rejection; malformed/canonicalization cases; nonce replay; expiry; body conflict; stale owner epoch; peer PID/UID/code mismatch; grant scope/risk; policy drift; and rejection of a request in the wrong capability/domain. |
| Lifecycle while disconnected | each capability, scoped to its remote effects | Cancel, revoke, expire, forget where applicable, emergency-disable, and re-enable while its endpoints are unavailable; prove local release stops immediately and already-ingested GDM/sudo work remains in-flight until verifier acknowledgement or authenticated remote monotonic expiry/consumption, without a premature terminal receipt. |
| Secret canary | `gdm`, `bitwardenUnlock`, `websiteAutofill` separately | A canary credential is absent from every output, argument, environment, log, journal, receipt, tool result, URL/query, screenshot/snapshot, DOM/input, browser-storage, SSH, PAM, verifier-persistence, and JetKVM channel reachable in that capability's path. |
| Isolated PAM | `gdm` | Real Ubuntu 24.04 account, PAM conversation, packaged module, and real Unix sockets: valid/invalid standard password token; daemon down/slow; valid sentinel; wrong injected password still fails in `pam_unix`; bad signature/ciphertext/bindings; malformed/oversized frame; replay/expiry; restart/boot purge; two concurrent claims with exactly one winner; account restrictions match the standard path. |
| Live GDM and keyring | `gdm` | Guarded exact `/etc/pam.d/gdm-password` patch with rollback armed and rescue access open; sentinel login starts the graphical session; `pam_unix`/`common-account` remain decisive; disposable matching login keyring unlocks via Libsecret; expired sentinel fails and the unchanged standard PAM path succeeds in controlled proof; locked/expired account denied; reboot rejects old envelope; rollback restores the exact prior file. This proof stops at a truthful established desktop/keyring session and does not require Bitwarden, website autofill, signed sudo, Chrome CDP attachment, or a background browser target. |
| JetKVM GDM actuator | `gdm` | A/B ownership replacement, ICE misbinding, request replay, reconnect, frozen frame, malformed packet, modifier/button reset, payload-log redaction, and proof that only the nonsecret sentinel reaches HID. |
| GDM end to end | `gdm` | A fresh policy-loaded OMP session performs one broker GDM login through the signed HPKE/AEAD envelope and one-shot PAM claim, reaches the intended graphical session, and proves replay, expiry, target drift, and verifier unavailability fail closed while the standard PAM path remains intact for emergency recovery proof. |
| Chrome readiness | `bitwardenUnlock`, `websiteAutofill` separately | Reject rogue listener, wrong executable/profile/password backend, duplicate process, wrong graphical session, locked keyring, extension drift, browser target/window drift, and focus/session change. The prerequisite graphical session must already pass readiness checks or be established by active `gdm`; `gdm` status grants no browser-secret authority. |
| Bitwarden unlock | `bitwardenUnlock` | Test vault: attested official-extension unlock; executable/profile/session/extension/target/window/focus drift rejection; proof that the unlock secret and vault items are never returned; and proof that ordinary tools cannot enter the credential-bearing target until broker-attested secret-state destruction or broker-attested closure followed by a fresh nonsecret target. |
| Website autofill | `websiteAutofill` | Test vault plus disposable origins: exact opaque credential pairing and finite HTTPS-origin allowlist; redirect/iframe/form-action/malicious-DOM/focus cases; changed-extension and new-origin rejection; proof that vault items/site passwords are never returned; and the same target quarantine, destruction, and closure proof. An unlocked vault is an execution precondition, not authority inherited from `bitwardenUnlock`. |
| Sudo verifier | `signedSudo` | Reject wrong key/domain/host/boot/user/policy/action/nonce/expiry, shell, PATH lookup, unknown/wildcard action, caller environment, and credential argv; directly execute one safe registered exact action; destructive action requires fresh biometric one-shot. |
| Autoreview | `signedSudo`, and any separately activated destructive/irreversible capability action whose policy invokes review | Linked evidence for ordered deterministic parsing/policy as sole permit authority, capability-locked semantic review, veto/escalation-only combination, complete canonical-action round trip and digest, strict result parsing, retry classification, cancellation, and breaker accounting. GDM login proof and review do not depend on this row. |
| Independent review | each capability separately | A named accountable security reviewer signs off that capability's request/grant/receipt closure, applicable domain separation, linked focused proof, canary evidence where applicable, rollback, and residual claims. GDM review covers PAM order and `PAM_IGNORE`, signed envelope/bindings, verifier behavior, JetKVM sentinel handling, and GDM rollback; it does not wait for browser or sudo review. |

## Per-capability deployment, activation, and restart semantics

The current status matrix is intentionally published with every capability `DESIGN/INACTIVE`; it authorizes no broker operation today. Each row may change independently.

A capability becomes active only when all of its own conditions are true:

1. its implementation and every shared component it actually exercises are complete with no secret-visible or broader-authority compatibility path for that capability;
2. its applicable focused-proof rows and a separate named accountable independent security-review sign-off are linked from this document;
3. this matrix publishes that capability as `ACTIVE` with its reviewed capability policy digest;
4. every changed artifact in that capability's dependency set is installed, its owning LaunchAgent/service is restarted, and public status reports that capability active with the exact running build identities and policy digest; and
5. OMP starts in a fresh session after that capability's active policy/skill set and the installed or changed `remote_auth` extension support needed by that capability are in place.

For `gdm`, the dependency set is the signed broker GDM path, strict OMP `gdm-login` surface, GDM verifier, PAM module and guarded conffile, JetKVM controller, installer, rollback, and their shared controls. Its proof and review are the common GDM-scoped rows plus isolated PAM, live GDM/keyring, JetKVM GDM actuator, GDM end to end, and independent GDM review. `gdm` activation MUST NOT wait for Chrome readiness, Bitwarden/autofill proof, the sudo verifier, sudo autoreview, removal of the legacy sudo bootstrap, or any other non-GDM artifact.

For `bitwardenUnlock`, `websiteAutofill`, and `signedSudo`, only the matching active row authorizes the matching operation. Shared broker availability or active `gdm` is evidence of neither completion nor authority for them. `bitwardenUnlock` and `websiteAutofill` also do not authorize one another.

An existing OMP session cannot acquire a capability by rereading a changed file, loading a skill, installing/changing relevant extension support, installing an artifact, restarting a service, or observing a later status transition. Installing without restarting an affected service, restarting without installing its changed artifact, or installing/changing relevant extension support after session start fails that capability's gate. Unrelated capability changes do not force an otherwise valid capability to wait or restart unless they changed a shared artifact in its dependency set.

If any capability-specific public status, proof, digest, installed-build/restart evidence, extension support, or fresh-session condition is absent, ambiguous, or contradictory, agents MUST treat that capability as inactive. A conflict about a shared artifact fails closed for every capability that depends on that artifact, but does not authorize or silently deactivate an unrelated capability.

Changed artifacts must be installed and their respective LaunchAgent or Ubuntu services restarted before public status may claim that build for an affected capability. A PAM conffile/module change additionally requires the guarded install and live rollback protocol; it is never made opportunistically during login. Chrome/extension or target identity drift invalidates only applicable browser grants and requires the applicable browser readiness proof again, not a silent restart or a change to `gdm` status.

Rollback or emergency disable returns the affected capability to a blocked infrastructure state. While `signedSudo` is inactive, the legacy Touch-ID bootstrap may remain only for the narrow install/focused-proof/repair of an inactive capability being activated and disable/rollback of that activation work. It remains narrow after `gdm` activation and is never a fallback for a broker operation. It MUST be absent once `signedSudo` activates.

## Current per-capability behavior

- `gdm` is `DESIGN/INACTIVE`: routine GDM login automation is blocked; repair the capability rather than asking Arthur for routine password entry.
- `bitwardenUnlock` is `DESIGN/INACTIVE`: routine Bitwarden unlock is blocked; repair the capability rather than asking Arthur to unlock it.
- `websiteAutofill` is `DESIGN/INACTIVE`: routine credential autofill is blocked; repair the capability rather than asking Arthur to fill credentials.
- `signedSudo` is `DESIGN/INACTIVE`: signed sudo is blocked; the legacy helper is limited to the exact activation-bootstrap contract above.
- Agents do not type, retrieve, inspect, or broker credentials through JetKVM, browser, DOM, OS input, clipboard, output, or logs for any inactive capability.
- Remote Chrome may attach only after its setup `check` and `status` pass and the graphical-session/keyring/profile prerequisites are already satisfied or were established by active `gdm`. Missing prerequisites are infrastructure faults to repair, never authority for weakened storage, local fallback, or routine human credential entry.

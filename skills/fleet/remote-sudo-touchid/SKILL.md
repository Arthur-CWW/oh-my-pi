---
name: remote-sudo-touchid
description: Legacy Touch-ID sudo bootstrap used only while the remote-auth broker's signedSudo capability is inactive, for exact install/focused-proof/repair of an inactive capability being activated or disable/rollback of that activation work. Retire it only when signedSudo activates.
---

# Remote sudo with Touch ID

First load and follow [`remote-authentication-broker`](../remote-authentication-broker/SKILL.md). It is the sole conditional authority for sudo authorization.

## `signedSudo` status split

### `signedSudo` inactive

`signedSudo` is inactive unless its own canonical status is `ACTIVE` with a reviewed policy digest and linked focused proof/review, its changed dependency artifacts were installed and restarted, public status reports its exact running builds/digest, relevant extension support was in place, and this OMP session started fresh afterward. Missing, ambiguous, or contradictory evidence fails `signedSudo` closed.

The current `signedSudo` status is `DESIGN/INACTIVE`. While it is inactive, the checked-in remote-sudo helper is a **legacy bootstrap tool only**. It may be used solely for one exact install, focused-proof, or repair command for an inactive broker capability being activated, or one exact disable/rollback command for that activation work.

It is not authority for a broker operation, routine unattended administration, an away window, a general root session, unrelated automation, or fallback. Activation of `gdm`, `bitwardenUnlock`, or `websiteAutofill` neither retires nor broadens this exception.

### `signedSudo` active

Do not invoke the legacy helper. Use only the broker's separate passwordless `signedSudo` domain through the installed broker's public interface.

Before `signedSudo` may claim activation, the old password-to-stdout, unattended credential read, askpass, reusable lease, and shell/root-`bash -lc` paths must be removed from the installed runtime. If any remains callable, `signedSudo` is inactive or drifted: stop, use its public emergency-disable operation if available, and report the inconsistency. Never retain or use a compatibility fallback.

## Legacy bootstrap contract while `signedSudo` is inactive

The sole reviewed agent bootstrap transport is:

- `/Users/arthur/dotfiles/server/ubuntu-remote/framework-remote-sudo-askpass.sh`, SHA-256 `30fdef5715f2da0d662057a6b0e352916bb5f3fee72d6aa612c3848cd1db252e`;
- its adjacent `/Users/arthur/dotfiles/server/ubuntu-remote/remote-sudo-touchid-keychain.swift`, SHA-256 `78e2bad9e1b0b160ddaca68846149be1b4c46d0d86976872e327f0b1af75df1d`;
- the shell helper's closed `--install-gdm-release RELEASE_SHA256` mode, only for one focused GDM install, where `RELEASE_SHA256` is exactly one lowercase 64-hex staged release digest and the helper fixes the target to `arthur@desktop`; and
- otherwise, the shell helper's direct one-shot run path for host `desktop`, user `arthur`, an accurate nonempty broker-bootstrap reason, and one simple exact command after `--`.

Read the shell helper's public `--help` immediately before use. Help controls only the spelling and ordering of the already-reviewed syntax; it is not policy authority and cannot add a permitted mode, purpose, host/user, credential path, command shape, or digest shape. A path/digest mismatch, missing help, changed mode set, or disagreement with this skill stops. Any widening requires a new review and canonical policy digest.

For a focused GDM install, use only:

```text
/Users/arthur/dotfiles/server/ubuntu-remote/framework-remote-sudo-askpass.sh --install-gdm-release RELEASE_SHA256
```

Do not supply `--host`, `--user`, `--reason`, `--`, a command, a path, or any other argument. Require the helper to display the expected staged release digest and fixed `arthur@desktop` target, classify the action as high risk, and present fresh Touch ID. The helper's fixed internal root transaction authenticates the staged deploy/common bootstrap sources against its embedded reviewed SHA-256 constants, copies and re-verifies them in a fresh root-owned `0700` directory, then executes that root-owned entrypoint. That entrypoint binds a fresh root-owned snapshot to `RELEASE_SHA256` and installs only from the snapshot. A mismatch or mutation stops. Never use the generic run path to install GDM.

For the otherwise unchanged one-shot run allowance:

- name the exact absolute command and arguments needed for install, focused proof, or repair of one named inactive broker capability being activated, or disable/rollback of that activation work;
- require the helper to classify it as high risk and present fresh Touch ID for that run; if it offers lease reuse, unattended read, a password prompt, or no fresh biometric, stop;
- use no compound command, shell metacharacter, pipeline, redirection, substitution, encoded command, caller-selected environment, wrapper, or attempt to influence classification; and
- end with that one execution or its failure.

Every other public or private mode is forbidden to agents, including setup/forget, password-prompt, session authorize/status/end, reusable leases, `read-unattended`, credential caching/writes, and direct invocation of the Swift helper. A missing stored credential is a stop and human setup boundary, not authority to run a setup/cache mode.

The pinned shell helper's generic run path contains a fixed internal root `bash -lc` transport. That legacy implementation detail is tolerated only for the single simple exact command allowance above while `signedSudo` remains inactive. The focused GDM mode separately contains only its fixed internal authenticated bootstrap transaction; it has no caller-provided command or path. Neither path authorizes an interactive/generic root shell, caller-supplied shell syntax, or a root-shell optional mode. Do not reproduce or invoke either transport directly.

Never independently request, read, print, capture, inspect, redirect, log, cache, or store the password, Keychain item, helper credential output, lease file, lease contents, or private helper state. Do not invoke macOS `security`, inspect runtime directories, place a credential in a shell variable, or expose it to agent context. Only the pinned helper may carry its credential inside the reviewed one-shot transport.

Do not add broad sudo, modify remote privilege policy to bypass rejection, split or wrap a command to lower its classification, or manufacture host parity. A rejected or unavailable bootstrap action stops; it does not justify a different privileged path.

## Active `signedSudo` contract

When and only when the `signedSudo` capability is active:

- routine registered exact actions may redeem a live closed standing grant unattended;
- destructive or irreversible exact actions require fresh Touch ID and biometric one-shot authorization;
- the request binds the live OMP principal, host/machine/boot/user, policy digest, registered action ID, absolute executable, and exact argument-vector digest;
- the root verifier validates the separate sudo signing domain and atomically consumes the nonce before direct `execve`; and
- no sudo password is retrieved, transmitted, printed, or consumed.

Never request a relative command, PATH lookup, shell, `bash -lc`, wildcard, pipeline, redirection, generic command string, caller environment, credential-bearing argument, or action outside the registered allowlist. A missing or insufficient grant is a rejection, not a prompt to widen the request or use the legacy helper.

Receipts are metadata only and must state whether the execution used delegated or biometric-one-shot authorization. They never contain command secrets, credentials, environment values, stdout/stderr payloads, or reusable authorization material.

## Stop conditions

Stop without fallback if `signedSudo` activation evidence disagrees; its policy/build/host/boot/user/action/principal drifts; its public interface is unavailable; a request expires or replays; an exact action is unregistered; or any legacy credential/lease/shell mechanism remains after `signedSudo` claims activation. While `signedSudo` is inactive, also stop if the proposed legacy use is not one exact permitted command for a named inactive capability's activation work or if any other capability's active status is presented as authority.

---
name: desktop-browser-automation
description: Operate the persistent Ubuntu GNOME and Chrome automation profile over Tailscale, including Touch ID-gated Bitwarden Google login through the package-owned broker.
---

# Desktop browser automation

Use this skill for browser/computer-use work on the fixed Ubuntu automation desktop.

## Source of truth

- Package: `packages/remote-auth-broker`
- Ubuntu installer: `packages/remote-auth-broker/ubuntu/scripts/remote-auth-ubuntu`
- Installed Ubuntu status command: `~/.local/bin/remote-auth-ubuntu status`
- Installed macOS authority: `~/Library/Application Support/RemoteAuthBroker/current/bin/remote-authctl`
- Tailscale desktop: `https://desktop.tail5eda3b.ts.net/vnc.html?autoconnect=true&resize=scale`

Never recreate this stack under `local/` or dotfiles. The package owns the Swift biometric authority, exact-field relay, GNOME VNC session, noVNC service, Chrome service, and agent-browser runtime.

## Runtime contract

Ubuntu user `arthur` runs:

- GNOME on TigerVNC display `:3`;
- noVNC on loopback `127.0.0.1:6081`, exposed tailnet-only by Tailscale Serve;
- persistent Chrome profile `/home/arthur/.local/share/chrome-agent`;
- Chrome CDP on Ubuntu loopback `127.0.0.1:9222`;
- `agent-browser` 0.20.2 against that existing CDP browser.

Normal browser automation runs remotely without VNC:

```sh
ssh desktop '~/.local/bin/remote-auth-ubuntu status'
ssh desktop 'agent-browser --cdp 9222 snapshot -i'
```

Use noVNC only for human-only CAPTCHA, passkey, 2FA, recovery, consent, or account ambiguity. Do not use the sluggish VNC canvas for routine automation.

## Touch ID-gated Google login

List available Google credentials without exposing passwords:

```sh
"$HOME/Library/Application Support/RemoteAuthBroker/current/bin/remote-authctl" \
  browser google-login --list
```

Log in one or more accounts with one Touch ID authorization for the batch:

```sh
"$HOME/Library/Application Support/RemoteAuthBroker/current/bin/remote-authctl" \
  browser google-login \
  --account arthur.wong1121@gmail.com \
  --account communal.ai@gmail.com
```

The broker stores only the short-lived `BW_SESSION` token in an owner-only `0600` state file under `~/Library/Application Support/RemoteAuthBroker/private/`. It never stores the Bitwarden master password. Touch ID gates every batch. Passwords travel only over SSH stdin to the package-owned Ubuntu exact-field helper; they never enter argv, environment, screenshots, snapshots, logs, agent context, or agent-browser's auth vault.

The Ubuntu helper requires the exact `https://accounts.google.com` password page, selected account evidence, one visible password field, and `#passwordNext`. It emits only `submitted` or a bounded error. Never replace this with generic `agent-browser auth login`: Google uses a two-step form, and generic form filling previously placed password material in the identifier field.

If macOS displays a Keychain password or “Always Allow” requester dialog, cancel it. Routine use should present only the native Touch ID prompt. Do not type a master password into an agent-driven prompt.

`gilgamesh1121@gmail.com` remains excluded until its password is rotated because an earlier failed generic form attempt exposed field contents to a diagnostic artifact.

## First-run and repair

Read-only health:

```sh
ssh desktop '~/.local/bin/remote-auth-ubuntu status'
```

Package install or repair from the repository:

```sh
cd packages/remote-auth-broker
scp -qr ubuntu desktop:.cache/remote-auth-broker-user-install/
ssh desktop '/bin/bash ~/.cache/remote-auth-broker-user-install/ubuntu/scripts/remote-auth-ubuntu install'
```

A missing or invalid saved `BW_SESSION` is not permission to retrieve or store the master password. Seed it through an explicit package migration or interactive owner action, then resume Touch ID-gated use.

## Bitwarden native-messaging boundary

Bitwarden's official browser biometric path is same-machine:

```text
browser extension → local com.8bit.bitwarden native host → local Bitwarden desktop IPC → local biometric API
```

Ubuntu Chrome cannot directly use Mac Bitwarden.app by configuration. A future package-owned bridge may register a Linux native host shim and transparently relay Bitwarden's encrypted native-messaging frames to the Mac desktop proxy. Upstream exposes no supported network endpoint; until such a bridge is implemented, use the package-owned `remote-authctl browser google-login` command above.

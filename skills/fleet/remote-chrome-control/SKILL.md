---
name: remote-chrome-control
description: Attach Puppeteer through an owner-only SSH streamlocal Unix socket to the dedicated Ubuntu Chrome profile. Active gdm may establish the graphical session; Bitwarden unlock and exact-origin autofill remain separate capability-gated secret operations with no Mac fallback.
---

# Remote Chrome Control

This skill is self-contained and does not depend on `browser-control` or `background-browser-automation` being enabled. It preserves their background-target, no-secret-capture, and human-verification boundaries directly below.

This is an **attach-only** workflow. Never install, start, restart, repair, or reconfigure Chrome as part of a browser task. Never launch a local browser as a fallback.

## Fixed security boundary

The remote service must use official `google-chrome-stable` with exactly one Chrome process for its dedicated profile:

- Linux user: `arthur`
- user-data directory: `/home/arthur/.local/share/chrome-agent`
- directory mode: `0700`
- password backend: `--password-store=gnome-libsecret`
- remote CDP listener: `127.0.0.1:9222`
- visible, already-running VNC/X graphical session

The display, D-Bus session, Secret Service, and unlocked GNOME Keyring/Libsecret are prerequisites. A missing or locked keyring is a hard failure: never select Chrome's basic/plaintext password store and never continue with a profile whose protected state cannot be decrypted.

Do not use the default Ubuntu Chrome profile. Do not copy, rsync, upload, restore, or inspect Chrome userdata, cookies, passwords, tokens, Keychain material, or profiles from the Mac. Do not enable Chrome Sync or transport profile backups. Routine website sign-in is an automation responsibility and must use the matching active exact broker/password-manager capability without exposing the secret to ordinary CDP, DOM, GUI, or accessibility tools. CAPTCHA, 2FA, passkey, recovery, consent, payment, security-setting change, suspicious-login challenge, new-origin approval, and materially ambiguous account selection still require Arthur. CDP has full control of the logged-in profile; treat the SSH key, tunnel, and endpoint as credential-bearing access.

Never bind CDP to `0.0.0.0`, a LAN address, or a Tailscale address. Never add a UFW rule, Tailscale Serve/Funnel route, reverse proxy, public/stable service endpoint, or Mac TCP listener for CDP. The only permitted path is Ubuntu Chrome on `127.0.0.1:9222`, forwarded by SSH to a fresh owner-only Mac Unix socket.

## 1. Resolve the remote setup contract

Use the dotfiles setup script as the sole authority; do not copy its service, display, package, profile, keyring, or process checks into this skill or ad-hoc commands. Inspect current usage first:

```sh
ssh desktop '~/dotfiles/server/ubuntu-remote/setup-remote-chrome.sh --help'
```

The expected interface includes `check` and `status`. If `--help` is unavailable, the script path differs, or either action is absent, stop and report the mismatch. Do not guess an action or remote path.

Run both read-only actions before opening a tunnel:

```sh
ssh desktop '~/dotfiles/server/ubuntu-remote/setup-remote-chrome.sh check'
ssh desktop '~/dotfiles/server/ubuntu-remote/setup-remote-chrome.sh status'
```

Both must exit successfully. The observed output must establish that the dedicated profile and owner/mode are correct, Chrome has a usable visible display and Secret Service/Libsecret session, the user service is healthy, exactly one service-owned browser process uses the profile, and CDP listens only on remote loopback. Treat script output as current evidence, not an invitation to reproduce its checks.

If Chrome is absent, stopped, unhealthy, duplicated, using another profile/password store, missing its display/keyring, or listening anywhere except `127.0.0.1:9222`, stop. Hand off setup or recovery to a human/operator using the script's documented workflow. Never automatically invoke `install`, `start`, `restart`, or another mutating action.

## 2. Establish a fresh fail-closed streamlocal tunnel

Use one fresh owner-only temporary directory containing both the SSH control socket and a distinct CDP streamlocal socket. Reject any pre-existing CDP path; never unlink or reuse one. `StreamLocalBindMask=0177` makes the created socket mode `0600`, and `StreamLocalBindUnlink=no` makes SSH fail rather than replacing an existing path:

```sh
umask 077
SOCKET_DIR="$(mktemp -d "${TMPDIR:-/tmp}/remote-chrome-cdp.XXXXXXXX")"
chmod 700 "$SOCKET_DIR"
CONTROL_SOCKET="$SOCKET_DIR/ssh-control"
LOCAL_CDP_SOCKET="$SOCKET_DIR/cdp.sock"

if [ -e "$LOCAL_CDP_SOCKET" ] || [ -L "$LOCAL_CDP_SOCKET" ]; then
  echo "refusing existing local CDP socket path" >&2
  exit 1
fi

ssh -M -S "$CONTROL_SOCKET" -fNT \
  -o ExitOnForwardFailure=yes \
  -o ClearAllForwardings=yes \
  -o StreamLocalBindMask=0177 \
  -o StreamLocalBindUnlink=no \
  -L "$LOCAL_CDP_SOCKET:127.0.0.1:9222" \
  desktop
ssh -S "$CONTROL_SOCKET" -O check desktop

[ -S "$LOCAL_CDP_SOCKET" ] &&
[ "$(stat -f '%u' "$SOCKET_DIR")" = "$(id -u)" ] &&
[ "$(stat -f '%Lp' "$SOCKET_DIR")" = 700 ] &&
[ "$(stat -f '%u' "$LOCAL_CDP_SOCKET")" = "$(id -u)" ] &&
[ "$(stat -f '%Lp' "$LOCAL_CDP_SOCKET")" = 600 ]
```

Every command must succeed. Do not omit either streamlocal option, broaden either mode, replace remote `127.0.0.1:9222`, use `GatewayPorts`, use a TCP proxy/listener, or reuse/unlink an unexplained path. If forwarding, control check, type, owner, or mode validation fails, close this SSH master and stop. Never try a local Chrome endpoint.

Keep both sockets and their protected directory until browser work finishes. Close only this tunnel with `ssh -S "$CONTROL_SOCKET" -O exit desktop`; then remove only `LOCAL_CDP_SOCKET`, `CONTROL_SOCKET`, and `SOCKET_DIR` after verifying they are still the expected paths owned by the current UID. Do not kill unrelated SSH sessions.

## 3. Preflight the tunneled CDP endpoint

Before importing or connecting Puppeteer, request `/json/version` with Node's `http` client using `socketPath: LOCAL_CDP_SOCKET`; do not create a TCP bridge. Bound the response size and require successful JSON with:

- a nonempty `Browser` value identifying Google Chrome;
- a nonempty `webSocketDebuggerUrl` whose parsed URL uses `ws:`, host `127.0.0.1`, port `9222`, and a `/devtools/browser/…` path; and
- a second successful `ssh -S "$CONTROL_SOCKET" -O check desktop` plus repeated socket type/owner/mode checks immediately before attachment.

The URL describes the Ubuntu loopback endpoint. Preserve only its path/query for the Unix-socket WebSocket handshake; never connect to its host/port from the Mac. Any timeout, oversized/malformed response, product mismatch, non-loopback websocket URL, failed SSH control check, socket replacement, or owner/mode drift is a hard failure. Close the tunnel and stop. Never probe default browser-use ports, `localhost:9222`, the Mac's Chrome profiles, or another browser executable.

## 4. Attach directly with a Unix-socket transport

Use Puppeteer's `transport` option, not `browserURL` or `browserWSEndpoint`. The transport must perform its WebSocket handshake over the protected Unix socket—for example, a `ws` client whose `createConnection` returns `net.createConnection({ path: localCdpSocket })`, wrapped as Puppeteer's `ConnectionTransport`:

```ts
const endpoint = new URL(version.webSocketDebuggerUrl)
if (
  endpoint.protocol !== "ws:" ||
  endpoint.hostname !== "127.0.0.1" ||
  endpoint.port !== "9222" ||
  !endpoint.pathname.startsWith("/devtools/browser/")
) {
  throw new Error("Unexpected remote CDP WebSocket endpoint")
}

const socket = new WebSocket(`ws://localhost${endpoint.pathname}${endpoint.search}`, {
  createConnection: () => net.createConnection({ path: localCdpSocket }),
})
await once(socket, "open")

const transport: ConnectionTransport = {
  onmessage: undefined,
  onclose: undefined,
  send(message) {
    socket.send(message)
  },
  close() {
    socket.close()
  },
}
socket.on("message", (data) => transport.onmessage?.(data.toString()))
socket.once("close", () => transport.onclose?.())

const browser = await puppeteer.connect({ transport })
```

Use Puppeteer directly (including through `node_repl` when appropriate). The omitted imports and bounded Unix-socket `/json/version` helper are ordinary local code, not permission to substitute a TCP proxy. Do not call a helper that launches a browser when attachment fails. In particular, do not use `browserURL`, `browserWSEndpoint`, an implicit/default `browser-use` connection path, `puppeteer.launch`, Playwright `launch`, the OMP browser tool without an explicit remote-CDP-only Unix-socket contract, `open`, or a local profile helper anywhere in this workflow.

If connection rejects, disconnects, or returns no browser target, close the tunnel and stop. Never recover by launching Chrome locally or remotely or by opening a Mac TCP forward.

## 5. Create only background targets

Do not use `browser.newPage()`. Find the browser target, create a CDP session, and request a background target:

```ts
const browserTarget = browser.targets().find((target) => target.type() === "browser")
if (!browserTarget) throw new Error("Remote Chrome browser target unavailable")

const client = await browserTarget.createCDPSession()
const created = await client.send("Target.createTarget", {
  url: requestedURL,
  background: true,
})
await client.detach()

const target = await browser.waitForTarget(
  (candidate) => (candidate as { _targetId?: string })._targetId === created.targetId,
  { timeout: 10_000 },
)
const page = await target.page()
if (!page) throw new Error("Remote Chrome page target unavailable")
```

Never call `Target.activateTarget`, `page.bringToFront()`, `Target.openDevTools`, or any OS-level click/type fallback. Keep the browser attached only as long as needed, close only targets created for the task when safe, then call `browser.disconnect()`—never `browser.close()`, which would terminate the persistent service browser.

## Authentication and broker boundary

Load [`remote-authentication-broker`](../remote-authentication-broker/SKILL.md) before any GDM, Bitwarden, credential-autofill, or privileged setup operation. Evaluate `gdm`, `bitwardenUnlock`, and `websiteAutofill` independently; there is no aggregate broker mode.

For each requested broker operation, the matching capability is inactive unless its canonical row is `ACTIVE` with its reviewed digest and focused proof, its independent review is linked, every changed artifact it uses was installed and restarted, public status reports that capability on the exact running builds/digest, relevant `remote_auth` extension support was installed or changed before session start, and this is a fresh OMP session afterward. Missing, ambiguous, or contradictory evidence fails only the affected capability closed. Another active capability is neither proof nor permission.

### Establishing the graphical session

When `gdm` is active, its public broker operation may establish the Ubuntu graphical session needed by this attach workflow. Wait for truthful terminal GDM success, then run the setup script's `check` and `status` exactly as required above. Active `gdm` authorizes no Chrome, Bitwarden, vault, autofill, DOM, CDP-secret, or privileged operation.

When `gdm` is inactive or its evidence is ambiguous, routine graphical-session establishment is blocked: report faulty or incomplete `gdm` infrastructure and route focused activation repair. Do not ask Arthur to perform routine GDM password entry, and never type or transport the password through JetKVM, Chrome/CDP, DOM, accessibility, OS input, clipboard, output, or logs. In all cases, do not attach until the visible graphical session, Secret Service/keyring, dedicated profile, service, process, and loopback listener pass `check` and `status`.

### Browser secret operations

`bitwardenUnlock` alone governs broker-mediated unlock of the attested official Bitwarden extension. `websiteAutofill` alone governs official-extension autofill for an exact approved credential↔HTTPS-origin pairing. Both are currently `DESIGN/INACTIVE`. Active `gdm` does not activate either; activation of one browser capability does not activate the other.

When the requested browser capability is inactive, the routine secret operation is blocked: report faulty or incomplete capability infrastructure and route focused activation repair. Do not ask Arthur to perform routine Bitwarden unlock, account login, or credential autofill. Ordinary tools must not click, type, inspect, verify, recover, or capture the secret step. An already-authenticated nonsecret target may still be used only when no login step is required and every setup check passes; never use an active capability or successful GDM login as fallback authority for the inactive browser capability.

When the matching browser capability is active, its broker-private CDP path owns that secret operation end to end. During it:

- do not use Puppeteer, Playwright, browser-use, the OMP browser tool, cmux browser, CuaDriver, accessibility, screenshots, snapshots, or OS typing to inject, observe, verify, or recover the secret step;
- do not read DOM/input values, cookies, tokens, auth headers/payloads, browser storage, raw query URLs, screenshots, or snapshots;
- do not foreground, activate, retarget, or race the approved tab/window/frame; and
- stop on executable/profile/session/extension/target/window/origin/frame/form-action/focus drift.

CAPTCHA, 2FA, passkey, recovery, payment, consent, security-setting changes, material account ambiguity, suspicious-login challenges, and new origins still require explicit Arthur confirmation. No broker capability delegates those boundaries.

Never bypass, script, replay, or outsource human verification. Never use a local Mac browser, native GUI automation, profile copy, direct vault-item retrieval, credential inspection, or fresh login as a fallback. After broker unlock/autofill begins, ordinary Puppeteer remains barred from that credential-bearing target even after a terminal execution receipt or repeated setup checks. Resume there only after a broker attestation bound to the request and target generation states that credential-bearing input, document, request, and network state was destroyed. Otherwise the broker must close and attest closure of that target, and ordinary work resumes only in a fresh nonsecret target; without either attestation, stay disconnected.

## Stop conditions

Stop and disconnect without further browser action if any invariant above fails; if the page unexpectedly foregrounds; if the remote setup script reports drift; if the SSH master is not the one that owns the protected streamlocal socket; if the socket path/type/owner/mode changes; if a requested broker capability is inactive or its evidence is ambiguous; if a broker operation is nonterminal, drifted, or lacks the required target-release/closure attestation; if Chrome requests credentials or verification outside the matching active browser capability; or if the task would require profile/service mutation. Report the failed stage and observed nonsecret error. Do not broaden network exposure, add a Mac TCP bridge, weaken keyring requirements, invoke ordinary browser/OS tools for a secret operation, or improvise recovery.

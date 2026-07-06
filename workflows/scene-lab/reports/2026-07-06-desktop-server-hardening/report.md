---
title: Desktop as always-on server — done + one sudo block for you
date: 2026-07-06
agent: Fable
status: needs-arthur
---

## Already done (no sudo needed)

| Item | State |
|---|---|
| sshd + tailscaled enabled at boot | Verified `enabled` + `active` (Ubuntu 24.04) |
| Tailscale key expiry | **Disabled** — no silent re-auth outages |
| User lingering | Enabled (`loginctl enable-linger arthur`) — your detached jobs / `systemd --user` units now survive logout |
| Mac `~/.ssh/config` | `desktop`/`desktop.eth` → MagicDNS `desktop.tail5eda3b.ts.net` (IP churn-proof), `desktop.ip` + `desktop.lan` fallbacks, X11 dropped (server forbids it — that warning is gone), keepalives 30s×4, ControlMaster multiplexing (instant repeat SSH) |
| sshd hardening | Already in place server-side: key-only, no root, `AllowUsers arthur`, keepalives |

## Run this on the desktop (needs your password; safe + reversible)

```bash
# 1. Auto-reboot on kernel panic/oops (10s delay)
sudo tee /etc/sysctl.d/90-server-panic.conf <<'EOF'
kernel.panic = 10
kernel.panic_on_oops = 1
EOF
sudo sysctl --system

# 2. Unattended-upgrades: allow automatic reboot at 4am when kernel updates require it
sudo tee /etc/apt/apt.conf.d/51-auto-reboot.conf <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF

# 3. Wake-on-LAN (LAN-power fallback; check support first)
sudo ethtool enp7s0 | grep -i wake     # "Supports Wake-on: ...g" = supported
sudo ethtool -s enp7s0 wol g
sudo tee /etc/systemd/system/wol@.service <<'EOF'
[Unit]
Description=Enable Wake-on-LAN on %i
After=network.target
[Service]
Type=oneshot
ExecStart=/usr/sbin/ethtool -s %i wol g
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now wol@enp7s0
```

## Not fixable from software

- **BIOS → Power → "Restore on AC Power Loss" → Power On.** Without this, a power cut leaves the box off until someone presses the button. This is the single highest-value toggle for "always available".

## Known cosmetic issue (skip unless you use exit-node/subnet routing)

Tailscale health warning: `ip6tables … MARK: bad value` (nf_tables backend quirk on 1.98.4). Basic connectivity unaffected. If it bothers you: `sudo tee /etc/default/tailscaled <<< 'FLAGS="--fw-mode=nftables"' && sudo systemctl restart tailscaled`.

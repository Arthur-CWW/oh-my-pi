# Incident — JetKVM and Ubuntu desktop recovery — 2026-07-23

> **Status:** Console and graphics resolved; persistent authenticated Chrome awaits one manual GDM password login.
> **Affected host:** `desktop` — ASUS TUF GAMING B550-PLUS WIFI II, Ryzen 5 5600G, RTX 3090.
> **User impact:** JetKVM showed black/no-signal states, Ubuntu did not reliably boot a graphical session, and the dedicated authenticated Chrome pool could not satisfy its display/keyring contract.

## What was wrong

The incident crossed independent layers; no single “GUI fix” explained every symptom.

1. **Boot policy:** a prior headless-server change left systemd at `multi-user.target`, so GDM was not a boot invariant.
2. **HDMI transport:** the original RTX HDMI port completed +5V/hot-plug/DDC/EDID but JetKVM reported no TMDS signal or receiver PLL lock. Moving to the other RTX port produced 1920×1080@60 immediately.
3. **Display ownership:** the Ryzen 5 5600G iGPU existed but was disabled/hidden in firmware, forcing GNOME/Chrome onto the RTX.
4. **Desktop authentication:** GDM autologin created a desktop without supplying a password to PAM, leaving GNOME Keyring/Secret Service locked.
5. **JetKVM control concurrency:** firmware owns one global WebRTC `currentSession`; a new browser surface evicts the old one, so parallel cmux/OMP viewers raced and appeared flaky.

## Changes made

### Ubuntu and GDM

- Restored `graphical.target`; SSH and ordinary multi-user services remain available.
- Disabled GDM autologin with `AutomaticLoginEnable=false`.
- Preserved `/etc/gdm3/custom.conf.pre-agent-20260723` as the rollback copy.
- Patched and deployed `~/dotfiles/server/ubuntu-remote/setup-remote-chrome.sh` so root-owned GDM session leaders can resolve the user-owned graphical environment and fill missing `DISPLAY`/`XAUTHORITY` from the user systemd manager. The dotfiles file already contained broader uncommitted work; this thread did not commit it.

### ASUS firmware

First audited save:

- `IGFX Multi-Monitor: Disabled → Enabled`
- `Primary Video Device: PCIE Video → IGFX Video`

Second audited save:

- `SVM Mode: Disabled → Enabled`
- `IOMMU: Auto → Enabled`
- `Restore AC Power Loss: Power Off → Power On`
- `Power On By PCI-E: Disabled → Enabled`

No ReBAR, DOCP, overclocking, storage, boot-order, Secure Boot, fTPM, PCIe-generation, or C-state settings changed.

### Repository

- Vendored official JetKVM source at `vendor/jetkvm/kvm`, upstream `fe77acd5f00300a4ab9acd5da57d7bb0916351d9`; landed change `pqolqpvlsxrz`, commit `586e50611fc5`.
- Canonical continuation and deferred queue: [`../../plans/desktop-resource-pooling.md`](../../plans/desktop-resource-pooling.md).

## Verified final state

Observed after the final reboot:

- JetKVM video ready at 1920×1080@60 from motherboard HDMI.
- AMD Cezanne iGPU: `boot_vga=1`, `amdgpu`, Xorg provider 0, monitor `HDMI-A-0`.
- RTX 3090: `boot_vga=0`, `nvidia`, display disabled, 0% utilization, 15 MiB VRAM used.
- `lscpu` reports AMD-V.
- `/sys/kernel/iommu_groups` contains 5 groups.
- Ethernet `enp7s0` reports `Supports Wake-on: pumbg` and active `Wake-on: g`.
- `graphical.target` and GDM are active.
- GDM presents a real user-selection screen; a manual password login is intentionally required to unlock Secret Service.

## Diagnostic order earned

1. Query JetKVM `getVideoState`.
2. Inspect +5V, DDC, TMDS, and PLL separately through `getVideoLogStatus`.
3. Identify the exact GPU connector by EDID and `xrandr`, not by assumed HDMI numbering.
4. Test another physical port/cable before changing operating-system policy.
5. Check `systemctl get-default`, GDM, and the owner graphical session.
6. Check D-Bus and Secret Service only after a password-backed login exists.
7. Keep one JetKVM controller session; do not open competing browser surfaces.

## Security boundary

The safe authenticated-browser flow remains: Arthur logs into GDM and provider login/2FA/passkey screens manually; automation attaches afterward. CDP stays on remote loopback and is reached only through an owner-only SSH tunnel. Do not expose CDP, copy the Chrome profile, downgrade to Chrome’s basic password store, or create an agent-readable Bitwarden/password broker.

## Remaining work

See the stable queue in [`../../plans/desktop-resource-pooling.md`](../../plans/desktop-resource-pooling.md) and the root [`../../../TASKS.md`](../../../TASKS.md). Immediate continuation: manual GDM login, then remote Chrome `check`/`status`, documented setup, loopback tunnel, and a background-target smoke test.

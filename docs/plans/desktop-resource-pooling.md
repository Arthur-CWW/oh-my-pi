# Desktop resource pooling and coordinator reclamation

## Priority

This is higher priority than the remaining prompt/roster polish. The Mac stays the interactive orchestration and native-macOS boundary. The Ubuntu desktop should own sustained browser/scraping pools, fuzz/property campaigns, full TUI stress suites, and other non-Mac-specific heavy QA whenever its health contract passes.

## Incident evidence — 2026-07-20

The Mac reboot was a watchdog panic during severe memory pressure, not a Yazi failure.

Panic process snapshot:

- Zed: 41.3 GiB resident.
- OMP processes: 6.76 GiB and 5.56 GiB for the two largest sessions, plus several smaller sessions.
- Multiple Difftastic processes: roughly 4.0–4.6 GiB each while jjui previewed the inherited whole-repo dirty diff.

The resumed coordinator later reached 17.85 GiB RSS with descendants totaling only about 0.27 GiB. `vmmap` was explicitly incomplete because macOS could not inspect Bun's allocator zone, so its category totals are not additive ground truth; it reported an 8.3 GiB physical footprint and 12.9 GiB peak. Two forced-GC heap snapshots sharpened the diagnosis: before report bundling, reachable JavaScript self-size was only 220.9 MiB despite 14–18 GiB RSS, strongly implicating native/JSC allocator retention in addition to application references. The second report grew reachable self-size to 692.2 MiB because it retained the first 165.4 MiB snapshot string, a 53.3 MiB Difftastic output string, and several whole session JSONL strings through the in-memory `Record<string,string>` report archive path. `/restart` remains the reliable reclamation boundary.

Immediate guardrails already applied:

- jjui no longer renders the giant intake diff through Difftastic.
- `task.maxConcurrency: 8`, `task.maxLiveChildren: 6`.
- `browser.maxTabsPerSession: 2`.
- New OMP version `16.0.1+fork.0bc2a7bf8184` only injects interrupted children on restart; full child discovery remains tool-driven.
- Heavy non-Mac work is recorded as desktop-first in `docs/state/agent-tooling-preferences.md`.
- `cmux memory --all --groups 15` already supplies bounded process-group attribution; the OMP report should complement it with in-process JSC/native categories rather than duplicate process-tree accounting.

## Required changes

### Coordinator memory

Add a bounded `:memory` report:

- coordinator RSS, heap used/total, external/array buffers;
- owned child worker RSS;
- browser/app process RSS;
- other owned subprocess RSS grouped by tool;
- retained transcript/tool-result/cache estimates where measurable;
- total and explicit reclaim action.

Add configurable automatic checkpoint/restart for session-backed coordinators at an idle turn boundary. It must never restart during a tool call, pending child settlement, active browser transaction, or unsaved in-memory-only session. Provide warning, grace, opt-out, and durable reason/evidence. Do not rely on blind forced GC.

### Desktop parity and dispatch

Dotfiles/mise are authority. Add one read-only parity report for:

- pinned mise tools;
- agents/dotfiles revisions or immutable source artifact;
- required runtimes/packages;
- disk/RAM/GPU health;
- remote Chrome and worker-service health.

Add explicit dispatch profiles for browser/scrape, fuzz/property, TUI stress/full QA, and GPU. Refuse dirty/mismatched source unless given an immutable commit/change artifact. Every run owns a remote process group, durable manifest/log, status/cancel command, and artifact retrieval.

## Desktop recovery evidence — 2026-07-23

The console/display blocker is resolved; the evidence and exact changes are in [`../state/incidents/2026-07-23-jetkvm-ubuntu-desktop-recovery.md`](../state/incidents/2026-07-23-jetkvm-ubuntu-desktop-recovery.md).

- Ubuntu boots `graphical.target`; SSH and ordinary server services remain available.
- The Ryzen 5 5600G iGPU owns the motherboard HDMI and GNOME display through `amdgpu`.
- The RTX 3090 display path is disabled by default and was observed idle at 0% utilization and 15 MiB VRAM.
- Firmware now enables IGFX multi-monitor, AMD-V, IOMMU, AC-loss auto-power-on, and PCIe wake. Ethernet magic-packet wake is active.
- GDM autologin is disabled so a real password login can unlock GNOME Keyring.
- JetKVM is verified at 1920×1080@60, but its firmware permits only one active WebRTC control session.

### Browser pool

Use the existing dedicated Ubuntu Chrome contract, not profile copying:

- official Chrome; owner-only dedicated profile;
- visible graphical session, GNOME Keyring/Libsecret;
- CDP only on remote loopback through an owner-only SSH tunnel;
- attach-only, background targets, no local fallback;
- task-group ownership for tabs so a group can be hidden/closed/reclaimed together;
- Gmail/X login is completed manually by Arthur in the visible Ubuntu session; never inspect/export cookies, passwords, tokens, or browser userdata.

Current blocker on 2026-07-23: GDM is presenting the real user-selection screen. Arthur must complete one password-backed graphical login so PAM unlocks Secret Service. Autologin, an empty-password keyring, Chrome's basic password store, credential copying, and an agent-readable Bitwarden broker are rejected shortcuts.

Human login/setup sequence:

1. Arthur logs into `arthur` on the visible JetKVM/GDM screen. Automation never types or retrieves the password.
2. From the Mac, rerun `~/dotfiles/server/ubuntu-remote/setup-remote-chrome.sh check` and `status`. If setup/recovery is still required, inspect the script's current `--help` and follow only that documented workflow; do not hardcode stale verbs or bypass its display/keyring/service checks.
3. Arthur signs into Gmail and X manually in the visible dedicated Chrome profile, completing account selection, CAPTCHA, 2FA, passkeys, consent, and password-manager UI himself.
4. Rerun `check` and `status`. Only then may OMP establish a fresh owner-only loopback tunnel, attach with Puppeteer, and create background targets. Any later login or verification boundary returns control to Arthur.


### JetKVM control plane

Current upstream behavior is exclusive, not multi-viewer: firmware stores one global `currentSession`; accepting a new WebRTC connection notifies and then closes the previous peer. Video, HID, USB, and device events target that singleton. Multiple cmux surfaces therefore evict one another by design. Upstream multi-user/viewer support remains open ([jetkvm/kvm#389](https://github.com/jetkvm/kvm/issues/389)); a general authenticated REST API remains open ([#1320](https://github.com/jetkvm/kvm/issues/1320)). The internal JSON-RPC data channel and partial MQTT surface are useful implementation substrates but are not stable public control contracts.

Target architecture:

```text
OMP sessions / human review
            ↓ CLI or local Unix socket
one supervised jetkvm-broker per device
            ↓ one exclusive WebRTC session
          JetKVM
            ↓ HDMI + full USB 2
optional managed KVM switch → selected host
```

Broker invariants:

- one process owns the physical device session; OMP sessions never open direct JetKVM webpages;
- operator lease records owner, purpose, acquisition time, TTL, and stale-recovery receipt;
- status and snapshots are read-only and never steal the operator lease;
- HID, reboot, EDID, virtual-media, and switch-port changes require the operator lease and an audit record;
- `select-host` changes the managed switch, waits for JetKVM readiness, verifies the expected host identity/resolution, then grants control;
- the broker runs on an independent control-plane machine, never on a managed host whose failure would remove recovery access;
- live observers require broker-side restreaming because upstream firmware does not support concurrent read-only video peers. Start with snapshots/status rather than building an SFU prematurely.

Minimal managed-switch hardware contract: HDMI and full USB 2 switch together; every port retains EDID; virtual media survives; LAN or RS-232 control is documented; physical buttons remain available. PiKVM documents the same topology with managed TESMART 4/8/16-port LAN switches and TCP control: <https://docs.pikvm.org/tesmart/>. Host power remains a separate ATX-relay or managed-PDU concern.

## Deferred infrastructure queue

This table is the detailed authority. Add one root `TASKS.md` roll-up only after the active intake workspace's newer task ledger is split and landed.

| ID | Status | Work | Acceptance / promotion trigger |
|---|---|---|---|
| DRP-001 | blocked-human | Finish persistent authenticated Chrome and loopback CDP | Arthur completes GDM login; setup-script `check` and `status` pass; a fresh SSH tunnel attaches directly to official Chrome; one background target succeeds without local fallback. |
| DRP-002 | next | Land the dotfiles graphical-session resolver and GDM/Chrome setup corrections | Coordinate with the existing dirty dotfiles owners; produce one reviewed commit; prove root-owned GDM leader fallback, user-manager environment import, manual-login keyring detection, and clean `check`/`status`. |
| DRP-003 | blocked-hardware | Prove AC-loss recovery and Wake-on-LAN end to end | Independent LAN sender wakes the host from S5; a managed and recoverable power path proves G3 AC restoration. Never test true power loss without independent video/HID and power recovery. |
| DRP-004 | parked | Benchmark Above 4G Decoding / ReBAR | Promote only for a measured game, transfer-heavy GPU, or passthrough workload. Record before/after performance, boot stability, CUDA behavior, and rollback; do not enable from theory alone. |
| DRP-005 | parked | Evaluate DOCP memory profile | Inventory DIMMs and rated timings, then run an explicit stability campaign before adoption. Roll back on any memory error or workload instability. |
| DRP-006 | parked | Exercise AMD-V/IOMMU with an owned VM use case | Create a bounded KVM/QEMU workload, record IOMMU groups and performance, and prove teardown. RTX passthrough requires a separate approved design and recovery path. |
| DRP-007 | next | Build one singleton JetKVM broker per device | One supervised process owns WebRTC; expose status/snapshot/HID/reboot through a stable CLI or Unix socket; operator leases carry owner, purpose, TTL, audit log, and stale recovery. OMP sessions never open JetKVM webpages directly. |
| DRP-008 | parked-hardware | Select and integrate a managed multi-host HDMI+USB KVM | Require per-port EDID, full USB 2 data/virtual-media passthrough, LAN or RS-232 control, and physical fallback. Broker `select-host` must verify switch state and JetKVM video before granting control. |
| DRP-009 | parked | Add read-only JetKVM observers | Start with broker-owned snapshots/status. Promote live restream only when simultaneous human observation is required; upstream firmware has no concurrent read-only peer. |
| DRP-010 | next | Complete desktop parity and dispatch profiles | Produce immutable parity receipts and owned browser/scrape, fuzz, TUI-stress, and GPU process groups with status/cancel/artifact retrieval. |
| DRP-011 | parked-research | Evaluate Nix/NixOS for the next workstation build | Compare reproducibility and rollback against current Ubuntu/dotfiles; do not migrate the active workstation merely to avoid understanding GDM, D-Bus, keyring, GPU, or HDMI semantics. |


## Low-priority follow-ups

- Bound unknown `history://agent` errors: never enumerate hundreds of known agents; return a count, a few close matches, and point to bare `history://`/IRC list pagination.
- Finish session naming from the first task/prompt so IRC shows semantic names rather than `agents-xxxxxx`.
- A background polling agent is the wrong default while memory is unstable. Prefer event-driven ownership manifests and a lightweight mechanical daemon only after resource accounting exists.

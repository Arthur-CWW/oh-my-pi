# Thread garden receipt — JetKVM and desktop infrastructure — 2026-07-23

## Source

- Session: `019f7869-d126-7000-8823-f9a60934fa11` (`agents-5sdej1`)
- Covered range: 2026-07-23 JetKVM/Ubuntu graphics recovery, firmware hardening, remote-Chrome blocker diagnosis, multi-host KVM and singleton-controller design. Earlier coordinator-memory evidence is referenced only through the pre-existing desktop resource-pooling plan.
- Trigger: Arthur explicitly requested that the local handoff and every deferred task/design be serialized into repository authorities before returning to Chrome automation.

## Current authorities updated

- [`../../plans/desktop-resource-pooling.md`](../../plans/desktop-resource-pooling.md) — settled desktop architecture, current Chrome continuation, and detailed `DRP-001..011` deferred queue.
- [`../incidents/2026-07-23-jetkvm-ubuntu-desktop-recovery.md`](../incidents/2026-07-23-jetkvm-ubuntu-desktop-recovery.md) — resolved incident evidence, exact changes, verification, diagnostic order, and security boundary.
- This receipt — continuation and garden inventory.

No separate JetKVM broker or multi-host-switch design document was created: those semantics fit the existing desktop resource-pooling authority until implementation begins. The session-local `local://jetkvm-desktop-handoff.md` is superseded by the repository files above.

## Decisions and invariants captured

- Ubuntu remains a hybrid server/workstation: `graphical.target` adds GDM without replacing SSH/system services.
- Radeon iGPU owns GNOME/Chrome; RTX 3090 remains the default CUDA/model resource and is not a display device.
- GDM autologin stays disabled. One human password login after reboot unlocks Secret Service; agents never retrieve/type passwords or weaken Chrome/keyring storage.
- Chrome CDP stays on remote loopback through an owner-only SSH tunnel; attach-only and no local launch fallback.
- Exactly one controller owns a JetKVM device. Multiple OMP/browser surfaces are prohibited because firmware evicts the old WebRTC session.
- Future multi-host operation uses a managed HDMI+full-USB KVM switch behind one supervised JetKVM broker; power control is separate.
- ReBAR/Above-4G, DOCP, VM passthrough, NixOS, and live observer restream remain promotion-triggered work, not settled defaults.

## Implemented and proven

- Restored `graphical.target`; disabled GDM autologin with rollback copy.
- Enabled iGPU display ownership, AMD-V, IOMMU, AC-loss auto-power-on, and PCIe wake through audited BIOS saves.
- Proved motherboard HDMI/JetKVM 1920×1080@60, AMD `boot_vga=1`, RTX display disabled/idle, AMD-V, five IOMMU groups, and Ethernet magic-packet wake mode.
- Vendored official JetKVM source at `vendor/jetkvm/kvm`, upstream `fe77acd5f00300a4ab9acd5da57d7bb0916351d9`; landed as change `pqolqpvlsxrz`, commit `586e50611fc5`.
- Patched/deployed dotfiles Chrome session discovery to handle root-owned GDM leaders and user-manager display environment. The dotfiles file contains broader pre-existing uncommitted work and is not landed by this garden.

## Backlog and research disposition

- Active blocker and every deferred design are represented by `DRP-001..011` in the plan.
- Power/WOL, VM/IOMMU, ReBAR, DOCP, broker, managed switch, observer, dispatch/parity, and NixOS each carry an acceptance or promotion trigger.
- Root `TASKS.md` was intentionally not edited in this changeset: the active intake workspace contains a newer unlanded task ledger than `main`. The plan is the detailed queue authority; add one root roll-up after the intake ledger is split/landed rather than overwriting concurrent task work.

## Unresolved contradictions and risks

- `~/dotfiles/server/ubuntu-remote/setup-remote-chrome.sh` is deployed but shares a dirty file with other dotfiles sessions; coordinate and land one reviewed dotfiles change before treating it as reproducible state.
- BIOS AC recovery and Wake-on-LAN are configured and locally evidenced but not end-to-end power-cycle tested; DRP-003 remains blocked on an independent managed recovery path.
- JetKVM has internal WebRTC JSON-RPC and partial MQTT, but no stable general REST/control CLI. Broker implementation must own protocol drift and exclusive session semantics.

## Exact continuation

1. Arthur logs into `arthur` at the visible JetKVM/GDM screen.
2. Run the remote Chrome setup script `check` and `status`; follow only its current documented setup/recovery workflow.
3. Arthur completes Gmail/X/password-manager/2FA/passkey UI manually in the visible dedicated Chrome profile.
4. Re-run readiness, establish a fresh loopback SSH tunnel, attach Puppeteer directly, and prove one background target without local fallback.
5. Continue with DRP-002/007/010 after the authenticated browser pool works.

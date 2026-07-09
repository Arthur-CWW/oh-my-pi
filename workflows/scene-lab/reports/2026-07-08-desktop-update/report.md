# Arthur's Desktop Server Update Report

**Date:** 2026-07-09  
**Host:** desktop (Ubuntu 24.04, RTX 3090)  
**Executed by:** `DesktopUpdate` agent via `ssh desktop` (BatchMode key auth)

---

## Summary

- mise was self-updated from **2026.5.15** to **2026.7.3**.
- uv is already on the latest release (**0.11.28**); `uv self update` confirmed no newer version.
- The majority of mise-managed tools were installed/upgraded (runtimes, prebuilt binaries, npm packages, fish, ffmpeg, neovim, etc.).
- Rust (1.96.1) and Go (1.26.5) were added to `~/.config/mise/config.toml` because the declared `cargo:*` and `go:*` tools require them as build-time dependencies. They were installed via mise.
- A final `mise install` for the remaining cargo-backed tools is still running in a tmux session (`final_install`).
- OS package updates were **not executed** (no sudo access); the paste block was written to `~/desktop-update-sudo.sh` for Arthur to run manually.
- `~/latwalk-lab/venv` was **not touched** and remains functional with torch 2.5.1+cu124 and CUDA available.

---

## OS Packages (sudo required — not executed)

Script written to the desktop:

```bash
sudo bash ~/desktop-update-sudo.sh
```

Contents of `~/desktop-update-sudo.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get autoremove -y
```

Run this manually when convenient; it requires a passworded sudo session.

---

## Before / After Versions

| Tool | Before | After | Notes |
|------|--------|-------|-------|
| mise | 2026.5.15 | **2026.7.3** | Self-update succeeded |
| uv | 0.11.28 | **0.11.28** | Already latest |
| python (system) | 3.12.3 | 3.12.3 | Unchanged |
| python (mise) | 3.12.11 | 3.12.11 | Already latest |
| bun | 1.2.8 | 1.2.8 | Already latest |
| node | v25.8.0 | v25.8.0 | Already latest |
| nvim | v0.12.4 | v0.12.4 | Already latest |
| ffmpeg | 6.1.1 (system) | **8.1.2 (mise)** | Upgraded via mise |
| rust | not in config | **1.96.1** | Added to config + installed |
| go | not in config | **1.26.5** | Added to config + installed |

---

## What Was Updated

### Core tools
- `~/.local/bin/mise` upgraded to `2026.7.3`
- `uv` verified at latest `0.11.28`

### Mise-managed tools installed/upgraded successfully
- `bun` 1.2.8
- `node` 25.8.0
- `pnpm` 10.7.1
- `python` 3.12.11
- `uv` 0.8.4 (mise-managed copy, separate from `~/.local/bin/uv`)
- `btop` 1.4.7
- `duckdb` 1.5.4
- `ffmpeg` 8.1.2
- `fnox` 1.29.0
- `fish-shell` 4.8.0
- `gh` 2.96.0
- `hcloud` 1.66.0
- `jq` 1.8.2
- `neovim` 0.12.4
- `shellcheck` 0.11.0
- `usage` 2.0.7
- `fzf` 0.74.0
- `zellij` 0.44.3
- `tmux-builds` 3.7b
- `npm:defuddle-cli` 0.7.0
- `npm:@mariozechner/pi-coding-agent` 0.73.1
- `npm:playwright` 1.61.1
- `npm:puppeteer` 25.3.0
- `npm:@openai/codex` 0.143.0
- `npm:@anthropic-ai/claude-code` 2.1.204
- `npm:@google/gemini-cli` 0.49.0
- `npm:@mariozechner/claude-trace` 1.0.9
- `go:github.com/mikefarah/yq/v4` 4.53.3
- `cargo:ripgrep` 15.1.0 (and others still building — see In Progress)

### Dotfiles bootstrap
- Full `bootstrap` was **not run** because `scripts/dotfiles.py` includes `sudo apt-get` paths and Tailscale installation via `sudo`.
- `uv run scripts/dotfiles.py bootstrap --links-only` was run successfully and adopted/linked the mise config (`~/.config/mise/config.toml` -> `~/dotfiles/shell/dot-config/mise/config.toml`).

---

## In Progress / Still Running

A tmux session named `final_install` is still compiling the remaining cargo-backed tools:

```bash
tmux attach -t final_install
```

The session was started with:

```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
rustup default 1.96.1
mise install -y
```

This resolves the earlier "rustc 1.85.1 too old" failures by using the mise-installed Rust 1.96.1 toolchain.

Remaining tools to finish:

- `cargo:ast-grep`
- `cargo:atuin`
- `cargo:bat`
- `cargo:bottom`
- `cargo:coreutils`
- `cargo:difftastic`
- `cargo:du-dust`
- `cargo:eza`
- `cargo:fd-find`
- `cargo:git-delta`
- `cargo:hyperfine`
- `cargo:jj-cli`
- `cargo:jless`
- `cargo:procs`
- `cargo:tealdeer`
- `cargo:tokei`
- `cargo:xh`
- `cargo:yazi-fm`
- `cargo:zoxide`

These are expected to complete once the cargo builds finish (potentially 10–30 minutes depending on parallelism and crate compilation).

---

## Configuration Change

Added to `~/.config/mise/config.toml` (and backed up to `~/.config/mise/config.toml.bak-202607091340`):

```toml
[tools]
rust = "latest"
go = "latest"
```

These are required build-time dependencies for the `cargo:*` and `go:*` tools declared in the same file. A backup was created before the edit.

---

## Latwalk Venv Integrity Check

`~/latwalk-lab/venv` was explicitly left untouched. Verification:

```
torch: 2.5.1+cu124 cuda: True
```

The shared PyTorch/CUDA venv remains intact and functional.

---

## Manual Steps for Arthur

1. **OS packages:** Run `sudo bash ~/desktop-update-sudo.sh` on the desktop.
2. **Monitor cargo builds:** Attach the tmux session with `tmux attach -t final_install` to verify the remaining cargo tools finish. If it completed before you read this, run `mise install --dry-run` to confirm nothing is missing.
3. **(Optional) Review config change:** If you do not want rust/go persisted in `~/.config/mise/config.toml`, restore from the backup and instead activate them only when running `mise install` for cargo/go tools. However, leaving them is recommended since they are required by the tools in the config.

---

## Tmux Sessions Created

- `update` — mise self-update, uv self-update, first `mise install` (completed; cargo/go tools failed due to missing rust/go)
- `rustgo` — installed Rust 1.96.1 and Go 1.26.5 (completed)
- `cargo_go_tools` / `cargo_go_tools2` / `cargo_go_final` — failed attempts to install cargo/go tools without rust/go in config (completed with failures)
- `final_install` — currently compiling remaining cargo-backed tools (in progress)

Sessions can be listed with `tmux ls` and inspected with `tmux attach -t <name>`.

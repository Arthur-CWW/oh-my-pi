# Agent Farm / macOS E2E Lab Spec

## Goal

Build a residential-network agent farm where AI agents can build, test, browse, and run GUI tasks independently without disturbing Arthur's main desktop.

The core problem is isolation:

- Native macOS UI/E2E tests use a foreground WindowServer session and can steal focus.
- Browser automation can be isolated with headless/CDP profiles and usually does not need a visible foreground browser.
- Agents should be able to run many jobs in parallel, collect logs/screenshots/results, and hand back concise status without interrupting the user.

## Key conclusion

For native macOS app E2E, the practical solution is a dedicated Mac runner or macOS VM runner. SIP changes do not solve focus stealing. XCUITest/AppKit/Accessibility UI automation needs a GUI session.

For browser E2E, use headless browsers or background CDP targets with isolated profiles/ports.

## Popular macOS VM / runner options

### Tart / Cirrus Labs

Best fit for an agent farm on Apple Silicon.

- Uses Apple Virtualization.framework.
- Designed for CI-style macOS/Linux VMs.
- Supports VM images, cloning, pushing/pulling images, and relatively reproducible runners.
- Good for snapshot-like workflows and ephemeral test machines.
- Requires Apple Silicon Mac host for Apple Silicon macOS guests.

Use this as the default serious option for a scalable local macOS agent farm.

### Anka / Veertu

Enterprise macOS virtualization/CI.

- Mature CI product.
- Strong image management and orchestration.
- Likely expensive/overkill for a home lab unless reliability is worth it.

### VirtualBuddy

Good local GUI app for creating/running macOS VMs.

- Friendly for experimentation.
- Less CI/orchestration-oriented than Tart.
- Useful for proving the model before automating.

### UTM / QEMU

Useful general VM tool.

- Can run many OSes.
- Less ideal for fast macOS CI loops on Apple Silicon than Tart/Virtualization.framework-native tooling.

### Parallels / VMware Fusion

Good desktop virtualization tools.

- Fine for manual VM use.
- Less clean as an agent/CI substrate than Tart unless you already have licenses and scripts.

### Physical Macs

Simplest and often most robust.

- Used M1/M2 Mac mini is a great first runner.
- One logged-in test user = one native UI E2E lane.
- Add more Mac minis for more parallel native UI test lanes.

## Do you need a Mac?

For macOS app builds/tests/VMs: yes, use Apple hardware in practice.

Options:

- Local used Mac mini on the residential network.
- Beefy Apple Silicon Mac running multiple macOS VMs.
- Hosted Apple hardware: MacStadium, AWS EC2 Mac, GitHub Actions macOS runners, Cirrus CI.

For browser-only automation: no. Linux boxes can run Playwright/Puppeteer headless workers.

## Isolation model

### Worker classes

1. `mac-native-worker`
   - Runs Xcode builds, unit tests, and native UI/E2E tests.
   - Backed by physical Mac or macOS VM.
   - One GUI job at a time per WindowServer session.

2. `browser-worker`
   - Runs Playwright/Puppeteer/CDP browser tasks.
   - Prefer Linux or macOS headless.
   - Many per host, each with isolated browser profile and debug port.

3. `build-worker`
   - Runs non-GUI builds, formatters, unit tests, static analysis.
   - Can be macOS/Linux depending on project.

4. `artifact-worker`
   - Stores screenshots, videos, `.xcresult`, logs, browser traces.
   - Could be NAS/MinIO/S3-compatible bucket on LAN.

### Scheduling rule

- Native macOS UI jobs require exclusive lease on one GUI lane.
- Browser/headless jobs can run concurrently up to CPU/RAM limits.
- Agents request a lease, run commands, upload artifacts, then release lease.

## Proposed home-lab architecture

```txt
Arthur main Mac
  └─ Pi / coding agents
       └─ job submitter CLI/API
            └─ local scheduler / queue
                 ├─ mac-mini-1 physical GUI runner
                 ├─ mac-studio VM host
                 │    ├─ tart vm: macos-e2e-1
                 │    ├─ tart vm: macos-e2e-2
                 │    └─ tart vm: macos-e2e-3
                 ├─ linux-box browser workers
                 └─ artifact store
```

## Minimum viable setup

Start simple:

1. Buy/use one dedicated Mac mini.
2. Create a dedicated local user: `agentrunner`.
3. Enable SSH and Screen Sharing.
4. Install Xcode, Homebrew, Node/Bun, Python/uv, Pi/agent tools.
5. Install GitHub Actions self-hosted runner or a simple SSH job runner.
6. Configure repos so:
   - `make test` = non-invasive tests only.
   - `make test-e2e-local` = explicit local foreground UI tests.
   - `make test-e2e-remote` = dispatches to remote runner.
7. Store `.xcresult`, screenshots, logs under shared artifacts.

This immediately prevents agents from stealing focus on Arthur's main Mac.

## Scaling path

### Phase 1: One Mac mini runner

- Serial native UI tests.
- Many headless browser tests can still run elsewhere.
- Good enough for one or two Mac apps.

### Phase 2: Tart VMs on a stronger Apple Silicon host

- Create base macOS image with Xcode and dependencies.
- Clone ephemeral VM per test job if possible.
- One GUI test per VM.
- Reset VM after job.

### Phase 3: Scheduler and leases

Implement a small scheduler with:

- `submit-job`
- `lease-worker`
- `stream-logs`
- `upload-artifacts`
- `cancel-job`
- `worker-heartbeat`

Back it with SQLite/Postgres/Redis; start with SQLite if local-only.

### Phase 4: Agent integration

Agents get tools such as:

- `run_remote_build(repo, ref, command)`
- `run_remote_e2e(repo, ref, suite)`
- `get_job_status(job_id)`
- `fetch_artifacts(job_id)`
- `open_failure_summary(job_id)`

Agents should never directly run local foreground UI tests unless explicitly approved.

## Browser automation rules

Browser jobs should use:

- Headless Playwright/Puppeteer where possible.
- Dedicated browser profile per job.
- Dedicated CDP port per job.
- Background CDP targets for non-headless logged-in automation.
- No `page.bringToFront()`.
- No `Target.activateTarget`.
- No OS-level click/type automation unless the job owns a whole GUI worker.

See `docs/browser-background-automation-howto.md` for the current browser-specific pattern.

## macOS native UI test rules

Native GUI jobs must run only on owned GUI workers:

- dedicated Mac user session, or
- dedicated macOS VM, or
- cloud macOS runner.

Rules:

- Do not run XCUITest on Arthur's main desktop by default.
- Do not run two XCUITest jobs in the same GUI session.
- Reset app state before every run.
- Disable update checks and network popups in test mode.
- Isolate app support directories and user defaults.
- Upload `.xcresult`, screenshots, and logs.

## VoiceInk-specific immediate changes

For VoiceInk and similar macOS apps:

- `make build`: local ad-hoc signed build.
- `make test`: unit/non-invasive tests only.
- `make test-e2e-local`: opt-in foreground UI E2E with warning.
- `make test-e2e-remote`: dispatch to remote Mac runner.
- GitHub Actions/self-hosted runner runs E2E, not Arthur's active desktop.

## Hardware notes

Suggested first machine:

- Used M1/M2 Mac mini.
- 16GB RAM minimum; 24/32GB+ better if running VMs.
- 512GB+ SSD preferred; VM images and Xcode caches are large.

For VM host:

- More RAM matters most.
- Plan roughly 4-8GB RAM per macOS VM, plus host overhead.
- Keep VM images lean and use caches/artifact store deliberately.

## Open questions

- Which scheduler: GitHub Actions self-hosted, Buildkite, custom Pi tool, or simple SSH queue?
- How many concurrent native macOS UI lanes are needed initially?
- Should runners be allowed outbound internet, or use a proxy/cache?
- Artifact store: local NAS, MinIO, or GitHub Actions artifacts?
- Secrets strategy for agents and workers?
- Whether to use Tart immediately or start with one physical Mac mini first.

## Recommendation

Start with one dedicated physical Mac mini runner. It is the fastest way to remove focus-stealing from the main Mac. Add Tart VMs once the workflow is proven and more parallel native macOS E2E capacity is needed.

---

## Research addendum: iOS/macOS/Android parallel UI testing

### iOS / iPadOS UI tests

The platform with the best first-party parallel UI-test support is iOS Simulator.

Practical levers:

```bash
xcodebuild test \
  -workspace App.xcworkspace \
  -scheme App \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -parallel-testing-enabled YES \
  -parallel-testing-worker-count 4 \
  -resultBundlePath artifacts/App-iOS.xcresult
```

Useful `xcodebuild` flags from local `xcodebuild -help`:

- `-parallel-testing-enabled YES|NO`
- `-parallel-testing-worker-count NUMBER`
- `-maximum-parallel-testing-workers NUMBER`
- `-maximum-concurrent-test-simulator-destinations NUMBER`
- `-maximum-concurrent-test-device-destinations NUMBER`
- multiple `-destination ...` entries for destination fan-out
- `build-for-testing` + `test-without-building` for splitting build and execution
- `-xctestrun` for low-level test bundle orchestration

Notes:

- Xcode can clone simulators/runners for parallel UI tests, but behavior depends on Xcode version, simulator runtime, scheme settings, and hardware.
- This is much less disruptive than macOS app UI tests because the tests run in simulator windows, but they can still create visible windows on the runner. Run them on a dedicated Mac/VM, not Arthur's desktop.
- For maximum isolation, allocate each agent job a VM or physical runner, then allow Xcode to parallelize inside that runner up to RAM/CPU limits.

Recommended architecture:

- One macOS VM/runner per job.
- Build once with `build-for-testing`.
- Fan out simulator destinations or shards with `test-without-building`.
- Upload `.xcresult`, simulator logs, screenshots, and any videos.

### macOS app UI tests

macOS native UI tests are the hardest to isolate.

Key constraints:

- XCUITest/AppKit/Accessibility automation uses a logged-in GUI session.
- It can activate apps, steal focus, and interact with the active WindowServer.
- One GUI session should run only one native UI test job at a time.
- SIP does not solve this; the issue is WindowServer/session ownership, not root permissions.

Recommended architecture:

- Dedicated physical Mac user session, or
- Dedicated macOS VM, or
- Cloud Mac runner.

Do not run these on Arthur's active desktop by default.

### Android UI tests

Android is much easier to parallelize locally than macOS UI tests.

Good options:

1. **Gradle Managed Devices**
   - First-party Android option.
   - Can create emulator device groups.
   - Supports sharding across managed virtual devices.
   - Good baseline for self-hosted Android app projects.

2. **Firebase Test Lab**
   - Strong isolation and cleanup.
   - Physical and virtual device matrix.
   - Great for correctness and device coverage; less local-control oriented.

3. **Maestro**
   - Simple YAML-like UI flows.
   - Local sharding/device targeting exists; Maestro Cloud parallelizes more easily.
   - Good for agent-generated smoke/E2E flows because scripts are readable.

4. **Marathon**
   - Dedicated Android/iOS test runner for device pools.
   - Strong when you have many local devices/emulators and want scheduling/retry/sharding.

5. **Appium**
   - Cross-platform and flexible.
   - More orchestration overhead; often paired with Selenium/Appium Grid or a device cloud.

Home-lab approach:

- Linux box or Mac mini can host Android emulators.
- Use one emulator per worker slot.
- Keep each emulator/device profile disposable.
- Store logs, videos, screenshots, and JUnit/XML/Allure reports.

### Cross-platform lane model

Suggested worker lane types:

```txt
ios-sim-lane       macOS runner, Xcode, multiple iOS simulators allowed
macos-gui-lane     macOS runner/VM, one XCUITest job only
android-emu-lane   Linux/macOS runner, emulator per slot
browser-lane       Linux/macOS runner, headless browser or background CDP profile
unit-build-lane    Non-GUI build/test/static checks
```

A scheduler should understand these as different scarce resources. A macOS VM might expose both an `ios-sim-lane` and `macos-gui-lane`, but a native macOS UI test should take an exclusive GUI lease.

---

## Research addendum: public project patterns

### Ghostty

Public evidence:

- Native GUI terminal on macOS/Linux.
- Uses GitHub Actions with many separate jobs.
- Uses Nix as the primary development/CI environment.
- Builds macOS app with Xcode outside the Nix shell because Nix breaks `xcodebuild` in their setup.
- Builds iOS target with code signing disabled to verify it compiles.
- Runs core tests with `zig build test` on macOS and Linux.
- Public docs/repo do not clearly show a macOS XCUITest-style GUI automation suite.

Pattern to copy:

- Separate core/conformance tests from native app GUI smoke/build checks.
- Use reproducible CI environments.
- Fan out CI jobs by platform/build type instead of trying to make one giant test job.

Relevant local finding from `~/github/ghostty/.github/workflows/test.yml`:

- `build-macos`: builds `GhosttyKit`, then `cd macos && xcodebuild -target Ghostty`.
- `build-macos`: also runs `xcodebuild -target Ghostty-iOS CODE_SIGNING_ALLOWED=NO`.
- `test-macos`: runs `nix develop -c zig build test ...`.

### OpenAI Codex public repo

Public evidence from `openai/codex`:

- The open-source repo is primarily CLI/TUI/app-server oriented.
- It has extensive Rust CI, Bazel/Cargo workflows, and many integration tests.
- The TUI uses snapshot tests via `insta`.
- The repo explicitly requires UI-visible TUI changes to include snapshot coverage.
- TUI tests use a VT100-style backend to render terminal output without a foreground GUI.

Pattern to copy for agent TUIs:

- Do not test terminal UIs with macOS GUI automation.
- Render into a fake/VT100 terminal backend.
- Store golden snapshots and require updates with UI changes.
- Add integration tests around protocol/app-server behavior separately from rendering.

Relevant local finding from cached `openai/codex`:

- `AGENTS.md` says `codex-rs/tui` uses `insta` snapshots for rendered output.
- `codex-rs/tui/src/test_backend.rs` wraps `ratatui`/`CrosstermBackend` with a `vt100::Parser` so tests can inspect the rendered screen.
- `.codex/skills/test-tui/SKILL.md` documents interactive TUI testing separately from automated snapshots.

### Claude Code / Claude Code Desktop

Public evidence:

- Official docs describe Claude Code Desktop as a GUI wrapper around Claude Code with panes/editor/previews/computer-use style functionality.
- Public docs do not expose Anthropic's internal desktop/TUI UI-test architecture.
- Claude Code Action public repo documents unit tests and integration tests split into other infrastructure, but not desktop UI automation.

Pattern to infer carefully:

- Keep product integration tests and UI rendering tests separate.
- Expect the most detailed GUI CI infrastructure to be private for commercial products.

### Hermes Agent / Hermes GUI ambiguity

Public evidence:

- Official Hermes Agent positions itself as terminal + messaging/browser automation oriented.
- Its browser automation feature explicitly mentions UI testing automation: click through apps, verify UI states, screenshots, report failures.
- “Hermes Desktop” pages appear partially community/secondary; verify before relying on them.

Pattern to copy:

- Browser UI testing can be an agent capability, but should run on isolated browser workers.
- Treat web automation differently from native macOS UI automation.

### General TUI testing pattern

For Codex/Claude-like terminal agents, the best public pattern is:

1. Run core logic tests normally.
2. Render TUI into an offscreen terminal emulator/VT100 parser.
3. Assert semantic state and/or snapshots.
4. Run a small number of PTY-based black-box tests for process interaction.
5. Avoid foreground GUI automation entirely.

Useful ecosystems:

- Rust: `insta`, `ratatui`, `vt100`, `testty`, `ratatui-testlib`.
- Python: `pexpect`.
- Go: `goexpect`.
- TypeScript: terminal/PTY test harnesses such as Termless-style patterns.

# ncode (Noumena code) TUI release + architecture highlights

- Author: xjdr (@_xjdr)
- Date: 2026-06-16 22:47 UTC (release) and 22:56 UTC (highlights reply)
- URLs: https://x.com/_xjdr/status/2067016286237045095 , https://x.com/_xjdr/status/2067018519049564160
- Repo: https://github.com/Noumena-Network/code
- Retrieved: 2026-07-04 via nitter.tiekoetter.com + api.fxtwitter.com
- Tags: ncode, harness, orchestrator, tui, rust, launch

---

## Release post (22:47 UTC)

> Ok i did it . this is Noumena's version of your favorite, ai code TUI .
>
> I rebuilt the REPL engine to be event based
> added a new rust markdown rendering stack that considerably increased performance and stability
> i added a rust OpenAI compat websocket client
> i added a handful of tools and exposed a handfull of others that were hidden by default
>
> this system is optimized for our internal inference system and models but i have recently tested it with a vanilla kimi k2.7 and it works quite well. over the next few days we will make the Noumena Inference Engine available and serve at least the k2.7 model . this project will support native noumena code (ncode) login and keys when its available.
>
> either way, i hope y'all enjoy and find this useful. this is the first of several things i hope to launch this week
>
> github.com/Noumena-Network/code

## Architecture highlights follow-up (https://x.com/_xjdr/status/2067018519049564160)

> Some highlights:
> 1. noumena login and inference engine optimized
> 2. works with noumena platform and cloud natively for remote sessions and 'Clients in the Cloud' lightweight materization and file specific ALCs of large repos into dedicated workspace (coming soon)
> 3. REPL and Terminal Runtime Rebuild
>  A major amount of work went into rebuilding and hardening the REPL/TUI layer:
>  - Reworked terminal rendering and screen diff behavior.
>  - Added flicker detection and regression tests.
>  - Added transcript mode and transcript rendering contracts.
>  - Added terminal replay oracle coverage.
>  - Added overlay invalidation logic.
>  - Added virtual-scroll behavior and clamp/cold-start tests.
>  - Added tmux and PTY integration coverage.
>  - Added wrapper binary startup/input/transcript contracts.
>  - Added resize/repaint policies for main-screen and alternate-screen behavior.
>  - Added performance harnesses for long transcripts, prompt typing, markdown, highlighted code, and assistant-turn rendering.
>  This is one of the largest architectural deltas: code/ has a much more deliberate terminal rendering stack and validation matrix.
> 4. Native Rust Markdown Rendering
>  code/ adds a Rust/N-API markdown rendering module:
>  - native/markdown-renderer-napi
>  - Built as a Rust cdylib.
>  - Exposed to TypeScript via a Node/N-API binding.
>  - Used by the markdown/fenced-code rendering path.
>  - Covered by Rust tests and JS integration tests.
>  - Included in the native package build flow.
> 5. Native Rust OpenAI-Compatible WebSocket v2 Client
>  code/ adds a Rust/N-API OpenAI-compatible WebSocket v2 transport:
>  - native/openai-compat-ws-v2-napi
>  - Uses tokio, tokio-tungstenite, tungstenite, native-tls, and N-API.
>  - Exposes functions such as connect/start/next/cancel/close.
>  - Integrated through src/services/api/openAICompatWsV2Native.ts.
>  - Used by the OpenAI-compatible inference client when enabled.
>  - Covered by lifecycle tests, large-frame tests, disconnect tests, ping/timeout tests, and fallback behavior.
> 6. Standalone Native Packaging
>  code/ has a stronger native packaging story:
>  - build/package.mjs creates single-file native ncode executables.
>  - build/packageAudit.mjs checks packages for forbidden paths/secrets.
>  - build/packageSmoke.mjs validates packaged binaries.
>  - tools/build_standalone_executable.sh supports wrapper-driven native builds.
>  - Native modules are compiled and staged as part of the packaging process.
>  - The preferred OSS user build now produces a native binary under .tmp/packages/....
> 7. Noumena Platform and Remote Runtime Integration
>  code/ adds or expands product-level integrations around Noumena platform services:
>  - Remote sessions and teleport flows.
>  - Bridge/session ingress runtime.
>  - App-server/client remote runtime paths.
>  - Managed remote auth and runtime leases.
>  - OAuth profile, roles, usage, quota, referral, bootstrap, Grove, and policy-limit services.
>  - GitHub app install helpers using Noumena API keys/OAuth.
>  - Remote environment and BYOK paths.
>  - Session archive/session URL/product URL helpers.
> 8. Agent, Workflow, and Task Surface Expansion
>  code/ includes expanded product surfaces around:
>  - Agents and assistant sessions.
>  - Team/teammate workflows.
>  - Workflow tools and workflow slash commands.
>  - Scheduled routines/cron tools.
>  - Remote trigger tools.
>  - Plugin marketplace and plugin management.
>  - Tungsten/tmux-backed workflows.
>  - Background task/session management.
> 9. Testing and Validation Expansion
>  code/ has a much larger validation surface:
>  - Contract tests for auth, runtime leases, remote sessions, and API clients.
>  - Native Rust tests for the Rust modules.
>  - Clippy/fmt-compatible Rust code.
>  - Tmux and PTY tests.
>  - Snapshot tests for terminal rendering.
>  - Package smoke tests.
>  - Product identity/exposure audits.
>  - Build-mode and public-build guards.
>  - Inference request shape tests.
>  - Markdown and WebSocket native integration tests.
> 10. Build Modes and Public Export Work
>  code/ now distinguishes multiple build modes:
>  - external: public/OSS-safe default.
>  - noumena: first-party product build.
>  - dev: contributor/debug build.
>  - internal: internal compatibility build.

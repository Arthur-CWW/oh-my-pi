# New Workstream Subagent Packets

Date: 2026-06-14

## Coordinator decisions

- Start with planning and dry-run scaffolds. No paid provider setup, live trading, live proxy traffic, book downloads, app decompilation, or production network exposure without an explicit approval packet.
- Use chunkier subagent assignments than the saturation probes: each worker should own a coherent package/docs slice and produce durable artifacts, not one-file trivia.
- Keep coordinator-owned globals (`TASKS.md`, root manifests, `.omp/**`, `AGENTS.md`, `docs/state/**`) out of worker lanes unless a packet names them.
- Risky workstreams need scope and approval gates before implementation: trading, proxy resale, restricted book downloads, and reverse engineering.

## Repo-wide packet worker/reviewer SOP

Applies to T-2026-06-13-001 and T-2026-06-13-004 follow-up packets across Jimeng, ASMR, Symphony, Slotok, provider, design, and repo-hygiene workstreams. Domain docs can add local constraints, but should link here instead of copying policy blocks.

Every packet brief should stay concise and include:

- Owner paths: exact files/globs the worker may edit, including tests, fixtures, schemas, docs, and proof paths when those are part of the slice. Assign only one active writer per file; if a fix/review loop must overlap, the brief names the primary owner and tells later workers to coordinate before editing or stand down when superseded.
- Excluded paths: coordinator-owned globals (`TASKS.md`, root manifests, `.omp/**`, `AGENTS.md`, `docs/state/**`), central registries/snapshots unless assigned, unrelated dirty files, secrets, credentials, cookies, signed URLs, and any paid/live provider path without an approval packet.
- Proof artifacts: smallest durable evidence for the claim, either package-local tests/fixtures, a tracked `docs/qa/*` note, or an ignored `artifacts/<workstream>/<packet>/` bundle referenced from the worker output. The proof must exercise the real behavior under review; test-only seams are acceptable only when the root runner/runtime cannot load a native/live dependency, and then the packet must include a separate real-runtime proof command or artifact.
- Root-run verification: workers list the exact commands the root/parent should run, including cwd, runtime (`bun`, `bunx --bun`, `vitest`, provider/live/dry-run mode), and expected artifact paths. Workers normally do not run gates, formatters, project-wide commands, paid provider calls, or live smoke checks. If the named command is impossible under the worker constraints or runtime, the worker reports that as a blocker instead of weakening the proof.
- Retry/resume behavior: if a worker is revived after yielding or after another worker has touched the same path, it re-reads the current files/history and either reports the already-complete state or performs only the newly assigned delta. It does not keep editing from stale context or broaden the slice just because a previous yield was rejected.
- Guardrail and prompt-drift checks: baseline or allowlist changes must be exact-finding or exact-file with a reason and must not hide new owned findings broadly. Prompt/spec examples must be checked against current schemas, route constants, and fixture names before being copied into docs.
- Reviewer persona split: assign reviewers by risk, not by availability. Common splits are API/contract, provider access and cost/auth, runtime/package boundaries, UX/media output, proof/QA, and repo hygiene. Reviewers inspect owner/excluded paths, proof sufficiency, root-run commands, and findings across blocker / important / nit severity.

Worker output should include changed files, the core invariant, proof artifacts created or required, what each proof does and does not prove, commands intentionally not run, recommended root validation commands, and concrete blockers with the next safe command or approval needed.


## Workstream A — Realtime market data and trading bot

Goal: build a research-first trading system that starts with crypto market data, deterministic backtests, and paper trading. No live orders until a later explicit approval.

Recommended first product shape:

- Package: `packages/trading-bot/`
- Optional app later: `apps/trading-dashboard/`
- Data root: ignored `data/trading-bot/`
- Store: SQLite for normalized metadata/events; Parquet/NDJSON later for bulk ticks/order books.

Provider shortlist:

- Crypto direct exchange feeds: Coinbase Advanced Trade, Kraken, Binance where supported in the user's region. Best for execution-aligned WebSocket order book/trade streams.
- Abstraction: CCXT for REST/exchange normalization; consider CCXT Pro only if WebSocket abstraction is worth the paid dependency.
- Aggregated/historical data: Kaiko, CoinAPI, Databento, Polygon, CoinGecko/CoinMarketCap for broad metadata/context.
- Paper/live execution later: exchange sandbox where available; Alpaca is a good paper-first broker for equities/crypto-style workflows, but crypto exchange-native paper support varies.


Cheap stock-data path:

- First choice for personal bot R&D: Alpaca free market data plus paper trading. Official page advertises free plan, 200 API calls/min, IEX-only stock feed, 15-minute delayed REST where applicable, WebSocket limited to 30 symbols, crypto support, and a $99/mo Algo Trader Plus tier for all-US-exchange realtime data.
- Cheapest broad REST experimentation: Twelve Data Basic free plan (8 credits/min, 800/day cap, real-time US equities/forex/crypto for individual/internal evaluation), then Grow from $29/mo for no daily cap and more throughput. Business/commercial use needs Business pricing.
- Cheap historical/backtest candidate: Tiingo free/internal-use tier if its current terms still match the historical 500 symbols/month and 50 requests/hour pattern; verify directly before coding.
- Learning/small API fallback: Alpha Vantage free is very tight (25 API requests/day); premium starts around $49.99/mo for 75 requests/min and unlocks realtime/delayed entitlement steps through Alpha X Terminal.
- Developer quote/news candidate: Finnhub is worth verifying for free realtime quote availability and current per-minute limits; use only documented endpoints and terms.
- Avoid for production: unofficial Yahoo/yfinance/Stooq-style scraping. It is brittle, may violate terms, and creates hidden availability risk.
- Do not decompile or copy a proprietary app's private market-data API. Allowed research is official docs, public terms, permitted packet capture of our own traffic only when terms allow, and clean-room adapters to permitted endpoints.

Initial strategy direction:

- Trend/momentum following, not discretionary prediction.
- Start with daily bars or 1h/4h bars. Intraday tick feeds add cost and execution noise before the strategy has proof.
- Universe: liquid crypto pairs first; later US equities/ETFs if data licensing is solved.
- Signal v0: rank trailing returns over multiple horizons (for example 20/60/120 bars), require positive absolute trend, normalize by realized volatility, and hold top N with caps.
- Risk v0: volatility targeting, max position cap, max portfolio drawdown stop, no leverage, no margin, no shorting until paper results justify it.
- Turnover control: no-trade buffer around target weights, minimum rebalance interval, and fee/slippage-aware trade skipping.
- Research inputs to distill: `@macrocephalopod`, `@therobotjames` / Trading for Dickheads, and `@ScottPh77711570` only through public/authorized surfaces. Capture public posts respectfully, preserve URLs/provenance, and store abstract strategy mechanics rather than copying large tweet/article bodies.

Architecture:

1. `market-data` adapters: exchange/provider WebSocket/REST clients, schema-decoded at the boundary.
2. `event-log`: append-only normalized ticks, trades, OHLCV bars, snapshots, provider health.
3. `backtester`: deterministic simulation over local fixtures; no wall-clock/network.
4. `paper-executor`: fake balances/orders/fills with explicit slippage/fee model.
5. `risk-engine`: max position, max loss, max order size, no leverage default, kill switch.
6. `strategy-sdk`: pure functions over typed state; strategies cannot call network directly.

Subagent packets:

### A1. Market data provider matrix

Owner paths: `docs/plans/trading-bot.md` only.

Change: compare Coinbase/Kraken/Binance/CCXT/Kaiko/CoinAPI/Databento/Polygon/Alpaca for realtime crypto support, historical data, paper/live execution, free-tier limits, licensing/redistribution, and account requirements.

Acceptance: markdown table plus recommendation for v0: one direct exchange feed, one historical source, one paper executor.

### A2. Trading package skeleton

Owner paths: `packages/trading-bot/**`, root package scripts only if coordinator approves.

Change: create Effect TS package with schemas for provider ticks/trades/bars/order book snapshots, normalized domain types, and fixture-based parser tests. No network calls.

Acceptance: package-local typecheck/test scripts; fixtures under `packages/trading-bot/test/fixtures/**`.

### A3. Backtest and paper engine

Owner paths: `packages/trading-bot/src/{backtest,paper,risk,strategy}.ts`, package tests.

Change: implement deterministic backtester and paper order simulator with fees/slippage/risk limits. No live adapters.

Acceptance: tests for rejected oversize orders, stop-on-drawdown, deterministic replay.

### A4. Exchange WebSocket adapter

Owner paths: `packages/trading-bot/src/providers/{coinbase|kraken}.ts`, provider fixtures/tests.

Change: implement one realtime adapter behind an interface, but tests use saved fixture frames only. Live smoke command stays disabled until approval.

Acceptance: boundary decode tests and a documented live-smoke command that is not run by workers.

### A5. Cheap stock-data provider matrix

Owner paths: `docs/plans/market-data-provider-matrix.md`.

Change: verify current official pricing/terms for Alpaca, Twelve Data, Alpha Vantage, Tiingo, Finnhub, Tradier, MarketData.app, Polygon/Massive, Nasdaq Data Link, IBKR, and any broker-provided paper trading feeds. Explicitly separate personal/internal, business/internal, display, redistribution, delayed, realtime, WebSocket, historical, and paper-execution rights.

Acceptance: source-linked table; v0 recommendation for cheapest permitted stock data path; no scraping/private API/decompile plan.

### A6. Momentum/trend strategy distillation

Owner paths: `docs/plans/momentum-strategy-sources.md`.

Change: research public/authorized posts and articles from `@macrocephalopod`, `@therobotjames`, and `@ScottPh77711570` about trend following, risk targeting, turnover/no-trade buffers, universe selection, and execution. Use respectful capture rules; no locked/private/paywalled scraping. Distill into source-linked abstract mechanics.

Acceptance: strategy notes with provenance, proposed v0 signal formula, and open questions. No copied long-form tweet/article dumps.

### A7. Momentum signal implementation

Owner paths: `packages/trading-bot/src/signals/momentum.ts`, `packages/trading-bot/test/signals/momentum.test.ts`.

Change: implement pure fixture-driven signal calculation: multi-horizon return rank, volatility normalization, absolute-trend gate, target weights, and no-trade buffer. No network/data providers.

Acceptance: tests for trend gate, rank ordering, volatility scaling, caps, and trade-skipping buffer.

## Workstream B — Crypto index bot

Goal: build an index/rebalance simulator before a trading bot. This is safer than strategy trading because the core logic is weights, rebalance cadence, fees, and risk constraints.

V0 index rules:

- Universe: top N crypto assets by market cap/liquidity from a permitted metadata provider.
- Exclusions: stablecoins, wrapped duplicates, low liquidity, assets missing price history.
- Weighting: market-cap weighted with caps, or equal-weighted.
- Rebalance: weekly/monthly simulation first.
- Execution: paper only.

Subagent packets:

### B1. Index methodology spec

Owner paths: `docs/plans/crypto-index-bot.md`.

Change: define universe filters, weighting, rebalance schedule, fees/slippage assumptions, benchmark metrics, and failure modes.

Acceptance: enough detail for deterministic implementation; no live trading steps.

### B2. Index calculator

Owner paths: `packages/trading-bot/src/indexing/**`, tests.

Change: implement pure index-weight calculation and rebalance plan generation from fixture market caps/prices.

Acceptance: tests for cap constraints, exclusions, missing data, and deterministic rebalance output.

### B3. Index paper portfolio

Owner paths: `packages/trading-bot/src/paper-index/**`, tests.

Change: simulate portfolio value, drift, rebalance trades, fees, and cash dust.

Acceptance: fixture snapshots of portfolio state and rebalance orders.

## Workstream C — Compliant residential proxy service

Goal: if pursued, build only an opt-in bandwidth-sharing network with consent, revocation, transparent install/uninstall, abuse controls, and approval review. Do not build scraping evasion, stealth installs, botnet acquisition, malware-like persistence, CAPTCHA bypass, credential stuffing, or ToS-evading automation.

Required scope gates before code:

- Written consent UX and participant terms.
- Clear compensation/bandwidth accounting.
- Per-device opt-out and uninstall.
- Customer KYC/payment checks.
- Use-case policy and abuse desk.
- Destination allow/deny policy; no credential abuse, spam, account creation, or protected service bypass.
- Kill switch by customer, device, ASN, country, destination, and traffic pattern.
- Logging and retention rules reviewed for required privacy obligations.

Subagent packets:

### C1. Consent and abuse-control requirements plan

Owner paths: `docs/plans/compliant-residential-proxy.md`.

Change: write the scope checklist, prohibited uses, customer onboarding rules, participant consent requirements, retention rules, and abuse response runbook.

Acceptance: explicit no-go list and approval gates before network implementation.

### C2. Control-plane architecture

Owner paths: `docs/plans/compliant-residential-proxy.md` plus optional `docs/schemas/proxy-control-plane-v0.sql`.

Change: design coordinator, node registry, consent ledger, bandwidth accounting, policy engine, and audit logs.

Acceptance: schema sketch and threat model; no traffic proxy code.

### C3. Local toy proxy simulator

Owner paths: future `packages/proxy-lab/**` only after C1/C2 approved.

Change: local-only simulator with fake nodes and synthetic requests to test accounting/abuse policy. No residential traffic, no remote network.

Acceptance: deterministic policy tests and kill-switch tests.

## Workstream D — Rights-aware library/book assistant

Original request included LibGen/Anna Archive. Do not wire this repo to pirate book downloads or access-control circumvention. Allowed direction: a rights-aware library assistant that searches metadata and downloads only public-domain, open-access, user-owned, or otherwise permitted documents.

Allowed source integrations:

- Project Gutenberg and Standard Ebooks for public-domain books.
- arXiv, PubMed Central, DOAJ/OpenAlex/Crossref metadata for open papers.
- Open Library / Internet Archive metadata and controlled digital lending links where allowed for the user's account and region; do not bypass lending controls.
- Local user-provided PDFs/EPUBs and owned files.
- Publisher/library APIs the user has credentials/rights for.

Subagent packets:

### D1. Library source policy and refusal spec

Owner paths: `docs/plans/library-assistant.md`.

Change: define source allowlist, rights checks, refusal behavior, metadata-only behavior for disallowed sources, and local-file import rules.

Acceptance: explicit statement that LibGen/Anna download automation is out of scope; allowed alternatives listed.

### D2. Book metadata and local import package

Owner paths: future `packages/library-assistant/**`.

Change: Effect Schema models for book metadata, sources, local documents, extracted chapters, and citations. Implement local PDF/EPUB import only from user-provided files.

Acceptance: fixtures with public-domain sample files or tiny generated documents; tests assert metadata extraction, no network piracy.

### D3. Public-domain downloader

Owner paths: `packages/library-assistant/src/sources/{gutenberg,standard-ebooks}.ts`, tests.

Change: implement permitted-source search/download with source attribution and license/public-domain metadata.

Acceptance: tests use fixtures; live smoke command gated.

### D4. AI reading skill

Owner paths: `skills/library-assistant/**`.

Change: skill for summarizing owned/public-domain documents, extracting diagrams into markdown/ASCII where appropriate, and preserving citations.

Acceptance: skill docs and fixture QA artifact.

## Workstream E — CuaDriver built into OMP

Goal: make CuaDriver feel native in OMP for computer-use-style background GUI control, with the focus-safe defaults already preferred in this repo.

Implementation choices:

- Short-term: repo extension continues to expose `cua_driver` and docs/skills; harden API and proof artifacts.
- Medium-term: split into a focused package or upstream OMP PR.
- Long-term: OMP built-in tool with permission prompts, screenshot/AX artifact capture, and browser/app target registry.

Subagent packets:

### E1. CuaDriver API audit

Owner paths: `docs/plans/cua-driver-omp-integration.md`, `packages/web-access/src/cua-driver.ts` read-only in scout.

Change: map current wrapper actions to desired OMP built-in computer-use actions, identify missing capture/result metadata, and define approval tiers.

Acceptance: API matrix and migration plan.

### E2. Extension hardening

Owner paths: `packages/web-access/src/cua-driver.ts`, `packages/web-access/test/cua-driver.test.ts`.

Change: strengthen Effect Schema decoding of process JSON, return typed screenshots/AX metadata/artifact paths, and keep foreground/destructive actions excluded by default.

Acceptance: fixture tests for malformed JSON, unsupported action, and safe command construction.

### E3. OMP upstream patch packet

Owner paths: separate OMP checkout/patch only; do not mix with this repo's package code.

Change: prepare upstreamable design: tool API, permissions, history artifacts, config flags, and tests.

Acceptance: patch plan and test list; no direct global install mutation without approval.

## Workstream F — Reverse engineering / decompilation skill

Goal: create a reverse-engineering skill for permitted targets: owned binaries, open-source binaries, malware samples in a lab, file formats/protocols for interoperability, and clean-room product analysis. Do not decompile proprietary apps to clone code/assets.

TablePlus boundary:

- Allowed: observe TablePlus.app UI behavior, workflows, keyboard shortcuts, layout, and publicly documented database-client capabilities as product references.
- Not allowed: decompile TablePlus, extract proprietary code/assets, bypass license checks, or build a clone from proprietary internals.
- Clean-room alternative: build a database client/workbench from public DB protocols and our own UX decisions; use TablePlus only as one observational reference among others.

Subagent packets:

### F1. Reverse-engineering skill operating rules

Owner paths: `skills/research/reverse-engineering/SKILL.md`.

Change: write skill with scope preflight, target classification, allowed tools, artifact hygiene, and refusal cases.

Acceptance: no instructions for bypassing licenses/DRM or cloning proprietary apps.

### F2. Local binary analysis lab plan

Owner paths: `docs/plans/reverse-engineering-lab.md`.

Change: define isolated lab layout, allowed sample types, toolchain candidates, artifact paths, and reporting template.

Acceptance: plan only; no app decompilation.

### F3. Clean-room database workbench plan

Owner paths: `docs/plans/database-workbench.md`.

Change: plan a database-client app based on public Postgres/MySQL/SQLite docs, with TablePlus observational UX notes limited to non-proprietary behavior.

Acceptance: feature matrix, owner paths, implementation phases, no proprietary assets/code.

## Workstream G — `/bench` harness

Goal: benchmark agents, providers, tools, and workstream packet sizes without tiny throwaway tasks.

Subagent packets:

### G1. Benchmark schema and CLI plan

Owner paths: `docs/plans/bench-harness.md`, later `packages/bench-harness/**`.

Change: define SQLite schema for runs, packets, model/provider, duration, token/cost if available, auth/rate-limit errors, artifacts, and success criteria.

Acceptance: schema and command design for `/bench` or `pi-bench`.

### G2. Chunky subagent benchmark suite

Owner paths: `docs/plans/bench-harness.md`.

Change: define 6-10 medium-size benchmark packets that take real context synthesis, not one-file reads.

Acceptance: each packet has target files, expected duration, and scoring rubric.

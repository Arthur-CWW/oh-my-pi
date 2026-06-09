---
name: "codex-plugin-public-equity-investing"
description: "Public equity workflows for listed-company research, earnings, valuation, model updates, long/short pitches, catalysts, thesis tracking, risk sizing, hedging, dashboards, and investment memos."
---

# Public Equity Investing (Codex plugin router)

This is a Pi router skill for a vendored OpenAI Codex plugin. Use it when the task matches the plugin description, then load the most relevant detailed skill below with the `read` tool. Do not assume all subskills are in context.

## How to use

1. Pick the narrowest subskill that matches the user task.
2. Read that subskill's `SKILL.md` before acting.
3. Resolve relative references against that subskill directory.
4. If no subskill fits, use the plugin-level description as general guidance and say what is missing.

## Subskills

- `catalyst-calendar` — Use when building public-equity-investing catalyst calendars. Do not use for full event underwriting; use event-driven-analyzer.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/catalyst-calendar/SKILL.md`
- `company-tearsheet` — Use when creating source-backed public issuer tearsheets. Do not use for private diligence, fund diligence, vendors, or market maps.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/company-tearsheet/SKILL.md`
- `comps-valuation` — Produce Public Equity Investing comparable-company valuation in report or workbook mode. Use for peer selection, multiple analysis, valuation read-throughs, implied prices, comps dashboards, Excel or Sheets comps, refreshable peer tables, model updates, and comps workbook QA. Do not use for DCF-only, credit-security, or generic market commentary requests.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/comps-valuation/SKILL.md`
- `dcf-model-builder` — Use when building public-equity DCF valuation workbooks. Default to the banker formula workbook path for new model builds; use deterministic exports only for controlled support calculations or explicit lightweight runs. Do not use for standalone workbook audits; use model-audit-tieout.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/dcf-model-builder/SKILL.md`
- `deck-report-qc` — Use when running first-pass QC on Public Equity Investing decks or reports. Do not use as external-circulation certification.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/deck-report-qc/SKILL.md`
- `earnings-deep-dive` — Use when analyzing public-company earnings after results, guidance, transcript, or call commentary. Do not use for pre-print previews.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/earnings-deep-dive/SKILL.md`
- `earnings-preview` — Use when preparing full pre-earnings preview reports with executive summary, expectation bar, guidance credibility, KPI dashboard, scenarios, and call questions. Do not use after results or for short summaries unless the user explicitly asks for a summary/short version.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/earnings-preview/SKILL.md`
- `economic-impact-report` — Use when translating a specific event, policy change, macro shock, or industry development into public-equity issuer, sector, earnings, valuation, positioning, and portfolio implications. Do not use for standalone macro strategy, rates, FX, credit, futures, or generic market commentary.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/economic-impact-report/SKILL.md`
- `equity-model-update` — Safely update public-company Excel model copies from source-to-model maps; emits XLSX as the hero artifact and CSV/log/manifest as support. Do not use for pure earnings notes or broad workbook audits.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/equity-model-update/SKILL.md`
- `event-driven-analyzer` — Use when analyzing dated public-equity event paths, probabilities, payoffs, and expected returns. Do not use for generic catalyst lists, risk sizing, hedges, capital structure, covenants, or credit recovery.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/event-driven-analyzer/SKILL.md`
- `financials-normalizer` — Use when normalizing public-company financials from source materials. Do not use for private data rooms or non-financial cleanup.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/financials-normalizer/SKILL.md`
- `idea-generation` — Use when triaging public-equity idea candidates. Do not use for final trade recommendations, pitches, memos, or models.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/idea-generation/SKILL.md`
- `initiating-coverage` — Use when building public-equity-investing initiating coverage reports. Do not use for trade pitches, memos, earnings notes, models, or tearsheets.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/initiating-coverage/SKILL.md`
- `long-short-pitch` — Use when building PM-facing Public Equity Investing trade pitches, including sparse-context or partial-section requests. Do not use for formal memos; use memo-builder.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/long-short-pitch/SKILL.md`
- `meeting-prep` — Use when creating Public Equity Investing meeting prep briefs. Do not use for private diligence, IB, FP&A, legal, or scheduling-only tasks.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/meeting-prep/SKILL.md`
- `memo-builder` — Use when drafting or reviewing formal public-equity investment memos. Do not use for live trade construction or credit-first memos; use long-short-pitch or Credit Markets as appropriate.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/memo-builder/SKILL.md`
- `model-audit-tieout` — Use when auditing existing Public Equity Investing models or spreadsheets. Do not use to build a new model from scratch.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/model-audit-tieout/SKILL.md`
- `portfolio-risk-management` — Use when sizing Public Equity Investing positions, finding equity hedges, or building an integrated position-and-hedge risk plan from a listed-equity thesis. Do not use for thesis construction, standalone event underwriting, trade execution, personal investment advice, or credit-instrument risk.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/portfolio-risk-management/SKILL.md`
- `public-equity-investing` — Route Public Equity Investing only when explicitly named or tagged, or for an unmistakable listed-equity investor workflow tied to a public security, such as earnings investment work, a long/short thesis, public-equity valuation or model update, catalysts, or position sizing. Do not use for generic company research, reports, documents, models, valuation, or share-price questions.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/public-equity-investing/SKILL.md`
- `scenario-sensitivity-generator` — Use when turning a public-equity base case, model, thesis, event, or catalyst into scenario skew, sensitivity, breakpoint, and PM action-threshold analysis. Do not use for first-pass model builds, credit-security valuation, or generic planning.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/scenario-sensitivity-generator/SKILL.md`
- `thesis-tracker` — Use when building or updating Public Equity Investing thesis trackers. Do not use for generic news summaries, trade pitches, or first-pass memos.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/thesis-tracker/SKILL.md`
- `three-statement-model-builder` — Use when building public-equity three-statement operating model workbooks. Default to the banker formula workbook path for new model builds; use deterministic exports only for controlled support calculations or explicit lightweight runs. Do not use for standalone workbook audits.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/three-statement-model-builder/SKILL.md`
- `user-context` — Start onboarding, initialize, inspect, save, update, forget, export, or explicitly reset the Public Equity Investing plugin's local user context, source setup, or optional automation setup. Use when the user explicitly asks to get started, orient, or manage Public Equity Investing saved preferences, source pointers, context storage, or recurring automation.
  - Path: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing/skills/user-context/SKILL.md`

## Plugin source

- Vendored plugin: `vendor/openai/codex-plugin-cache/plugins/public-equity-investing`
- Direct Pi-compatible generated subskills, if enabled in all-skills mode: `vendor/openai/codex-pi-skills/public-equity-investing`

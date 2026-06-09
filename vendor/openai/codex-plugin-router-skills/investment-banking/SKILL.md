---
name: "codex-plugin-investment-banking"
description: "Investment banking workflows for M&A, coverage, sponsors, capital markets, LevFin, restructuring, valuation, diligence, pitch materials, deal execution, and process trackers."
---

# Investment Banking (Codex plugin router)

This is a Pi router skill for a vendored OpenAI Codex plugin. Use it when the task matches the plugin description, then load the most relevant detailed skill below with the `read` tool. Do not assume all subskills are in context.

## How to use

1. Pick the narrowest subskill that matches the user task.
2. Read that subskill's `SKILL.md` before acting.
3. Resolve relative references against that subskill directory.
4. If no subskill fits, use the plugin-level description as general guidance and say what is missing.

## Subskills

- `buyer-investor-list` — build prioritized buyer, investor, lender, or sponsor universes for ib processes. use when the user asks for target lists, outreach waves, rationale, or tracker-ready parties. do not use to run the live process; use deal-process-tracker.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/buyer-investor-list/SKILL.md`
- `capital-markets-issuance` — frame issuer financing and capital-markets execution options. use when the user asks about ecm, dcm, private placements, market window, investor targeting, or use of proceeds. do not use for borrower credit approval.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/capital-markets-issuance/SKILL.md`
- `cim-builder` — Draft or refresh buyer-facing CIMs, teasers, CIM storyboards, lender presentations, and management presentations. Do not use for independent CIM diligence; use cim-teardown.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/cim-builder/SKILL.md`
- `cim-teardown` — analyze seller materials into claims, diligence gaps, red flags, and model handoffs. use when the user asks to tear down a cim or banker deck. do not use to write the cim; use cim-builder.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/cim-teardown/SKILL.md`
- `company-tearsheet` — Create source-backed banker-facing company, target, borrower, issuer, or counterparty tearsheets. Use for baseline profiles, coverage screens, deal-screen inputs, and meeting context. Do not use for full memos, models, decks, or diligence reports.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/company-tearsheet/SKILL.md`
- `comps-valuation` — Produce source-backed trading-comps valuation for Investment Banking in report or workbook mode. Use for peer selection, trading multiples, implied valuation, Excel or Sheets comps models, EV bridges, refreshes, pressure tests, and workbook QA. Do not use for DCF, LBO, merger, three-statement, or non-banker investment decisions.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/comps-valuation/SKILL.md`
- `covenant-package-analyzer` — Analyze credit documents for covenant definitions, baskets, leakage, headroom mechanics, amendments, and waivers. Use for finance-side covenant reviews, not legal advice.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/covenant-package-analyzer/SKILL.md`
- `dcf-model-builder` — Use when building code-backed DCF exports, WACC/terminal value work, EV-to-equity bridges, sensitivities, or price targets; not comps-only.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/dcf-model-builder/SKILL.md`
- `deal-process-tracker` — Build, update, or reconstruct IB deal-process trackers in a banker-facing workbook. Use for buyer progression, outreach, NDAs, access, diligence, bids, deadlines, process status, or proxy-disclosed sale-process chronology. Do not use to create buyer universes from scratch or write narrative HTML reports.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/deal-process-tracker/SKILL.md`
- `distressed-recovery-waterfall` — Analyze distressed capital structures and recovery waterfalls. Use when the user asks about claims, lien priority, fulcrum security, plan value, liquidation value, sale paths, or restructuring recoveries. Do not use for standard LBO modeling.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/distressed-recovery-waterfall/SKILL.md`
- `financials-normalizer` — convert messy deal financials into model-ready statements, kpi schedules, source maps, and qa flags. use when an ib workflow needs spreading, normalization, or reconciliation. do not use for generic spreadsheet cleanup; use excel-data-cleaner.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/financials-normalizer/SKILL.md`
- `ib-deck-qc` — quality-control investment-banking decks and reports before circulation. use when the user asks to check numbers, units, sources, charts, footnotes, formatting, or page takeaways. do not use to build the deck from scratch.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/ib-deck-qc/SKILL.md`
- `investment-banking` — Route Investment Banking work only when the user explicitly names or tags Investment Banking or unmistakably requests banker-owned transaction execution, such as a sell-side process, CIM, M&A/merger model, ECM/DCM/LevFin client mandate, or restructuring pitch. Do not use for generic memos, reports, decks, models, valuations, spreadsheets, research, or meeting preparation.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/investment-banking/SKILL.md`
- `lbo-model-build` — Build sponsor LBO models for sources and uses, debt, sweep, liquidity, returns, and downside underwriting. Use for take-privates, acquisition financing, or leverage screens; not DCF-only work.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/lbo-model-build/SKILL.md`
- `meeting-prep` — prepare ib meeting briefs, question lists, and debrief follow-ups. use when the user asks for call prep, buyer or lender meeting materials, diligence questions, or action tracking. do not use for full memo drafting.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/meeting-prep/SKILL.md`
- `memo-builder` — draft or review investment-banking memos from existing analysis. use when the user wants a client, committee, board, financing, process, or diligence note. do not use to build source models, decks, trackers, or tearsheets.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/memo-builder/SKILL.md`
- `merger-model-builder` — Build merger and accretion/dilution models for consideration, pro forma ownership, synergies, purchase accounting, financing mix, or EPS impact. Use for strategic M&A modeling; not standalone DCF or LBO work.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/merger-model-builder/SKILL.md`
- `model-audit-tieout` — audit existing financial models and workbook outputs. use when the user asks to check formulas, sources, assumptions, sensitivities, links, or model readiness. do not use to build a new model from scratch.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/model-audit-tieout/SKILL.md`
- `pitch-deck-builder` — build investment-banking pitch deck outlines, page plans, and draft slide content. use when the user asks to create or refresh a banking pitch or client discussion deck. do not mark final client-ready; route final circulation qc to ib-deck-qc.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/pitch-deck-builder/SKILL.md`
- `private-credit-underwriting` — Build borrower-level private credit underwriting views for lender cases, credit memos, debt sizing, downside, liquidity, collateral, recovery, and proceed/decline decisions. Use for lender-side credit decisions, not issuer financing strategy.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/private-credit-underwriting/SKILL.md`
- `scenario-sensitivity-generator` — create scenario, sensitivity, stress-test, and breakeven frameworks for ib analyses. use when the user asks to pressure-test model drivers, cases, downside paths, or decision thresholds. do not build base models.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/scenario-sensitivity-generator/SKILL.md`
- `three-statement-model-builder` — Use when building integrated three-statement operating model exports with linked IS, BS, CF, drivers, checks, scenarios, or formula templates.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/three-statement-model-builder/SKILL.md`
- `user-context` — Start onboarding, initialize, inspect, save, update, forget, export, or explicitly reset the Investment Banking plugin's local user context, source setup, or optional automation setup. Use when the user explicitly asks to get started, orient, or manage Investment Banking saved preferences, source pointers, context storage, or recurring automation.
  - Path: `vendor/openai/codex-plugin-cache/plugins/investment-banking/skills/user-context/SKILL.md`

## Plugin source

- Vendored plugin: `vendor/openai/codex-plugin-cache/plugins/investment-banking`
- Direct Pi-compatible generated subskills, if enabled in all-skills mode: `vendor/openai/codex-pi-skills/investment-banking`

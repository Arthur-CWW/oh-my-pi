---
name: "codex-plugin-sales"
description: "Practical sales workflows for meeting prep, post-call follow-up, account signals, deal strategy, forecast review, competitive briefs, CRM context, and reusable seller preferences."
---

# Sales (Codex plugin router)

This is a Pi router skill for a vendored OpenAI Codex plugin. Use it when the task matches the plugin description, then load the most relevant detailed skill below with the `read` tool. Do not assume all subskills are in context.

## How to use

1. Pick the narrowest subskill that matches the user task.
2. Read that subskill's `SKILL.md` before acting.
3. Resolve relative references against that subskill directory.
4. If no subskill fits, use the plugin-level description as general guidance and say what is missing.

## Subskills

- `analyze-account-signals` — Analyze fresh signals for a named account, owner portfolio, or watchlist and turn them into evidence-backed account intelligence using active Sales source categories and user-provided context.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/analyze-account-signals/SKILL.md`
- `apollo` — Apollo app version >= 2.0.0 connector guide for Sales workflows or explicit Apollo requests involving prospect search, company details, Apollo credit-aware enrichment, account/contact mutations, sequence planning, and gated outbound launch actions.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/apollo/SKILL.md`
- `build-business-case` — Build customer-led business cases, ROI narratives, value models, executive summaries, and customer-ready value stories from uneven customer context, metrics, transcripts, notes, and public evidence.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/build-business-case/SKILL.md`
- `build-competitive-brief` — Build a multi-competitor build-competitive-brief report, comparison matrix, and battlecard-style objection package using user-provided materials, optional connector-assisted research, and public evidence.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/build-competitive-brief/SKILL.md`
- `enrich-company-and-contact-data` — Build portable sales enrich-company-and-contact-data outputs for company and contact discovery, firmographic or technographic completion, ICP list building, segmentation, trigger analysis, market scans, and enrichment-backed comparison work using configured source categories and user-provided inputs.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/enrich-company-and-contact-data/SKILL.md`
- `find-customer-quotes` — Retrieve theme-specific customer or prospect quotes from transcripts, call notes, or exported recordings using transcript-first evidence and explicit speaker-confidence rules.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/find-customer-quotes/SKILL.md`
- `find-key-internal-sources` — Find the best internal experts, documents, and chat channels for a customer question, product topic, objection, implementation issue, account task, or other internal topic using user-provided context, optional connector-assisted search, and evidence-backed ranking.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/find-key-internal-sources/SKILL.md`
- `follow-up-after-call` — Turn a recent customer, partner, or important internal call transcript or grounded call notes into a seller-ready follow-up package with a recap, next steps, external comms when applicable, CRM next steps when applicable, and an internal follow-up draft.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/follow-up-after-call/SKILL.md`
- `get-rep-call-feedback` — Compare one rep’s call history against peer examples to extract repeatable best practices and produce evidence-backed coaching feedback.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/get-rep-call-feedback/SKILL.md`
- `hubspot` — HubSpot CRM connector guide for Sales workflows that use HubSpot for CRM reads, drafts, notes, or proposed record changes.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/hubspot/SKILL.md`
- `index` — Use to discover specific skills for the Sales plugin, when it is at-mentioned directly, or for any mentions of potentially relevant work, including: meeting prep or call follow-up; account research, monitoring, or prioritization; internal source finding; competitive briefs; deal strategy; pipeline or forecast review; company or contact enrichment; customer quote retrieval; rep coaching; business cases; sales company research; and CRM or data enrichment workflows.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/index/SKILL.md`
- `plan-deal-strategy` — Build a post-discovery deal strategy pack with a deal map, buying committee map, procurement risk register, and prioritized next actions from grounded deal evidence.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/plan-deal-strategy/SKILL.md`
- `prepare-for-meeting` — Create concise pre-meeting briefs and daily prep for customer meetings or the user's most important meeting of the day, using authoritative internal context plus supplementary public web enrichment.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/prepare-for-meeting/SKILL.md`
- `prioritize-accounts` — Prioritize rep-ready pipeline by ranking accounts, suppressing in-flight motion, selecting the best reachable contact, and producing a connector-grounded account action view plus a concise planning-only action package from CRM, user-provided lists, saved context, and optional enrichment evidence.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/prioritize-accounts/SKILL.md`
- `review-forecast` — Generate a forecast review with risk analysis, recommendation posture, and change detection using CRM truth, pasted or exported pipeline context, account notes, and optional meeting, email, document, or internal-message evidence.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/review-forecast/SKILL.md`
- `review-rep-call-trends` — Analyze a sales or customer-facing rep’s recent calls to detect improvement, regression, and stable patterns with objective evidence and practical coaching actions.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/review-rep-call-trends/SKILL.md`
- `sales-company-research` — Explicit-only Sales workflow for scheduled or index-routed company research that finds durable internal resources, saves high-confidence Sales plugin memory, and asks focused follow-up questions.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/sales-company-research/SKILL.md`
- `salesforce` — Agentforce Sales connector guide for Sales workflows that use Salesforce for CRM reads, drafts, notes, account plans, Agentforce assignments, or proposed record changes.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/salesforce/SKILL.md`
- `suggest-sales-next-step` — Run scheduled or manual Sales check-ins that summarize recent Sales work and recommend one next Sales workflow to try.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/suggest-sales-next-step/SKILL.md`
- `user-context` — Load or manage the Sales plugin's durable user context, onboarding logic, setup progress, automation metadata, saved preferences, non-obvious CRM conventions, source-of-truth pointers, book-of-business sources, internal team resources, account channels, approval trackers, trusted examples, approved Sales Company Research saves, "please remember" requests, and broad future-facing instructions such as always/never/prefer/next-time feedback after a Sales draft.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/user-context/SKILL.md`
- `zoominfo` — ZoomInfo connector guide for Sales workflows or explicit ZoomInfo requests involving company search, contact search, enrichment, intent signals, similar-account discovery, contact recommendations, and company or contact research.
  - Path: `vendor/openai/codex-plugin-cache/plugins/sales/skills/zoominfo/SKILL.md`

## Plugin source

- Vendored plugin: `vendor/openai/codex-plugin-cache/plugins/sales`
- Direct Pi-compatible generated subskills, if enabled in all-skills mode: `vendor/openai/codex-pi-skills/sales`

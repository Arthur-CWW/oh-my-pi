---
name: "codex-plugin-data-analytics"
description: "Turn analytical questions into validated answers, dashboards, reports, notebooks, KPI frameworks, metric diagnostics, market sizing, data-quality checks, and product/business recommendations."
---

# Data Analytics (Codex plugin router)

This is a Pi router skill for a vendored OpenAI Codex plugin. Use it when the task matches the plugin description, then load the most relevant detailed skill below with the `read` tool. Do not assume all subskills are in context.

## How to use

1. Pick the narrowest subskill that matches the user task.
2. Read that subskill's `SKILL.md` before acting.
3. Resolve relative references against that subskill directory.
4. If no subskill fits, use the plugin-level description as general guidance and say what is missing.

## Subskills

- `analyze-data-quality` — Assess whether tables, query results, files, or dataframes are trustworthy enough for analysis, modeling, dashboards, experiments, or pipelines. Use for grain, freshness, nulls, duplicates, schema drift, broken joins, referential integrity, distribution shifts, leakage, backfills, source mismatches, automated quality checks, and data-quality regressions.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/analyze-data-quality/SKILL.md`
- `build-dashboard` — Build source-backed analytical dashboards that help teams monitor performance, explore drivers, and act on product or business metrics. Use when the user needs a dashboard, scorecard, monitoring view, BI dashboard, MCP artifact dashboard, or Streamlit dashboard with clear metrics, filters, validation, and handoff.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/build-dashboard/SKILL.md`
- `build-report` — Build polished analytical reports for executive, product, business, and technical audiences, and act as the completion contract for Data Analytics report runs. Use when the final artifact needs an answer-first narrative, evidence-backed findings, charts/tables, caveats, source metadata, and either an MCP app report or an HTML report with Seaborn-generated charts.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/build-report/SKILL.md`
- `report-to-google-doc` — Narrow conversion skill. Invoke only when the user explicitly asks to convert an existing local or blob-hosted HTML analytics report into a Google Doc, DOCX, or shareable document.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/build-report/report-to-google-doc/SKILL.md`
- `report-to-google-slides` — Narrow conversion skill. Invoke only when the user explicitly asks to convert an existing HTML analytics report into a native Google Slides deck.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/build-report/report-to-google-slides/SKILL.md`
- `report-to-pdf` — Narrow conversion skill. Invoke only when the user explicitly asks to convert an existing Data Analytics report, dashboard, or inline chart export into a PDF artifact.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/build-report/report-to-pdf/SKILL.md`
- `design-kpis` — Design KPI frameworks, set targets, and develop measurement plans that help teams make product or business decisions. Use when success metrics, drivers, guardrails, targets, or measurement approach need to be defined or improved. Use $metric-diagnostics when the task is to explain why an existing metric moved.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/design-kpis/SKILL.md`
- `gather-business-context` — Gather business context from connected or provided sources so downstream analysis starts with the right framing. Use before deeper analysis when an analytical question depends on context the prompt does not provide, for example to understand what a metric means, how the work is defined, what changed recently, or which sources should be checked.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/gather-business-context/SKILL.md`
- `index` — Primary router for Data Analytics. Use when the plugin is at-mentioned or for data work where source-backed analysis, quantitative reasoning, analytical delivery, or reusable data context may be useful; examples include analyzing data, explaining or diagnosing metrics, validating data or results, creating data visualizations, building analytics reports or dashboards, working with notebooks or spreadsheets, designing KPIs, sizing opportunities, and saving reusable data context for future analysis.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/index/SKILL.md`
- `jupyter-notebooks` — Create, scaffold, edit, refactor, and validate Jupyter notebooks (`.ipynb`) for reproducible SQL/Python analysis, experiments, modeling, tutorials, diagnostics, data-quality checks, market-sizing calculations, and report support. Use when the notebook itself is a deliverable, review artifact, runnable analysis companion, or handoff artifact that other people should be able to skim, rerun, or extend.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/jupyter-notebooks/SKILL.md`
- `kpi-reporting` — Produce leadership-ready KPI updates, scorecards, WBR/MBR/QBR summaries, target and pacing readouts, operating status narratives, and performance updates for known KPIs. Use when the work is to define KPI reporting context, validate metric definitions, present actuals versus comparison or plan, summarize validated drivers, and state implications or next actions.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/kpi-reporting/SKILL.md`
- `market-sizing` — Estimate a market or opportunity size, such as TAM/SAM/SOM, by defining scope, choosing a sizing model, checking connected context and public sources, and presenting transparent assumptions, sensitivity, uncertainty, and validation priorities. Use for market or opportunity sizing; not for KPI reporting or metric diagnostics.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/market-sizing/SKILL.md`
- `metric-diagnostics` — Diagnose why a metric changed or differs from expectation by reproducing the metric, choosing the right comparison, validating likely drivers, and producing a calibrated explanation. Use when the user needs to understand what drove a metric movement, anomaly, gap, or discrepancy.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/metric-diagnostics/SKILL.md`
- `product-business-analysis` — Analyze product or business data to inform decisions with focused quantitative work, decision-relevant context, measurable opportunities, and a clear recommendation. Use when the user needs data-backed evidence to choose a direction, prioritize an opportunity, evaluate a change, understand implications, or decide what to do next; not for routine KPI reporting, metric diagnostics, or dashboard building.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/product-business-analysis/SKILL.md`
- `user-context` — Load or manage the Data Analytics plugin's durable source-routing preferences, onboarding logic, setup progress, and semantic-layer registry.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/user-context/SKILL.md`
- `validate-data` — QA an analysis before sharing: review methodology, metric definitions, SQL/query logic, calculation checks, chart integrity, bias risks, caveats, reproducibility, and whether conclusions are supported by evidence. Use when reviewing a report, notebook, spreadsheet, SQL query/results, dashboard, chart, recommendation, or stakeholder-ready analysis before presentation or publication.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/validate-data/SKILL.md`
- `visualize-data` — Design, specify, implement, revise, and QA quantitative visuals and chart choices. Use when an analytical answer needs visual judgment; for example comparing values, showing how a total breaks apart, reading concentration in a ranking, or understanding movement over time. This may mean rendering a chart for a report or dashboard, or simply choosing, rendering and QAing the right chart form for an inline answer.
  - Path: `vendor/openai/codex-plugin-cache/plugins/data-analytics/skills/visualize-data/SKILL.md`

## Plugin source

- Vendored plugin: `vendor/openai/codex-plugin-cache/plugins/data-analytics`
- Direct Pi-compatible generated subskills, if enabled in all-skills mode: `vendor/openai/codex-pi-skills/data-analytics`

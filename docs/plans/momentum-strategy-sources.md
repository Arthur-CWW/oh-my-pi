# Momentum strategy source distillation

Status: offline skeleton only. Public source URLs still need to be filled from authorized surfaces; no locked, private, paywalled, or live-trading surfaces are required for the market-lab fixture work.

## Fixture-backed implementation note

`packages/market-lab/src/simulator.ts` adds `runMomentumResearchFixture`, a pure fixture runner around the existing paper simulator. It accepts caller-supplied OHLCV bars and returns source-distillation metrics that match the planned research categories: absolute/relative momentum signals, trend-gate and no-trade-buffer blocks, paper turnover, exposure, total return, max drawdown, and per-asset fixture returns. It does not fetch market data and cannot place live orders.

## Public source placeholders

| Source handle | Public URLs to fill later | Mechanics to distill | Current blocker |
| --- | --- | --- | --- |
| `@macrocephalopod` | TODO: public tweet/thread/article URLs | Trend following horizons, risk targeting, absolute trend gates, universe selection | Requires authorized public capture pass. |
| `@therobotjames` | TODO: public tweet/thread/article URLs | Momentum ranking, no-trade/easy-mode buffers, turnover control, execution cadence | Requires authorized public capture pass. |
| `@ScottPh77711570` | TODO: public tweet/thread/article URLs | Cross-source commentary, implementation cautions, portfolio construction notes | Requires authorized public capture pass. |

## Extraction checklist for the future public-source pass

- Use only public/authorized pages or user-provided exports.
- Record canonical URL, capture date, author handle, and quote-sized excerpt for every claim.
- Distill mechanics abstractly; do not mirror account archives.
- Keep strategy notes separated from executable configuration until fixture tests cover the behavior.

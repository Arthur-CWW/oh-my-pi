# Reputable retailer benchmark research prompt

Use this with ChatGPT Pro/frontend LLM browser, web search, or a CuaDriver/CDP browser agent.

```text
Research reputable used/refurb/open-box/new benchmark prices for {hardware_category} in {country_or_region}.

Do not optimize for private-sale bargains. This pass is for safe price anchors and warranty/return comparisons.

Use case:
{use_case}

Target specs:
{target_specs}

Include these retailer categories:
- Official manufacturer refurbished store
- Reputable national refurb sellers
- Large retailers with clearance/open-box/refurb options
- Specialist used/refurb sellers for this hardware category
- eBay only for sold-price benchmarks, not as a reputable-retailer replacement

Suggested retailers:
{retailers}

For each candidate/benchmark extract:
- retailer/source
- product URL
- title
- exact specs
- price
- stock status
- condition grade
- warranty length
- return policy
- shipping/delivery estimate and cost
- seller reputation notes
- caveats/missing info

Return HTML tables first:
1. Best reputable benchmarks
2. Active safe-buy options
3. Overpriced / poor-fit options
4. Price-threshold table by model/spec class

Then return CSV block.

For each row add buy notes:
- how it compares against private-sale prices
- whether warranty/return justifies premium
- max private-sale price implied by this benchmark
- fit for use case
- expected bottleneck

Do not invent stock or warranty details. If not visible, mark unknown.
```

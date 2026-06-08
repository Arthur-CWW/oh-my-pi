# Final used-hardware buying analysis prompt

```text
Synthesize a final purchase recommendation from the attached normalized used-hardware research data.

Inputs:
- items.json / SQLite listing_summary rows
- sellers.json
- verification_results.json
- retailer benchmarks
- target workload and constraints

Target workload:
{target_workload}

Constraints:
{constraints}

Do not recommend any listing unless the link has been verified or clearly marked unverified.

Output:
1. Corrected shortlist table with direct links.
2. Best value table.
3. Best high-end / low-risk table.
4. Avoid/remove table.
5. Price thresholds by model/spec class.
6. Concrete next actions.

For each recommendation include:
- exact link
- verified specs and price
- why it fits / does not fit
- likely bottleneck
- expected capacity
- offer target
- max price
- seller risk notes
- questions to ask seller

Be skeptical. Prefer verified facts over LLM/web-search claims. If a previous recommendation was wrong, call it out explicitly.
```

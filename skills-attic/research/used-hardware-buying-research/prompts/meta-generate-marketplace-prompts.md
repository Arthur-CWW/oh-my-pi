# Meta-prompt: generate marketplace research prompts

Use this with ChatGPT Pro / Codex / another planning model to generate marketplace-specific CuaDriver/CDP browser prompts for any used-hardware buying task.

```text
You are generating prompts for CuaDriver/CDP browser agents that will perform read-only used-hardware buying research.

Generate a complete prompt bundle for the following buying research task.

Task inputs:
- Research title: {research_title}
- Buyer location / postcode: {buyer_location}
- Search radius / geography: {search_radius}
- Target hardware category: {hardware_category}
- Intended legitimate use: {intended_use}
- Must-have specs: {must_have_specs}
- Nice-to-have specs: {nice_to_have_specs}
- Exclusions / down-rank criteria: {exclusions}
- Budget bands: {budget_bands}
- Marketplaces to cover: {marketplaces}
- Preferred output directory: {output_dir}
- Existing known benchmarks, if any: {known_benchmarks}

Important safety / operating constraints:
- Read-only research. No buying, bidding, messaging, offer-making, seller contact, payment, or cart operations.
- Do not help with illegal, deceptive, or platform-abusive activity. If the stated use involves account farming, spam, credential abuse, platform evasion, or fake engagement, phrase the hardware research around legitimate QA/device testing and do not include operational abuse steps.
- Prefer local pickup/inspection for private sales when appropriate.
- Prefer reputable local-region sellers and delivery from within the buyer's country.
- Always record uncertainty and missing specs. Do not invent listing details.

Generate these artifacts:

1. A `facebook-marketplace-prompt.md` prompt if Facebook Marketplace is in scope.
   - It should use a logged-in browser/profile if needed.
   - It should set location/radius if possible.
   - It should output HTML table, CSV, items.json, sellers.json, raw records, and images manifest.
   - It should preserve seller descriptions and seller profile risk notes.

2. An `ebay-prompt.md` prompt if eBay is in scope.
   - It should prefer listings located in the buyer's country and deliverable to the buyer postcode.
   - It should collect active and sold/completed listings separately.
   - It should compute total landed price including postage.

3. A `retailer-benchmark-prompt.md` prompt for reputable refurb/new/open-box retailer benchmarks.
   - Include country-specific reputable sellers.
   - Include manufacturer refurbished/official store if available.

4. A `verification-prompt.md` prompt for a second CuaDriver/CDP browser pass that verifies every recommended link.
   - It must open every recommendation link.
   - It must confirm status, price, exact specs, and availability.
   - It must explicitly remove/correct any 404, sold, unavailable, wrong-spec, or LLM-hallucinated entries.

5. A `final-analysis-prompt.md` prompt for synthesizing the final recommendation from the normalized data.
   - Must include price thresholds, buy notes, bottleneck analysis, and seller questions.

6. A `sqlite-import-plan.md` note describing which generated JSON files should be imported into the central SQLite database.

For every generated CuaDriver/CDP browser prompt, require:
- HTML tables first, not prose.
- JSON outputs matching the normalized schema.
- Raw detail records preserved.
- Risk/scam/off notes.
- Buy notes.
- Follow-up questions.
- Direct links in every recommendation.

Normalized item schema:
{
  "id": "stable id or marketplace id",
  "source": "facebook-marketplace|ebay-au|gumtree|retailer|other",
  "marketplace": "facebook|ebay|gumtree|retailer|other",
  "listing_url": "direct URL",
  "title": "listing title",
  "price_raw": "price text",
  "price_aud": 0,
  "postage_aud": 0,
  "total_aud": 0,
  "listed_line": "listed date/status text",
  "location": "location text",
  "distance": "distance text",
  "delivery": "delivery text",
  "status": "active|sold|ended|unavailable|unknown",
  "type": "hardware type",
  "model_line": "model line",
  "chip": "processor/chip",
  "ram": "memory string",
  "ram_gb": 0,
  "ssd": "storage string",
  "year": "model year if known",
  "condition": "condition text",
  "included_accessories": "accessory text",
  "seller_name": "seller name",
  "seller_profile_url": "seller/profile URL",
  "seller_profile_notes": "profile notes",
  "seller_review_count": 0,
  "seller_star_rating": "rating text",
  "seller_joined_year": 0,
  "seller_reputation_badges": [],
  "seller_description": "seller-provided description",
  "priority": "A|B|C|X",
  "scam_off_notes": [],
  "price_sanity": "good|fair|high|overpriced|unknown",
  "buy_notes": "practical buyer assessment",
  "follow_up_questions": []
}

Return the prompt bundle with clear filenames and exact prompt text under each filename heading.
```

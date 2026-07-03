# eBay Australia used-hardware search prompt

Use this prompt with a browser-use/Codex GUI/Playwright-capable agent that can browse eBay. Replace the placeholders in `{braces}` before use.

```text
Use browser automation to search eBay Australia for used/refurb/open-box hardware candidates.

Do not buy anything, bid, add to cart, message sellers, make offers, save payment info, or contact sellers. Read-only research only.

Research run:
- Topic: {topic}
- Buyer location: {buyer_location}
- Country preference: Australia
- Delivery preference: prefer items located in Australia and deliverable to {buyer_postcode}; exclude or down-rank international sellers unless the price is exceptional.
- Marketplace: eBay Australia only: https://www.ebay.com.au/

Use case:
{use_case}

Target specs:
{target_specs}

Soft exclusions / down-rank:
{exclusions}

Search strategy:
1. Use eBay AU search.
2. For each query, apply filters where available:
   - Condition: Used, Seller refurbished, Opened never used, Excellent refurbished, Very good refurbished. Include New only as a benchmark if useful.
   - Item location: Australia only, if the filter exists.
   - Buying format: Buy It Now first. Also inspect Auction if price is attractive and ending soon.
   - Delivery: deliverable to {buyer_postcode}; prefer free/low-cost delivery.
   - Sort: Best Match, Newly Listed, and Price + Postage lowest; also inspect Sold/Completed listings for benchmarks.
3. Capture both active listings and sold/completed comps. Clearly mark active vs sold.
4. Deduplicate by item ID / URL / title+seller+price.
5. Open each promising listing detail page and extract details. Do not rely only on search cards.

Queries to run:
{queries}

For each listing extract:
- listing_id / item number if visible
- title
- price AUD
- postage/delivery AUD
- total landed price AUD
- seller location / item location
- estimated delivery date if visible
- condition
- active/sold/ended/auction/new/refurb/used
- source query
- category
- item specifics/specs relevant to the target
- seller name
- seller feedback count
- seller feedback percentage
- seller location
- returns policy
- warranty/refurb warranty if any
- description text, preserving important seller wording
- images count and URLs if easy
- direct listing URL

Risk/scam/off notes:
- international seller despite AU page
- stock photos only
- missing exact specs
- specs inconsistent with known model configs
- suspiciously cheap
- very low seller feedback or poor feedback percentage
- no returns for high-risk item
- vague/refurbished without warranty
- “for parts/not working”
- locked/MDM/iCloud/activation-lock risk for Apple devices
- inflated postage
- auction bidding risk
- seller has many similar listings with copied text

Buy notes:
- fit for use case
- expected parallel capacity / usefulness
- likely bottleneck: RAM, CPU, storage, battery, thermals, OS support, device age
- price sanity: good/fair/high/overpriced
- negotiation/offer target if offers accepted
- max price to pay
- compare against known new/refurb/reputable-retailer benchmarks

Output requirements:
1. Write a report to `{output_dir}/ebay-au-hardware-candidates.md`.
2. Write normalized JSON to `{output_dir}/items.json`.
3. Write seller JSON to `{output_dir}/sellers.json`.
4. Write raw search-card records to `{output_dir}/raw_search_hits.json`.
5. Write raw detail records to `{output_dir}/raw_detail_records.json`.
6. If images are downloaded or screenshotted, write `{output_dir}/images_manifest.json` and store files under `{output_dir}/images/`.

Report format:
- Start with HTML tables, not prose.
- Sections:
  - Best active candidates
  - Sold/completed price comps
  - Reputable refurb/new benchmarks if found on eBay
  - Excluded / suspicious / poor-fit listings
- After HTML tables, include CSV block.
- Then concise recommendation summary.

HTML table columns:
Priority | Source query | Status | Title | Total AUD | Item price | Postage | Location | Specs | Condition | Seller | Description | Risk/off notes | Buy notes | Link

Priority:
- A = strong candidate
- B = maybe
- C = low priority / unclear / overpriced
- X = likely scam/exclude

For long cells use `<details><summary>Show</summary>...</details>` and `<br>` for line breaks.

Normalized `items.json` schema should include at least:
{
  "id": "...",
  "source": "ebay-au",
  "marketplace": "ebay",
  "listing_url": "...",
  "title": "...",
  "price_raw": "...",
  "price_aud": 0,
  "postage_aud": 0,
  "total_aud": 0,
  "listed_line": "...",
  "location": "...",
  "delivery": "...",
  "status": "active|sold|ended|auction|buy-it-now|unknown",
  "condition": "...",
  "type": "...",
  "model_line": "...",
  "chip": "...",
  "ram": "...",
  "ram_gb": 0,
  "ssd": "...",
  "year": "...",
  "seller_name": "...",
  "seller_profile_url": "...",
  "seller_feedback_count": 0,
  "seller_feedback_percent": "...",
  "seller_location": "...",
  "seller_description": "...",
  "priority": "A|B|C|X",
  "scam_off_notes": [],
  "price_sanity": "good|fair|high|overpriced|unknown",
  "buy_notes": "...",
  "follow_up_questions": []
}

Be explicit when information is missing. Do not invent specs. If a listing is ambiguous, mark it C and add the exact ambiguity to risk notes.
```

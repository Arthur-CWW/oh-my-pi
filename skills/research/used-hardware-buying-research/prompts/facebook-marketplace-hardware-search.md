# Facebook Marketplace used-hardware search prompt

Use this with a browser-use/Codex GUI agent that can use a logged-in Chrome/Facebook profile. Replace `{braces}`.

```text
Use my logged-in browser session to search Facebook Marketplace for used hardware candidates.

This is read-only research. Do not buy, message sellers, click seller contact/send flows, make offers, save payment info, or interact with payment surfaces.

Research run:
- Topic: {topic}
- Location anchor: {location_anchor}
- Radius: {radius}
- Marketplace: Facebook Marketplace
- Output directory: {output_dir}

Use case:
{use_case}

Target specs:
{target_specs}

Down-rank/exclude:
{exclusions}

Search queries:
{queries}

Procedure:
1. Set Marketplace location to `{location_anchor}` and radius `{radius}` if Facebook accepts it. If not accepted, use the closest accepted city/region and preserve shown listing locations.
2. Run every query.
3. Capture shallow search-card records first.
4. Deduplicate by listing URL/item ID/title+price.
5. Open each promising detail page.
6. Extract all visible listing details, seller details, seller profile notes, and listing description.
7. Capture image URLs or screenshots where feasible.
8. Do not contact sellers.

For each item extract:
- id
- direct listing URL
- title
- price raw and numeric local price
- location and distance if shown
- listed date/status line
- category/type
- condition
- exact specs relevant to the target
- included accessories
- seller name and profile URL
- seller review count/rating/badges/joined year/profile notes
- seller description, preserving wording and line breaks
- images count and local screenshots/image URLs

Risk/scam/off notes:
- suspiciously low price
- stock photos only
- vague specs
- spec mismatch with known valid configs
- location mismatch
- seller recently joined or blank profile
- low/poor reviews
- repeated high-value electronics listings
- requests deposit/shipping/courier/PayID before inspection
- refuses inspection/local pickup
- activation lock / MDM / iCloud risk for Apple devices
- battery health risk for laptops/phones/tablets

Output:
- `{output_dir}/facebook-marketplace-candidates.md` with HTML tables first
- `{output_dir}/facebook-marketplace-candidates.html`
- `{output_dir}/facebook-marketplace-candidates.csv`
- `{output_dir}/items.json`
- `{output_dir}/sellers.json`
- `{output_dir}/raw_search_hits.json`
- `{output_dir}/raw_detail_records.json`
- `{output_dir}/images_manifest.json`
- `{output_dir}/images/` if any images/screenshots are saved

HTML sections:
1. Best candidates
2. Maybe / secondary candidates
3. Excluded / suspicious / poor-fit listings
4. Seller risk notes

HTML columns:
Priority | Type | Title | Price | Location / Distance | Specs | Condition | Seller | Description | Scam/off notes | Buy notes | Follow-up questions | Link

Use `<details><summary>Show</summary>...</details>` for long description/buy-note cells.

Priority:
- A = strong candidate
- B = maybe
- C = low priority / unclear / overpriced
- X = likely scam/exclude

Buy notes must include:
- fit for use case
- expected capacity/usefulness
- likely bottleneck
- price sanity
- target offer and max price
- comparison against known benchmark alternatives

Be explicit when Facebook blocks data or when information is missing. Do not infer exact specs unless the listing says them.
```

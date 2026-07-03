# Verify recommendation links with browser use

Use this after LLM/web-search/browser agents produce recommendations. It prevents hallucinated, sold, or wrong-spec links from reaching the final shortlist.

```text
Verify every recommended listing/retailer link below using browser automation.

Read-only verification. Do not buy, bid, message sellers, contact sellers, add to cart, make offers, or use payment surfaces.

Open each link and verify:
- page loads or 404/blocked/sold/unavailable
- exact title
- exact current price
- exact current specs
- condition
- location/delivery
- seller/retailer
- stock/status
- whether it matches the recommendation claims

Links to verify:
{links_to_verify}

For each link output:
- label
- URL
- HTTP/status if available
- final URL after redirects
- page title
- verified status: verified / wrong spec / unavailable / sold / blocked / 404 / uncertain
- verified price
- verified specs
- mismatch notes
- corrected recommendation action: keep / downgrade / remove / ask human to inspect
- evidence excerpt copied from page text

Output:
1. HTML verification table first.
2. JSON array `verification_results.json` with the same data.
3. A corrected shortlist with direct links.

Important:
- If a retailer product URL is 404 or redirects to a generic page, mark it REMOVE unless the exact product can be found elsewhere on the same retailer site.
- If a supposed config is invalid on the manufacturer configurator, mark it REMOVE or QUESTIONABLE.
- If Facebook hides some details without login or changes location/radius, mark uncertainty explicitly.
```

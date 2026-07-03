---
name: used-hardware-buying-research
description: Research and verify used/refurb hardware purchases across Facebook Marketplace, eBay, Gumtree, and reputable retailers. Use when buying Macs, phones, device farms, GPUs, lab machines, or other used hardware; creates prompts, normalized reports, SQLite imports, verification passes, and seller due-diligence checklists.
---

# Used Hardware Buying Research

This skill formalizes a repeatable process for buying used/refurb hardware without trusting a single LLM/search result.

It is designed for tasks like:

- Mac build farm / iOS simulator / browser automation host research.
- Used iPhone/iPad/Android device farm research for legitimate QA and device testing.
- GPUs, mini PCs, networking gear, NASes, cameras, or other used hardware.

Do **not** use this skill to facilitate illegal, deceptive, or platform-abusive activity. For device farms, keep the research framed around legitimate QA/testing/automation infrastructure, not spam, fake engagement, credential abuse, or account-farming operations.

## Core principles

1. **Separate discovery from verification.** Marketplace scrapes and LLM research create candidates; a browser verification pass decides what remains.
2. **Preserve raw data.** Save raw search cards, raw detail records, seller records, images, and normalized items.
3. **Use direct links in every recommendation.** Never recommend a listing without the URL.
4. **Prefer local/regional sellers when delivery risk matters.** For Australia, prefer item location/delivery from inside Australia.
5. **Treat seller descriptions as evidence.** Preserve exact seller wording where possible.
6. **Record uncertainty.** Missing specs, blocked pages, redirects, sold listings, and impossible configs must be called out explicitly.
7. **Use SQLite as the central memory.** Import normalized JSON into `~/projects/automations/buying-research/hardware-research.sqlite`.

## Folder layout

Create one run folder per research task:

```bash
RUN=~/projects/automations/buying-research/<slug>-$(date +%Y-%m-%d)
mkdir -p "$RUN"/{prompts,sources,notes,scripts}
```

Recommended structure:

```txt
~/projects/automations/buying-research/
  hardware-research.sqlite
  <run>/
    README.md
    prompts/
    sources/
      facebook-marketplace-candidates/
      ebay-au-candidates/
      retailer-benchmarks/
      chatgpt/
      verification/
    notes/
```

## Prompt templates

Use or adapt these templates:

- `prompts/meta-generate-marketplace-prompts.md` — generate marketplace-specific prompts for any hardware category.
- `prompts/facebook-marketplace-hardware-search.md` — logged-in Facebook Marketplace browser-use scrape prompt.
- `prompts/ebay-au-hardware-search.md` — eBay AU prompt; prefers listings located/delivered from Australia.
- `prompts/retailer-benchmark-research.md` — reputable retailer / official refurb benchmarks.
- `prompts/verify-recommendations-browser.md` — second-pass browser verification.
- `prompts/final-analysis.md` — final synthesis after verification.
- `prompts/iphone-device-farm-example-input.md` — example input for legitimate iPhone device-farm hardware research.

When a user asks for “a prompt for another agent,” fill these templates with concrete:

- location/radius,
- target specs,
- exclusions,
- search queries,
- output directory,
- normalized JSON schema,
- verification requirements.

## Standard workflow

### 1. Define target and constraints

Collect:

- use case,
- location/radius,
- hard requirements,
- soft preferences,
- exclusions,
- budget bands,
- acceptable risk level,
- marketplaces to search.

For hardware that could support platform abuse, explicitly constrain the use to legitimate testing/QA/device management.

### 2. Create prompts

Use `prompts/meta-generate-marketplace-prompts.md` to produce marketplace prompts, or manually fill the relevant prompt template.

For eBay Australia, prefer:

- `www.ebay.com.au`,
- item location Australia,
- deliverable to buyer postcode,
- total landed price including postage,
- active listings and sold/completed comps.

### 3. Run marketplace discovery agents

For CuaDriver/CDP-backed browser agents:

- allow logged-in browser profiles if needed,
- do not contact sellers,
- do not buy/bid/message/make offers,
- output HTML + CSV + JSON + raw records.

### 4. Run reputable retailer benchmark pass

Use official refurb/manufacturer store and reputable local refurb retailers to anchor prices.

Examples for Australian Apple hardware:

- Apple Certified Refurbished Australia,
- Macfixit Australia,
- Reebelo Australia,
- OzMobiles,
- Phonebot,
- Mobile Monster,
- Cash Converters,
- Officeworks/JB Hi-Fi/The Good Guys only for clearance/open-box/refurb if relevant.

### 5. Verify every recommendation

Use `prompts/verify-recommendations-browser.md` or a direct CDP/browser script.

Remove or downgrade:

- 404 pages,
- sold/unavailable pages,
- generic redirects,
- wrong specs,
- invalid manufacturer configurations,
- stale search snippets,
- listings where price/specs changed.

This step is mandatory before giving final recommendations.

### 6. Import normalized data to SQLite

Use the importer:

```bash
cd /Users/arthur/projects/pi-web-access/skills/used-hardware-buying-research
./scripts/import_hardware_research.py \
  --run-dir ~/projects/automations/buying-research/<run>/sources/<bundle-with-items-json> \
  --run-id <stable-run-id> \
  --topic "<topic>" \
  --marketplace <facebook-marketplace|ebay-au|gumtree|retailer>
```

Default DB:

```txt
~/projects/automations/buying-research/hardware-research.sqlite
```

Useful query:

```bash
sqlite3 ~/projects/automations/buying-research/hardware-research.sqlite \
  '.headers on' '.mode column' \
  'select priority, marketplace, model_line, chip, ram_gb, ssd, price_aud, title, listing_url from listing_summary limit 30;'
```

### 7. Final recommendation

Only after verification, produce:

- best value shortlist,
- best high-end/low-risk shortlist,
- avoid/remove list,
- price thresholds,
- seller questions,
- direct links,
- next action plan.

## Seller due-diligence checklist

Ask/verify before purchase:

- exact spec screenshot (About This Mac / Settings / system info),
- serial/model identifier,
- receipt and warranty/AppleCare status,
- no Activation Lock / iCloud lock / MDM lock,
- no repairs/liquid damage/hardware faults,
- local inspection before payment where possible,
- battery health/cycle count for phones/laptops/tablets,
- included charger/power cable/box/accessories,
- return/warranty terms for refurb retailers.

## Notes on automation gaps

Some marketplace work is still prompt-driven rather than fully automated, especially:

- logged-in Facebook Marketplace search,
- CuaDriver/CDP GUI browser workflows,
- provider-specific frontend LLM calls,
- marketplace UI changes.

When asked, generate clear prompts for those agents using the templates above, then import their output into SQLite and verify the recommendations.

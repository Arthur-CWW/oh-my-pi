# Kagi API quirks / reverse-engineering notes

_Last updated: 2026-02-21_

## 1) Search streaming path

### Endpoint
- `GET https://kagi.com/socket/search`

### Required params observed
- `q` (query)
- `nonce` (random string)

### Optional params observed
- `r` region (e.g. `us`, `au`)
- `l` lens ID (discovered dynamically per account/session; observed defaults: `0` academic, `1` forums, `2` programming, `3` pdfs, `4` news_360, `5` small_web)
- `dr` date range (`1` day, `2` week, `3` month, `4` year)
- `from_date`, `to_date`
- `order` (`2|3|4`), `dir` (`asc|desc`)
- `verbatim=1`
- `personalized=0`

### Transport notes
- Request `Accept: text/event-stream`
- Response body is SSE-like chunks (`hi`, then `id:`, `data:` blocks)
- Notable tags inside data arrays: `top_content`, `top-content-unique`, `search.info`, `search`
- Server refreshes `kagi_session` cookie in many responses

### Lens discovery strategy (2026-02-21)
- Dynamic discovery now implemented in client (`discoverLenses`):
  - `GET /search` with authenticated session headers
  - Parse lens candidates from search-page anchors (`/search?...&l=<id>`) and embedded JSON descriptors (`slug` + `id` pairs)
- Returned lens map is merged with observed fallback defaults so existing names continue to work if discovery yields partial data.
- Search CLI now supports `lenses:list` and `search --discover-lenses 1` (enabled by default).

---

## 2) Advanced search form flow

### Endpoint
- `POST https://kagi.com/search/advanced`

### Form keys observed
- `all_words`
- `exact_words`
- `any_words`
- `none_words`
- `region`
- `last_update`
- `from_date`
- `to_date`
- `site`
- `terms_appearing` (`title`/`url`/empty)
- `file_type`

### Option values observed via Puppeteer (2026-02-21)
- Advanced form opens from search page modal toggle (`#menu-advanced-search-toggle`) and posts to `/search/advanced`.
- `region` is a large radio group (ISO-like country/locale codes + `no_region`), e.g. `us`, `au`, `be`, `be_fr`, `ca`, `ca_fr`, `es`, `es_ca`.
- `last_update` options: `"" | "1" | "2" | "3" | "4"`.
- `terms_appearing` options: `"" | "url" | "title"`.
- `file_type` options include:
  - `""`, `pdf`, `ps`, `csv`, `epub`, `gearth`, `gps`, `hancom`, `html`, `excel`, `powerpoint`, `word`,
  - `open_presentation`, `open_spreadsheet`, `open_text`, `rtf`, `svg`, `latex`, `text`, `xml`.

### Behavior
- Returns `302` with `Location: /search?...`
- Example produced query expansion: `intitle:site:myanimelist.net filetype:pdf&r=us&dr=3`
- Current client/test coverage now validates full known payload keys and default-empty behavior for omitted fields (including `terms_appearing=any` => empty form value).

---

## 3) Settings update API

### Endpoint
- `POST https://kagi.com/settings`

### Quirk
- In-page settings toggles issue background fetches with `application/x-www-form-urlencoded;charset=UTF-8`
- `no_redirect=true` present in AJAX save payloads

---

## 4) Personalization (domains)

### Set/update
- `POST https://kagi.com/esr/user_rules`
- Payload: `kind=<rule>&domain=<domain>`
- Rule kinds: `-2` block, `-1` lower, `0` normal, `1` raise, `2` pin

### Delete
- `POST https://kagi.com/esr/user_rules/delete`
- Payload: `domain=<domain>`

### Bulk add
- `POST https://kagi.com/esr/user_rules/bulk`
- Payload: `redirect=/settings/user_ranked&domain_list=<newline list>&k=<rule>`

---

## 5) Personalization (video channels)

### Set/update
- `POST https://kagi.com/esr/video_rules`
- Payload: `kind=<rule>&platform_id=<platform>&creator_id=<id>&creator_name=<display>`

### Delete
- `POST https://kagi.com/esr/video_rules/delete`
- Payload: `platform_id=<platform>&creator_id=<id>`

### Platform-id quirk
- Settings form uses `platform_id=you_tube`
- `k_serp.js` reverse-engineered handler derives `youtube` from domain and posts that
- Backend accepted `you_tube` in observed tests; prefer this canonical form from settings UI

---

## 6) Client-side ranking logic (from shipped JS)

From fetched `k_serp.js`:
- `executeStatusChange(kind, domain, domainInfo)` chooses endpoint:
  - domain contains `/` => `/esr/video_rules`
  - else => `/esr/user_rules`
- For video rules it maps domain into `platform_id`, `creator_id`, `creator_name`
- Local constants in JS match rule mapping (`RULE_BLOCK=-2` ... `RULE_PIN=2`)

---

## 7) Auth/session observations

- `kagi_session` cookie is the key auth cookie (HttpOnly, Secure, SameSite=Lax)
- Search SSE responses often re-issue this cookie
- Kagi browser extension stores a session token and injects `X-Kagi-Authorization` for Kagi requests
- Session/API/token material should be treated as secrets

---

## 8) Accessibility tree observations (captured)

Snapshots saved under `packages/kagi/output/a11y/`:
- `search-advanced-open.json`
- `settings-search.json`
- `settings-user-ranked-domains.json`
- `settings-user-ranked-video.json`

High-level findings:
- Advanced search modal root exists (`#menu-advanced-search`) but may be hidden until toggled
- Settings/search exposes toggle controls in accessibility tree (checkboxes, textboxes, dropdown buttons)
- User-ranked domains tab exposes many action buttons (`Block/Lower/Raise/...`) in tree
- User-ranked video tab currently exposes table headers/links; per-row controls appear only when entries exist

---

## Open follow-up items

1. **Lens discovery robustness**
   - Dynamic discovery is live, but parser heuristics should be re-verified when Kagi ships major search-page markup changes.

2. **Advanced-search combinatorial validation**
   - Known fields are covered in unit tests.
   - End-to-end matrix sweeps across all regions/file-types/date combinations are still pending.

# Kagi API quirks / reverse-engineering notes

_Last updated: 2026-02-20_

## 1) Search streaming path

### Endpoint
- `GET https://kagi.com/socket/search`

### Required params observed
- `q` (query)
- `nonce` (random string)

### Optional params observed
- `r` region (e.g. `us`, `au`)
- `l` lens (`0` academic, `1` forums, `2` programming, `3` pdfs, `4` news_360, `5` small_web)
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
- `file_type` (`pdf`, etc)

### Behavior
- Returns `302` with `Location: /search?...`
- Example produced query expansion: `intitle:site:myanimelist.net filetype:pdf&r=us&dr=3`

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

1. **Lens mapping should be dynamic**
   - Current client uses observed lens IDs from this session.
   - Not complete for accounts with custom/extra lenses; dynamic discovery is pending.

2. **Advanced-search option matrix not fully exhausted**
   - Payload shape is reconstructed and core fields are tested.
   - Full combinatorial validation across all filters/regions/file-types is still pending.

# Findings from `kagisearch/browser_extensions`

Repo copied under: `packages/kagi/vendor/browser_extensions`

## Relevant behavior (shared/src/background.js)

- Extension tracks a session token (often from `kagi_session` cookie)
- It injects header on Kagi requests using declarative rules:
  - `X-Kagi-Authorization: <sessionToken>`
- The sync path reads cookie:
  - `browser.cookies.get({ url: 'https://kagi.com', name: 'kagi_session' })`
- It can persist token manually from popup settings

## Summarizer API wiring (shared/src/lib/utils.js)

- Uses auth header variants:
  - consumer/session: `Authorization: <token>` against `/mother/summary_labs`
  - API key: `Authorization: Bot <api_token>` against `/api/v0/summarize`

## Why this matters for unofficial client behavior

- Browser session cookie is enough for authenticated web flows
- Header injection (`X-Kagi-Authorization`) is used by official extension for consistency in private/incognito contexts
- For search replay, mimicking UA + cookies + referer + stream accept header is the closest browser parity

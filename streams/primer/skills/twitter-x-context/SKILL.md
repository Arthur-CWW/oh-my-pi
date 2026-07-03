---
name: twitter-x-context
description: Extract a public or authenticated Twitter/X post, article, or thread into Markdown prompt context. Public content goes through Defuddle via fetch_content; auth-gated content uses cmux browser + OMP/Defuddle HTML extraction.
---

# Twitter/X Context Extraction

Use this skill when an agent needs the content of one or more Twitter/X URLs as prompt context, without relying on raw X API keys, third-party scrapers, or Nitter.

## When to use

- A user shares an `x.com` or `twitter.com` link and wants a summary, quote, reply draft, fact check, or analysis.
- You need to preserve tweet/thread/article text, author info, media/alt text, and visible links for downstream tasks.
- The source may require the user's cmux browser/account because it is not visible to an anonymous public fetch.

## Automatic endpoints: conservative guidance

The extraction lane depends on **whether the content is public and how it's accessed**:

| Content type | Extraction lane | Rationale |
|---|---|---|
| Public X article/post/thread URL | **Defuddle via `fetch_content`** (default) | Defuddle uses the `twitter-x` extractor by default for `x.com`/`twitter.com` URLs, producing clean Markdown with frontmatter. `fetch_content` auto-routes X/Twitter URLs through Defuddle. |
| Auth-gated, private, or current-account-only content | **cmux browser + OMP HTML extraction** | Requires the user's logged-in browser session. cmux opens the URL in a surface, waits for render, captures the HTML body, then feeds it to an OMP wrapper/tool or Defuddle with URL context. |
| Direct X GraphQL, `i/api` endpoint capture, or raw API introspection | **Separate authenticated capture lane** | X's internal GraphQL/i/api endpoints are a distinct authenticated-capture path. Do not use these unless explicitly requested. They are never reached through the public Defuddle path. |

Never route public X URLs through cmux browser when Defuddle can handle them directly. Only fall back to cmux browser when the URL is not accessible to Defuddle.

## Default path: Defuddle via `fetch_content` (public content)

`fetch_content` automatically extracts public X/Twitter URLs through Defuddle's `twitter-x` extractor, downloads referenced `pbs.twimg.com/media/...` images as files, and rewrites Markdown image references to local relative paths. No manual steps needed — pass the URL and receive Markdown with frontmatter plus file-backed media references.

```ts
fetch_content({ url: "https://x.com/thegreatest_sv/status/2054978445793227047" })
// or batch:
fetch_content({ urls: ["https://x.com/user/status/1", "https://x.com/user/status/2"] })
```

The CLI equivalent (standalone, outside the agent context):

```bash
npx -y defuddle parse <url> --markdown --frontmatter
```

Defuddle output includes:
- **Frontmatter**: `title`, `author`, `site`, `published`, `source`, `domain`, `language`, `description`, `word_count`
- **Body**: Clean Markdown with preserved line breaks, images, links, and structure
- **Media**: Markdown image references with alt text when available. In OMP `fetch_content`, Twitter/X media URLs are localized to files by default.

## Required asset localization

A Twitter/X extraction is not complete until images are captured as separate local files and the Markdown points at those files. Do **not** inline images as base64, data URIs, HTML blobs, or embedded binary content.

OMP `fetch_content` does this automatically for public X/Twitter pages:
1. Downloads every unique `pbs.twimg.com/media/...` image referenced by the Markdown.
2. Stores files under `docs/research/twitter-x/assets/<handle-status-id>/` by default.
3. Rewrites Markdown image URLs to relative paths like `assets/<handle-status-id>/<image-file>.jpg`.
4. Keeps the remote URL only if the download failed; record that failure under `omissions` / `limitations` when producing a saved context file.

Set `PI_AUTO_LOCALIZE_TWITTER_IMAGES=0` to keep remote image URLs, or `PI_TWITTER_X_ASSET_ROOT=<dir>` to change where image files are written.

Preferred final layout:

```text
docs/research/twitter-x/example.md
docs/research/twitter-x/assets/example/image-1.jpg
docs/research/twitter-x/assets/example/image-2.png
```

The final Markdown should be usable offline as prompt context plus its asset folder.

## Auth-gated path: cmux browser + OMP/Defuddle HTML extraction

Use this path when the URL requires the user's logged-in browser session.

cmux browser surfaces use WKWebView and do not expose Chrome CDP. The `cmux browser` API (`click`, `fill`, `press`, `scroll`, `snapshot`) is the supported WebView control surface. For human-like input on native/Electron windows, use CuaDriver (AX/CGEvents). Use CDP only with Chrome/Chromium or Electron targets that expose a CDP endpoint — see `skill://cmux-browser-drive`.

1. **Open** the URL in a cmux browser pane:

   ```bash
   cmux --json browser open <url>
   # -> surface:N
   ```

2. **Wait** for the page to settle. Allow time for the main column to render; do not treat a blank or spinner state as final.

   ```bash
   cmux browser surface:N wait --load-state complete --timeout-ms 15000
   cmux browser surface:N get url
   ```

3. **Capture the rendered HTML body** (not just text):

   ```bash
   cmux browser surface:N get html body
   ```

4. **Feed the HTML to an OMP wrapper/tool or Defuddle** for structured Markdown extraction. The wrapper/tool **MUST supply the original URL** as context so the extractor can apply URL-specific heuristics (e.g. `twitter-x` extractor rules). Plain CLI stdin (`cat html | npx defuddle parse --stdin`) **may lose extractor context** because Defuddle can't determine the source domain from raw HTML alone — the OMP wrapper must pass the URL explicitly.

   ```ts
   // Example: OMP wrapper supplying URL context
   defuddleParse({ html: capturedBody, url: "https://x.com/user/status/123" })
   ```

5. **Close or navigate away** when done:

   ```bash
   cmux close-surface --surface surface:N
   ```

## Fallback path: cmux browser text body

Use this path **only when Defuddle cannot reach or parse the page** (e.g. Defuddle receives an interstitial, empty page, or otherwise unusable output). This is a last-resort content recovery, not a first-choice extraction method.

```bash
cmux browser surface:N get text body
```

The raw text body skips structured extraction — you get plain text from the DOM without frontmatter, media parsing, or link preservation. Prefer the auth-gated HTML path when structured output matters.

## Allowed interactions only

- Navigation commands (`open`, `goto`, `back`, `reload`).
- Expansion commands for visible UI such as "Show more", "Show replies", or thread collapse controls.
- Scrolling to reveal additional replies or thread entries that are already in the DOM.

Do **not** inject JavaScript, insert CSS, mutate the DOM, call internal X endpoints, or paste code into the page console. Use only rendered reads (`get text body`, `get html body`) and safe interaction commands for navigation/expansion.

## Parsing guidance

- Ignore navigation chrome, sidebars, "For you" / "Trending" / "Who to follow", ads, and footers.
- Keep only the main tweet/article column.
- Preserve line breaks within the tweet/article body; they often carry meaning.
- Preserve mentions (`@handle`) and URLs as they appear; do not shorten or rewrite them.
- Distinguish primary content from visible replies: label replies as such when they appear.
- If the thread contains quote tweets, include the quoted author's display name/handle and the quoted body when visible.
- Extract media links and alt text only when visibly rendered; do not fabricate descriptions.

## Markdown output contract

Include all of the following fields that are visible in the rendered page:

- **source_url**: the original `x.com` or `twitter.com` URL.
- **fetched_at**: ISO 8601 timestamp of extraction.
- **author**: author display name and handle (`@handle`) if visible.
- **body**: full tweet or article body text, preserving line breaks.
- **thread**: subsequent tweets/replies in the thread, each with author, body, and a link when visible.
- **quote_tweet**: quoted tweet author, body, and link if a quote tweet is visible.
- **media**: relative local image/video/card asset paths plus alt text when shown; include remote URL only when local capture failed.
- **links**: any distinct URLs referenced in the body or card.
- **omissions**: note anything that was hidden, unavailable, or not visible in the rendered page.
- **limitations**: note if content was truncated or replies were hidden.

When extracted through Defuddle (default path), the frontmatter block supplies `title`, `author`, `site`, `published`, `source`, `domain`, `language`, `description`, and `word_count`.

## Account-owned flows

Use only the current visible page state and the user's existing browser session. If the page needs a human decision or credential the agent does not have, report the state and wait for user direction.

## Output template

When extracted through Defuddle (default, public):

```markdown
---
title: "…"
author: "@handle"
site: "X (Twitter)"
published: YYYY-MM-DD
source: "https://x.com/…"
domain: "x.com"
language: "en"
description: "…"
word_count: N
---

# Twitter/X Context

[Defuddle markdown body with preserved structure, local image paths, and links]
```

When extracted through cmux browser (auth-gated or fallback):

```markdown
# Twitter/X Context

- **Source**: <source_url>
- **Fetched**: <fetched_at>
- **Author**: <display_name> (<@handle>)

## Body

<tweet/article body, line breaks preserved>

## Thread / Replies

1. **<author>** (<@handle>): <body>
   - <link if any>

## Quote Tweet

- **<quoted author>** (<@handle>): <quoted body>
  - <link>

## Media

- Image: <url> (alt: <alt text or "not shown">)
- Video: <url>

## Links

- <url>

## Omissions / Limitations

- <what was hidden, gated, or unavailable>
```

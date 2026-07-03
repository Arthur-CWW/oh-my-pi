---
name: source-archive
description: Archive original public sources into repo-local research docs. Use when asked to pull in articles, videos, transcripts, or reference material from external URLs and keep a cleaned copy in the repository.
---

# Source Archive

Prefer canonical sources over third-party summaries or AI-generated transcripts.

## What to do

1. **Start from the original URL**
   - Articles/docs: use `fetch_content` on the publisher URL.
   - YouTube: use `youtube_transcript` on the actual video URL.
   - Only keep third-party transcript dumps under `raw/` for comparison, never as the primary source.

2. **Store cleaned sources under `docs/research/`**
   - Put durable cleaned copies in a task-specific directory.
   - Use subdirectories like:
     - `cleaned/` for normalized markdown/text you intend future agents to read
     - `raw/` for noisy vendor dumps or imported artifacts

3. **Normalize before saving**
   - Add a short header with title, URL, retrieval date, and source type.
   - Remove boilerplate navigation/junk.
   - For YouTube captions, collapse overlapping auto-caption cues and keep readable timestamped paragraphs.
   - Preserve meaning; do not paraphrase away important wording.

4. **Write a manifest**
   - Keep a small `manifest.md` or `source-urls.txt` with canonical URLs and local filenames.
   - Note whether a transcript came from manual captions, auto captions, or third-party ASR.

5. **Update nearby research README if useful**
   - Point future agents at the cleaned files first.
   - Mention the `raw/` directory only as fallback/reference.

## Guidelines

- Prefer the smallest durable artifact that preserves the source.
- If a transcript is poor, regenerate from the original source instead of polishing a bad third-party dump.
- Keep provenance explicit in-file so a future agent can audit or refresh it.
- Do not commit cookies, auth data, browser exports, or private captures.

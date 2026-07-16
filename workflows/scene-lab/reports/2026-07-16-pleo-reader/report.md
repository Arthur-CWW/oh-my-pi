---
title: Pleometric reader proof report
date: 2026-07-16
agent: PleoReader
status: complete
---

# Pleometric reader proof

## Result

- Created `INDEX.md` plus 7 theme files under `docs/research/power-posting-sources/pleo-reader/`.
- Mapped all 49 sections and all 136 unique status IDs from `pleometric-longposts.md` exactly once across the theme files.
- Preserved every longposts body as an unedited contiguous block. Section 21 additionally gains its earlier archived metrics lead (`2043859059766341862`).
- Added 12 substantive archive-only entries comprising 16 status records beyond longposts: the philosophy-hunt miss, Arthur’s SynthID bookmark, platform-latency and workflow observations, audience-position statements, the pornography/attention mini-sequence, and remix/economics observations.

| Theme file | Threads |
| --- | ---: |
| `01-medium-message-hyperreality.md` | 8 |
| `02-remix-velocity-economics.md` | 12 |
| `03-platforms-algorithms-distribution.md` | 7 |
| `04-craft-pipelines-tools.md` | 12 |
| `05-audience-attention-culture.md` | 6 |
| `06-ai-media-demand-backlash.md` | 6 |
| `07-persona-self-curation-practice.md` | 10 |

`data/inspiration/pleometric/transcripts.json` contains 39 media transcripts (22 nonempty). They were inspected as context but not substituted for tweet/thread bodies; the reader retains source media placeholders, consistent with the no-media-download and verbatim-tweet scope.

## Bookmark overlap

The archive contains 135 rows in `source_lane='x-bookmark-sync-devtools'`; joining that lane against `lower(username)='pleometric'` returns **3 pleometric-authored bookmarks**. Two were already in longposts (`2052979237678653532`, `2073920351541588446`); one is newly included (`2050247741356277880`). All three entries are marked ★ in `INDEX.md` and their theme headers.

## Baudrillard / Pygmalion / simulacrum hunt

Executable rerun query (SQLite JSON1):

```sql
WITH pleo AS (
  SELECT id, created_at, url,
         json_extract(data_json, '$.text') AS text,
         lower(json_extract(data_json, '$.text')) AS folded
  FROM tweets
  WHERE lower(username) = 'pleometric'
)
SELECT id, created_at, url, text
FROM pleo
WHERE folded LIKE '%baudrillard%'
   OR folded LIKE '%simulacr%'
   OR folded LIKE '%pygmalion%'
   OR folded LIKE '%hyperreal%'
   OR folded LIKE '%mcluhan%'
   OR folded LIKE '%mimesis%'
ORDER BY created_at, id;
```

The discovery scan used Python `re.IGNORECASE` with the exact grep pattern `baudrillard|simulacr|pygmalion|hyperreal|mcluhan|mimesis`. It scanned all 666 pleometric rows and returned 5 statuses: `2050765107873853892`, `2042597455921909918`, `2040814218497126624`, `2036244118137934145`, and `2035403894767911200`. Counts by term: simulacr 2, McLuhan 2, mimesis 1; Baudrillard 0, Pygmalion 0, hyperreal 0. Every hit is present verbatim in the reader.

## Rerun / extend

1. Requery authored bookmark overlap:

   ```sql
   SELECT t.id, t.created_at, t.url, json_extract(t.data_json, '$.text') AS text
   FROM tweets AS t
   WHERE lower(t.username) = 'pleometric'
     AND t.source_lane = 'x-bookmark-sync-devtools'
   ORDER BY t.created_at, t.id;
   ```

2. Parse `pleometric-longposts.md` on `## <number>.` headings; require the resulting section numbers to equal 1–49 with no duplicates, then allocate each section once to a theme.
3. Compare all status IDs found in the source metadata with status URLs in the seven theme files. The current invariant is 136/136 source IDs present.
4. For new archive material, exclude IDs already present in longposts; inspect long text, same-author chronological sequences, and the terms `platform`, `algorithm`, `viral`, `meme`, `remix`, `audience`, `workflow`, `pipeline`, `signifier`, and `simulacr`. Preserve `json_extract(data_json, '$.text')` exactly and add media-table placeholders rather than downloading media.
5. Re-run the philosophy regex above after any archive sync. Record new zero/nonzero term counts in both `INDEX.md` and this report.

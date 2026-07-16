---
title: Pleometric meta index and verbatim archive
date: 2026-07-15
agent: PleoVerbatimIndex
status: complete
---

# Scope

Personal pleometric navigation index plus verbatim captures from the local twitter-archive SQLite database and the local pleometric inspiration manifest. No live Twitter access and no media downloads.

## Deliverables

- `docs/research/power-posting-sources/pleometric-meta-index.md`: 49 navigation rows. Each row contains only date, status URL(s), one allowed category tag, and the tweet's own opening line.
- `docs/research/power-posting-sources/pleometric-longposts.md`: 42 new sections / 120 statuses, appended after the seven pre-existing sections. The 42 sections are 31 archive candidate clusters (97 statuses), three archive standalone meta posts, the 13-status “infinite referential mirrors” cluster, and seven manifest candidates. Existing sections were not recaptured.
- The five manifest-only gap records are preserved verbatim from the local manifest and marked `Source: manifest; archive status: gap`; the two manifest candidates also present in SQLite are marked `archive status: present`.

## Archive pass (latest observed 2026-07-16)

- Archive path: `data/twitter-archive/twitter-archive.sqlite`.
- Latest query matched 666 `@pleometric` rows. The database received two additional rows while CorpusSync was active (the first query matched 664).
- Rows with `created_at`: 651; rows with non-null `conversation_id`: 11; `thread_status=complete`: 1; media rows for this account: 165. The observed media table has 165 `image` rows and no `video` rows for this account, so video markers come from the staged source/manifest rather than downloads.
- The normalized rows omit reply-parent IDs for most posts (`conversation_id` is null for 655 of 666 rows). Candidate boundaries therefore use text continuity and close posting times; rerun after sync should confirm them with richer reply metadata.
- No selected source records were missing from the 120-status append. Two exploratory >600-character records were intentionally excluded as non-target personal material: 2041330541920649469 (agritech startup history) and 2037211153571381469 (GPT-cadence writing note).

## Seed verification

The staged source `local://pleometric-referential-mirrors.md` matches the archive's main tweet text exactly after removing only the staged heading/provenance/separator lines: 10,170 characters, exact comparison true. The essay section includes all 13 recovered archive statuses in order, including media-only posts as placeholders and every recovered text reply.

For the two manifest candidates that are also in SQLite, the manifest adds presentation blank lines/trailing spaces that the normalized archive text omits; after trimming formatting-only whitespace, both appended captures match their manifest text exactly.

## Gaps and rerun

CorpusSync is syncing bookmarks, new handles, and thread media into the same SQLite database. Re-run the selection after that sync to catch additional statuses, recover reply-parent metadata, and re-check candidate boundaries.

The inspiration manifest (`data/inspiration/pleometric/manifest.json`) contains 133 unique status IDs; 43 are absent from the latest observed archive. Status URLs for those gaps:

- https://x.com/pleometric/status/2041271870771597643
- https://x.com/pleometric/status/2041718361403343273
- https://x.com/pleometric/status/2041721732885557733
- https://x.com/pleometric/status/2044829644910641471
- https://x.com/pleometric/status/2046954980637016382
- https://x.com/pleometric/status/2047021422086627633
- https://x.com/pleometric/status/2047074844483731515
- https://x.com/pleometric/status/2049660615019401348
- https://x.com/pleometric/status/2049905101309972624
- https://x.com/pleometric/status/2050364782411202781
- https://x.com/pleometric/status/2050635695199301742
- https://x.com/pleometric/status/2050907411259490462
- https://x.com/pleometric/status/2053862530561323381
- https://x.com/pleometric/status/2055448012818661416
- https://x.com/pleometric/status/2055617894944219620
- https://x.com/pleometric/status/2055621213431468424
- https://x.com/pleometric/status/2057463884051628504
- https://x.com/pleometric/status/2060760924697333798
- https://x.com/pleometric/status/2064048851636392225
- https://x.com/pleometric/status/2064073939266027648
- https://x.com/pleometric/status/2066905354223456735
- https://x.com/pleometric/status/2067422704269967545
- https://x.com/pleometric/status/2067431750951690447
- https://x.com/pleometric/status/2067462788537057544
- https://x.com/pleometric/status/2067662803721220310
- https://x.com/pleometric/status/2067669513630343191
- https://x.com/pleometric/status/2067714664348229948
- https://x.com/pleometric/status/2067715247679402255
- https://x.com/pleometric/status/2068011369849372704
- https://x.com/pleometric/status/2068025479026593909
- https://x.com/pleometric/status/2068135602638193063
- https://x.com/pleometric/status/2069782589171261567
- https://x.com/pleometric/status/2069786696934211959
- https://x.com/pleometric/status/2069905257568555350
- https://x.com/pleometric/status/2069949695628075114
- https://x.com/pleometric/status/2070323077087412226
- https://x.com/pleometric/status/2070631349778579630
- https://x.com/pleometric/status/2071047326869664178
- https://x.com/pleometric/status/2071278369035944329
- https://x.com/pleometric/status/2071346891367792806
- https://x.com/pleometric/status/2071380864395596086
- https://x.com/pleometric/status/2073531925944254962
- https://x.com/pleometric/status/2073938546545529099

Existing `pleometric-longposts.md` entries reference 14 additional status IDs absent from the latest archive (the missing shadowing replies plus theory/self-curation posts). They are not recaptured; rerun after sync should resolve them if available:

- https://x.com/pleometric/status/2073921115504718305
- https://x.com/pleometric/status/2073932611936735549
- https://x.com/pleometric/status/2073934711596929033
- https://x.com/pleometric/status/2073938546545529099
- https://x.com/pleometric/status/2074091153633223039
- https://x.com/pleometric/status/2071296392065143225
- https://x.com/pleometric/status/2071296708592492633
- https://x.com/pleometric/status/2071296920178327591
- https://x.com/pleometric/status/2071289552430317959
- https://x.com/pleometric/status/2071290656790655424
- https://x.com/pleometric/status/2071291813780996315
- https://x.com/pleometric/status/2071253069409485027
- https://x.com/pleometric/status/2071274030615667139
- https://x.com/pleometric/status/2071294075781746772

## Exact rerun commands

```bash
python3 - <<'PY'
import sqlite3, json
con = sqlite3.connect('data/twitter-archive/twitter-archive.sqlite')
rows = con.execute("SELECT id, created_at, conversation_id, data_json FROM tweets WHERE lower(username)='pleometric' ORDER BY id").fetchall()
print('pleometric rows:', len(rows))
keywords = ('explain','breakdown','layer','reference','viral','virality','technique','workflow','render','comfy','process','signifier','craft','style','audience','platform','algorithm','remix','attention','short form','tiktok','video','content','ai','slop','media','edit','editing','script','youtube','brainrot','culture')
for tid, created, conversation, raw in rows:
    text = json.loads(raw).get('text', '')
    if len(text) > 600 or any(k in text.lower() for k in keywords):
        print(tid, created, len(text), conversation)
PY
```

```bash
python3 - <<'PY'
import json, sqlite3
m = json.load(open('data/inspiration/pleometric/manifest.json'))
con = sqlite3.connect('data/twitter-archive/twitter-archive.sqlite')
ids = {r[0] for r in con.execute('SELECT id FROM tweets')}
missing = sorted({str(i['tweetId']) for i in m['items']} - ids)
print('manifest items:', len(m['items']))
print('missing:', len(missing))
for tid in missing: print('https://x.com/pleometric/status/' + tid)
PY
```

```bash
sqlite3 data/twitter-archive/twitter-archive.sqlite "SELECT count(*) FROM tweets WHERE lower(username)='pleometric';"
```

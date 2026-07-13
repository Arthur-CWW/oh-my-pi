> Rescued 2026-07-13 from /Users/arthur/.omp/agent/sessions/-agents/2026-07-03T10-25-44-711Z_019f2783-4f07-7000-ac94-347ad8de223d/local/substrate-schemas.md

# Substrate schemas + samples (generated 2026-07-03T10:30Z)

## browser_context.sqlite (~/state/browser-context/browser_context.sqlite)

```sql
CREATE TABLE profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    browser TEXT NOT NULL,                    -- 'firefox' | 'chrome' | ...
    profile_path TEXT NOT NULL,               -- absolute path on disk
    name TEXT,                                -- profile display name if known
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_sync_at TEXT,
    UNIQUE(browser, profile_path)
);
CREATE INDEX idx_profiles_browser ON profiles(browser);
```

```sql
CREATE TABLE windows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    window_source_id TEXT NOT NULL,           -- browser internal window id
    window_type TEXT,                         -- 'normal' | 'popup' | ...
    width INTEGER,
    height INTEGER,
    screen_x INTEGER,
    screen_y INTEGER,
    selected_tab_index INTEGER,
    is_private INTEGER NOT NULL DEFAULT 0,
    closed_tab_count INTEGER,
    closed_window_count INTEGER,
    ext_data_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_windows_snapshot_id ON windows(snapshot_id);
```

```sql
CREATE TABLE tabs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    window_id INTEGER NOT NULL REFERENCES windows(id) ON DELETE CASCADE,
    tab_source_id TEXT,                       -- browser internal tab id when present
    tab_index INTEGER NOT NULL,
    url TEXT,
    title TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    last_accessed INTEGER,                    -- epoch milliseconds
    user_context_id TEXT,
    ext_data_json TEXT,
    tree_persistent_id TEXT,
    special_tab_states TEXT,
    closed_at INTEGER,                        -- epoch milliseconds when closed
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tabs_snapshot_id ON tabs(snapshot_id);
CREATE INDEX idx_tabs_window_id ON tabs(window_id);
CREATE INDEX idx_tabs_tree_persistent_id ON tabs(tree_persistent_id);
```

```sql
CREATE TABLE tab_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tab_id INTEGER NOT NULL REFERENCES tabs(id) ON DELETE CASCADE,
    entry_index INTEGER NOT NULL,
    url TEXT,
    title TEXT,
    doc_identifier TEXT,
    subframe INTEGER NOT NULL DEFAULT 0,
    last_accessed INTEGER,
    scroll_x INTEGER,
    scroll_y INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

```sql
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER REFERENCES snapshots(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,            -- tab_activated | window_focus_changed |
                                         -- tab_created | tab_updated | tab_moved |
                                         -- tab_removed | idle_state_changed | ...
    observed_at INTEGER,                 -- epoch milliseconds when known
    browser TEXT,
    profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
    window_source_id TEXT,
    tab_source_id TEXT,
    url TEXT,
    title TEXT,
    payload_json TEXT,                   -- original raw event blob
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_snapshot_id ON events(snapshot_id);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_observed_at ON events(observed_at);
```

### sample tab_entries
```
id|tab_id|url|title|last_accessed
1|1|about:home|New Tab|
2|1|https://www.youtube.com/|YouTube|
3|2|https://www.youtube.com/watch?v=73PX-qTJ8fA|The Sensitive Old Man Problem - YouTube|
```

### sample events
```
id|event_type|observed_at|browser|url|t
206260|tab_updated|1782872485122|firefox|https://knowyourmeme.com/memes/the-breakfast-question|The Breakfast Question | Know Your Meme
206265|tab_updated|1782872452671|firefox|https://x.com/deepfates/status/2072103514705424583|🎭 on X: "How do i short pi" / X
206004|tab_updated|1782872347712|firefox|https://x.com/andy_matuschak|Andy Matuschak (@andy_matuschak) / X
```

## twitter-archive.sqlite (data/twitter-archive/twitter-archive.sqlite)

```sql
CREATE TABLE tweets (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  username TEXT,
  url TEXT NOT NULL,
  created_at TEXT,
  captured_at TEXT NOT NULL,
  conversation_id TEXT,
  updated_at TEXT NOT NULL,
  data_json TEXT NOT NULL
, captured_metrics_json TEXT, lifecycle_status TEXT NOT NULL DEFAULT 'captured', thread_status TEXT NOT NULL DEFAULT 'unknown', quote_status TEXT NOT NULL DEFAULT 'unknown', quote_unavailable_reason TEXT, provenance_json TEXT, source_lane TEXT NOT NULL DEFAULT 'unknown', source_url TEXT, import_batch_id TEXT);
CREATE INDEX tweets_author_created_at_idx
  ON tweets (author_id, created_at DESC);
```

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT,
  captured_at TEXT,
  updated_at TEXT NOT NULL,
  data_json TEXT NOT NULL
, lifecycle_status TEXT NOT NULL DEFAULT 'captured', provenance_json TEXT, source_lane TEXT NOT NULL DEFAULT 'unknown', source_url TEXT, import_batch_id TEXT);
CREATE INDEX users_username_idx
  ON users (username);
```

### sample tweets
```
id|author_id|username|url|created_at|captured_at|conversation_id|updated_at|data_json|captured_metrics_json|lifecycle_status|thread_status|quote_status|quote_unavailable_reason|provenance_json|source_lane|source_url|import_batch_id
2056070933048172694|maverickecom|maverickecom|https://x.com/maverickecom/status/2056070933048172694|May 17, 2026 · 5:54 PM UTC|2026-06-18T05:40:59.120Z||2026-06-18T05:40:59.125Z|{"id":"2056070933048172694","authorId":"maverickecom","username":"maverickecom","url":"https://x.com/maverickecom/status/2056070933048172694","text":"this video is 100% AI\nthese authority figure UGC ads are insanely fast to make\nand even faster to scale!!\none script → dozens of variations\ncinematic lighting, perfect pacing, human emotions\nyou can scale your ecom brand with ugc\nno need to seed 1000+ expensive creators when 80% of them are make you $0\nrt + comment “AI” and i’ll send the guide\n(follow for dm)","createdAt":"May 17, 2026 · 5:54 PM UTC","mediaIds":["2056070933048172694-media-1"],"publicMetrics":{"replies":90,"reposts":48,"likes":113,"views":6588},"capturedAt":"2026-06-18T05:40:59.120Z","source":"frontend"}|{"replies":90,"reposts":48,"likes":113,"views":6588}|captured|unknown|unknown|||unknown||
```

## meltdown-annotations.sqlite (streams/primer/wrapped-commentary-reader/site/meltdown-annotations.sqlite)

```sql
CREATE TABLE works (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  container_title TEXT,
  first_presented TEXT,
  first_published TEXT,
  pdf_page_start INTEGER,
  pdf_page_end INTEGER,
  note TEXT
);
```

```sql
CREATE TABLE reading_units (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id),
  unit_key TEXT NOT NULL UNIQUE,
  pdf_page_start INTEGER NOT NULL,
  pdf_page_end INTEGER NOT NULL,
  title TEXT NOT NULL,
  anchor TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  short_summary TEXT NOT NULL
);
```

```sql
CREATE TABLE source_blocks (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id),
  block_key TEXT NOT NULL UNIQUE,
  reading_unit_key TEXT NOT NULL,
  pdf_page INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  block_type TEXT NOT NULL,
  text TEXT NOT NULL
);
```

```sql
CREATE TABLE annotations (
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id),
  pdf_page INTEGER NOT NULL,
  anchor TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  tags TEXT NOT NULL,
  note TEXT NOT NULL,
  refs TEXT,
  neoliberalism TEXT,
  created_at TEXT NOT NULL
, category TEXT, ontology TEXT, question TEXT, why_reference TEXT, reading_unit_key TEXT, front_claim TEXT);
```

```sql
CREATE TABLE concepts (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  lane TEXT NOT NULL,
  ontology TEXT NOT NULL,
  reader_question TEXT NOT NULL,
  short_note TEXT NOT NULL,
  long_note TEXT NOT NULL,
  key_terms TEXT,
  references_text TEXT
, front_claim TEXT);
```

```sql
CREATE TABLE flashcard_candidates (
  id INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES interaction_events(event_id) ON DELETE CASCADE,
  reading_unit_key TEXT,
  block_key TEXT,
  source_text TEXT NOT NULL,
  question TEXT,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### sample annotations
```
id|work_id|pdf_page|anchor|title|kind|tags|note|refs|neoliberalism|created_at|category|ontology|question|why_reference|reading_unit_key|front_claim
1|1|1|opening technocapital narrative|Technocapital Singularity|concept|capitalism,cybernetics,accelerationism|Renaissance navigation, rationalization, commoditization, logistics, markets, cybernetics, and AI form one accelerating feedback loop. Later machine intelligence intensifies the same long-modern runaway rather than starting a separate event.|Renaissance navigation; Marx; Deleuze and Guattari; cybernetics; singularity theory|Deregulation appears as one accelerant, but the passage is not ordinary policy neoliberalism. It is a metaphysical version: markets become a nonhuman intelligence system.|2026-06-29|glossary|capital / state / market|What does this term do for the argument?|The opening sets the scale: modernity is already technocapital acceleration learning to steer through humans.|u-07-opening|Modernity itself is the singularity's take-off.
```

### counts
```
annotations|54
source_blocks|68
concepts|8
flashcard_candidates|0
works|1
```

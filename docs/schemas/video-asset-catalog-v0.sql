-- Video Asset Catalog v0
-- SQLite schema for composable shortform-video assets, prompts, tags, vibe scores,
-- provenance, and workflow usage.
--
-- Intended runtime DB path:
--   data/asset-catalog/assets.sqlite

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS asset (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  stage_role TEXT NOT NULL DEFAULT '',
  compositing_role TEXT NOT NULL DEFAULT '',
  uri TEXT,
  local_path TEXT,
  mime_type TEXT,
  duration_sec REAL,
  width INTEGER,
  height INTEGER,
  fps REAL,
  has_alpha INTEGER NOT NULL DEFAULT 0 CHECK (has_alpha IN (0, 1)),
  loopable INTEGER NOT NULL DEFAULT 0 CHECK (loopable IN (0, 1)),
  sha256 TEXT,
  license TEXT NOT NULL DEFAULT 'local-experiment',
  safety_notes TEXT NOT NULL DEFAULT '',
  source_ref_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(source_ref_json)),
  technical_meta_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(technical_meta_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS asset_variant (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  variant_role TEXT NOT NULL,
  uri TEXT,
  local_path TEXT,
  mime_type TEXT,
  duration_sec REAL,
  width INTEGER,
  height INTEGER,
  fps REAL,
  has_alpha INTEGER NOT NULL DEFAULT 0 CHECK (has_alpha IN (0, 1)),
  sha256 TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(meta_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS generation (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  operation TEXT NOT NULL,
  workflow_recipe_id TEXT,
  workflow_run_id TEXT,
  status TEXT NOT NULL DEFAULT 'succeeded',
  started_at TEXT,
  finished_at TEXT,
  cost_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(cost_json)),
  parameters_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(parameters_json)),
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS prompt (
  id TEXT PRIMARY KEY,
  generation_id TEXT REFERENCES generation(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  text TEXT NOT NULL,
  translated_text TEXT,
  token_estimate INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS asset_generation (
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  generation_id TEXT NOT NULL REFERENCES generation(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'output',
  PRIMARY KEY (asset_id, generation_id, role)
);

CREATE TABLE IF NOT EXISTS tag (
  id TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'semantic',
  description TEXT NOT NULL DEFAULT '',
  UNIQUE (namespace, name)
);

CREATE TABLE IF NOT EXISTS asset_tag (
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  source TEXT NOT NULL DEFAULT 'human',
  PRIMARY KEY (asset_id, tag_id)
);

CREATE TABLE IF NOT EXISTS vibe_axis (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  low_label TEXT NOT NULL DEFAULT 'low',
  high_label TEXT NOT NULL DEFAULT 'high'
);

CREATE TABLE IF NOT EXISTS asset_vibe_score (
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  axis_id TEXT NOT NULL REFERENCES vibe_axis(id) ON DELETE CASCADE,
  score REAL NOT NULL CHECK (score >= 0.0 AND score <= 1.0),
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'human',
  PRIMARY KEY (asset_id, axis_id)
);

CREATE TABLE IF NOT EXISTS asset_relationship (
  from_asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  to_asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  PRIMARY KEY (from_asset_id, to_asset_id, relation)
);

CREATE TABLE IF NOT EXISTS provenance_ref (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  author_handle TEXT,
  content_id TEXT,
  captured_at TEXT,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS asset_usage (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  recipe_id TEXT,
  run_id TEXT,
  stage_id TEXT,
  purpose TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS annotation (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  annotator TEXT NOT NULL DEFAULT 'arthur',
  note TEXT NOT NULL,
  annotation_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(annotation_json)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_asset_kind ON asset(kind);
CREATE INDEX IF NOT EXISTS idx_asset_stage_role ON asset(stage_role);
CREATE INDEX IF NOT EXISTS idx_asset_sha256 ON asset(sha256);
CREATE INDEX IF NOT EXISTS idx_asset_variant_asset ON asset_variant(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_tag_tag ON asset_tag(tag_id);
CREATE INDEX IF NOT EXISTS idx_prompt_generation ON prompt(generation_id);
CREATE INDEX IF NOT EXISTS idx_generation_provider ON generation(provider, operation);
CREATE INDEX IF NOT EXISTS idx_usage_asset ON asset_usage(asset_id);

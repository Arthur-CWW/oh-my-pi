from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional

import aiosqlite

from .types import ParsedTweet


TWEET_COLUMNS = {
  "archive_state": "TEXT",
  "archive_updated_at": "TEXT",
  "archive_snapshot_path": "TEXT",
  "archive_source": "TEXT",
  "archive_error": "TEXT",
}


async def ensure_schema(db_path: Path) -> None:
  async with aiosqlite.connect(db_path) as db:
    await _ensure_tweet_columns(db)
    await _ensure_archives_table(db)
    await db.commit()


async def _ensure_tweet_columns(db: aiosqlite.Connection) -> None:
  cursor = await db.execute("PRAGMA table_info(tweets)")
  rows = await cursor.fetchall()
  existing = {row[1] for row in rows}

  for column, sql_type in TWEET_COLUMNS.items():
    if column not in existing:
      await db.execute(f"ALTER TABLE tweets ADD COLUMN {column} {sql_type}")


async def _ensure_archives_table(db: aiosqlite.Connection) -> None:
  await db.execute(
    """
    CREATE TABLE IF NOT EXISTS tweet_archives (
      tweet_id TEXT PRIMARY KEY,
      author_name TEXT,
      author_handle TEXT,
      tweet_text TEXT,
      html TEXT,
      source TEXT,
      snapshot_timestamp TEXT,
      captured_at TEXT,
      fetched_at TEXT,
      raw_json_path TEXT,
      state TEXT NOT NULL DEFAULT 'pending'
    )
    """
  )


async def upsert_archive(db_path: Path, tweet: ParsedTweet) -> None:
  async with aiosqlite.connect(db_path) as db:
    await _ensure_tweet_columns(db)
    await _ensure_archives_table(db)

    await db.execute(
      """
      INSERT INTO tweet_archives (
        tweet_id, author_name, author_handle, tweet_text, html, source,
        snapshot_timestamp, captured_at, fetched_at, raw_json_path, state
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tweet_id) DO UPDATE SET
        author_name=excluded.author_name,
        author_handle=excluded.author_handle,
        tweet_text=excluded.tweet_text,
        html=excluded.html,
        source=excluded.source,
        snapshot_timestamp=excluded.snapshot_timestamp,
        captured_at=excluded.captured_at,
        fetched_at=excluded.fetched_at,
        raw_json_path=excluded.raw_json_path,
        state=excluded.state
      """,
      (
        tweet.tweet_id,
        tweet.author_name,
        tweet.author_handle,
        tweet.text,
        tweet.html,
        tweet.source,
        tweet.snapshot_timestamp,
        tweet.captured_at.isoformat() if tweet.captured_at else None,
        tweet.fetched_at.isoformat(),
        tweet.raw_path,
        "applied",
      ),
    )

    await db.execute(
      """
      UPDATE tweets
      SET archive_state = ?,
          archive_updated_at = ?,
          archive_snapshot_path = ?,
          archive_source = ?,
          archive_error = NULL
      WHERE tweet_id = ?
      """,
      (
        "applied",
        datetime.utcnow().isoformat(),
        tweet.raw_path,
        tweet.source,
        tweet.tweet_id,
      ),
    )

    await db.commit()


async def mark_failure(db_path: Path, tweet_id: str, error: str) -> None:
  async with aiosqlite.connect(db_path) as db:
    await db.execute(
      """
      UPDATE tweets
      SET archive_state = ?, archive_updated_at = ?, archive_error = ?
      WHERE tweet_id = ?
      """,
      (
        "failed",
        datetime.utcnow().isoformat(),
        error[:500],
        tweet_id,
      ),
    )

    await db.execute(
      """
      INSERT INTO tweet_archives (tweet_id, state, fetched_at, raw_json_path)
      VALUES (?, 'failed', ?, NULL)
      ON CONFLICT(tweet_id) DO UPDATE SET state='failed', fetched_at=excluded.fetched_at
      """,
      (
        tweet_id,
        datetime.utcnow().isoformat(),
      ),
    )

    await db.commit()


async def fetch_tweet_ids_by_state(db_path: Path, states: Iterable[str]) -> List[str]:
  placeholders = ",".join("?" for _ in states)
  query = f"SELECT tweet_id FROM tweets WHERE archive_state IN ({placeholders})"

  async with aiosqlite.connect(db_path) as db:
    cursor = await db.execute(query, tuple(states))
    rows = await cursor.fetchall()

  return [row[0] for row in rows]


async def update_state(db_path: Path, tweet_id: str, state: str) -> None:
  async with aiosqlite.connect(db_path) as db:
    await db.execute(
      "UPDATE tweets SET archive_state = ?, archive_updated_at = ? WHERE tweet_id = ?",
      (state, datetime.utcnow().isoformat(), tweet_id),
    )

    await db.execute(
      """
      INSERT INTO tweet_archives (tweet_id, state, fetched_at)
      VALUES (?, ?, ?)
      ON CONFLICT(tweet_id) DO UPDATE SET state=excluded.state, fetched_at=excluded.fetched_at
      """,
      (tweet_id, state, datetime.utcnow().isoformat()),
    )

    await db.commit()


async def get_state(db_path: Path, tweet_id: str) -> Optional[str]:
  async with aiosqlite.connect(db_path) as db:
    cursor = await db.execute(
      "SELECT archive_state FROM tweets WHERE tweet_id = ?",
      (tweet_id,),
    )
    row = await cursor.fetchone()

    if row:
      return row[0]

    cursor = await db.execute(
      "SELECT state FROM tweet_archives WHERE tweet_id = ?",
      (tweet_id,),
    )
    row = await cursor.fetchone()
    if row:
      return row[0]

  return None


async def fetch_all_tweet_ids(db_path: Path) -> List[str]:
  async with aiosqlite.connect(db_path) as db:
    cursor = await db.execute("SELECT tweet_id FROM tweets ORDER BY created_at DESC")
    rows = await cursor.fetchall()

  return [row[0] for row in rows]

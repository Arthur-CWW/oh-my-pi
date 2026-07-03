#!/usr/bin/env python3
"""Import used-hardware research JSON bundles into a central SQLite database.

The importer is intentionally permissive: it preserves raw JSON while also
extracting normalized fields used by Facebook Marketplace, eBay, Gumtree, and
refurb-retailer research reports.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sqlite3
from pathlib import Path
from typing import Any

DEFAULT_DB = Path("~/projects/automations/buying-research/hardware-research.sqlite").expanduser()


def now_iso() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat()


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def as_json(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def scalar(value: Any) -> str | int | float | None:
    if value is None or isinstance(value, (str, int, float)):
        return value
    return as_json(value)


def listing_key(run_id: str, item: dict[str, Any], index: int) -> str:
    url = item.get("listing_url") or item.get("url") or item.get("canonical_url")
    if url:
        return str(url).strip()
    item_id = item.get("id") or item.get("item_id") or item.get("dedupe_key") or index
    source = item.get("source") or item.get("marketplace") or "unknown"
    return f"{source}:{run_id}:{item_id}"


def seller_key(run_id: str, seller: dict[str, Any], index: int) -> str:
    url = seller.get("seller_profile_url") or seller.get("profile_url")
    if url:
        return str(url).strip()
    name = seller.get("seller_name") or seller.get("name")
    if name:
        return f"seller:{name}"
    return f"seller:{run_id}:{index}"


def setup_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS research_runs (
            run_id TEXT PRIMARY KEY,
            run_dir TEXT,
            topic TEXT,
            marketplace TEXT,
            created_at TEXT,
            imported_at TEXT NOT NULL,
            notes TEXT,
            raw_scrape_run_json TEXT
        );

        CREATE TABLE IF NOT EXISTS sellers (
            seller_key TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            seller_name TEXT,
            seller_profile_url TEXT,
            review_count INTEGER,
            star_rating TEXT,
            joined_year INTEGER,
            reputation_badges_json TEXT,
            profile_notes TEXT,
            listing_ids_json TEXT,
            raw_json TEXT,
            imported_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES research_runs(run_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS listings (
            listing_key TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            source TEXT,
            marketplace TEXT,
            listing_url TEXT,
            title TEXT,
            price_raw TEXT,
            price_aud REAL,
            listed_line TEXT,
            location TEXT,
            distance TEXT,
            type TEXT,
            model_line TEXT,
            chip TEXT,
            ram TEXT,
            ram_gb INTEGER,
            ssd TEXT,
            year TEXT,
            condition TEXT,
            included_accessories TEXT,
            seller_name TEXT,
            seller_profile_url TEXT,
            seller_profile_notes TEXT,
            seller_review_count INTEGER,
            seller_star_rating TEXT,
            seller_joined_year INTEGER,
            seller_reputation_badges_json TEXT,
            seller_description TEXT,
            priority TEXT,
            scam_off_notes_json TEXT,
            price_sanity TEXT,
            buy_notes TEXT,
            follow_up_questions_json TEXT,
            raw_json TEXT,
            imported_at TEXT NOT NULL,
            FOREIGN KEY(run_id) REFERENCES research_runs(run_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_listings_run ON listings(run_id);
        CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price_aud);
        CREATE INDEX IF NOT EXISTS idx_listings_ram ON listings(ram_gb);
        CREATE INDEX IF NOT EXISTS idx_listings_model ON listings(model_line, chip);
        CREATE INDEX IF NOT EXISTS idx_listings_priority ON listings(priority);

        CREATE TABLE IF NOT EXISTS listing_images (
            listing_key TEXT NOT NULL,
            image_index INTEGER NOT NULL,
            image_url TEXT,
            local_path TEXT,
            raw_json TEXT,
            PRIMARY KEY(listing_key, image_index),
            FOREIGN KEY(listing_key) REFERENCES listings(listing_key) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS raw_records (
            run_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            record_index INTEGER NOT NULL,
            record_id TEXT,
            raw_json TEXT NOT NULL,
            PRIMARY KEY(run_id, kind, record_index),
            FOREIGN KEY(run_id) REFERENCES research_runs(run_id) ON DELETE CASCADE
        );

        CREATE VIEW IF NOT EXISTS listing_summary AS
        SELECT
            priority,
            marketplace,
            source,
            model_line,
            chip,
            ram_gb,
            ssd,
            price_aud,
            location,
            title,
            price_sanity,
            listing_url
        FROM listings
        ORDER BY
            CASE priority
                WHEN 'A' THEN 1
                WHEN 'A/B' THEN 2
                WHEN 'B' THEN 3
                WHEN 'B/C' THEN 4
                WHEN 'C' THEN 5
                WHEN 'C/X' THEN 6
                WHEN 'X' THEN 7
                ELSE 9
            END,
            COALESCE(ram_gb, 0) DESC,
            COALESCE(price_aud, 999999999) ASC;
        """
    )


def insert_run(conn: sqlite3.Connection, args: argparse.Namespace, scrape_run: Any) -> None:
    conn.execute(
        """
        INSERT INTO research_runs(run_id, run_dir, topic, marketplace, created_at, imported_at, notes, raw_scrape_run_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
            run_dir=excluded.run_dir,
            topic=excluded.topic,
            marketplace=excluded.marketplace,
            imported_at=excluded.imported_at,
            notes=excluded.notes,
            raw_scrape_run_json=excluded.raw_scrape_run_json
        """,
        (
            args.run_id,
            str(args.run_dir),
            args.topic,
            args.marketplace,
            scrape_run.get("created_at") if isinstance(scrape_run, dict) else None,
            now_iso(),
            args.notes,
            as_json(scrape_run),
        ),
    )


def insert_sellers(conn: sqlite3.Connection, run_id: str, sellers: list[dict[str, Any]]) -> int:
    count = 0
    for i, seller in enumerate(sellers):
        key = seller_key(run_id, seller, i)
        conn.execute(
            """
            INSERT INTO sellers(
                seller_key, run_id, seller_name, seller_profile_url, review_count, star_rating,
                joined_year, reputation_badges_json, profile_notes, listing_ids_json, raw_json, imported_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(seller_key) DO UPDATE SET
                run_id=excluded.run_id,
                seller_name=excluded.seller_name,
                seller_profile_url=excluded.seller_profile_url,
                review_count=excluded.review_count,
                star_rating=excluded.star_rating,
                joined_year=excluded.joined_year,
                reputation_badges_json=excluded.reputation_badges_json,
                profile_notes=excluded.profile_notes,
                listing_ids_json=excluded.listing_ids_json,
                raw_json=excluded.raw_json,
                imported_at=excluded.imported_at
            """,
            (
                key,
                run_id,
                seller.get("seller_name") or seller.get("name"),
                seller.get("seller_profile_url") or seller.get("profile_url"),
                seller.get("review_count"),
                scalar(seller.get("star_rating")),
                seller.get("joined_year"),
                as_json(seller.get("reputation_badges")),
                seller.get("profile_notes"),
                as_json(seller.get("listing_ids")),
                as_json(seller),
                now_iso(),
            ),
        )
        count += 1
    return count


def insert_listings(conn: sqlite3.Connection, run_id: str, marketplace: str, items: list[dict[str, Any]]) -> int:
    count = 0
    for i, item in enumerate(items):
        key = listing_key(run_id, item, i)
        conn.execute(
            """
            INSERT INTO listings(
                listing_key, run_id, source, marketplace, listing_url, title, price_raw, price_aud,
                listed_line, location, distance, type, model_line, chip, ram, ram_gb, ssd, year,
                condition, included_accessories, seller_name, seller_profile_url, seller_profile_notes,
                seller_review_count, seller_star_rating, seller_joined_year, seller_reputation_badges_json,
                seller_description, priority, scam_off_notes_json, price_sanity, buy_notes,
                follow_up_questions_json, raw_json, imported_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(listing_key) DO UPDATE SET
                run_id=excluded.run_id,
                source=excluded.source,
                marketplace=excluded.marketplace,
                listing_url=excluded.listing_url,
                title=excluded.title,
                price_raw=excluded.price_raw,
                price_aud=excluded.price_aud,
                listed_line=excluded.listed_line,
                location=excluded.location,
                distance=excluded.distance,
                type=excluded.type,
                model_line=excluded.model_line,
                chip=excluded.chip,
                ram=excluded.ram,
                ram_gb=excluded.ram_gb,
                ssd=excluded.ssd,
                year=excluded.year,
                condition=excluded.condition,
                included_accessories=excluded.included_accessories,
                seller_name=excluded.seller_name,
                seller_profile_url=excluded.seller_profile_url,
                seller_profile_notes=excluded.seller_profile_notes,
                seller_review_count=excluded.seller_review_count,
                seller_star_rating=excluded.seller_star_rating,
                seller_joined_year=excluded.seller_joined_year,
                seller_reputation_badges_json=excluded.seller_reputation_badges_json,
                seller_description=excluded.seller_description,
                priority=excluded.priority,
                scam_off_notes_json=excluded.scam_off_notes_json,
                price_sanity=excluded.price_sanity,
                buy_notes=excluded.buy_notes,
                follow_up_questions_json=excluded.follow_up_questions_json,
                raw_json=excluded.raw_json,
                imported_at=excluded.imported_at
            """,
            (
                key,
                run_id,
                item.get("source"),
                item.get("marketplace") or marketplace,
                item.get("listing_url") or item.get("url") or item.get("canonical_url"),
                item.get("title") or item.get("card_title"),
                item.get("price_raw") or item.get("card_price_raw"),
                item.get("price_aud"),
                item.get("listed_line"),
                item.get("location") or item.get("card_location"),
                item.get("distance"),
                item.get("type"),
                item.get("model_line"),
                item.get("chip"),
                item.get("ram"),
                item.get("ram_gb"),
                item.get("ssd"),
                scalar(item.get("year")),
                item.get("condition"),
                scalar(item.get("included_accessories")),
                item.get("seller_name"),
                item.get("seller_profile_url"),
                item.get("seller_profile_notes"),
                item.get("seller_review_count"),
                scalar(item.get("seller_star_rating")),
                item.get("seller_joined_year"),
                as_json(item.get("seller_reputation_badges")),
                item.get("seller_description"),
                item.get("priority"),
                as_json(item.get("scam_off_notes")),
                item.get("price_sanity"),
                item.get("buy_notes"),
                as_json(item.get("follow_up_questions")),
                as_json(item),
                now_iso(),
            ),
        )
        images = item.get("images") or []
        if isinstance(images, list):
            for image_index, image in enumerate(images):
                if isinstance(image, dict):
                    image_url = image.get("url") or image.get("image_url")
                    local_path = image.get("local_path") or image.get("path")
                    raw = image
                else:
                    image_url = str(image)
                    local_path = None
                    raw = image
                conn.execute(
                    """
                    INSERT INTO listing_images(listing_key, image_index, image_url, local_path, raw_json)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(listing_key, image_index) DO UPDATE SET
                        image_url=excluded.image_url,
                        local_path=excluded.local_path,
                        raw_json=excluded.raw_json
                    """,
                    (key, image_index, image_url, local_path, as_json(raw)),
                )
        count += 1
    return count


def insert_raw(conn: sqlite3.Connection, run_id: str, kind: str, records: Any) -> int:
    if records is None:
        return 0
    if isinstance(records, dict):
        iterable = list(records.items())
    elif isinstance(records, list):
        iterable = list(enumerate(records))
    else:
        iterable = [(0, records)]
    count = 0
    for idx, record in iterable:
        if isinstance(idx, str):
            record_index = count
            record_id = idx
        else:
            record_index = int(idx)
            record_id = record.get("id") if isinstance(record, dict) else None
        conn.execute(
            """
            INSERT INTO raw_records(run_id, kind, record_index, record_id, raw_json)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(run_id, kind, record_index) DO UPDATE SET
                record_id=excluded.record_id,
                raw_json=excluded.raw_json
            """,
            (run_id, kind, record_index, record_id, as_json(record)),
        )
        count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, required=True, help="Research run folder containing items.json etc.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help=f"SQLite DB path (default: {DEFAULT_DB})")
    parser.add_argument("--run-id", help="Stable run id (default: run directory name)")
    parser.add_argument("--marketplace", default="facebook-marketplace", help="Marketplace/source label")
    parser.add_argument("--topic", default="used hardware buying research", help="Research topic")
    parser.add_argument("--notes", default=None, help="Optional notes")
    args = parser.parse_args()

    args.run_dir = args.run_dir.expanduser().resolve()
    args.db = args.db.expanduser().resolve()
    args.run_id = args.run_id or args.run_dir.name

    items = load_json(args.run_dir / "items.json", [])
    sellers = load_json(args.run_dir / "sellers.json", [])
    scrape_run = load_json(args.run_dir / "scrape_run.json", {})
    raw_files = {
        "raw_search_hits": load_json(args.run_dir / "raw_search_hits.json", []),
        "raw_detail_records": load_json(args.run_dir / "raw_detail_records.json", []),
        "images_manifest": load_json(args.run_dir / "images_manifest.json", []),
    }

    args.db.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(args.db) as conn:
        setup_db(conn)
        insert_run(conn, args, scrape_run)
        seller_count = insert_sellers(conn, args.run_id, sellers if isinstance(sellers, list) else [])
        listing_count = insert_listings(conn, args.run_id, args.marketplace, items if isinstance(items, list) else [])
        raw_count = 0
        for kind, records in raw_files.items():
            raw_count += insert_raw(conn, args.run_id, kind, records)
        conn.commit()

    print(json.dumps({
        "db": str(args.db),
        "run_id": args.run_id,
        "listings": listing_count,
        "sellers": seller_count,
        "raw_records": raw_count,
    }, indent=2))


if __name__ == "__main__":
    main()

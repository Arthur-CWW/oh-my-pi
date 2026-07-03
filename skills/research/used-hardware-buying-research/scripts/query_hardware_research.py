#!/usr/bin/env python3
"""Query the central hardware buying research SQLite database."""

from __future__ import annotations

import argparse
import csv
import sqlite3
import sys
from pathlib import Path

DEFAULT_DB = Path("~/projects/automations/buying-research/hardware-research.sqlite").expanduser()

DEFAULT_SQL = """
SELECT priority, marketplace, source, model_line, chip, ram_gb, ssd, price_aud, location, title, listing_url
FROM listing_summary
LIMIT 50;
""".strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--sql", default=DEFAULT_SQL)
    parser.add_argument("--csv", action="store_true", help="Output CSV instead of a simple table")
    args = parser.parse_args()

    with sqlite3.connect(args.db.expanduser()) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(args.sql).fetchall()

    if args.csv:
        writer = csv.writer(sys.stdout)
        if rows:
            writer.writerow(rows[0].keys())
        for row in rows:
            writer.writerow([row[k] for k in row.keys()])
        return

    if not rows:
        print("No rows")
        return
    headers = list(rows[0].keys())
    values = [["" if row[h] is None else str(row[h]) for h in headers] for row in rows]
    widths = [min(60, max(len(h), *(len(v[i]) for v in values))) for i, h in enumerate(headers)]
    print(" | ".join(h[:widths[i]].ljust(widths[i]) for i, h in enumerate(headers)))
    print("-+-".join("-" * w for w in widths))
    for vals in values:
        print(" | ".join(vals[i][:widths[i]].ljust(widths[i]) for i in range(len(headers))))


if __name__ == "__main__":
    main()

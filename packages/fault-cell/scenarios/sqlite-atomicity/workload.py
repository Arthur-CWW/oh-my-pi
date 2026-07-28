#!/usr/bin/env python3
"""Tiny SQLite ledger writer and verifier.

Deliberately not an OMP program and unaware of the harness beyond two contracts: it emits
named barriers through the fault-cell barrier socket, and it records what happened in a status
database on a filesystem the scenario never fills. Everything the invariants assert is read
back out of those two databases as typed rows.

Atomicity property under test: for every batch recorded in `batches`, exactly `batches.rows`
rows exist in `ledger` for that batch, and no `ledger` row belongs to an unrecorded batch.
A SIGKILL mid-transaction or an ENOSPC mid-commit must not break that.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sqlite3
import sys
import time

SQLITE_FULL = 13


def barrier(name: str, detail: dict[str, object] | None = None) -> None:
    path = os.environ.get("FAULTCELL_BARRIER_SOCKET")
    if not path:
        return
    payload = json.dumps({"name": name, "detail": detail or {}}).encode("utf-8")
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    try:
        sock.sendto(payload, path)
    finally:
        sock.close()


def open_status(path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(path) or "/", exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS status("
        "id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "incarnation INTEGER NOT NULL,"
        "phase TEXT NOT NULL,"
        "sqlite_errno INTEGER NOT NULL,"
        "sqlite_message TEXT NOT NULL,"
        "batches_committed INTEGER NOT NULL,"
        "exit_code INTEGER NOT NULL)"
    )
    return conn


def record(
    status: sqlite3.Connection,
    phase: str,
    errno: int = 0,
    message: str = "",
    committed: int = 0,
    exit_code: int = 0,
) -> None:
    status.execute(
        "INSERT INTO status(incarnation, phase, sqlite_errno, sqlite_message,"
        " batches_committed, exit_code) VALUES(?,?,?,?,?,?)",
        (
            int(os.environ.get("FAULTCELL_INCARNATION", "0")),
            phase,
            errno,
            message,
            committed,
            exit_code,
        ),
    )


def write(args: argparse.Namespace) -> int:
    status = open_status(args.status)
    conn = sqlite3.connect(args.db, isolation_level=None, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=FULL")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ledger("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, batch INTEGER NOT NULL, payload TEXT NOT NULL)"
    )
    conn.execute("CREATE TABLE IF NOT EXISTS batches(batch INTEGER PRIMARY KEY, rows INTEGER NOT NULL)")
    conn.execute("CREATE INDEX IF NOT EXISTS ledger_batch ON ledger(batch)")

    resume_from = int(conn.execute("SELECT count(*) FROM batches").fetchone()[0])
    payload = "x" * args.payload_bytes
    barrier("writer:started", {"resumeFromBatch": resume_from})

    committed = resume_from
    announced_resume = resume_from == 0
    produced = 0
    while args.batches == 0 or produced < args.batches:
        batch = committed + 1
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.executemany(
                "INSERT INTO ledger(batch, payload) VALUES(?,?)",
                [(batch, payload) for _ in range(args.rows)],
            )
            conn.execute("INSERT INTO batches(batch, rows) VALUES(?,?)", (batch, args.rows))
            conn.execute("COMMIT")
        except sqlite3.Error as error:
            code = int(getattr(error, "sqlite_errorcode", 0) or 0)
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            done = int(conn.execute("SELECT count(*) FROM batches").fetchone()[0])
            exit_code = 28 if code == SQLITE_FULL else 1
            record(
                status,
                "write-failed",
                errno=code,
                message=str(error)[:512],
                committed=done,
                exit_code=exit_code,
            )
            barrier(
                "writer:enospc" if code == SQLITE_FULL else "writer:error",
                {"sqliteErrno": code, "committed": done},
            )
            status.close()
            conn.close()
            return exit_code
        committed = batch
        produced += 1
        if not announced_resume:
            announced_resume = True
            # Fires exactly once per resumed incarnation, which is what makes the recovery
            # step deterministic instead of a sleep.
            barrier("writer:resumed", {"batch": batch, "resumeFromBatch": resume_from})
        if args.steady_every > 0 and produced % args.steady_every == 0:
            barrier("writer:steady", {"batch": batch})
        if args.commit_delay_ms > 0:
            time.sleep(args.commit_delay_ms / 1000.0)

    record(status, "write-complete", committed=committed, exit_code=0)
    barrier("writer:complete", {"batches": committed})
    status.close()
    conn.close()
    return 0


def verify(args: argparse.Namespace) -> int:
    status = open_status(args.status)
    conn = sqlite3.connect(args.db, timeout=30)
    torn = int(
        conn.execute(
            "SELECT count(*) FROM batches b WHERE b.rows <> ("
            " SELECT count(*) FROM ledger l WHERE l.batch = b.batch)"
        ).fetchone()[0]
    )
    orphans = int(
        conn.execute(
            "SELECT count(*) FROM ledger WHERE batch NOT IN (SELECT batch FROM batches)"
        ).fetchone()[0]
    )
    integrity = str(conn.execute("PRAGMA integrity_check").fetchone()[0])
    committed = int(conn.execute("SELECT count(*) FROM batches").fetchone()[0])
    ok = torn == 0 and orphans == 0 and integrity == "ok"
    record(
        status,
        "verify",
        message=f"torn={torn} orphans={orphans} integrity={integrity}",
        committed=committed,
        exit_code=0 if ok else 1,
    )
    barrier("reader:verified", {"torn": torn, "orphans": orphans, "integrity": integrity})
    status.close()
    conn.close()
    return 0 if ok else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)

    writer = sub.add_parser("write")
    writer.add_argument("--db", required=True)
    writer.add_argument("--status", required=True)
    writer.add_argument("--batches", type=int, default=0, help="0 means run until stopped")
    writer.add_argument("--rows", type=int, default=32)
    writer.add_argument("--payload-bytes", type=int, default=512)
    writer.add_argument("--steady-every", type=int, default=5)
    writer.add_argument("--commit-delay-ms", type=int, default=20)
    writer.set_defaults(handler=write)

    reader = sub.add_parser("verify")
    reader.add_argument("--db", required=True)
    reader.add_argument("--status", required=True)
    reader.set_defaults(handler=verify)

    args = parser.parse_args()
    return int(args.handler(args))


if __name__ == "__main__":
    sys.exit(main())

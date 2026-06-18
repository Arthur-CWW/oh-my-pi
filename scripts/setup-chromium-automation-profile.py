#!/usr/bin/env python3
"""Safely clone the default Chrome user-data-dir for automation browsers.

The script refuses to copy while the default Chrome profile is in use, copies into a
staging directory first, then atomically renames the clone into place. Existing
clones are preserved unless --replace is passed, in which case they are moved to a
timestamped backup before the new clone is installed.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Any

CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DEFAULT_SOURCE = Path.home() / "Library/Application Support/Google/Chrome"
DEFAULT_CHROME_TARGET = Path.home() / ".pi/pi-web-access/chrome-automation-profile"
DEFAULT_HELIUM_TARGET = Path.home() / ".pi/pi-web-access/helium-from-chrome-automation-profile"

EXCLUDES = (
    "SingletonLock",
    "SingletonSocket",
    "SingletonCookie",
    "CrashpadMetrics-active.pma",
    "BrowserMetrics-spare.pma",
    "BrowserMetrics/*",
    "Crashpad/pending/*",
    "Crashpad/completed/*",
)


def process_rows() -> list[tuple[int, str]]:
    output = subprocess.check_output(["ps", "-axo", "pid=,args="], text=True)
    rows: list[tuple[int, str]] = []
    for line in output.splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2:
            rows.append((int(parts[0]), parts[1]))
    return rows


def default_chrome_users(source: Path) -> list[tuple[int, str]]:
    source_text = str(source)
    users: list[tuple[int, str]] = []
    for pid, args in process_rows():
        if CHROME_EXECUTABLE not in args or "--type=" in args:
            continue
        if "--user-data-dir=" not in args or source_text in args:
            users.append((pid, args))
    return users


def stale_singletons(source: Path) -> dict[str, str]:
    found: dict[str, str] = {}
    for name in ("SingletonLock", "SingletonSocket", "SingletonCookie"):
        path = source / name
        if not path.exists() and not path.is_symlink():
            continue
        try:
            found[name] = os.readlink(path) if path.is_symlink() else "present"
        except OSError as error:
            found[name] = f"unreadable: {error}"
    return found


def ensure_safe_source(source: Path, force_live_copy: bool) -> None:
    if not source.exists():
        raise SystemExit(f"source profile does not exist: {source}")
    users = default_chrome_users(source)
    if users and not force_live_copy:
        rendered = "\n".join(f"  {pid} {args[:240]}" for pid, args in users)
        raise SystemExit(
            "refusing to copy while the default Chrome profile is in use. "
            "Quit Chrome and retry, or pass --force-live-copy for an intentionally inconsistent clone.\n"
            f"Running users:\n{rendered}"
        )


def replace_with_backup(target: Path) -> Path | None:
    if not target.exists():
        return None
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = target.with_name(f"{target.name}.backup-{stamp}")
    target.rename(backup)
    return backup


def rsync_clone(source: Path, target: Path, replace: bool) -> dict[str, Any]:
    target_parent = target.parent
    target_parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and not replace:
        raise SystemExit(f"target exists; pass --replace to rotate it aside: {target}")

    temp = target_parent / f".{target.name}.tmp-{os.getpid()}"
    if temp.exists():
        shutil.rmtree(temp)
    temp.mkdir(parents=True)

    command = ["/usr/bin/rsync", "-a", "--delete"]
    for pattern in EXCLUDES:
        command.extend(["--exclude", pattern])
    command.extend([f"{source}/", f"{temp}/"])

    started = time.time()
    subprocess.run(command, check=True)
    backup = replace_with_backup(target) if target.exists() else None
    temp.rename(target)
    metadata = {
        "source": str(source),
        "target": str(target),
        "backup": str(backup) if backup else None,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "duration_seconds": round(time.time() - started, 3),
        "excluded": EXCLUDES,
    }
    (target / "automation-clone-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    return metadata


def parse_targets(raw: str) -> list[str]:
    targets = [item.strip() for item in raw.split(",") if item.strip()]
    allowed = {"chrome", "helium"}
    bad = [item for item in targets if item not in allowed]
    if bad:
        raise SystemExit(f"unsupported target(s): {', '.join(bad)}")
    if not targets:
        raise SystemExit("no targets selected")
    return targets


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--chrome-target", type=Path, default=DEFAULT_CHROME_TARGET)
    parser.add_argument("--helium-target", type=Path, default=DEFAULT_HELIUM_TARGET)
    parser.add_argument("--targets", default="chrome,helium", help="comma-separated: chrome,helium")
    parser.add_argument("--replace", action="store_true", help="rotate existing clones aside before installing new clones")
    parser.add_argument("--force-live-copy", action="store_true", help="allow an intentionally inconsistent copy while Chrome is running")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    targets = parse_targets(args.targets)
    ensure_safe_source(args.source, args.force_live_copy)
    plan = {
        "source": str(args.source),
        "targets": {
            "chrome": str(args.chrome_target),
            "helium": str(args.helium_target),
        },
        "selected_targets": targets,
        "source_singletons": stale_singletons(args.source),
        "replace": args.replace,
        "dry_run": args.dry_run,
    }
    if args.dry_run:
        print(json.dumps(plan, indent=2))
        return 0

    results: list[dict[str, Any]] = []
    for target_name in targets:
        target = args.chrome_target if target_name == "chrome" else args.helium_target
        result = rsync_clone(args.source, target, args.replace)
        result["browser_target"] = target_name
        results.append(result)

    print(json.dumps({"plan": plan, "results": results}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional, Set, Tuple

import aiohttp
import typer
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn, TimeElapsedColumn

from .db import (
    ensure_schema,
    fetch_all_tweet_ids,
    fetch_tweet_ids_by_state,
    get_state,
    mark_failure,
    update_state,
    upsert_archive,
)
from .fetch import EmbedFetcher
from .parser import parse_embed


app = typer.Typer(no_args_is_help=True)
console = Console()


def _read_ids_file(path: Path) -> Set[str]:
    ids: Set[str] = set()
    for line in path.read_text().splitlines():
        value = line.strip()
        if value:
            ids.add(value)
    return ids


async def _write_json(path: Path, data: dict) -> None:
    def _dump() -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)

    await asyncio.to_thread(_dump)


async def _process_tweet(
    tweet_id: str,
    fetcher: EmbedFetcher,
    db_path: Path,
    raw_dir: Path,
    force: bool,
) -> Tuple[str, str]:
    state = await get_state(db_path, tweet_id)
    if state == "applied" and not force:
        return tweet_id, "skipped"

    await update_state(db_path, tweet_id, "fetching")

    try:
        result = await fetcher.fetch(tweet_id)
    except Exception as exc:  # noqa: BLE001
        await mark_failure(db_path, tweet_id, str(exc))
        raise RuntimeError(f"{tweet_id}: {exc}") from exc

    timestamp = result.payload.snapshot_timestamp or datetime.utcnow().strftime(
        "%Y%m%d%H%M%S"
    )
    raw_path = raw_dir / f"{tweet_id}_{result.payload.source}_{timestamp}.json"
    await _write_json(raw_path, result.raw_json)

    parsed = parse_embed(
        result.payload,
        raw_path=str(raw_path),
        fetched_at=datetime.utcnow(),
    )

    await upsert_archive(db_path, parsed)

    return tweet_id, result.payload.source

async def _run_async(
    tweet_ids: Iterable[str],
    db_path: Path,
    out_dir: Path,
    concurrency: int,
    force: bool,
    log_every: int,
    limit: Optional[int] = None,
) -> None:
    ids = list(dict.fromkeys(tweet_ids))
    if not ids:
        console.print("[yellow]No tweets require hydration.[/yellow]")
        return

    raw_dir = out_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    timeout = aiohttp.ClientTimeout(total=45)
    semaphore = asyncio.Semaphore(concurrency)
    connector = aiohttp.TCPConnector(limit=max(concurrency * 4, 8), ttl_dns_cache=300)

    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        fetcher = EmbedFetcher(session, semaphore=semaphore)

        tasks: List[asyncio.Task[Tuple[str, str]]] = []
        successes: List[Tuple[str, str]] = []
        for index, tweet_id in enumerate(ids):
            if limit is not None and index >= limit:
                break
            task = asyncio.create_task(
                _process_tweet(tweet_id, fetcher, db_path, raw_dir, force)
            )
            tasks.append(task)

        with Progress(
            SpinnerColumn(),
            TextColumn("{task.description}"),
            TextColumn("{task.completed}/{task.total}"),
            TimeElapsedColumn(),
            console=console,
        ) as progress:
            task_id = progress.add_task("Hydrating tweets", total=len(tasks))
            completed = 0

        for future in asyncio.as_completed(tasks):
            try:
                tweet_id, source = await future
                if source and source != "skipped":
                    successes.append((tweet_id, source))
            except Exception as exc:  # noqa: BLE001
                console.print(f"[red]Failed to hydrate tweet: {exc!r}[/red]")
            finally:
                progress.advance(task_id)
                completed += 1
                if log_every > 0 and completed % log_every == 0:
                    console.log(f"Hydrated {completed} tweets")

        if successes and ((limit is not None and limit <= 10) or (limit is None and len(ids) <= 10)):
            console.print("[green]Successful hydrations:[/green]")
            for tweet_id, source in successes:
                console.print(f"  • {tweet_id} ({source})")


@app.command()
def run(
    tweet_id: Optional[list[str]] = typer.Option(
        None, help="Tweet IDs to hydrate", show_default=False
    ),
    ids_file: Optional[Path] = typer.Option(
        None, help="Path to a file containing tweet ids"
    ),
    from_state: Optional[str] = typer.Option(
        None,
        help="Hydrate all tweets whose archive_state matches this value",
        show_default=False,
    ),
    db_path: Path = typer.Option(
        Path("tweets.db"), help="Path to the tweets SQLite database"
    ),
    out_dir: Path = typer.Option(
        Path("data/wayback"), help="Directory for storing raw payloads"
    ),
    concurrency: int = typer.Option(4, min=1, max=16, help="Concurrent fetches"),
    force: bool = typer.Option(False, help="Re-fetch tweets even if already applied"),
    log_every: int = typer.Option(
        5, min=0, help="Emit a progress log every N tweets (0 to disable)"
    ),
    limit: Optional[int] = typer.Option(
        None,
        min=1,
        help="Hydrate at most N tweets after filters are applied",
        show_default=False,
    ),
) -> None:
    ids: Set[str] = set(tweet_id or [])

    if ids_file:
        ids.update(_read_ids_file(ids_file))

    # ensure schema is present before querying state or hydrating
    asyncio.run(ensure_schema(db_path))

    effective_force = force

    if from_state:
        fetched = asyncio.run(fetch_tweet_ids_by_state(db_path, [from_state]))
        ids.update(fetched)
    elif not ids:
        default_states = ("pending", "fetching", "failed")
        fetched = asyncio.run(fetch_tweet_ids_by_state(db_path, default_states))
        ids.update(fetched)

        if not ids:
            console.print(
                "[yellow]No pending tweets found; hydrating entire archive.[/yellow]"
            )
            all_ids = asyncio.run(fetch_all_tweet_ids(db_path))
            ids.update(all_ids)
            if not force:
                effective_force = True

    if not ids:
        console.print("[green]All tweets are already hydrated. Nothing to do.[/green]")
        raise typer.Exit(code=0)

    try:
        asyncio.run(
            _run_async(
                ids, db_path, out_dir, concurrency, effective_force, log_every, limit
            )
        )
    except Exception as exc:  # noqa: BLE001
        raise typer.Exit(code=1) from exc

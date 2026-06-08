from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, Optional

import aiohttp

from .types import EmbedPayload


PUBLISH_URL = "https://publish.twitter.com/oembed"
CDX_URL = "https://web.archive.org/cdx/search/cdx"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)


@dataclass(slots=True)
class FetchResult:
    payload: EmbedPayload
    raw_json: dict


class EmbedFetcher:
    def __init__(
        self,
        session: aiohttp.ClientSession,
        *,
        semaphore: Optional[asyncio.Semaphore] = None,
        retries: int = 3,
    ) -> None:
        self.session = session
        self.semaphore = semaphore or asyncio.Semaphore(5)
        self.retries = retries

    async def fetch(self, tweet_id: str) -> FetchResult:
        async with self.semaphore:
            live = await self._fetch_live(tweet_id)
            if live:
                return live

            archived = await self._fetch_wayback(tweet_id)
            if archived:
                return archived

        raise RuntimeError(f"No embed data found for {tweet_id}")

    async def _fetch_live(self, tweet_id: str) -> Optional[FetchResult]:
        params = {"url": f"https://twitter.com/i/status/{tweet_id}"}
        try:
            data = await self._request_json(PUBLISH_URL, params=params)
        except RuntimeError as exc:
            message = str(exc)
            if "403" in message or "401" in message:
                return None
            raise

        if not data or "error" in data:
            return None

        payload = EmbedPayload(
            tweet_id=tweet_id,
            source="live",
            html=data.get("html", ""),
            author_name=data.get("author_name", ""),
            author_handle=_extract_handle(data.get("author_url")),
            captured_at=None,
            snapshot_timestamp=None,
            raw_json=data,
        )
        return FetchResult(payload=payload, raw_json=data)

    async def _fetch_wayback(self, tweet_id: str) -> Optional[FetchResult]:
        params = {
            "url": f"https://publish.twitter.com/oembed?url=https://twitter.com/i/status/{tweet_id}",
            "output": "json",
            "filter": "statuscode:200",
        }

        rows = await self._request_json(CDX_URL, params=params)
        if not rows:
            return None

        if not isinstance(rows, list) or len(rows) <= 1:
            return None

        timestamps = [row[1] for row in rows[1:] if len(row) > 1]
        if not timestamps:
            return None

        timestamp = max(timestamps)
        archived_url = (
            f"https://web.archive.org/web/{timestamp}id_/https://publish.twitter.com/oembed"
        )
        params = {"url": f"https://twitter.com/i/status/{tweet_id}"}

        data = await self._request_json(archived_url, params=params)
        if not data:
            return None

        captured_at = datetime.strptime(timestamp, "%Y%m%d%H%M%S")

        payload = EmbedPayload(
            tweet_id=tweet_id,
            source="wayback",
            html=data.get("html", ""),
            author_name=data.get("author_name", ""),
            author_handle=_extract_handle(data.get("author_url")),
            captured_at=captured_at,
            snapshot_timestamp=timestamp,
            raw_json=data,
        )

        return FetchResult(payload=payload, raw_json=data)

    async def _request_json(
        self, url: str, params: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        attempt = 0
        while attempt < self.retries:
            attempt += 1
            try:
                async with self.session.get(
                    url, params=params, headers={"User-Agent": USER_AGENT}
                ) as response:
                    if response.status == 404:
                        return None
                    response.raise_for_status()
                    try:
                        return await response.json()
                    except aiohttp.ContentTypeError:
                        return None
            except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
                if attempt >= self.retries:
                    raise RuntimeError(str(exc)) from exc
                await asyncio.sleep(1.5 * attempt)
        return None


def _extract_handle(author_url: Optional[str]) -> str:
    if not author_url:
        return ""
    handle = author_url.rstrip("/").split("/")[-1]
    if not handle:
        return ""
    return handle if handle.startswith("@") else f"@{handle}"

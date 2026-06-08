from __future__ import annotations

from datetime import datetime
from typing import Optional

from bs4 import BeautifulSoup

from .types import EmbedPayload, ParsedTweet


def _parse_timestamp(blockquote: BeautifulSoup) -> Optional[datetime]:
  anchor = blockquote.find_all("a")[-1] if blockquote.find_all("a") else None
  if not anchor:
    return None

  text = anchor.get_text(strip=True)
  if not text:
    return None

  for fmt in ("%B %d, %Y", "%I:%M %p · %b %d, %Y"):  # handle common formats
    try:
      return datetime.strptime(text, fmt)
    except ValueError:
      continue
  return None


def _extract_text(blockquote: BeautifulSoup) -> str:
  for br in blockquote.find_all("br"):
    br.replace_with("\n")

  paragraphs = [p.get_text("\n", strip=True) for p in blockquote.find_all("p")]
  if paragraphs:
    return "\n\n".join(filter(None, paragraphs))

  return blockquote.get_text("\n", strip=True)


def parse_embed(payload: EmbedPayload, raw_path: str, fetched_at: datetime) -> ParsedTweet:
  soup = BeautifulSoup(payload.html, "html.parser")
  blockquote = soup.find("blockquote")
  if not blockquote:
    text = soup.get_text("\n", strip=True)
    captured_at = payload.captured_at
  else:
    text = _extract_text(blockquote)
    captured_at = payload.captured_at or _parse_timestamp(blockquote)

  return ParsedTweet(
    tweet_id=payload.tweet_id,
    text=text,
    author_name=payload.author_name,
    author_handle=payload.author_handle,
    captured_at=captured_at,
    snapshot_timestamp=payload.snapshot_timestamp,
    html=payload.html,
    source=payload.source,
    raw_path=raw_path,
    fetched_at=fetched_at,
  )


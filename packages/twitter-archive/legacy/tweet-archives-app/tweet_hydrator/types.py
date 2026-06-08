from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import BaseModel


class EmbedPayload(BaseModel):
  tweet_id: str
  source: str
  html: str
  author_name: str
  author_handle: str
  captured_at: Optional[datetime] = None
  snapshot_timestamp: Optional[str] = None
  raw_json: Dict[str, Any]


class ParsedTweet(BaseModel):
  tweet_id: str
  text: str
  author_name: str
  author_handle: str
  captured_at: Optional[datetime] = None
  snapshot_timestamp: Optional[str] = None
  html: str
  source: str
  raw_path: str
  fetched_at: datetime

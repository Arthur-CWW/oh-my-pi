# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Archive Alex Nguyen X Articles opened in Firefox as Markdown.

Uses the user's explicit request plus Firefox cookies to call the same X web
GraphQL endpoint the logged-in browser uses. Does not print cookies.
"""

from __future__ import annotations

import datetime as dt
import html
import json
import os
import pathlib
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.parse
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs/research/arcads-alternative/sources/alex"
OPEN_TABS = OUT_DIR / "open-tabs.tsv"
MAIN_JS = pathlib.Path("/tmp/x_main.js")
PROFILE = pathlib.Path(os.environ["HOME"]) / "Library/Application Support/Firefox/Profiles/jsobtawl.default-release-1758944537323"
QUERY_ID = "6uCvnic3m5reVuehkvHa3w"

FEATURE_KEYS = [
    "rweb_video_screen_enabled",
    "rweb_cashtags_enabled",
    "profile_label_improvements_pcf_label_in_post_enabled",
    "responsive_web_profile_redirect_enabled",
    "rweb_tipjar_consumption_enabled",
    "verified_phone_label_enabled",
    "creator_subscriptions_tweet_preview_api_enabled",
    "responsive_web_graphql_timeline_navigation_enabled",
    "responsive_web_graphql_skip_user_profile_image_extensions_enabled",
    "premium_content_api_read_enabled",
    "communities_web_enable_tweet_community_results_fetch",
    "c9s_tweet_anatomy_moderator_badge_enabled",
    "responsive_web_grok_analyze_button_fetch_trends_enabled",
    "responsive_web_grok_analyze_post_followups_enabled",
    "rweb_cashtags_composer_attachment_enabled",
    "responsive_web_jetfuel_frame",
    "responsive_web_grok_share_attachment_enabled",
    "responsive_web_grok_annotations_enabled",
    "articles_preview_enabled",
    "responsive_web_edit_tweet_api_enabled",
    "rweb_conversational_replies_downvote_enabled",
    "graphql_is_translatable_rweb_tweet_is_translatable_enabled",
    "view_counts_everywhere_api_enabled",
    "longform_notetweets_consumption_enabled",
    "responsive_web_twitter_article_tweet_consumption_enabled",
    "content_disclosure_indicator_enabled",
    "content_disclosure_ai_generated_indicator_enabled",
    "responsive_web_grok_show_grok_translated_post",
    "responsive_web_grok_analysis_button_from_backend",
    "post_ctas_fetch_enabled",
    "freedom_of_speech_not_reach_fetch_enabled",
    "standardized_nudges_misinfo",
    "tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled",
    "longform_notetweets_rich_text_read_enabled",
    "longform_notetweets_inline_media_enabled",
    "responsive_web_grok_image_annotation_enabled",
    "responsive_web_grok_imagine_annotation_enabled",
    "responsive_web_grok_community_note_auto_translation_is_enabled",
    "responsive_web_enhance_cards_enabled",
]

FIELD_TOGGLES = {
    "withPayments": False,
    "withAuxiliaryUserLabels": False,
    "withArticleRichContentState": True,
    "withArticlePlainText": True,
    "withArticleSummaryText": True,
    "withArticleVoiceOver": False,
    "withGrokAnalyze": False,
    "withDisallowedReplyControls": False,
}


def cookie_header() -> tuple[str, str]:
    tmp = pathlib.Path(tempfile.mkdtemp())
    try:
        for name in ["cookies.sqlite", "cookies.sqlite-wal", "cookies.sqlite-shm"]:
            p = PROFILE / name
            if p.exists():
                shutil.copy(p, tmp / name)
        conn = sqlite3.connect(tmp / "cookies.sqlite")
        cookies: dict[str, str] = {}
        for host, name, value in conn.execute(
            "select host,name,value from moz_cookies "
            "where host in ('.x.com','x.com','.twitter.com','twitter.com')"
        ):
            if host in (".twitter.com", "twitter.com") and name in cookies:
                continue
            cookies[name] = value
        return "; ".join(f"{k}={v}" for k, v in cookies.items()), cookies.get("ct0", "")
    finally:
        shutil.rmtree(tmp)


def bearer_token() -> str:
    if not MAIN_JS.exists():
        subprocess.run(
            ["curl", "-sS", "-L", "-A", "Mozilla/5.0", "https://abs.twimg.com/responsive-web/client-web/main.6426ebaa.js", "-o", str(MAIN_JS)],
            check=True,
        )
    text = MAIN_JS.read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"Bearer ([A-Za-z0-9%]+)", text)
    if not m:
        raise RuntimeError("could not find X bearer token in main JS")
    return m.group(1)


def q(obj: Any) -> str:
    return urllib.parse.quote(json.dumps(obj, separators=(",", ":")))


def call_tweet_detail(tweet_id: str, cookie: str, ct0: str, bearer: str) -> dict[str, Any]:
    variables = {
        "focalTweetId": tweet_id,
        "with_rux_injections": False,
        "rankingMode": "Relevance",
        "includePromotedContent": False,
        "withCommunity": False,
        "withBirdwatchNotes": False,
        "withVoice": False,
    }
    features = {k: True for k in FEATURE_KEYS}
    url = (
        f"https://x.com/i/api/graphql/{QUERY_ID}/TweetDetail"
        f"?variables={q(variables)}&features={q(features)}&fieldToggles={q(FIELD_TOGGLES)}"
    )
    cmd = [
        "curl",
        "-sS",
        "-L",
        url,
        "-H",
        f"Authorization: Bearer {bearer}",
        "-H",
        f"Cookie: {cookie}",
        "-H",
        f"X-Csrf-Token: {ct0}",
        "-H",
        "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:139.0) Gecko/20100101 Firefox/139.0",
        "-H",
        "Accept: application/json",
        "-H",
        "X-Twitter-Active: yes",
        "-H",
        "X-Twitter-Auth-Type: OAuth2Session",
        "-H",
        "X-Twitter-Client-Language: en",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=True)
    data = json.loads(res.stdout)
    if data.get("errors"):
        raise RuntimeError(f"X GraphQL errors for {tweet_id}: {data['errors']}")
    return data


def find_first_article(obj: Any) -> dict[str, Any] | None:
    if isinstance(obj, dict):
        ar = obj.get("article_results")
        if isinstance(ar, dict) and isinstance(ar.get("result"), dict):
            return ar["result"]
        for value in obj.values():
            found = find_first_article(value)
            if found:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = find_first_article(value)
            if found:
                return found
    return None


def find_first_tweet_text(obj: Any) -> str | None:
    if isinstance(obj, dict):
        legacy = obj.get("legacy")
        if obj.get("__typename") == "Tweet" and isinstance(legacy, dict) and legacy.get("full_text"):
            return legacy["full_text"]
        for value in obj.values():
            found = find_first_tweet_text(value)
            if found:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = find_first_tweet_text(value)
            if found:
                return found
    return None


def media_url_by_id(article: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    media = []
    if article.get("cover_media"):
        media.append(article["cover_media"])
    media.extend(article.get("media_entities") or [])
    for item in media:
        media_id = str(item.get("media_id") or "")
        info = item.get("media_info") or {}
        url = info.get("original_img_url") or info.get("url")
        if media_id and url:
            out[media_id] = url
    return out


def apply_links(text: str, block: dict[str, Any], entity_map: dict[str, dict[str, Any]]) -> str:
    # Minimal Markdown link conversion. Apply from the end to avoid offset shifts.
    replacements: list[tuple[int, int, str]] = []
    for rng in block.get("entityRanges") or []:
        key = str(rng.get("key"))
        ent = (entity_map.get(key) or {}).get("value") or {}
        data = ent.get("data") or {}
        url = data.get("url")
        if not url:
            continue
        off = int(rng.get("offset", 0))
        length = int(rng.get("length", 0))
        label = text[off : off + length] or url
        replacements.append((off, off + length, f"[{label}]({url})"))
    for start, end, repl in sorted(replacements, reverse=True):
        text = text[:start] + repl + text[end:]
    return text


def blocks_to_markdown(article: dict[str, Any]) -> str:
    cs = article.get("content_state") or {}
    entity_map_items = cs.get("entityMap") or []
    entity_map = {str(item.get("key")): item for item in entity_map_items if isinstance(item, dict)}
    media_by_id = media_url_by_id(article)
    lines: list[str] = []
    ordered_counter = 1
    for block in cs.get("blocks") or []:
        btype = block.get("type") or "unstyled"
        text = html.unescape(block.get("text") or "").rstrip()
        text = apply_links(text, block, entity_map)
        if btype == "atomic":
            inserted = False
            for rng in block.get("entityRanges") or []:
                ent = (entity_map.get(str(rng.get("key"))) or {}).get("value") or {}
                data = ent.get("data") or {}
                for item in data.get("mediaItems") or []:
                    media_id = str(item.get("mediaId") or item.get("media_id") or "")
                    if media_id and media_by_id.get(media_id):
                        lines.append(f"![X article media {media_id}]({media_by_id[media_id]})")
                        inserted = True
            if not inserted and text.strip():
                lines.append(text)
            lines.append("")
            ordered_counter = 1
            continue
        if not text:
            lines.append("")
            ordered_counter = 1
            continue
        if btype == "header-one":
            lines.extend([f"# {text}", ""])
            ordered_counter = 1
        elif btype == "header-two":
            lines.extend([f"## {text}", ""])
            ordered_counter = 1
        elif btype == "header-three":
            lines.extend([f"### {text}", ""])
            ordered_counter = 1
        elif btype == "blockquote":
            lines.extend([f"> {text}", ""])
            ordered_counter = 1
        elif btype == "unordered-list-item":
            lines.append(f"- {text}")
            ordered_counter = 1
        elif btype == "ordered-list-item":
            lines.append(f"{ordered_counter}. {text}")
            ordered_counter += 1
        else:
            lines.extend([text, ""])
            ordered_counter = 1
    return "\n".join(lines).strip() + "\n"


def slugify(title: str, tweet_id: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:80]
    return f"{tweet_id}-{slug or 'article'}"


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if not OPEN_TABS.exists():
        raise SystemExit(f"missing {OPEN_TABS}")
    rows: list[tuple[str, str, str]] = []
    for line in OPEN_TABS.read_text().splitlines()[1:]:
        if not line.strip():
            continue
        tweet_id, title, url = line.split("\t", 2)
        rows.append((tweet_id, title, url))

    cookie, ct0 = cookie_header()
    bearer = bearer_token()
    index_lines = [
        "# Alex Nguyen X Article Archive",
        "",
        f"Extracted: {dt.datetime.now(dt.UTC).isoformat()}",
        "",
        "Source: Firefox open tabs + X article/tweet GraphQL using the logged-in browser cookies, per Arthur's request. Cookies are not stored here.",
        "",
        "## Articles",
        "",
    ]
    for i, (tweet_id, history_title, tweet_url) in enumerate(rows, 1):
        print(f"[{i}/{len(rows)}] {tweet_id} {history_title}", file=sys.stderr)
        data = call_tweet_detail(tweet_id, cookie, ct0, bearer)
        article = find_first_article(data)
        if not article:
            raise RuntimeError(f"no article found for {tweet_id}")
        tweet_text = find_first_tweet_text(data) or ""
        title = article.get("title") or history_title
        article_id = article.get("rest_id") or ""
        slug = slugify(title, tweet_id)
        article_json = OUT_DIR / f"{slug}.article.json"
        article_md = OUT_DIR / f"{slug}.md"
        payload = {
            "tweet_id": tweet_id,
            "tweet_url": tweet_url,
            "tweet_text": tweet_text,
            "x_article_url": f"https://x.com/i/article/{article_id}" if article_id else None,
            "x_article_alias_url": f"https://x.com/alexcooldev/article/{tweet_id}",
            "history_title": history_title,
            "article": article,
        }
        article_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        md = [
            f"# {title.strip()}",
            "",
            f"- Author: Alex Nguyen / @alexcooldev",
            f"- Source tweet: {tweet_url}",
            f"- X article: https://x.com/i/article/{article_id}" if article_id else "- X article: unknown",
            f"- X article alias: https://x.com/alexcooldev/article/{tweet_id}",
            f"- Extracted: {dt.datetime.now(dt.UTC).isoformat()}",
            "",
        ]
        if article.get("summary_text"):
            md.extend(["## X/Grok summary", "", str(article["summary_text"]).strip(), ""])
        if article.get("cover_media"):
            info = (article["cover_media"].get("media_info") or {})
            if info.get("original_img_url"):
                md.extend(["## Cover", "", f"![cover]({info['original_img_url']})", ""])
        md.extend(["## Full text", "", blocks_to_markdown(article)])
        article_md.write_text("\n".join(md), encoding="utf-8")
        index_lines.append(f"- [{title.strip()}]({article_md.name}) — tweet `{tweet_id}`, article `{article_id}`")
        time.sleep(0.4)
    (OUT_DIR / "README.md").write_text("\n".join(index_lines) + "\n", encoding="utf-8")
    print(f"Wrote {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

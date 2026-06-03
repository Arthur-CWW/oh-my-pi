# /// script
# requires-python = ">=3.12"
# dependencies = ["requests", "beautifulsoup4", "markdownify"]
# ///
"""Download source URLs as raw HTML + readable Markdown."""

from __future__ import annotations

import datetime as dt
import hashlib
import pathlib
import re
import sys
import time
import urllib.parse

import requests
from bs4 import BeautifulSoup
from markdownify import markdownify as md

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs/research/arcads-alternative/arcads-source-urls.txt"
OUT_DIR = ROOT / "docs/research/arcads-alternative/sources/arcads"
RAW_DIR = OUT_DIR / "raw-html"
MD_DIR = OUT_DIR / "markdown"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:139.0) Gecko/20100101 Firefox/139.0"


def slug_for_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    base = f"{parsed.netloc}{parsed.path}".strip("/") or parsed.netloc
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", base).strip("-").lower()[:120]
    digest = hashlib.sha1(url.encode()).hexdigest()[:8]
    return f"{slug}-{digest}"


def extract_urls(text: str) -> list[str]:
    urls = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("##"):
            continue
        if line.startswith("http://") or line.startswith("https://"):
            urls.append(line)
    seen = set()
    out = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def clean_soup(html: str) -> tuple[str, str, str]:
    soup = BeautifulSoup(html, "html.parser")
    title = (soup.title.string if soup.title and soup.title.string else "").strip()
    desc_tag = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
    desc = (desc_tag.get("content", "") if desc_tag else "").strip()

    for tag in soup(["script", "style", "noscript", "svg", "canvas"]):
        tag.decompose()
    for tag in soup.find_all(["nav", "footer"]):
        # Keep Intercom article content, but remove obvious chrome for regular pages.
        if "intercom.help" not in str(tag)[:500].lower():
            tag.decompose()

    main = soup.find("article") or soup.find("main") or soup.body or soup
    markdown = md(str(main), heading_style="ATX", bullets="-")
    markdown = re.sub(r"\n{4,}", "\n\n\n", markdown)
    markdown = re.sub(r"[ \t]+\n", "\n", markdown)
    return title, desc, markdown.strip()


def main() -> int:
    urls = extract_urls(MANIFEST.read_text())
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    MD_DIR.mkdir(parents=True, exist_ok=True)
    index = [
        "# Arcads Source Archive",
        "",
        f"Extracted: {dt.datetime.now(dt.UTC).isoformat()}",
        "",
        f"Manifest: `{MANIFEST.relative_to(ROOT)}`",
        "",
        "## Pages",
        "",
    ]
    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})
    for i, url in enumerate(urls, 1):
        slug = slug_for_url(url)
        raw_path = RAW_DIR / f"{slug}.html"
        md_path = MD_DIR / f"{slug}.md"
        print(f"[{i}/{len(urls)}] {url}", file=sys.stderr)
        try:
            resp = session.get(url, timeout=30, allow_redirects=True)
            status = resp.status_code
            content_type = resp.headers.get("content-type", "")
            raw_path.write_bytes(resp.content)
            title, desc, body_md = clean_soup(resp.text)
            front = [
                f"# {title or url}",
                "",
                f"- URL: {url}",
                f"- Final URL: {resp.url}",
                f"- Status: {status}",
                f"- Content-Type: {content_type}",
                f"- Extracted: {dt.datetime.now(dt.UTC).isoformat()}",
            ]
            if desc:
                front.append(f"- Description: {desc}")
            front.extend(["", "---", "", body_md or "(No readable body extracted.)", ""])
            md_path.write_text("\n".join(front), encoding="utf-8")
            index.append(f"- [{title or url}]({md_path.relative_to(OUT_DIR)}) — `{status}` — {url}")
        except Exception as e:
            md_path.write_text(f"# {url}\n\nERROR: {e}\n", encoding="utf-8")
            index.append(f"- ERROR [{url}]({md_path.relative_to(OUT_DIR)}): {e}")
        time.sleep(0.25)
    (OUT_DIR / "README.md").write_text("\n".join(index) + "\n", encoding="utf-8")
    print(f"Wrote {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

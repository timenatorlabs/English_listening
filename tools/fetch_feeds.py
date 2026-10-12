"""Fetch episode lists of the extensive-listening sources into app/data/feeds/<id>.json.

Usage (from the project root; also run daily by .github/workflows/pages.yml):
    python tools/fetch_feeds.py

Most publishers do not let a web page read their podcast feed directly (no CORS),
so the list of episodes (titles, dates, links to the publisher's audio files) is
saved as a small JSON file next to the app. The audio itself is NOT copied: the
app streams it from the publisher when the learner presses play.
Standard library only, so it also runs on GitHub's servers. A source that fails
to download keeps its previous file.
"""
import json
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "app" / "data" / "feeds"
UA = {"User-Agent": "Mozilla/5.0 (eigo-mimi feed fetcher)"}
LIMIT = 30
ITUNES = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"

RSS = {
    "bbc": "https://podcasts.files.bbci.co.uk/p02pc9tn.rss",
    "voa": "https://learningenglish.voanews.com/podcast/",
    "ted": "https://feeds.acast.com/public/shows/67587e77c705e441797aff96",
}
# LibriVox: a few short, easy public-domain books (LibriVox book ids)
# 15229 The Tale of Peter Rabbit and Others / 585 Just So Stories / 193 Aesop's Fables, Volume 03
LIBRIVOX_IDS = [15229, 585, 193]


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def https(url: str) -> str:
    """The app is served over https, so audio must be https too (same files are served on both)."""
    return re.sub(r"^http://", "https://", url).replace("/proto/http/", "/proto/https/")


def plain(html: str, n: int = 300) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", html or ""))).strip()[:n]


def iso(date: str) -> str:
    try:
        return parsedate_to_datetime(date).astimezone(timezone.utc).isoformat()
    except Exception:  # noqa: BLE001
        return ""


def fetch_rss(url: str) -> list[dict]:
    root = ET.fromstring(get(url))
    eps = []
    for it in root.iter("item"):
        enc = it.find("enclosure")
        if enc is None or not (enc.get("type") or "audio").startswith("audio"):
            continue
        eps.append({
            "title": (it.findtext("title") or "").strip(),
            "date": iso(it.findtext("pubDate") or ""),
            "duration": (it.findtext(f"{ITUNES}duration") or "").strip(),
            "audio": https(enc.get("url")),
            "link": (it.findtext("link") or "").strip(),
            "summary": plain(it.findtext("description") or it.findtext(f"{ITUNES}summary") or ""),
        })
        if len(eps) >= LIMIT:
            break
    return eps


def fetch_librivox() -> list[dict]:
    eps = []
    for book_id in LIBRIVOX_IDS:
        q = f"https://librivox.org/api/feed/audiobooks?format=json&extended=1&id={book_id}"
        books = json.loads(get(q)).get("books", [])
        book = books[0] if books and books[0].get("sections") else None
        if not book:
            print(f"  librivox: book {book_id} not found", file=sys.stderr)
            continue
        author = ", ".join(f"{a.get('first_name', '')} {a.get('last_name', '')}".strip() for a in book.get("authors", []))
        for s in book["sections"]:
            secs = int(s.get("playtime") or 0)
            eps.append({
                "group": book["title"],
                "title": s.get("title") or f"Section {s.get('section_number')}",
                "date": "",
                "duration": f"{secs // 60}:{secs % 60:02d}" if secs else "",
                "audio": https(s["listen_url"]),
                "link": book.get("url_librivox", ""),
                "summary": f"{book['title']} / {author}",
            })
    return eps


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    failed = 0
    jobs = {k: (lambda u=u: fetch_rss(u)) for k, u in RSS.items()}
    jobs["librivox"] = fetch_librivox
    for sid, job in jobs.items():
        try:
            eps = job()
            if not eps:
                raise ValueError("no episodes")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"{sid}: FAILED ({e}); keeping the previous list", file=sys.stderr)
            continue
        (OUT / f"{sid}.json").write_text(json.dumps({
            "source": sid,
            "fetched": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "episodes": eps,
        }, ensure_ascii=False, indent=1), encoding="utf-8")
        latest = max((e["date"] for e in eps if e["date"]), default="")
        print(f"{sid}: {len(eps)} episodes, latest {latest[:10] or '-'}")
    return 0 if failed < len(jobs) else 1


if __name__ == "__main__":
    sys.exit(main())

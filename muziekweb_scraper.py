#!/usr/bin/env python3
"""Scraper voor albumpagina's van Muziekweb -> SQLite.

Gebruik:
    python muziekweb_scraper.py init
    python muziekweb_scraper.py add JK278043 https://www.muziekweb.nl/Link/JK278043 ids.txt
    python muziekweb_scraper.py discover            # vult de wachtrij via sitemap(s)
    python muziekweb_scraper.py crawl --delay 2     # haalt de wachtrij op en parst
    python muziekweb_scraper.py reparse             # parst opgeslagen HTML opnieuw
    python muziekweb_scraper.py parse-file pagina.html
    python muziekweb_scraper.py export-csv albums.csv
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import sqlite3
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Tag

BASE_URL = "https://www.muziekweb.nl"
DEFAULT_DB = "muziekweb.db"
SCHEMA_PATH = Path(__file__).with_name("schema.sql")
USER_AGENT = "fonos-muziekweb-scraper/1.0 (+contact: hthiry@beeldengeluid.nl)"

CATALOG_RE = re.compile(r"\b([A-Z]{2,4}\d{4,})\b")
LINK_RE = re.compile(r"/Link/([A-Z]{2,4}\d{4,})", re.I)

DUTCH_MONTHS = {
    "januari": 1, "februari": 2, "maart": 3, "april": 4, "mei": 5, "juni": 6,
    "juli": 7, "augustus": 8, "september": 9, "oktober": 10, "november": 11,
    "december": 12,
}


@dataclass
class Album:
    catalog_nr: str
    title: str
    url: str
    artists: list[tuple[str, str | None]] = field(default_factory=list)
    product: str | None = None
    label: str | None = None
    barcode: str | None = None
    genres: list[str] = field(default_factory=list)
    object_status: str | None = None
    release_date: str | None = None
    release_year: int | None = None
    release_month: int | None = None
    duration: str | None = None
    duration_seconds: int | None = None
    avg_rating: float | None = None
    rating_count: int | None = None
    is_tip: bool = False
    description: str | None = None
    cover_url: str | None = None
    back_cover_url: str | None = None


# --------------------------------------------------------------------------- parsing

def _clean(text: str | None) -> str | None:
    if text is None:
        return None
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def _norm_label(text: str) -> str:
    return re.sub(r"[\s:]+", " ", text).strip().lower()


def _find_value(soup: BeautifulSoup, label: str) -> Tag | None:
    """Zoek het waarde-element bij een label als 'Catalogusnr.:'.

    Werkt voor <dt>/<dd>, <th>/<td> en naast elkaar staande <div>/<span>'s.
    """
    wanted = _norm_label(label)
    for el in soup.find_all(string=True):
        if _norm_label(el) != wanted:
            continue
        node = el.parent
        # Loop omhoog tot er een element-sibling is (label kan in <b>/<span> zitten).
        for _ in range(3):
            sib = node.find_next_sibling()
            if sib is not None:
                return sib
            node = node.parent
            if node is None:
                break
    return None


def _value_text(soup: BeautifulSoup, label: str) -> str | None:
    el = _find_value(soup, label)
    return _clean(el.get_text(" ")) if el else None


def parse_release(text: str | None) -> tuple[int | None, int | None]:
    if not text:
        return None, None
    year = re.search(r"\b(1[89]\d\d|20\d\d)\b", text)
    month = next((n for m, n in DUTCH_MONTHS.items() if m in text.lower()), None)
    return (int(year.group(1)) if year else None), month


def parse_duration(text: str | None) -> int | None:
    if not text:
        return None
    m = re.search(r"(?:(\d+):)?(\d{1,2}):(\d{2})", text)
    if not m:
        return None
    h, mi, s = int(m.group(1) or 0), int(m.group(2)), int(m.group(3))
    return h * 3600 + mi * 60 + s


def parse_album(html: str, url: str) -> Album | None:
    soup = BeautifulSoup(html, "html.parser")

    catalog_nr = _value_text(soup, "Catalogusnr.")
    if catalog_nr:
        m = CATALOG_RE.search(catalog_nr)
        catalog_nr = m.group(1) if m else catalog_nr
    else:
        m = LINK_RE.search(url)
        catalog_nr = m.group(1).upper() if m else None
    if not catalog_nr:
        return None

    h1 = soup.find("h1")
    title = _clean(h1.get_text(" ")) if h1 else None
    if not title:
        og = soup.find("meta", property="og:title")
        title = _clean(og["content"]) if og and og.get("content") else None
    if not title:
        return None

    album = Album(catalog_nr=catalog_nr, title=title, url=url)

    # Artiest(en): de links direct onder de titel.
    if h1:
        nxt = h1.find_next_sibling()
        if nxt is not None:
            links = nxt.find_all("a") or ([nxt] if nxt.name == "a" else [])
            for a in links:
                name = _clean(a.get_text(" "))
                if name:
                    href = a.get("href")
                    album.artists.append((name, urljoin(BASE_URL, href) if href else None))
            if not album.artists:
                name = _clean(nxt.get_text(" "))
                if name:
                    album.artists.append((name, None))

    album.product = _value_text(soup, "Product")

    bestel = _find_value(soup, "Bestel-info")
    if bestel is not None:
        a = bestel.find("a")
        album.label = _clean(a.get_text(" ")) if a else None
        rest = _clean(bestel.get_text(" ")) or ""
        bc = re.search(r"\b(\d{8,14})\b", rest)
        album.barcode = bc.group(1) if bc else None
        if album.label is None:
            album.label = _clean(re.sub(r"\b\d{8,14}\b", "", rest))

    genres = _find_value(soup, "Genres")
    if genres is not None:
        names = [_clean(a.get_text(" ")) for a in genres.find_all("a")]
        if not names:
            names = [_clean(g) for g in genres.get_text().split(",")]
        album.genres = [n for n in names if n]

    album.object_status = _value_text(soup, "Object status")
    album.release_date = _value_text(soup, "Uitgebracht")
    album.release_year, album.release_month = parse_release(album.release_date)
    album.duration = _value_text(soup, "Totale speelduur")
    album.duration_seconds = parse_duration(album.duration)

    gem = _value_text(soup, "Gemiddeld")
    if gem and "geen" not in gem.lower():
        r = re.search(r"(\d+(?:[.,]\d+)?)", gem)
        album.avg_rating = float(r.group(1).replace(",", ".")) if r else None
        c = re.search(r"(\d+)\s*waardering", gem)
        album.rating_count = int(c.group(1)) if c else None
    elif gem:
        album.rating_count = 0

    # Toelichting: tekst na de kop "Toelichting".
    for head in soup.find_all(["h2", "h3", "h4", "strong", "b", "div", "span"]):
        if _clean(head.get_text()) == "Toelichting":
            parts = []
            for sib in head.find_next_siblings():
                txt = _clean(sib.get_text(" "))
                if txt:
                    parts.append(txt)
            desc = " ".join(parts)
            desc = re.sub(r"\s*(\.\.\.|…)?\s*meer$", "", desc).strip()
            album.description = desc or None
            break

    page_text = soup.get_text(" ")
    album.is_tip = bool(soup.find(class_=re.compile(r"\btip\b", re.I))) or bool(
        re.search(r"\bTIP\b", page_text)
    )

    imgs = [img for img in soup.find_all("img") if img.get("src")]
    covers = [i for i in imgs if re.search(r"cover|album|image", i["src"] + " ".join(i.get("class", [])), re.I)]
    if covers:
        album.cover_url = urljoin(BASE_URL, covers[0]["src"])
    else:
        og = soup.find("meta", property="og:image")
        if og and og.get("content"):
            album.cover_url = urljoin(BASE_URL, og["content"])
    back = soup.find(string=re.compile("Toon achterzijde"))
    if back is not None:
        a = back.find_parent("a")
        target = a and (a.get("data-src") or a.get("data-image") or a.get("href"))
        if target and not target.startswith(("#", "javascript")):
            album.back_cover_url = urljoin(BASE_URL, target)

    return album


# --------------------------------------------------------------------------- database

def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    return conn


def _get_or_create(conn: sqlite3.Connection, table: str, name: str, url: str | None = None) -> int:
    row = conn.execute(f"SELECT id FROM {table} WHERE name = ?", (name,)).fetchone()
    if row:
        if url and table == "artists":
            conn.execute("UPDATE artists SET url = COALESCE(url, ?) WHERE id = ?", (url, row[0]))
        return row[0]
    if table == "artists":
        cur = conn.execute("INSERT INTO artists (name, url) VALUES (?, ?)", (name, url))
    else:
        cur = conn.execute(f"INSERT INTO {table} (name) VALUES (?)", (name,))
    return cur.lastrowid


def save_album(conn: sqlite3.Connection, album: Album) -> None:
    label_id = _get_or_create(conn, "labels", album.label) if album.label else None
    conn.execute(
        """INSERT OR REPLACE INTO albums
           (catalog_nr, title, product, label_id, barcode, release_date, release_year,
            release_month, duration, duration_seconds, object_status, avg_rating,
            rating_count, is_tip, description, cover_url, back_cover_url, url, scraped_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (album.catalog_nr, album.title, album.product, label_id, album.barcode,
         album.release_date, album.release_year, album.release_month, album.duration,
         album.duration_seconds, album.object_status, album.avg_rating, album.rating_count,
         int(album.is_tip), album.description, album.cover_url, album.back_cover_url,
         album.url, _now()),
    )
    conn.execute("DELETE FROM album_artists WHERE catalog_nr = ?", (album.catalog_nr,))
    for pos, (name, url) in enumerate(album.artists):
        aid = _get_or_create(conn, "artists", name, url)
        conn.execute("INSERT OR IGNORE INTO album_artists VALUES (?,?,?)", (album.catalog_nr, aid, pos))
    conn.execute("DELETE FROM album_genres WHERE catalog_nr = ?", (album.catalog_nr,))
    for g in album.genres:
        gid = _get_or_create(conn, "genres", g)
        conn.execute("INSERT OR IGNORE INTO album_genres VALUES (?,?)", (album.catalog_nr, gid))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- fetching

def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "nl,en;q=0.8"})
    return s


def to_url(item: str) -> str:
    item = item.strip()
    if item.startswith("http"):
        return item
    return f"{BASE_URL}/Link/{item.upper()}"


def fetch(session: requests.Session, url: str, retries: int = 3) -> requests.Response:
    for attempt in range(retries):
        try:
            resp = session.get(url, timeout=30)
            if resp.status_code in (429, 503):
                wait = int(resp.headers.get("Retry-After", 30 * (attempt + 1)))
                print(f"  {resp.status_code}, wacht {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            return resp
        except requests.RequestException as exc:
            if attempt == retries - 1:
                raise
            print(f"  fout ({exc}), opnieuw proberen", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    return resp


def discover_sitemaps(session: requests.Session) -> list[str]:
    sitemaps = []
    try:
        robots = session.get(f"{BASE_URL}/robots.txt", timeout=30).text
        sitemaps = [l.split(":", 1)[1].strip() for l in robots.splitlines()
                    if l.lower().startswith("sitemap:")]
    except requests.RequestException:
        pass
    return sitemaps or [f"{BASE_URL}/sitemap.xml"]


def iter_sitemap_urls(session: requests.Session, sitemap_url: str, seen: set[str] | None = None):
    seen = seen if seen is not None else set()
    if sitemap_url in seen:
        return
    seen.add(sitemap_url)
    resp = session.get(sitemap_url, timeout=60)
    if resp.status_code != 200:
        print(f"  sitemap {sitemap_url}: HTTP {resp.status_code}", file=sys.stderr)
        return
    data = resp.content
    if sitemap_url.endswith(".gz") or data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    root = ET.fromstring(data)
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    for loc in root.findall(".//sm:sitemap/sm:loc", ns):
        yield from iter_sitemap_urls(session, loc.text.strip(), seen)
    for loc in root.findall(".//sm:url/sm:loc", ns):
        yield loc.text.strip()


def enqueue(conn: sqlite3.Connection, urls) -> int:
    n = 0
    for u in urls:
        n += conn.execute("INSERT OR IGNORE INTO queue (url) VALUES (?)", (u,)).rowcount
    conn.commit()
    return n


def crawl(conn: sqlite3.Connection, delay: float, limit: int | None) -> None:
    session = make_session()
    sql = "SELECT url FROM queue WHERE status = 'pending'"
    if limit:
        sql += f" LIMIT {int(limit)}"
    urls = [r[0] for r in conn.execute(sql)]
    print(f"{len(urls)} pagina's in de wachtrij")
    for i, url in enumerate(urls, 1):
        try:
            resp = fetch(session, url)
            conn.execute(
                "INSERT OR REPLACE INTO raw_pages (url, catalog_nr, status_code, html, fetched_at) "
                "VALUES (?,?,?,?,?)",
                (url, None, resp.status_code, resp.text, _now()),
            )
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}")
            album = parse_album(resp.text, resp.url)
            if album is None:
                raise RuntimeError("geen albumgegevens gevonden")
            save_album(conn, album)
            conn.execute("UPDATE raw_pages SET catalog_nr = ? WHERE url = ?", (album.catalog_nr, url))
            conn.execute("UPDATE queue SET status='done', error=NULL WHERE url = ?", (url,))
            print(f"[{i}/{len(urls)}] {album.catalog_nr}  {album.title}")
        except Exception as exc:  # noqa: BLE001 - per pagina doorgaan
            conn.execute("UPDATE queue SET status='error', error=? WHERE url = ?", (str(exc), url))
            print(f"[{i}/{len(urls)}] FOUT {url}: {exc}", file=sys.stderr)
        conn.commit()
        time.sleep(delay)


def reparse(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT url, html FROM raw_pages WHERE status_code = 200").fetchall()
    ok = 0
    for url, html in rows:
        album = parse_album(html, url)
        if album:
            save_album(conn, album)
            ok += 1
    conn.commit()
    print(f"{ok}/{len(rows)} pagina's opnieuw geparsed")


def export_csv(conn: sqlite3.Connection, path: str) -> None:
    cur = conn.execute("SELECT * FROM album_overview ORDER BY catalog_nr")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([d[0] for d in cur.description])
        w.writerows(cur)
    print(f"geëxporteerd naar {path}")


# --------------------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", default=DEFAULT_DB)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init")
    a = sub.add_parser("add", help="catalogusnummers, URL's of tekstbestanden met één per regel")
    a.add_argument("items", nargs="+")
    d = sub.add_parser("discover", help="vul de wachtrij via de sitemap(s) van Muziekweb")
    d.add_argument("--sitemap", action="append", help="specifieke sitemap-URL (herhaalbaar)")
    c = sub.add_parser("crawl")
    c.add_argument("--delay", type=float, default=2.0, help="seconden tussen verzoeken (standaard 2)")
    c.add_argument("--limit", type=int)
    c.add_argument("--retry-errors", action="store_true")
    sub.add_parser("reparse")
    pf = sub.add_parser("parse-file")
    pf.add_argument("path")
    pf.add_argument("--url", default=BASE_URL)
    e = sub.add_parser("export-csv")
    e.add_argument("path")
    args = p.parse_args(argv)

    if args.cmd == "parse-file":
        album = parse_album(Path(args.path).read_text(encoding="utf-8"), args.url)
        print(json.dumps(asdict(album) if album else None, ensure_ascii=False, indent=2))
        return

    conn = connect(args.db)
    if args.cmd == "init":
        print(f"database klaar: {args.db}")
    elif args.cmd == "add":
        items = []
        for it in args.items:
            path = Path(it)
            if path.is_file():
                items += [l for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
            else:
                items.append(it)
        print(f"{enqueue(conn, (to_url(i) for i in items))} nieuwe URL's in de wachtrij")
    elif args.cmd == "discover":
        session = make_session()
        total = 0
        for sm in args.sitemap or discover_sitemaps(session):
            print(f"sitemap: {sm}")
            urls = (u for u in iter_sitemap_urls(session, sm) if LINK_RE.search(u))
            total += enqueue(conn, urls)
        print(f"{total} nieuwe album-URL's in de wachtrij")
    elif args.cmd == "crawl":
        if args.retry_errors:
            conn.execute("UPDATE queue SET status='pending' WHERE status='error'")
        crawl(conn, args.delay, args.limit)
    elif args.cmd == "reparse":
        reparse(conn)
    elif args.cmd == "export-csv":
        export_csv(conn, args.path)


if __name__ == "__main__":
    main()

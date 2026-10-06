#!/usr/bin/env python3
"""Haal de albumpagina's van www.muziekweb.nl op voor gegevens die niet in de open data staan:
tracklijsten (met werken, componisten en uitvoerenden met rol), toelichting, opmerkingen,
opname-info, TIP-markering, gemiddelde waardering en gerelateerde artikelen.

    python muziekweb_scrape.py enqueue                 # alle albums uit de database in de wachtrij
    python muziekweb_scrape.py enqueue --newest        # ... nieuwste eerst
    python muziekweb_scrape.py add JK278043 ...        # losse catalogusnummers
    python muziekweb_scrape.py crawl --limit 100       # ophalen (hervat automatisch)
    python muziekweb_scrape.py reparse                 # opgeslagen HTML opnieuw verwerken
    python muziekweb_scrape.py status

Respecteert robots.txt: de objectstatus (uitleenstatus) komt van /Muziekweb/DUIT/, dat voor
crawlers is uitgesloten, en wordt dus niet opgehaald.
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Tag

HERE = Path(__file__).resolve().parent
BASE_URL = "https://www.muziekweb.nl"
DEFAULT_DB = HERE / "muziekweb.db"
SCHEMA = HERE / "scrape_schema.sql"
USER_AGENT = "fonos-muziekweb/1.0 (Beeld en Geluid; contact: hthiry@beeldengeluid.nl)"

CODE_RE = re.compile(r"/Link/([A-Za-z0-9]+)")
KIND_RE = re.compile(r"/Link/[A-Za-z0-9]+/(POPULAR|CLASSICAL)\b")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _text(el: Tag | None) -> str | None:
    if el is None:
        return None
    t = re.sub(r"\s+", " ", el.get_text(" ")).strip()
    return t or None


def _code(href: str | None) -> str | None:
    m = CODE_RE.search(href or "")
    return m.group(1) if m else None


def _seconds(text: str | None) -> int | None:
    if not text:
        return None
    parts = text.strip().split(":")
    if not all(p.isdigit() for p in parts) or len(parts) > 3:
        return None
    secs = 0
    for p in parts:
        secs = secs * 60 + int(p)
    return secs


def _field(soup: BeautifulSoup, css_class: str) -> Tag | None:
    """Waarde-deel van een <div class="cat-xxx"><span class="cat-label">..</span>waarde</div>."""
    div = soup.find("div", class_=css_class)
    if div is None:
        return None
    div = BeautifulSoup(str(div), "html.parser").div
    label = div.find("span", class_="cat-label")
    if label:
        label.decompose()
    for meta in div.find_all("meta"):
        meta.decompose()
    return div


# --------------------------------------------------------------------------- parsing

def parse_page(html: str, album_code: str) -> dict | None:
    soup = BeautifulSoup(html, "html.parser")
    h1 = soup.find("h1", class_="cat-albumtitle")
    if h1 is None:
        return None
    page: dict = {"album_code": album_code, "title": _text(h1)}

    perf = h1.find_next_sibling("ul", class_="cat-performers")
    page["performers"] = ", ".join(_text(li) for li in perf.find_all("li")) if perf else None
    page["product"] = _text(_field(soup, "cat-product"))
    page["release_text"] = _text(_field(soup, "cat-albumrelease"))
    dp = soup.find("meta", itemprop="datePublished")
    page["date_published"] = dp.get("content") if dp else None
    page["recording"] = _text(_field(soup, "cat-recording")) or _text(_field(soup, "cat-dvdrecording"))
    page["recording_technique"] = _text(_field(soup, "cat-recordingtechnic"))
    page["playtime"] = _text(_field(soup, "cat-playtime"))

    cover = soup.find("div", class_="cat-albumcover")
    page["is_tip"] = int(bool(cover and cover.find(class_="cat-tip")))
    img = soup.find("img", itemprop="image")
    page["cover_url"] = urljoin(BASE_URL, img["src"]) if img and img.get("src") else None
    back = soup.find("a", class_="cat-albumcover-showback")
    page["back_cover_url"] = (page["cover_url"].replace("/FRONT/", "/BACK/")
                              if back and page["cover_url"] and "/FRONT/" in page["cover_url"] else None)

    avg = _text(soup.find(id="AlbumRatingAverage"))
    m = re.match(r"(\d+(?:,\d+)?)\s*\((\d+)", avg or "")
    page["avg_rating"] = float(m.group(1).replace(",", ".")) if m else None
    page["rating_count"] = int(m.group(2)) if m else (0 if avg else None)

    art = soup.select_one(".cat-album-article .cat-article-text")
    desc = author = None
    if art is not None:
        for junk in art.select(".hellip, .cat-info-more"):
            junk.decompose()
        desc = _text(art)
        if desc:
            desc = re.sub(r"\s+([,.;:!?)])", r"\1", desc)
            am = re.search(r"\(([A-Za-z][A-Za-z. ]{0,11})\)$", desc)
            author = am.group(1) if am else None
    page["description"], page["description_author"] = desc, author
    page["remark"] = "\n".join(t for t in (_text(p) for p in soup.select("p.cat-remark")) if t) or None
    nt = soup.find("meta", itemprop="numTracks")
    page["num_tracks"] = int(nt["content"]) if nt and nt.get("content", "").isdigit() else None

    page["labels"] = []
    for i, li in enumerate(soup.select("div.cat-orderinfo ul.cat-orderinfo > li")):
        a = li.find("a")
        cn = li.find(itemprop="catalogNumber")
        page["labels"].append((album_code, i, _code(a.get("href")) if a else None,
                               _text(li.find(itemprop="recordLabel")) or _text(a), _text(cn)))
    page["genres"] = []
    for a in soup.select("div.cat-genres a"):
        if _code(a.get("href")):
            page["genres"].append((album_code, _code(a["href"]), _text(a)))
    page["articles"] = []
    for div in soup.select("#related-articles li.article .clickable"):
        m = re.search(r"'(/Link/[^']+)'", div.get("onclick", ""))
        if m:
            page["articles"].append((album_code, urljoin(BASE_URL, m.group(1)), _text(div.find("h3"))))

    parse_tracks(soup, album_code, page)

    keep = soup.select("div.widget.cat-album-info")
    page["content_z"] = zlib.compress("".join(str(k) for k in keep).encode("utf-8"), 9)
    return page


def parse_tracks(soup: BeautifulSoup, album_code: str, page: dict) -> None:
    works, composers, alt_titles, tracks, performers = {}, set(), set(), [], []

    def add_work(code, title, href):
        if code and code not in works:
            km = KIND_RE.search(href or "")
            works[code] = (code, title, km.group(1) if km else None)

    def work_info(container: Tag) -> str | None:
        """Werk (titel, componisten, alternatieve titels) uit een .cat-work-blok."""
        wt = container.select_one(".cat-worktitle a")
        if wt is None:
            return None
        code = _code(wt.get("href"))
        add_work(code, _text(wt), wt.get("href"))
        for a in container.select(".cat-composer li a"):
            if _code(a.get("href")):
                composers.add((code, _code(a["href"]), _text(a)))
        for alt in container.select("li[itemprop=alternativeHeadline]"):
            if _text(alt):
                alt_titles.add((code, _text(alt)))
        return code

    def work_performers(container: Tag) -> list[tuple]:
        out = []
        for pli in container.select(".cat-work-col-performers li"):
            a = pli.find("a")
            role = _text(pli.find(class_="cat-role"))
            out.append((_code(a.get("href")) if a else None,
                        _text(a) if a else _text(pli), role.strip("()") if role else None))
        return out

    for rec in soup.find_all(attrs={"itemtype": re.compile(r"schema\.org/MusicRecording$")}):
        li = rec.find_parent("li")
        pos = li.find("meta", itemprop="position", recursive=False) if li else None
        position = int(pos["content"]) if pos and pos.get("content", "").isdigit() else None
        url = rec.find("meta", itemprop="url")
        qs = parse_qs(urlparse(url["content"]).query) if url else {}
        track_id = qs.get("TrackID", [None])[0]
        if not track_id and position is not None:
            track_id = f"{album_code}-{position:04d}"
        if not track_id:
            continue
        work_style = "cat-work" in (rec.get("class") or [])   # bv. DVD: het werk is de track
        title_el = rec.find(class_="cat-worktitle" if work_style else "cat-track-title")
        title_a = title_el.find("a") if title_el else None
        dur = _text(rec.find(class_="cat-track-playtime"))
        spot = rec.find("a", class_="spotifylink")

        work_code = _code(title_a.get("href")) if title_a else None
        if work_code:
            add_work(work_code, _text(title_a), title_a.get("href"))

        track_perfs = []
        if work_style:
            work_code = work_info(rec) or work_code
            track_perfs = work_performers(rec)
        else:
            # Klassiek: track hangt onder een werk met componist(en) en uitvoerenden met rol.
            tl = rec.find_parent("ul", class_="cat-tracklist")
            if tl is not None and tl.find_parent("ul", class_="cat-worklist") is not None:
                work_div = tl.find_parent("li").find("div", class_="cat-work")
                if work_div is not None:
                    work_code = work_info(work_div) or work_code
                    track_perfs = work_performers(work_div)
        if not track_perfs:
            for el in rec.find_all(attrs={"itemprop": "byArtist"}):
                if el.name == "meta":
                    track_perfs.append((None, el.get("content"), None))
                    continue
                n, u = el.find(itemprop="name"), el.find("meta", itemprop="url")
                a = el.find("a")
                name = n.get("content") if n is not None and n.name == "meta" else _text(n or el)
                href = u.get("content") if u is not None else (a.get("href") if a else None)
                track_perfs.append((_code(href), name, None))

        title = None
        if title_el is not None:
            t = BeautifulSoup(str(title_el), "html.parser")
            for meta in t.find_all("meta"):
                meta.decompose()
            title = _text(t)
        tracks.append((track_id, album_code,
                       position, title, dur, _seconds(dur), work_code, spot.get("href") if spot else None))
        for i, (code, name, role) in enumerate(track_perfs):
            performers.append((track_id, i, code, name, role))

    page.update(works=list(works.values()), composers=sorted(composers), alt_titles=sorted(alt_titles),
                tracks=tracks, track_performers=performers)


# --------------------------------------------------------------------------- database

PAGE_COLS = ["album_code", "url", "title", "performers", "product", "release_text", "date_published",
             "recording", "recording_technique", "playtime", "is_tip", "avg_rating", "rating_count",
             "description", "description_author", "remark", "num_tracks", "cover_url",
             "back_cover_url", "content_z", "fetched_at"]


def connect(db: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db, timeout=60)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA.read_text(encoding="utf-8"))
    cols = {r[1] for r in conn.execute("PRAGMA table_info(scrape_queue)")}
    if "priority" not in cols:  # databases van vóór de prioriteitskolom
        conn.execute("ALTER TABLE scrape_queue ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    return conn


CODE_HEADERS = {"titelnummer", "titlenumber", "titelnr", "catalogusnummer", "catalogusnr"}


def read_codes(items: list[str]) -> list[str]:
    """Catalogusnummers uit argumenten, .txt-bestanden (één per regel) of .xlsx-bestanden
    (alle kolommen met kop 'Titelnummer'/'titlenumber', op alle tabbladen behalve OUD_*)."""
    codes = []
    for item in items:
        path = Path(item)
        if path.suffix.lower() == ".xlsx" and path.is_file():
            import openpyxl

            wb = openpyxl.load_workbook(path, read_only=True)
            for ws in wb.worksheets:
                if ws.title.upper().startswith("OUD"):
                    continue
                rows = ws.iter_rows(values_only=True)
                header = next(rows, ())
                idx = [i for i, h in enumerate(header) if h and str(h).strip().lower() in CODE_HEADERS]
                for row in rows:
                    for i in idx:
                        if i < len(row) and row[i]:
                            codes.append(str(row[i]))
        elif path.is_file():
            codes += path.read_text(encoding="utf-8").split()
        else:
            codes.append(item)
    codes = [c.strip().upper() for c in codes]
    return list(dict.fromkeys(c for c in codes if re.fullmatch(r"[A-Z]{2,4}\d{3,}", c)))


def save_page(conn: sqlite3.Connection, page: dict) -> None:
    code = page["album_code"]
    for t in ("album_page_labels", "album_page_genres", "album_articles", "tracks"):
        conn.execute(f"DELETE FROM {t} WHERE album_code = ?", (code,))
    conn.execute("DELETE FROM track_performers WHERE track_id LIKE ?", (code + "-%",))
    conn.execute(f"INSERT OR REPLACE INTO album_pages ({','.join(PAGE_COLS)}) "
                 f"VALUES ({','.join('?' * len(PAGE_COLS))})", [page.get(c) for c in PAGE_COLS])
    conn.executemany("INSERT OR REPLACE INTO album_page_labels VALUES (?,?,?,?,?)", page["labels"])
    conn.executemany("INSERT OR REPLACE INTO album_page_genres VALUES (?,?,?)", page["genres"])
    conn.executemany("INSERT OR REPLACE INTO album_articles VALUES (?,?,?)", page["articles"])
    conn.executemany("INSERT OR IGNORE INTO works VALUES (?,?,?)", page["works"])
    conn.executemany("INSERT OR IGNORE INTO work_composers VALUES (?,?,?)", page["composers"])
    conn.executemany("INSERT OR IGNORE INTO work_alt_titles VALUES (?,?)", page["alt_titles"])
    conn.executemany("INSERT OR REPLACE INTO tracks VALUES (?,?,?,?,?,?,?,?)", page["tracks"])
    conn.executemany("INSERT OR REPLACE INTO track_performers VALUES (?,?,?,?,?)", page["track_performers"])


# --------------------------------------------------------------------------- crawl

_local = threading.local()


def _session() -> requests.Session:
    if not hasattr(_local, "s"):
        _local.s = requests.Session()
        _local.s.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "nl"})
    return _local.s


def fetch(code: str, delay: float) -> tuple[str, int | None, str | None, str | None, str | None]:
    """-> (code, http_status, final_url, html, error)."""
    url = f"{BASE_URL}/Link/{code}"
    for attempt in range(5):
        try:
            r = _session().get(url, timeout=60)
            if r.status_code in (429, 500, 502, 503, 504):
                wait = int(r.headers.get("Retry-After", 0) or 0) or 30 * (attempt + 1)
                print(f"  {code}: HTTP {r.status_code}, wacht {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            time.sleep(delay)
            return code, r.status_code, r.url, r.text, None
        except requests.RequestException as exc:
            time.sleep(10 * (attempt + 1))
            err = str(exc)
    return code, None, None, None, err


def crawl(conn: sqlite3.Connection, limit: int | None, workers: int, delay: float) -> None:
    sql = "SELECT album_code FROM scrape_queue WHERE status = 'pending' ORDER BY priority DESC, rowid"
    if limit:
        sql += f" LIMIT {int(limit)}"
    codes = [r[0] for r in conn.execute(sql)]
    total, t0, n = len(codes), time.time(), 0
    print(f"{total} albums in de wachtrij, {workers} worker(s), {delay}s pauze per worker")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for code, status, final_url, html, err in pool.map(lambda c: fetch(c, delay), codes):
            n += 1
            state = "error"
            if html is not None and status == 200:
                try:
                    page = parse_page(html, code)
                    if page is None:
                        state, err = "missing", "geen albumpagina"
                    else:
                        page["url"], page["fetched_at"] = final_url, _now()
                        save_page(conn, page)
                        state = "done"
                except Exception as exc:  # noqa: BLE001 - volgende pagina gewoon doorgaan
                    err = f"parse: {exc!r}"
            elif status in (403, 404, 410):    # 403: o.a. e-albums zijn niet openbaar
                state = "missing"
            conn.execute("UPDATE scrape_queue SET status=?, http_status=?, error=?, fetched_at=? "
                         "WHERE album_code=?", (state, status, err, _now(), code))
            # Per pagina committen: zo houdt de crawl de schrijflock maar milliseconden vast
            # en kan `export` tussendoor schrijven.
            conn.commit()
            if n % 50 == 0 or n == total:
                rate = n / (time.time() - t0)
                eta = (total - n) / rate / 3600 if rate else 0
                print(f"  {n}/{total}  {rate:.2f} p/s  nog ~{eta:.1f} uur", file=sys.stderr)
    conn.commit()


def reparse(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT album_code, url, fetched_at, content_z FROM album_pages").fetchall()
    for code, url, fetched_at, blob in rows:
        page = parse_page(zlib.decompress(blob).decode("utf-8"), code)
        if page:
            page["url"], page["fetched_at"] = url, fetched_at
            save_page(conn, page)
    conn.commit()
    print(f"{len(rows)} pagina's opnieuw verwerkt")


# --------------------------------------------------------------------------- export / restore
# Incrementele back-up: elk deel bevat alleen albums die sinds het vorige deel zijn opgehaald,
# als JSON Lines (gz) per tabel. Zonder de opgeslagen HTML (content_z), om de omvang te beperken.

EXPORT_TABLES = {  # tabel -> WHERE-clausule op de te exporteren albumcodes (temp.export_codes)
    "scrape_queue": "album_code IN (SELECT code FROM export_codes)",
    "album_pages": "album_code IN (SELECT code FROM export_codes)",
    "album_page_labels": "album_code IN (SELECT code FROM export_codes)",
    "album_page_genres": "album_code IN (SELECT code FROM export_codes)",
    "album_articles": "album_code IN (SELECT code FROM export_codes)",
    "tracks": "album_code IN (SELECT code FROM export_codes)",
    "track_performers": "track_id IN (SELECT track_id FROM tracks WHERE album_code IN (SELECT code FROM export_codes))",
    "works": "code IN (SELECT work_code FROM tracks WHERE album_code IN (SELECT code FROM export_codes))",
    "work_composers": "work_code IN (SELECT work_code FROM tracks WHERE album_code IN (SELECT code FROM export_codes))",
    "work_alt_titles": "work_code IN (SELECT work_code FROM tracks WHERE album_code IN (SELECT code FROM export_codes))",
}


def export(conn: sqlite3.Connection, out_dir: Path) -> Path | None:
    import gzip
    import json

    conn.execute("CREATE TABLE IF NOT EXISTS export_log (album_code TEXT PRIMARY KEY, part INTEGER NOT NULL)")
    conn.execute("DROP TABLE IF EXISTS temp.export_codes")
    conn.execute("CREATE TEMP TABLE export_codes AS SELECT album_code AS code FROM scrape_queue "
                 "WHERE status IN ('done', 'missing') AND album_code NOT IN (SELECT album_code FROM export_log)")
    n = conn.execute("SELECT COUNT(*) FROM export_codes").fetchone()[0]
    if n == 0:
        print("niets nieuws om te exporteren")
        return None
    out_dir.mkdir(parents=True, exist_ok=True)
    part = 1 + max([int(p.name.split("-")[1]) for p in out_dir.glob("part-*")] or [0])
    part_dir = out_dir / f"part-{part:04d}"
    part_dir.mkdir()
    for table, where in EXPORT_TABLES.items():
        cur = conn.execute(f"SELECT * FROM {table} WHERE {where}")
        cols = [d[0] for d in cur.description]
        with gzip.open(part_dir / f"{table}.jsonl.gz", "wt", encoding="utf-8", compresslevel=9) as f:
            for row in cur:
                rec = {c: v for c, v in zip(cols, row) if c != "content_z"}
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    conn.execute("INSERT INTO export_log SELECT code, ? FROM export_codes", (part,))
    conn.commit()
    size = sum(f.stat().st_size for f in part_dir.iterdir())
    print(f"{part_dir}: {n} albums, {size / 1e6:.1f} MB")
    return part_dir


def restore(conn: sqlite3.Connection, in_dir: Path) -> None:
    import gzip
    import json

    parts = sorted(in_dir.glob("part-*"))
    for part_dir in parts:
        for table in EXPORT_TABLES:
            path = part_dir / f"{table}.jsonl.gz"
            if not path.exists():
                continue
            with gzip.open(path, "rt", encoding="utf-8") as f:
                for line in f:
                    rec = json.loads(line)
                    conn.execute(f"INSERT OR REPLACE INTO {table} ({','.join(rec)}) "
                                 f"VALUES ({','.join('?' * len(rec))})", list(rec.values()))
        conn.commit()
    print(f"{len(parts)} delen teruggezet; `crawl` gaat verder met de rest")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    sub = p.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("enqueue")
    e.add_argument("--newest", action="store_true", help="nieuwste albums eerst")
    a = sub.add_parser("add")
    a.add_argument("codes", nargs="+")
    pr = sub.add_parser("prioritize", help="albums vóór de rest ophalen (codes, .txt of .xlsx)")
    pr.add_argument("items", nargs="+")
    pr.add_argument("--priority", type=int,
                    help="voorrangsniveau (hoger gaat eerst); standaard boven alle bestaande lijsten")
    c = sub.add_parser("crawl")
    c.add_argument("--limit", type=int)
    c.add_argument("--workers", type=int, default=1)
    c.add_argument("--delay", type=float, default=1.0, help="pauze per worker na elke pagina (s)")
    c.add_argument("--retry-errors", action="store_true")
    sub.add_parser("reparse")
    sub.add_parser("status")
    x = sub.add_parser("export", help="nieuwe albums sinds de vorige export naar een nieuw deel")
    x.add_argument("--out", type=Path, default=HERE / "exports")
    r = sub.add_parser("restore", help="alle export-delen terugzetten in de database")
    r.add_argument("--in", dest="in_dir", type=Path, default=HERE / "exports")
    args = p.parse_args(argv)

    conn = connect(args.db)
    if args.cmd == "enqueue":
        order = "release_year DESC NULLS LAST, date_published DESC" if args.newest else "code"
        # E-albums zijn niet openbaar op de website (HTTP 403) en worden overgeslagen.
        n = conn.execute(f"INSERT OR IGNORE INTO scrape_queue (album_code) "
                         f"SELECT code FROM albums WHERE code NOT IN "
                         f"(SELECT album_code FROM album_media WHERE media_code = 'Ealbum') "
                         f"ORDER BY {order}").rowcount
        conn.commit()
        print(f"{n} albums toegevoegd aan de wachtrij")
    elif args.cmd == "add":
        n = sum(conn.execute("INSERT OR REPLACE INTO scrape_queue (album_code) VALUES (?)",
                             (c.strip().upper(),)).rowcount for c in args.codes)
        conn.commit()
        print(f"{n} albums in de wachtrij")
    elif args.cmd == "prioritize":
        codes = read_codes(args.items)
        top = args.priority or (conn.execute("SELECT MAX(priority) FROM scrape_queue").fetchone()[0] or 0) + 1
        conn.executemany("INSERT OR IGNORE INTO scrape_queue (album_code) VALUES (?)", [(c,) for c in codes])
        conn.executemany("UPDATE scrape_queue SET priority = ? WHERE album_code = ?", [(top, c) for c in codes])
        conn.commit()
        pending = conn.execute("SELECT COUNT(*) FROM scrape_queue WHERE priority = ? AND status = 'pending'",
                               (top,)).fetchone()[0]
        print(f"{len(codes)} albums met voorrang {top}; {pending} nog op te halen "
              f"(herstart een lopende crawl om ze direct mee te nemen)")
    elif args.cmd == "crawl":
        if args.retry_errors:
            conn.execute("UPDATE scrape_queue SET status='pending' WHERE status='error'")
        crawl(conn, args.limit, args.workers, args.delay)
    elif args.cmd == "reparse":
        reparse(conn)
    elif args.cmd == "export":
        export(conn, args.out)
    elif args.cmd == "restore":
        restore(conn, args.in_dir)
    elif args.cmd == "status":
        for s, n in conn.execute("SELECT status, COUNT(*) FROM scrape_queue GROUP BY status"):
            print(f"{s:<8} {n:>8}")
        for t in ("album_pages", "tracks", "track_performers", "works", "work_composers", "album_articles"):
            print(f"{t:<17} {conn.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]:>9}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Bouw een SQLite-database uit de volledige Linked Open Data-dump van Muziekweb.

    python muziekweb_import.py download          # ~420 MB N-Triples (gz) naar data/
    python muziekweb_import.py load              # dump -> tabel `triples` (staging)
    python muziekweb_import.py build             # triples -> albums, artiesten, genres, ...
    python muziekweb_import.py all               # alle drie achter elkaar
    python muziekweb_import.py export-csv albums.csv

Bron: https://data.muziekweb.nl/MuziekwebOrganization/Muziekweb (licentie ODC-By).
"""
from __future__ import annotations

import argparse
import csv
import gzip
import re
import sqlite3
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
DUMP_URL = "https://api.data.muziekweb.nl/datasets/MuziekwebOrganization/Muziekweb/download.nt.gz"
DEFAULT_DUMP = HERE / "data" / "muziekweb.nt.gz"
DEFAULT_DB = HERE / "muziekweb.db"
BUILD_SQL = HERE / "build.sql"

# IRI's worden ingekort om ruimte te sparen; `Link/`-IRI's worden kale codes (bv. JE29798).
LINK = "https://data.muziekweb.nl/Link/"
PREFIXES = [
    ("https://data.muziekweb.nl/vocab/", "mw:"),
    ("http://schema.org/", "schema:"),
    ("https://schema.org/", "schema:"),
    ("http://www.w3.org/2000/01/rdf-schema#", "rdfs:"),
    ("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "rdf:"),
    ("http://www.w3.org/2004/02/skos/core#", "skos:"),
    ("http://www.w3.org/2002/07/owl#", "owl:"),
    ("http://www.w3.org/2001/XMLSchema#", "xsd:"),
]

TRIPLE_RE = re.compile(r'^(<[^>]*>|_:\S+)\s+<([^>]*)>\s+(.+?)\s*\.\s*$')
LITERAL_RE = re.compile(r'^"(.*)"(?:@([A-Za-z0-9-]+)|\^\^<([^>]*)>)?$', re.S)
ESCAPE_RE = re.compile(r'\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)')
ESCAPES = {"t": "\t", "b": "\b", "n": "\n", "r": "\r", "f": "\f", '"': '"', "'": "'", "\\": "\\"}


def shorten(iri: str) -> str:
    if iri.startswith(LINK):
        return iri[len(LINK):]
    for full, short in PREFIXES:
        if iri.startswith(full):
            return short + iri[len(full):]
    return iri


def _unescape(m: re.Match) -> str:
    e = m.group(1)
    if e[0] in "uU":
        return chr(int(e[1:], 16))
    return ESCAPES.get(e, e)


def parse_line(line: str):
    """N-Triples-regel -> (s, p, o, is_iri, lang) of None."""
    m = TRIPLE_RE.match(line)
    if not m:
        return None
    s, p, o = m.groups()
    s = shorten(s[1:-1]) if s[0] == "<" else s
    p = shorten(p)
    if o[0] == "<":
        return s, p, shorten(o[1:-1]), 1, None
    if o.startswith("_:"):
        return s, p, o, 1, None
    lm = LITERAL_RE.match(o)
    if not lm:
        return None
    value = ESCAPE_RE.sub(_unescape, lm.group(1)) if "\\" in lm.group(1) else lm.group(1)
    return s, p, value, 0, (lm.group(2) or "").lower() or None


# --------------------------------------------------------------------------- stappen

def download(dump: Path) -> None:
    dump.parent.mkdir(parents=True, exist_ok=True)
    tmp = dump.with_suffix(".part")
    with requests.get(DUMP_URL, stream=True, timeout=120) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                done += len(chunk)
                if total:
                    print(f"\r  {done / 1e6:.0f}/{total / 1e6:.0f} MB", end="", file=sys.stderr)
    print(file=sys.stderr)
    tmp.replace(dump)
    print(f"gedownload: {dump}")


def connect(db: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db)
    conn.execute("PRAGMA journal_mode = OFF")
    conn.execute("PRAGMA synchronous = OFF")
    conn.execute("PRAGMA temp_store = MEMORY")
    conn.execute("PRAGMA cache_size = -1000000")
    return conn


def load(conn: sqlite3.Connection, dump: Path, batch: int = 200_000) -> None:
    conn.executescript("""
        DROP TABLE IF EXISTS triples;
        CREATE TABLE triples (s TEXT NOT NULL, p TEXT NOT NULL, o TEXT NOT NULL,
                              is_iri INTEGER NOT NULL, lang TEXT);
    """)
    t0, n, bad, rows = time.time(), 0, 0, []
    with gzip.open(dump, "rt", encoding="utf-8") as f:
        for line in f:
            if not line.strip() or line.startswith("#"):
                continue
            t = parse_line(line)
            if t is None:
                bad += 1
                continue
            rows.append(t)
            if len(rows) >= batch:
                conn.executemany("INSERT INTO triples VALUES (?,?,?,?,?)", rows)
                n += len(rows)
                rows.clear()
                print(f"\r  {n / 1e6:.1f} M triples ({time.time() - t0:.0f}s)", end="", file=sys.stderr)
    conn.executemany("INSERT INTO triples VALUES (?,?,?,?,?)", rows)
    n += len(rows)
    print(file=sys.stderr)
    print("  indexen aanmaken ...", file=sys.stderr)
    conn.execute("CREATE INDEX idx_triples_ps ON triples(p, s)")
    conn.commit()
    print(f"{n} triples geladen ({bad} onleesbare regels overgeslagen) in {time.time() - t0:.0f}s")


def build(conn: sqlite3.Connection, keep_triples: bool) -> None:
    t0 = time.time()
    conn.executescript(BUILD_SQL.read_text(encoding="utf-8"))
    if not keep_triples:
        conn.executescript("DROP TABLE triples;")
        conn.commit()
        conn.execute("VACUUM")
    conn.commit()
    print(f"database opgebouwd in {time.time() - t0:.0f}s")
    for table in ("albums", "performers", "album_performers", "genres", "album_genres",
                  "labels", "album_releases", "external_links", "same_as", "relations"):
        print(f"  {table:<18} {conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]:>10}")


def export_csv(conn: sqlite3.Connection, path: str) -> None:
    cur = conn.execute("SELECT * FROM album_overview ORDER BY code")
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([d[0] for d in cur.description])
        w.writerows(cur)
    print(f"geëxporteerd naar {path}")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", type=Path, default=DEFAULT_DB)
    p.add_argument("--dump", type=Path, default=DEFAULT_DUMP)
    p.add_argument("--keep-triples", action="store_true",
                   help="bewaar de ruwe triples-tabel na build (database wordt veel groter)")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("download", "load", "build", "all"):
        sub.add_parser(name)
    e = sub.add_parser("export-csv")
    e.add_argument("path")
    args = p.parse_args(argv)

    if args.cmd in ("download", "all"):
        download(args.dump)
    if args.cmd == "download":
        return
    conn = connect(args.db)
    if args.cmd in ("load", "all"):
        load(conn, args.dump)
    if args.cmd in ("build", "all"):
        build(conn, args.keep_triples)
    if args.cmd == "export-csv":
        export_csv(conn, args.path)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Importeer albums uit de Linked Open Data van Muziekweb (data.muziekweb.nl) in SQLite.

Werkwijze:
    python muziekweb_lod.py inspect                    # welke klassen zijn er (met aantallen)?
    python muziekweb_lod.py inspect --class <IRI>      # welke eigenschappen heeft die klasse?
    python muziekweb_lod.py harvest [--class <IRI>]    # haal alle albums op (hervatbaar)
    python muziekweb_lod.py build                      # vul albums/artiesten/genres/labels
    python muziekweb_lod.py export-csv albums.csv

Zonder --class kiest `harvest` automatisch de klasse met "Album" in de naam die de meeste
instanties heeft. De ruwe triples worden bewaard, dus `build` kan zonder nieuwe download
opnieuw draaien als de koppeling van eigenschappen (FIELD_MAP) wordt aangepast.
"""
from __future__ import annotations

import argparse
import csv
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ENDPOINTS = [
    # TriplyDB-API; de tweede is de pagina die je in de browser ziet.
    "https://api.data.muziekweb.nl/datasets/MuziekwebOrganization/Muziekweb/services/Muziekweb/sparql",
    "https://data.muziekweb.nl/MuziekwebOrganization/Muziekweb/sparql/Muziekweb",
]
DEFAULT_DB = "muziekweb.db"
SCHEMA_PATH = Path(__file__).with_name("schema.sql")
USER_AGENT = "fonos-muziekweb-lod/1.0 (+contact: hthiry@beeldengeluid.nl)"

CATALOG_RE = re.compile(r"\b([A-Z]{2,4}\d{4,})\b")
LABEL_PREDICATES = [
    "http://schema.org/name",
    "https://schema.org/name",
    "http://www.w3.org/2000/01/rdf-schema#label",
    "http://www.w3.org/2004/02/skos/core#prefLabel",
    "http://xmlns.com/foaf/0.1/name",
]

# Koppeling van albumvelden aan lokale namen van predicaten (deel na de laatste / of #),
# hoofdletterongevoelig, in volgorde van voorkeur. Pas aan na `inspect --class`.
FIELD_MAP: dict[str, list[str]] = {
    "title": ["name", "title", "label", "preflabel", "alternatename"],
    "catalog_nr": ["catalognumber", "cataloguenumber", "catalogusnummer", "identifier", "sku", "productid"],
    "product": ["musicreleaseformat", "productformat", "format", "carrier", "medium", "producttype"],
    "barcode": ["gtin13", "gtin", "gtin12", "gtin14", "ean", "barcode", "upc"],
    "release_date": ["datepublished", "releasedate", "issued", "date", "datecreated", "copyrightyear", "year"],
    "duration": ["duration", "totalduration", "playingtime", "speelduur"],
    "description": ["description", "abstract", "comment", "review", "text"],
    "image_url": ["image", "thumbnailurl", "depiction", "thumbnail", "cover"],
    "muziekweb_url": ["url", "mainentityofpage", "sameas", "page", "homepage"],
}
# Velden die naar andere entiteiten verwijzen (objecten zijn IRI's met een naam).
ARTIST_PREDICATES = ["byartist", "performer", "artist", "creator", "contributor", "composer",
                     "conductor", "maincontributor", "performedby"]
GENRE_PREDICATES = ["genre", "style", "subject", "about"]
LABEL_ORG_PREDICATES = ["recordlabel", "publisher", "label", "brand", "manufacturer"]

LANG_PREFERENCE = {"nl": 0, "": 1, "en": 2}


# --------------------------------------------------------------------------- SPARQL

class Sparql:
    def __init__(self, endpoint: str | None = None, delay: float = 0.5):
        self.endpoints = [endpoint] if endpoint else list(ENDPOINTS)
        self.delay = delay
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": USER_AGENT,
            "Accept": "application/sparql-results+json",
        })

    def select(self, query: str, retries: int = 4) -> list[dict]:
        last_exc: Exception | None = None
        for attempt in range(retries):
            endpoint = self.endpoints[0]
            try:
                resp = self.session.post(endpoint, data={"query": query}, timeout=120)
                if resp.status_code in (429, 502, 503, 504):
                    raise requests.HTTPError(f"HTTP {resp.status_code}", response=resp)
                resp.raise_for_status()
                rows = resp.json()["results"]["bindings"]
                time.sleep(self.delay)
                return rows
            except (requests.RequestException, ValueError, KeyError) as exc:
                last_exc = exc
                status = getattr(getattr(exc, "response", None), "status_code", None)
                if len(self.endpoints) > 1 and status in (None, 400, 404, 405, 406, 415):
                    # Endpoint lijkt niet te kloppen: probeer het volgende.
                    print(f"  endpoint {endpoint} werkt niet ({exc}), volgende proberen", file=sys.stderr)
                    self.endpoints.pop(0)
                    continue
                wait = 5 * 2 ** attempt
                print(f"  fout ({exc}), opnieuw over {wait}s", file=sys.stderr)
                time.sleep(wait)
        raise RuntimeError(f"SPARQL-query mislukt: {last_exc}")


def _iri(s: str) -> str:
    return "<" + s.replace(">", "%3E") + ">"


def list_classes(sp: Sparql, limit: int = 50) -> list[tuple[str, int]]:
    rows = sp.select(f"""
        SELECT ?c (COUNT(?s) AS ?n) WHERE {{ ?s a ?c }}
        GROUP BY ?c ORDER BY DESC(?n) LIMIT {limit}""")
    return [(r["c"]["value"], int(r["n"]["value"])) for r in rows]


def list_predicates(sp: Sparql, class_iri: str, sample: int = 2000) -> list[tuple[str, int, str]]:
    rows = sp.select(f"""
        SELECT ?p (COUNT(*) AS ?n) (SAMPLE(?o) AS ?ex) WHERE {{
          {{ SELECT ?s WHERE {{ ?s a {_iri(class_iri)} }} LIMIT {sample} }}
          ?s ?p ?o
        }} GROUP BY ?p ORDER BY DESC(?n)""")
    return [(r["p"]["value"], int(r["n"]["value"]), r.get("ex", {}).get("value", "")) for r in rows]


def detect_album_class(sp: Sparql) -> str:
    classes = list_classes(sp, limit=200)
    albums = [(c, n) for c, n in classes if "album" in local_name(c)]
    if not albums:
        raise SystemExit("Geen klasse met 'Album' in de naam gevonden; geef --class op (zie `inspect`).")
    # Voorkeur voor het eigen vocabulaire van Muziekweb boven schema.org bij gelijke orde.
    albums.sort(key=lambda cn: (-cn[1], "muziekweb" not in cn[0]))
    print(f"albumklasse: {albums[0][0]} ({albums[0][1]} stuks)")
    return albums[0][0]


# --------------------------------------------------------------------------- harvest

def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch_triples(sp: Sparql, subjects: list[str]) -> list[tuple]:
    values = " ".join(_iri(s) for s in subjects)
    label_values = " ".join(_iri(p) for p in LABEL_PREDICATES)
    rows = sp.select(f"""
        SELECT ?s ?p ?o ?olabel WHERE {{
          VALUES ?s {{ {values} }}
          ?s ?p ?o .
          OPTIONAL {{ VALUES ?lp {{ {label_values} }} ?o ?lp ?olabel . }}
        }}""")
    out = []
    for r in rows:
        o = r["o"]
        lab = r.get("olabel")
        out.append((
            r["s"]["value"], r["p"]["value"], o["value"], o["type"].replace("typed-literal", "literal"),
            o.get("xml:lang"), o.get("datatype"),
            lab["value"] if lab else "",
        ))
    return out


def harvest(conn: sqlite3.Connection, sp: Sparql, class_iri: str, page: int, chunk: int,
            limit: int | None) -> None:
    conn.execute("INSERT OR IGNORE INTO harvest_state (class_iri) VALUES (?)", (class_iri,))
    offset, done = conn.execute(
        "SELECT offset, done FROM harvest_state WHERE class_iri = ?", (class_iri,)).fetchone()
    if done:
        print("al volledig opgehaald (gebruik --restart om opnieuw te beginnen)")
        return
    fetched = 0
    while limit is None or fetched < limit:
        n = page if limit is None else min(page, limit - fetched)
        rows = sp.select(f"""
            SELECT ?s WHERE {{ ?s a {_iri(class_iri)} }} ORDER BY ?s LIMIT {n} OFFSET {offset}""")
        subjects = [r["s"]["value"] for r in rows if r["s"]["type"] == "uri"]
        for i in range(0, len(subjects), chunk):
            triples = fetch_triples(sp, subjects[i:i + chunk])
            conn.executemany("INSERT OR IGNORE INTO triples VALUES (?,?,?,?,?,?,?)", triples)
        offset += len(rows)
        fetched += len(rows)
        finished = len(rows) < n
        conn.execute("UPDATE harvest_state SET offset=?, done=?, updated_at=? WHERE class_iri=?",
                     (offset, int(finished), _now(), class_iri))
        conn.commit()
        print(f"  {offset} albums opgehaald")
        if finished:
            print("klaar")
            break


# --------------------------------------------------------------------------- build

def local_name(iri: str) -> str:
    return re.split(r"[/#]", iri.rstrip("/#"))[-1].lower()


def _pick(values: list[tuple], wanted: list[str]):
    """Kies de beste waarde: eerst volgorde in `wanted`, dan taalvoorkeur."""
    best, best_key = None, None
    for v in values:
        ln = local_name(v["p"])
        if ln not in wanted:
            continue
        key = (wanted.index(ln), LANG_PREFERENCE.get(v["lang"] or "", 3))
        if best_key is None or key < best_key:
            best, best_key = v, key
    return best


def _display(v) -> str:
    """Leesbare waarde: label van een IRI-object, anders het object zelf."""
    return v["o_label"] or v["o"]


def parse_year(text: str | None) -> int | None:
    if not text:
        return None
    m = re.search(r"\b(1[89]\d\d|20\d\d)\b", text)
    return int(m.group(1)) if m else None


def parse_duration(text: str | None) -> int | None:
    if not text:
        return None
    text = text.strip()
    m = re.fullmatch(r"P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", text, re.I)
    if m and any(m.groups()):
        h, mi, s = m.groups()
        return int(h or 0) * 3600 + int(mi or 0) * 60 + int(float(s or 0))
    m = re.fullmatch(r"(?:(\d+):)?(\d{1,2}):(\d{2})", text)
    if m:
        return int(m.group(1) or 0) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
    if re.fullmatch(r"\d+", text):
        return int(text)
    return None


def _get_or_create(conn, table: str, name: str, iri: str | None) -> int:
    if iri:
        row = conn.execute(f"SELECT id FROM {table} WHERE iri = ?", (iri,)).fetchone()
        if row:
            return row[0]
    if table != "artists":
        row = conn.execute(f"SELECT id FROM {table} WHERE name = ?", (name,)).fetchone()
        if row:
            return row[0]
    return conn.execute(f"INSERT INTO {table} (name, iri) VALUES (?, ?)", (name, iri)).lastrowid


def build(conn: sqlite3.Connection) -> int:
    conn.row_factory = sqlite3.Row
    conn.executescript("DELETE FROM album_artists; DELETE FROM album_genres; DELETE FROM albums;")
    count = 0
    current, values = None, []

    def flush():
        nonlocal count
        if current is not None:
            save_album(conn, current, values)
            count += 1

    for row in conn.execute("SELECT * FROM triples ORDER BY s").fetchall():
        if row["s"] != current:
            flush()
            current, values = row["s"], []
        values.append(row)
    flush()
    conn.commit()
    conn.row_factory = None
    return count


def save_album(conn: sqlite3.Connection, iri: str, values: list) -> None:
    rec = {}
    for field, preds in FIELD_MAP.items():
        v = _pick(values, preds)
        rec[field] = _display(v) if v else None
    # Catalogusnummer: uit een eigenschap, anders uit de IRI zelf.
    cat = rec["catalog_nr"]
    m = CATALOG_RE.search(cat or "") or CATALOG_RE.search(iri)
    rec["catalog_nr"] = m.group(1) if m else cat

    label_id = None
    for v in values:
        if local_name(v["p"]) in LABEL_ORG_PREDICATES and v["o_type"] == "uri":
            label_id = _get_or_create(conn, "labels", _display(v), v["o"])
            break

    conn.execute(
        """INSERT OR REPLACE INTO albums
           (iri, catalog_nr, title, product, label_id, barcode, release_date, release_year,
            duration, duration_seconds, description, image_url, muziekweb_url)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (iri, rec["catalog_nr"], rec["title"], rec["product"], label_id, rec["barcode"],
         rec["release_date"], parse_year(rec["release_date"]), rec["duration"],
         parse_duration(rec["duration"]), rec["description"], rec["image_url"], rec["muziekweb_url"]),
    )
    seen = set()
    for v in values:
        ln = local_name(v["p"])
        if (v["o"], ln) in seen:
            continue
        seen.add((v["o"], ln))
        if ln in ARTIST_PREDICATES:
            aid = _get_or_create(conn, "artists", _display(v), v["o"] if v["o_type"] == "uri" else None)
            conn.execute("INSERT OR IGNORE INTO album_artists VALUES (?,?,?)", (iri, aid, ln))
        elif ln in GENRE_PREDICATES:
            gid = _get_or_create(conn, "genres", _display(v), v["o"] if v["o_type"] == "uri" else None)
            conn.execute("INSERT OR IGNORE INTO album_genres VALUES (?,?)", (iri, gid))


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
    p.add_argument("--endpoint", help="SPARQL-endpoint (standaard: Muziekweb op TriplyDB)")
    p.add_argument("--delay", type=float, default=0.5, help="seconden tussen queries")
    sub = p.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("inspect")
    i.add_argument("--class", dest="class_iri")
    h = sub.add_parser("harvest")
    h.add_argument("--class", dest="class_iri")
    h.add_argument("--page", type=int, default=1000, help="albums per pagina")
    h.add_argument("--chunk", type=int, default=50, help="albums per triple-query")
    h.add_argument("--limit", type=int, help="maximaal aantal albums (om te testen)")
    h.add_argument("--restart", action="store_true")
    sub.add_parser("build")
    e = sub.add_parser("export-csv")
    e.add_argument("path")
    args = p.parse_args(argv)

    conn = connect(args.db)
    if args.cmd in ("inspect", "harvest"):
        sp = Sparql(args.endpoint, args.delay)
    if args.cmd == "inspect":
        if args.class_iri:
            for pred, n, ex in list_predicates(sp, args.class_iri):
                print(f"{n:>7}  {pred}\n           bv. {ex[:100]}")
        else:
            for c, n in list_classes(sp):
                print(f"{n:>10}  {c}")
    elif args.cmd == "harvest":
        class_iri = args.class_iri or detect_album_class(sp)
        if args.restart:
            conn.execute("DELETE FROM harvest_state WHERE class_iri = ?", (class_iri,))
        harvest(conn, sp, class_iri, args.page, args.chunk, args.limit)
        print(f"{build(conn)} albums in de database (build)")
    elif args.cmd == "build":
        print(f"{build(conn)} albums in de database")
    elif args.cmd == "export-csv":
        export_csv(conn, args.path)


if __name__ == "__main__":
    main()

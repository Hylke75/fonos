#!/usr/bin/env python3
"""Controleer en verrijk muziekweb.db met een catalogusexport (Excel-XML, één rij per album
met TRACKNUMMER 0 en één rij per track).

    python collectie/catalogus_import.py "Hylke export 06102026 v1.xml" [--db muziekweb.db] [--dry-run]

Wat het doet:
  * slaat de export op in eigen tabellen (catalogus_albums, catalogus_bestelinfo,
    catalogus_tracks), plus album_credits (artiesten zoals in de export) en album_keywords;
  * vult en corrigeert in `albums`: titel, releasedatum/-jaar, dragerbeschrijving, aantal
    schijven en totale speelduur, waar de export afwijkt of de database leeg is;
  * vult ontbrekende trackspeelduren en voegt 'zie ook'-koppelingen toe aan `relations`;
  * legt elke wijziging vast in `wijzigingen` (tabel, sleutel, veld, oud, nieuw), zodat alles
    na te lopen en terug te draaien is.

Opnieuw draaien is veilig: alleen echte verschillen worden gewijzigd en gelogd.
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SS = "urn:schemas-microsoft-com:office:spreadsheet"
NULL = "\\N"

SCHEMA = """
CREATE TABLE IF NOT EXISTS catalogus_albums (
    album_code  TEXT PRIMARY KEY,
    titel_id    TEXT,
    titel       TEXT,
    artiesten   TEXT,
    eigenaar    TEXT,
    uitgebracht TEXT,
    medium      TEXT,
    schijven    INTEGER,
    speelduur   INTEGER,
    zie_ook     TEXT,
    spotify     TEXT,
    trefwoorden TEXT,
    bronbestand TEXT
);
CREATE TABLE IF NOT EXISTS catalogus_bestelinfo (
    album_code TEXT NOT NULL,
    titel_id   TEXT,
    eigenaar   TEXT,
    label      TEXT,
    nummer     TEXT,
    PRIMARY KEY (album_code, titel_id, label, nummer)
);
CREATE TABLE IF NOT EXISTS catalogus_tracks (
    track_id         TEXT PRIMARY KEY,
    album_code       TEXT NOT NULL,
    titel_id         TEXT,
    tracknummer      INTEGER,
    titel            TEXT,
    artiesten        TEXT,
    speelduur        INTEGER,
    eigenaar         TEXT,
    digitale_lokatie TEXT
);
CREATE INDEX IF NOT EXISTS idx_catalogus_tracks_album ON catalogus_tracks(album_code);
CREATE TABLE IF NOT EXISTS album_credits (          -- artiesten per album zoals in de catalogus
    album_code TEXT NOT NULL,
    position   INTEGER NOT NULL,
    name       TEXT NOT NULL,                       -- bv. "Beethoven, Ludwig van"
    years      TEXT,                                -- bv. "1770-1827"
    roles      TEXT,                                -- bv. "componist, piano"
    PRIMARY KEY (album_code, position)
);
CREATE TABLE IF NOT EXISTS album_keywords (
    album_code TEXT NOT NULL,
    keyword    TEXT NOT NULL,
    PRIMARY KEY (album_code, keyword)
);
CREATE TABLE IF NOT EXISTS wijzigingen (
    id      INTEGER PRIMARY KEY,
    tabel   TEXT NOT NULL,
    sleutel TEXT NOT NULL,
    veld    TEXT NOT NULL,
    oud     TEXT,
    nieuw   TEXT,
    bron    TEXT,
    datum   TEXT
);
"""

CREDIT_RE = re.compile(r"^(?P<name>.*?)\s*(?:\((?P<years>[^()]*\d[^()]*)\))?\s*(?:\[(?P<roles>[^\]]*)\])?\s*$")


def val(v):
    return None if v in (None, "", NULL) else v.strip()


def read_rows(path: Path) -> list[dict]:
    rows, header = [], None
    for _, el in ET.iterparse(path):
        if el.tag != f"{{{SS}}}Row":
            continue
        cells = []
        for c in el.findall(f"{{{SS}}}Cell"):
            idx = c.get(f"{{{SS}}}Index")
            while idx and len(cells) < int(idx) - 1:
                cells.append(None)
            d = c.find(f"{{{SS}}}Data")
            cells.append(d.text if d is not None else None)
        el.clear()
        if header is None:
            header = cells
        else:
            rows.append(dict(zip(header, cells)))
    return rows


def norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def secs(v) -> int | None:
    v = val(v)
    return int(float(v)) if v and float(v) > 0 else None


def hms(s: int) -> str:
    return f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("xml", type=Path)
    p.add_argument("--db", type=Path, default=HERE.parent / "muziekweb.db")
    p.add_argument("--dry-run", action="store_true", help="alleen tellen, niets opslaan")
    args = p.parse_args()

    rows = read_rows(args.xml)
    bron = args.xml.name
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    conn = sqlite3.connect(args.db, timeout=60)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)

    albums = [r for r in rows if val(r.get("TRACKNUMMER")) in ("0", None)]
    tracks = [r for r in rows if val(r.get("TRACKNUMMER")) not in ("0", None)]
    first: dict[str, dict] = {}
    for r in albums:
        first.setdefault(r["TITELNUMMER"], r)

    # ---- 1. export opslaan
    for code, r in first.items():
        conn.execute("INSERT OR REPLACE INTO catalogus_albums VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (
            code, val(r["TITEL_ID"]), val(r["TITELALBUM/TRACK"]), val(r["ARTIEST"]), val(r["TITEL_EIGENAARCODE"]),
            (val(r["Uitgebracht"]) or "")[:10] or None, val(r["MEDIUM_OMSCHRIJVING"]),
            int(float(r["AANTAL_SCHIJVEN"])) if val(r["AANTAL_SCHIJVEN"]) else None, secs(r["SPEELDUUR_IN_SECONDEN"]),
            val(r["ZIE_OOK_ALBUM_TITELNUMMER"]), val(r["Spotify Link"]), val(r["trefwoorden"]), bron))
        conn.execute("DELETE FROM album_credits WHERE album_code = ?", (code,))
        for i, part in enumerate(x for x in (val(r["ARTIEST"]) or "").split(";") if x.strip()):
            m = CREDIT_RE.match(part.strip())
            conn.execute("INSERT INTO album_credits VALUES (?,?,?,?,?)",
                         (code, i, m["name"] or part.strip(), m["years"], m["roles"]))
        conn.execute("DELETE FROM album_keywords WHERE album_code = ?", (code,))
        for kw in (val(r["trefwoorden"]) or "").split(","):
            if kw.strip():
                conn.execute("INSERT OR IGNORE INTO album_keywords VALUES (?,?)", (code, kw.strip()))
    for r in albums:
        if val(r["Bestel-info label"]) or val(r["Bestel-info nummer"]):
            conn.execute("INSERT OR IGNORE INTO catalogus_bestelinfo VALUES (?,?,?,?,?)", (
                r["TITELNUMMER"], val(r["TITEL_ID"]), val(r["TITEL_EIGENAARCODE"]),
                val(r["Bestel-info label"]), val(r["Bestel-info nummer"])))
    for r in tracks:
        conn.execute("INSERT OR REPLACE INTO catalogus_tracks VALUES (?,?,?,?,?,?,?,?,?)", (
            val(r["TITELNUMMERTRACK"]) or f"{r['TITELNUMMER']}-{int(float(r['TRACKNUMMER'])):04d}",
            r["TITELNUMMER"], val(r["TITEL_ID"]), int(float(r["TRACKNUMMER"])), val(r["TITELALBUM/TRACK"]),
            val(r["ARTIEST"]), secs(r["SPEELDUUR_IN_SECONDEN"]), val(r["TITEL_EIGENAARCODE"]),
            val(r["DIGITALE_LOKATIE"])))

    # ---- 2. albums vullen en corrigeren
    changes = 0

    def change(table, key_col, key, field, old, new):
        nonlocal changes
        conn.execute(f"UPDATE {table} SET {field} = ? WHERE {key_col} = ?", (new, key))
        conn.execute("INSERT INTO wijzigingen (tabel, sleutel, veld, oud, nieuw, bron, datum) "
                     "VALUES (?,?,?,?,?,?,?)", (table, key, field, None if old is None else str(old),
                                                None if new is None else str(new), bron, now))
        changes += 1

    for code, r in first.items():
        a = conn.execute("SELECT * FROM albums WHERE code = ?", (code,)).fetchone()
        if a is None:
            continue
        title = norm(val(r["TITELALBUM/TRACK"]))
        if title and norm(a["title"]).lower() != title.lower():
            change("albums", "code", code, "title", a["title"], title)
        date = (val(r["Uitgebracht"]) or "")[:10]
        # De export slaat een los jaartal op als JJJJ-01-01: dat is geen correctie op een
        # preciezere datum in hetzelfde jaar.
        year_only = date.endswith("-01-01")
        same_year = (a["date_published"] or "")[:4] == date[:4]
        if date and not date.startswith("0001") and a["date_published"] != date \
                and not (year_only and same_year):
            change("albums", "code", code, "date_published", a["date_published"], date)
            year = int(date[:4])
            if 1850 <= year <= 2100 and a["release_year"] != year:
                change("albums", "code", code, "release_year", a["release_year"], year)
        medium = norm(val(r["MEDIUM_OMSCHRIJVING"]))
        if medium and norm(a["media_description"]).lower() != medium.lower():
            change("albums", "code", code, "media_description", a["media_description"], medium)
        discs = int(float(r["AANTAL_SCHIJVEN"])) if val(r["AANTAL_SCHIJVEN"]) else None
        if discs and a["number_of_discs"] != discs:
            change("albums", "code", code, "number_of_discs", a["number_of_discs"], discs)
        dur = secs(r["SPEELDUUR_IN_SECONDEN"])
        if dur and a["duration_seconds"] != dur:
            change("albums", "code", code, "duration_seconds", a["duration_seconds"], dur)
            change("albums", "code", code, "duration", a["duration"], hms(dur))
        see = val(r["ZIE_OOK_ALBUM_TITELNUMMER"])
        if see and not conn.execute("SELECT 1 FROM relations WHERE subject_code=? AND object_code=?",
                                    (code, see)).fetchone():
            conn.execute("INSERT OR IGNORE INTO relations VALUES (?, 'seeAlso', ?)", (code, see))
            conn.execute("INSERT INTO wijzigingen (tabel, sleutel, veld, oud, nieuw, bron, datum) "
                         "VALUES ('relations', ?, 'seeAlso', NULL, ?, ?, ?)", (code, see, bron, now))
            changes += 1

    # ---- 3. trackspeelduren aanvullen
    for r in tracks:
        tid, dur = val(r["TITELNUMMERTRACK"]), secs(r["SPEELDUUR_IN_SECONDEN"])
        if not tid or not dur:
            continue
        t = conn.execute("SELECT duration_seconds, duration FROM tracks WHERE track_id = ?", (tid,)).fetchone()
        if t is not None and t["duration_seconds"] is None:
            change("tracks", "track_id", tid, "duration_seconds", None, dur)
            change("tracks", "track_id", tid, "duration", t["duration"], f"{dur // 60}:{dur % 60:02d}")

    # Losse execute-aanroepen: executescript zou de openstaande transactie al committen.
    conn.execute("DROP VIEW IF EXISTS album_overview_compleet")
    conn.execute("""
        CREATE VIEW album_overview_compleet AS
        SELECT o.*,
               (SELECT group_concat(name, '; ') FROM album_credits c WHERE c.album_code = o.code) AS credits,
               (SELECT group_concat(keyword, ', ') FROM album_keywords k WHERE k.album_code = o.code) AS keywords
          FROM album_overview o""")
    if args.dry_run:
        conn.rollback()
    else:
        conn.commit()
    print(f"{len(rows)} rijen gelezen: {len(first)} albums, {len(tracks)} tracks")
    print(f"{changes} wijzigingen{' (dry-run, niet opgeslagen)' if args.dry_run else ''}")
    if not args.dry_run:
        for veld, n in conn.execute("SELECT tabel || '.' || veld, COUNT(*) FROM wijzigingen WHERE datum = ? "
                                    "GROUP BY 1 ORDER BY 2 DESC", (now,)):
            print(f"  {veld:<28} {n:>6}")


if __name__ == "__main__":
    main()

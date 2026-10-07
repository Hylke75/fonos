#!/usr/bin/env python3
"""Bouw de definitieve, opgeschoonde database uit de werkdatabase.

    python collectie/schoon.py --src muziekweb.db --out fonotheek.db

De werkdatabase bevat dezelfde gegevens uit drie bronnen (open data, website, catalogus-
export) naast elkaar, plus procestabellen. Dit script voegt ze samen tot één schema zonder
dubbele of lege velden. Voorrang bij verschillen: catalogusexport > website > open data.

Invoer naast de werkdatabase: collectie/gebruikscollectie.csv (objectnummers per lijst).
"""
from __future__ import annotations

import argparse
import csv
import html
import re
import sqlite3
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent

SCHEMA = """
PRAGMA foreign_keys = OFF;

CREATE TABLE collectie_items (              -- fysieke exemplaren uit de gebruikscollectie
    objectnummer TEXT NOT NULL,
    titelnummer  TEXT,                      -- album-code; leeg als de lijst er geen noemt
    lijst        TEXT NOT NULL,             -- Klassiek | Populair
    PRIMARY KEY (objectnummer, titelnummer, lijst)
);

CREATE TABLE albums (
    code                 TEXT PRIMARY KEY,  -- Muziekweb-titelnummer, bv. AA00052
    titel_id             TEXT,              -- id in de catalogusexport
    title                TEXT,
    media_description    TEXT,              -- bv. "1 lp", "2 lp's"
    number_of_discs      INTEGER,
    release_date         TEXT,              -- JJJJ, JJJJ-MM of JJJJ-MM-DD
    release_year         INTEGER,
    released_before_1988 INTEGER NOT NULL DEFAULT 0,  -- Muziekweb: "voor 1988", jaar onbekend
    duration_seconds     INTEGER,
    recording            TEXT,              -- opname-informatie
    description          TEXT,              -- toelichting
    description_author   TEXT,
    remark               TEXT,              -- opmerking bij deze titel
    avg_rating           REAL,
    rating_count         INTEGER,
    object_available     INTEGER,
    possible_to_digitize INTEGER,
    is_popular           INTEGER NOT NULL,
    is_classical         INTEGER NOT NULL,
    is_collection        INTEGER NOT NULL,
    is_best_of           INTEGER NOT NULL,
    is_soundtrack        INTEGER NOT NULL,
    cover_url            TEXT,
    back_cover_url       TEXT
);

CREATE TABLE labels (
    code       TEXT PRIMARY KEY,
    name       TEXT,
    short_name TEXT
);

CREATE TABLE album_releases (               -- bestel-informatie
    album_code   TEXT NOT NULL REFERENCES albums(code),
    label_code   TEXT REFERENCES labels(code),
    label_number TEXT,
    ean          TEXT,
    supplier     TEXT
);

CREATE TABLE performers (
    code         TEXT PRIMARY KEY,          -- bv. M00000057644
    name         TEXT,
    sort_name    TEXT,
    description  TEXT,
    begin_year   INTEGER,
    end_year     INTEGER,
    is_person    INTEGER NOT NULL DEFAULT 0,
    is_group     INTEGER NOT NULL DEFAULT 0,
    is_composer  INTEGER NOT NULL DEFAULT 0,
    is_classical INTEGER NOT NULL DEFAULT 0,
    is_popular   INTEGER NOT NULL DEFAULT 0,
    is_important INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE album_performers (            -- hoofdartiesten zoals boven aan de albumpagina
    album_code     TEXT NOT NULL REFERENCES albums(code),
    position       INTEGER NOT NULL,
    performer_code TEXT NOT NULL REFERENCES performers(code),
    PRIMARY KEY (album_code, performer_code)
) WITHOUT ROWID;

CREATE TABLE album_credits (                -- artiesten zoals in de catalogusexport
    album_code TEXT NOT NULL REFERENCES albums(code),
    position   INTEGER NOT NULL,
    name       TEXT NOT NULL,
    years      TEXT,
    roles      TEXT,
    PRIMARY KEY (album_code, position)
) WITHOUT ROWID;

CREATE TABLE performer_aliases (
    performer_code TEXT NOT NULL REFERENCES performers(code),
    alias          TEXT NOT NULL,
    PRIMARY KEY (performer_code, alias)
) WITHOUT ROWID;

CREATE TABLE performer_keywords (
    performer_code TEXT NOT NULL REFERENCES performers(code),
    keyword        TEXT NOT NULL,
    PRIMARY KEY (performer_code, keyword)
) WITHOUT ROWID;

CREATE TABLE genres (
    code           TEXT PRIMARY KEY,
    kind           TEXT NOT NULL,           -- hoofdgenre | stijl | categorie
    name_nl        TEXT,
    name_en        TEXT,
    name_de        TEXT,
    name_fr        TEXT,
    description_nl TEXT,
    broader_code   TEXT REFERENCES genres(code)
);

CREATE TABLE album_genres (
    album_code TEXT NOT NULL REFERENCES albums(code),
    genre_code TEXT NOT NULL REFERENCES genres(code),
    PRIMARY KEY (album_code, genre_code)
) WITHOUT ROWID;

CREATE TABLE album_keywords (               -- trefwoorden uit de catalogusexport
    album_code TEXT NOT NULL REFERENCES albums(code),
    keyword    TEXT NOT NULL,
    PRIMARY KEY (album_code, keyword)
) WITHOUT ROWID;

CREATE TABLE media_types (
    code TEXT PRIMARY KEY,                  -- CD, LP, Digital, FLAC, ...
    name TEXT
);

CREATE TABLE album_media (
    album_code TEXT NOT NULL REFERENCES albums(code),
    kind       TEXT NOT NULL,               -- drager | digitaal
    media_code TEXT NOT NULL REFERENCES media_types(code),
    PRIMARY KEY (album_code, kind, media_code)
) WITHOUT ROWID;

CREATE TABLE works (                        -- liedjes en composities
    code  TEXT PRIMARY KEY,
    title TEXT,
    kind  TEXT                              -- POPULAR | CLASSICAL
);

CREATE TABLE work_composers (
    work_code      TEXT NOT NULL REFERENCES works(code),
    performer_code TEXT NOT NULL REFERENCES performers(code),
    PRIMARY KEY (work_code, performer_code)
) WITHOUT ROWID;

CREATE TABLE work_alt_titles (
    work_code TEXT NOT NULL REFERENCES works(code),
    title     TEXT NOT NULL,
    PRIMARY KEY (work_code, title)
) WITHOUT ROWID;

CREATE TABLE tracks (
    track_id         TEXT PRIMARY KEY,      -- bv. AA00036-0001
    album_code       TEXT NOT NULL REFERENCES albums(code),
    position         INTEGER,
    title            TEXT,
    duration_seconds INTEGER,
    work_code        TEXT REFERENCES works(code),
    spotify_url      TEXT
);

CREATE TABLE track_performers (
    track_id       TEXT NOT NULL REFERENCES tracks(track_id),
    position       INTEGER NOT NULL,
    performer_code TEXT REFERENCES performers(code),
    name           TEXT,                    -- alleen als er geen performer_code is
    role           TEXT,
    PRIMARY KEY (track_id, position)
) WITHOUT ROWID;

CREATE TABLE articles (                     -- artikelen op muziekweb.nl
    code  TEXT PRIMARY KEY,                 -- bv. B00000000593
    title TEXT,
    url   TEXT
);

CREATE TABLE album_articles (
    album_code   TEXT NOT NULL REFERENCES albums(code),
    article_code TEXT NOT NULL REFERENCES articles(code),
    PRIMARY KEY (album_code, article_code)
) WITHOUT ROWID;

CREATE TABLE external_links (               -- Spotify, Allmusic, Wikipedia, ...
    subject_code TEXT NOT NULL,             -- album- of uitvoerende-code
    provider     TEXT,
    url          TEXT NOT NULL,
    PRIMARY KEY (subject_code, url)
) WITHOUT ROWID;

CREATE TABLE same_as (                      -- Discogs, MusicBrainz, Wikidata, AllMusic
    subject_code TEXT NOT NULL,
    source       TEXT,
    url          TEXT NOT NULL,
    PRIMARY KEY (subject_code, url)
) WITHOUT ROWID;

CREATE TABLE relations (                    -- verwante albums/uitvoerenden
    subject_code TEXT NOT NULL,
    relation     TEXT NOT NULL,             -- related | seeAlso | contemporary | influencedBy
    object_code  TEXT NOT NULL,
    PRIMARY KEY (subject_code, relation, object_code)
) WITHOUT ROWID;
"""

INDEXES = """
CREATE INDEX idx_collectie_titelnummer ON collectie_items(titelnummer);
CREATE INDEX idx_albums_title          ON albums(title);
CREATE INDEX idx_albums_year           ON albums(release_year);
CREATE INDEX idx_releases_album        ON album_releases(album_code);
CREATE INDEX idx_releases_label        ON album_releases(label_code);
CREATE INDEX idx_releases_ean          ON album_releases(ean);
CREATE INDEX idx_album_performers_perf ON album_performers(performer_code);
CREATE INDEX idx_performers_name       ON performers(name);
CREATE INDEX idx_album_genres_genre    ON album_genres(genre_code);
CREATE INDEX idx_tracks_album          ON tracks(album_code);
CREATE INDEX idx_tracks_work           ON tracks(work_code);
CREATE INDEX idx_track_performers_perf ON track_performers(performer_code);
CREATE INDEX idx_album_articles_art    ON album_articles(article_code);
CREATE INDEX idx_relations_object      ON relations(object_code);

CREATE VIEW album_overview AS
SELECT a.code,
       a.title,
       (SELECT group_concat(name, ', ') FROM (SELECT p.name FROM album_performers ap
          JOIN performers p ON p.code = ap.performer_code WHERE ap.album_code = a.code ORDER BY ap.position)) AS performers,
       (SELECT group_concat(name, '; ') FROM (SELECT name FROM album_credits c
          WHERE c.album_code = a.code ORDER BY c.position)) AS credits,
       (SELECT group_concat(DISTINCT l.name) FROM album_releases r
          JOIN labels l ON l.code = r.label_code WHERE r.album_code = a.code) AS labels,
       (SELECT group_concat(DISTINCT r.label_number) FROM album_releases r WHERE r.album_code = a.code) AS label_numbers,
       (SELECT group_concat(g.name_nl, ', ') FROM album_genres ag JOIN genres g ON g.code = ag.genre_code
         WHERE ag.album_code = a.code AND g.kind = 'stijl') AS styles,
       (SELECT group_concat(keyword, ', ') FROM album_keywords k WHERE k.album_code = a.code) AS keywords,
       a.media_description,
       COALESCE(a.release_date, CASE WHEN a.released_before_1988 THEN 'voor 1988' END) AS released,
       a.duration_seconds,
       (SELECT COUNT(*) FROM tracks t WHERE t.album_code = a.code) AS track_count,
       (SELECT group_concat(DISTINCT lijst) FROM collectie_items ci WHERE ci.titelnummer = a.code) AS lijsten,
       'https://www.muziekweb.nl/Link/' || a.code AS url,
       a.cover_url
  FROM albums a;
"""

MONTHS = {m: i for i, m in enumerate(["januari", "februari", "maart", "april", "mei", "juni", "juli",
                                     "augustus", "september", "oktober", "november", "december"], 1)}


def partial_date(iso: str | None) -> str | None:
    """'1968-01-01' -> '1968', '1972-06-01' -> '1972-06'; '0001…' -> None."""
    if not iso or iso.startswith("0001"):
        return None
    y, m, d = (iso.split("-") + ["01", "01"])[:3]
    if m == "01" and d == "01":
        return y
    return f"{y}-{m}" if d == "01" else f"{y}-{m}-{d}"


def page_date(date_published: str | None, release_text: str | None) -> tuple[str | None, int]:
    """Website: microdata '2026-09' / '1976', of tekst 'voor 1988' / 'Juli 1989'."""
    if release_text and release_text.strip().lower() == "voor 1988":
        return None, 1
    dp = (date_published or "").strip()
    if re.fullmatch(r"\d{4}(-\d{2}){0,2}", dp) and not dp.startswith("0001"):
        return dp, 0
    m = re.fullmatch(r"([a-z]+)\s+(\d{4})", (release_text or "").strip().lower())
    if m and m.group(1) in MONTHS:
        return f"{m.group(2)}-{MONTHS[m.group(1)]:02d}", 0
    return None, 0


def seconds(text: str | None) -> int | None:
    parts = (text or "").strip().split(":")
    if not text or not all(p.isdigit() for p in parts):
        return None
    s = 0
    for p in parts:
        s = s * 60 + int(p)
    return s or None


def norm_number(s: str | None) -> str:
    return re.sub(r"[\s.\-/]+", "", (s or "").lower())


def build(src: Path, out: Path, collectie_csv: Path) -> None:
    if out.exists():
        out.unlink()
    dst = sqlite3.connect(out)
    dst.executescript(SCHEMA)
    dst.execute("ATTACH DATABASE ? AS w", (str(src),))
    q = dst.execute

    # --- collectie
    rows = set()
    with open(collectie_csv, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            lijst = "Klassiek" if "Klassiek" in r["bron"] else "Populair"
            rows.add((r["objectnummer"], r["titelnummer"] or None, lijst))
    with_code = {(o, l) for o, t, l in rows if t}
    rows = [(o, t, l) for o, t, l in rows if t or (o, l) not in with_code]  # dubbele regels zonder titelnummer weg
    dst.executemany("INSERT OR IGNORE INTO collectie_items VALUES (?,?,?)", rows)

    # --- albums: open data als basis, website en catalogus gaan voor
    lod = {r[0]: r for r in q("SELECT code, title, media_description, number_of_discs, date_published, "
                              "duration_seconds, object_available, possible_to_digitize, is_popular, is_classical, "
                              "is_collection, is_best_of, is_soundtrack, cover_url FROM w.albums")}
    page = {r[0]: r for r in q("SELECT album_code, title, product, date_published, release_text, recording, "
                               "playtime, avg_rating, rating_count, description, description_author, remark, "
                               "cover_url, back_cover_url FROM w.album_pages")}
    cat = {r[0]: r for r in q("SELECT album_code, titel_id, uitgebracht FROM w.catalogus_albums")}
    in_lists = {r[0] for r in q("SELECT DISTINCT titelnummer FROM collectie_items WHERE titelnummer IS NOT NULL")}
    for code in sorted(in_lists & (set(lod) | set(page))):
        L, P, C = lod.get(code), page.get(code), cat.get(code)
        if C:  # Klassiek: catalogus (al verwerkt in w.albums door catalogus_import.py)
            title = L[1] if L and L[1] else (P[1] if P else None)
            date, before = partial_date((C[2] or "")[:10]), 0
        else:
            title = (P[1] if P and P[1] else None) or (L[1] if L else None)
            date, before = page_date(P[3], P[4]) if P else (None, 0)
            if not date and not before and L:
                date = partial_date(L[4])
        year = int(date[:4]) if date and 1850 <= int(date[:4]) <= 2100 else None
        q("INSERT INTO albums VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
            code, C[1] if C else None, title,
            (L[2] if L else None) or (P[2] if P else None), L[3] if L else None,
            date, year, before,
            (L[5] if L else None) or (seconds(P[6]) if P else None),
            P[5] if P else None, P[9] if P else None, P[10] if P else None, P[11] if P else None,
            P[7] if P else None, P[8] if P and P[8] else None,
            L[6] if L else None, L[7] if L else None,
            *(L[8:13] if L else (0, 0, 0, 0, 0)),
            (P[12] if P else None) or (L[13] if L else None), P[13] if P else None))

    # --- labels en bestel-info (open data + website + catalogus, ontdubbeld)
    q("INSERT INTO labels SELECT code, name, short_name FROM w.labels")
    q("""INSERT OR IGNORE INTO labels (code, name)
         SELECT label_code, MAX(label_name) FROM w.album_page_labels WHERE label_code IS NOT NULL GROUP BY label_code""")
    seen = set()

    def add_release(album, label, number, ean=None, supplier=None):
        key = (album, label, norm_number(number))
        if key in seen or not (label or number):
            return
        seen.add(key)
        q("INSERT INTO album_releases VALUES (?,?,?,?,?)", (album, label, number, ean, supplier))

    for r in q("SELECT r.album_code, r.label_code, r.label_number, r.ean, r.offered_by FROM w.album_releases r "
               "JOIN albums a ON a.code = r.album_code").fetchall():
        for number in (r[2] or "").split("; ") or [None]:  # open data voegt meerdere nummers samen
            add_release(r[0], r[1], number or None, r[3], r[4])
    for r in q("SELECT p.album_code, p.label_code, p.catalog_number FROM w.album_page_labels p "
               "JOIN albums a ON a.code = p.album_code").fetchall():
        add_release(*r)
    label_by_name = {}
    for code, name, short in q("SELECT code, name, short_name FROM labels").fetchall():
        for n in (name, short):
            if n:
                label_by_name.setdefault(n.strip().lower(), code)
    for album, label, number in q("SELECT b.album_code, b.label, b.nummer FROM w.catalogus_bestelinfo b "
                                  "JOIN albums a ON a.code = b.album_code").fetchall():
        add_release(album, label_by_name.get((label or "").strip().lower()), number)

    # --- uitvoerenden: open data + wie alleen op de website voorkomt
    q("""INSERT INTO performers SELECT code, name, sort_name, description, begin_year, end_year, is_person,
         is_group, is_composer, is_classical, is_popular, is_important FROM w.performers""")
    q("""INSERT OR IGNORE INTO performers (code, name)
         SELECT performer_code, MAX(name) FROM (
             SELECT performer_code, name FROM w.track_performers WHERE performer_code IS NOT NULL
             UNION ALL SELECT performer_code, name FROM w.work_composers)
         GROUP BY performer_code""")
    q("UPDATE performers SET is_composer = 1 WHERE code IN (SELECT performer_code FROM w.work_composers)")
    # Hoofdartiesten: van de huidige albumpagina (met volgorde); open data alleen als die er geen heeft.
    header = re.compile(r'<h1 class="cat-albumtitle".*?</h1>\s*<ul class="cat-names-list cat-performers">(.*?)</ul>',
                        re.S)
    item = re.compile(r'<li[^>]*>\s*<a href="[^"]*/Link/(M\d+)[^"]*"[^>]*>\s*<span[^>]*>(.*?)</span>', re.S)
    from_page = set()
    for code, blob in q("SELECT album_code, content_z FROM w.album_pages WHERE content_z IS NOT NULL "
                        "AND album_code IN (SELECT code FROM albums)").fetchall():
        m = header.search(zlib.decompress(blob).decode("utf-8"))
        for pos, (perf, name) in enumerate(item.findall(m.group(1)) if m else []):
            q("INSERT OR IGNORE INTO performers (code, name) VALUES (?, ?)", (perf, html.unescape(name).strip()))
            q("INSERT OR IGNORE INTO album_performers VALUES (?,?,?)", (code, pos, perf))
            from_page.add(code)
    for album, perf in q("SELECT ap.album_code, ap.performer_code FROM w.album_performers ap "
                         "JOIN albums a ON a.code = ap.album_code ORDER BY ap.album_code, ap.performer_code").fetchall():
        if album not in from_page:
            pos = q("SELECT COUNT(*) FROM album_performers WHERE album_code = ?", (album,)).fetchone()[0]
            q("INSERT OR IGNORE INTO album_performers VALUES (?,?,?)", (album, pos, perf))
    q("""INSERT INTO album_credits SELECT c.* FROM w.album_credits c JOIN albums a ON a.code = c.album_code""")
    q("INSERT INTO performer_aliases SELECT * FROM w.performer_aliases")
    q("INSERT INTO performer_keywords SELECT * FROM w.performer_keywords")

    # --- genres, trefwoorden, dragers
    q("INSERT INTO genres SELECT * FROM w.genres")
    q("""INSERT OR IGNORE INTO album_genres
         SELECT album_code, genre_code FROM w.album_genres WHERE album_code IN (SELECT code FROM albums)
         UNION SELECT album_code, genre_code FROM w.album_page_genres WHERE album_code IN (SELECT code FROM albums)""")
    q("INSERT INTO album_keywords SELECT k.* FROM w.album_keywords k JOIN albums a ON a.code = k.album_code")
    q("INSERT INTO media_types SELECT * FROM w.media_types")
    q("INSERT INTO album_media SELECT m.* FROM w.album_media m JOIN albums a ON a.code = m.album_code")

    # --- werken en tracks
    q("""INSERT INTO tracks SELECT t.track_id, t.album_code, t.position, t.title, t.duration_seconds,
         t.work_code, t.spotify_url FROM w.tracks t JOIN albums a ON a.code = t.album_code""")
    q("INSERT INTO works SELECT * FROM w.works WHERE code IN (SELECT work_code FROM tracks)")
    q("INSERT INTO work_composers SELECT work_code, performer_code FROM w.work_composers "
      "WHERE work_code IN (SELECT code FROM works)")
    q("INSERT INTO work_alt_titles SELECT * FROM w.work_alt_titles WHERE work_code IN (SELECT code FROM works)")
    q("""INSERT INTO track_performers
         SELECT tp.track_id, tp.position, tp.performer_code,
                CASE WHEN tp.performer_code IS NULL THEN tp.name END, tp.role
           FROM w.track_performers tp JOIN tracks t ON t.track_id = tp.track_id""")

    # --- artikelen (genormaliseerd), links, relaties
    for album, url, title in q("SELECT aa.album_code, aa.url, aa.title FROM w.album_articles aa "
                               "JOIN albums a ON a.code = aa.album_code").fetchall():
        m = re.search(r"/Link/([A-Z0-9]+)", url)
        code = m.group(1) if m else url
        q("INSERT OR IGNORE INTO articles VALUES (?,?,?)", (code, title, url))
        q("INSERT OR IGNORE INTO album_articles VALUES (?,?)", (album, code))
    keep = "(SELECT code FROM albums UNION SELECT code FROM performers)"
    q(f"INSERT OR IGNORE INTO external_links SELECT subject_code, provider, url FROM w.external_links "
      f"WHERE subject_code IN {keep}")
    q(f"INSERT INTO same_as SELECT * FROM w.same_as WHERE subject_code IN {keep}")
    q(f"INSERT INTO relations SELECT * FROM w.relations WHERE subject_code IN {keep}")

    dst.commit()
    dst.execute("DETACH DATABASE w")
    dst.executescript(INDEXES)
    dst.execute("VACUUM")
    dst.close()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--src", type=Path, default=HERE.parent / "muziekweb.db")
    p.add_argument("--out", type=Path, default=HERE.parent / "fonotheek.db")
    p.add_argument("--collectie", type=Path, default=HERE / "gebruikscollectie.csv")
    args = p.parse_args()
    build(args.src, args.out, args.collectie)
    conn = sqlite3.connect(args.out)
    for (t,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        print(f"{t:<20} {conn.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]:>8}")
    print(f"{args.out}: {args.out.stat().st_size / 1e6:.0f} MB")


if __name__ == "__main__":
    main()

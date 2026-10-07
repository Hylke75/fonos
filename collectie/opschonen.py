#!/usr/bin/env python3
"""Beperk muziekweb.db tot de albums van de gebruikscollectie-lijsten.

Bewaard worden de albums met voorrang (scrape_queue.priority > 0, gezet met
`muziekweb_scrape.py prioritize`), plus alles wat daaraan hangt: uitvoerenden, labels,
releases, tracks, werken, componisten en koppelingen. Genres en dragertypes (kleine
opzoektabellen) blijven volledig. Alle andere albums en hun gegevens worden verwijderd.

    python collectie/opschonen.py [--db muziekweb.db]

Stop een lopende crawl eerst; daarna draait VACUUM om de ruimte vrij te geven.
"""
from __future__ import annotations

import argparse
import sqlite3
from pathlib import Path

HERE = Path(__file__).resolve().parent

STEPS = [
    # te bewaren albums
    "CREATE TEMP TABLE keep_albums AS SELECT album_code AS code FROM scrape_queue WHERE priority > 0",
    "CREATE UNIQUE INDEX temp.ix_keep_albums ON keep_albums(code)",

    # website-gegevens
    "DELETE FROM scrape_queue WHERE album_code NOT IN (SELECT code FROM keep_albums)",
    "DELETE FROM export_log WHERE album_code NOT IN (SELECT code FROM keep_albums)",
    "DELETE FROM album_pages WHERE album_code NOT IN (SELECT code FROM keep_albums)",
    "DELETE FROM album_page_labels WHERE album_code NOT IN (SELECT code FROM keep_albums)",
    "DELETE FROM album_page_genres WHERE album_code NOT IN (SELECT code FROM keep_albums)",
    "DELETE FROM album_articles WHERE album_code NOT IN (SELECT code FROM keep_albums)",
    "DELETE FROM tracks WHERE album_code NOT IN (SELECT code FROM keep_albums)",
    "DELETE FROM track_performers WHERE track_id NOT IN (SELECT track_id FROM tracks)",
    "DELETE FROM works WHERE code NOT IN (SELECT work_code FROM tracks WHERE work_code IS NOT NULL)",
    "DELETE FROM work_composers WHERE work_code NOT IN (SELECT code FROM works)",
    "DELETE FROM work_alt_titles WHERE work_code NOT IN (SELECT code FROM works)",

    # open data: albums en directe koppelingen
    "DELETE FROM albums WHERE code NOT IN (SELECT code FROM keep_albums)",
    "DELETE FROM album_eans WHERE album_code NOT IN (SELECT code FROM keep_albums)",
    "DELETE FROM album_media WHERE album_code NOT IN (SELECT code FROM keep_albums)",
    "DELETE FROM album_genres WHERE album_code NOT IN (SELECT code FROM keep_albums)",
    "DELETE FROM album_releases WHERE album_code NOT IN (SELECT code FROM keep_albums)",
    "DELETE FROM album_performers WHERE album_code NOT IN (SELECT code FROM keep_albums)",

    # uitvoerenden die nog ergens aan een bewaard album hangen
    """CREATE TEMP TABLE keep_performers AS
       SELECT performer_code AS code FROM album_performers
       UNION SELECT performer_code FROM track_performers WHERE performer_code IS NOT NULL
       UNION SELECT performer_code FROM work_composers""",
    "CREATE UNIQUE INDEX temp.ix_keep_performers ON keep_performers(code)",
    "DELETE FROM performers WHERE code NOT IN (SELECT code FROM keep_performers)",
    "DELETE FROM performer_keywords WHERE performer_code NOT IN (SELECT code FROM performers)",
    "DELETE FROM performer_aliases WHERE performer_code NOT IN (SELECT code FROM performers)",
    "DELETE FROM labels WHERE code NOT IN (SELECT label_code FROM album_releases WHERE label_code IS NOT NULL)",

    # links en relaties: alleen tussen bewaarde albums/uitvoerenden
    """CREATE TEMP TABLE keep_subjects AS
       SELECT code FROM keep_albums UNION SELECT code FROM keep_performers""",
    "CREATE UNIQUE INDEX temp.ix_keep_subjects ON keep_subjects(code)",
    "DELETE FROM external_links WHERE subject_code NOT IN (SELECT code FROM keep_subjects)",
    "DELETE FROM same_as WHERE subject_code NOT IN (SELECT code FROM keep_subjects)",
    """DELETE FROM relations WHERE subject_code NOT IN (SELECT code FROM keep_subjects)
                                OR object_code NOT IN (SELECT code FROM keep_subjects)""",
]

COUNT_TABLES = ["albums", "performers", "album_performers", "album_genres", "labels", "album_releases",
                "external_links", "same_as", "relations", "scrape_queue", "album_pages", "tracks",
                "track_performers", "works", "work_composers"]


def counts(conn: sqlite3.Connection) -> dict[str, int]:
    return {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in COUNT_TABLES}


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", type=Path, default=HERE.parent / "muziekweb.db")
    args = p.parse_args()

    conn = sqlite3.connect(args.db, timeout=60)
    if not conn.execute("SELECT COUNT(*) FROM scrape_queue WHERE priority > 0").fetchone()[0]:
        raise SystemExit("Geen albums met voorrang gevonden; draai eerst `muziekweb_scrape.py prioritize`.")
    before = counts(conn)
    conn.execute("CREATE TABLE IF NOT EXISTS export_log (album_code TEXT PRIMARY KEY, part INTEGER NOT NULL)")
    for sql in STEPS:
        conn.execute(sql)
    conn.commit()
    after = counts(conn)
    for t in COUNT_TABLES:
        print(f"{t:<18} {before[t]:>10} -> {after[t]:>9}")
    conn.execute("VACUUM")
    conn.close()
    print(f"database nu {args.db.stat().st_size / 1e9:.2f} GB")


if __name__ == "__main__":
    main()

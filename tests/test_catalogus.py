import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
H = ["TITEL_ID", "TITELNUMMER", "TITELALBUM/TRACK", "ARTIEST", "TITEL_EIGENAARCODE", "TRACKNUMMER",
     "TITELNUMMERTRACK", "ZIE_OOK_ALBUM_TITELNUMMER", "DIGITALE_LOKATIE", "SPEELDUUR_IN_SECONDEN", "Uitgebracht",
     "MEDIUM_OMSCHRIJVING", "AANTAL_SCHIJVEN", "Spotify Link", "Bestel-info label", "Bestel-info nummer", "trefwoorden"]


def xml(rows):
    def row(vals):
        return "<ss:Row>" + "".join(f'<ss:Cell><Data ss:Type="String">{v}</Data></ss:Cell>' if v is not None
                                    else "<ss:Cell/>" for v in vals) + "</ss:Row>"
    return ('<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" '
            'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Sheet1"><ss:Table>'
            + "".join(row(r) for r in [H] + rows) + "</ss:Table></Worksheet></Workbook>")


def test_catalogus_import(tmp_path):
    db = tmp_path / "t.db"
    c = sqlite3.connect(db)
    c.executescript((ROOT / "build.sql").read_text().split("-- Hulptabel")[0])  # alleen DROPs
    c.executescript("""
        CREATE TABLE albums (code TEXT PRIMARY KEY, title TEXT, media_description TEXT, number_of_discs INTEGER,
            date_published TEXT, release_year INTEGER, duration_seconds INTEGER, duration TEXT);
        CREATE TABLE tracks (track_id TEXT PRIMARY KEY, album_code TEXT, duration_seconds INTEGER, duration TEXT);
        CREATE TABLE relations (subject_code TEXT, relation TEXT, object_code TEXT,
            PRIMARY KEY (subject_code, relation, object_code));
        CREATE VIEW album_overview AS SELECT code, title FROM albums;
        INSERT INTO albums VALUES ('AF00858', 'Suites no 1-4/new ph.o/dorati', '3 lp''s', 3, '1988-07-01', 1988, NULL, NULL);
        INSERT INTO albums VALUES ('AA00036', 'Symphony nr 29', '1 lp', 1, '1988-06-01', 1988, 3570, '0:59:30');
        INSERT INTO tracks VALUES ('AF00858-0001', 'AF00858', NULL, NULL);
    """)
    c.commit()
    path = tmp_path / "export.xml"
    path.write_text(xml([
        ["1", "AF00858", "Suite no. 1", "Tsjaikovski, Pjotr Iljitsj (1840-1893) [componist];Dorati, Antal",
         "DISCOGS", "0", None, "AAX11127", None, "2600", "1968-01-01T00:00:00.000", "1 lp", "1", None,
         "Mercury", "SR 90000", "Suite, Erfgoed"],
        ["2", "AF00858", "Suite no. 1 / Introduzione", "Dorati, Antal", "DISCOGS", "1", "AF00858-0001",
         None, None, "300", "1968-01-01T00:00:00.000", "1 lp", "1", None, "\\N", "\\N", "\\N"],
        ["3", "AA00036", "Symphony  nr 29", "Haydn, Joseph", "DISCOGS", "0", None, None, None, "0",
         "1988-01-01T00:00:00.000", "1 lp", "1", None, "Iramac", "6508", None],
    ]), encoding="utf-8")
    for _ in range(2):  # tweede keer: geen nieuwe wijzigingen
        subprocess.run([sys.executable, str(ROOT / "collectie/catalogus_import.py"), str(path), "--db", str(db)],
                       check=True, capture_output=True)
    c = sqlite3.connect(db)
    assert c.execute("SELECT title, media_description, number_of_discs, date_published, release_year, "
                     "duration_seconds, duration FROM albums WHERE code='AF00858'").fetchone() == \
        ("Suite no. 1", "1 lp", 1, "1968-01-01", 1968, 2600, "0:43:20")
    # zelfde jaar en alleen witruimte-verschil in titel: ongemoeid
    assert c.execute("SELECT title, date_published FROM albums WHERE code='AA00036'").fetchone() == \
        ("Symphony nr 29", "1988-06-01")
    assert c.execute("SELECT duration_seconds, duration FROM tracks").fetchone() == (300, "5:00")
    assert c.execute("SELECT * FROM relations").fetchall() == [("AF00858", "seeAlso", "AAX11127")]
    assert c.execute("SELECT name, years, roles FROM album_credits WHERE album_code='AF00858' ORDER BY position"
                     ).fetchall() == [("Tsjaikovski, Pjotr Iljitsj", "1840-1893", "componist"), ("Dorati, Antal", None, None)]
    assert {r[0] for r in c.execute("SELECT keyword FROM album_keywords")} == {"Suite", "Erfgoed"}
    assert c.execute("SELECT COUNT(*) FROM wijzigingen").fetchone()[0] == 10
    assert c.execute("SELECT label, nummer FROM catalogus_bestelinfo WHERE album_code='AA00036'").fetchone() == ("Iramac", "6508")

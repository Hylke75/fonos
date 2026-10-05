import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import muziekweb_scraper as mw  # noqa: E402

FIXTURE = Path(__file__).with_name("fixtures") / "JK278043.html"


def test_parse_album():
    a = mw.parse_album(FIXTURE.read_text(encoding="utf-8"), "https://www.muziekweb.nl/Link/JK278043")
    assert a.catalog_nr == "JK278043"
    assert a.title == "Hope is the thing with feathers"
    assert a.artists[0][0] == "Rhiannon Giddens"
    assert a.product == "1 compact disc"
    assert a.label == "Nonesuch Records"
    assert a.barcode == "075597891942"
    assert a.genres == ["Pop", "Americana", "Folk"]
    assert a.object_status == "Uitgeleend, wel te reserveren"
    assert (a.release_year, a.release_month) == (2026, 9)
    assert a.duration_seconds == 38 * 60 + 3
    assert a.avg_rating is None and a.rating_count == 0
    assert a.is_tip
    assert a.description.startswith("Een prachtig folk album")
    assert not a.description.endswith("meer")
    assert a.cover_url.endswith("/images/cover/JK278043.jpg")
    assert a.back_cover_url.endswith("/images/back/JK278043.jpg")


def test_save_album_roundtrip(tmp_path):
    conn = mw.connect(str(tmp_path / "t.db"))
    a = mw.parse_album(FIXTURE.read_text(encoding="utf-8"), "https://www.muziekweb.nl/Link/JK278043")
    mw.save_album(conn, a)
    mw.save_album(conn, a)  # idempotent
    row = conn.execute("SELECT title, artists, label, genres FROM album_overview").fetchall()
    assert row == [("Hope is the thing with feathers", "Rhiannon Giddens", "Nonesuch Records", "Pop, Americana, Folk")]

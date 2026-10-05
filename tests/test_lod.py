import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import muziekweb_lod as mw  # noqa: E402

S = "http://schema.org/"
ALBUM = "https://data.muziekweb.nl/Link/JK278043"
CLASS = "https://data.muziekweb.nl/vocab/Album"


def lit(v, lang=None):
    d = {"type": "literal", "value": v}
    if lang:
        d["xml:lang"] = lang
    return d


def uri(v):
    return {"type": "uri", "value": v}


TRIPLES = [
    (S + "name", lit("Hope is the thing with feathers")),
    (S + "byArtist", uri("https://data.muziekweb.nl/Link/M00000162538"), "Rhiannon Giddens"),
    (S + "recordLabel", uri("https://data.muziekweb.nl/Label/Nonesuch"), "Nonesuch Records"),
    (S + "gtin13", lit("075597891942")),
    (S + "genre", uri("https://data.muziekweb.nl/Genre/Folk"), "Folk"),
    (S + "genre", uri("https://data.muziekweb.nl/Genre/Americana"), "Americana"),
    (S + "datePublished", lit("2026-09")),
    (S + "duration", lit("PT38M3S")),
    (S + "description", lit("A beautiful folk album", "en")),
    (S + "description", lit("Een prachtig folk album", "nl")),
    (S + "musicReleaseFormat", lit("1 compact disc")),
]


class FakeSparql:
    def select(self, query):
        if "OFFSET 0" in query:
            return [{"s": uri(ALBUM)}]
        if "OFFSET" in query:
            return []
        rows = []
        for t in TRIPLES:
            r = {"s": uri(ALBUM), "p": uri(t[0]), "o": t[1]}
            if len(t) == 3:
                r["olabel"] = lit(t[2])
            rows.append(r)
        return rows


def test_harvest_and_build(tmp_path):
    conn = mw.connect(str(tmp_path / "t.db"))
    mw.harvest(conn, FakeSparql(), CLASS, page=10, chunk=5, limit=None)
    assert conn.execute("SELECT done, offset FROM harvest_state").fetchone() == (1, 1)
    assert mw.build(conn) == 1
    row = conn.execute(
        "SELECT catalog_nr, title, artists, label, barcode, genres, product, release_year, description "
        "FROM album_overview").fetchone()
    assert row[:5] == ("JK278043", "Hope is the thing with feathers", "Rhiannon Giddens",
                       "Nonesuch Records", "075597891942")
    assert set(row[5].split(", ")) == {"Folk", "Americana"}
    assert row[6:] == ("1 compact disc", 2026, "Een prachtig folk album")
    assert conn.execute("SELECT duration_seconds FROM albums").fetchone()[0] == 38 * 60 + 3
    # build is herhaalbaar
    assert mw.build(conn) == 1
    assert conn.execute("SELECT COUNT(*) FROM genres").fetchone()[0] == 2


def test_parse_duration():
    assert mw.parse_duration("PT1H2M3S") == 3723
    assert mw.parse_duration("0:38:03") == 2283
    assert mw.parse_duration("38:03") == 2283
    assert mw.parse_duration("2283") == 2283
    assert mw.parse_duration("onbekend") is None

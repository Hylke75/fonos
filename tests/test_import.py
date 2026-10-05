import gzip
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import muziekweb_import as mw  # noqa: E402

L = "https://data.muziekweb.nl/Link/"
V = "https://data.muziekweb.nl/vocab/"
S = "http://schema.org/"
RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"
RDFS = "http://www.w3.org/2000/01/rdf-schema#label"
SKOS = "http://www.w3.org/2004/02/skos/core#"

SAMPLE = f"""
<{L}JE29798> <{RDF}> <{V}Album> .
<{L}JE29798> <{RDF}> <{V}PopularAlbum> .
<{L}JE29798> <{RDFS}> "Hypochristmastreefuzz : More Mengelberg"@nl .
<{L}JE29798> <{S}datePublished> "2008-11-28" .
<{L}JE29798> <{S}duration> "2885" .
<{L}JE29798> <{V}ean> "8717306920629" .
<{L}JE29798> <{V}mediaDescription> "1 Compact Disc"@en .
<{L}JE29798> <{V}mediaDescription> "1 compact disc"@nl .
<{L}JE29798> <{V}numberOfDiscs> "1" .
<{L}JE29798> <{V}lending> "false" .
<{L}JE29798> <{V}fullCover> "http://media.cdr.nl/COVER/PICO/FRONT/JE29798.jpg" .
<{L}JE29798> <{V}mediaType> <{L}CD> .
<{L}CD> <{RDFS}> "CD"@en .
<{L}JE29798> <{V}genre> <{L}HFD000000002> .
<{L}JE29798> <{V}genre> <{L}T00000000472> .
<{L}HFD000000002> <{RDF}> <{V}Genre> .
<{L}HFD000000002> <{RDFS}> "Jazz"@nl .
<{L}T00000000472> <{RDF}> <{V}Genre> .
<{L}T00000000472> <{RDFS}> "Neo-bop"@nl .
<{L}T00000000472> <{RDFS}> "N\\u00E9o-bop"@fr .
<{L}T00000000472> <{SKOS}broader> <{L}HFD000000002> .
<{L}JE29798> <{V}performer> <{L}M00000057644> .
<{L}M00000057644> <{RDF}> <http://schema.org/Person> .
<{L}M00000057644> <{SKOS}prefLabel> "Benjamin Herman" .
<{L}M00000057644> <{SKOS}hiddenLabel> "Herman, Benjamin" .
<{L}M00000057644> <{S}keywords> "Saxofoon" .
<{L}JE29798> <{V}orderInformation> <{L}abc123> .
<{L}abc123> <{V}label> <{L}L00000001> .
<{L}abc123> <{V}labelNumber> "DOX062" .
<{L}L00000001> <{RDF}> <{V}Label> .
<{L}L00000001> <{RDFS}> "Dox Records" .
<{L}L00000001> <{RDFS}> "Dox" .
<{L}JE29798> <http://www.w3.org/2002/07/owl#sameAs> <https://www.discogs.com/release/1895824> .
<{L}JE29798> <{V}externalLink> <{L}ext1> .
<{L}ext1> <{V}provider> "Spotify" .
<{L}ext1> <{S}url> "https://open.spotify.com/album/x"^^<http://www.w3.org/2001/XMLSchema#anyURI> .
<{L}ext1> <{RDFS}> "Listen to \\"Hypo\\" on \\"Spotify\\""@nl .
"""


def test_parse_line_literal_escapes():
    s, p, o, is_iri, lang = mw.parse_line(f'<{L}x> <{RDFS}> "a \\"b\\" \\u00E9"@NL .')
    assert (s, p, o, is_iri, lang) == ("x", "rdfs:label", 'a "b" é', 0, "nl")
    assert mw.parse_line(f"<{L}x> <{RDF}> <{V}Album> .") == ("x", "rdf:type", "mw:Album", 1, None)


def test_load_and_build(tmp_path):
    dump = tmp_path / "d.nt.gz"
    with gzip.open(dump, "wt", encoding="utf-8") as f:
        f.write(SAMPLE)
    conn = mw.connect(tmp_path / "t.db")
    mw.load(conn, dump)
    mw.build(conn, keep_triples=False)
    row = conn.execute(
        "SELECT code, title, performers, labels, label_numbers, ean, main_genres, styles, "
        "media_description, release_year, duration FROM album_overview").fetchone()
    assert row == ("JE29798", "Hypochristmastreefuzz : More Mengelberg", "Benjamin Herman",
                   "Dox Records", "DOX062", "8717306920629", "Jazz", "Neo-bop",
                   "1 compact disc", 2008, "0:48:05")
    assert conn.execute("SELECT is_popular, lending, cover_url IS NOT NULL FROM albums").fetchone() == (1, 0, 1)
    assert conn.execute("SELECT name_fr, broader_code FROM genres WHERE code='T00000000472'").fetchone() \
        == ("Néo-bop", "HFD000000002")
    assert conn.execute("SELECT sort_name, is_person FROM performers").fetchone() == ("Herman, Benjamin", 1)
    assert conn.execute("SELECT provider, url FROM external_links").fetchone() \
        == ("Spotify", "https://open.spotify.com/album/x")
    assert conn.execute("SELECT source FROM same_as").fetchone() == ("discogs",)
    assert conn.execute("SELECT name FROM sqlite_master WHERE name='triples'").fetchone() is None

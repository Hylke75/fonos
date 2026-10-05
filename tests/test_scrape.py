import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import muziekweb_scrape as ms  # noqa: E402

# Ingekorte opbouw van echte Muziekweb-albumpagina's (pop, klassiek, verzamelalbum, DVD).
HEAD = """<html><body><div class="widget cat-album-info"><div class="widget-content cat-album-info">
<div class="cat-albumcover"><img src="https://media.cdr.nl/COVER/MEDIUM/FRONT/{c}/x.jpg" itemprop="image">
{tip}<a class="cat-albumcover-showback" href="#">Toon achterzijde</a></div>
<h1 class="cat-albumtitle" itemprop="name">{title}</h1>
<ul class="cat-names-list cat-performers"><li><a href="/Link/M1/POPULAR/X"><span itemprop="name">Artiest</span></a></li></ul>
<div class="cat-product"><span class="cat-label">Product:</span><span>1 compact disc</span></div>
<div class="cat-orderinfo"><span class="cat-label">Bestel-info:</span><ul class="cat-orderinfo"><li>
<a href="/Link/L00000019196/Nonesuch"><span itemprop="recordLabel">Nonesuch Records</span></a>
<span itemprop="catalogNumber">075597891942</span></li></ul></div>
<div class="cat-genres"><span class="cat-label">Genres:</span><ul class="cat-genres">
<li><a href="/Link/T00000000130/Folk"><span itemprop="genre">Folk</span></a></li></ul></div>
<div class="cat-albumrelease"><span class="cat-label">Uitgebracht:</span><span>September 2026</span>
<meta itemprop="datePublished" content="2026-09"></div>
<div class="cat-recording"><span class="cat-label">Opname:</span>1912</div>
<div class="cat-playtime"><span class="cat-label">Totale speelduur:</span>0:38:03</div>
<div class="cat-averagerating"><span class="cat-label">Gemiddeld:</span><span id="AlbumRatingAverage">{rating}</span></div>
</div>
<div class="widget-content cat-album-article"><h3>Toelichting</h3><div><div class="cat-article-text">Een prachtig
album<span class="hellip">&hellip;</span><span class="hidden"> met <a href="/Link/M2">Dirk Powell</a>. (SvdP)</span>
<a href="#" class="cat-info-more">meer</a></div></div></div>
<div class="widget-content cat-remark"><h3>Opmerking bij deze titel</h3><p class="cat-remark">Afspeelapparaat: Edison</p></div>
</div>
<div class="widget cat-album-info cat-tracks" id="album-tracks"><div class="widget-content cat-tracks">
<meta itemprop="numTracks" content="{n}">{tracks}</div></div>
<div class="widget cat-album-info" id="related-articles"><ul class="articles"><li class="article">
<div class="clickable" onclick="$.address.value('/Link/B00000000059/Bluegrass'); return false"><h3>Bluegrass</h3></div>
</li></ul></div></body></html>"""

POP = """<ul class="cat-tracklist"><li itemprop="itemListElement"><meta itemprop="position" content="1">
<div class="cat-track-item" itemprop="item" itemscope itemtype="http://schema.org/MusicRecording">
<meta itemprop="url" content="https://www.muziekweb.nl/Link/JK278043/x?TrackID=JK278043-0001">
<span itemprop="byArtist" itemscope itemtype="http://schema.org/Person"><meta itemprop="name" content="Rhiannon Giddens">
<meta itemprop="url" content="https://www.muziekweb.nl/Link/M00000448475/POPULAR/Rhiannon-Giddens"></span>
<div class="cat-track clickable"><div class="cat-track-number">1</div>
<div class="cat-track-title" itemprop="name"><a href="/Link/U00003169115/POPULAR/Angel-fire-rise">Angel fire rise</a></div>
<div class="cat-track-playtime" itemprop="duration">4:19</div>
<a href="http://play.spotify.com/track/6xQ" class="spotifylink">s</a></div></div></li></ul>"""

COMPILATION = """<ul class="cat-tracklist"><li itemprop="itemListElement"><meta itemprop="position" content="1">
<div class="cat-track-item" itemprop="item" itemscope itemtype="http://schema.org/MusicRecording">
<meta itemprop="url" content="https://www.muziekweb.nl/Link/HAX2728/x?TrackID=HAX2728-0001">
<ul class="cat-names-list cat-performers"><li itemprop="byArtist" itemscope itemtype="http://schema.org/Person">
<a href="/Link/M00000164252/POPULAR/Henk-Krol"><span itemprop="name">Henk Krol</span></a>
<meta itemprop="url" content="https://www.muziekweb.nl/Link/M00000164252/POPULAR/Henk-Krol"></li></ul>
<div class="cat-track clickable"><div class="cat-track-title" itemprop="name">
<a href="/Link/U00001091847/POPULAR/Opening">Opening</a></div>
<div class="cat-track-playtime" itemprop="duration">0:51</div></div></div></li></ul>"""

WORK = """<div class="cat-work-col-title"><div class="cat-worktitle"><a href="/Link/{w}/CLASSICAL/x">{t}</a></div>
<div class="cat-composer"><span class="cat-label">Componist:</span><ul class="cat-names-list cat-composer">
<li><a href="/Link/M00000000007/CLASSICAL/COMPOSER/Abel"><span>Carl Friedrich Abel</span></a></li></ul></div>
<ul class="cat-alternative-titles"><li itemprop="alternativeHeadline">Symfonie, op.1, nr.3</li></ul></div>
<div class="cat-work-col-performers"><ul class="cat-names-list cat-performers">
<li><a href="/Link/M00000288091/CLASSICAL/Willens"><span>Michael Alexander Willens</span></a> <span class="cat-role">(dirigent)</span></li>
<li><a href="/Link/M00000288092/CLASSICAL/Koelner"><span>Kölner Akademie</span></a></li></ul></div>"""

CLASSICAL = """<ul class="cat-worklist"><li><div class="cat-work clickable">""" + WORK.format(
    w="U00002586786", t="Sinfonia voor orkest, op.1, nr.3") + """</div>
<ul class="cat-tracklist"><li itemprop="itemListElement"><meta itemprop="position" content="1">
<div class="cat-track" itemprop="item" itemscope itemtype="http://schema.org/MusicRecording">
<meta itemprop="url" content="https://www.muziekweb.nl/Link/AAX10308/x?TrackID=AAX10308-0001">
<div class="cat-track-title" itemprop="name">Sinfonia deel I
<meta itemprop="byArtist" content="Michael Alexander Willens"></div>
<div class="cat-track-playtime" itemprop="duration">3:10</div></div></li></ul></li></ul>"""

DVD = """<ul class="cat-worklist"><li itemprop="itemListElement"><meta itemprop="position" content="1">
<div class="cat-work clickable" itemprop="item" itemscope itemtype="http://schema.org/MusicRecording">""" + WORK.format(
    w="U00000650478", t="Moon water") + """<div class="cat-track-playtime" itemprop="duration"></div></div></li></ul>"""


def page(code, tracks, n=1, tip="", rating="nog geen waarderingen", title="Titel"):
    return ms.parse_page(HEAD.format(c=code, tip=tip, title=title, rating=rating, n=n, tracks=tracks), code)


def test_album_fields():
    p = page("JK278043", POP, tip='<div class="cat-tip">tip</div>', rating="3,5 (10 waarderingen)",
             title="Hope is the thing with feathers")
    assert p["title"] == "Hope is the thing with feathers"
    assert p["is_tip"] == 1
    assert (p["avg_rating"], p["rating_count"]) == (3.5, 10)
    assert p["release_text"] == "September 2026" and p["date_published"] == "2026-09"
    assert p["playtime"] == "0:38:03" and p["recording"] == "1912" and p["product"] == "1 compact disc"
    assert p["description"] == "Een prachtig album met Dirk Powell. (SvdP)"
    assert p["description_author"] == "SvdP"
    assert p["remark"] == "Afspeelapparaat: Edison"
    assert p["labels"] == [("JK278043", 0, "L00000019196", "Nonesuch Records", "075597891942")]
    assert p["genres"] == [("JK278043", "T00000000130", "Folk")]
    assert p["back_cover_url"] == "https://media.cdr.nl/COVER/MEDIUM/BACK/JK278043/x.jpg"
    assert p["articles"] == [("JK278043", "https://www.muziekweb.nl/Link/B00000000059/Bluegrass", "Bluegrass")]


def test_popular_tracks():
    p = page("JK278043", POP)
    assert p["tracks"] == [("JK278043-0001", "JK278043", 1, "Angel fire rise", "4:19", 259, "U00003169115",
                            "http://play.spotify.com/track/6xQ")]
    assert p["track_performers"] == [("JK278043-0001", 0, "M00000448475", "Rhiannon Giddens", None)]
    assert p["works"] == [("U00003169115", "Angel fire rise", "POPULAR")]


def test_compilation_performer_per_track():
    p = page("HAX2728", COMPILATION)
    assert p["track_performers"] == [("HAX2728-0001", 0, "M00000164252", "Henk Krol", None)]


def test_classical_work_with_composer_and_roles():
    p = page("AAX10308", CLASSICAL)
    assert p["tracks"][0][3:7] == ("Sinfonia deel I", "3:10", 190, "U00002586786")
    assert p["track_performers"] == [
        ("AAX10308-0001", 0, "M00000288091", "Michael Alexander Willens", "dirigent"),
        ("AAX10308-0001", 1, "M00000288092", "Kölner Akademie", None)]
    assert p["composers"] == [("U00002586786", "M00000000007", "Carl Friedrich Abel")]
    assert p["alt_titles"] == [("U00002586786", "Symfonie, op.1, nr.3")]
    assert p["works"] == [("U00002586786", "Sinfonia voor orkest, op.1, nr.3", "CLASSICAL")]


def test_dvd_work_as_track():
    p = page("AED0049", DVD)
    assert p["tracks"] == [("AED0049-0001", "AED0049", 1, "Moon water", None, None, "U00000650478", None)]
    assert len(p["track_performers"]) == 2


def test_save_and_reparse(tmp_path):
    conn = ms.connect(tmp_path / "t.db")
    p = page("AAX10308", CLASSICAL)
    p["url"], p["fetched_at"] = "u", "t"
    ms.save_page(conn, p)
    ms.reparse(conn)
    assert conn.execute("SELECT COUNT(*) FROM tracks").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM track_performers").fetchone()[0] == 2


def test_no_album_page():
    assert ms.parse_page("<html><h1>Niet gevonden</h1></html>", "X") is None

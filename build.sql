-- Bouwt de genormaliseerde tabellen uit de staging-tabel `triples` (zie muziekweb_import.py).
-- Codes zijn de laatste deel van de Muziekweb-IRI, bv. album JE29798 =
-- https://data.muziekweb.nl/Link/JE29798 en https://www.muziekweb.nl/Link/JE29798.

PRAGMA foreign_keys = OFF;

DROP VIEW  IF EXISTS album_overview;
DROP TABLE IF EXISTS album_performers;
DROP TABLE IF EXISTS album_genres;
DROP TABLE IF EXISTS album_media;
DROP TABLE IF EXISTS album_eans;
DROP TABLE IF EXISTS album_releases;
DROP TABLE IF EXISTS external_links;
DROP TABLE IF EXISTS same_as;
DROP TABLE IF EXISTS relations;
DROP TABLE IF EXISTS performer_aliases;
DROP TABLE IF EXISTS performer_keywords;
DROP TABLE IF EXISTS albums;
DROP TABLE IF EXISTS performers;
DROP TABLE IF EXISTS genres;
DROP TABLE IF EXISTS labels;
DROP TABLE IF EXISTS media_types;

-- Hulptabel: beste label per onderwerp (voorkeur nl, dan zonder taal, dan en).
CREATE TEMP TABLE best_label AS
SELECT s, o FROM (
    SELECT s, o, ROW_NUMBER() OVER (
        PARTITION BY s ORDER BY CASE WHEN lang = 'nl' THEN 0 WHEN lang IS NULL THEN 1
                                     WHEN lang = 'en' THEN 2 ELSE 3 END, length(o) DESC) AS rn
      FROM triples WHERE p = 'rdfs:label')
 WHERE rn = 1;
CREATE INDEX temp.idx_best_label ON best_label(s);

CREATE TEMP TABLE album_codes AS
SELECT DISTINCT s AS code FROM triples WHERE p = 'rdf:type' AND o = 'mw:Album';
CREATE UNIQUE INDEX temp.idx_album_codes ON album_codes(code);

-- ---------------------------------------------------------------- opzoektabellen

CREATE TABLE media_types (
    code TEXT PRIMARY KEY,           -- CD, LP, Digital, FLAC, MP3_128, ...
    name TEXT
);
INSERT INTO media_types
SELECT DISTINCT t.o, bl.o
  FROM triples t LEFT JOIN best_label bl ON bl.s = t.o
 WHERE t.p IN ('mw:mediaType', 'mw:digitalMediaFormat');

CREATE TABLE genres (
    code           TEXT PRIMARY KEY,
    kind           TEXT NOT NULL,   -- hoofdgenre (HFD) | stijl (T) | categorie (CAT)
    name_nl        TEXT,
    name_en        TEXT,
    name_de        TEXT,
    name_fr        TEXT,
    description_nl TEXT,
    broader_code   TEXT REFERENCES genres(code)
);
INSERT INTO genres
SELECT g.s,
       CASE WHEN g.s LIKE 'HFD%' THEN 'hoofdgenre' WHEN g.s LIKE 'CAT%' THEN 'categorie' ELSE 'stijl' END,
       (SELECT o FROM triples WHERE p = 'rdfs:label' AND s = g.s AND lang = 'nl'),
       (SELECT o FROM triples WHERE p = 'rdfs:label' AND s = g.s AND lang = 'en'),
       (SELECT o FROM triples WHERE p = 'rdfs:label' AND s = g.s AND lang = 'de'),
       (SELECT o FROM triples WHERE p = 'rdfs:label' AND s = g.s AND lang = 'fr'),
       (SELECT o FROM triples WHERE p = 'rdfs:comment' AND s = g.s AND lang = 'nl'),
       (SELECT MIN(o) FROM triples WHERE p = 'skos:broader' AND s = g.s)
  FROM (SELECT DISTINCT s FROM triples WHERE p = 'rdf:type' AND o = 'mw:Genre') g;

CREATE TABLE labels (
    code       TEXT PRIMARY KEY,     -- bv. L00000002222
    name       TEXT,                 -- bv. Decca Records
    short_name TEXT                  -- bv. Decca
);
INSERT INTO labels
SELECT l.s,
       (SELECT o FROM triples WHERE p = 'rdfs:label' AND s = l.s ORDER BY length(o) DESC LIMIT 1),
       (SELECT o FROM triples WHERE p = 'rdfs:label' AND s = l.s ORDER BY length(o) LIMIT 1)
  FROM (SELECT DISTINCT s FROM triples WHERE p = 'rdf:type' AND o = 'mw:Label') l;

-- ---------------------------------------------------------------- albums

CREATE TABLE albums (
    code                 TEXT PRIMARY KEY,   -- catalogusnummer, bv. JE29798
    title                TEXT,
    media_description    TEXT,               -- bv. "1 compact disc"
    number_of_discs      INTEGER,
    date_published       TEXT,               -- ISO-datum; NULL als onbekend
    release_year         INTEGER,
    duration_seconds     INTEGER,
    duration             TEXT,               -- H:MM:SS
    ean                  TEXT,               -- eerste EAN; alle EAN's in album_eans
    genre_code_number    INTEGER,            -- mw:genreCode (interne rubriekscode)
    user_rating          INTEGER,
    lending              INTEGER,            -- 0/1
    object_available     INTEGER,            -- 0/1
    possible_to_digitize INTEGER,            -- 0/1
    buy_advice           INTEGER,
    cover_url            TEXT,
    is_popular           INTEGER NOT NULL DEFAULT 0,
    is_classical         INTEGER NOT NULL DEFAULT 0,
    is_collection        INTEGER NOT NULL DEFAULT 0,
    is_best_of           INTEGER NOT NULL DEFAULT 0,
    is_soundtrack        INTEGER NOT NULL DEFAULT 0,
    dvd_region           TEXT,
    dvd_sound_format     TEXT,
    dvd_annotation       TEXT,
    broadcast_standard   TEXT,
    url                  TEXT                -- pagina op muziekweb.nl
);

INSERT INTO albums
SELECT a.code,
       (SELECT o FROM best_label WHERE s = a.code),
       (SELECT o FROM triples WHERE p = 'mw:mediaDescription' AND s = a.code
         ORDER BY lang = 'nl' DESC LIMIT 1),
       (SELECT CAST(o AS INTEGER) FROM triples WHERE p = 'mw:numberOfDiscs' AND s = a.code),
       d.o,
       CASE WHEN CAST(substr(d.o, 1, 4) AS INTEGER) BETWEEN 1850 AND 2100
            THEN CAST(substr(d.o, 1, 4) AS INTEGER) END,
       du.secs,
       CASE WHEN du.secs IS NOT NULL THEN
            (du.secs / 3600) || ':' || printf('%02d', du.secs / 60 % 60) || ':' || printf('%02d', du.secs % 60) END,
       (SELECT MIN(o) FROM triples WHERE p = 'mw:ean' AND s = a.code),
       (SELECT CAST(o AS INTEGER) FROM triples WHERE p = 'mw:genreCode' AND s = a.code),
       (SELECT CAST(o AS INTEGER) FROM triples WHERE p = 'mw:userRating' AND s = a.code),
       (SELECT o = 'true' FROM triples WHERE p = 'mw:lending' AND s = a.code),
       (SELECT o = 'true' FROM triples WHERE p = 'mw:objectAvailable' AND s = a.code),
       (SELECT o = 'true' FROM triples WHERE p = 'mw:possibleToDigitize' AND s = a.code),
       (SELECT CAST(o AS INTEGER) FROM triples WHERE p = 'mw:buyAdvice' AND s = a.code),
       (SELECT o FROM triples WHERE p = 'mw:fullCover' AND s = a.code),
       EXISTS (SELECT 1 FROM triples WHERE p = 'rdf:type' AND s = a.code AND o = 'mw:PopularAlbum'),
       EXISTS (SELECT 1 FROM triples WHERE p = 'rdf:type' AND s = a.code AND o = 'mw:ClassicalAlbum'),
       EXISTS (SELECT 1 FROM triples WHERE p = 'rdf:type' AND s = a.code AND o = 'mw:CollectionAlbum'),
       EXISTS (SELECT 1 FROM triples WHERE p = 'rdf:type' AND s = a.code AND o = 'mw:BestOfAlbum'),
       EXISTS (SELECT 1 FROM triples WHERE p = 'rdf:type' AND s = a.code AND o = 'mw:OriginalSoundTrack'),
       (SELECT group_concat(o, '; ') FROM triples WHERE p = 'mw:dvdRegion' AND s = a.code),
       (SELECT group_concat(o, '; ') FROM triples WHERE p = 'mw:dvdSoundFormat' AND s = a.code),
       (SELECT group_concat(o, ' ') FROM triples WHERE p = 'mw:dvdAnnotation' AND s = a.code),
       (SELECT group_concat(o, '; ') FROM triples WHERE p = 'mw:broadcastStandard' AND s = a.code),
       'https://www.muziekweb.nl/Link/' || a.code
  FROM album_codes a
  LEFT JOIN triples d ON d.p = 'schema:datePublished' AND d.s = a.code AND d.o NOT LIKE '0001-%'
  LEFT JOIN (SELECT s, CAST(o AS INTEGER) AS secs FROM triples WHERE p = 'schema:duration') du
         ON du.s = a.code;

CREATE TABLE album_eans (
    album_code TEXT NOT NULL REFERENCES albums(code),
    ean        TEXT NOT NULL,
    PRIMARY KEY (album_code, ean)
) WITHOUT ROWID;
INSERT OR IGNORE INTO album_eans
SELECT t.s, t.o FROM triples t JOIN album_codes a ON a.code = t.s WHERE t.p = 'mw:ean';

CREATE TABLE album_media (
    album_code TEXT NOT NULL REFERENCES albums(code),
    kind       TEXT NOT NULL,          -- drager (mediaType) | digitaal (digitalMediaFormat)
    media_code TEXT NOT NULL REFERENCES media_types(code),
    PRIMARY KEY (album_code, kind, media_code)
) WITHOUT ROWID;
INSERT OR IGNORE INTO album_media
SELECT s, CASE p WHEN 'mw:mediaType' THEN 'drager' ELSE 'digitaal' END, o
  FROM triples WHERE p IN ('mw:mediaType', 'mw:digitalMediaFormat');

CREATE TABLE album_genres (
    album_code TEXT NOT NULL REFERENCES albums(code),
    genre_code TEXT NOT NULL REFERENCES genres(code),
    PRIMARY KEY (album_code, genre_code)
) WITHOUT ROWID;
INSERT OR IGNORE INTO album_genres SELECT s, o FROM triples WHERE p = 'mw:genre';

-- Bestel-informatie: label, labelnummer (catalogusnummer van het label), EAN, leverancier.
CREATE TABLE album_releases (
    code         TEXT PRIMARY KEY,
    album_code   TEXT NOT NULL REFERENCES albums(code),
    label_code   TEXT REFERENCES labels(code),
    label_number TEXT,
    ean          TEXT,
    offered_by   TEXT
);
INSERT INTO album_releases
SELECT oi.o, oi.s,
       (SELECT MIN(o) FROM triples WHERE p = 'mw:label' AND s = oi.o),
       (SELECT group_concat(o, '; ') FROM triples WHERE p = 'mw:labelNumber' AND s = oi.o),
       (SELECT group_concat(o, '; ') FROM triples WHERE p = 'mw:ean' AND s = oi.o),
       (SELECT group_concat(o, '; ') FROM triples WHERE p = 'schema:offeredBy' AND s = oi.o)
  FROM triples oi WHERE oi.p = 'mw:orderInformation';
CREATE INDEX idx_album_releases_album ON album_releases(album_code);
CREATE INDEX idx_album_releases_label ON album_releases(label_code);

-- ---------------------------------------------------------------- uitvoerenden

CREATE TABLE performers (
    code          TEXT PRIMARY KEY,   -- bv. M00000057644
    name          TEXT,
    sort_name     TEXT,               -- bv. "Herman, Benjamin"
    description   TEXT,
    begin_year    INTEGER,
    end_year      INTEGER,
    is_person     INTEGER NOT NULL DEFAULT 0,
    is_group      INTEGER NOT NULL DEFAULT 0,
    is_composer   INTEGER NOT NULL DEFAULT 0,
    is_classical  INTEGER NOT NULL DEFAULT 0,
    is_popular    INTEGER NOT NULL DEFAULT 0,
    is_important  INTEGER NOT NULL DEFAULT 0,
    url           TEXT
);
CREATE TEMP TABLE performer_codes AS
SELECT DISTINCT o AS code FROM triples WHERE p = 'mw:performer'
UNION
SELECT DISTINCT s FROM triples WHERE p = 'rdf:type'
   AND o IN ('mw:Performer', 'mw:PopularPerformer', 'mw:ClassicalPerformer', 'mw:ImportantPerformer');
INSERT INTO performers
SELECT pc.code,
       COALESCE((SELECT o FROM triples WHERE p = 'skos:prefLabel' AND s = pc.code LIMIT 1),
                (SELECT o FROM best_label WHERE s = pc.code)),
       (SELECT MIN(o) FROM triples WHERE p = 'skos:hiddenLabel' AND s = pc.code),
       (SELECT group_concat(o, ' ') FROM triples WHERE p = 'schema:description' AND s = pc.code),
       (SELECT CAST(MIN(o) AS INTEGER) FROM triples WHERE p = 'mw:beginYear' AND s = pc.code),
       (SELECT CAST(MAX(o) AS INTEGER) FROM triples WHERE p = 'mw:endYear' AND s = pc.code),
       EXISTS (SELECT 1 FROM triples WHERE p = 'rdf:type' AND s = pc.code AND o = 'schema:Person'),
       EXISTS (SELECT 1 FROM triples WHERE p = 'rdf:type' AND s = pc.code AND o = 'schema:MusicGroup'),
       EXISTS (SELECT 1 FROM triples WHERE p = 'rdf:type' AND s = pc.code AND o = 'schema:Composer'),
       EXISTS (SELECT 1 FROM triples WHERE p = 'rdf:type' AND s = pc.code AND o = 'mw:ClassicalPerformer'),
       EXISTS (SELECT 1 FROM triples WHERE p = 'rdf:type' AND s = pc.code AND o = 'mw:PopularPerformer'),
       EXISTS (SELECT 1 FROM triples WHERE p = 'rdf:type' AND s = pc.code AND o = 'mw:ImportantPerformer'),
       'https://www.muziekweb.nl/Link/' || pc.code
  FROM performer_codes pc;

CREATE TABLE album_performers (
    album_code     TEXT NOT NULL REFERENCES albums(code),
    performer_code TEXT NOT NULL REFERENCES performers(code),
    PRIMARY KEY (album_code, performer_code)
) WITHOUT ROWID;
INSERT OR IGNORE INTO album_performers SELECT s, o FROM triples WHERE p = 'mw:performer';

CREATE TABLE performer_keywords (       -- instrument/rol, bv. Saxofoon, Componist
    performer_code TEXT NOT NULL REFERENCES performers(code),
    keyword        TEXT NOT NULL,
    PRIMARY KEY (performer_code, keyword)
) WITHOUT ROWID;
INSERT OR IGNORE INTO performer_keywords SELECT s, o FROM triples WHERE p = 'schema:keywords';

CREATE TABLE performer_aliases (
    performer_code TEXT NOT NULL REFERENCES performers(code),
    alias          TEXT NOT NULL,
    PRIMARY KEY (performer_code, alias)
) WITHOUT ROWID;
INSERT OR IGNORE INTO performer_aliases
SELECT s, o FROM triples WHERE p = 'skos:altLabel'
UNION
SELECT a.s, l.o FROM triples a JOIN triples l ON l.p = 'skos:prefLabel' AND l.s = a.o WHERE a.p = 'mw:alias';

-- ---------------------------------------------------------------- koppelingen

CREATE TABLE external_links (       -- Spotify, Allmusic, Wikipedia, iTunes, ...
    code         TEXT PRIMARY KEY,
    subject_code TEXT NOT NULL,     -- album- of uitvoerende-code
    provider     TEXT,
    url          TEXT,
    title        TEXT
);
INSERT INTO external_links
SELECT el.o, el.s,
       (SELECT o FROM triples WHERE p = 'mw:provider' AND s = el.o),
       (SELECT o FROM triples WHERE p = 'schema:url' AND s = el.o),
       (SELECT o FROM best_label WHERE s = el.o)
  FROM triples el WHERE el.p = 'mw:externalLink';
CREATE INDEX idx_external_links_subject ON external_links(subject_code);

CREATE TABLE same_as (              -- Discogs, MusicBrainz, Wikidata, AllMusic
    subject_code TEXT NOT NULL,
    source       TEXT,
    url          TEXT NOT NULL,
    PRIMARY KEY (subject_code, url)
) WITHOUT ROWID;
INSERT OR IGNORE INTO same_as
SELECT s,
       CASE WHEN o LIKE '%discogs.com%' THEN 'discogs'
            WHEN o LIKE '%musicbrainz.org%' THEN 'musicbrainz'
            WHEN o LIKE '%wikidata.org%' THEN 'wikidata'
            WHEN o LIKE '%allmusic.com%' THEN 'allmusic'
            WHEN o LIKE '%wikipedia.org%' THEN 'wikipedia' END,
       o
  FROM triples WHERE p = 'owl:sameAs';

CREATE TABLE relations (            -- verwante albums/uitvoerenden
    subject_code TEXT NOT NULL,
    relation     TEXT NOT NULL,     -- related | seeAlso | contemporary | influencedBy
    object_code  TEXT NOT NULL,
    PRIMARY KEY (subject_code, relation, object_code)
) WITHOUT ROWID;
INSERT OR IGNORE INTO relations
SELECT s, substr(p, 4), o FROM triples
 WHERE p IN ('mw:related', 'mw:seeAlso', 'mw:contemporary', 'mw:influencedBy');

-- ---------------------------------------------------------------- indexen en view

CREATE INDEX idx_albums_title          ON albums(title);
CREATE INDEX idx_albums_year           ON albums(release_year);
CREATE INDEX idx_albums_ean            ON albums(ean);
CREATE INDEX idx_album_eans_ean        ON album_eans(ean);
CREATE INDEX idx_album_performers_perf ON album_performers(performer_code);
CREATE INDEX idx_album_genres_genre    ON album_genres(genre_code);
CREATE INDEX idx_performers_name       ON performers(name);
CREATE INDEX idx_relations_object      ON relations(object_code);

CREATE VIEW album_overview AS
SELECT a.code,
       a.title,
       (SELECT group_concat(p.name, ', ') FROM album_performers ap
          JOIN performers p ON p.code = ap.performer_code WHERE ap.album_code = a.code) AS performers,
       (SELECT group_concat(DISTINCT l.name) FROM album_releases r
          JOIN labels l ON l.code = r.label_code WHERE r.album_code = a.code) AS labels,
       (SELECT group_concat(DISTINCT r.label_number) FROM album_releases r
         WHERE r.album_code = a.code) AS label_numbers,
       a.ean,
       (SELECT group_concat(g.name_nl, ', ') FROM album_genres ag
          JOIN genres g ON g.code = ag.genre_code
         WHERE ag.album_code = a.code AND g.kind = 'hoofdgenre') AS main_genres,
       (SELECT group_concat(g.name_nl, ', ') FROM album_genres ag
          JOIN genres g ON g.code = ag.genre_code
         WHERE ag.album_code = a.code AND g.kind = 'stijl') AS styles,
       (SELECT group_concat(g.name_nl, ', ') FROM album_genres ag
          JOIN genres g ON g.code = ag.genre_code
         WHERE ag.album_code = a.code AND g.kind = 'categorie') AS categories,
       a.media_description,
       a.date_published,
       a.release_year,
       a.duration,
       a.cover_url,
       a.url
  FROM albums a;

DROP TABLE temp.best_label;
DROP TABLE temp.album_codes;
DROP TABLE temp.performer_codes;

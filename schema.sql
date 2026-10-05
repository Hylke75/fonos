-- Database met albumgegevens uit de Linked Open Data van Muziekweb (data.muziekweb.nl).
--
-- Twee lagen:
--   1. `triples`: ruwe RDF-gegevens zoals opgehaald via SPARQL (niets gaat verloren).
--   2. `albums` e.a.: genormaliseerde tabellen, opgebouwd uit `triples` met `build`.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- ruwe laag

CREATE TABLE IF NOT EXISTS triples (
    s        TEXT NOT NULL,   -- subject-IRI (album)
    p        TEXT NOT NULL,   -- predicaat-IRI
    o        TEXT NOT NULL,   -- object (IRI of literal)
    o_type   TEXT NOT NULL,   -- 'uri' | 'literal' | 'bnode'
    lang     TEXT,
    datatype TEXT,
    o_label  TEXT NOT NULL DEFAULT '',  -- naam van het object als dat een IRI is (artiest, genre, ...)
    PRIMARY KEY (s, p, o, o_label)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_triples_p ON triples(p);

-- Voortgang van het ophalen, zodat `harvest` hervat waar het gebleven was.
CREATE TABLE IF NOT EXISTS harvest_state (
    class_iri  TEXT PRIMARY KEY,
    offset     INTEGER NOT NULL DEFAULT 0,
    done       INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT
);

-- ---------------------------------------------------------------- genormaliseerde laag

CREATE TABLE IF NOT EXISTS labels (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    iri  TEXT
);

CREATE TABLE IF NOT EXISTS albums (
    iri               TEXT PRIMARY KEY,
    catalog_nr        TEXT,                      -- bv. JK278043
    title             TEXT,
    product           TEXT,                      -- drager/formaat, bv. "1 compact disc"
    label_id          INTEGER REFERENCES labels(id),
    barcode           TEXT,
    release_date      TEXT,                      -- zoals in de bron
    release_year      INTEGER,
    duration          TEXT,                      -- zoals in de bron
    duration_seconds  INTEGER,
    description       TEXT,
    image_url         TEXT,
    muziekweb_url     TEXT
);

CREATE TABLE IF NOT EXISTS artists (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    iri  TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS album_artists (
    album_iri TEXT    NOT NULL REFERENCES albums(iri) ON DELETE CASCADE,
    artist_id INTEGER NOT NULL REFERENCES artists(id),
    role      TEXT,                              -- predicaat waarmee de artiest gekoppeld is
    PRIMARY KEY (album_iri, artist_id, role)
);

CREATE TABLE IF NOT EXISTS genres (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    iri  TEXT
);

CREATE TABLE IF NOT EXISTS album_genres (
    album_iri TEXT    NOT NULL REFERENCES albums(iri) ON DELETE CASCADE,
    genre_id  INTEGER NOT NULL REFERENCES genres(id),
    PRIMARY KEY (album_iri, genre_id)
);

CREATE INDEX IF NOT EXISTS idx_albums_catalog ON albums(catalog_nr);
CREATE INDEX IF NOT EXISTS idx_albums_title   ON albums(title);
CREATE INDEX IF NOT EXISTS idx_albums_year    ON albums(release_year);

CREATE VIEW IF NOT EXISTS album_overview AS
SELECT a.catalog_nr,
       a.title,
       (SELECT group_concat(name, ', ') FROM (
            SELECT DISTINCT ar.name FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id
             WHERE aa.album_iri = a.iri)) AS artists,
       l.name AS label,
       a.barcode,
       (SELECT group_concat(g.name, ', ')
          FROM album_genres ag JOIN genres g ON g.id = ag.genre_id
         WHERE ag.album_iri = a.iri) AS genres,
       a.product,
       a.release_date,
       a.release_year,
       a.duration,
       a.description,
       a.image_url,
       a.iri
  FROM albums a
  LEFT JOIN labels l ON l.id = a.label_id;

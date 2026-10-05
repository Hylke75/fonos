-- Database voor albumgegevens van Muziekweb (www.muziekweb.nl).
-- Eén rij per album in `albums`; artiesten, genres en labels zijn genormaliseerd.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS labels (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS albums (
    catalog_nr        TEXT PRIMARY KEY,          -- Catalogusnr., bv. JK278043
    title             TEXT NOT NULL,
    product           TEXT,                      -- bv. "1 compact disc"
    label_id          INTEGER REFERENCES labels(id),
    barcode           TEXT,                      -- EAN/UPC uit Bestel-info
    release_date      TEXT,                      -- zoals getoond, bv. "September 2026"
    release_year      INTEGER,
    release_month     INTEGER,
    duration          TEXT,                      -- Totale speelduur, bv. "0:38:03"
    duration_seconds  INTEGER,
    object_status     TEXT,                      -- bv. "Uitgeleend, wel te reserveren"
    avg_rating        REAL,                      -- NULL bij "nog geen waarderingen"
    rating_count      INTEGER,
    is_tip            INTEGER NOT NULL DEFAULT 0,
    description       TEXT,                      -- Toelichting
    cover_url         TEXT,
    back_cover_url    TEXT,
    url               TEXT NOT NULL,
    scraped_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artists (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    url  TEXT
);

CREATE TABLE IF NOT EXISTS album_artists (
    catalog_nr TEXT    NOT NULL REFERENCES albums(catalog_nr) ON DELETE CASCADE,
    artist_id  INTEGER NOT NULL REFERENCES artists(id),
    position   INTEGER NOT NULL,
    PRIMARY KEY (catalog_nr, artist_id)
);

CREATE TABLE IF NOT EXISTS genres (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS album_genres (
    catalog_nr TEXT    NOT NULL REFERENCES albums(catalog_nr) ON DELETE CASCADE,
    genre_id   INTEGER NOT NULL REFERENCES genres(id),
    PRIMARY KEY (catalog_nr, genre_id)
);

-- Ruwe HTML per pagina, zodat je opnieuw kunt parsen zonder opnieuw te downloaden.
CREATE TABLE IF NOT EXISTS raw_pages (
    url         TEXT PRIMARY KEY,
    catalog_nr  TEXT,
    status_code INTEGER,
    html        TEXT,
    fetched_at  TEXT NOT NULL
);

-- Wachtrij met te scrapen URL's (gevuld vanuit sitemap of een lijst).
CREATE TABLE IF NOT EXISTS queue (
    url    TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'pending',      -- pending | done | error
    error  TEXT
);

CREATE INDEX IF NOT EXISTS idx_albums_title ON albums(title);
CREATE INDEX IF NOT EXISTS idx_albums_year  ON albums(release_year);
CREATE INDEX IF NOT EXISTS idx_queue_status ON queue(status);

CREATE VIEW IF NOT EXISTS album_overview AS
SELECT a.catalog_nr,
       a.title,
       (SELECT group_concat(ar.name, ', ')
          FROM album_artists aa JOIN artists ar ON ar.id = aa.artist_id
         WHERE aa.catalog_nr = a.catalog_nr) AS artists,
       l.name AS label,
       a.barcode,
       (SELECT group_concat(g.name, ', ')
          FROM album_genres ag JOIN genres g ON g.id = ag.genre_id
         WHERE ag.catalog_nr = a.catalog_nr) AS genres,
       a.product,
       a.release_date,
       a.duration,
       a.object_status,
       a.avg_rating,
       a.is_tip,
       a.description,
       a.url
  FROM albums a
  LEFT JOIN labels l ON l.id = a.label_id;

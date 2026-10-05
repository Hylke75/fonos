-- Gegevens van de albumpagina's op www.muziekweb.nl die niet in de open data staan.
-- Wordt naast de tabellen uit build.sql gebruikt; build.sql laat deze tabellen ongemoeid.

CREATE TABLE IF NOT EXISTS scrape_queue (
    album_code TEXT PRIMARY KEY,
    status     TEXT NOT NULL DEFAULT 'pending',   -- pending | done | missing (403/404, bv. e-albums) | error
    http_status INTEGER,
    error      TEXT,
    fetched_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_scrape_queue_status ON scrape_queue(status);

CREATE TABLE IF NOT EXISTS album_pages (
    album_code           TEXT PRIMARY KEY,
    url                  TEXT,
    title                TEXT,
    performers           TEXT,      -- zoals boven aan de pagina
    product              TEXT,
    release_text         TEXT,      -- bv. "September 2026"
    date_published       TEXT,      -- uit microdata, bv. "2026-09"
    recording            TEXT,      -- Opname
    recording_technique  TEXT,      -- Opname techniek
    playtime             TEXT,      -- Totale speelduur
    is_tip               INTEGER NOT NULL DEFAULT 0,
    avg_rating           REAL,
    rating_count         INTEGER,
    description          TEXT,      -- Toelichting (volledige tekst)
    description_author   TEXT,      -- initialen achter de toelichting, bv. SvdP
    remark               TEXT,      -- Opmerking bij deze titel
    num_tracks           INTEGER,
    cover_url            TEXT,
    back_cover_url       TEXT,
    content_z            BLOB,      -- zlib-gecomprimeerde album-HTML, voor opnieuw parsen
    fetched_at           TEXT
);

CREATE TABLE IF NOT EXISTS album_page_labels (       -- Bestel-info
    album_code TEXT NOT NULL,
    position   INTEGER NOT NULL,
    label_code TEXT,
    label_name TEXT,
    catalog_number TEXT,
    PRIMARY KEY (album_code, position)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS album_page_genres (
    album_code TEXT NOT NULL,
    genre_code TEXT NOT NULL,
    name       TEXT,
    PRIMARY KEY (album_code, genre_code)
) WITHOUT ROWID;

-- Werken: liedjes (POPULAR) of composities (CLASSICAL), code U...
CREATE TABLE IF NOT EXISTS works (
    code  TEXT PRIMARY KEY,
    title TEXT,
    kind  TEXT                  -- POPULAR | CLASSICAL
);

CREATE TABLE IF NOT EXISTS work_composers (
    work_code      TEXT NOT NULL,
    performer_code TEXT NOT NULL,
    name           TEXT,
    PRIMARY KEY (work_code, performer_code)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS work_alt_titles (
    work_code TEXT NOT NULL,
    title     TEXT NOT NULL,
    PRIMARY KEY (work_code, title)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS tracks (
    track_id         TEXT PRIMARY KEY,   -- bv. JK278043-0001
    album_code       TEXT NOT NULL,
    position         INTEGER,
    title            TEXT,
    duration         TEXT,
    duration_seconds INTEGER,
    work_code        TEXT,
    spotify_url      TEXT
);
CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_code);
CREATE INDEX IF NOT EXISTS idx_tracks_work  ON tracks(work_code);

CREATE TABLE IF NOT EXISTS track_performers (
    track_id       TEXT NOT NULL,
    position       INTEGER NOT NULL,
    performer_code TEXT,
    name           TEXT,
    role           TEXT,                 -- bv. dirigent, sopraan (klassiek)
    PRIMARY KEY (track_id, position)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_track_performers_perf ON track_performers(performer_code);

CREATE TABLE IF NOT EXISTS album_articles (          -- Gerelateerde artikelen
    album_code TEXT NOT NULL,
    url        TEXT NOT NULL,
    title      TEXT,
    PRIMARY KEY (album_code, url)
) WITHOUT ROWID;

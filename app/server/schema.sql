-- Databaseschema van de Fonotheek-app (zie functioneel ontwerp, hoofdstuk 6).
-- Alle toegang loopt via de server; per route wordt de rol gecontroleerd (zie server/auth.ts).

PRAGMA foreign_keys = ON;

-- Titels in de collectie (6.1). Velden met twee lagen staan als JSON in mw_data (Muziekweb-waarde)
-- en fonos_data (Fonos-waarde). De kolommen d_* zijn de getoonde waarde, afgeleid bij elke wijziging.
CREATE TABLE IF NOT EXISTS titels (
  id            INTEGER PRIMARY KEY,
  titelnummer   TEXT UNIQUE,                -- leeg bij handmatig toegevoegde titels
  soort         TEXT NOT NULL DEFAULT 'populair', -- populair | klassiek (uit Muziekweb)
  mw_data       TEXT NOT NULL DEFAULT '{}',
  fonos_data    TEXT NOT NULL DEFAULT '{}',
  conflicten    TEXT NOT NULL DEFAULT '{}', -- veld -> {fonos, mw_oud, mw_nieuw, sinds}
  zichtbaar     INTEGER NOT NULL DEFAULT 1,
  uitgelicht    INTEGER NOT NULL DEFAULT 0,
  fonos_verhaal TEXT,
  ai_tekst      INTEGER NOT NULL DEFAULT 0, -- toelichting gegenereerd met AI
  tip           INTEGER NOT NULL DEFAULT 0,
  -- getoonde waarden
  d_titel       TEXT,
  d_artiesten   TEXT,                       -- tekst, komma-gescheiden
  d_jaar        INTEGER,
  d_drager      TEXT,                       -- LP | CD | Overig
  d_genres      TEXT NOT NULL DEFAULT '[]',
  d_hoes        TEXT,
  d_label       TEXT,
  heeft_fonos   INTEGER NOT NULL DEFAULT 0, -- er is minstens één Fonos-waarde
  aangemaakt    TEXT NOT NULL DEFAULT (datetime('now')),
  gewijzigd     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_titels_artiest ON titels(d_artiesten);
CREATE INDEX IF NOT EXISTS idx_titels_titel ON titels(d_titel);

-- Laatste Muziekweb-dump: alle titels, ook die niet in de collectie zitten (10.7).
CREATE TABLE IF NOT EXISTS mw_dump (
  titelnummer TEXT PRIMARY KEY,
  data        TEXT NOT NULL,
  import_id   INTEGER
);

-- Exemplaren (6.3).
CREATE TABLE IF NOT EXISTS exemplaren (
  id           INTEGER PRIMARY KEY,
  objectnummer TEXT NOT NULL UNIQUE,
  titel_id     INTEGER REFERENCES titels(id),
  titelnummer  TEXT,                        -- titelnummer zoals aangeleverd (ook als de titel ontbreekt)
  vindcode     TEXT,                        -- open punt O-1
  status       TEXT NOT NULL DEFAULT 'in_collectie', -- in_collectie | uit_collectie
  reden_afvoer TEXT,                        -- beschadigd | kwijt | erfgoed | overig
  toelichting_afvoer TEXT,
  bron         TEXT,                        -- bv. bestand/tabblad van de eerste vulling
  aangemaakt   TEXT NOT NULL DEFAULT (datetime('now')),
  gewijzigd    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_exemplaren_titel ON exemplaren(titel_id);
CREATE INDEX IF NOT EXISTS idx_exemplaren_titelnummer ON exemplaren(titelnummer);

-- Regels uit imports die niet als exemplaar zijn op te slaan (bv. dubbele objectnummers).
CREATE TABLE IF NOT EXISTS import_issues (
  id           INTEGER PRIMARY KEY,
  soort        TEXT NOT NULL,               -- dubbel_objectnummer
  objectnummer TEXT,
  titelnummer  TEXT,
  vindcode     TEXT,
  bron         TEXT,
  afgehandeld  INTEGER NOT NULL DEFAULT 0,
  aangemaakt   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Platenspelers (6.4).
CREATE TABLE IF NOT EXISTS platenspelers (
  nummer INTEGER PRIMARY KEY,
  actief INTEGER NOT NULL DEFAULT 1
);

-- Aanvragen (6.5). Geen persoonsgegevens.
CREATE TABLE IF NOT EXISTS aanvragen (
  id            INTEGER PRIMARY KEY,
  bestelnummer  INTEGER NOT NULL UNIQUE,
  platenspeler  INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ingediend', -- ingediend | uitgegeven | afgesloten | geannuleerd
  ingediend_op  TEXT NOT NULL DEFAULT (datetime('now')),
  opgepakt_op   TEXT,                       -- medewerker is de platen aan het ophalen ("Bezig")
  uitgegeven_op TEXT,
  afgesloten_op TEXT,
  geannuleerd_op TEXT,
  reden         TEXT,
  afgesloten_door TEXT                      -- medewerker | bezoeker | sluitingstijd | terugzetten
);
CREATE INDEX IF NOT EXISTS idx_aanvragen_status ON aanvragen(status);

CREATE TABLE IF NOT EXISTS aanvraag_items (
  id           INTEGER PRIMARY KEY,
  aanvraag_id  INTEGER NOT NULL REFERENCES aanvragen(id),
  titel_id     INTEGER NOT NULL REFERENCES titels(id),
  exemplaar_id INTEGER NOT NULL REFERENCES exemplaren(id),
  verwijderd   INTEGER NOT NULL DEFAULT 0,
  reden        TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_aanvraag ON aanvraag_items(aanvraag_id);
CREATE INDEX IF NOT EXISTS idx_items_exemplaar ON aanvraag_items(exemplaar_id);

-- Genreknoppen (10.8).
CREATE TABLE IF NOT EXISTS genreknoppen (
  id        INTEGER PRIMARY KEY,
  naam      TEXT NOT NULL,
  volgorde  INTEGER NOT NULL DEFAULT 0,
  actief    INTEGER NOT NULL DEFAULT 1,
  kleur     TEXT NOT NULL DEFAULT '#ff14b4',
  afbeelding TEXT,                          -- eigen upload; leeg = hoes uit de knop
  nederlands INTEGER NOT NULL DEFAULT 0     -- de knop "Nederlandse muziek" (O-7)
);
CREATE TABLE IF NOT EXISTS genre_koppelingen (
  id           INTEGER PRIMARY KEY,
  knop_id      INTEGER NOT NULL REFERENCES genreknoppen(id) ON DELETE CASCADE,
  mw_genre     TEXT NOT NULL,               -- naam van het Muziekweb-genre
  weergavenaam TEXT,                        -- naam van het subfilter; gelijke namen vormen één subfilter
  UNIQUE (knop_id, mw_genre)
);

-- Selecties op de homepagina (10.9).
CREATE TABLE IF NOT EXISTS selecties (
  id        INTEGER PRIMARY KEY,
  naam      TEXT NOT NULL,
  soort     TEXT NOT NULL,                  -- uitgelicht | vaak | nieuw | handmatig | seizoen
  volgorde  INTEGER NOT NULL DEFAULT 0,
  actief    INTEGER NOT NULL DEFAULT 1,
  begin     TEXT,                           -- MM-DD, alleen seizoen
  eind      TEXT,                           -- MM-DD, alleen seizoen
  mw_genre  TEXT,                           -- seizoen: vul aan met titels uit dit Muziekweb-genre
  aantal    INTEGER NOT NULL DEFAULT 20,
  periode_dagen INTEGER NOT NULL DEFAULT 90
);
CREATE TABLE IF NOT EXISTS selectie_titels (
  selectie_id INTEGER NOT NULL REFERENCES selecties(id) ON DELETE CASCADE,
  titel_id    INTEGER NOT NULL REFERENCES titels(id) ON DELETE CASCADE,
  volgorde    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (selectie_id, titel_id)
);

CREATE TABLE IF NOT EXISTS instellingen (
  sleutel TEXT PRIMARY KEY,
  waarde  TEXT NOT NULL
);

-- Gebruikers en sessies (10.11).
CREATE TABLE IF NOT EXISTS gebruikers (
  id        INTEGER PRIMARY KEY,
  email     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  naam      TEXT NOT NULL,
  wachtwoord TEXT,
  rollen    TEXT NOT NULL DEFAULT '[]',     -- medewerker | redacteur | beheerder
  actief    INTEGER NOT NULL DEFAULT 1,
  reset_token TEXT,
  reset_tot TEXT,
  aangemaakt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessies (
  token     TEXT PRIMARY KEY,
  gebruiker_id INTEGER NOT NULL REFERENCES gebruikers(id) ON DELETE CASCADE,
  verloopt  TEXT NOT NULL
);

-- Wijzigingslog (10.12).
CREATE TABLE IF NOT EXISTS wijzigingslog (
  id        INTEGER PRIMARY KEY,
  tijd      TEXT NOT NULL DEFAULT (datetime('now')),
  gebruiker_id INTEGER,
  gebruiker TEXT,
  actie     TEXT NOT NULL,
  record_type TEXT,
  record_id TEXT,
  record_label TEXT,
  veld      TEXT,
  oud       TEXT,
  nieuw     TEXT
);
CREATE INDEX IF NOT EXISTS idx_log_record ON wijzigingslog(record_type, record_id);
CREATE INDEX IF NOT EXISTS idx_log_tijd ON wijzigingslog(tijd);

-- Imports (collectie en Muziekweb) met hun rapport.
CREATE TABLE IF NOT EXISTS imports (
  id     INTEGER PRIMARY KEY,
  tijd   TEXT NOT NULL DEFAULT (datetime('now')),
  soort  TEXT NOT NULL,                     -- muziekweb | collectie
  gebruiker TEXT,
  rapport TEXT NOT NULL DEFAULT '{}'
);

-- Back-ups (12.3). De bestanden zelf staan in een aparte map.
CREATE TABLE IF NOT EXISTS backups (
  id      INTEGER PRIMARY KEY,
  tijd    TEXT NOT NULL DEFAULT (datetime('now')),
  soort   TEXT NOT NULL,                    -- dagelijks | handmatig | voor_terugzetten
  bestand TEXT,
  omvang  INTEGER,
  status  TEXT NOT NULL,                    -- gelukt | mislukt
  fout    TEXT
);

-- Databaseschema van de Fonotheek-app (Postgres; zie functioneel ontwerp, hoofdstuk 6).
-- Tijdstippen staan als tekst 'YYYY-MM-DD HH24:MI:SS' in UTC (functie nu()), JSON als tekst.
-- Alle toegang loopt via de server; row level security staat aan zonder policies, zodat de
-- publieke Supabase-API niets kan lezen of schrijven (13).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

CREATE OR REPLACE FUNCTION nu(i interval DEFAULT '0 seconds') RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT to_char((now() AT TIME ZONE 'UTC') + i, 'YYYY-MM-DD HH24:MI:SS') $$;

-- Titels (6.1). Velden met twee lagen staan als JSON in mw_data (Muziekweb) en fonos_data (Fonos).
-- De kolommen d_* zijn de getoonde waarde, afgeleid bij elke wijziging.
CREATE TABLE IF NOT EXISTS titels (
  id            serial PRIMARY KEY,
  titelnummer   text UNIQUE,
  soort         text NOT NULL DEFAULT 'populair',
  mw_data       text NOT NULL DEFAULT '{}',
  fonos_data    text NOT NULL DEFAULT '{}',
  conflicten    text NOT NULL DEFAULT '{}',
  zichtbaar     integer NOT NULL DEFAULT 1,
  uitgelicht    integer NOT NULL DEFAULT 0,
  fonos_verhaal text,
  ai_tekst      integer NOT NULL DEFAULT 0,
  tip           integer NOT NULL DEFAULT 0,
  d_titel       text,
  d_artiesten   text,
  d_jaar        integer,
  d_drager      text,
  d_genres      text NOT NULL DEFAULT '[]',
  d_hoes        text,
  d_label       text,
  d_personen    text NOT NULL DEFAULT '[]',  -- genormaliseerde artiesten en componisten (artiestpagina)
  d_sleutel     text,                        -- genormaliseerd titel|eerste artiest (andere uitgaven)
  zoek          tsvector,
  heeft_fonos   integer NOT NULL DEFAULT 0,
  aangemaakt    text NOT NULL DEFAULT nu(),
  gewijzigd     text NOT NULL DEFAULT nu()
);
CREATE INDEX IF NOT EXISTS idx_titels_artiest ON titels(d_artiesten);
CREATE INDEX IF NOT EXISTS idx_titels_titel ON titels(d_titel);
CREATE INDEX IF NOT EXISTS idx_titels_zoek ON titels USING gin (zoek);
CREATE INDEX IF NOT EXISTS idx_titels_genres ON titels USING gin ((d_genres::jsonb));
CREATE INDEX IF NOT EXISTS idx_titels_personen ON titels USING gin ((d_personen::jsonb));
CREATE INDEX IF NOT EXISTS idx_titels_sleutel ON titels(d_sleutel);

-- Woorden voor typfouttolerantie bij zoeken (7.4).
CREATE TABLE IF NOT EXISTS zoekwoorden (woord text PRIMARY KEY);
CREATE INDEX IF NOT EXISTS idx_zoekwoorden_trgm ON zoekwoorden USING gin (woord gin_trgm_ops);

CREATE TABLE IF NOT EXISTS mw_dump (
  titelnummer text PRIMARY KEY,
  data        text NOT NULL,
  import_id   integer
);

CREATE TABLE IF NOT EXISTS exemplaren (
  id           serial PRIMARY KEY,
  objectnummer text NOT NULL UNIQUE,
  titel_id     integer REFERENCES titels(id),
  titelnummer  text,
  vindcode     text,
  status       text NOT NULL DEFAULT 'in_collectie',
  reden_afvoer text,
  toelichting_afvoer text,
  bron         text,
  aangemaakt   text NOT NULL DEFAULT nu(),
  gewijzigd    text NOT NULL DEFAULT nu()
);
CREATE INDEX IF NOT EXISTS idx_exemplaren_titel ON exemplaren(titel_id, status);
CREATE INDEX IF NOT EXISTS idx_exemplaren_titelnummer ON exemplaren(titelnummer);

CREATE TABLE IF NOT EXISTS import_issues (
  id           serial PRIMARY KEY,
  soort        text NOT NULL,
  objectnummer text,
  titelnummer  text,
  vindcode     text,
  bron         text,
  afgehandeld  integer NOT NULL DEFAULT 0,
  aangemaakt   text NOT NULL DEFAULT nu()
);

CREATE TABLE IF NOT EXISTS platenspelers (
  nummer integer PRIMARY KEY,
  actief integer NOT NULL DEFAULT 1
);
-- Een bezoeker kiest eerst een platenspeler en houdt die vast tot hij hem vrijgeeft (of na inactiviteit).
ALTER TABLE platenspelers ADD COLUMN IF NOT EXISTS sessie text;
ALTER TABLE platenspelers ADD COLUMN IF NOT EXISTS bezet_sinds text;
ALTER TABLE platenspelers ADD COLUMN IF NOT EXISTS laatst_actief text;

CREATE TABLE IF NOT EXISTS aanvragen (
  id            serial PRIMARY KEY,
  bestelnummer  integer NOT NULL UNIQUE,
  platenspeler  integer NOT NULL,
  status        text NOT NULL DEFAULT 'ingediend',
  ingediend_op  text NOT NULL DEFAULT nu(),
  opgepakt_op   text,
  uitgegeven_op text,
  afgesloten_op text,
  geannuleerd_op text,
  reden         text,
  afgesloten_door text
);
CREATE INDEX IF NOT EXISTS idx_aanvragen_status ON aanvragen(status);

CREATE TABLE IF NOT EXISTS aanvraag_items (
  id           serial PRIMARY KEY,
  aanvraag_id  integer NOT NULL REFERENCES aanvragen(id),
  titel_id     integer NOT NULL REFERENCES titels(id),
  exemplaar_id integer NOT NULL REFERENCES exemplaren(id),
  verwijderd   integer NOT NULL DEFAULT 0,
  reden        text
);
CREATE INDEX IF NOT EXISTS idx_items_aanvraag ON aanvraag_items(aanvraag_id);
CREATE INDEX IF NOT EXISTS idx_items_exemplaar ON aanvraag_items(exemplaar_id);

CREATE TABLE IF NOT EXISTS genreknoppen (
  id        serial PRIMARY KEY,
  naam      text NOT NULL,
  volgorde  integer NOT NULL DEFAULT 0,
  actief    integer NOT NULL DEFAULT 1,
  kleur     text NOT NULL DEFAULT '#ff14b4',
  afbeelding text,
  nederlands integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS genre_koppelingen (
  id           serial PRIMARY KEY,
  knop_id      integer NOT NULL REFERENCES genreknoppen(id) ON DELETE CASCADE,
  mw_genre     text NOT NULL,
  weergavenaam text,
  UNIQUE (knop_id, mw_genre)
);

CREATE TABLE IF NOT EXISTS selecties (
  id        serial PRIMARY KEY,
  naam      text NOT NULL,
  soort     text NOT NULL,
  volgorde  integer NOT NULL DEFAULT 0,
  actief    integer NOT NULL DEFAULT 1,
  begin     text,
  eind      text,
  mw_genre  text,
  aantal    integer NOT NULL DEFAULT 20,
  periode_dagen integer NOT NULL DEFAULT 90
);
CREATE TABLE IF NOT EXISTS selectie_titels (
  selectie_id integer NOT NULL REFERENCES selecties(id) ON DELETE CASCADE,
  titel_id    integer NOT NULL REFERENCES titels(id) ON DELETE CASCADE,
  volgorde    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (selectie_id, titel_id)
);

CREATE TABLE IF NOT EXISTS instellingen (
  sleutel text PRIMARY KEY,
  waarde  text NOT NULL
);

CREATE TABLE IF NOT EXISTS gebruikers (
  id        serial PRIMARY KEY,
  email     text NOT NULL,
  naam      text NOT NULL,
  wachtwoord text,
  rollen    text NOT NULL DEFAULT '[]',
  actief    integer NOT NULL DEFAULT 1,
  reset_token text,
  reset_tot text,
  aangemaakt text NOT NULL DEFAULT nu()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gebruikers_email ON gebruikers (lower(email));

CREATE TABLE IF NOT EXISTS sessies (
  token     text PRIMARY KEY,
  gebruiker_id integer NOT NULL REFERENCES gebruikers(id) ON DELETE CASCADE,
  verloopt  text NOT NULL
);

CREATE TABLE IF NOT EXISTS wijzigingslog (
  id        serial PRIMARY KEY,
  tijd      text NOT NULL DEFAULT nu(),
  gebruiker_id integer,
  gebruiker text,
  actie     text NOT NULL,
  record_type text,
  record_id text,
  record_label text,
  veld      text,
  oud       text,
  nieuw     text
);
CREATE INDEX IF NOT EXISTS idx_log_record ON wijzigingslog(record_type, record_id);
CREATE INDEX IF NOT EXISTS idx_log_tijd ON wijzigingslog(tijd);

CREATE TABLE IF NOT EXISTS imports (
  id     serial PRIMARY KEY,
  tijd   text NOT NULL DEFAULT nu(),
  soort  text NOT NULL,
  gebruiker text,
  rapport text NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS backups (
  id      serial PRIMARY KEY,
  tijd    text NOT NULL DEFAULT nu(),
  soort   text NOT NULL,
  bestand text,
  omvang  bigint,
  status  text NOT NULL,
  fout    text
);

-- Tellers voor realtime verversen (kiosk en medewerkersscherm pollen deze).
CREATE TABLE IF NOT EXISTS versies (
  naam   text PRIMARY KEY,
  waarde bigint NOT NULL DEFAULT 0,
  extra  text
);

-- Taken die de planner per dag één keer uitvoert (sluitingstijd, back-up).
CREATE TABLE IF NOT EXISTS planner (
  taak  text PRIMARY KEY,
  datum text NOT NULL
);

-- Wachtrij nieuwsbrief: alleen zolang het nieuwsbriefsysteem onbereikbaar is, maximaal 24 uur (11).
CREATE TABLE IF NOT EXISTS nieuwsbrief_wachtrij (
  id      serial PRIMARY KEY,
  email   text NOT NULL,
  naam    text,
  sinds   text NOT NULL DEFAULT nu(),
  pogingen integer NOT NULL DEFAULT 1
);

-- Nieuwsbriefaanmeldingen, bewaard in de beheeromgeving (koppeling "beheer"). Alleen beheerders zien ze;
-- ze gaan niet mee in back-ups en worden na export of op verzoek verwijderd.
CREATE TABLE IF NOT EXISTS nieuwsbrief_aanmeldingen (
  id           serial PRIMARY KEY,
  email        text NOT NULL,
  naam         text,
  bron         text,
  aangemeld_op text NOT NULL DEFAULT nu(),
  geexporteerd_op text
);
CREATE UNIQUE INDEX IF NOT EXISTS nieuwsbrief_aanmeldingen_email ON nieuwsbrief_aanmeldingen (lower(email));

-- Kortlevende status van imports en back-ups die meerdere verzoeken beslaan.
CREATE TABLE IF NOT EXISTS taken (
  id     text PRIMARY KEY,
  soort  text NOT NULL,
  data   text NOT NULL,
  tijd   text NOT NULL DEFAULT nu()
);

-- Geen toegang via de publieke Supabase-API: RLS aan, geen policies.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['titels','zoekwoorden','mw_dump','exemplaren','import_issues','platenspelers','aanvragen',
    'aanvraag_items','genreknoppen','genre_koppelingen','selecties','selectie_titels','instellingen','gebruikers','sessies',
    'wijzigingslog','imports','backups','versies','planner','nieuwsbrief_wachtrij','nieuwsbrief_aanmeldingen','taken'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

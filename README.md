# fonos – Muziekweb-database

Haalt albumgegevens op van [Muziekweb](https://www.muziekweb.nl) en slaat ze op in een SQLite-database (`muziekweb.db`).

Per album: catalogusnummer, titel, artiest(en), product, label en barcode, genres, objectstatus,
releasedatum, totale speelduur, gemiddelde waardering, TIP-markering, toelichting en cover-URL's.

## Installatie

```bash
pip install -r requirements.txt
python muziekweb_scraper.py init
```

## Gebruik

```bash
# Specifieke albums (catalogusnummers, URL's of een .txt met één per regel)
python muziekweb_scraper.py add JK278043 lijst.txt

# Of de hele catalogus via de sitemap(s) van Muziekweb
python muziekweb_scraper.py discover

# Ophalen en parsen (beleefd: standaard 2 s tussen verzoeken, hervatbaar)
python muziekweb_scraper.py crawl --delay 2
python muziekweb_scraper.py crawl --retry-errors

# Export
python muziekweb_scraper.py export-csv albums.csv
```

De ruwe HTML wordt bewaard in `raw_pages`. Pas je de parser aan, dan zet `reparse` alles opnieuw
in de database zonder opnieuw te downloaden. `parse-file pagina.html` toont het resultaat voor één
opgeslagen pagina, handig om de parser te controleren.

## Database

Zie `schema.sql`. Tabellen: `albums`, `artists` + `album_artists`, `genres` + `album_genres`,
`labels`, `raw_pages` en `queue`. De view `album_overview` geeft één platte rij per album.

```sql
SELECT title, artists, genres, release_date FROM album_overview WHERE genres LIKE '%Folk%';
```

## Let op

- De parser is gebouwd naar de opbouw van de albumpagina (label/waarde-paren zoals `Catalogusnr.:`).
  Controleer na de eerste crawl met `parse-file` of alle velden goed gevuld worden.
- Muziekweb biedt ook open linked data aan (https://data.muziekweb.nl); voor de complete
  catalogus kan dat een betere bron zijn dan scrapen.

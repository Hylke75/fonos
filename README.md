# fonos – Muziekweb-database

Importeert albumgegevens uit de Linked Open Data van [Muziekweb](https://data.muziekweb.nl)
via SPARQL en slaat ze op in een SQLite-database (`muziekweb.db`).

## Installatie

```bash
pip install -r requirements.txt
```

## Gebruik

```bash
# 1. Verkennen: welke klassen en eigenschappen heeft de dataset?
python muziekweb_lod.py inspect
python muziekweb_lod.py inspect --class <IRI van de albumklasse>

# 2. Proefrun met 100 albums, daarna alles (hervat automatisch na onderbreking)
python muziekweb_lod.py harvest --limit 100
python muziekweb_lod.py harvest

# 3. Export
python muziekweb_lod.py export-csv albums.csv
```

Zonder `--class` kiest `harvest` de klasse met "Album" in de naam die de meeste instanties heeft.
Werkt het standaard-endpoint niet, geef dan `--endpoint <URL>` op.

## Database

Zie `schema.sql`.

- `triples`: alle ruwe RDF-gegevens per album, inclusief de namen van gekoppelde artiesten, genres
  en labels. Er gaat dus niets verloren.
- `albums`, `artists` + `album_artists`, `genres` + `album_genres`, `labels`: genormaliseerd,
  opgebouwd uit `triples` met `build`.
- View `album_overview`: één platte rij per album.

Welke RDF-eigenschap in welke kolom komt, staat in `FIELD_MAP` en de `*_PREDICATES`-lijsten in
`muziekweb_lod.py` (op lokale naam, bv. `name`, `byArtist`, `genre`, `gtin13`). Pas die zo nodig aan
na `inspect --class` en draai `python muziekweb_lod.py build`, zonder opnieuw te downloaden.

```sql
SELECT title, artists, genres, release_year FROM album_overview WHERE genres LIKE '%Folk%';
```

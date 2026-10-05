# fonos – Muziekweb-database

Bouwt een SQLite-database (`muziekweb.db`) uit de volledige Linked Open Data van
[Muziekweb](https://data.muziekweb.nl/MuziekwebOrganization/Muziekweb), de muziekbibliotheek van
Nederland. Bron: de N-Triples-dump van data.muziekweb.nl (~38 miljoen triples), licentie
**ODC-By** (naamsvermelding Muziekweb verplicht).

## Gebruik

```bash
pip install -r requirements.txt
python muziekweb_import.py all      # download (~420 MB) + laden + opbouwen, ca. 10 min, resultaat ~1,2 GB
python muziekweb_import.py export-csv albums.csv
```

Of in stappen: `download`, `load` (dump → staging-tabel `triples`), `build` (staging → tabellen,
via `build.sql`). Met `--keep-triples` blijft de ruwe staging-tabel staan (ruim 3 GB extra).

## Inhoud

| tabel | inhoud |
|---|---|
| `albums` | titel, dragerbeschrijving ("1 compact disc"), aantal discs, releasedatum/-jaar, speelduur, EAN, hoes-URL, waardering, uitleen-/beschikbaarheidsvlaggen, type (pop/klassiek/verzamel/best-of/soundtrack), DVD-gegevens |
| `performers` | naam, sorteernaam, beschrijving, begin-/eindjaar, persoon/groep/componist |
| `album_performers` | koppeling album ↔ uitvoerende |
| `genres` | hoofdgenres (HFD), stijlen (T) en categorieën (CAT), in nl/en/de/fr, met hiërarchie |
| `album_genres` | koppeling album ↔ genre |
| `labels` | platenlabels (volledige en korte naam) |
| `album_releases` | bestel-info: label, labelnummer, EAN, leverancier |
| `album_eans`, `album_media` | alle EAN's; dragers (CD, LP, Digital, …) en digitale formaten |
| `external_links` | Spotify, Allmusic, Wikipedia, iTunes, … |
| `same_as` | Discogs, MusicBrainz, Wikidata, AllMusic |
| `relations` | verwante albums en uitvoerenden |
| `performer_keywords`, `performer_aliases`, `media_types` | instrument/rol, aliassen, dragernamen |

De view `album_overview` geeft één platte rij per album:

```sql
SELECT code, title, performers, labels, main_genres, styles, release_year, duration
  FROM album_overview WHERE performers LIKE '%Rhiannon Giddens%';
```

Codes zijn de Muziekweb-codes: album `JE29798` staat op `https://www.muziekweb.nl/Link/JE29798`.

## Niet in de open data

De toelichting (recensietekst), objectstatus/uitleenstatus, TIP-markering en tracklijsten van
de website zitten niet in de Linked Open Data en staan dus niet in deze database.

Ook in de bron ontbreekt bij 143 albums de titel; 16 daarvan zijn alleen verwijzingen zonder verdere gegevens.

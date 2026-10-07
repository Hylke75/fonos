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

## Aanvulling van de website (muziekweb_scrape.py)

Tracklijsten, toelichting, opmerkingen, opname-info, TIP-markering, gemiddelde waardering en
gerelateerde artikelen staan niet in de open data. `muziekweb_scrape.py` haalt die van de
albumpagina's op www.muziekweb.nl en schrijft ze in dezelfde database:

```bash
python muziekweb_scrape.py enqueue --newest     # alle albums (behalve e-albums), nieuwste eerst
python muziekweb_scrape.py crawl                # hervat automatisch; Ctrl-C mag altijd
python muziekweb_scrape.py status
```

Standaard 1 pagina tegelijk met 1 s pauze (~0,65 pagina/s): de hele catalogus duurt dan
~13 dagen. `--workers 2` halveert dat; ga niet veel hoger, het is een publieke dienst.

| tabel | inhoud |
|---|---|
| `album_pages` | toelichting (+ auteur), opmerking, opname, TIP, gemiddelde waardering, hoes voor/achter, gecomprimeerde HTML |
| `tracks` | per track: positie, titel, speelduur, werk-code, Spotify-link |
| `track_performers` | uitvoerenden per track, met rol (dirigent, piano, sopraan, …) |
| `works`, `work_composers`, `work_alt_titles` | liedjes/composities met componisten en alternatieve titels |
| `album_page_labels`, `album_page_genres`, `album_articles` | bestel-info, genres en artikelen zoals op de pagina |

`reparse` verwerkt de opgeslagen HTML opnieuw zonder te downloaden.

Niet opgehaald: de objectstatus (uitleenstatus). Die komt van `/Muziekweb/DUIT/`, dat in
robots.txt voor crawlers is uitgesloten. E-albums (`JKE…`) geven HTTP 403 en worden overgeslagen.

Ook in de bron ontbreekt bij 143 albums de titel; 16 daarvan zijn alleen verwijzingen zonder verdere gegevens.

## Controle met een catalogusexport (collectie/catalogus_import.py)

```bash
python collectie/catalogus_import.py "Hylke export 06102026 v1.xml" --dry-run   # eerst tellen
python collectie/catalogus_import.py "Hylke export 06102026 v1.xml"
```

Slaat de export op (`catalogus_albums`, `catalogus_bestelinfo`, `catalogus_tracks`), voegt
`album_credits` (artiesten zoals in de catalogus) en `album_keywords` toe, en vult/corrigeert in
`albums` titel, releasedatum, drager, aantal schijven en speelduur. Elke wijziging staat in
`wijzigingen` (oud → nieuw). De view `album_overview_compleet` toont ook credits en trefwoorden.

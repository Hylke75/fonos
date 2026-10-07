# fonos – Fonotheek-database

`fonotheek.db.gz` is de database van de LP-gebruikscollectie (Klassiek en Populair), met de
gegevens van [Muziekweb](https://www.muziekweb.nl). Uitpakken en openen:

```bash
gunzip -k fonotheek.db.gz
sqlite3 fonotheek.db "SELECT * FROM album_overview WHERE code = 'AA00449'"
```

Bronnen, in volgorde van voorrang bij verschillen: de catalogusexport (Klassiek, 6-10-2026),
de albumpagina's op muziekweb.nl (oktober 2026) en de Linked Open Data van Muziekweb
(licentie ODC-By: vermeld Muziekweb als bron).

## Inhoud

| tabel | inhoud |
|---|---|
| `collectie_items` | exemplaren uit de gebruikscollectie: objectnummer, titelnummer (album), lijst |
| `albums` | 53.077 albums: titel, drager, schijven, releasedatum/-jaar, speelduur, toelichting, opmerking, opname, waardering, type, hoezen |
| `album_performers` | hoofdartiesten per album (volgorde zoals op muziekweb.nl) |
| `album_credits` | artiesten zoals in de catalogusexport, met jaartallen en rollen (Klassiek) |
| `performers`, `performer_aliases`, `performer_keywords` | uitvoerenden, aliassen, instrument/rol |
| `labels`, `album_releases` | platenlabels en bestel-info (labelnummer, EAN, leverancier) |
| `genres`, `album_genres`, `album_keywords` | genres/stijlen (nl/en/de/fr, hiërarchie) en trefwoorden |
| `media_types`, `album_media` | dragers (LP, CD, …) en digitale formaten |
| `tracks`, `track_performers` | tracks met speelduur en uitvoerenden per track (met rol) |
| `works`, `work_composers`, `work_alt_titles` | liedjes/composities met componisten |
| `articles`, `album_articles` | gerelateerde artikelen op muziekweb.nl |
| `external_links`, `same_as`, `relations` | Spotify/Wikipedia/…, Discogs/MusicBrainz/Wikidata, verwante albums |

De view `album_overview` geeft één rij per album. Releasedata zijn alleen echte (deel)data
(`1968`, `1972-06`, `2024-07-26`); waar Muziekweb "voor 1988" vermeldt is
`released_before_1988 = 1`. De link naar muziekweb.nl is `https://www.muziekweb.nl/Link/<code>`.

Niet op muziekweb.nl beschikbaar en dus niet in de database: de uitleenstatus, en tracklijsten
voor albums waar Muziekweb die niet heeft ingevoerd (een groot deel van de oude LP's).

## Hoe de database is gemaakt

De scripts in deze repository bouwden een werkdatabase en daaruit deze database:
`muziekweb_import.py` (open data), `muziekweb_scrape.py` (albumpagina's, met `prioritize` voor
de collectielijsten), `collectie/opschonen.py` (beperken tot de lijsten),
`collectie/catalogus_import.py` (controle met de catalogusexport) en `collectie/schoon.py`
(samenvoegen tot dit schema zonder dubbele of lege velden).

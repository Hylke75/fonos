# Fonotheek-app (Luisterbar Fonos)

Bezoekersapp voor de kiosktablets, medewerkersscherm en beheeromgeving, gebouwd volgens het
functioneel ontwerp v1.0 (6 oktober 2026) en de vormgeving uit de bijlage.

| Onderdeel | Adres | Wie |
|---|---|---|
| Bezoekersapp (kiosk) | `/` | iedereen, geen login |
| Medewerkersscherm | `/medewerker` | rol medewerker |
| Beheeromgeving | `/beheer` | rollen redacteur en beheerder |

## Starten

Vereist Node.js 22.13 of nieuwer (gebruikt de ingebouwde SQLite van Node).

```bash
cd app
npm install
npm run import:muziekweb -- ../exports     # Muziekweb-gegevens inlezen (± 30 s)
npm run import:collectie -- Klassiek.xlsx Populair.xlsx   # eerste vulling exemplaren
npm run gebruiker -- naam@beeldengeluid.nl "Voornaam Achternaam" <wachtwoord>
npm run build && npm start                  # http://localhost:3000
```

Ontwikkelen: `npm run dev` (Vite op poort 5173 met de API op 3000). Tests: `npm test`. Typecheck: `npm run typecheck`.

### Demo zonder de spreadsheets

De spreadsheets van de gebruikscollectie staan niet in de repo. Voor een demo:

```bash
npm run import:muziekweb -- ../exports
npm run demo        # demo-exemplaren (objectnummer 9xxxxxxxx, bron "demo") en drie demogebruikers
```

Demogebruikers (wachtwoord `fonos-demo`): `beheerder@fonos.demo`, `redacteur@fonos.demo`, `medewerker@fonos.demo`.
Gebruik de demovulling niet in productie.

## Configuratie (omgevingsvariabelen)

| Variabele | Standaard | Betekenis |
|---|---|---|
| `PORT` | 3000 | poort van de server |
| `FONOS_DATA_DIR` | `app/data` | map voor database en uploads |
| `FONOS_DB` | `$FONOS_DATA_DIR/fonotheek.db` | databasebestand |
| `FONOS_UPLOAD_DIR` | `$FONOS_DATA_DIR/uploads` | door Fonos geüploade hoezen |
| `FONOS_BACKUP_DIR` | `$FONOS_DATA_DIR/backups` | back-ups; zet dit in productie op een **andere schijf of share** (12.3) |
| `FONOS_DUMP_DIR` | – | map waar een Muziekweb-levering klaarstaat ("Ophalen uit servermap") |
| `FONOS_BASIS_URL` | adres van het verzoek | basis voor links in e-mails (wachtwoord-reset) |
| `RESEND_API_KEY` | – | e-mail via Resend; zonder sleutel komen mails alleen in het serverlog |
| `FONOS_MAIL_AFZENDER` | `Fonotheek <fonotheek@fonos.nl>` | afzender |
| `TZ` | `Europe/Amsterdam` | tijdzone voor sluitingstijd en back-ups |

## Kiosktablet

- Open `/` in de kioskbrowser (bijvoorbeeld Fully Kiosk Browser) op de tablet, liggend.
- Toegestane adressen: de app zelf, de fonos.nl-pagina's uit *Instellingen → Toegestane fonos.nl-pagina's*,
  de privacyverklaring en `media.cdr.nl` (hoezen van Muziekweb).
- Na 90 seconden zonder aanraking (instelbaar) verschijnt "Ben je er nog?" en daarna wordt de sessie gewist.
- Zet in *Instellingen → Bumper op het rustscherm* het adres van de bumpervideo om die in een lus te tonen;
  leeg = het welkomstscherm "De Fonotheek" uit het ontwerp.

## Opbouw

```
app/
  server/            Node-server (Hono), SQLite, realtime via Server-Sent Events
    schema.sql       databaseschema (hoofdstuk 6)
    titels.ts        tweelagenmodel Muziekweb/Fonos, conflicten (6.2)
    aanvragen.ts     aanvragen en statussen (7.9, 8)
    catalogus.ts     homepagina, zoeken, filters, album- en artiestpagina (7)
    zoeken.ts        eigen zoekindex in het geheugen, typfouttolerant (7.4)
    importers/       Muziekweb: lezers (formaat) gescheiden van verwerken (generiek); bulkimport collectie
    backup.ts        back-up, bewaartermijn, terugzetten (12)
    planner.ts       sluitingstijd, nachtelijke back-up, nieuwsbrief-wachtrij
    nieuwsbrief.ts   losse module voor het nieuwsbriefsysteem (O-4)
    routes/          API voor kiosk, medewerker, beheer en inloggen
  src/               React-frontend: kiosk/, staff/ (medewerker), admin/ (beheer)
  shared/            velden en genre-startvulling (bijlage A)
  scripts/           import, demo en gebruikersbeheer vanaf de opdrachtregel
  tests/             tests van de kernregels
```

## Beveiliging

- Beheer en medewerkersscherm alleen na inloggen (persoonlijk account, wachtwoord met scrypt, sessiecookie httpOnly).
- Elke API-route controleert de rol; de bezoekersapp kan alleen de catalogus lezen en aanvragen aanmaken.
- De database is alleen via de server bereikbaar (geen directe toegang vanaf de tablets).
- Aanvragen bevatten geen persoonsgegevens; nieuwsbriefgegevens worden niet opgeslagen.

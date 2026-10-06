# Fonotheek-app (Luisterbar Fonos)

Bezoekersapp voor de kiosktablets, medewerkersscherm en beheeromgeving, gebouwd volgens het
functioneel ontwerp v1.0 (6 oktober 2026) en de vormgeving uit de bijlage.

| Onderdeel | Adres | Wie |
|---|---|---|
| Bezoekersapp (kiosk) | `/` | iedereen, geen login |
| Medewerkersscherm | `/medewerker` | rol medewerker |
| Beheeromgeving | `/beheer` | rollen redacteur en beheerder |

## Productie: Vercel + Supabase

- **Database:** Supabase-project `fonos` (Postgres), databaserol `fonos_app` via de pooler.
- **Hosting:** Vercel-project `fonos`. `vercel.json` (repo-root) bouwt met `npm run vercel-build`:
  frontend (Vite), één API-functie in regio Dublin (Build Output API, `scripts/bouw-vercel.mjs`) en daarna
  de vulling (`scripts/vercel-vul.ts`): schema, nieuwe Muziekweb-exportdelen, gebruikscollectie
  (`collectie/gebruikscollectie.csv`) en de eerste beheerder. Alles idempotent; elke build laadt alleen wat nieuw is.
- **Bestanden:** geüploade hoezen en back-ups in Vercel Blob (`BLOB_READ_WRITE_TOKEN`), los van de database. De store is privé;
  bestanden gaan via `/api/bestand/…` (hoezen openbaar, back-ups alleen voor beheerders). `FONOS_BLOB_ACCESS=public` voor een openbare store.
- **Planner:** Vercel Cron roept elke nacht `/api/cron` aan (back-up, sluitingstijd); daarnaast loopt de planner mee met verzoeken.
- **Realtime:** kiosk en medewerkersscherm vragen elke paar seconden `/api/versies` op.

Omgevingsvariabelen in Vercel: `DATABASE_URL` (mag meerdere adressen bevatten, gescheiden door spaties),
`FONOS_BEHEERDER_EMAIL`, `FONOS_START_WACHTWOORD`, `CRON_SECRET`, en `BLOB_READ_WRITE_TOKEN` (via de Blob-koppeling).

## Lokaal starten

Vereist Node.js 22.13 of nieuwer. Zonder `DATABASE_URL` draait de app op PGlite (Postgres in het proces, map `data/pglite`).

```bash
cd app
npm install
npm run import:muziekweb -- ../exports     # Muziekweb-gegevens inlezen (± 30 s)
npm run import:collectie -- ../collectie/gebruikscollectie.csv   # eerste vulling exemplaren
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
| `DATABASE_URL` | – | Postgres; zonder: PGlite in `$FONOS_DATA_DIR/pglite` |
| `FONOS_OPSLAG_DIR` | `$FONOS_DATA_DIR/opslag` | hoezen en back-ups zonder Vercel Blob |
| `FONOS_DUMP_DIR` | `../exports` | exportmap van de Muziekweb-scraper |
| `FONOS_BASIS_URL` | adres van het verzoek | basis voor links in e-mails (wachtwoord-reset) |
| `RESEND_API_KEY` | – | e-mail via Resend; zonder sleutel komen mails alleen in het serverlog |
| `FONOS_MAIL_AFZENDER` | `Fonotheek <fonotheek@fonos.nl>` | afzender |
| `TZ` | `Europe/Amsterdam` | tijdzone (lokaal; op Vercel niet nodig, de planner rekent zelf in Europe/Amsterdam) |

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
- Row level security staat aan op alle tabellen, zonder policies: de publieke Supabase-API kan niets lezen of schrijven; alleen de server (rol `fonos_app`, eigenaar van de tabellen) heeft toegang.
- Aanvragen bevatten geen persoonsgegevens; nieuwsbriefgegevens worden niet opgeslagen.

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
  de vulling (`scripts/vercel-vul.ts`): schema, `fonotheek.db.gz` (alle albums met Muziekweb-gegevens en de
  gebruikscollectie) en de eerste beheerder. Alles idempotent; de database wordt alleen ingelezen als het bestand veranderd is.
  Bestaat er al een collectie, dan komen alleen nieuwe exemplaren mét titelnummer erbij; wijzigen en afvoeren gaat via de bulkimport.
  Een GitHub Action (`.github/workflows/exports.yml`) haalt elk uur de nieuwste `fonotheek.db.gz` van de scraper-branch naar `main`.
- **Bestanden:** geüploade hoezen en back-ups in Vercel Blob (`BLOB_READ_WRITE_TOKEN`), los van de database. De store is privé;
  bestanden gaan via `/api/bestand/…` (hoezen openbaar, back-ups alleen voor beheerders). `FONOS_BLOB_ACCESS=public` voor een openbare store.
- **Planner:** Vercel Cron roept elke nacht `/api/cron` aan (back-up, sluitingstijd); daarnaast loopt de planner mee met verzoeken.
- **Realtime:** kiosk en medewerkersscherm vragen elke paar seconden `/api/versies` op.

Omgevingsvariabelen in Vercel: `DATABASE_URL` (mag meerdere adressen bevatten, gescheiden door spaties),
`FONOS_BEHEERDER_EMAIL`, `FONOS_START_WACHTWOORD`, `CRON_SECRET`, en `BLOB_READ_WRITE_TOKEN` (via de Blob-koppeling).
Optioneel voor inloggen via Google Workspace: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` en `FONOS_GOOGLE_DOMEIN`
(standaard `beeldengeluid.nl`); redirect-URI van de OAuth-client: `https://<domein>/api/auth/google/terug`.

## Tweede reeks verbeteringen

- **Kiosk:** albums zonder tracklist tonen hun gegevens meteen. Plaatsvervangers als "No Artist" worden niet getoond. Bij zoeken staat de reden ("Nummer: …").
  Op de albumpagina staat "Meer van deze artiest" en "Ook luisteren". Er is een NL/EN-knop en een knop voor grotere tekst met meer contrast.
  Bij verbindingsverlies verschijnt een balk en gaat de aanvraag later alsnog weg. Zijn alle spelers bezet, dan is er een wachtlijst
  (`wachtlijst_reserveer_min`: zo lang blijft een vrijgekomen speler voor de eerste wachtende vastgehouden).
- **Medewerker:** pushmeldingen op het eigen apparaat (Web Push, `public/sw.js`). De sleutels komen uit `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`,
  of worden eenmalig gemaakt en bewaard in de tabel `geheimen`. De looplijst is af te drukken. Het scherm vergrendelt na inactiviteit (ontgrendelen met de code).
- **Beheer:** *Statistieken* met CSV-export. Werklijsten bij Datakwaliteit als CSV, met links naar Muziekweb. Een nachtelijke controle van hoesadressen
  (Muziekweb geeft voor een ontbrekende hoes een GIF-plaatje). Dubbele titels (populair) zijn in de kiosk optioneel als één album te tonen.
  Bij elke nieuwe `fonotheek.db` komt er een verslag in Historie en per e-mail.
- **Techniek:** browsertests met Playwright (`npm run test:e2e`, ook in de CI): de kioskstroom, Engels, inloggen met tweestaps,
  het medewerkersscherm en WCAG 2.1 AA (axe). JavaScript-fouten uit de browser komen in de tabel `browserfouten` en op de statuspagina,
  en bij herhaling ook als storingsmelding.

## IT-beleid B&G (operationeel IT-beleid v3.3)

- **6.1 Toegang:** tweestapsverificatie met een authenticator-app (TOTP), standaard verplicht voor iedereen
  (instelling *Beveiliging*). Inloggen via Google (de IDP) zodra de Google-variabelen gezet zijn; wachtwoord-inloggen kan
  dan uit. Rem op het raden van wachtwoorden: 10 pogingen per kwartier per adres. Beheerders kunnen de koppeling resetten.
- **6.2 Monitoring:** `GET /api/gezond` geeft 200 of 503 (database, nachtelijke taak, back-up van de laatste 26 uur) voor de
  monitoring van B&G. Storingsmeldingen per e-mail aan de beheerders en de extra adressen uit de instellingen
  (bv. de Topdesk-mailbox): mislukte back-up, geen recente back-up, serverfouten, veel mislukte inlogpogingen. Per soort hooguit één per dag.
- **6.3 Logging:** alle geslaagde en mislukte aanmeldingen (tijd, methode, IP-adres, apparaat) onder *Gebruikers → Aanmeldingen*, met CSV-export.
- **8.4 Accounts:** soort account (vast, tijdelijk, extern) met einddatum; extern uiterlijk 31 december. Na de einddatum kan het
  account niet meer inloggen; herinnering vooraf aan de gebruiker en de beheerders.
- **4.7 Updates:** Dependabot (`.github/dependabot.yml`) opent wekelijks pull requests voor verouderde pakketten.
- **5.6 Beveiligingsheaders:** CSP, HSTS, X-Frame-Options en andere (`shared/beveiligingsheaders.json`), op de API en de statische bestanden.

## Werking aan de bar

- **Kiosk:** rustscherm → platenspeler kiezen (knoppen, QR-code op de speler of link `/speler/3`) → zoeken en aanvragen →
  speler vrijgeven. Na 20 minuten zonder gebruik "Ben je er nog?"; zonder reactie na 3 minuten automatisch vrijgegeven (instelbaar).
  In de kop de status van de eigen aanvraag; een titel die de medewerker eruit haalt, wordt gemeld. Bij een volle aanvraag kun je platen bewaren voor later.
- **Tabletnaam:** open de kiosk één keer met `?tablet=Bar%20links`; de naam staat daarna in het log en op Beheer → Status.
- **Medewerker:** tegels per platenspeler, looplijst over alle open aanvragen (op catalogusnummer), terugzetten in het archief en een overzicht van vandaag.
  Bestelnummers beginnen elke dag bij #001.
- **Beheer → Status:** build, database, cron, back-up, kiosks, platenspelers en de Muziekweb-data die nog binnenkomt
  (met een CSV van titelnummers die nog niet in de dump staan). Hier ook de QR-codes voor de platenspelers om af te drukken.
- **Beheer → Nieuwsbrief:** aanmeldingen bekijken, exporteren als CSV en verwijderen; na export automatisch verwijderd na de ingestelde termijn.

## Lokaal starten

Vereist Node.js 22.13 of nieuwer. Zonder `DATABASE_URL` draait de app op PGlite (Postgres in het proces, map `data/pglite`).

```bash
cd app
npm install
npm run import:muziekweb                     # ../fonotheek.db.gz inlezen: albums en gebruikscollectie (± 1 min)
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

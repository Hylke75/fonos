# Werkafspraken voor deze repository

De app staat in `app/` (Hono + React + Postgres). Teksten, commits en pull requests in het Nederlands.

## Beveiliging gaat voor

Lees `app/BEVEILIGING.md` voordat je iets aan de server verandert. De belangrijkste regels:

- Elke nieuwe route krijgt een regel in `REGELS` in `app/server/toegang.ts` (strengste eis die werkt). Zonder regel
  is de route dicht en faalt `app/tests/toegang.test.ts`.
- Uitgaande verbindingen alleen via `haal()` in `app/server/naarbuiten.ts`.
- Geen `e.message` of tekst van buiten naar de client of in e-mails: `GebruikersFout` en `foutTekst()` uit `app/server/fouten.ts`.
- Tokens als hash (`hashToken`), terug te lezen geheimen versleuteld (`versleutel`), nooit geheimen of resetlinks in logs.
- Adres van de app via `basisUrl(c)`, IP-adres via `clientIp(c)`; nooit de Host-header of `X-Forwarded-For` direct.
- Nooit een test overslaan, uitzetten of versoepelen om de CI groen te krijgen.

## Werkwijze

- Wijzigingen via een pull request naar `main`; samenvoegen pas na groene CI. Niet rechtstreeks naar `main` pushen.
- Voor een pull request lokaal: `cd app && npm run typecheck && npm test` (en `npm run test:e2e` bij schermwijzigingen).
- Geen sleutels of wachtwoorden in de code, in commits of in de README.

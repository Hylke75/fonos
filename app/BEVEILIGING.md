# Beveiliging van de Luisterbar-app

Dit document beschrijft hoe de app beveiligd is en welke regels gelden voor elke wijziging, ook als die met AI
wordt gemaakt. Het is de uitwerking van de security- en architectuurreview van 17 november 2026 (bevindingen R1–R16,
verdiepingskansen 1–7). De regels worden zoveel mogelijk **afgedwongen door tests in de CI**, zodat een wijziging
die ze overtreedt niet groen wordt.

## Het model in één zin

Elke beveiligingsbeslissing staat **achter één module**, niet bij de aanroeper. Een nieuwe route, upload, uitgaande
verbinding of foutmelding is daardoor standaard veilig.

| Vraag | Module | Wat de module garandeert |
|---|---|---|
| Wie mag dit verzoek doen? | `server/toegang.ts` | Elke route onder `/api` en `/uploads` heeft een regel in `REGELS`; zonder regel: geweigerd (fail-closed). |
| Welke tablet is dit? | `server/toegang.ts` (kiosk) | Alleen gekoppelde kiosks (cookie `fonos_kiosk`, als hash in de database) mogen iets veranderen. |
| Waar praat de server mee? | `server/naarbuiten.ts` | Alleen naar vaste hosts per bestemming, alleen HTTPS, geen redirects, met time-out. Dit is ook de firewalltabel. |
| Wat gaat er naar buiten bij een fout? | `server/fouten.ts` + `app.onError` | Alleen `GebruikersFout`-teksten; al het andere: "Er ging iets mis (referentie …)". |
| Hoe bewaren we geheimen? | `server/geheimen.ts` | Tokens als sha256-hash; TOTP en VAPID versleuteld (AES-256-GCM, `FONOS_GEHEIM_SLEUTEL`). |
| Wat is ons adres, wie is de client? | `server/verzoek.ts` | Uit de configuratie, nooit uit de Host-header of `X-Forwarded-For` van de client. |
| Hoe remmen we misbruik af? | `server/rem.ts` | Een teller per sleutel per tijdvak in de database, gedeeld door alle serverinstanties. |

## Regels voor elke wijziging

1. **Nieuwe route?** Voeg een regel toe aan `REGELS` in `server/toegang.ts` met de strengste eis die werkt
   (`beheerder` > `redacteur` > `medewerker` > `kiosk` > `openbaar`). `tests/toegang.test.ts` faalt voor elke route
   zonder regel, en voor elke niet-openbare route die zonder inloggen iets anders dan 401/403 geeft.
   `openbaar` alleen voor lezen van de catalogus, inloggen en gezondheid.
2. **Uitgaande verbinding?** Altijd via `haal()` uit `server/naarbuiten.ts`, met een (nieuwe) bestemming. Nooit
   `fetch()` met een adres dat uit een verzoek, een instelling of de database komt zonder die controle.
3. **Foutmelding voor de gebruiker?** `throw new GebruikersFout('…')`. In catch-blokken van beheerroutes
   `foutTekst(e)`. Nooit `e.message` of een stacktrace rechtstreeks naar de client, en nooit tekst van buiten
   (verzoek, browser) in een e-mail.
4. **Geheim opslaan?** Token: `hashToken()`. Iets wat je terug moet lezen: `versleutel()` / `ontsleutel()`.
   Nooit een token, wachtwoord of link met token in het log.
5. **Upload?** Het type uit de inhoud (`afbeeldingType()`), naam en extensie kiest de server. Andere bestanden dan
   hoezen alleen voor beheerders en altijd als download.
6. **Links in e-mails of naar Google?** `basisUrl(c)`. **IP-adres?** `clientIp(c)`.
7. **Iets wat iedereen kan aanroepen en iets verandert of verstuurt?** Een rem met `rem()`.
8. **Wachtwoord zetten?** Via `zetWachtwoord()` (beleid: 12 tekens, 3 van 4 tekensoorten, geen naam, geen hergebruik
   van de laatste 24).
9. **Afhankelijkheden:** de CI draait `npm audit --omit=dev --audit-level=high`; Dependabot opent wekelijks updates.

## Inrichting (wat in de omgeving moet staan)

Beheer → Status → *Inrichting* laat zien wat ontbreekt.

| Variabele | Waarom |
|---|---|
| `CRON_SECRET` | Zonder geheim is `/api/cron` dicht (de nachtelijke back-up en sluitingstijd draaien dan niet via Vercel Cron). |
| `FONOS_GEHEIM_SLEUTEL` | Lange willekeurige tekst. Zonder sleutel staan TOTP- en VAPID-geheimen leesbaar in de database. Niet wijzigen zonder plan: met een andere sleutel moeten alle medewerkers hun authenticator opnieuw koppelen. |
| `FONOS_BASIS_URL` | Het adres van de app. Op Vercel valt de app terug op het productieadres van Vercel; on-prem is hij verplicht. |
| `FONOS_VERTROUWDE_PROXY=1` | Alleen on-prem achter een eigen reverse proxy die `X-Forwarded-For` zelf zet. |

## Kiosktablets koppelen

Een tablet aan de bar wordt één keer gekoppeld: een beheerder maakt in Beheer → Status → *Kiosktablets* een
koppelcode (30 minuten geldig, één keer te gebruiken). De tablet opent de link of QR-code, of de medewerker typt de
code in op het scherm "Kies je draaitafel". De tablet krijgt een cookie (httpOnly, SameSite=Strict, 400 dagen).
Ontkoppelen kan op dezelfde plek; een verloren of gestolen tablet is daarmee direct uitgesloten.

## Nog open (organisatorisch, niet in de code op te lossen)

Uit de review blijven deze punten bij de organisatie; de code is erop voorbereid waar dat kan:

- **O1/O9** Risico-assessment en privacyverklaring met Juridische Zaken en de FG; opname in het verwerkingsregister.
- **O2** Verwerkersovereenkomsten met Vercel, Supabase en Resend, of overstap naar B&G-infrastructuur. De app draait
  ook on-prem (`server/index.ts` met een eigen Postgres en opslagmap); `server/naarbuiten.ts` is de firewalltabel.
- **O3** Hosting on-prem in het museumnetwerk (kiosk-tablets in een eigen VLAN).
- **O4** OTAP: een aparte acceptatieomgeving met een eigen database, en branch protection op `main`. De bot pusht niet
  meer naar `main` maar opent een pull request.
- **O5** Repository naar de GitHub-organisatie van B&G, privé.
- **O6** Een pentest of vulnerability-scan vóór oplevering (`npm audit` draait al in de CI).
- **O7/O8** Centrale logging, supportniveau, documentatie en overdracht.
- **Mail:** Resend vervangen door het SMTP-relay van B&G (één verwerker minder) zodra dat beschikbaar is.
- **Inloggen:** zodra de Google Workspace-koppeling staat, wachtwoord-inloggen uitzetten (Instellingen); dan zijn er
  geen eigen wachtwoorden meer.

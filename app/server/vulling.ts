// Eerste vulling: fonotheek.db (of de oude Muziekweb-exports), gebruikscollectie (of demo-exemplaren) en de eerste beheerder.
// Wordt gebruikt door de opdrachtregel (scripts/) en bij elke Vercel-build (scripts/vercel-vul.ts); idempotent.
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { all, get, run, ROOT } from './db.ts'
import { exportDelen, leesExportDeel, leesFonotheekDb, type CollectieItem, type MwRecord } from './importers/muziekweb-lezers.ts'
import { koppelLosseExemplaren, leegRapport, rondImportAf, startImport, verwerkRecords } from './importers/muziekweb-verwerk.ts'
import { analyseer, leesBestand, voerDoor, type Regel } from './importers/collectie.ts'
import { maakGebruiker, hashWachtwoord } from './auth.ts'
import { verversWeergave } from './titels.ts'
import { stuurMail } from './mail.ts'
import { ontvangers } from './meldingen.ts'
import { SYSTEEM } from './log.ts'

const WIE = { ...SYSTEEM, naam: 'Eerste vulling' }

/** Laadt de delen van de exportmap die nog niet geladen zijn (bijgehouden in de tabel planner). */
export async function laadExports(map = process.env.FONOS_DUMP_DIR ?? join(ROOT, '..', 'exports'), voortgang = console.log) {
  const delen = exportDelen(map)
  const gedaan = new Set((await all<{ taak: string }>("SELECT taak FROM planner WHERE taak LIKE 'export:%'")).map((r) => r.taak.slice(7)))
  const te = delen.filter((d) => !gedaan.has(d))
  if (!te.length) { voortgang(`Muziekweb-exports: alle ${delen.length} delen al geladen`); return null }
  const importId = await startImport(WIE)
  const rapport = leegRapport(importId)
  for (const d of te) {
    const t0 = Date.now()
    await verwerkRecords(await leesExportDeel(join(map, d)), importId, rapport)
    await run("INSERT INTO planner (taak, datum) VALUES (?, ?) ON CONFLICT (taak) DO UPDATE SET datum = excluded.datum", `export:${d}`, new Date().toISOString().slice(0, 10))
    voortgang(`  ${d}: ${rapport.in_dump} records (${Math.round((Date.now() - t0) / 1000)} s)`)
  }
  return rondImportAf(importId, rapport, WIE, `exportmap (${te.length} delen)`, te.length === delen.length)
}

// In de repo naast app/; in de Vercel-functie naast index.mjs (scripts/bouw-vercel.mjs kopieert hem).
export const FONOTHEEK_DB = [join(ROOT, '..', 'fonotheek.db.gz'), join(dirname(fileURLToPath(import.meta.url)), 'fonotheek.db.gz')].find(existsSync) ?? join(ROOT, '..', 'fonotheek.db.gz')

async function sha1(pad: string) {
  const h = createHash('sha1')
  for await (const d of createReadStream(pad)) h.update(d)
  return h.digest('hex')
}

/** Laadt fonotheek.db(.gz) van de scraper: alle albums als volledige Muziekweb-import, daarna de gebruikscollectie.
 *  Alleen als het bestand veranderd is (planner-rij fonotheek:<sha1>). */
export async function laadFonotheek(pad = process.env.FONOS_FONOTHEEK_DB ?? FONOTHEEK_DB, voortgang = console.log) {
  if (!existsSync(pad)) return false
  const hash = await sha1(pad)
  if (await get('SELECT 1 FROM planner WHERE taak = ?', `fonotheek:${hash}`)) { voortgang(`fonotheek.db: versie ${hash.slice(0, 8)} al geladen`); return true }
  const t0 = Date.now()
  let collectie: CollectieItem[] = []
  const importId = await startImport(WIE)
  const rapport = leegRapport(importId)
  let batch: MwRecord[] = []
  // Rapport (verbetering 16): welke albums zijn nieuw ten opzichte van de vorige versie.
  const eerder = (await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM mw_dump'))!.n > 0
  const nieuw: string[] = []
  let nieuweAlbums = 0
  const verwerk = async (b: MwRecord[]) => {
    if (eerder) {
      const bekend = new Set((await all<{ t: string }>('SELECT titelnummer AS t FROM mw_dump WHERE titelnummer = ANY(?::text[])', `{${b.map((x) => `"${x.titelnummer.replace(/"/g, '')}"`).join(',')}}`)).map((x) => x.t))
      for (const x of b) if (!bekend.has(x.titelnummer)) { nieuweAlbums++; if (nieuw.length < 50) nieuw.push(`${x.titelnummer} ${x.velden.titel ?? ''}`.trim()) }
    }
    await verwerkRecords(b, importId, rapport)
  }
  for await (const r of leesFonotheekDb(pad, { opCollectie: (c) => { collectie = c } })) {
    batch.push(r)
    if (batch.length >= 2000) { await verwerk(batch); batch = []; voortgang(`  ${rapport.in_dump} albums`) }
  }
  if (batch.length) await verwerk(batch)
  const r = await rondImportAf(importId, rapport, WIE, `fonotheek.db (${hash.slice(0, 8)})`, true)
  voortgang(`fonotheek.db: ${r.in_dump} albums, ${r.bijgewerkt} bijgewerkt, ${r.ongewijzigd} ongewijzigd, ${r.nieuwe_conflicten} conflicten (${Math.round((Date.now() - t0) / 1000)} s)`)
  const nieuweExemplaren = await laadCollectieUitFonotheek(collectie, voortgang)
  const verslag = { ...r, nieuwe_albums: nieuweAlbums, nieuwe_albums_voorbeelden: nieuw, nieuwe_exemplaren: nieuweExemplaren, bron: `fonotheek.db (${hash.slice(0, 8)})`, volledig: true, afgerond: true }
  await run('UPDATE imports SET rapport = ? WHERE id = ?', JSON.stringify(verslag), importId)
  // Beheerders krijgen het verslag ook per e-mail (alleen als er een vorige versie was).
  if (eerder) await stuurMail(await ontvangers(), 'Nieuwe versie van fonotheek.db ingelezen', [
    `fonotheek.db (versie ${hash.slice(0, 8)}) is ingelezen.`, '',
    `Nieuwe albums: ${nieuweAlbums}`, `Bijgewerkte titels: ${r.bijgewerkt}`, `Nieuwe titels in de kiosk: ${r.nieuwe_titels}`, `Nieuwe exemplaren: ${nieuweExemplaren}`, `Nieuwe conflicten met Fonos-waarden: ${r.nieuwe_conflicten}`,
    ...(nieuw.length ? ['', 'Bijvoorbeeld:', ...nieuw.slice(0, 20).map((x) => `- ${x}`)] : []), '', 'Het volledige verslag staat onder Beheer → Importeren → Historie.',
  ].join('\n')).catch((e) => console.error('[vulling] verslag mailen mislukt', e))
  await run("INSERT INTO planner (taak, datum) VALUES (?, ?) ON CONFLICT (taak) DO UPDATE SET datum = excluded.datum", `fonotheek:${hash}`, new Date().toISOString().slice(0, 10))
  return true
}

/** Gebruikscollectie uit fonotheek.db. Is er al een echte collectie, dan komen alleen nieuwe exemplaren mét titelnummer erbij;
 *  wijzigingen en afvoeren van bestaande exemplaren lopen via de bulkimport in het beheer (10.6).
 *  Regels zonder titelnummer worden niet ingelezen (zoals eerder de OUD-tabbladen). */
export async function laadCollectieUitFonotheek(items: CollectieItem[], voortgang = console.log): Promise<number> {
  if (!items.length) return 0
  const echte = (await get<{ n: number }>("SELECT COUNT(*)::int AS n FROM exemplaren WHERE bron IS DISTINCT FROM 'demo'"))!.n
  if (!echte) {
    await run("DELETE FROM exemplaren WHERE bron = 'demo' AND id NOT IN (SELECT exemplaar_id FROM aanvraag_items)")
    await run(`DELETE FROM titels t WHERE NOT EXISTS (SELECT 1 FROM exemplaren e WHERE e.titel_id = t.id) AND t.heeft_fonos = 0
      AND NOT EXISTS (SELECT 1 FROM aanvraag_items i WHERE i.titel_id = t.id) AND NOT EXISTS (SELECT 1 FROM selectie_titels s WHERE s.titel_id = t.id)`)
    await run('UPDATE titels SET uitgelicht = 0')
  }
  const bestaand = new Set((await all<{ o: string }>('SELECT objectnummer AS o FROM exemplaren')).map((r) => r.o))
  const regels: Regel[] = items.filter((i) => i.titelnummer && !bestaand.has(i.objectnummer))
    .map((i, n) => ({ objectnummer: i.objectnummer, titelnummer: i.titelnummer, vindcode: null, bron: `fonotheek.db: ${i.lijst}`, regel: n + 1 }))
  if (!regels.length) { voortgang('Gebruikscollectie: geen nieuwe exemplaren'); return 0 }
  const a = await analyseer(regels, 'fonotheek.db')
  const r = await voerDoor(a.token, ['nieuw', 'onbekend', 'dubbel'], WIE)
  voortgang(`Gebruikscollectie: ${JSON.stringify(r.doorgevoerd)}, ${r.nieuwe_titels} nieuwe titels`)
  return (r.doorgevoerd.nieuw ?? 0) + (r.doorgevoerd.onbekend ?? 0)
}

/** Spotify-koppelingen uit spotify/koppelingen.jsonl.gz (gemaakt met scripts/spotify-export.ts).
 *  Alleen titels die nog op 'nog_niet' staan; handmatige keuzes in productie blijven dus altijd staan. */
export async function laadSpotifyKoppelingen(pad = join(ROOT, '..', 'spotify', 'koppelingen.jsonl.gz'), voortgang = console.log) {
  if (!existsSync(pad)) return
  const regels = gunzipSync(readFileSync(pad)).toString('utf8').split('\n').filter(Boolean).map((r) => JSON.parse(r))
  let n = 0
  for (let i = 0; i < regels.length; i += 2000) {
    const r = await run(`UPDATE titels t SET spotify_status = x.s, spotify_album_id = x.a, spotify_score = x.sc, spotify_kandidaat = x.k, spotify_gecontroleerd_op = x.g
      FROM jsonb_to_recordset(?::jsonb) AS x(tn text, s text, a text, sc numeric, k text, g text)
      WHERE t.titelnummer = x.tn AND t.spotify_status = 'nog_niet' AND x.s IN ('auto_goed', 'twijfel', 'geen', 'uitgesloten')`, JSON.stringify(regels.slice(i, i + 2000)))
    n += r.changes
  }
  voortgang(`Spotify-koppelingen: ${n} nieuw van ${regels.length} in het bestand`)
}

/** Eenmalige correctie: plaatsvervangers als "No Artist" uit de afgeleide kolommen en de zoekindex halen. */
export async function herstelPlaatsvervangers(voortgang = console.log) {
  if (await get("SELECT 1 FROM planner WHERE taak = 'herstel:geen-artiest'")) return
  const ids = await all<{ id: number }>(`SELECT id FROM titels WHERE mw_data ~* '"(no artist|unknown artist)"' OR fonos_data ~* '"(no artist|unknown artist)"'`)
  for (const { id } of ids) await verversWeergave(id)
  await run("INSERT INTO planner (taak, datum) VALUES ('herstel:geen-artiest', ?) ON CONFLICT (taak) DO NOTHING", new Date().toISOString().slice(0, 10))
  voortgang(`Plaatsvervangers voor artiesten verwijderd bij ${ids.length} titels`)
}

/** Eenmalige correctie: "voor 1988" gaf ten onrechte jaar 1988. */
export async function herstelJaren(voortgang = console.log) {
  if (await get("SELECT 1 FROM planner WHERE taak = 'herstel:jaar-voor'")) return
  const r = await run(`UPDATE titels SET d_jaar = NULL WHERE d_jaar IS NOT NULL
    AND COALESCE(NULLIF(fonos_data::jsonb->>'uitgave', ''), mw_data::jsonb->>'uitgave') ~* '^\\s*(voor|vóór)\\M'`)
  await run("INSERT INTO planner (taak, datum) VALUES ('herstel:jaar-voor', ?) ON CONFLICT (taak) DO NOTHING", new Date().toISOString().slice(0, 10))
  voortgang(`Jaren hersteld: ${r.changes} titels zonder bekend jaar`)
}

/** De gebruikscollectie uit collectie/gebruikscollectie.csv (objectnummer, titelnummer, bron[, vindcode]). */
export async function laadCollectie(pad = join(ROOT, '..', 'collectie', 'gebruikscollectie.csv'), voortgang = console.log) {
  if (!existsSync(pad)) return false
  const echte = (await get<{ n: number }>("SELECT COUNT(*)::int AS n FROM exemplaren WHERE bron IS DISTINCT FROM 'demo'"))!.n
  if (echte > 0) { voortgang('Gebruikscollectie: al geladen'); return true }
  // Eerder geladen demo-exemplaren maken plaats voor de echte collectie.
  await run("DELETE FROM exemplaren WHERE bron = 'demo' AND id NOT IN (SELECT exemplaar_id FROM aanvraag_items)")
  // Titels die alleen voor de demo bestonden (geen exemplaren, niet door Fonos aangepast) ook weg.
  await run(`DELETE FROM titels t WHERE NOT EXISTS (SELECT 1 FROM exemplaren e WHERE e.titel_id = t.id) AND t.heeft_fonos = 0
    AND NOT EXISTS (SELECT 1 FROM aanvraag_items i WHERE i.titel_id = t.id) AND NOT EXISTS (SELECT 1 FROM selectie_titels s WHERE s.titel_id = t.id)`)
  await run('UPDATE titels SET uitgelicht = 0')
  const { regels, overgeslagen } = await leesBestand(readFileSync(pad), basename(pad))
  const a = await analyseer(regels, basename(pad), overgeslagen)
  const r = await voerDoor(a.token, ['nieuw', 'gewijzigd', 'onbekend', 'dubbel', 'zonder_titelnummer'], WIE)
  voortgang(`Gebruikscollectie: ${JSON.stringify(r.doorgevoerd)}, ${r.nieuwe_titels} titels; overgeslagen tabbladen: ${overgeslagen.length}`)
  return true
}

/** Demo-exemplaren (objectnummer 9xxxxxxxx, bron "demo") als er geen echte collectie is. */
export async function laadDemo(max = 60000, voortgang = console.log) {
  if ((await get<{ n: number }>('SELECT COUNT(*)::int AS n FROM exemplaren'))!.n > 0) return
  await run(`INSERT INTO exemplaren (objectnummer, titelnummer, vindcode, bron)
    SELECT (900000000 + rn)::text, titelnummer,
      chr(65 + (rn % 8)::int) || '-' || lpad(((rn / 8) % 40 + 1)::text, 2, '0') || '-' || lpad(((rn / 64) % 30 + 1)::text, 2, '0'), 'demo'
    FROM (SELECT titelnummer, row_number() OVER (ORDER BY titelnummer) - 1 AS rn FROM mw_dump
          WHERE data::jsonb->'velden'->>'drager' IN ('LP', 'CD') AND data::jsonb->'velden'->>'titel' IS NOT NULL) x
    WHERE rn < ? ON CONFLICT DO NOTHING`, max)
  const n = await koppelLosseExemplaren()
  await run(`UPDATE titels SET uitgelicht = 1 WHERE id IN (SELECT id FROM titels WHERE tip = 1 AND d_hoes IS NOT NULL ORDER BY d_jaar DESC NULLS LAST, titelnummer DESC LIMIT 24)`)
  voortgang(`Demo-exemplaren: ${n} titels aangemaakt`)
}

/** Eerste beheerder uit FONOS_BEHEERDER_EMAIL / FONOS_START_WACHTWOORD, als er nog geen gebruikers zijn. */
export async function zorgVoorBeheerder(voortgang = console.log) {
  const email = process.env.FONOS_BEHEERDER_EMAIL
  const ww = process.env.FONOS_START_WACHTWOORD
  if (!email || !ww) return
  const g = await get<{ id: number }>('SELECT id FROM gebruikers WHERE lower(email) = lower(?)', email)
  if (g) return
  await maakGebruiker({ email, naam: process.env.FONOS_BEHEERDER_NAAM ?? 'Beheerder', rollen: ['beheerder', 'redacteur', 'medewerker'], wachtwoord: ww })
  voortgang(`Beheerder ${email} aangemaakt`)
}

export { hashWachtwoord }

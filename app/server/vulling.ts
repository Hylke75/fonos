// Eerste vulling: Muziekweb-exports, gebruikscollectie (of demo-exemplaren) en de eerste beheerder.
// Wordt gebruikt door de opdrachtregel (scripts/) en bij elke Vercel-build (scripts/vercel-vul.ts); idempotent.
import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { basename, join } from 'node:path'
import { all, get, run, ROOT } from './db.ts'
import { exportDelen, leesExportDeel } from './importers/muziekweb-lezers.ts'
import { koppelLosseExemplaren, leegRapport, rondImportAf, startImport, verwerkRecords } from './importers/muziekweb-verwerk.ts'
import { analyseer, leesBestand, voerDoor } from './importers/collectie.ts'
import { maakGebruiker, hashWachtwoord } from './auth.ts'
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

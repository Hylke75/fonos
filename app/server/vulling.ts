// Eerste vulling: Muziekweb-exports, gebruikscollectie (of demo-exemplaren) en de eerste beheerder.
// Wordt gebruikt door de opdrachtregel (scripts/) en bij elke Vercel-build (scripts/vercel-vul.ts); idempotent.
import { existsSync, readFileSync } from 'node:fs'
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
  return rondImportAf(importId, rapport, WIE, `exportmap (${te.length} delen)`)
}

/** De gebruikscollectie uit collectie/gebruikscollectie.csv (objectnummer, titelnummer, bron[, vindcode]). */
export async function laadCollectie(pad = join(ROOT, '..', 'collectie', 'gebruikscollectie.csv'), voortgang = console.log) {
  if (!existsSync(pad)) return false
  const echte = (await get<{ n: number }>("SELECT COUNT(*)::int AS n FROM exemplaren WHERE bron IS DISTINCT FROM 'demo'"))!.n
  if (echte > 0) { voortgang('Gebruikscollectie: al geladen'); return true }
  // Eerder geladen demo-exemplaren maken plaats voor de echte collectie.
  await run("DELETE FROM exemplaren WHERE bron = 'demo' AND id NOT IN (SELECT exemplaar_id FROM aanvraag_items)")
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

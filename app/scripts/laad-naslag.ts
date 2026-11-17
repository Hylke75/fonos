// Muziekweb-naslag (alle LP's en cd's buiten de gebruikscollectie) in mw_dump laden, in delen en hervatbaar.
//   python collectie/schoon.py --alles --out data/fonotheek-alles.db   (in de repo-root)
//   FONOS_DB_RELAY=… FONOS_DB_RELAY_SLEUTEL=… npm run laad:naslag -- ../data/fonotheek-alles.db
// Alleen mw_dump (en titels die al bestaan) worden bijgewerkt; de gebruikscollectie blijft ongemoeid.
// Daarna worden exemplaren met een titelnummer die nu bekend zijn gekoppeld (rondImportAf).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { leesFonotheekDb, fonotheekAlbums, type MwRecord } from '../server/importers/muziekweb-lezers.ts'
import { leegRapport, rondImportAf, startImport, verwerkRecords } from '../server/importers/muziekweb-verwerk.ts'
import { SYSTEEM } from '../server/log.ts'

const pad = resolve(process.argv[2] ?? '../data/fonotheek-alles.db')
const voortgangBestand = `${pad}.voortgang`
const DEEL = 2000
const WIE = { ...SYSTEEM, naam: 'Muziekweb-naslag' }

const totaal = await fonotheekAlbums(pad)
let vanaf = existsSync(voortgangBestand) ? Number(readFileSync(voortgangBestand, 'utf8')) || 0 : 0
console.log(`${totaal} albums in ${pad}; verder vanaf ${vanaf}`)
const importId = await startImport(WIE)
const rapport = leegRapport(importId)
const t0 = Date.now()
while (vanaf < totaal) {
  const blok: MwRecord[] = []
  for await (const r of leesFonotheekDb(pad, { vanaf, aantal: DEEL })) blok.push(r)
  if (!blok.length) break
  await verwerkRecords(blok, importId, rapport)
  vanaf += DEEL
  writeFileSync(voortgangBestand, String(vanaf))
  const s = (Date.now() - t0) / 1000
  console.log(`  ${Math.min(vanaf, totaal)}/${totaal}  (${rapport.bijgewerkt} bestaande titels bijgewerkt, ${Math.round(rapport.in_dump / s)} albums/s)`)
}
const r = await rondImportAf(importId, rapport, WIE, `Muziekweb-naslag (${totaal} albums)`, false)
console.log(`Klaar: ${r.in_dump} albums, ${r.nieuwe_titels} exemplaren gekoppeld, ${Math.round((Date.now() - t0) / 1000)} s`)
process.exit(0)

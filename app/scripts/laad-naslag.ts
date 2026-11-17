// Muziekweb-naslag (alle LP's en cd's buiten de gebruikscollectie) laden, in delen en hervatbaar.
//   python collectie/schoon.py --alles --out data/fonotheek-alles.db   (in de repo-root)
//   FONOS_DB_RELAY=… FONOS_DB_RELAY_SLEUTEL=… npm run laad:naslag -- ../data/fonotheek-alles.db [--titels]
// Zonder --titels: alleen mw_dump (en titels die al bestaan) bijwerken.
// Met --titels: ook titels in de kiosk (collectie 'muziekweb'); cd's krijgen een exemplaar en zijn aan te vragen,
// lp's zijn alleen te bekijken. De gebruikscollectie blijft ongemoeid.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { leesFonotheekDb, fonotheekAlbums, type MwRecord } from '../server/importers/muziekweb-lezers.ts'
import { leegRapport, maakNaslagTitels, rondImportAf, startImport, verwerkRecords } from '../server/importers/muziekweb-verwerk.ts'
import { SYSTEEM } from '../server/log.ts'
import { warmTellingen } from '../server/catalogus.ts'

const args = process.argv.slice(2)
const titels = args.includes('--titels')
const pad = resolve(args.find((a) => !a.startsWith('--')) ?? '../data/fonotheek-alles.db')
const voortgangBestand = `${pad}.voortgang${titels ? '-titels' : ''}`
const DEEL = 2000
const WIE = { ...SYSTEEM, naam: 'Muziekweb-naslag' }

const totaal = await fonotheekAlbums(pad)
let vanaf = existsSync(voortgangBestand) ? Number(readFileSync(voortgangBestand, 'utf8')) || 0 : 0
console.log(`${totaal} albums in ${pad}; verder vanaf ${vanaf}${titels ? ' (met titels in de kiosk)' : ''}`)
const importId = await startImport(WIE)
const rapport = leegRapport(importId)
const t0 = Date.now()
let nieuweTitels = 0
while (vanaf < totaal) {
  const blok: MwRecord[] = []
  for await (const r of leesFonotheekDb(pad, { vanaf, aantal: DEEL })) blok.push(r)
  if (!blok.length) break
  await verwerkRecords(blok, importId, rapport)
  if (titels) nieuweTitels += await maakNaslagTitels(blok)
  vanaf += DEEL
  writeFileSync(voortgangBestand, String(vanaf))
  const s = (Date.now() - t0) / 1000
  console.log(`  ${Math.min(vanaf, totaal)}/${totaal}  (${rapport.bijgewerkt} bijgewerkt, ${nieuweTitels} nieuwe titels, ${Math.round(rapport.in_dump / s)} albums/s)`)
}
const r = await rondImportAf(importId, rapport, WIE, `Muziekweb-naslag (${totaal} albums)`, false)
console.log(`Klaar: ${r.in_dump} albums, ${nieuweTitels} nieuwe titels, ${r.nieuwe_titels} exemplaren gekoppeld, ${Math.round((Date.now() - t0) / 1000)} s`)
// De kiosk telt bij bladeren uit een cache: die meteen bijwerken.
if (titels) console.log(`Tellingen bijgewerkt: ${await warmTellingen()} ingangen`)
process.exit(0)

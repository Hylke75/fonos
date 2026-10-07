// Eerste vulling van de exemplaren (fase 1): npm run import:collectie -- Klassiek.xlsx Populair.xlsx (of een .csv)
// Alle categorieën uit het controle-overzicht worden doorgevoerd, behalve het afvoeren van ontbrekende
// exemplaren. Twijfelgevallen komen in de datakwaliteitslijsten (bijlage B), niet stilzwijgend in de app.
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { analyseer, leesBestand, samenvatting, voerDoor, type Regel } from '../server/importers/collectie.ts'
import { SYSTEEM } from '../server/log.ts'

const bestanden = process.argv.slice(2)
if (!bestanden.length) { console.error('Gebruik: npm run import:collectie -- <bestand.xlsx|csv> [...]'); process.exit(1) }
const regels: Regel[] = []
const overgeslagen: string[] = []
for (const b of bestanden) {
  const r = await leesBestand(readFileSync(b), basename(b))
  regels.push(...r.regels)
  overgeslagen.push(...r.overgeslagen.map((t) => `${basename(b)} / ${t}`))
}
const a = await analyseer(regels, bestanden.map((b) => basename(b)).join(' + '), overgeslagen)
for (const c of samenvatting(a).categorieen) console.log(`${String(c.aantal).padStart(7)}  ${c.naam}`)
if (overgeslagen.length) console.log(`Overgeslagen (open punt O-6): ${overgeslagen.length} tabbladen`)
const rapport = await voerDoor(a.token, ['nieuw', 'gewijzigd', 'onbekend', 'dubbel', 'zonder_titelnummer'], { ...SYSTEEM, naam: 'Eerste vulling' })
console.log(JSON.stringify(rapport, null, 2))
process.exit(0)

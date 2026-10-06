// Planner: automatisch afsluiten bij sluitingstijd (8), nachtelijke back-up (12.3), nieuwsbrief-wachtrij (11).
import { instellingen, get } from './db.ts'
import { sluitAllesAf } from './aanvragen.ts'
import { maakBackup } from './backup.ts'
import { probeerWachtrij } from './nieuwsbrief.ts'
import { SYSTEEM } from './log.ts'

const gedaan = new Map<string, string>() // taak -> datum waarop uitgevoerd

const nuHHMM = () => new Date().toTimeString().slice(0, 5)
const vandaag = () => new Date().toLocaleDateString('sv-SE')

async function tik() {
  const inst = instellingen()
  const tijd = nuHHMM()
  if (tijd >= inst.sluitingstijd && gedaan.get('sluiten') !== vandaag()) {
    gedaan.set('sluiten', vandaag())
    const n = sluitAllesAf('sluitingstijd', { ...SYSTEEM, naam: 'Automatisch (sluitingstijd)' })
    if (n) console.log(`[planner] ${n} open aanvragen afgesloten bij sluitingstijd`)
  }
  if (tijd >= inst.backup_tijd && gedaan.get('backup') !== vandaag()) {
    gedaan.set('backup', vandaag())
    const al = get("SELECT 1 FROM backups WHERE soort = 'dagelijks' AND status = 'gelukt' AND date(tijd, 'localtime') = date('now', 'localtime')")
    if (!al) maakBackup('dagelijks').then((b) => console.log(`[planner] back-up ${b.bestand}`)).catch((e) => console.error('[planner] back-up mislukt', e))
  }
  await probeerWachtrij().catch(() => {})
}

export function startPlanner() {
  // Bij opstarten na sluitingstijd: vandaag niet alsnog alles sluiten als de server overdag herstart.
  const inst = instellingen()
  if (nuHHMM() >= inst.sluitingstijd) gedaan.set('sluiten', vandaag())
  setInterval(() => { tik().catch((e) => console.error('[planner]', e)) }, 60_000)
}

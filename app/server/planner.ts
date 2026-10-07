// Planner: automatisch afsluiten bij sluitingstijd (8), nachtelijke back-up (12.3), nieuwsbrief-wachtrij (11).
// Op Vercel draait er geen proces continu: de planner loopt mee met verzoeken (hooguit eens per minuut)
// en daarnaast via de Vercel Cron-job (/api/cron).
import { all, instellingen, get, run } from './db.ts'
import { sluitAf, sluitAllesAf, geefInactieveSpelersVrij } from './aanvragen.ts'
import { aanvragenGewijzigd, beschikbaarheidGewijzigd } from './events.ts'
import { maakBackup } from './backup.ts'
import { probeerWachtrij } from './nieuwsbrief.ts'
import { SYSTEEM } from './log.ts'

const TZ = 'Europe/Amsterdam'
const nuHHMM = () => new Date().toLocaleTimeString('nl-NL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ })

/** Claimt een taak voor vandaag; true als deze aanroep hem mag uitvoeren. */
async function claim(taak: string): Promise<boolean> {
  const r = await run(`INSERT INTO planner (taak, datum) VALUES (?, ?) ON CONFLICT (taak) DO UPDATE SET datum = excluded.datum
    WHERE planner.datum < excluded.datum`, taak, vandaag())
  return r.changes > 0
}

let laatsteTik = 0

/** Sluitingstijd van vandaag: per weekdag instelbaar, anders de algemene sluitingstijd (10.10). */
export function sluitingVandaag(inst: Record<string, any>, nu = new Date()) {
  const weekdag = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', weekday: 'short' }).format(nu)
  const dag = { Sun: 'zo', Mon: 'ma', Tue: 'di', Wed: 'wo', Thu: 'do', Fri: 'vr', Sat: 'za' }[weekdag] ?? ''
  return (inst[`sluitingstijd_${dag}`] || inst.sluitingstijd) as string
}

/** cron: aangeroepen door Vercel Cron; dat moment is de nachtelijke back-up, ongeacht het ingestelde tijdstip. */
export async function tik(opts: { backup?: boolean; cron?: boolean } = {}) {
  const inst = await instellingen()
  const tijd = nuHHMM()
  if (tijd >= sluitingVandaag(inst) && (await claim('sluiten'))) {
    const n = await sluitAllesAf('sluitingstijd', { ...SYSTEEM, naam: 'Automatisch (sluitingstijd)' })
    if (n) console.log(`[planner] ${n} open aanvragen afgesloten bij sluitingstijd`)
  }
  // Draaide de planner gisteren niet op tijd: aanvragen van een eerdere dag alsnog afsluiten (8).
  const oud = await all<{ id: number }>(`SELECT id FROM aanvragen WHERE status IN ('ingediend', 'uitgegeven')
    AND ((ingediend_op || '+00')::timestamptz AT TIME ZONE 'Europe/Amsterdam')::date < (now() AT TIME ZONE 'Europe/Amsterdam')::date`)
  for (const a of oud) await sluitAf(a.id, 'sluitingstijd', { ...SYSTEEM, naam: 'Automatisch (sluitingstijd)' })
  if (oud.length) { await aanvragenGewijzigd(); await beschikbaarheidGewijzigd() }
  // Platenspelers die te lang niet gebruikt zijn automatisch vrijgeven.
  await geefInactieveSpelersVrij().catch((e) => console.error('[planner] vrijgeven mislukt', e))
  if (opts.backup && (opts.cron || tijd >= inst.backup_tijd)) {
    const al = await get(`SELECT 1 FROM backups WHERE soort = 'dagelijks' AND status = 'gelukt' AND left(tijd, 10) = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)
    if (!al && (await claim('backup'))) {
      // Mislukt: claim vrijgeven, zodat een volgende tik het dezelfde dag opnieuw probeert (12.3).
      await maakBackup('dagelijks').catch(async (e) => { console.error('[planner] back-up mislukt', e); await run("DELETE FROM planner WHERE taak = 'backup'") })
    }
  }
  await probeerWachtrij().catch(() => {})
  // Nieuwsbriefaanmeldingen na de bewaartermijn verwijderen (alleen geëxporteerde).
  const bewaar = Number(inst.nieuwsbrief_bewaar_dagen)
  if (bewaar > 0) await run("DELETE FROM nieuwsbrief_aanmeldingen WHERE geexporteerd_op IS NOT NULL AND geexporteerd_op < nu(?::interval)", `-${bewaar} days`).catch(() => {})
}

/** Hooguit eens per minuut, niet-blokkerend, vanuit gewone verzoeken. */
export function tikTerloops() {
  if (Date.now() - laatsteTik < 60_000) return
  laatsteTik = Date.now()
  tik().catch((e) => console.error('[planner]', e))
}


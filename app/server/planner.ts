// Planner: automatisch afsluiten bij sluitingstijd (8), nachtelijke back-up (12.3), nieuwsbrief-wachtrij (11).
// Op Vercel draait er geen proces continu: de planner loopt mee met verzoeken (hooguit eens per minuut)
// en daarnaast via de Vercel Cron-job (/api/cron).
import { all, instellingen, get, run } from './db.ts'
import { sluitAf, sluitAllesAf, geefInactieveSpelersVrij } from './aanvragen.ts'
import { aanvragenGewijzigd, beschikbaarheidGewijzigd } from './events.ts'
import { maakBackup } from './backup.ts'
import { verdeel } from './wachtlijst.ts'
import { controleerHoezen } from './hoezen.ts'
import { probeerWachtrij } from './nieuwsbrief.ts'
import { log, SYSTEEM } from './log.ts'
import { meld, ontvangers } from './meldingen.ts'
import { stuurMail } from './mail.ts'

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
  // Wachtlijst: verlopen reserveringen opruimen en vrije spelers toewijzen.
  await verdeel().catch((e) => console.error('[planner] wachtlijst mislukt', e))
  if (opts.backup && (opts.cron || tijd >= inst.backup_tijd)) {
    const al = await get(`SELECT 1 FROM backups WHERE soort = 'dagelijks' AND status = 'gelukt' AND left(tijd, 10) = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')`)
    if (!al && (await claim('backup'))) {
      // Mislukt: claim vrijgeven, zodat een volgende tik het dezelfde dag opnieuw probeert (12.3).
      await maakBackup('dagelijks').catch(async (e) => { console.error('[planner] back-up mislukt', e); await run("DELETE FROM planner WHERE taak = 'backup'") })
    }
  }
  // Hoezen controleren: alleen bij de nachtelijke cron (die mag tot 5 minuten duren).
  if (opts.cron && (await claim('hoezen'))) await controleerHoezen().then((r) => console.log(`[planner] hoezen: ${r.gecontroleerd} gecontroleerd, ${r.kapot} kapot`)).catch((e) => console.error('[planner] hoezen mislukt', e))
  await probeerWachtrij().catch(() => {})
  // Nieuwsbriefaanmeldingen na de bewaartermijn verwijderen (alleen geëxporteerde).
  const bewaar = Number(inst.nieuwsbrief_bewaar_dagen)
  if (bewaar > 0) await run("DELETE FROM nieuwsbrief_aanmeldingen WHERE geexporteerd_op IS NOT NULL AND geexporteerd_op < nu(?::interval)", `-${bewaar} days`).catch(() => {})
  // Eens per dag: accounts, log van aanmeldingen en de controle op back-ups (IT-beleid 6.2, 6.3, 8.4).
  if (await claim('dagelijkse-controles')) await dagelijkseControles(inst).catch((e) => console.error('[planner] controles mislukt', e))
}

export async function dagelijkseControles(inst: Record<string, any>) {
  const dag = vandaag()
  // Log van aanmeldingen niet langer bewaren dan ingesteld.
  const dagen = Number(inst.aanmeldingen_bewaar_dagen)
  if (dagen > 0) await run('DELETE FROM aanmeldingen WHERE tijd < nu(?::interval)', `-${dagen} days`)
  // Accounts met een einddatum: herinnering vooraf (verlenging via HR), en vastleggen dat ze verlopen zijn.
  const vooraf = Math.max(0, Number(inst.account_herinnering_dagen) || 0)
  const grens = new Date(Date.now() + vooraf * 86_400_000).toLocaleDateString('sv-SE', { timeZone: TZ })
  const bijna = await all<any>('SELECT id, naam, email, soort_account, geldig_tot FROM gebruikers WHERE actief = 1 AND geldig_tot IS NOT NULL AND geldig_tot >= ? AND geldig_tot <= ?', dag, grens)
  for (const g of bijna) {
    const r = await run('INSERT INTO planner (taak, datum) VALUES (?, ?) ON CONFLICT (taak) DO NOTHING', `account-herinnering:${g.id}:${g.geldig_tot}`, dag)
    if (!r.changes) continue
    const tekst = `Het Fonotheek-account van ${g.naam} (${g.email}, ${g.soort_account}) verloopt na ${g.geldig_tot}.\n\nVerlenging gaat via HR (IT-beleid 8.4); daarna past een beheerder de einddatum aan onder Beheer → Gebruikers.`
    await stuurMail([...new Set([g.email, ...(await ontvangers())])], 'Fonotheek-account verloopt binnenkort', tekst).catch((e) => console.error('[planner] herinnering mislukt', e))
  }
  const verlopen = await all<any>('SELECT id, naam, geldig_tot FROM gebruikers WHERE actief = 1 AND geldig_tot IS NOT NULL AND geldig_tot < ?', dag)
  for (const g of verlopen) {
    const r = await run('INSERT INTO planner (taak, datum) VALUES (?, ?) ON CONFLICT (taak) DO NOTHING', `account-verlopen:${g.id}:${g.geldig_tot}`, dag)
    if (!r.changes) continue
    await run('DELETE FROM sessies WHERE gebruiker_id = ?', g.id)
    await log(SYSTEEM, 'account verlopen', { type: 'gebruiker', id: g.id, label: g.naam, nieuw: { geldig_tot: g.geldig_tot } })
  }
  // Geen geslaagde back-up in de laatste 26 uur (terwijl de nachtelijke cron wel loopt): melden.
  const cron = await get('SELECT 1 FROM planner WHERE taak = ?', 'cron:laatst')
  const recent = await get("SELECT 1 FROM backups WHERE status = 'gelukt' AND tijd > nu('-26 hours')")
  if (cron && !recent) await meld('backup-oud', 'Geen recente back-up', 'Er is in de laatste 26 uur geen geslaagde back-up gemaakt. Kijk bij Beheer → Back-ups en Beheer → Status.')
}

/** Hooguit eens per minuut, niet-blokkerend, vanuit gewone verzoeken. */
export function tikTerloops() {
  if (Date.now() - laatsteTik < 60_000) return
  laatsteTik = Date.now()
  tik().catch((e) => console.error('[planner]', e))
}


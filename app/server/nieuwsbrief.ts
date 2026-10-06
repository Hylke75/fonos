// Nieuwsbrief-aanmelding (11). Losse module: het nieuwsbriefsysteem van Fonos is nog open (O-4).
// De app slaat de gegevens niet op. Is het systeem onbereikbaar, dan blijft de aanmelding maximaal
// 24 uur in het geheugen voor een nieuwe poging; daarna vervalt ze (gelogd zonder persoonsgegevens).
import { instellingen } from './db.ts'
import { log, SYSTEEM } from './log.ts'

export type Aanmelding = { email: string; naam?: string | null }
type Wacht = Aanmelding & { sinds: number; pogingen: number }

const wachtrij: Wacht[] = []
const MAX_MS = 24 * 3600_000
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Koppelingen per nieuwsbriefsysteem. Een nieuw systeem = een nieuwe functie hier. */
const koppelingen: Record<string, (a: Aanmelding) => Promise<void>> = {
  geen: async () => { console.log('[nieuwsbrief] geen koppeling ingesteld (open punt O-4); aanmelding niet doorgestuurd') },
  webhook: async (a) => {
    const inst = instellingen()
    if (!inst.nieuwsbrief_url) throw new Error('Geen webhook-adres ingesteld')
    const r = await fetch(inst.nieuwsbrief_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Het nieuwsbriefsysteem verstuurt zelf de bevestigingsmail (double opt-in).
      body: JSON.stringify({ email: a.email, naam: a.naam ?? null, bron: inst.nieuwsbrief_bron }),
    })
    if (!r.ok) throw new Error(`Nieuwsbriefsysteem antwoordde ${r.status}`)
  },
}

async function verstuur(a: Aanmelding) {
  const k = koppelingen[instellingen().nieuwsbrief_koppeling] ?? koppelingen.geen
  await k(a)
}

export async function meldAan(a: Aanmelding): Promise<'verstuurd' | 'in_wachtrij'> {
  try {
    await verstuur(a)
    return 'verstuurd'
  } catch {
    wachtrij.push({ ...a, sinds: Date.now(), pogingen: 1 })
    return 'in_wachtrij'
  }
}

/** Wordt elke paar minuten door de planner aangeroepen. */
export async function probeerWachtrij() {
  for (const w of [...wachtrij]) {
    const i = wachtrij.indexOf(w)
    if (Date.now() - w.sinds > MAX_MS) {
      wachtrij.splice(i, 1)
      log(SYSTEEM, 'nieuwsbriefaanmelding mislukt', { type: 'nieuwsbrief', nieuw: `na ${w.pogingen} pogingen verwijderd` })
      continue
    }
    try {
      await verstuur(w)
      wachtrij.splice(wachtrij.indexOf(w), 1)
    } catch { w.pogingen++ }
  }
}
export const wachtrijLengte = () => wachtrij.length

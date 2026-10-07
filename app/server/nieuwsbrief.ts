// Nieuwsbrief-aanmelding (11). Losse module met koppelingen (O-4):
// - beheer: de aanmelding wordt bewaard in de beheeromgeving (Nieuwsbrief), waar een beheerder ze exporteert;
// - webhook: direct doorsturen naar een extern nieuwsbriefsysteem (dat verstuurt de bevestigingsmail);
// - geen: niets doen.
// Bij een storing blijft de aanmelding maximaal 24 uur in een wachtrij; daarna vervalt ze (gelogd zonder persoonsgegevens).
import { all, insert, instellingen, run } from './db.ts'
import { log, SYSTEEM } from './log.ts'

export type Aanmelding = { email: string; naam?: string | null }
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Koppelingen per nieuwsbriefsysteem. Een nieuw systeem = een nieuwe functie hier. */
const koppelingen: Record<string, (a: Aanmelding) => Promise<void>> = {
  geen: async () => { console.log('[nieuwsbrief] geen koppeling ingesteld (open punt O-4); aanmelding niet doorgestuurd') },
  beheer: async (a) => {
    const inst = await instellingen()
    // Opnieuw aanmelden met hetzelfde adres: naam bijwerken en opnieuw laten meetellen voor de volgende export.
    await run(`INSERT INTO nieuwsbrief_aanmeldingen (email, naam, bron) VALUES (?, ?, ?)
      ON CONFLICT (lower(email)) DO UPDATE SET naam = COALESCE(excluded.naam, nieuwsbrief_aanmeldingen.naam), aangemeld_op = nu(), geexporteerd_op = NULL`,
      a.email, a.naam ?? null, inst.nieuwsbrief_bron || null)
  },
  webhook: async (a) => {
    const inst = await instellingen()
    if (!inst.nieuwsbrief_url) throw new Error('Geen webhook-adres ingesteld')
    const r = await fetch(inst.nieuwsbrief_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Het nieuwsbriefsysteem verstuurt zelf de bevestigingsmail (double opt-in).
      body: JSON.stringify({ email: a.email, naam: a.naam ?? null, bron: inst.nieuwsbrief_bron }),
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) throw new Error(`Nieuwsbriefsysteem antwoordde ${r.status}`)
  },
}

async function verstuur(a: Aanmelding) {
  const k = koppelingen[(await instellingen()).nieuwsbrief_koppeling] ?? koppelingen.geen
  await k(a)
}

export async function meldAan(a: Aanmelding): Promise<'verstuurd' | 'in_wachtrij'> {
  try {
    await verstuur(a)
    return 'verstuurd'
  } catch {
    await insert('INSERT INTO nieuwsbrief_wachtrij (email, naam) VALUES (?, ?)', a.email, a.naam ?? null)
    return 'in_wachtrij'
  }
}

/** Wordt door de planner aangeroepen. */
export async function probeerWachtrij() {
  const verlopen = await run("DELETE FROM nieuwsbrief_wachtrij WHERE sinds < nu('-24 hours')")
  if (verlopen.changes) await log(SYSTEEM, 'nieuwsbriefaanmelding mislukt', { type: 'nieuwsbrief', nieuw: `${verlopen.changes} aanmelding(en) na 24 uur verwijderd` })
  for (const w of await all<any>('SELECT * FROM nieuwsbrief_wachtrij ORDER BY id LIMIT 20')) {
    try {
      await verstuur(w)
      await run('DELETE FROM nieuwsbrief_wachtrij WHERE id = ?', w.id)
    } catch { await run('UPDATE nieuwsbrief_wachtrij SET pogingen = pogingen + 1 WHERE id = ?', w.id) }
  }
}

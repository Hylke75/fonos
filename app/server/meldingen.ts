// Storingsmeldingen voor beheerders (IT-beleid 6.2): per soort hooguit één e-mail per dag.
// Ontvangers: alle actieve beheerders plus de adressen in de instelling beheer_meldingen_adres (bv. de Topdesk-mailbox).
import { all, instellingen, run } from './db.ts'
import { log, SYSTEEM } from './log.ts'
import { stuurMail } from './mail.ts'

const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' })

export async function ontvangers(): Promise<string[]> {
  const inst = await instellingen()
  const beheerders = (await all<{ email: string }>("SELECT email FROM gebruikers WHERE actief = 1 AND rollen LIKE '%beheerder%'")).map((g) => g.email)
  const extra = String(inst.beheer_meldingen_adres ?? '').split(/[\s,;]+/).filter((a) => a.includes('@'))
  return [...new Set([...beheerders, ...extra].map((a) => a.trim().toLowerCase()))]
}

/** Stuurt een melding, tenzij er vandaag al een van dezelfde soort is verstuurd. Faalt nooit. */
export async function meld(soort: string, onderwerp: string, tekst: string): Promise<boolean> {
  try {
    const r = await run(`INSERT INTO planner (taak, datum) VALUES (?, ?) ON CONFLICT (taak) DO UPDATE SET datum = excluded.datum
      WHERE planner.datum < excluded.datum`, `melding:${soort}`.slice(0, 200), vandaag())
    if (!r.changes) return false
    await log(SYSTEEM, 'storingsmelding', { type: 'melding', id: soort, label: onderwerp, nieuw: tekst.slice(0, 2000) })
    const aan = await ontvangers()
    if (aan.length) await stuurMail(aan, `[Fonotheek] ${onderwerp}`, `${tekst}\n\n— Automatische melding van de Fonotheek (${process.env.FONOS_BASIS_URL ?? 'fonos-five.vercel.app'}). Status: /beheer/status`)
    return true
  } catch (e) {
    console.error('[melding] versturen mislukt', e)
    return false
  }
}

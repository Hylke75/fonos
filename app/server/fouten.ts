// Fouten naar buiten (securityreview kandidaat 4): alleen bedoelde meldingen bereiken de client; al het andere is
// een algemene tekst met een referentie, de details staan in het serverlog en in de storingsmelding.
import { randomBytes } from 'node:crypto'

/** Een fout die voor de gebruiker bedoeld is: de tekst gaat zoals hij is naar de client. */
export class GebruikersFout extends Error {
  constructor(bericht: string, public status: 400 | 401 | 403 | 404 | 409 | 413 | 429 = 400, public code?: string) { super(bericht) }
}

export const referentie = () => randomBytes(4).toString('hex')

/** Fouten van de database, het bestandssysteem of het runtime zelf: nooit de tekst naar buiten. */
export function isIntern(e: any): boolean {
  if (!e || typeof e !== 'object') return true
  if (e instanceof GebruikersFout) return false
  if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || e instanceof SyntaxError) return true
  if (e.name === 'PostgresError' || 'severity' in e || 'errno' in e || 'syscall' in e) return true
  if (typeof e.code === 'string' && /^([0-9A-Z]{5}|E[A-Z]+)$/.test(e.code)) return true // SQLSTATE of ENOENT e.d.
  return false
}

/** De tekst voor een catch-blok in een beheerroute: een eigen melding (throw new Error('…')) blijft staan,
 *  een interne fout wordt "Er ging iets mis (referentie …)" en komt in het serverlog. */
export function foutTekst(e: any): string {
  if (!isIntern(e)) return String(e?.message ?? 'Er ging iets mis')
  const ref = referentie()
  console.error(`[fout ${ref}]`, e)
  return `Er ging iets mis (referentie ${ref}).`
}

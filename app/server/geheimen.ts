// Geheimen (securityreview kandidaat 5): maken, als hash opslaan, timing-safe vergelijken en versleutelen at rest.
// Securitybeleid 2.1.2: geen geheimen in platte tekst in de database. Tokens (sessie, reset, kiosk, koppelcode) staan
// er alleen als sha256-hash; geheimen die we terug moeten kunnen lezen (TOTP, VAPID) versleuteld met AES-256-GCM
// onder FONOS_GEHEIM_SLEUTEL (een sleutel die niet in de database staat, dus een databasedump is niet genoeg).
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** Een nieuw willekeurig token (hex). */
export const nieuwToken = (bytes = 32) => randomBytes(bytes).toString('hex')

/** Zo staat een token in de database: nooit het token zelf. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** Vergelijkt twee geheimen in constante tijd (ook bij verschillende lengte). */
export function gelijk(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb) && a.length === b.length
}

const PREFIX = 'v1:'
function sleutel(): Buffer | null {
  const s = process.env.FONOS_GEHEIM_SLEUTEL
  return s ? createHash('sha256').update(s).digest() : null // elke lengte; afgeleid tot 32 bytes
}
export const versleutelingAan = () => !!sleutel()

/** Versleutelt een geheim voor opslag. Zonder FONOS_GEHEIM_SLEUTEL blijft het leesbaar (Beheer → Status waarschuwt). */
export function versleutel(tekst: string): string {
  const k = sleutel()
  if (!k) return tekst
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', k, iv)
  const ct = Buffer.concat([c.update(tekst, 'utf8'), c.final()])
  return `${PREFIX}${iv.toString('base64url')}:${c.getAuthTag().toString('base64url')}:${ct.toString('base64url')}`
}

/** Leest een opgeslagen geheim; oude, nog niet versleutelde waarden komen ongewijzigd terug. */
export function ontsleutel(opgeslagen: string): string {
  if (!opgeslagen.startsWith(PREFIX)) return opgeslagen
  const k = sleutel()
  if (!k) throw new Error('FONOS_GEHEIM_SLEUTEL ontbreekt: versleutelde geheimen zijn niet te lezen')
  const [iv, tag, ct] = opgeslagen.slice(PREFIX.length).split(':').map((d) => Buffer.from(d, 'base64url'))
  const d = createDecipheriv('aes-256-gcm', k, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
}

/** Staat dit geheim nog leesbaar opgeslagen terwijl er wel een sleutel is? Dan bij de volgende keer opnieuw opslaan. */
export const moetVersleuteld = (opgeslagen: string) => versleutelingAan() && !opgeslagen.startsWith(PREFIX)

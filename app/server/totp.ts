// Tweestapsverificatie (IT-beleid 6.1): tijdgebonden codes volgens RFC 6238 (TOTP, SHA-1, 6 cijfers, 30 s),
// zoals Google Authenticator, Microsoft Authenticator en 1Password ze maken.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const ALFABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STAP = 30

export function base32(buf: Buffer): string {
  let bits = 0, waarde = 0, uit = ''
  for (const b of buf) {
    waarde = (waarde << 8) | b; bits += 8
    while (bits >= 5) { uit += ALFABET[(waarde >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) uit += ALFABET[(waarde << (5 - bits)) & 31]
  return uit
}

export function uitBase32(s: string): Buffer {
  const schoon = s.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0, waarde = 0
  const uit: number[] = []
  for (const c of schoon) {
    const i = ALFABET.indexOf(c)
    if (i < 0) throw new Error('Ongeldige base32')
    waarde = (waarde << 5) | i; bits += 5
    if (bits >= 8) { uit.push((waarde >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(uit)
}

export const nieuwGeheim = () => base32(randomBytes(20))

export function code(geheim: string, stap: number): string {
  const teller = Buffer.alloc(8)
  teller.writeBigUInt64BE(BigInt(stap))
  const h = createHmac('sha1', uitBase32(geheim)).update(teller).digest()
  const o = h[h.length - 1] & 15
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000
  return String(n).padStart(6, '0')
}

export const huidigeStap = (ms = Date.now()) => Math.floor(ms / 1000 / STAP)

/** Controleert een code (één stap speling voor klokverschil). Geeft de gebruikte stap terug, of null. */
export function controleer(geheim: string, invoer: string, ms = Date.now(), laatsteStap?: number | null): number | null {
  const c = (invoer ?? '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(c)) return null
  const nu = huidigeStap(ms)
  for (const s of [nu, nu - 1, nu + 1]) {
    // Een code werkt maar één keer (geen hergebruik van een afgeluisterde code).
    if (laatsteStap != null && s <= laatsteStap) continue
    if (timingSafeEqual(Buffer.from(code(geheim, s)), Buffer.from(c))) return s
  }
  return null
}

export function otpauthUrl(geheim: string, email: string, uitgever = 'Fonotheek') {
  return `otpauth://totp/${encodeURIComponent(`${uitgever}:${email}`)}?secret=${geheim}&issuer=${encodeURIComponent(uitgever)}&algorithm=SHA1&digits=6&period=${STAP}`
}

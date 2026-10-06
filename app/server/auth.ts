// Inloggen en rollen (4, 10.11). Persoonlijke accounts; een gebruiker kan meerdere rollen hebben.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Context, Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { get, run, insert, json } from './db.ts'
import type { Rol } from '../shared/velden.ts'
import type { Wie } from './log.ts'

const SESSIE_UREN = 12
export const COOKIE = 'fonos_sessie'

export function hashWachtwoord(w: string): string {
  const zout = randomBytes(16)
  return `scrypt:${zout.toString('hex')}:${scryptSync(w, zout, 64).toString('hex')}`
}

export function controleerWachtwoord(w: string, hash: string | null): boolean {
  if (!hash) return false
  const [, zout, h] = hash.split(':')
  const a = scryptSync(w, Buffer.from(zout, 'hex'), 64)
  const b = Buffer.from(h, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export type Gebruiker = { id: number; email: string; naam: string; rollen: Rol[]; actief: number }

export function maakGebruiker(g: { email: string; naam: string; rollen: Rol[]; wachtwoord?: string }): Promise<number> {
  return insert('INSERT INTO gebruikers (email, naam, rollen, wachtwoord) VALUES (?, ?, ?, ?)',
    g.email.trim(), g.naam.trim(), JSON.stringify(g.rollen), g.wachtwoord ? hashWachtwoord(g.wachtwoord) : null)
}

export async function login(email: string, wachtwoord: string): Promise<{ token: string; gebruiker: Gebruiker } | null> {
  const g = await get<any>('SELECT * FROM gebruikers WHERE lower(email) = lower(?) AND actief = 1', email.trim())
  if (!g || !controleerWachtwoord(wachtwoord, g.wachtwoord)) return null
  const token = randomBytes(32).toString('hex')
  await run('INSERT INTO sessies (token, gebruiker_id, verloopt) VALUES (?, ?, nu(?::interval))', token, g.id, `${SESSIE_UREN} hours`)
  await run('DELETE FROM sessies WHERE verloopt < nu()')
  return { token, gebruiker: { id: g.id, email: g.email, naam: g.naam, rollen: json(g.rollen, []), actief: g.actief } }
}

export async function gebruikerBijToken(token?: string): Promise<Gebruiker | null> {
  if (!token) return null
  const g = await get<any>(`SELECT g.* FROM sessies s JOIN gebruikers g ON g.id = s.gebruiker_id
    WHERE s.token = ? AND s.verloopt > nu() AND g.actief = 1`, token)
  return g ? { id: g.id, email: g.email, naam: g.naam, rollen: json(g.rollen, []), actief: g.actief } : null
}

export function zetSessieCookie(c: Context, token: string) {
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSIE_UREN * 3600, secure: (process.env.NODE_ENV === 'production' || !!process.env.VERCEL) && process.env.FONOS_HTTPS !== '0' })
}

export async function logout(c: Context) {
  const t = getCookie(c, COOKIE)
  if (t) await run('DELETE FROM sessies WHERE token = ?', t)
  deleteCookie(c, COOKIE, { path: '/' })
}

/** Middleware: alleen door met een van de opgegeven rollen. Beheerder mag alles van redacteur. */
export function vereist(...rollen: Rol[]) {
  return async (c: Context, next: Next) => {
    const g = await gebruikerBijToken(getCookie(c, COOKIE))
    if (!g) return c.json({ fout: 'Niet ingelogd' }, 401)
    const effectief = new Set<Rol>(g.rollen)
    if (effectief.has('beheerder')) effectief.add('redacteur')
    if (!rollen.some((r) => effectief.has(r))) return c.json({ fout: 'Geen rechten voor deze actie' }, 403)
    c.set('gebruiker' as never, g as never)
    await next()
  }
}

export const wie = (c: Context): Wie => {
  const g = c.get('gebruiker' as never) as Gebruiker
  return { id: g.id, naam: g.naam }
}

export async function maakResetToken(gebruikerId: number): Promise<string> {
  const token = randomBytes(24).toString('hex')
  await run("UPDATE gebruikers SET reset_token = ?, reset_tot = nu('2 hours') WHERE id = ?", token, gebruikerId)
  return token
}

export async function resetWachtwoord(token: string, wachtwoord: string): Promise<boolean> {
  const g = await get<any>('SELECT id FROM gebruikers WHERE reset_token = ? AND reset_tot > nu() AND actief = 1', token)
  if (!g) return false
  await run('UPDATE gebruikers SET wachtwoord = ?, reset_token = NULL, reset_tot = NULL WHERE id = ?', hashWachtwoord(wachtwoord), g.id)
  await run('DELETE FROM sessies WHERE gebruiker_id = ?', g.id)
  return true
}

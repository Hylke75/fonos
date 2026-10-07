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

const VANDAAG_SQL = "to_char(now() AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD')"
const GELDIG_SQL = `g.actief = 1 AND (g.geldig_tot IS NULL OR g.geldig_tot >= ${VANDAAG_SQL})`
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Amsterdam' })
const alsGebruiker = (g: any): Gebruiker => ({ id: g.id, email: g.email, naam: g.naam, rollen: json(g.rollen, []), actief: g.actief })

/** Verlopen (IT-beleid 8.4): na de einddatum kan het account niet meer inloggen. */
export const isVerlopen = (g: { geldig_tot?: string | null }) => !!g.geldig_tot && g.geldig_tot < vandaag()

/** Is een tweede stap nodig voor deze gebruiker (instelling tweestaps, of zelf aangezet)? */
export function tweestapsNodig(g: { rollen: string; totp_aan?: number }, instelling: string) {
  if (g.totp_aan) return true
  if (instelling === 'iedereen') return true
  return instelling === 'beheerders' && json<string[]>(g.rollen, []).includes('beheerder')
}

export async function maakSessie(gebruikerId: number, bevestigd = true): Promise<string> {
  const token = randomBytes(32).toString('hex')
  await run('INSERT INTO sessies (token, gebruiker_id, verloopt, bevestigd) VALUES (?, ?, nu(?::interval), ?)',
    token, gebruikerId, bevestigd ? `${SESSIE_UREN} hours` : '10 minutes', bevestigd ? 1 : 0)
  await run('DELETE FROM sessies WHERE verloopt < nu()')
  return token
}

/** Controleert e-mail en wachtwoord. Geeft de gebruikersrij of de reden van weigeren. */
export async function controleerInlog(email: string, wachtwoord: string): Promise<{ g: any } | { reden: 'onbekend' | 'wachtwoord' | 'inactief' | 'verlopen'; g?: any }> {
  const g = await get<any>('SELECT * FROM gebruikers WHERE lower(email) = lower(?)', email.trim())
  if (!g) return { reden: 'onbekend' }
  if (!controleerWachtwoord(wachtwoord, g.wachtwoord)) return { reden: 'wachtwoord', g }
  if (!g.actief) return { reden: 'inactief', g }
  if (isVerlopen(g)) return { reden: 'verlopen', g }
  return { g }
}

/** Alleen e-mail en wachtwoord, zonder tweede stap (opdrachtregel en tests). */
export async function login(email: string, wachtwoord: string): Promise<{ token: string; gebruiker: Gebruiker } | null> {
  const r = await controleerInlog(email, wachtwoord)
  if (!('g' in r) || 'reden' in r) return null
  return { token: await maakSessie(r.g.id), gebruiker: alsGebruiker(r.g) }
}

export async function gebruikerBijToken(token?: string): Promise<Gebruiker | null> {
  if (!token) return null
  const g = await get<any>(`SELECT g.* FROM sessies s JOIN gebruikers g ON g.id = s.gebruiker_id
    WHERE s.token = ? AND s.verloopt > nu() AND s.bevestigd = 1 AND ${GELDIG_SQL}`, token)
  return g ? alsGebruiker(g) : null
}

/** Sessie die nog op de tweede stap wacht. */
export async function voorlopigeSessie(token?: string): Promise<{ sessie: any; g: any } | null> {
  if (!token) return null
  const r = await get<any>(`SELECT s.token, s.pogingen, g.* FROM sessies s JOIN gebruikers g ON g.id = s.gebruiker_id
    WHERE s.token = ? AND s.verloopt > nu() AND s.bevestigd = 0 AND ${GELDIG_SQL}`, token)
  return r ? { sessie: { token: r.token, pogingen: r.pogingen }, g: r } : null
}

export async function bevestigSessie(token: string) {
  await run('UPDATE sessies SET bevestigd = 1, verloopt = nu(?::interval) WHERE token = ?', `${SESSIE_UREN} hours`, token)
}

export type Aanmelding = { email?: string | null; gebruikerId?: number | null; gelukt: boolean; methode: string; reden?: string | null; ip?: string | null; apparaat?: string | null }

/** Legt een aanmelding vast (IT-beleid 6.3). */
export async function registreerAanmelding(a: Aanmelding) {
  await run('INSERT INTO aanmeldingen (email, gebruiker_id, gelukt, methode, reden, ip, apparaat) VALUES (?, ?, ?, ?, ?, ?, ?)',
    a.email?.trim().toLowerCase().slice(0, 200) ?? null, a.gebruikerId ?? null, a.gelukt ? 1 : 0, a.methode, a.reden ?? null, a.ip?.slice(0, 60) ?? null, a.apparaat?.slice(0, 200) ?? null)
  if (a.gelukt && a.gebruikerId && a.methode !== 'uitloggen') await run('UPDATE gebruikers SET laatste_aanmelding = nu() WHERE id = ?', a.gebruikerId)
}

/** Aantal mislukte aanmeldingen voor dit adres in de laatste N minuten (geldt voor alle serverinstanties). */
export async function mislukteAanmeldingen(email: string, minuten = 15): Promise<number> {
  const r = await get<{ n: number }>("SELECT COUNT(*)::int AS n FROM aanmeldingen WHERE lower(email) = lower(?) AND gelukt = 0 AND tijd > nu(?::interval)",
    email.trim(), `-${minuten} minutes`)
  return r?.n ?? 0
}

export const gebruikerUitRij = alsGebruiker

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
  const g = await get<any>(`SELECT g.id FROM gebruikers g WHERE g.reset_token = ? AND g.reset_tot > nu() AND ${GELDIG_SQL}`, token)
  if (!g) return false
  await run('UPDATE gebruikers SET wachtwoord = ?, reset_token = NULL, reset_tot = NULL WHERE id = ?', hashWachtwoord(wachtwoord), g.id)
  await run('DELETE FROM sessies WHERE gebruiker_id = ?', g.id)
  return true
}

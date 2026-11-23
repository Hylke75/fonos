// Toegang (securityreview kandidaat 1): één plek die per verzoek beslist wie het mag doen, fail-closed.
// Elke route onder /api en /uploads moet hieronder in REGELS staan; een route zonder regel wordt geweigerd
// (en tests/toegang.test.ts faalt). Zo is een nieuwe route standaard dicht, ook als hij met AI wordt toegevoegd.
//
// Eisen:
//  openbaar   – iedereen (alleen lezen van de catalogus, inloggen, gezondheid)
//  kiosk      – een gekoppelde kiosktablet (cookie fonos_kiosk) of een ingelogde medewerker/redacteur/beheerder
//  medewerker – ingelogd met de rol medewerker of beheerder
//  redacteur  – ingelogd met de rol redacteur of beheerder
//  beheerder  – ingelogd met de rol beheerder
//  cron       – Vercel Cron met CRON_SECRET (zonder CRON_SECRET: niemand)
import { randomInt } from 'node:crypto'
import type { Context, Next } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { COOKIE, gebruikerBijToken, type Gebruiker } from './auth.ts'
import { get, run } from './db.ts'
import { gelijk, hashToken, nieuwToken } from './geheimen.ts'
import { isHttps } from './verzoek.ts'

export type Eis = 'openbaar' | 'kiosk' | 'medewerker' | 'redacteur' | 'beheerder' | 'cron'

/** Volgorde telt: de eerste regel die past, beslist. Paden zoals in Hono (:param, * aan het eind). */
export const REGELS: [methode: string, pad: string, eis: Eis][] = [
  ['GET', '/api/gezond', 'openbaar'],
  ['GET', '/api/versies', 'openbaar'],
  ['GET', '/api/hoes', 'openbaar'],
  ['GET', '/api/bestand/hoezen/*', 'openbaar'],
  ['GET', '/api/bestand/*', 'beheerder'],
  ['GET', '/uploads/hoezen/*', 'openbaar'],
  ['GET', '/uploads/*', 'beheerder'],
  ['GET', '/api/cron', 'cron'],
  ['POST', '/api/fout', 'kiosk'],

  // Bezoekersapp: lezen mag iedereen, alles wat iets verandert alleen een gekoppelde kiosk.
  ['GET', '/api/kiosk/*', 'openbaar'],
  ['POST', '/api/kiosk/keuzehulp', 'openbaar'], // alleen lezen (POST vanwege de antwoorden)
  ['POST', '/api/kiosk/beschikbaarheid', 'openbaar'], // alleen lezen
  ['POST', '/api/kiosk/koppelen', 'openbaar'], // de koppelcode is het bewijs; met een rem
  ['*', '/api/kiosk/*', 'kiosk'],

  // Inloggen en uitloggen.
  ['GET', '/api/auth/methoden', 'openbaar'],
  ['GET', '/api/auth/ik', 'openbaar'],
  ['GET', '/api/auth/google', 'openbaar'],
  ['GET', '/api/auth/google/terug', 'openbaar'],
  ['POST', '/api/auth/login', 'openbaar'],
  ['POST', '/api/auth/code', 'openbaar'],
  ['POST', '/api/auth/logout', 'openbaar'],
  ['POST', '/api/auth/vergrendel', 'openbaar'],
  ['POST', '/api/auth/ontgrendel', 'openbaar'],
  ['POST', '/api/auth/reset-aanvraag', 'openbaar'],
  ['POST', '/api/auth/reset', 'openbaar'],

  ['*', '/api/medewerker/*', 'medewerker'],

  // Beheer: redacteuren alleen voor de catalogus, collectie, selecties en hun eigen terugzetknop. De rest: beheerder.
  ...(['/tellers', '/titels', '/genres', '/titel/:id', '/titel/:id/voorbeeld', '/dump/:titelnummer', '/exemplaar/:id', '/imports',
    '/statistieken', '/statistieken.csv', '/datakwaliteit', '/datakwaliteit-csv/:lijst', '/datakwaliteit/:lijst', '/genreknoppen',
    '/genreknop/:id', '/selecties', '/selectie/:id', '/log', '/spotify', '/ontbrekende-titelnummers.csv', '/functies', '/opslag',
  ].map((p) => ['GET', `/api/beheer${p}`, 'redacteur'] as [string, string, Eis])),
  ...(['/titel/:id/terug', '/titel/:id/conflict', '/titel/:id/koppel', '/titel/:id/hoes/:kant', '/titels/bulk', '/titels', '/exemplaren',
    '/exemplaar/:id/afvoeren', '/exemplaar/:id/terugzetten', '/import/collectie', '/import/collectie/:token', '/issue/:id/afgehandeld',
    '/selecties', '/log/:id/terugzetten', '/spotify/:id',
  ].map((p) => ['POST', `/api/beheer${p}`, 'redacteur'] as [string, string, Eis])),
  ['PATCH', '/api/beheer/titel/:id', 'redacteur'],
  ['PATCH', '/api/beheer/exemplaar/:id', 'redacteur'],
  ['PATCH', '/api/beheer/selectie/:id', 'redacteur'],
  ['PUT', '/api/beheer/selectie/:id/titels', 'redacteur'],
  ['DELETE', '/api/beheer/selectie/:id', 'redacteur'],
  ['*', '/api/beheer/*', 'beheerder'],
]

const patroon = (pad: string) => new RegExp(`^${pad.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, '[^/]+').replace(/\/\*$/, '/.*')}$`)
const GECOMPILEERD = REGELS.map(([m, p, e]) => ({ m, re: patroon(p), e }))

/** De eis voor een verzoek, of null als er geen regel is (dan: geweigerd). */
export function eisVoor(methode: string, pad: string): Eis | null {
  const m = methode === 'HEAD' ? 'GET' : methode
  return GECOMPILEERD.find((r) => (r.m === '*' || r.m === m) && r.re.test(pad))?.e ?? null
}

// ------------------------------------------------------------------ kiosktablets

export const KIOSK_COOKIE = 'fonos_kiosk'
const CODETEKENS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // zonder I, L, O, 0 en 1: goed over te typen
export type Kiosk = { naam: string }

export async function kioskBijToken(token?: string): Promise<Kiosk | null> {
  if (!token || token.length > 200) return null
  return (await get<Kiosk>('SELECT naam FROM kiosks WHERE token_hash = ?', hashToken(token))) ?? null
}

/** Een eenmalige koppelcode voor een (nieuwe of bestaande) kiosk, 30 minuten geldig. Een bestaande koppeling blijft
 *  werken tot de code is gebruikt; dan vervangt de nieuwe tablet de oude. */
export async function maakKoppelcode(naam: string, door: string): Promise<{ code: string; tot: string }> {
  const code = Array.from({ length: 8 }, () => CODETEKENS[randomInt(CODETEKENS.length)]).join('')
  await run(`INSERT INTO kiosks (naam, laatst_gezien, code_hash, code_tot, gekoppeld_door) VALUES (?, nu(), ?, nu('30 minutes'), ?)
    ON CONFLICT (naam) DO UPDATE SET code_hash = excluded.code_hash, code_tot = excluded.code_tot, gekoppeld_door = excluded.gekoppeld_door`,
    naam, hashToken(code), door)
  return { code, tot: (await get<{ tot: string }>('SELECT code_tot AS tot FROM kiosks WHERE naam = ?', naam))!.tot }
}

/** Ruilt een koppelcode in voor een kioskcookie. Geeft de naam van de kiosk of null. */
export async function koppel(c: Context, code: string): Promise<string | null> {
  const schoon = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20)
  if (schoon.length !== 8) return null
  const k = await get<{ naam: string }>('SELECT naam FROM kiosks WHERE code_hash = ? AND code_tot > nu()', hashToken(schoon))
  if (!k) return null
  const token = nieuwToken()
  await run('UPDATE kiosks SET token_hash = ?, code_hash = NULL, code_tot = NULL, gekoppeld_op = nu(), laatst_gezien = nu() WHERE naam = ?', hashToken(token), k.naam)
  // Lang geldig (de tablet hangt vast aan de bar); intrekken kan in Beheer → Status.
  setCookie(c, KIOSK_COOKIE, token, { httpOnly: true, sameSite: 'Strict', path: '/', maxAge: 400 * 86400, secure: isHttps() })
  return k.naam
}

export const ontkoppel = (naam: string) => run('UPDATE kiosks SET token_hash = NULL, code_hash = NULL, code_tot = NULL, gekoppeld_op = NULL WHERE naam = ?', naam)

/** "Laatst gezien" van een gekoppelde kiosk, hooguit eens per 30 s per instantie (begrensd geheugen). */
const gezien = new Map<string, number>()
function kioskGezien(naam: string, pagina: string | undefined) {
  if (Date.now() - (gezien.get(naam) ?? 0) < 30_000) return
  if (gezien.size > 500) gezien.clear()
  gezien.set(naam, Date.now())
  run('UPDATE kiosks SET laatst_gezien = nu(), pagina = ? WHERE naam = ?', pagina?.slice(0, 120) ?? null, naam).catch(() => {})
}

// ------------------------------------------------------------------ de middleware

const paginaVan = (c: Context) => { try { return decodeURIComponent(c.req.header('x-fonos-pagina') ?? '') || undefined } catch { return undefined } }

const ROLLEN: Record<'medewerker' | 'redacteur' | 'beheerder', string[]> = {
  medewerker: ['medewerker', 'beheerder'],
  redacteur: ['redacteur', 'beheerder'],
  beheerder: ['beheerder'],
}

/** Controleert elk verzoek onder /api en /uploads tegen REGELS. Zet c.var gebruiker en/of kiosk. */
export async function toegang(c: Context, next: Next) {
  const pad = c.req.path
  if (!pad.startsWith('/api/') && !pad.startsWith('/uploads/')) return next()
  const eis = eisVoor(c.req.method, pad)
  if (!eis) return c.json({ fout: 'Niet gevonden' }, 404) // geen regel = geen toegang
  if (eis === 'openbaar') {
    // Kiosks vragen elke paar seconden /api/versies op: dat is het moment om "laatst gezien" bij te werken.
    if (pad === '/api/versies' && getCookie(c, KIOSK_COOKIE)) {
      const k = await kioskBijToken(getCookie(c, KIOSK_COOKIE)).catch(() => null)
      if (k) kioskGezien(k.naam, paginaVan(c))
    }
    return next()
  }
  if (eis === 'cron') {
    const geheim = process.env.CRON_SECRET
    if (!geheim || !gelijk(c.req.header('authorization') ?? '', `Bearer ${geheim}`)) return c.json({ fout: 'Niet toegestaan' }, 401)
    return next()
  }
  const g = await gebruikerBijToken(getCookie(c, COOKIE))
  if (g) c.set('gebruiker' as never, g as never)
  if (eis === 'kiosk') {
    const k = await kioskBijToken(getCookie(c, KIOSK_COOKIE))
    if (k) {
      c.set('kiosk' as never, k as never)
      kioskGezien(k.naam, paginaVan(c))
      return next()
    }
    if (g) return next()
    return c.json({ fout: 'Deze tablet is niet gekoppeld als kiosk. Vraag een medewerker om hem te koppelen.', code: 'niet_gekoppeld' }, 401)
  }
  if (!g) return c.json({ fout: 'Niet ingelogd' }, 401)
  if (!g.rollen.some((r) => ROLLEN[eis].includes(r))) return c.json({ fout: 'Geen rechten voor deze actie' }, 403)
  return next()
}

export const gebruiker = (c: Context) => (c.get('gebruiker' as never) as Gebruiker | undefined) ?? null
export const kiosk = (c: Context) => (c.get('kiosk' as never) as Kiosk | undefined) ?? null

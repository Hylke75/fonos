// Database: Postgres. In productie Supabase (DATABASE_URL); lokaal en in tests PGlite (Postgres in het proces).
// Query's gebruiken ?-plaatshouders; die worden omgezet naar $1, $2, … ("?|" en "?&" blijven jsonb-operatoren).
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AsyncLocalStorage } from 'node:async_hooks'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(here, '..')
export const DATA_DIR = resolve(process.env.FONOS_DATA_DIR ?? join(ROOT, 'data'))

type Rij = Record<string, any>
type Uitvoerder = { query: (sql: string, p: unknown[]) => Promise<{ rows: Rij[]; count: number }> }
type Verbinding = Uitvoerder & { exec: (sql: string) => Promise<void>; transactie: <T>(fn: (u: Uitvoerder) => Promise<T>) => Promise<T>; sluit: () => Promise<void> }

let verbinding: Promise<Verbinding> | null = null
const lopend = new AsyncLocalStorage<Uitvoerder>()

async function maakPostgres(url: string): Promise<Verbinding> {
  const { default: postgres } = await import('postgres')
  const sql = postgres(url, {
    prepare: false, // vereist voor de Supabase-pooler in transactiemodus
    max: Number(process.env.FONOS_DB_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 15,
    types: { bigint: { to: 20, from: [20], serialize: (x: any) => String(x), parse: (x: string) => Number(x) } } as any,
    onnotice: () => {},
  })
  const uit = (s: any): Uitvoerder => ({ query: async (q, p) => { const r = await s.unsafe(q, p as any[]); return { rows: r as Rij[], count: r.count ?? r.length } } })
  return { ...uit(sql), exec: async (q) => { await sql.unsafe(q) }, transactie: (fn) => sql.begin((tx: any) => fn(uit(tx))) as any, sluit: () => sql.end() }
}

/** DATABASE_URL mag meerdere adressen bevatten (gescheiden door spaties); het eerste bereikbare wint. */
async function eersteBereikbare(urls: string): Promise<Verbinding> {
  let laatsteFout: unknown
  for (const url of urls.split(/\s+/).filter(Boolean)) {
    const v = await maakPostgres(url)
    try {
      await v.query('SELECT 1', [])
      return v
    } catch (e) {
      laatsteFout = e
      console.error(`[db] ${url.replace(/:[^:@/]+@/, ':***@')} niet bereikbaar: ${(e as Error).message}`)
      await v.sluit().catch(() => {})
    }
  }
  throw laatsteFout ?? new Error('Geen DATABASE_URL')
}

async function maakPglite(): Promise<Verbinding> {
  const { PGlite, types } = await import('@electric-sql/pglite')
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm')
  const { fuzzystrmatch } = await import('@electric-sql/pglite/contrib/fuzzystrmatch')
  const map = process.env.FONOS_PGLITE ?? (process.env.NODE_ENV === 'test' ? undefined : join(DATA_DIR, 'pglite'))
  if (map && !map.startsWith('memory:')) mkdirSync(dirname(map), { recursive: true })
  const db = await PGlite.create(map ?? 'memory://', { extensions: { pg_trgm, fuzzystrmatch }, parsers: { [types.INT8]: (v: string) => Number(v) } })
  const uit = (d: any): Uitvoerder => ({ query: async (q, p) => { const r = await d.query(q, p); return { rows: r.rows, count: r.affectedRows ?? r.rows.length } } })
  return { ...uit(db), exec: async (q) => { await db.exec(q) }, transactie: (fn) => db.transaction((tx: any) => fn(uit(tx))), sluit: () => db.close() }
}

/** Zet ?-plaatshouders om naar $n, buiten tekst tussen enkele aanhalingstekens. */
export function plaatshouders(sql: string): string {
  let n = 0, uit = '', inTekst = false
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (c === "'") inTekst = !inTekst
    if (c === '?' && !inTekst && sql[i + 1] !== '|' && sql[i + 1] !== '&') { uit += `$${++n}`; continue }
    uit += c
  }
  return uit
}

export function db(): Promise<Verbinding> {
  if (!verbinding) {
    verbinding = (async () => {
      const v = process.env.DATABASE_URL ? await eersteBereikbare(process.env.DATABASE_URL) : await maakPglite()
      await zorgVoorSchema(v)
      return v
    })()
    verbinding.catch(() => { verbinding = null })
  }
  return verbinding
}

/** Alleen voor tests: een verse database in het geheugen. */
export async function useMemoryDb() {
  process.env.FONOS_PGLITE = 'memory://'
  if (verbinding) await (await verbinding).sluit().catch(() => {})
  verbinding = null
  return db()
}

const voer = async (sql: string, p: unknown[]) => {
  const u = lopend.getStore() ?? (await db())
  return u.query(plaatshouders(sql), p.map((x) => (x === undefined ? null : typeof x === 'boolean' ? (x ? 1 : 0) : x)))
}
export const all = async <T = any>(sql: string, ...p: unknown[]): Promise<T[]> => (await voer(sql, p)).rows as T[]
export const get = async <T = any>(sql: string, ...p: unknown[]): Promise<T | undefined> => (await voer(sql, p)).rows[0] as T | undefined
export const run = async (sql: string, ...p: unknown[]) => { const r = await voer(sql, p); return { changes: r.count, rows: r.rows } }
/** INSERT … en geeft de nieuwe id terug. */
export const insert = async (sql: string, ...p: unknown[]): Promise<number> => Number((await voer(`${sql} RETURNING id`, p)).rows[0]?.id)

/** Transactie; geneste aanroepen lopen mee in de buitenste. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (lopend.getStore()) return fn()
  const v = await db()
  return v.transactie((u) => lopend.run(u, fn))
}

export const json = <T = any>(s: string | null | undefined, fallback: T): T => {
  if (s == null || s === '') return fallback
  try { return JSON.parse(s) } catch { return fallback }
}

// ------------------------------------------------------------------ instellingen (10.10)

export const STANDAARD_INSTELLINGEN = {
  aantal_platenspelers: 8,
  max_titels: 3, // open punt O-5
  inactiviteit_sec: 90,
  waarschuwing_sec: 15,
  bevestiging_sec: 8,
  sluitingstijd: '17:00', // invullen met de openingstijden van Fonos
  markering_min: 10,
  fonos_paginas: [
    { naam: 'Agenda', url: 'https://www.fonos.nl/agenda' },
    { naam: 'Verhalen', url: 'https://www.fonos.nl/verhalen' },
  ],
  vaak_periode_dagen: 90,
  privacy_tekst: 'We gebruiken je e-mailadres alleen voor de nieuwsbrief van Fonos. Je kunt je altijd weer afmelden.',
  privacy_url: 'https://www.beeldengeluid.nl/privacy',
  nl_weergave: 'knop', // open punt O-7: 'knop' of 'schakelaar'
  vindcode_bron: 'veld', // open punt O-1: 'veld', 'objectnummer' of 'titelnummer'
  nieuwsbrief_koppeling: 'geen', // open punt O-4: 'geen' of 'webhook'
  nieuwsbrief_url: '',
  nieuwsbrief_bron: 'Luisterbar',
  melding_email_aan: false, // open punt O-9
  melding_email_adres: '',
  backup_tijd: '03:00',
  backup_bewaar_dagelijks: 30, // open punt O-8
  backup_bewaar_maandelijks: 12,
  bumper_video_url: '', // rustscherm: de bumper (B&G-logo wordt Fonos-logo)
  geluid_aan: true,
}
export type Instellingen = typeof STANDAARD_INSTELLINGEN

let instCache: { tijd: number; data: Instellingen } | null = null

export async function instellingen(): Promise<Instellingen> {
  if (instCache && Date.now() - instCache.tijd < 5000 && !lopend.getStore()) return instCache.data
  const rows = await all<{ sleutel: string; waarde: string }>('SELECT sleutel, waarde FROM instellingen')
  const out: any = { ...STANDAARD_INSTELLINGEN }
  for (const r of rows) if (r.sleutel in out) out[r.sleutel] = json(r.waarde, out[r.sleutel])
  instCache = { tijd: Date.now(), data: out }
  return out
}

export async function zetInstelling(sleutel: string, waarde: unknown) {
  instCache = null
  await run('INSERT INTO instellingen (sleutel, waarde) VALUES (?, ?) ON CONFLICT (sleutel) DO UPDATE SET waarde = excluded.waarde',
    sleutel, JSON.stringify(waarde))
}

/** Zorgt dat er precies N platenspelers zijn; bestaande houden hun actief-status. */
export async function syncPlatenspelers(n: number) {
  for (let i = 1; i <= n; i++) await run('INSERT INTO platenspelers (nummer, actief) VALUES (?, 1) ON CONFLICT DO NOTHING', i)
  await run('DELETE FROM platenspelers WHERE nummer > ?', n)
}

// ------------------------------------------------------------------ schema en startvulling

/** Zoekt een meegeleverd bestand naast deze module (lokaal) of in de functiemap (Vercel). */
function bestand(...kandidaten: string[]) {
  for (const k of kandidaten) for (const basis of [here, ROOT, process.cwd()]) {
    const p = join(basis, k)
    if (existsSync(p)) return p
  }
  throw new Error(`Bestand niet gevonden: ${kandidaten[0]}`)
}

async function zorgVoorSchema(v: Verbinding) {
  const heeft = await v.query("SELECT to_regclass('public.taken') AS t, to_regclass('public.versies') AS v", [])
  if (!heeft.rows[0]?.t) {
    // Meerdere statements in één keer: zonder parameters.
    await v.exec(readFileSync(bestand('schema.sql', 'server/schema.sql'), 'utf8'))
  }
  await seed(v)
}

async function seed(v: Uitvoerder) {
  const n = async (sql: string) => Number((await v.query(sql, [])).rows[0]?.n ?? 0)
  if (!(await n('SELECT COUNT(*) n FROM platenspelers'))) {
    for (let i = 1; i <= 8; i++) await v.query('INSERT INTO platenspelers (nummer, actief) VALUES ($1, 1) ON CONFLICT DO NOTHING', [i])
  }
  if (!(await n('SELECT COUNT(*) n FROM genreknoppen'))) {
    // Startvulling uit bijlage A van het functioneel ontwerp (open punt O-13).
    const knoppen = JSON.parse(readFileSync(bestand('shared/genres-startvulling.json'), 'utf8'))
    for (const [i, k] of knoppen.entries()) {
      const id = (await v.query('INSERT INTO genreknoppen (naam, volgorde, kleur, nederlands) VALUES ($1, $2, $3, $4) RETURNING id', [k.naam, i + 1, k.kleur, k.nederlands])).rows[0].id
      const waarden = k.koppelingen.map((_: any, j: number) => `($1, $${j * 2 + 2}, $${j * 2 + 3})`).join(',')
      if (k.koppelingen.length) await v.query(`INSERT INTO genre_koppelingen (knop_id, mw_genre, weergavenaam) VALUES ${waarden} ON CONFLICT DO NOTHING`,
        [id, ...k.koppelingen.flatMap((g: any) => [g.mw_genre, g.weergavenaam])])
    }
  }
  if (!(await n('SELECT COUNT(*) n FROM selecties'))) {
    const s = [
      ['Uitgelicht door Fonos', 'uitgelicht', 1, null, null, null],
      ['Nieuwe aanwinsten', 'nieuw', 2, null, null, null],
      ['Vaak aangevraagd', 'vaak', 3, null, null, null],
      ['Populaire klassiekers', 'handmatig', 4, null, null, null],
      ['Kerst', 'seizoen', 5, '12-01', '12-31', 'Kerst'],
      ['Sinterklaas', 'seizoen', 6, '11-10', '12-05', 'Sinterklaas'],
      ['Carnaval', 'seizoen', 7, '02-01', '03-05', 'Carnaval/Vastelaovend'],
    ]
    for (const r of s) await v.query('INSERT INTO selecties (naam, soort, volgorde, begin, eind, mw_genre) VALUES ($1, $2, $3, $4, $5, $6)', r)
  }
  await v.query("INSERT INTO versies (naam, waarde) VALUES ('aanvragen', 0), ('beschikbaarheid', 0), ('catalogus', 0) ON CONFLICT DO NOTHING", [])
}

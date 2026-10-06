// Database: SQLite via node:sqlite. Het schema staat in schema.sql.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(here, '..')
export const DATA_DIR = resolve(process.env.FONOS_DATA_DIR ?? join(ROOT, 'data'))
export const UPLOAD_DIR = resolve(process.env.FONOS_UPLOAD_DIR ?? join(DATA_DIR, 'uploads'))
// Back-ups staan bewust los van de database (12.3); in productie op een andere schijf of share.
export const BACKUP_DIR = resolve(process.env.FONOS_BACKUP_DIR ?? join(DATA_DIR, 'backups'))
export const DB_PATH = resolve(process.env.FONOS_DB ?? join(DATA_DIR, 'fonotheek.db'))

let _db: DatabaseSync | null = null

export function db(): DatabaseSync {
  if (_db) return _db
  for (const d of [dirname(DB_PATH), UPLOAD_DIR, BACKUP_DIR]) mkdirSync(d, { recursive: true })
  _db = new DatabaseSync(DB_PATH)
  _db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  _db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))
  seed(_db)
  return _db
}

/** Alleen voor tests: een verse database in het geheugen. */
export function useMemoryDb(): DatabaseSync {
  _db = new DatabaseSync(':memory:')
  _db.exec('PRAGMA foreign_keys = ON;')
  _db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))
  seed(_db)
  return _db
}

type P = SQLInputValue
export const all = <T = any>(sql: string, ...p: P[]): T[] => db().prepare(sql).all(...p) as T[]
export const get = <T = any>(sql: string, ...p: P[]): T | undefined => db().prepare(sql).get(...p) as T | undefined
export const run = (sql: string, ...p: P[]) => db().prepare(sql).run(...p)

export function tx<T>(fn: () => T): T {
  const d = db()
  d.exec('BEGIN IMMEDIATE')
  try {
    const r = fn()
    d.exec('COMMIT')
    return r
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
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

export function instellingen(): Instellingen {
  const rows = all<{ sleutel: string; waarde: string }>('SELECT sleutel, waarde FROM instellingen')
  const out: any = { ...STANDAARD_INSTELLINGEN }
  for (const r of rows) if (r.sleutel in out) out[r.sleutel] = json(r.waarde, out[r.sleutel])
  return out
}

export function zetInstelling(sleutel: string, waarde: unknown) {
  run('INSERT INTO instellingen (sleutel, waarde) VALUES (?, ?) ON CONFLICT(sleutel) DO UPDATE SET waarde = excluded.waarde',
    sleutel, JSON.stringify(waarde))
}

/** Zorgt dat er precies N platenspelers zijn; bestaande houden hun actief-status. */
export function syncPlatenspelers(n: number) {
  for (let i = 1; i <= n; i++) run('INSERT OR IGNORE INTO platenspelers (nummer, actief) VALUES (?, 1)', i)
  run('DELETE FROM platenspelers WHERE nummer > ?', n)
}

// ------------------------------------------------------------------ startvulling

function seed(d: DatabaseSync) {
  const has = (sql: string) => (d.prepare(sql).get() as any)?.n > 0
  if (!has('SELECT COUNT(*) n FROM platenspelers')) {
    const ins = d.prepare('INSERT INTO platenspelers (nummer, actief) VALUES (?, 1)')
    for (let i = 1; i <= 8; i++) ins.run(i)
  }
  if (!has('SELECT COUNT(*) n FROM genreknoppen')) {
    // Startvulling uit bijlage A van het functioneel ontwerp (open punt O-13).
    const knoppen = JSON.parse(readFileSync(join(ROOT, 'shared', 'genres-startvulling.json'), 'utf8'))
    const insK = d.prepare('INSERT INTO genreknoppen (naam, volgorde, kleur, nederlands) VALUES (?, ?, ?, ?)')
    const insG = d.prepare('INSERT OR IGNORE INTO genre_koppelingen (knop_id, mw_genre, weergavenaam) VALUES (?, ?, ?)')
    knoppen.forEach((k: any, i: number) => {
      const id = Number(insK.run(k.naam, i + 1, k.kleur, k.nederlands).lastInsertRowid)
      for (const g of k.koppelingen) insG.run(id, g.mw_genre, g.weergavenaam)
    })
  }
  if (!has('SELECT COUNT(*) n FROM selecties')) {
    const ins = d.prepare('INSERT INTO selecties (naam, soort, volgorde, begin, eind, mw_genre) VALUES (?, ?, ?, ?, ?, ?)')
    ins.run('Uitgelicht door Fonos', 'uitgelicht', 1, null, null, null)
    ins.run('Nieuwe aanwinsten', 'nieuw', 2, null, null, null)
    ins.run('Vaak aangevraagd', 'vaak', 3, null, null, null)
    ins.run('Populaire klassiekers', 'handmatig', 4, null, null, null)
    ins.run('Kerst', 'seizoen', 5, '12-01', '12-31', 'Kerst')
    ins.run('Sinterklaas', 'seizoen', 6, '11-10', '12-05', 'Sinterklaas')
    ins.run('Carnaval', 'seizoen', 7, '02-01', '03-05', 'Carnaval/Vastelaovend')
  }
}

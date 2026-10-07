// Muziekweb-import, deel 1: INLEZEN (formaatspecifiek).
// Elk formaat levert dezelfde generieke records (MwRecord) aan de verwerker (muziekweb-verwerk.ts).
// Het definitieve formaat van de dump is nog open (O-2); een nieuw formaat = een nieuwe lezer hier.
import { createReadStream, createWriteStream, existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TitelVelden, Track } from '../../shared/velden.ts'

export type MwRecord = {
  titelnummer: string
  soort: 'populair' | 'klassiek'
  tip: boolean
  velden: TitelVelden
}

// ------------------------------------------------------------------ hulpfuncties

export function dragerUit(product?: string | null): { drager?: string; aantal?: number } {
  if (!product) return {}
  const p = product.toLowerCase()
  const aantal = Number(/^(\d+)/.exec(p)?.[1] ?? 1)
  const eerste = p.split('&')[0]
  if (/\blp('s)?\b/.test(eerste)) return { drager: 'LP', aantal }
  if (/compact ?disc|superaudiocompactdisc|cd-single|\bcd\b/.test(eerste)) return { drager: 'CD', aantal }
  return { drager: 'Overig', aantal }
}

const KLASSIEK_GENRE = /^T00000000(6[0-4]\d|65[0-3])$/ // Muziekweb-hoofdgroep klassiek
const splitsArtiesten = (s?: string | null) => (s ? s.split(/,\s+/).map((x) => x.trim()).filter(Boolean) : [])
const uniek = <T,>(xs: T[]) => [...new Set(xs)]

type Tabellen = {
  pages: any[]
  tracks: Map<string, any[]>
  performers: Map<string, any[]>
  genres: Map<string, any[]>
  labels: Map<string, any[]>
  works: Map<string, any>
  composers: Map<string, string[]>
  eans?: Map<string, string>
}

/** Zet de tabellen van de Muziekweb-website (zoals muziekweb_scrape.py ze opslaat) om naar records. */
function* naarRecords(t: Tabellen): Generator<MwRecord> {
  for (const p of t.pages) {
    const code = p.album_code
    const tracks = (t.tracks.get(code) ?? []).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    const genres = t.genres.get(code) ?? []
    let klassiekeWerken = 0
    const tracklist: Track[] = tracks.map((tr, i) => {
      const werk = tr.work_code ? t.works.get(tr.work_code) : null
      if (werk?.kind === 'CLASSICAL') klassiekeWerken++
      const perf = (t.performers.get(tr.track_id) ?? []).sort((a, b) => a.position - b.position)
      const track: Track = { pos: tr.position ?? i + 1, titel: tr.title ?? '', duur: tr.duration ?? null }
      const comp = tr.work_code ? t.composers.get(tr.work_code) : undefined
      if (comp?.length) track.componisten = comp
      if (perf.length) track.uitvoerenden = perf.map((x) => (x.role ? `${x.name} (${x.role})` : x.name))
      return track
    })
    const klassiek = genres.some((g) => KLASSIEK_GENRE.test(g.genre_code)) || (tracks.length > 0 && klassiekeWerken / tracks.length > 0.5)
    const uitgave = p.date_published || /(\d{4})/.exec(p.release_text ?? '')?.[1] || undefined
    const velden: TitelVelden = {
      titel: p.title ?? undefined,
      artiesten: splitsArtiesten(p.performers),
      uitgave,
      ...dragerUit(p.product),
      label: (t.labels.get(code) ?? []).sort((a, b) => a.position - b.position)[0]?.label_name ?? undefined,
      ean: t.eans?.get(code),
      genres: uniek(genres.map((g) => g.name).filter(Boolean)),
      speelduur: p.playtime ?? undefined,
      toelichting: p.description ?? undefined,
      tracklist,
      hoes_voor: p.cover_url ?? undefined,
      hoes_achter: p.back_cover_url ?? undefined,
    }
    if (klassiek) {
      velden.componisten = uniek(tracklist.flatMap((x) => x.componisten ?? []))
      velden.uitvoerenden = uniek(tracklist.flatMap((x) => x.uitvoerenden ?? []))
    }
    for (const k of Object.keys(velden) as (keyof TitelVelden)[]) if (velden[k] === undefined) delete velden[k]
    yield { titelnummer: code, soort: klassiek ? 'klassiek' : 'populair', tip: !!p.is_tip, velden }
  }
}

const groepeer = (rows: any[], key: string) => {
  const m = new Map<string, any[]>()
  for (const r of rows) {
    const k = r[key]
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(r)
  }
  return m
}

async function leesJsonl(pad: string): Promise<any[]> {
  if (!existsSync(pad)) return []
  const input = pad.endsWith('.gz') ? createReadStream(pad).pipe(createGunzip()) : createReadStream(pad)
  const out: any[] = []
  for await (const line of createInterface({ input, crlfDelay: Infinity })) if (line.trim()) out.push(JSON.parse(line))
  return out
}

// ------------------------------------------------------------------ lezer 1: exportmap (part-*/…jsonl.gz)

/** Leest de exportmap van muziekweb_scrape.py: submappen part-NNNN met jsonl(.gz)-bestanden. */
export async function* leesExportMap(map: string): AsyncGenerator<MwRecord> {
  const parts = readdirSync(map).filter((d) => statSync(join(map, d)).isDirectory()).sort()
  const dirs = parts.length ? parts.map((d) => join(map, d)) : [map]
  const bestand = (dir: string, naam: string) => [join(dir, naam + '.jsonl.gz'), join(dir, naam + '.jsonl')].find(existsSync) ?? ''
  // Werken en componisten kunnen in een ander deel staan dan het album: eerst alles laden.
  const works = new Map<string, any>()
  const composers = new Map<string, string[]>()
  for (const dir of dirs) {
    for (const w of await leesJsonl(bestand(dir, 'works'))) works.set(w.code, w)
    for (const c of await leesJsonl(bestand(dir, 'work_composers'))) {
      if (!composers.has(c.work_code)) composers.set(c.work_code, [])
      if (c.name && !composers.get(c.work_code)!.includes(c.name)) composers.get(c.work_code)!.push(c.name)
    }
  }
  for (const dir of dirs) {
    const pages = await leesJsonl(bestand(dir, 'album_pages'))
    if (!pages.length) continue
    const tracks = await leesJsonl(bestand(dir, 'tracks'))
    const perf = await leesJsonl(bestand(dir, 'track_performers'))
    yield* naarRecords({
      pages,
      tracks: groepeer(tracks, 'album_code'),
      performers: groepeer(perf, 'track_id'),
      genres: groepeer(await leesJsonl(bestand(dir, 'album_page_genres')), 'album_code'),
      labels: groepeer(await leesJsonl(bestand(dir, 'album_page_labels')), 'album_code'),
      works,
      composers,
    })
  }
}

/** De delen (part-NNNN) van een exportmap, gesorteerd. */
export function exportDelen(map: string): string[] {
  if (!existsSync(map)) return []
  return readdirSync(map).filter((d) => /^part-\d+$/.test(d) && statSync(join(map, d)).isDirectory()).sort()
}

/** Leest één deel van de exportmap (voor verwerken in stappen, bv. op Vercel). */
export async function leesExportDeel(dir: string): Promise<MwRecord[]> {
  const bestand = (naam: string) => [join(dir, naam + '.jsonl.gz'), join(dir, naam + '.jsonl')].find(existsSync) ?? ''
  const works = new Map<string, any>()
  for (const w of await leesJsonl(bestand('works'))) works.set(w.code, w)
  const composers = new Map<string, string[]>()
  for (const c of await leesJsonl(bestand('work_composers'))) {
    if (!composers.has(c.work_code)) composers.set(c.work_code, [])
    if (c.name && !composers.get(c.work_code)!.includes(c.name)) composers.get(c.work_code)!.push(c.name)
  }
  const pages = await leesJsonl(bestand('album_pages'))
  return [...naarRecords({
    pages,
    tracks: groepeer(await leesJsonl(bestand('tracks')), 'album_code'),
    performers: groepeer(await leesJsonl(bestand('track_performers')), 'track_id'),
    genres: groepeer(await leesJsonl(bestand('album_page_genres')), 'album_code'),
    labels: groepeer(await leesJsonl(bestand('album_page_labels')), 'album_code'),
    works, composers,
  })]
}

// ------------------------------------------------------------------ lezer 2: muziekweb.db (SQLite)

/** Leest muziekweb.db zoals gebouwd door muziekweb_import.py + muziekweb_scrape.py. */
export async function* leesSqlite(pad: string): AsyncGenerator<MwRecord> {
  const { DatabaseSync } = await import('node:sqlite')
  const src = new DatabaseSync(pad, { readOnly: true })
  const heeft = (t: string) => !!src.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t)
  const works = new Map<string, any>()
  const composers = new Map<string, string[]>()
  if (heeft('works')) for (const w of src.prepare('SELECT * FROM works').iterate() as any) works.set(w.code, w)
  if (heeft('work_composers')) for (const c of src.prepare('SELECT * FROM work_composers').iterate() as any) {
    if (!composers.has(c.work_code)) composers.set(c.work_code, [])
    composers.get(c.work_code)!.push(c.name)
  }
  const eans = new Map<string, string>()
  if (heeft('albums')) for (const a of src.prepare('SELECT code, ean FROM albums WHERE ean IS NOT NULL').iterate() as any) eans.set(a.code, a.ean)
  const batch: any[] = []
  const q = (sql: string, codes: string[]) => src.prepare(sql.replace('?', codes.map(() => '?').join(','))).all(...codes) as any[]
  const flush = function* () {
    const codes = batch.map((p) => p.album_code)
    const tracks = q('SELECT * FROM tracks WHERE album_code IN (?)', codes)
    const perf = tracks.length ? q('SELECT * FROM track_performers WHERE track_id IN (?)', tracks.map((t) => t.track_id)) : []
    yield* naarRecords({
      pages: batch.splice(0),
      tracks: groepeer(tracks, 'album_code'),
      performers: groepeer(perf, 'track_id'),
      genres: groepeer(q('SELECT * FROM album_page_genres WHERE album_code IN (?)', codes), 'album_code'),
      labels: groepeer(q('SELECT * FROM album_page_labels WHERE album_code IN (?)', codes), 'album_code'),
      works, composers, eans,
    })
  }
  for (const p of src.prepare('SELECT * FROM album_pages').iterate() as any) {
    batch.push(p)
    if (batch.length >= 500) yield* flush()
  }
  if (batch.length) yield* flush()
  src.close()
}

// ------------------------------------------------------------------ lezer 3: fonotheek.db(.gz) (SQLite, één database)

/** Seconden zoals Muziekweb ze toont: tracks als m:ss (u:mm:ss vanaf een uur), albums altijd als u:mm:ss. */
export function duurUit(sec?: number | null, metUren = false): string | null {
  if (sec == null || !(sec > 0)) return null
  const u = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  const ss = String(s).padStart(2, '0')
  return u || metUren ? `${u}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const KLASSIEK_HOOFDGENRE = /^HFD00000000[34]$/ // Klassiek / Klassiek oud

const uitgepakt = new Map<string, Promise<string>>()

/** Pakt een .gz één keer per proces uit naar een tijdelijk bestand (ook voor de stappen in het beheer). */
function pakUit(pad: string): Promise<string> {
  if (!pad.endsWith('.gz')) return Promise.resolve(pad)
  const sleutel = `${pad}:${statSync(pad).mtimeMs}`
  if (!uitgepakt.has(sleutel)) uitgepakt.set(sleutel, (async () => {
    const doel = join(mkdtempSync(join(tmpdir(), 'fonotheek-')), 'fonotheek.db')
    await pipeline(createReadStream(pad), createGunzip(), createWriteStream(doel))
    return doel
  })().catch((e) => { uitgepakt.delete(sleutel); throw e }))
  return uitgepakt.get(sleutel)!
}

/** Aantal albums in fonotheek.db(.gz). */
export async function fonotheekAlbums(pad: string): Promise<number> {
  const { DatabaseSync } = await import('node:sqlite')
  const src = new DatabaseSync(await pakUit(pad), { readOnly: true })
  try { return (src.prepare('SELECT COUNT(*) AS n FROM albums').get() as any).n } finally { src.close() }
}

/** Is dit een fonotheek.db (tabellen albums + collectie_items)? */
export async function isFonotheekDb(pad: string): Promise<boolean> {
  if (pad.endsWith('.gz')) return /fonotheek/i.test(pad)
  const { DatabaseSync } = await import('node:sqlite')
  const src = new DatabaseSync(pad, { readOnly: true })
  try {
    return !!src.prepare("SELECT 1 FROM sqlite_master WHERE name = 'collectie_items'").get() && !!src.prepare("SELECT 1 FROM sqlite_master WHERE name = 'album_performers'").get()
  } finally { src.close() }
}

export type CollectieItem = { objectnummer: string; titelnummer: string | null; lijst: string }

/** Alleen de gebruikscollectie uit fonotheek.db(.gz). */
export async function leesFonotheekCollectie(pad: string): Promise<CollectieItem[]> {
  const { DatabaseSync } = await import('node:sqlite')
  const src = new DatabaseSync(await pakUit(pad), { readOnly: true })
  try { return src.prepare('SELECT objectnummer, titelnummer, lijst FROM collectie_items').all() as any } finally { src.close() }
}

/** Leest fonotheek.db(.gz) van de scraper: albums als MwRecords en (via opCollectie) de gebruikscollectie.
 *  Met vanaf/aantal alleen dat stuk van de albums (op code gesorteerd), voor verwerken in stappen. */
export async function* leesFonotheekDb(pad: string, opties: { opCollectie?: (items: CollectieItem[]) => void; vanaf?: number; aantal?: number } = {}): AsyncGenerator<MwRecord> {
  const { opCollectie, vanaf = 0, aantal = -1 } = opties
  const { DatabaseSync } = await import('node:sqlite')
  const src = new DatabaseSync(await pakUit(pad), { readOnly: true })
  try {
    if (opCollectie) opCollectie(src.prepare('SELECT objectnummer, titelnummer, lijst FROM collectie_items').all() as any)
    const namen = new Map<string, string>()
    for (const p of src.prepare('SELECT code, name FROM performers').iterate() as any) namen.set(p.code, p.name)
    const works = new Map<string, string>()
    for (const w of src.prepare('SELECT code, kind FROM works').iterate() as any) works.set(w.code, w.kind)
    const composers = new Map<string, string[]>()
    for (const c of src.prepare('SELECT work_code, performer_code FROM work_composers').iterate() as any) {
      const naam = namen.get(c.performer_code)
      if (!naam) continue
      if (!composers.has(c.work_code)) composers.set(c.work_code, [])
      if (!composers.get(c.work_code)!.includes(naam)) composers.get(c.work_code)!.push(naam)
    }
    const genres = new Map<string, { kind: string; name: string | null }>()
    for (const g of src.prepare('SELECT code, kind, name_nl FROM genres').iterate() as any) genres.set(g.code, { kind: g.kind, name: g.name_nl })
    const labels = new Map<string, string>()
    for (const l of src.prepare('SELECT code, name FROM labels').iterate() as any) labels.set(l.code, l.name)

    const q = (sql: string, codes: string[]) => src.prepare(sql.replace('(?)', '(' + codes.map(() => '?').join(',') + ')')).all(...codes) as any[]
    const batch: any[] = []
    const flush = function* (): Generator<MwRecord> {
      const albums = batch.splice(0)
      const codes = albums.map((a) => a.code)
      const perf = groepeer(q('SELECT * FROM album_performers WHERE album_code IN (?)', codes), 'album_code')
      const rel = groepeer(q('SELECT * FROM album_releases WHERE album_code IN (?) ORDER BY rowid', codes), 'album_code')
      const gen = groepeer(q('SELECT * FROM album_genres WHERE album_code IN (?)', codes), 'album_code')
      const med = groepeer(q("SELECT * FROM album_media WHERE kind = 'drager' AND album_code IN (?)", codes), 'album_code')
      const trs = q('SELECT * FROM tracks WHERE album_code IN (?)', codes)
      const tperf = trs.length ? groepeer(q('SELECT * FROM track_performers WHERE track_id IN (?)', trs.map((t) => t.track_id)), 'track_id') : new Map()
      const tracksPer = groepeer(trs, 'album_code')
      for (const a of albums) {
        const tracks = (tracksPer.get(a.code) ?? []).sort((x, y) => (x.position ?? 0) - (y.position ?? 0))
        let klassiekeWerken = 0
        const tracklist: Track[] = tracks.map((tr, i) => {
          if (tr.work_code && works.get(tr.work_code) === 'CLASSICAL') klassiekeWerken++
          const track: Track = { pos: tr.position ?? i + 1, titel: tr.title ?? '', duur: duurUit(tr.duration_seconds) }
          const comp = tr.work_code ? composers.get(tr.work_code) : undefined
          if (comp?.length) track.componisten = comp
          const up = ((tperf.get(tr.track_id) ?? []) as any[]).sort((x, y) => x.position - y.position)
            .map((x) => ({ naam: (x.performer_code ? namen.get(x.performer_code) : null) ?? x.name, rol: x.role }))
            .filter((x) => x.naam)
          if (up.length) track.uitvoerenden = up.map((x) => (x.rol ? `${x.naam} (${x.rol})` : x.naam))
          return track
        })
        const g = (gen.get(a.code) ?? []).map((x) => ({ code: x.genre_code as string, ...(genres.get(x.genre_code) ?? { kind: '', name: null }) }))
        const klassiek = g.some((x) => KLASSIEK_GENRE.test(x.code) || KLASSIEK_HOOFDGENRE.test(x.code)) || (tracks.length > 0 && klassiekeWerken / tracks.length > 0.5)
        const releases = rel.get(a.code) ?? []
        const label = releases.map((r) => (r.label_code ? labels.get(r.label_code) : null)).find(Boolean)
        let drager = dragerUit(a.media_description)
        if (!a.media_description) {
          const m = (med.get(a.code) ?? []).map((x) => x.media_code)
          if (m.includes('LP')) drager = { drager: 'LP', aantal: a.number_of_discs ?? 1 }
          else if (m.includes('CD')) drager = { drager: 'CD', aantal: a.number_of_discs ?? 1 }
        }
        const velden: TitelVelden = {
          titel: a.title ?? undefined,
          artiesten: (perf.get(a.code) ?? []).sort((x, y) => x.position - y.position).map((x) => namen.get(x.performer_code)).filter(Boolean) as string[],
          uitgave: a.release_date || (a.released_before_1988 ? 'voor 1988' : undefined),
          ...drager,
          label: label ?? undefined,
          ean: releases.map((r) => r.ean).find(Boolean) ?? undefined,
          genres: uniek(g.filter((x) => x.kind === 'stijl').map((x) => x.name).filter(Boolean) as string[]),
          speelduur: duurUit(a.duration_seconds, true) ?? undefined,
          toelichting: a.description ?? undefined,
          tracklist,
          hoes_voor: a.cover_url ?? undefined,
          hoes_achter: a.back_cover_url ?? undefined,
        }
        if (klassiek) {
          velden.componisten = uniek(tracklist.flatMap((x) => x.componisten ?? []))
          velden.uitvoerenden = uniek(tracklist.flatMap((x) => x.uitvoerenden ?? []))
        }
        for (const k of Object.keys(velden) as (keyof TitelVelden)[]) if (velden[k] === undefined) delete velden[k]
        yield { titelnummer: a.code, soort: klassiek ? 'klassiek' : 'populair', tip: false, velden }
      }
    }
    for (const a of src.prepare('SELECT * FROM albums ORDER BY code LIMIT ? OFFSET ?').iterate(aantal, vanaf) as any) {
      batch.push(a)
      if (batch.length >= 500) yield* flush()
    }
    if (batch.length) yield* flush()
  } finally {
    src.close()
  }
}

// ------------------------------------------------------------------ lezer 4: Fonos-standaardformaat

/** JSON Lines met per regel een MwRecord. Handig voor tests en als tussenformaat. */
export async function* leesStandaard(pad: string): AsyncGenerator<MwRecord> {
  for (const r of await leesJsonl(pad)) yield r as MwRecord
}

/** Kiest de lezer op basis van het pad. */
export async function kiesLezer(pad: string): Promise<AsyncGenerator<MwRecord>> {
  if (statSync(pad).isDirectory()) return leesExportMap(pad)
  if (/\.db\.gz$/i.test(pad)) return leesFonotheekDb(pad)
  if (/\.(db|sqlite3?)$/i.test(pad)) return (await isFonotheekDb(pad)) ? leesFonotheekDb(pad) : leesSqlite(pad)
  if (/\.jsonl(\.gz)?$/i.test(pad)) return leesStandaard(pad)
  throw new Error('Onbekend dumpformaat. Gebruik fonotheek.db(.gz), een exportmap, een muziekweb.db of een .jsonl-bestand.')
}

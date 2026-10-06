// Muziekweb-import, deel 1: INLEZEN (formaatspecifiek).
// Elk formaat levert dezelfde generieke records (MwRecord) aan de verwerker (muziekweb-verwerk.ts).
// Het definitieve formaat van de dump is nog open (O-2); een nieuw formaat = een nieuwe lezer hier.
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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

// ------------------------------------------------------------------ lezer 2: muziekweb.db (SQLite)

/** Leest muziekweb.db zoals gebouwd door muziekweb_import.py + muziekweb_scrape.py. */
export async function* leesSqlite(pad: string): AsyncGenerator<MwRecord> {
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

// ------------------------------------------------------------------ lezer 3: Fonos-standaardformaat

/** JSON Lines met per regel een MwRecord. Handig voor tests en als tussenformaat. */
export async function* leesStandaard(pad: string): AsyncGenerator<MwRecord> {
  for (const r of await leesJsonl(pad)) yield r as MwRecord
}

/** Kiest de lezer op basis van het pad. */
export function kiesLezer(pad: string): AsyncGenerator<MwRecord> {
  if (statSync(pad).isDirectory()) return leesExportMap(pad)
  if (/\.(db|sqlite3?)$/i.test(pad)) return leesSqlite(pad)
  if (/\.jsonl(\.gz)?$/i.test(pad)) return leesStandaard(pad)
  throw new Error('Onbekend dumpformaat. Gebruik een exportmap, een muziekweb.db of een .jsonl-bestand.')
}

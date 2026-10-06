// Titels met het tweelagenmodel (6.2).
import { all, get, run, json, instellingen } from './db.ts'
import { TWEELAAGS, jaarUit, type TitelVelden } from '../shared/velden.ts'
import { log, type Wie } from './log.ts'

export type TitelRij = {
  id: number
  titelnummer: string | null
  soort: string
  mw_data: string
  fonos_data: string
  conflicten: string
  zichtbaar: number
  uitgelicht: number
  fonos_verhaal: string | null
  ai_tekst: number
  tip: number
  d_titel: string | null
  d_artiesten: string | null
  d_jaar: number | null
  d_drager: string | null
  d_genres: string
  d_hoes: string | null
  d_label: string | null
  heeft_fonos: number
  aangemaakt: string
  gewijzigd: string
}

const gelijk = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const leeg = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0)

/** De getoonde waarden: de Fonos-waarde als die er is, anders de Muziekweb-waarde. */
export function getoond(rij: Pick<TitelRij, 'mw_data' | 'fonos_data'>): TitelVelden {
  const mw = json<TitelVelden>(rij.mw_data, {})
  const fonos = json<TitelVelden>(rij.fonos_data, {})
  const out: any = {}
  for (const { veld } of TWEELAAGS) out[veld] = veld in fonos ? (fonos as any)[veld] : (mw as any)[veld]
  return out
}

/** Herberekent de afgeleide kolommen (d_*) na een wijziging. */
export function verversWeergave(id: number) {
  const rij = get<TitelRij>('SELECT * FROM titels WHERE id = ?', id)
  if (!rij) return
  const v = getoond(rij)
  const fonos = json<object>(rij.fonos_data, {})
  run(
    `UPDATE titels SET d_titel = ?, d_artiesten = ?, d_jaar = ?, d_drager = ?, d_genres = ?, d_hoes = ?, d_label = ?,
       heeft_fonos = ?, gewijzigd = datetime('now') WHERE id = ?`,
    v.titel ?? null, (v.artiesten ?? []).join(', ') || null, jaarUit(v.uitgave), v.drager ?? null,
    JSON.stringify(v.genres ?? []), v.hoes_voor ?? null, v.label ?? null, Object.keys(fonos).length > 0 ? 1 : 0, id,
  )
}

/**
 * Verwerkt nieuwe Muziekweb-waarden voor een titel. Fonos-waarden blijven altijd staan;
 * verandert de Muziekweb-waarde van een veld met een Fonos-waarde, dan ontstaat een conflict.
 * Geeft het aantal nieuwe conflicten terug.
 */
export function verwerkMuziekweb(id: number, nieuw: TitelVelden, extra: { soort?: string; tip?: boolean } = {}): number {
  const rij = get<TitelRij>('SELECT * FROM titels WHERE id = ?', id)
  if (!rij) return 0
  const oud = json<TitelVelden>(rij.mw_data, {})
  const fonos = json<TitelVelden>(rij.fonos_data, {})
  const conflicten = json<Record<string, any>>(rij.conflicten, {})
  let nieuweConflicten = 0
  for (const { veld } of TWEELAAGS) {
    if (!(veld in fonos)) continue
    if (!gelijk((oud as any)[veld], (nieuw as any)[veld])) {
      if (!conflicten[veld]) nieuweConflicten++
      conflicten[veld] = { fonos: (fonos as any)[veld], mw_oud: (oud as any)[veld] ?? null, mw_nieuw: (nieuw as any)[veld] ?? null, sinds: new Date().toISOString() }
    }
  }
  run('UPDATE titels SET mw_data = ?, conflicten = ?, soort = COALESCE(?, soort), tip = COALESCE(?, tip) WHERE id = ?',
    JSON.stringify(nieuw), JSON.stringify(conflicten), extra.soort ?? null, extra.tip == null ? null : extra.tip ? 1 : 0, id)
  verversWeergave(id)
  return nieuweConflicten
}

/** Zet (of wist met waarde undefined) de Fonos-waarde van een veld. */
export function zetFonosWaarde(id: number, veld: keyof TitelVelden, waarde: unknown, wie: Wie) {
  const rij = get<TitelRij>('SELECT * FROM titels WHERE id = ?', id)
  if (!rij) throw new Error('Titel niet gevonden')
  if (!TWEELAAGS.some((v) => v.veld === veld)) throw new Error(`Onbekend veld: ${veld}`)
  const fonos = json<any>(rij.fonos_data, {})
  const mw = json<any>(rij.mw_data, {})
  const voor = veld in fonos ? fonos[veld] : mw[veld]
  if (waarde === undefined) {
    if (!(veld in fonos)) return
    delete fonos[veld]
  } else {
    // Gelijk aan de Muziekweb-waarde (bij een titel uit Muziekweb): dan geen Fonos-waarde nodig.
    if (rij.titelnummer && gelijk(mw[veld], waarde) && !(veld in fonos)) return
    if (veld in fonos && gelijk(fonos[veld], waarde)) return
    fonos[veld] = waarde
  }
  const conflicten = json<any>(rij.conflicten, {})
  delete conflicten[veld]
  run('UPDATE titels SET fonos_data = ?, conflicten = ? WHERE id = ?', JSON.stringify(fonos), JSON.stringify(conflicten), id)
  verversWeergave(id)
  const na = waarde === undefined ? mw[veld] : waarde
  log(wie, waarde === undefined ? 'terug naar Muziekweb' : 'veld gewijzigd', { type: 'titel', id, label: rij.d_titel, veld, oud: voor, nieuw: na })
}

/** Beslist een conflict: 'fonos' houdt de Fonos-waarde, 'muziekweb' neemt de nieuwe Muziekweb-waarde. */
export function besluitConflict(id: number, veld: string, keuze: 'fonos' | 'muziekweb', wie: Wie) {
  const rij = get<TitelRij>('SELECT * FROM titels WHERE id = ?', id)
  if (!rij) throw new Error('Titel niet gevonden')
  const conflicten = json<any>(rij.conflicten, {})
  if (!conflicten[veld]) return
  if (keuze === 'muziekweb') {
    zetFonosWaarde(id, veld as keyof TitelVelden, undefined, wie)
  }
  const c2 = json<any>(get<TitelRij>('SELECT conflicten FROM titels WHERE id = ?', id)!.conflicten, {})
  delete c2[veld]
  run('UPDATE titels SET conflicten = ? WHERE id = ?', JSON.stringify(c2), id)
  log(wie, 'conflict besloten', { type: 'titel', id, label: rij.d_titel, veld, nieuw: keuze === 'fonos' ? 'Fonos-waarde blijft' : 'Muziekweb-waarde' })
}

/** Fonos-eigen velden (nooit door de import aangeraakt). */
export const FONOS_EIGEN = ['zichtbaar', 'uitgelicht', 'fonos_verhaal', 'ai_tekst'] as const

export function zetFonosEigen(id: number, veld: (typeof FONOS_EIGEN)[number], waarde: unknown, wie: Wie) {
  const rij = get<any>('SELECT * FROM titels WHERE id = ?', id)
  if (!rij) throw new Error('Titel niet gevonden')
  if (!FONOS_EIGEN.includes(veld)) throw new Error('Onbekend veld')
  const nieuw = veld === 'fonos_verhaal' ? (waarde ? String(waarde) : null) : waarde ? 1 : 0
  if (rij[veld] === nieuw) return
  run(`UPDATE titels SET ${veld} = ?, gewijzigd = datetime('now') WHERE id = ?`, nieuw, id)
  log(wie, 'veld gewijzigd', { type: 'titel', id, label: rij.d_titel, veld, oud: rij[veld], nieuw })
}

/** Nieuwe titel. Met titelnummer: Muziekweb-waarden uit de dump; zonder: alles Fonos-waarden. */
export function maakTitel(opts: { titelnummer?: string | null; mw?: TitelVelden; fonos?: TitelVelden; soort?: string; tip?: boolean }): number {
  const r = run('INSERT INTO titels (titelnummer, soort, mw_data, fonos_data, tip) VALUES (?, ?, ?, ?, ?)',
    opts.titelnummer ?? null, opts.soort ?? 'populair', JSON.stringify(opts.mw ?? {}), JSON.stringify(opts.fonos ?? {}), opts.tip ? 1 : 0)
  const id = Number(r.lastInsertRowid)
  verversWeergave(id)
  return id
}

/**
 * Koppelt een handmatige titel aan een titelnummer (6.2): ingevulde waarden blijven als
 * Fonos-waarden staan, de Muziekweb-waarden worden aangevuld.
 */
export function koppelTitelnummer(id: number, titelnummer: string, wie: Wie) {
  const dump = get<{ data: string }>('SELECT data FROM mw_dump WHERE titelnummer = ?', titelnummer)
  if (!dump) throw new Error('Titelnummer niet gevonden in de laatste Muziekweb-import')
  if (get('SELECT id FROM titels WHERE titelnummer = ? AND id <> ?', titelnummer, id)) throw new Error('Dit titelnummer hoort al bij een andere titel')
  const d = JSON.parse(dump.data)
  run('UPDATE titels SET titelnummer = ?, mw_data = ?, soort = ?, tip = ? WHERE id = ?', titelnummer, JSON.stringify(d.velden), d.soort, d.tip ? 1 : 0, id)
  verversWeergave(id)
  log(wie, 'titelnummer gekoppeld', { type: 'titel', id, veld: 'titelnummer', nieuw: titelnummer })
}

// ------------------------------------------------------------------ beschikbaarheid

/** Exemplaren in een open aanvraag (ingediend of uitgegeven) zijn in gebruik. */
export const OPEN_ITEMS_SQL = `SELECT i.exemplaar_id FROM aanvraag_items i JOIN aanvragen a ON a.id = i.aanvraag_id
  WHERE i.verwijderd = 0 AND a.status IN ('ingediend', 'uitgegeven')`

/** Titels die in de bezoekersapp zichtbaar zijn (6.3). */
export const ZICHTBAAR_SQL = `t.zichtbaar = 1 AND EXISTS (SELECT 1 FROM exemplaren e WHERE e.titel_id = t.id AND e.status = 'in_collectie')`

/** Beschikbaar: zichtbaar en minstens één exemplaar dat niet in gebruik is. */
export const BESCHIKBAAR_SQL = `t.zichtbaar = 1 AND EXISTS (SELECT 1 FROM exemplaren e WHERE e.titel_id = t.id AND e.status = 'in_collectie'
  AND e.id NOT IN (${OPEN_ITEMS_SQL}))`

export function vindcode(e: { vindcode?: string | null; objectnummer: string; titelnummer?: string | null }): string | null {
  const bron = instellingen().vindcode_bron
  if (bron === 'objectnummer') return e.objectnummer
  if (bron === 'titelnummer') return e.titelnummer ?? null
  return e.vindcode ?? null
}

export function exemplarenVan(titelId: number) {
  return all<any>(
    `SELECT e.*, CASE WHEN e.id IN (${OPEN_ITEMS_SQL}) THEN 1 ELSE 0 END AS in_gebruik FROM exemplaren e
      WHERE e.titel_id = ? ORDER BY e.status, e.objectnummer`, titelId,
  )
}

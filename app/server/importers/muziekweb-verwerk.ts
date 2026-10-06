// Muziekweb-import, deel 2: VERWERKEN (generiek, los van het dumpformaat).
// Werkt de Muziekweb-waarden bij; raakt nooit Fonos-waarden aan (6.2, 10.7).
import { all, db, get, run } from '../db.ts'
import { maakTitel, verwerkMuziekweb } from '../titels.ts'
import { log, type Wie } from '../log.ts'
import type { MwRecord } from './muziekweb-lezers.ts'

export type MwRapport = {
  import_id: number
  in_dump: number
  bijgewerkt: number
  ongewijzigd: number
  nieuwe_titels: number
  nieuwe_conflicten: number
  niet_in_dump: number
  niet_in_dump_voorbeelden: string[]
}

export async function verwerkMuziekwebImport(records: AsyncIterable<MwRecord>, wie: Wie, bron: string, voortgang?: (n: number) => void): Promise<MwRapport> {
  const importId = Number(run("INSERT INTO imports (soort, gebruiker, rapport) VALUES ('muziekweb', ?, '{}')", wie.naam).lastInsertRowid)
  const rapport: MwRapport = { import_id: importId, in_dump: 0, bijgewerkt: 0, ongewijzigd: 0, nieuwe_titels: 0, nieuwe_conflicten: 0, niet_in_dump: 0, niet_in_dump_voorbeelden: [] }
  const d = db()
  const upsertDump = d.prepare('INSERT INTO mw_dump (titelnummer, data, import_id) VALUES (?, ?, ?) ON CONFLICT(titelnummer) DO UPDATE SET data = excluded.data, import_id = excluded.import_id')
  const zoekTitel = d.prepare('SELECT id, mw_data, soort, tip FROM titels WHERE titelnummer = ?')

  let batch: MwRecord[] = []
  const verwerkBatch = () => {
    d.exec('BEGIN IMMEDIATE')
    try {
      for (const r of batch) {
        upsertDump.run(r.titelnummer, JSON.stringify({ soort: r.soort, tip: r.tip, velden: r.velden }), importId)
        const t = zoekTitel.get(r.titelnummer) as any
        if (!t) continue
        if (t.mw_data === JSON.stringify(r.velden) && t.soort === r.soort && !!t.tip === r.tip) { rapport.ongewijzigd++; continue }
        rapport.nieuwe_conflicten += verwerkMuziekweb(t.id, r.velden, { soort: r.soort, tip: r.tip })
        rapport.bijgewerkt++
      }
      d.exec('COMMIT')
    } catch (e) { d.exec('ROLLBACK'); throw e }
    rapport.in_dump += batch.length
    voortgang?.(rapport.in_dump)
    batch = []
  }
  for await (const r of records) {
    if (!r?.titelnummer) continue
    batch.push(r)
    if (batch.length >= 1000) verwerkBatch()
  }
  if (batch.length) verwerkBatch()

  // Exemplaren met een titelnummer dat nu wel in de dump staat: titel aanmaken en koppelen.
  rapport.nieuwe_titels = koppelLosseExemplaren()

  const niet = all<{ titelnummer: string }>(
    `SELECT t.titelnummer FROM titels t LEFT JOIN mw_dump m ON m.titelnummer = t.titelnummer
      WHERE t.titelnummer IS NOT NULL AND (m.titelnummer IS NULL OR m.import_id <> ?)`, importId)
  rapport.niet_in_dump = niet.length
  rapport.niet_in_dump_voorbeelden = niet.slice(0, 50).map((r) => r.titelnummer)
  run('UPDATE imports SET rapport = ? WHERE id = ?', JSON.stringify({ ...rapport, bron }), importId)
  log(wie, 'Muziekweb-import', { type: 'import', id: importId, label: bron, nieuw: rapport })
  return rapport
}

/** Maakt titels aan voor exemplaren met een bekend titelnummer zonder gekoppelde titel. */
export function koppelLosseExemplaren(): number {
  const los = all<{ titelnummer: string }>(
    `SELECT DISTINCT e.titelnummer FROM exemplaren e JOIN mw_dump m ON m.titelnummer = e.titelnummer
      WHERE e.titel_id IS NULL AND e.titelnummer IS NOT NULL`)
  let n = 0
  const d = db()
  d.exec('BEGIN IMMEDIATE')
  try {
    for (const { titelnummer } of los) {
      let t = get<{ id: number }>('SELECT id FROM titels WHERE titelnummer = ?', titelnummer)
      if (!t) {
        const dump = JSON.parse(get<{ data: string }>('SELECT data FROM mw_dump WHERE titelnummer = ?', titelnummer)!.data)
        t = { id: maakTitel({ titelnummer, mw: dump.velden, soort: dump.soort, tip: dump.tip }) }
        n++
      }
      run("UPDATE exemplaren SET titel_id = ?, gewijzigd = datetime('now') WHERE titelnummer = ? AND titel_id IS NULL", t.id, titelnummer)
    }
    d.exec('COMMIT')
  } catch (e) { d.exec('ROLLBACK'); throw e }
  return n
}

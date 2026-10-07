// Muziekweb-import, deel 2: VERWERKEN (generiek, los van het dumpformaat).
// Werkt de Muziekweb-waarden bij; raakt nooit Fonos-waarden aan (6.2, 10.7).
import { all, get, insert, run, tx } from '../db.ts'
import { afgeleid, bewaarWoorden, getoond, verwerkMuziekweb, ZOEK_SQL } from '../titels.ts'
import { log, type Wie } from '../log.ts'
import type { MwRecord } from './muziekweb-lezers.ts'
import type { TitelVelden } from '../../shared/velden.ts'

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

export const leegRapport = (importId: number): MwRapport => ({ import_id: importId, in_dump: 0, bijgewerkt: 0, ongewijzigd: 0, nieuwe_titels: 0, nieuwe_conflicten: 0, niet_in_dump: 0, niet_in_dump_voorbeelden: [] })

export async function startImport(wie: Wie): Promise<number> {
  return insert("INSERT INTO imports (soort, gebruiker, rapport) VALUES ('muziekweb', ?, '{}')", wie.naam)
}

/** Verwerkt een reeks records binnen een lopende import (kan in delen, over meerdere verzoeken). */
export async function verwerkRecords(records: MwRecord[], importId: number, rapport: MwRapport) {
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500).filter((r) => r?.titelnummer)
    await tx(async () => {
      await run(`INSERT INTO mw_dump (titelnummer, data, import_id)
        SELECT x.titelnummer, x.data, ? FROM jsonb_to_recordset(?::jsonb) AS x(titelnummer text, data text)
        ON CONFLICT (titelnummer) DO UPDATE SET data = excluded.data, import_id = excluded.import_id`,
        importId, JSON.stringify(batch.map((r) => ({ titelnummer: r.titelnummer, data: JSON.stringify({ soort: r.soort, tip: r.tip, velden: r.velden }) }))))
      const bestaand = await all<any>('SELECT id, titelnummer, mw_data, fonos_data, soort, tip FROM titels WHERE titelnummer = ANY(?::text[])',
        `{${batch.map((r) => `"${r.titelnummer.replace(/"/g, '')}"`).join(',')}}`)
      const perNummer = new Map(bestaand.map((t) => [t.titelnummer, t]))
      const bulk: any[] = []
      const woorden = new Set<string>()
      for (const r of batch) {
        const t = perNummer.get(r.titelnummer)
        if (!t) continue
        if (t.mw_data === JSON.stringify(r.velden) && t.soort === r.soort && !!t.tip === r.tip) { rapport.ongewijzigd++; continue }
        rapport.bijgewerkt++
        // Met Fonos-waarden per titel (conflicten); zonder Fonos-waarden in één UPDATE voor het hele blok.
        if (t.fonos_data && t.fonos_data !== '{}') { rapport.nieuwe_conflicten += await verwerkMuziekweb(t.id, r.velden, { soort: r.soort, tip: r.tip }); continue }
        const a = afgeleid(getoond({ mw_data: JSON.stringify(r.velden), fonos_data: '{}' }), {})
        a.woorden.forEach((w) => woorden.add(w))
        bulk.push({ id: t.id, mw: JSON.stringify(r.velden), soort: r.soort, tip: r.tip ? 1 : 0, ti: a.d_titel, ar: a.d_artiesten, ja: a.d_jaar, dr: a.d_drager, ge: a.d_genres,
          ho: a.d_hoes, la: a.d_label, pe: a.d_personen, sl: a.d_sleutel, za: a.z.a, zb: a.z.b, zc: a.z.c, zd: a.z.d })
      }
      if (bulk.length) {
        await run(`UPDATE titels t SET mw_data = x.mw, soort = x.soort, tip = x.tip, d_titel = x.ti, d_artiesten = x.ar, d_jaar = x.ja, d_drager = x.dr, d_genres = x.ge,
            d_hoes = x.ho, d_label = x.la, d_personen = x.pe, d_sleutel = x.sl, heeft_fonos = 0,
            zoek = setweight(to_tsvector('simple', x.za), 'A') || setweight(to_tsvector('simple', x.zb), 'B') || setweight(to_tsvector('simple', x.zc), 'C') || setweight(to_tsvector('simple', x.zd), 'D'),
            gewijzigd = nu()
          FROM jsonb_to_recordset(?::jsonb) AS x(id int, mw text, soort text, tip int, ti text, ar text, ja int, dr text, ge text, ho text, la text, pe text, sl text, za text, zb text, zc text, zd text)
          WHERE t.id = x.id`, JSON.stringify(bulk))
        await bewaarWoorden([...woorden])
      }
    })
    rapport.in_dump += batch.length
  }
}

/** Sluit een import af: losse exemplaren koppelen, rapport vastleggen, log. */
/** volledig = deze import bevat de hele dump; alleen dan telt "niet (meer) in de dump" ook titels die er eerder wel in stonden. */
export async function rondImportAf(importId: number, rapport: MwRapport, wie: Wie, bron: string, volledig = true) {
  rapport.nieuwe_titels += await koppelLosseExemplaren()
  const niet = await all<{ titelnummer: string }>(
    `SELECT t.titelnummer FROM titels t LEFT JOIN mw_dump m ON m.titelnummer = t.titelnummer
      WHERE t.titelnummer IS NOT NULL AND (m.titelnummer IS NULL OR (?::int = 1 AND m.import_id <> ?))`, volledig, importId)
  rapport.niet_in_dump = niet.length
  rapport.niet_in_dump_voorbeelden = niet.slice(0, 50).map((r) => r.titelnummer)
  await run('UPDATE imports SET rapport = ? WHERE id = ?', JSON.stringify({ ...rapport, bron, volledig, afgerond: true }), importId)
  await log(wie, 'Muziekweb-import', { type: 'import', id: importId, label: bron, nieuw: rapport })
  return rapport
}

/** Volledige import in één keer (opdrachtregel, tests en kleine dumps). */
export async function verwerkMuziekwebImport(records: AsyncIterable<MwRecord>, wie: Wie, bron: string, voortgang?: (n: number) => void): Promise<MwRapport> {
  const importId = await startImport(wie)
  const rapport = leegRapport(importId)
  let batch: MwRecord[] = []
  for await (const r of records) {
    batch.push(r)
    if (batch.length >= 2000) { await verwerkRecords(batch, importId, rapport); batch = []; voortgang?.(rapport.in_dump) }
  }
  if (batch.length) await verwerkRecords(batch, importId, rapport)
  voortgang?.(rapport.in_dump)
  return rondImportAf(importId, rapport, wie, bron)
}

/** Nieuwe titels in bulk (één INSERT per blok), met afgeleide kolommen en zoekvector. */
export async function maakTitelsBulk(rijen: { titelnummer: string | null; soort: string; tip: boolean; mw: TitelVelden }[]): Promise<Map<string, number>> {
  const ids = new Map<string, number>()
  for (let i = 0; i < rijen.length; i += 150) {
    const blok = rijen.slice(i, i + 150)
    const p: unknown[] = []
    const woorden = new Set<string>()
    const waarden = blok.map((r) => {
      const a = afgeleid(r.mw, {})
      a.woorden.forEach((w) => woorden.add(w))
      p.push(r.titelnummer, r.soort, JSON.stringify(r.mw), r.tip ? 1 : 0, a.d_titel, a.d_artiesten, a.d_jaar, a.d_drager, a.d_genres, a.d_hoes, a.d_label,
        a.d_personen, a.d_sleutel, a.z.a, a.z.b, a.z.c, a.z.d)
      return `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${ZOEK_SQL})`
    })
    const r = await run(`INSERT INTO titels (titelnummer, soort, mw_data, tip, d_titel, d_artiesten, d_jaar, d_drager, d_genres, d_hoes, d_label, d_personen, d_sleutel, zoek)
      VALUES ${waarden.join(',')} ON CONFLICT (titelnummer) DO NOTHING RETURNING id, titelnummer`, ...p)
    for (const x of r.rows) ids.set(x.titelnummer, x.id)
    await bewaarWoorden([...woorden])
  }
  return ids
}

/** Maakt titels aan voor exemplaren met een bekend titelnummer zonder gekoppelde titel. */
export async function koppelLosseExemplaren(): Promise<number> {
  let nieuw = 0
  for (;;) {
    const los = await all<{ titelnummer: string; data: string }>(
      `SELECT DISTINCT e.titelnummer, m.data FROM exemplaren e JOIN mw_dump m ON m.titelnummer = e.titelnummer
        WHERE e.titel_id IS NULL AND NOT EXISTS (SELECT 1 FROM titels t WHERE t.titelnummer = e.titelnummer) LIMIT 1500`)
    if (!los.length) break
    const ids = await maakTitelsBulk(los.map((l) => { const d = JSON.parse(l.data); return { titelnummer: l.titelnummer, soort: d.soort, tip: d.tip, mw: d.velden } }))
    nieuw += ids.size
    if (!ids.size) break
  }
  await run(`UPDATE exemplaren e SET titel_id = t.id, gewijzigd = nu() FROM titels t
    WHERE e.titel_id IS NULL AND e.titelnummer IS NOT NULL AND t.titelnummer = e.titelnummer`)
  return nieuw
}

export async function laatsteImportId() {
  // Alleen afgeronde, volledige imports; anders telt een gedeeltelijke import alle andere titels als "niet in dump".
  return (await get<{ id: number | null }>("SELECT MAX(id) AS id FROM imports WHERE soort = 'muziekweb' AND rapport::jsonb->>'volledig' = 'true'"))?.id ?? 0
}

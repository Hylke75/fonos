// API voor de beheeromgeving (10, 12). Rollen: redacteur en beheerder.
import { Hono, type Context } from 'hono'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { vereist, wie, maakGebruiker, maakResetToken } from '../auth.ts'
import { all, get, run, insert, json, instellingen, zetInstelling, syncPlatenspelers, STANDAARD_INSTELLINGEN, tx, ROOT } from '../db.ts'
import { log } from '../log.ts'
import { TWEELAAGS, ROLLEN, REDENEN_AFVOER, type TitelVelden } from '../../shared/velden.ts'
import {
  getoond, zetFonosWaarde, besluitConflict, zetFonosEigen, FONOS_EIGEN, maakTitel, koppelTitelnummer, exemplarenVan, OPEN_ITEMS_SQL, vindcoder, ZICHTBAAR_SQL,
} from '../titels.ts'
import { album, wisConfigCache, wisHomeCache, selectieIds } from '../catalogus.ts'
import { analyseer, leesBestand, samenvatting, voerDoor, type Categorie } from '../importers/collectie.ts'
import { exportDelen, leesExportDeel, leesStandaard } from '../importers/muziekweb-lezers.ts'
import { laatsteImportId, leegRapport, rondImportAf, startImport, verwerkRecords } from '../importers/muziekweb-verwerk.ts'
import { backupAdres, leesBackup, maakBackup, maakZip, vergelijk, zetTerug } from '../backup.ts'
import { beschikbaarheidGewijzigd, catalogusVersieOmhoog } from '../events.ts'
import { bewaar, lees, BLOB_TOEGANG } from '../opslag.ts'
import { stuurMail } from '../mail.ts'
import { albumIdUit } from '../spotify/normaliseer.ts'

export const beheer = new Hono()
beheer.use('*', vereist('redacteur', 'beheerder'))
const alleenBeheerder = vereist('beheerder')

const fout = (c: Context, bericht: string, status: 400 | 404 | 409 = 400) => c.json({ fout: bericht }, status)
const catalogusGewijzigd = async (titelIds: number[] = []) => { wisConfigCache(); wisHomeCache(); await catalogusVersieOmhoog(); await beschikbaarheidGewijzigd(titelIds) }

// ------------------------------------------------------------------ startpagina (10.1)

beheer.get('/tellers', async (c) => {
  const n = async (sql: string) => (await get<{ n: number }>(sql))!.n
  return c.json({
    titels: await n('SELECT COUNT(*) AS n FROM titels'),
    exemplaren: await n("SELECT COUNT(*) AS n FROM exemplaren WHERE status = 'in_collectie'"),
    datakwaliteit: Object.values(await dqTellingen()).reduce((a, b) => a + b, 0),
    laatste_import: (await get<any>("SELECT tijd FROM imports WHERE soort = 'muziekweb' AND (rapport::jsonb->>'afgerond' = 'true' OR rapport::jsonb->>'bron' IS NOT NULL) ORDER BY id DESC LIMIT 1"))?.tijd ?? null,
    laatste_backup: (await get<any>("SELECT tijd FROM backups WHERE status = 'gelukt' ORDER BY id DESC LIMIT 1"))?.tijd ?? null,
  })
})

beheer.get('/titels', async (c) => {
  const q = c.req.query()
  const waar: string[] = []
  const p: any[] = []
  if (q.q?.trim()) {
    const z = `%${q.q.trim()}%`
    waar.push(`(t.d_titel ILIKE ? OR t.d_artiesten ILIKE ? OR t.titelnummer ILIKE ? OR EXISTS (SELECT 1 FROM exemplaren e WHERE e.titel_id = t.id AND (e.objectnummer ILIKE ? OR e.vindcode ILIKE ?)))`)
    p.push(z, z, z, z, z)
  }
  if (q.drager) { waar.push('t.d_drager = ?'); p.push(q.drager) }
  if (q.soort) { waar.push('t.soort = ?'); p.push(q.soort) }
  if (q.zichtbaar) { waar.push('t.zichtbaar = ?'); p.push(q.zichtbaar === 'ja' ? 1 : 0) }
  if (q.aangepast) { waar.push('t.heeft_fonos = ?'); p.push(q.aangepast === 'ja' ? 1 : 0) }
  if (q.genre) { waar.push('t.d_genres::jsonb @> ?::jsonb'); p.push(JSON.stringify([q.genre])) }
  if (q.collectie === 'in') waar.push("EXISTS (SELECT 1 FROM exemplaren e WHERE e.titel_id = t.id AND e.status = 'in_collectie')")
  if (q.collectie === 'uit') waar.push("NOT EXISTS (SELECT 1 FROM exemplaren e WHERE e.titel_id = t.id AND e.status = 'in_collectie')")
  const where = waar.length ? `WHERE ${waar.join(' AND ')}` : ''
  const per = Math.min(Number(q.per) || 50, 200)
  const pagina = Math.max(1, Number(q.pagina) || 1)
  const sorteer = ({ titel: 'lower(t.d_titel)', artiest: 't.d_artiesten IS NULL, lower(t.d_artiesten)', jaar: 't.d_jaar DESC NULLS LAST', nieuw: 't.id DESC' } as any)[q.sort] ?? 't.d_artiesten IS NULL, lower(t.d_artiesten), lower(t.d_titel), t.id'
  const totaal = (await get<{ n: number }>(`SELECT COUNT(*) AS n FROM titels t ${where}`, ...p))!.n
  const titels = await all<any>(`SELECT t.id, t.titelnummer, t.d_titel AS titel, t.d_artiesten AS artiesten, t.d_jaar AS jaar, t.d_drager AS drager, t.d_hoes AS hoes,
      t.zichtbaar, t.heeft_fonos, (t.conflicten <> '{}')::int AS conflict, t.soort,
      (SELECT COUNT(*)::int FROM exemplaren e WHERE e.titel_id = t.id AND e.status = 'in_collectie') AS exemplaren
    FROM titels t ${where} ORDER BY ${sorteer} LIMIT ? OFFSET ?`, ...p, per, (pagina - 1) * per)
  return c.json({ totaal, pagina, per, titels })
})

beheer.get('/genres', async (c) => {
  // Alle bekende Muziekweb-genres in de collectie, met aantallen.
  const rows = await all<any>(`SELECT j.value AS naam, COUNT(*)::int AS n FROM titels t, jsonb_array_elements_text(t.d_genres::jsonb) j(value) GROUP BY j.value ORDER BY j.value`)
  return c.json(rows)
})

// ------------------------------------------------------------------ titel bewerken (10.2)

async function titelDetail(id: number) {
  const vindcode = await vindcoder()
  const t = await get<any>('SELECT * FROM titels WHERE id = ?', id)
  if (!t) return null
  const dumpRij = t.titelnummer ? await get<any>('SELECT import_id FROM mw_dump WHERE titelnummer = ?', t.titelnummer) : null
  return {
    id: t.id, titelnummer: t.titelnummer, soort: t.soort, tip: !!t.tip,
    mw: json(t.mw_data, {}), fonos: json(t.fonos_data, {}), getoond: getoond(t), conflicten: json(t.conflicten, {}),
    zichtbaar: !!t.zichtbaar, uitgelicht: !!t.uitgelicht, fonos_verhaal: t.fonos_verhaal, ai_tekst: !!t.ai_tekst,
    in_dump: !!dumpRij, aangemaakt: t.aangemaakt, gewijzigd: t.gewijzigd,
    spotify_aan: !!(await instellingen()).spotify_aan,
    spotify: { status: t.spotify_status, album_id: t.spotify_album_id, score: t.spotify_score == null ? null : Number(t.spotify_score), kandidaten: json(t.spotify_kandidaat, []), gecontroleerd_op: t.spotify_gecontroleerd_op },
    exemplaren: (await exemplarenVan(id)).map((e) => ({ ...e, vindcode_getoond: vindcode(e) })),
    geschiedenis: await all<any>("SELECT * FROM wijzigingslog WHERE record_type = 'titel' AND record_id = ? ORDER BY id DESC LIMIT 200", String(id)),
  }
}

beheer.get('/titel/:id', async (c) => {
  const d = await titelDetail(Number(c.req.param('id')))
  return d ? c.json(d) : fout(c, 'Titel niet gevonden', 404)
})

beheer.get('/titel/:id/voorbeeld', async (c) => {
  const a = await album(Number(c.req.param('id')), true)
  return a ? c.json(a) : fout(c, 'Titel niet gevonden', 404)
})

beheer.patch('/titel/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ velden?: Partial<TitelVelden>; eigen?: Record<string, unknown> }>()
  if (!await get('SELECT id FROM titels WHERE id = ?', id)) return fout(c, 'Titel niet gevonden', 404)
  await tx(async () => {
    for (const [veld, waarde] of Object.entries(body.velden ?? {})) {
      if (!TWEELAAGS.some((v) => v.veld === veld)) throw new Error(`Onbekend veld ${veld}`)
      await zetFonosWaarde(id, veld as keyof TitelVelden, waarde === null ? undefined : waarde, wie(c))
    }
    for (const [veld, waarde] of Object.entries(body.eigen ?? {})) {
      if (!FONOS_EIGEN.includes(veld as any)) throw new Error(`Onbekend veld ${veld}`)
      await zetFonosEigen(id, veld as any, waarde, wie(c))
    }
  })
  await catalogusGewijzigd([id])
  return c.json(await titelDetail(id))
})

beheer.post('/titel/:id/terug', async (c) => {
  const id = Number(c.req.param('id'))
  const { veld } = await c.req.json<{ veld: keyof TitelVelden }>()
  await zetFonosWaarde(id, veld, undefined, wie(c))
  await catalogusGewijzigd([id])
  return c.json(await titelDetail(id))
})

beheer.post('/titel/:id/conflict', async (c) => {
  const id = Number(c.req.param('id'))
  const { veld, keuze } = await c.req.json<{ veld: string; keuze: 'fonos' | 'muziekweb' }>()
  await besluitConflict(id, veld, keuze, wie(c))
  await catalogusGewijzigd([id])
  return c.json(await titelDetail(id))
})

beheer.post('/titel/:id/koppel', async (c) => {
  const id = Number(c.req.param('id'))
  const { titelnummer } = await c.req.json<{ titelnummer: string }>()
  try { await koppelTitelnummer(id, titelnummer.trim().toUpperCase(), wie(c)) } catch (e: any) { return fout(c, e.message) }
  await catalogusGewijzigd([id])
  return c.json(await titelDetail(id))
})

const AFBEELDING = /^image\/(jpeg|png|webp)$/
async function bewaarUpload(c: Context): Promise<string> {
  const body = await c.req.parseBody()
  const f = body.bestand as File | undefined
  if (!f || typeof f === 'string') throw new Error('Geen bestand ontvangen')
  if (!AFBEELDING.test(f.type)) throw new Error('Alleen jpg, png of webp')
  // Vercel-functies nemen maximaal 4,5 MB per verzoek aan.
  if (f.size > 4 * 1024 * 1024) throw new Error('Bestand is groter dan 4 MB')
  return bewaar('hoezen', `hoes${extname(f.name).toLowerCase() || '.jpg'}`, Buffer.from(await f.arrayBuffer()), f.type)
}

beheer.post('/titel/:id/hoes/:kant', async (c) => {
  const id = Number(c.req.param('id'))
  const kant = c.req.param('kant') === 'achter' ? 'hoes_achter' : 'hoes_voor'
  try {
    const url = await bewaarUpload(c)
    await zetFonosWaarde(id, kant, url, wie(c))
  } catch (e: any) { return fout(c, e.message) }
  await catalogusGewijzigd([id])
  return c.json(await titelDetail(id))
})

beheer.post('/titels/bulk', async (c) => {
  const { ids, zichtbaar, uitgelicht } = await c.req.json<{ ids: number[]; zichtbaar?: boolean; uitgelicht?: boolean }>()
  await tx(async () => {
    for (const id of ids ?? []) {
      if (zichtbaar !== undefined) await zetFonosEigen(Number(id), 'zichtbaar', zichtbaar, wie(c))
      if (uitgelicht !== undefined) await zetFonosEigen(Number(id), 'uitgelicht', uitgelicht, wie(c))
    }
  })
  await catalogusGewijzigd(ids)
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ toevoegen (10.4) en exemplaren (10.3, 10.5)

beheer.get('/dump/:titelnummer', async (c) => {
  const tn = c.req.param('titelnummer').trim().toUpperCase()
  const d = await get<any>('SELECT data FROM mw_dump WHERE titelnummer = ?', tn)
  const bestaand = await get<any>('SELECT id FROM titels WHERE titelnummer = ?', tn)
  if (!d) return fout(c, 'Titelnummer niet gevonden in de laatste Muziekweb-import', 404)
  return c.json({ titelnummer: tn, ...JSON.parse(d.data), bestaande_titel: bestaand?.id ?? null })
})

const OBJECT_RE = /^[A-Za-z0-9]{5,}$/

beheer.post('/titels', async (c) => {
  const b = await c.req.json<{ titelnummer?: string; objectnummer?: string; vindcode?: string; handmatig?: TitelVelden }>()
  const obj = b.objectnummer?.trim()
  if (obj && !OBJECT_RE.test(obj)) return fout(c, 'Een objectnummer bestaat uit minstens 5 letters of cijfers')
  if (obj && await get('SELECT id FROM exemplaren WHERE objectnummer = ?', obj)) return fout(c, `Objectnummer ${obj} bestaat al`, 409)
  let id: number
  try {
    id = await tx(async () => {
      let titelId: number
      if (b.titelnummer) {
        const tn = b.titelnummer.trim().toUpperCase()
        const bestaand = await get<any>('SELECT id FROM titels WHERE titelnummer = ?', tn)
        if (bestaand) titelId = bestaand.id // alleen een exemplaar toevoegen
        else {
          const d = await get<any>('SELECT data FROM mw_dump WHERE titelnummer = ?', tn)
          if (!d) throw new Error('Titelnummer niet gevonden in de laatste Muziekweb-import')
          const dump = JSON.parse(d.data)
          titelId = await maakTitel({ titelnummer: tn, mw: dump.velden, soort: dump.soort, tip: dump.tip })
          await log(wie(c), 'titel toegevoegd', { type: 'titel', id: titelId, label: dump.velden.titel, nieuw: tn })
        }
      } else if (b.handmatig) {
        if (!b.handmatig.titel?.trim()) throw new Error('Vul minstens een titel in')
        const velden = Object.fromEntries(Object.entries(b.handmatig).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length)))
        titelId = await maakTitel({ fonos: velden as TitelVelden })
        await log(wie(c), 'titel toegevoegd (handmatig)', { type: 'titel', id: titelId, label: b.handmatig.titel, nieuw: velden })
      } else throw new Error('Geef een titelnummer of vul de velden handmatig in')
      if (obj) {
        const tn = (await get<any>('SELECT titelnummer FROM titels WHERE id = ?', titelId))!.titelnummer
        const eid = await insert('INSERT INTO exemplaren (objectnummer, titel_id, titelnummer, vindcode, bron) VALUES (?, ?, ?, ?, ?)', obj, titelId, tn, b.vindcode?.trim() || null, 'beheer')
        await log(wie(c), 'exemplaar toegevoegd', { type: 'exemplaar', id: Number(eid), label: obj, nieuw: { titel_id: titelId, vindcode: b.vindcode } })
      }
      return titelId
    })
  } catch (e: any) { return fout(c, e.message) }
  await catalogusGewijzigd([id])
  return c.json(await titelDetail(id))
})

beheer.post('/exemplaren', async (c) => {
  const b = await c.req.json<{ titel_id: number; objectnummer: string; vindcode?: string }>()
  const obj = b.objectnummer?.trim()
  if (!obj || !OBJECT_RE.test(obj)) return fout(c, 'Vul een geldig objectnummer in')
  if (await get('SELECT id FROM exemplaren WHERE objectnummer = ?', obj)) return fout(c, `Objectnummer ${obj} bestaat al`, 409)
  const t = await get<any>('SELECT id, titelnummer, d_titel FROM titels WHERE id = ?', b.titel_id)
  if (!t) return fout(c, 'Titel niet gevonden', 404)
  const eid = await insert('INSERT INTO exemplaren (objectnummer, titel_id, titelnummer, vindcode, bron) VALUES (?, ?, ?, ?, ?)', obj, t.id, t.titelnummer, b.vindcode?.trim() || null, 'beheer')
  await log(wie(c), 'exemplaar toegevoegd', { type: 'exemplaar', id: Number(eid), label: obj, nieuw: { titel: t.d_titel, vindcode: b.vindcode } })
  await catalogusGewijzigd([t.id])
  return c.json(await titelDetail(t.id))
})

const inOpenAanvraag = async (exemplaarId: number) => !!await get(`SELECT 1 FROM (${OPEN_ITEMS_SQL}) x WHERE x.exemplaar_id = ?`, exemplaarId)

beheer.get('/exemplaar/:id', async (c) => {
  const e = await get<any>('SELECT e.*, t.d_titel AS titel, t.d_artiesten AS artiesten FROM exemplaren e LEFT JOIN titels t ON t.id = e.titel_id WHERE e.id = ?', Number(c.req.param('id')))
  return e ? c.json({ ...e, in_gebruik: await inOpenAanvraag(e.id), geschiedenis: await all("SELECT * FROM wijzigingslog WHERE record_type = 'exemplaar' AND record_id = ? ORDER BY id DESC", String(e.id)) }) : fout(c, 'Exemplaar niet gevonden', 404)
})

beheer.patch('/exemplaar/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const e = await get<any>('SELECT * FROM exemplaren WHERE id = ?', id)
  if (!e) return fout(c, 'Exemplaar niet gevonden', 404)
  const b = await c.req.json<{ objectnummer?: string; vindcode?: string | null; titel_id?: number | null; titelnummer?: string | null }>()
  const wijz: [string, any][] = []
  if (b.objectnummer !== undefined && b.objectnummer.trim() !== e.objectnummer) {
    const o = b.objectnummer.trim()
    if (!OBJECT_RE.test(o)) return fout(c, 'Een objectnummer bestaat uit minstens 5 letters of cijfers')
    if (await get('SELECT id FROM exemplaren WHERE objectnummer = ? AND id <> ?', o, id)) return fout(c, `Objectnummer ${o} bestaat al`, 409)
    wijz.push(['objectnummer', o])
  }
  if (b.vindcode !== undefined && (b.vindcode?.trim() || null) !== e.vindcode) wijz.push(['vindcode', b.vindcode?.trim() || null])
  if (b.titelnummer !== undefined || b.titel_id !== undefined) {
    // Koppelen aan een andere titel (correctie), op titel-ID of titelnummer.
    let t: any = null
    if (b.titel_id) t = await get('SELECT id, titelnummer FROM titels WHERE id = ?', b.titel_id)
    else if (b.titelnummer) {
      const tn = b.titelnummer.trim().toUpperCase()
      t = await get('SELECT id, titelnummer FROM titels WHERE titelnummer = ?', tn)
      if (!t) {
        const d = await get<any>('SELECT data FROM mw_dump WHERE titelnummer = ?', tn)
        if (!d) return fout(c, 'Titelnummer niet gevonden in de collectie of de laatste Muziekweb-import')
        const dump = JSON.parse(d.data)
        t = { id: await maakTitel({ titelnummer: tn, mw: dump.velden, soort: dump.soort, tip: dump.tip }), titelnummer: tn }
      }
    }
    if (t && t.id !== e.titel_id) {
      if (await inOpenAanvraag(id)) return fout(c, 'Dit exemplaar zit in een open aanvraag', 409)
      wijz.push(['titel_id', t.id], ['titelnummer', t.titelnummer])
    }
  }
  for (const [veld, waarde] of wijz) {
    await run(`UPDATE exemplaren SET ${veld} = ?, gewijzigd = nu() WHERE id = ?`, waarde, id)
    await log(wie(c), 'veld gewijzigd', { type: 'exemplaar', id, label: e.objectnummer, veld, oud: e[veld], nieuw: waarde })
  }
  await catalogusGewijzigd([e.titel_id])
  return c.json(await get('SELECT * FROM exemplaren WHERE id = ?', id))
})

beheer.post('/exemplaar/:id/afvoeren', async (c) => {
  const id = Number(c.req.param('id'))
  const { reden, toelichting } = await c.req.json<{ reden: string; toelichting?: string }>()
  const e = await get<any>('SELECT * FROM exemplaren WHERE id = ?', id)
  if (!e) return fout(c, 'Exemplaar niet gevonden', 404)
  if (!reden || !(reden in REDENEN_AFVOER)) return fout(c, 'Kies een reden')
  if (reden === 'overig' && !toelichting?.trim()) return fout(c, 'Geef een toelichting bij "overig"')
  if (await inOpenAanvraag(id)) return fout(c, 'Dit exemplaar zit in een open aanvraag. Sluit die eerst af of haal het eruit.', 409)
  await run("UPDATE exemplaren SET status = 'uit_collectie', reden_afvoer = ?, toelichting_afvoer = ?, gewijzigd = nu() WHERE id = ?", reden, toelichting?.trim() || null, id)
  await log(wie(c), 'exemplaar afgevoerd', { type: 'exemplaar', id, label: e.objectnummer, veld: 'status', oud: 'in collectie', nieuw: `uit collectie (${REDENEN_AFVOER[reden]}${toelichting ? ': ' + toelichting : ''})` })
  await catalogusGewijzigd([e.titel_id])
  return c.json({ ok: true })
})

beheer.post('/exemplaar/:id/terugzetten', async (c) => {
  const id = Number(c.req.param('id'))
  const e = await get<any>('SELECT * FROM exemplaren WHERE id = ?', id)
  if (!e) return fout(c, 'Exemplaar niet gevonden', 404)
  await run("UPDATE exemplaren SET status = 'in_collectie', reden_afvoer = NULL, toelichting_afvoer = NULL, gewijzigd = nu() WHERE id = ?", id)
  await log(wie(c), 'afvoeren teruggedraaid', { type: 'exemplaar', id, label: e.objectnummer, veld: 'status', oud: 'uit collectie', nieuw: 'in collectie' })
  await catalogusGewijzigd([e.titel_id])
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ bulkimport collectie (10.6)

beheer.post('/import/collectie', async (c) => {
  const body = await c.req.parseBody()
  const f = body.bestand as File | undefined
  if (!f || typeof f === 'string') return fout(c, 'Geen bestand ontvangen')
  if (!/\.(xlsx|csv|txt)$/i.test(f.name)) return fout(c, 'Upload een .xlsx- of .csv-bestand')
  try {
    const { regels, overgeslagen } = await leesBestand(Buffer.from(await f.arrayBuffer()), f.name)
    if (!regels.length) return fout(c, 'Geen regels met objectnummer of titelnummer gevonden')
    return c.json(samenvatting(await analyseer(regels, f.name, overgeslagen)))
  } catch (e: any) { return fout(c, `Bestand niet te lezen: ${e.message}`) }
})

beheer.post('/import/collectie/:token', async (c) => {
  const { categorieen } = await c.req.json<{ categorieen: Categorie[] }>()
  try {
    const r = await voerDoor(c.req.param('token'), categorieen ?? [], wie(c))
    await catalogusGewijzigd()
    return c.json(r)
  } catch (e: any) { return fout(c, e.message) }
})

beheer.get('/imports', async (c) => c.json((await all<any>('SELECT * FROM imports ORDER BY id DESC LIMIT 50')).map((i) => ({ ...i, rapport: json(i.rapport, {}) }))))

// ------------------------------------------------------------------ Muziekweb-import (10.7), beheerder
// Op Vercel in stappen: per deel van de meegeleverde exportmap één verzoek; de browser stuurt de stappen.

const exportMap = () => process.env.FONOS_DUMP_DIR ?? join(ROOT, '..', 'exports')

beheer.post('/import/muziekweb/start', alleenBeheerder, async (c) => {
  const id = await startImport(wie(c))
  await run("INSERT INTO taken (id, soort, data) VALUES (?, 'mwimport', ?)", `mw-${id}`, JSON.stringify(leegRapport(id)))
  return c.json({ import_id: id, delen: exportDelen(exportMap()) })
})

async function mwRapport(id: number) {
  const t = await get<{ data: string }>("SELECT data FROM taken WHERE id = ?", `mw-${id}`)
  if (!t) throw new Error('Deze import is niet (meer) bekend. Start opnieuw.')
  return JSON.parse(t.data) as ReturnType<typeof leegRapport>
}
const bewaarRapport = (id: number, r: any) => run('UPDATE taken SET data = ? WHERE id = ?', JSON.stringify(r), `mw-${id}`)

beheer.post('/import/muziekweb/deel', alleenBeheerder, async (c) => {
  const { import_id, deel } = await c.req.json<{ import_id: number; deel: string }>()
  if (!/^part-\d+$/.test(deel ?? '')) return fout(c, 'Onbekend deel')
  try {
    const rapport = await mwRapport(import_id)
    await verwerkRecords(await leesExportDeel(join(exportMap(), deel)), import_id, rapport)
    await bewaarRapport(import_id, rapport)
    return c.json(rapport)
  } catch (e: any) { return fout(c, e.message) }
})

/** Een geüploade dump (.jsonl, .jsonl.gz of zip met één deel), via de aparte opslag. */
beheer.post('/import/muziekweb/bestand', alleenBeheerder, async (c) => {
  const { import_id, adres, naam } = await c.req.json<{ import_id: number; adres: string; naam: string }>()
  const map = mkdtempSync(join(tmpdir(), 'fonos-dump-'))
  try {
    const rapport = await mwRapport(import_id)
    const buf = await lees(adres)
    let records
    if (/\.zip$/i.test(naam)) {
      const zip = await JSZip.loadAsync(buf)
      for (const z of Object.values(zip.files)) {
        if (z.dir || z.name.includes('..')) continue
        const doel = join(map, basename(z.name))
        writeFileSync(doel, await z.async('nodebuffer'))
      }
      records = await leesExportDeel(map)
    } else {
      const pad = join(map, basename(naam).replace(/[^\w.-]/g, '_'))
      writeFileSync(pad, buf)
      records = [] as any[]
      for await (const r of leesStandaard(pad)) records.push(r)
    }
    await verwerkRecords(records, import_id, rapport)
    await bewaarRapport(import_id, rapport)
    return c.json(rapport)
  } catch (e: any) { return fout(c, e.message) } finally { rmSync(map, { recursive: true, force: true }) }
})

beheer.post('/import/muziekweb/afronden', alleenBeheerder, async (c) => {
  const { import_id } = await c.req.json<{ import_id: number }>()
  try {
    const rapport = await rondImportAf(import_id, await mwRapport(import_id), wie(c), 'Muziekweb-dump')
    await run('DELETE FROM taken WHERE id = ?', `mw-${import_id}`)
    await catalogusGewijzigd()
    return c.json(rapport)
  } catch (e: any) { return fout(c, e.message) }
})

// ------------------------------------------------------------------ datakwaliteit (10.7)

const TOELICHTING = `COALESCE(NULLIF(t.fonos_data::jsonb->>'toelichting', ''), NULLIF(t.mw_data::jsonb->>'toelichting', ''))`

const DQ: Record<string, { naam: string; sql: (laatste: number) => string }> = {
  zonder_titelnummer: { naam: 'Exemplaren zonder titelnummer', sql: () => `SELECT e.id AS exemplaar_id, e.objectnummer, e.vindcode, e.bron FROM exemplaren e WHERE e.titelnummer IS NULL AND e.titel_id IS NULL AND e.status = 'in_collectie'` },
  dubbel: { naam: 'Dubbele objectnummers', sql: () => `SELECT i.id AS issue_id, i.objectnummer, i.titelnummer, i.vindcode, i.bron, (SELECT e.titel_id FROM exemplaren e WHERE e.objectnummer = i.objectnummer) AS titel_id FROM import_issues i WHERE i.soort = 'dubbel_objectnummer' AND i.afgehandeld = 0` },
  niet_in_dump: { naam: 'Titelnummers die (nog) niet in de dump voorkomen', sql: (laatste) => `
      SELECT NULL::int AS titel_id, e.id AS exemplaar_id, e.objectnummer, e.titelnummer FROM exemplaren e
        WHERE e.titel_id IS NULL AND e.titelnummer IS NOT NULL AND e.status = 'in_collectie'
      UNION ALL
      SELECT t.id, NULL, NULL, t.titelnummer FROM titels t LEFT JOIN mw_dump m ON m.titelnummer = t.titelnummer
        WHERE t.titelnummer IS NOT NULL AND (m.titelnummer IS NULL OR m.import_id < ${Math.trunc(laatste)})` },
  zonder_hoes: { naam: 'Titels zonder hoes', sql: () => `SELECT t.id AS titel_id, t.titelnummer, t.d_titel AS titel, t.d_artiesten AS artiesten FROM titels t WHERE t.d_hoes IS NULL` },
  zonder_toelichting: { naam: 'Titels zonder toelichting', sql: () => `SELECT t.id AS titel_id, t.titelnummer, t.d_titel AS titel, t.d_artiesten AS artiesten FROM titels t WHERE ${TOELICHTING} IS NULL` },
  ongekoppelde_genres: { naam: 'Muziekweb-genres zonder genreknop', sql: () => `SELECT j.value AS genre, COUNT(*)::int AS aantal FROM titels t, jsonb_array_elements_text(t.d_genres::jsonb) j(value)
      WHERE j.value NOT IN (SELECT mw_genre FROM genre_koppelingen) GROUP BY j.value ORDER BY aantal DESC` },
  conflicten: { naam: 'Conflicten tussen Fonos- en Muziekweb-waarde', sql: () => `SELECT t.id AS titel_id, t.titelnummer, t.d_titel AS titel, t.conflicten FROM titels t WHERE t.conflicten <> '{}'` },
}

async function dqTellingen() {
  const laatste = await laatsteImportId()
  const uit: Record<string, number> = {}
  await Promise.all(Object.entries(DQ).map(async ([k, v]) => { uit[k] = (await get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM (${v.sql(laatste)}) x`))!.n }))
  return uit
}

beheer.get('/datakwaliteit', async (c) => {
  const t = await dqTellingen()
  return c.json(Object.entries(DQ).map(([sleutel, v]) => ({ sleutel, naam: v.naam, aantal: t[sleutel] })))
})

beheer.get('/datakwaliteit/:lijst', async (c) => {
  const l = DQ[c.req.param('lijst')]
  if (!l) return fout(c, 'Onbekende lijst', 404)
  const pagina = Math.max(1, Number(c.req.query('pagina')) || 1)
  const laatste = await laatsteImportId()
  const rijen = await all<any>(`SELECT * FROM (${l.sql(laatste)}) x LIMIT 100 OFFSET ?`, (pagina - 1) * 100)
  return c.json({ naam: l.naam, totaal: (await get<{ n: number }>(`SELECT COUNT(*)::int AS n FROM (${l.sql(laatste)}) x`))!.n, pagina, rijen: rijen.map((r) => (r.conflicten ? { ...r, conflicten: Object.keys(json(r.conflicten, {})) } : r)) })
})

beheer.post('/issue/:id/afgehandeld', async (c) => {
  const id = Number(c.req.param('id'))
  const i = await get<any>('SELECT * FROM import_issues WHERE id = ?', id)
  if (!i) return fout(c, 'Niet gevonden', 404)
  await run('UPDATE import_issues SET afgehandeld = 1 WHERE id = ?', id)
  await log(wie(c), 'dubbel objectnummer afgehandeld', { type: 'import_issue', id, label: i.objectnummer })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ genreknoppen (10.8), beheerder

beheer.get('/genreknoppen', async (c) => c.json({
  knoppen: await all<any>('SELECT k.*, (SELECT COUNT(*) FROM genre_koppelingen g WHERE g.knop_id = k.id) AS koppelingen FROM genreknoppen k ORDER BY volgorde, id'),
  nl_weergave: (await instellingen()).nl_weergave,
}))

beheer.get('/genreknop/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const k = await get<any>('SELECT * FROM genreknoppen WHERE id = ?', id)
  if (!k) return fout(c, 'Niet gevonden', 404)
  const telling = new Map((await all<any>('SELECT j.value AS g, COUNT(*)::int AS n FROM titels t, jsonb_array_elements_text(t.d_genres::jsonb) j(value) GROUP BY j.value')).map((r) => [r.g, r.n]))
  const kop = (await all<any>('SELECT * FROM genre_koppelingen WHERE knop_id = ? ORDER BY weergavenaam, mw_genre', id)).map((g) => ({ ...g, titels: telling.get(g.mw_genre) ?? 0 }))
  return c.json({ ...k, koppelingen: kop })
})

beheer.post('/genreknoppen', alleenBeheerder, async (c) => {
  const b = await c.req.json<any>()
  if (!b.naam?.trim()) return fout(c, 'Vul een naam in')
  const max = (await get<{ m: number }>('SELECT COALESCE(MAX(volgorde), 0) AS m FROM genreknoppen'))!.m
  const id = await insert('INSERT INTO genreknoppen (naam, volgorde, kleur, nederlands) VALUES (?, ?, ?, ?)', b.naam.trim(), max + 1, b.kleur || '#ff14b4', b.nederlands ? 1 : 0)
  await log(wie(c), 'genreknop toegevoegd', { type: 'genreknop', id, label: b.naam })
  wisConfigCache()
  return c.json({ id })
})

beheer.patch('/genreknop/:id', alleenBeheerder, async (c) => {
  const id = Number(c.req.param('id'))
  const k = await get<any>('SELECT * FROM genreknoppen WHERE id = ?', id)
  if (!k) return fout(c, 'Niet gevonden', 404)
  const b = await c.req.json<any>()
  for (const veld of ['naam', 'volgorde', 'actief', 'kleur', 'nederlands', 'afbeelding'] as const) {
    if (b[veld] === undefined) continue
    const w = typeof b[veld] === 'boolean' ? (b[veld] ? 1 : 0) : b[veld]
    if (w === k[veld]) continue
    await run(`UPDATE genreknoppen SET ${veld} = ? WHERE id = ?`, w, id)
    await log(wie(c), 'veld gewijzigd', { type: 'genreknop', id, label: k.naam, veld, oud: k[veld], nieuw: w })
  }
  wisConfigCache()
  return c.json({ ok: true })
})

beheer.post('/genreknop/:id/afbeelding', alleenBeheerder, async (c) => {
  try {
    const url = await bewaarUpload(c)
    await run('UPDATE genreknoppen SET afbeelding = ? WHERE id = ?', url, Number(c.req.param('id')))
    await log(wie(c), 'afbeelding genreknop', { type: 'genreknop', id: c.req.param('id'), nieuw: url })
    wisConfigCache()
    return c.json({ afbeelding: url })
  } catch (e: any) { return fout(c, e.message) }
})

beheer.delete('/genreknop/:id', alleenBeheerder, async (c) => {
  const id = Number(c.req.param('id'))
  const k = await get<any>('SELECT * FROM genreknoppen WHERE id = ?', id)
  if (!k) return fout(c, 'Niet gevonden', 404)
  await run('DELETE FROM genreknoppen WHERE id = ?', id)
  await log(wie(c), 'genreknop verwijderd', { type: 'genreknop', id, label: k.naam })
  wisConfigCache()
  return c.json({ ok: true })
})

/** Vervangt alle koppelingen van een knop: [{mw_genre, weergavenaam}]. */
beheer.put('/genreknop/:id/koppelingen', alleenBeheerder, async (c) => {
  const id = Number(c.req.param('id'))
  const { koppelingen } = await c.req.json<{ koppelingen: { mw_genre: string; weergavenaam?: string | null }[] }>()
  const oud = await all<any>('SELECT mw_genre, weergavenaam FROM genre_koppelingen WHERE knop_id = ? ORDER BY mw_genre', id)
  await tx(async () => {
    await run('DELETE FROM genre_koppelingen WHERE knop_id = ?', id)
    for (const k of koppelingen) if (k.mw_genre?.trim()) await run('INSERT INTO genre_koppelingen (knop_id, mw_genre, weergavenaam) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', id, k.mw_genre.trim(), k.weergavenaam?.trim() || null)
  })
  await log(wie(c), 'genrekoppelingen gewijzigd', { type: 'genreknop', id, veld: 'koppelingen', oud: oud.map((o) => o.mw_genre), nieuw: koppelingen.map((k) => k.mw_genre) })
  wisConfigCache()
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ selecties (10.9)

beheer.get('/selecties', async (c) => c.json(await all<any>(`SELECT s.*, (SELECT COUNT(*)::int FROM selectie_titels x WHERE x.selectie_id = s.id) AS handmatig FROM selecties s ORDER BY volgorde, id`)))

beheer.get('/selectie/:id', async (c) => {
  const s = await get<any>('SELECT * FROM selecties WHERE id = ?', Number(c.req.param('id')))
  if (!s) return fout(c, 'Niet gevonden', 404)
  const titels = await all<any>(`SELECT t.id, t.d_titel AS titel, t.d_artiesten AS artiesten, t.d_jaar AS jaar, t.d_drager AS drager, t.d_hoes AS hoes
    FROM selectie_titels x JOIN titels t ON t.id = x.titel_id WHERE x.selectie_id = ? ORDER BY x.volgorde`, s.id)
  const ids = ['uitgelicht', 'nieuw', 'vaak'].includes(s.soort) || s.mw_genre ? await selectieIds(s, false) : []
  const automatisch = ids.length ? await all(`SELECT t.id, t.d_titel AS titel, t.d_artiesten AS artiesten, t.d_jaar AS jaar, t.d_hoes AS hoes FROM titels t
    WHERE t.id = ANY(?::int[]) ORDER BY array_position(?::int[], t.id)`, `{${ids.join(',')}}`, `{${ids.join(',')}}`) : []
  return c.json({ ...s, titels, voorbeeld: automatisch })
})

beheer.post('/selecties', async (c) => {
  const b = await c.req.json<any>()
  if (!b.naam?.trim()) return fout(c, 'Vul een naam in')
  const soort = ['handmatig', 'seizoen'].includes(b.soort) ? b.soort : 'handmatig'
  const max = (await get<{ m: number }>('SELECT COALESCE(MAX(volgorde), 0) AS m FROM selecties'))!.m
  const id = await insert('INSERT INTO selecties (naam, soort, volgorde, begin, eind) VALUES (?, ?, ?, ?, ?)', b.naam.trim(), soort, max + 1, b.begin || null, b.eind || null)
  await log(wie(c), 'selectie toegevoegd', { type: 'selectie', id, label: b.naam })
  return c.json({ id })
})

beheer.patch('/selectie/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const s = await get<any>('SELECT * FROM selecties WHERE id = ?', id)
  if (!s) return fout(c, 'Niet gevonden', 404)
  const b = await c.req.json<any>()
  for (const veld of ['naam', 'volgorde', 'actief', 'begin', 'eind', 'aantal', 'periode_dagen', 'mw_genre'] as const) {
    if (b[veld] === undefined) continue
    const w = typeof b[veld] === 'boolean' ? (b[veld] ? 1 : 0) : b[veld] === '' ? null : b[veld]
    if (w === s[veld]) continue
    await run(`UPDATE selecties SET ${veld} = ? WHERE id = ?`, w, id)
    await log(wie(c), 'veld gewijzigd', { type: 'selectie', id, label: s.naam, veld, oud: s[veld], nieuw: w })
  }
  return c.json({ ok: true })
})

beheer.delete('/selectie/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const s = await get<any>('SELECT * FROM selecties WHERE id = ?', id)
  if (!s) return fout(c, 'Niet gevonden', 404)
  if (['uitgelicht', 'nieuw', 'vaak'].includes(s.soort)) return fout(c, 'Automatische selecties kun je uitzetten, niet verwijderen')
  await run('DELETE FROM selecties WHERE id = ?', id)
  await log(wie(c), 'selectie verwijderd', { type: 'selectie', id, label: s.naam })
  return c.json({ ok: true })
})

beheer.put('/selectie/:id/titels', async (c) => {
  const id = Number(c.req.param('id'))
  const { ids } = await c.req.json<{ ids: number[] }>()
  const oud = (await all<any>('SELECT titel_id FROM selectie_titels WHERE selectie_id = ? ORDER BY volgorde', id)).map((r) => r.titel_id)
  await tx(async () => {
    await run('DELETE FROM selectie_titels WHERE selectie_id = ?', id)
    for (const [i, t] of [...new Set(ids)].entries()) await run('INSERT INTO selectie_titels (selectie_id, titel_id, volgorde) VALUES (?, ?, ?)', id, t, i)
  })
  await log(wie(c), 'titels selectie gewijzigd', { type: 'selectie', id, veld: 'titels', oud, nieuw: ids })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ instellingen (10.10), beheerder

beheer.get('/instellingen', alleenBeheerder, async (c) => c.json({ instellingen: await instellingen(), platenspelers: await all('SELECT * FROM platenspelers ORDER BY nummer') }))

beheer.put('/instellingen', alleenBeheerder, async (c) => {
  const b = await c.req.json<Record<string, unknown>>()
  const huidig = await instellingen() as any
  for (const [k, v] of Object.entries(b)) {
    if (!(k in STANDAARD_INSTELLINGEN)) continue
    const std = (STANDAARD_INSTELLINGEN as any)[k]
    const waarde = typeof std === 'number' ? Number(v) : typeof std === 'boolean' ? !!v : v
    if (typeof std === 'number' && (!Number.isFinite(waarde) || (waarde as number) < 0)) return fout(c, `Ongeldige waarde voor ${k}`)
    if (JSON.stringify(huidig[k]) === JSON.stringify(waarde)) continue
    if (k === 'aantal_platenspelers') {
      const n = Number(waarde)
      if (n < 1 || n > 30) return fout(c, 'Aantal platenspelers tussen 1 en 30')
      if (await get(`SELECT 1 FROM aanvragen WHERE platenspeler > ? AND status IN ('ingediend', 'uitgegeven')`, n)) return fout(c, 'Er lopen nog aanvragen op platenspelers boven dit aantal')
      await syncPlatenspelers(n)
    }
    await zetInstelling(k, waarde)
    await log(wie(c), 'instelling gewijzigd', { type: 'instelling', id: k, label: k, veld: k, oud: huidig[k], nieuw: waarde })
  }
  wisConfigCache()
  await beschikbaarheidGewijzigd()
  return c.json({ instellingen: await instellingen() })
})

// ------------------------------------------------------------------ gebruikers (10.11), beheerder

beheer.get('/gebruikers', alleenBeheerder, async (c) =>
  c.json((await all<any>('SELECT id, email, naam, rollen, actief, aangemaakt FROM gebruikers ORDER BY naam')).map((g) => ({ ...g, rollen: json(g.rollen, []), actief: !!g.actief }))))

async function stuurReset(c: Context, gebruikerId: number, email: string, welkom: boolean) {
  const token = await maakResetToken(gebruikerId)
  const basis = process.env.FONOS_BASIS_URL ?? new URL(c.req.url).origin
  const link = `${basis}/wachtwoord?token=${token}`
  await stuurMail(email, welkom ? 'Je account voor de Fonotheek' : 'Nieuw wachtwoord voor de Fonotheek',
    `${welkom ? 'Er is een account voor je aangemaakt in de Fonotheek-app.' : 'Er is een nieuw wachtwoord voor je aangevraagd.'}\n\nKies je wachtwoord via deze link (2 uur geldig):\n${link}`)
}

beheer.post('/gebruikers', alleenBeheerder, async (c) => {
  const b = await c.req.json<{ email: string; naam: string; rollen: string[] }>()
  if (!b.email?.includes('@') || !b.naam?.trim()) return fout(c, 'Vul naam en e-mailadres in')
  const rollen = (b.rollen ?? []).filter((r) => (ROLLEN as readonly string[]).includes(r))
  if (!rollen.length) return fout(c, 'Kies minstens één rol')
  if (await get('SELECT id FROM gebruikers WHERE lower(email) = lower(?)', b.email.trim())) return fout(c, 'Dit e-mailadres bestaat al', 409)
  const id = await maakGebruiker({ email: b.email, naam: b.naam, rollen: rollen as any })
  await log(wie(c), 'gebruiker aangemaakt', { type: 'gebruiker', id, label: b.naam, nieuw: { rollen } })
  await stuurReset(c, id, b.email.trim(), true).catch((e) => console.error(e))
  return c.json({ id })
})

beheer.patch('/gebruiker/:id', alleenBeheerder, async (c) => {
  const id = Number(c.req.param('id'))
  const g = await get<any>('SELECT * FROM gebruikers WHERE id = ?', id)
  if (!g) return fout(c, 'Niet gevonden', 404)
  const b = await c.req.json<{ naam?: string; rollen?: string[]; actief?: boolean }>()
  const ik = wie(c)
  if (id === ik.id && (b.actief === false || (b.rollen && !b.rollen.includes('beheerder')))) return fout(c, 'Je kunt je eigen beheerdersrechten niet intrekken')
  if (b.naam !== undefined && b.naam.trim() !== g.naam) { await run('UPDATE gebruikers SET naam = ? WHERE id = ?', b.naam.trim(), id); await log(ik, 'veld gewijzigd', { type: 'gebruiker', id, label: g.naam, veld: 'naam', oud: g.naam, nieuw: b.naam }) }
  if (b.rollen) {
    const r = b.rollen.filter((x) => (ROLLEN as readonly string[]).includes(x))
    if (!r.length) return fout(c, 'Kies minstens één rol')
    await run('UPDATE gebruikers SET rollen = ? WHERE id = ?', JSON.stringify(r), id)
    await log(ik, 'veld gewijzigd', { type: 'gebruiker', id, label: g.naam, veld: 'rollen', oud: json(g.rollen, []), nieuw: r })
  }
  if (b.actief !== undefined && (b.actief ? 1 : 0) !== g.actief) {
    await run('UPDATE gebruikers SET actief = ? WHERE id = ?', b.actief ? 1 : 0, id)
    if (!b.actief) await run('DELETE FROM sessies WHERE gebruiker_id = ?', id)
    await log(ik, b.actief ? 'gebruiker geactiveerd' : 'gebruiker gedeactiveerd', { type: 'gebruiker', id, label: g.naam })
  }
  return c.json({ ok: true })
})

beheer.post('/gebruiker/:id/reset', alleenBeheerder, async (c) => {
  const g = await get<any>('SELECT * FROM gebruikers WHERE id = ?', Number(c.req.param('id')))
  if (!g) return fout(c, 'Niet gevonden', 404)
  await stuurReset(c, g.id, g.email, false)
  await log(wie(c), 'wachtwoord-reset verstuurd', { type: 'gebruiker', id: g.id, label: g.naam })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ wijzigingslog (10.12)

beheer.get('/log', async (c) => {
  const q = c.req.query()
  const waar: string[] = []
  const p: any[] = []
  if (q.gebruiker) { waar.push('gebruiker = ?'); p.push(q.gebruiker) }
  if (q.van) { waar.push('tijd >= ?'); p.push(q.van) }
  if (q.tot) { waar.push("tijd < to_char(?::date + 1, 'YYYY-MM-DD')"); p.push(q.tot) }
  if (q.type) { waar.push('record_type = ?'); p.push(q.type) }
  if (q.record) { waar.push('record_id = ?'); p.push(q.record) }
  if (q.q) { waar.push('(record_label ILIKE ? OR actie ILIKE ? OR veld ILIKE ? OR oud ILIKE ? OR nieuw ILIKE ?)'); const z = `%${q.q}%`; p.push(z, z, z, z, z) }
  const where = waar.length ? `WHERE ${waar.join(' AND ')}` : ''
  const pagina = Math.max(1, Number(q.pagina) || 1)
  return c.json({
    totaal: (await get<{ n: number }>(`SELECT COUNT(*) n FROM wijzigingslog ${where}`, ...p))!.n,
    pagina,
    regels: await all(`SELECT * FROM wijzigingslog ${where} ORDER BY id DESC LIMIT 100 OFFSET ?`, ...p, (pagina - 1) * 100),
    gebruikers: (await all<any>('SELECT DISTINCT gebruiker FROM wijzigingslog ORDER BY gebruiker')).map((r) => r.gebruiker),
  })
})

/** De oude waarde van een veld terugzetten (redacteur). */
beheer.post('/log/:id/terugzetten', async (c) => {
  const l = await get<any>('SELECT * FROM wijzigingslog WHERE id = ?', Number(c.req.param('id')))
  if (!l || !l.veld || !['veld gewijzigd', 'terug naar Muziekweb'].includes(l.actie)) return fout(c, 'Deze regel kan niet worden teruggezet')
  const oud = l.oud == null ? null : (() => { try { return JSON.parse(l.oud) } catch { return l.oud } })()
  const id = Number(l.record_id)
  try {
    if (l.record_type === 'titel') {
      if (TWEELAAGS.some((v) => v.veld === l.veld)) {
        const t = await get<any>('SELECT mw_data FROM titels WHERE id = ?', id)
        const mw = json<any>(t?.mw_data, {})
        // Was de oude waarde de Muziekweb-waarde, dan de Fonos-waarde wissen; anders als Fonos-waarde zetten.
        await zetFonosWaarde(id, l.veld, JSON.stringify(mw[l.veld] ?? null) === JSON.stringify(oud) ? undefined : oud, wie(c))
      } else if (FONOS_EIGEN.includes(l.veld)) await zetFonosEigen(id, l.veld, oud, wie(c))
      else return fout(c, 'Dit veld kan niet worden teruggezet')
      await catalogusGewijzigd([id])
    } else if (l.record_type === 'exemplaar' && ['vindcode', 'objectnummer'].includes(l.veld)) {
      const e = await get<any>('SELECT * FROM exemplaren WHERE id = ?', id)
      if (!e) return fout(c, 'Exemplaar bestaat niet meer')
      if (l.veld === 'objectnummer' && await get('SELECT 1 FROM exemplaren WHERE objectnummer = ? AND id <> ?', oud, id)) return fout(c, 'Dat objectnummer is intussen in gebruik')
      await run(`UPDATE exemplaren SET ${l.veld} = ? WHERE id = ?`, oud, id)
      await log(wie(c), 'veld gewijzigd', { type: 'exemplaar', id, label: e.objectnummer, veld: l.veld, oud: e[l.veld], nieuw: oud })
    } else return fout(c, 'Dit veld kan niet worden teruggezet')
  } catch (e: any) { return fout(c, e.message) }
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ back-ups (12), beheerder
// Grote bestanden gaan niet door een Vercel-functie (max. 4,5 MB): downloads verlopen via de aparte opslag,
// uploads gaan rechtstreeks vanuit de browser naar Vercel Blob (/api/beheer/blob).

beheer.get('/backups', alleenBeheerder, async (c) => c.json({
  backups: await all('SELECT id, tijd, soort, omvang, status, fout FROM backups ORDER BY id DESC LIMIT 200'),
  map: process.env.BLOB_READ_WRITE_TOKEN ? 'Vercel Blob (los van de database)' : 'lokale opslagmap',
}))

beheer.post('/backups', alleenBeheerder, async (c) => {
  try { const b = await maakBackup('handmatig', wie(c)); return c.json({ id: b.id, bestand: b.bestand, omvang: b.omvang }) } catch (e: any) { return fout(c, e.message) }
})

beheer.post('/backup/download', alleenBeheerder, async (c) => {
  // Handmatige download: JSON + Excel, met of zonder geüploade hoezen (12.2).
  const { hoezen } = await c.req.json<{ hoezen: boolean }>().catch(() => ({ hoezen: false }))
  const buf = await maakZip({ excel: true, hoezen: !!hoezen })
  const naam = `fonotheek-backup-${new Date().toISOString().slice(0, 10)}.zip`
  const adres = await bewaar('uploads', naam, buf, 'application/zip')
  await log(wie(c), 'back-up gedownload', { type: 'backup', nieuw: { hoezen: !!hoezen, omvang: buf.length } })
  return c.json({ adres, naam })
})

beheer.get('/backup/:id/download', alleenBeheerder, async (c) => {
  const b = await backupAdres(Number(c.req.param('id')))
  if (!b) return fout(c, 'Back-up niet gevonden', 404)
  await log(wie(c), 'back-up gedownload', { type: 'backup', id: c.req.param('id'), label: b.naam })
  return c.json(b)
})

/** Upload rechtstreeks naar Vercel Blob (client upload); alleen voor ingelogde beheerders. */
beheer.post('/blob', alleenBeheerder, async (c) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return fout(c, 'Geen Vercel Blob ingesteld')
  const { handleUpload } = await import('@vercel/blob/client')
  const body = await c.req.json()
  const r = await handleUpload({
    body, request: c.req.raw,
    onBeforeGenerateToken: async () => ({ access: BLOB_TOEGANG, allowedContentTypes: ['application/zip', 'application/json', 'application/gzip', 'application/x-gzip', 'application/octet-stream', 'text/plain'], addRandomSuffix: true, maximumSizeInBytes: 500 * 1024 * 1024 }),
    onUploadCompleted: async () => {},
  })
  return c.json(r)
})

/** Upload zonder Vercel Blob (lokaal): bestand in de opslagmap. */
beheer.post('/upload', alleenBeheerder, async (c) => {
  const body = await c.req.parseBody()
  const f = body.bestand as File
  if (!f || typeof f === 'string') return fout(c, 'Geen bestand ontvangen')
  return c.json({ adres: await bewaar('uploads', f.name, Buffer.from(await f.arrayBuffer()), f.type || 'application/octet-stream') })
})

// ---------- Nieuwsbriefaanmeldingen (11, koppeling "beheer"; alleen beheerders) ----------
beheer.get('/nieuwsbrief', alleenBeheerder, async (c) => {
  const zoek = (c.req.query('zoek') ?? '').trim().toLowerCase()
  const alleenNieuw = c.req.query('nieuw') === '1'
  const w: string[] = ['TRUE']
  const p: unknown[] = []
  if (zoek) { w.push("(lower(email) LIKE ? OR lower(COALESCE(naam, '')) LIKE ?)"); p.push(`%${zoek}%`, `%${zoek}%`) }
  if (alleenNieuw) w.push('geexporteerd_op IS NULL')
  const tel = await get<any>("SELECT COUNT(*)::int AS totaal, COUNT(*) FILTER (WHERE geexporteerd_op IS NULL)::int AS nieuw FROM nieuwsbrief_aanmeldingen")
  const rijen = await all(`SELECT id, email, naam, bron, aangemeld_op, geexporteerd_op FROM nieuwsbrief_aanmeldingen WHERE ${w.join(' AND ')} ORDER BY aangemeld_op DESC, id DESC LIMIT 500`, ...p)
  const inst = await instellingen()
  return c.json({ ...tel, koppeling: inst.nieuwsbrief_koppeling, aanmeldingen: rijen })
})

/** Export als CSV (Excel-vriendelijk). Markeert de geëxporteerde aanmeldingen; gelogd zonder persoonsgegevens. */
beheer.post('/nieuwsbrief/export', alleenBeheerder, async (c) => {
  const { alleen_nieuw } = await c.req.json<{ alleen_nieuw?: boolean }>().catch(() => ({ alleen_nieuw: false }))
  const rijen = await all<any>(`SELECT id, email, naam, bron,
      to_char((aangemeld_op || '+00')::timestamptz AT TIME ZONE 'Europe/Amsterdam', 'YYYY-MM-DD HH24:MI') AS aangemeld_op
    FROM nieuwsbrief_aanmeldingen ${alleen_nieuw ? 'WHERE geexporteerd_op IS NULL' : ''} ORDER BY aangemeld_op, id`)
  const cel = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = '\ufeff' + [['email', 'naam', 'bron', 'aangemeld_op'].join(';'), ...rijen.map((r) => [r.email, r.naam, r.bron, r.aangemeld_op].map(cel).join(';'))].join('\r\n')
  if (rijen.length) await run(`UPDATE nieuwsbrief_aanmeldingen SET geexporteerd_op = nu() WHERE id = ANY(?::int[])`, `{${rijen.map((r) => r.id).join(',')}}`)
  await log(wie(c), 'nieuwsbriefaanmeldingen geëxporteerd', { type: 'nieuwsbrief', nieuw: `${rijen.length} aanmelding(en)${alleen_nieuw ? ', alleen nieuwe' : ''}` })
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="nieuwsbrief-aanmeldingen-${new Date().toISOString().slice(0, 10)}.csv"` } })
})

beheer.delete('/nieuwsbrief/:id', alleenBeheerder, async (c) => {
  const r = await run('DELETE FROM nieuwsbrief_aanmeldingen WHERE id = ?', Number(c.req.param('id')))
  if (!r.changes) return fout(c, 'Aanmelding niet gevonden', 404)
  await log(wie(c), 'nieuwsbriefaanmelding verwijderd', { type: 'nieuwsbrief', nieuw: '1 aanmelding' })
  return c.json({ ok: true })
})

beheer.post('/nieuwsbrief/verwijder-geexporteerd', alleenBeheerder, async (c) => {
  const r = await run('DELETE FROM nieuwsbrief_aanmeldingen WHERE geexporteerd_op IS NOT NULL')
  await log(wie(c), 'nieuwsbriefaanmeldingen verwijderd', { type: 'nieuwsbrief', nieuw: `${r.changes} geëxporteerde aanmelding(en)` })
  return c.json({ verwijderd: r.changes })
})

// ---------- Spotify-koppelingen: controlelijst en handmatig koppelen ----------
const SPOTIFY_STATUSSEN = ['nog_niet', 'auto_goed', 'twijfel', 'geen', 'handmatig', 'uitgesloten'] as const

beheer.get('/spotify', async (c) => {
  const status = (c.req.query('status') ?? 'twijfel') as string
  const pagina = Math.max(1, Number(c.req.query('pagina') ?? 1))
  const zoek = (c.req.query('zoek') ?? '').trim().toLowerCase()
  const per = 25
  const w: string[] = [ZICHTBAAR_SQL]
  const p: unknown[] = []
  if ((SPOTIFY_STATUSSEN as readonly string[]).includes(status)) { w.push('t.spotify_status = ?'); p.push(status) }
  if (zoek) { w.push("(lower(t.d_titel) LIKE ? OR lower(COALESCE(t.d_artiesten, '')) LIKE ?)"); p.push(`%${zoek}%`, `%${zoek}%`) }
  // Twijfel: hoogste score eerst; automatisch goed en handmatig: meest recent eerst.
  const volgorde = status === 'twijfel' ? 't.spotify_score DESC NULLS LAST, t.id' : 't.spotify_gecontroleerd_op DESC NULLS LAST, t.id DESC'
  const totaal = (await get<any>(`SELECT COUNT(*)::int AS n FROM titels t WHERE ${w.join(' AND ')}`, ...p))!.n
  const rijen = await all<any>(`SELECT t.id, t.d_titel AS titel, t.d_artiesten AS artiesten, t.d_jaar AS jaar, t.d_hoes AS hoes, t.d_label AS label, t.titelnummer,
      t.spotify_status, t.spotify_album_id, t.spotify_score, t.spotify_kandidaat, t.spotify_gecontroleerd_op
    FROM titels t WHERE ${w.join(' AND ')} ORDER BY ${volgorde} LIMIT ${per} OFFSET ${(pagina - 1) * per}`, ...p)
  const tel = await all<any>(`SELECT t.spotify_status AS status, COUNT(*)::int AS n FROM titels t WHERE ${ZICHTBAAR_SQL} GROUP BY 1`)
  return c.json({
    status, pagina, per, totaal,
    tellingen: Object.fromEntries(tel.map((r) => [r.status, r.n])),
    rijen: rijen.map((r) => ({ ...r, spotify_score: r.spotify_score == null ? null : Number(r.spotify_score), kandidaten: json(r.spotify_kandidaat, []), spotify_kandidaat: undefined })),
  })
})

/** Acties: goedkeuren, kies (andere kandidaat), geen, uitsluiten, link (plakken), verwijderen. Alles gelogd. */
beheer.post('/spotify/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const b = await c.req.json<{ actie: string; album_id?: string; link?: string }>()
  const t = await get<any>('SELECT id, d_titel, spotify_status, spotify_album_id, spotify_kandidaat FROM titels WHERE id = ?', id)
  if (!t) return fout(c, 'Titel niet gevonden', 404)
  const kandidaten = json<any[]>(t.spotify_kandidaat, [])
  let status: string
  let album: string | null
  if (b.actie === 'goedkeuren') {
    album = t.spotify_album_id ?? kandidaten[0]?.id ?? null
    if (!album) return fout(c, 'Er is geen kandidaat om goed te keuren.')
    status = 'handmatig'
  } else if (b.actie === 'kies') {
    if (!kandidaten.some((k) => k.id === b.album_id)) return fout(c, 'Onbekende kandidaat.')
    album = b.album_id!; status = 'handmatig'
  } else if (b.actie === 'link') {
    album = albumIdUit(b.link ?? '')
    if (!album) return fout(c, 'Geen geldige Spotify-albumlink. Plak een link als https://open.spotify.com/album/… of spotify:album:…')
    status = 'handmatig'
  } else if (b.actie === 'geen' || b.actie === 'verwijderen') { album = null; status = 'geen' }
  else if (b.actie === 'uitsluiten') { album = null; status = 'uitgesloten' }
  else return fout(c, 'Onbekende actie.')
  await run('UPDATE titels SET spotify_status = ?, spotify_album_id = ?, spotify_gecontroleerd_op = nu() WHERE id = ?', status, album, id)
  await log(wie(c), b.actie === 'verwijderen' ? 'Spotify-koppeling verwijderd' : 'Spotify-koppeling aangepast', {
    type: 'titel', id, label: t.d_titel, veld: 'spotify',
    oud: { status: t.spotify_status, album: t.spotify_album_id }, nieuw: { status, album },
  })
  return c.json({ id, spotify_status: status, spotify_album_id: album })
})

// ---------- Status (verbetering 18): build, data, back-up, cron, database en kiosks ----------
beheer.get('/status', alleenBeheerder, async (c) => {
  const t0 = Date.now()
  await get('SELECT 1')
  const db_ms = Date.now() - t0
  const n = async (sql: string) => Number((await get<any>(sql))?.n ?? 0)
  const exportDelen = await all<any>("SELECT taak, datum FROM planner WHERE taak LIKE 'export:%' ORDER BY taak")
  return c.json({
    build: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      bericht: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split('\n')[0] ?? null,
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      omgeving: process.env.VERCEL_ENV ?? 'lokaal',
      regio: process.env.VERCEL_REGION ?? null,
    },
    database: { ok: true, ms: db_ms },
    data: {
      muziekweb_records: await n('SELECT COUNT(*)::int AS n FROM mw_dump'),
      exportdelen: exportDelen.length,
      laatste_exportdeel: exportDelen.at(-1)?.taak?.slice(7) ?? null,
      titels: await n('SELECT COUNT(*)::int AS n FROM titels'),
      zichtbare_titels: await n(`SELECT COUNT(*)::int AS n FROM titels t WHERE ${ZICHTBAAR_SQL}`),
      exemplaren: await n("SELECT COUNT(*)::int AS n FROM exemplaren WHERE status = 'in_collectie'"),
      wacht_op_muziekweb: await n("SELECT COUNT(*)::int AS n FROM exemplaren e WHERE e.status = 'in_collectie' AND e.titel_id IS NULL AND e.titelnummer IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mw_dump m WHERE m.titelnummer = e.titelnummer)"),
      ontbrekende_titelnummers: await n("SELECT COUNT(DISTINCT e.titelnummer)::int AS n FROM exemplaren e WHERE e.status = 'in_collectie' AND e.titel_id IS NULL AND e.titelnummer IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mw_dump m WHERE m.titelnummer = e.titelnummer)"),
    },
    laatste_import: (await get<any>("SELECT tijd FROM imports WHERE soort = 'muziekweb' AND (rapport::jsonb->>'afgerond' = 'true' OR rapport::jsonb->>'bron' IS NOT NULL) ORDER BY id DESC LIMIT 1"))?.tijd ?? null,
    laatste_backup: (await get<any>("SELECT tijd, soort FROM backups WHERE status = 'gelukt' ORDER BY id DESC LIMIT 1")) ?? null,
    laatste_backup_fout: (await get<any>("SELECT tijd, fout FROM backups WHERE status <> 'gelukt' ORDER BY id DESC LIMIT 1")) ?? null,
    laatste_cron: (await get<any>("SELECT datum FROM planner WHERE taak = 'cron:laatst'"))?.datum ?? null,
    kiosks: await all("SELECT naam, laatst_gezien, pagina, laatst_gezien > nu('-2 minutes') AS online FROM kiosks ORDER BY naam"),
    platenspelers: await all('SELECT nummer, actief, sessie IS NOT NULL AS vastgehouden, bezet_sinds, laatst_actief FROM platenspelers ORDER BY nummer'),
    open_aanvragen: await n("SELECT COUNT(*)::int AS n FROM aanvragen WHERE status IN ('ingediend', 'uitgegeven')"),
  })
})

/** Titelnummers uit de collectie die nog niet in de Muziekweb-data staan (verbetering 13): lijst voor de scraper. */
beheer.get('/ontbrekende-titelnummers.csv', vereist('redacteur'), async (c) => {
  const rijen = await all<any>(`SELECT e.titelnummer, COUNT(*)::int AS exemplaren, MIN(e.bron) AS bron FROM exemplaren e
    WHERE e.status = 'in_collectie' AND e.titel_id IS NULL AND e.titelnummer IS NOT NULL AND NOT EXISTS (SELECT 1 FROM mw_dump m WHERE m.titelnummer = e.titelnummer)
    GROUP BY e.titelnummer ORDER BY e.titelnummer`)
  const csv = '\ufeff' + ['titelnummer;exemplaren;bron', ...rijen.map((r) => `${r.titelnummer};${r.exemplaren};"${String(r.bron ?? '').replace(/"/g, '""')}"`)].join('\r\n')
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ontbrekende-titelnummers-${new Date().toISOString().slice(0, 10)}.csv"` } })
})

/** Welke onderdelen aan staan (voor het menu van de beheeromgeving). */
beheer.get('/functies', async (c) => c.json({ spotify: !!(await instellingen()).spotify_aan }))

beheer.get('/opslag', (c) => c.json({ blob: !!process.env.BLOB_READ_WRITE_TOKEN, toegang: BLOB_TOEGANG }))

beheer.post('/terugzetten/controle', alleenBeheerder, async (c) => {
  try {
    const b = await c.req.json<{ id?: number; adres?: string; naam?: string }>()
    if (b.id) {
      const x = await backupAdres(Number(b.id))
      if (!x) return fout(c, 'Back-up niet gevonden', 404)
      return c.json(await vergelijk(await leesBackup(x.adres, x.naam)))
    }
    if (!b.adres) return fout(c, 'Geen bestand gekozen')
    return c.json(await vergelijk(await leesBackup(b.adres, b.naam ?? 'geüpload bestand')))
  } catch (e: any) { return fout(c, e.message) }
})

beheer.post('/terugzetten', alleenBeheerder, async (c) => {
  const { token, bevestiging } = await c.req.json<{ token: string; bevestiging: string }>()
  try { const r = await zetTerug(token, bevestiging, wie(c)); await catalogusGewijzigd(); return c.json(r) } catch (e: any) { return fout(c, e.message) }
})

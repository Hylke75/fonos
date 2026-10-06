// API voor de beheeromgeving (10, 12). Rollen: redacteur en beheerder.
import { Hono, type Context } from 'hono'
import { writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { vereist, wie, maakGebruiker, maakResetToken } from '../auth.ts'
import { all, get, run, json, instellingen, zetInstelling, syncPlatenspelers, STANDAARD_INSTELLINGEN, UPLOAD_DIR, BACKUP_DIR, tx } from '../db.ts'
import { log } from '../log.ts'
import { TWEELAAGS, ROLLEN, REDENEN_AFVOER, type TitelVelden } from '../../shared/velden.ts'
import {
  getoond, zetFonosWaarde, besluitConflict, zetFonosEigen, FONOS_EIGEN, maakTitel, koppelTitelnummer, exemplarenVan, OPEN_ITEMS_SQL, vindcode,
} from '../titels.ts'
import { markeerVuil } from '../zoeken.ts'
import { album, wisConfigCache, selectieTitels, inGebruik } from '../catalogus.ts'
import { alleDocs } from '../zoeken.ts'
import { analyseer, leesBestand, samenvatting, voerDoor, type Categorie } from '../importers/collectie.ts'
import { kiesLezer } from '../importers/muziekweb-lezers.ts'
import { verwerkMuziekwebImport } from '../importers/muziekweb-verwerk.ts'
import { backupPad, leesBackup, maakBackup, maakZip, vergelijk, zetTerug } from '../backup.ts'
import { beschikbaarheidGewijzigd } from '../events.ts'
import { stuurMail } from '../mail.ts'

export const beheer = new Hono()
beheer.use('*', vereist('redacteur', 'beheerder'))
const alleenBeheerder = vereist('beheerder')

const fout = (c: Context, bericht: string, status: 400 | 404 | 409 = 400) => c.json({ fout: bericht }, status)
const catalogusGewijzigd = (titelIds: number[] = []) => { markeerVuil(); wisConfigCache(); beschikbaarheidGewijzigd(titelIds) }

// ------------------------------------------------------------------ startpagina (10.1)

beheer.get('/tellers', (c) => {
  const n = (sql: string) => get<{ n: number }>(sql)!.n
  return c.json({
    titels: n('SELECT COUNT(*) n FROM titels'),
    exemplaren: n("SELECT COUNT(*) n FROM exemplaren WHERE status = 'in_collectie'"),
    datakwaliteit: Object.values(dqTellingen()).reduce((a, b) => a + b, 0),
    laatste_import: get<any>("SELECT tijd FROM imports WHERE soort = 'muziekweb' ORDER BY id DESC LIMIT 1")?.tijd ?? null,
    laatste_backup: get<any>("SELECT tijd FROM backups WHERE status = 'gelukt' ORDER BY id DESC LIMIT 1")?.tijd ?? null,
  })
})

beheer.get('/titels', (c) => {
  const q = c.req.query()
  const waar: string[] = []
  const p: any[] = []
  if (q.q?.trim()) {
    const z = `%${q.q.trim()}%`
    waar.push(`(t.d_titel LIKE ? OR t.d_artiesten LIKE ? OR t.titelnummer LIKE ? OR EXISTS (SELECT 1 FROM exemplaren e WHERE e.titel_id = t.id AND (e.objectnummer LIKE ? OR e.vindcode LIKE ?)))`)
    p.push(z, z, z, z, z)
  }
  if (q.drager) { waar.push('t.d_drager = ?'); p.push(q.drager) }
  if (q.soort) { waar.push('t.soort = ?'); p.push(q.soort) }
  if (q.zichtbaar) { waar.push('t.zichtbaar = ?'); p.push(q.zichtbaar === 'ja' ? 1 : 0) }
  if (q.aangepast) { waar.push('t.heeft_fonos = ?'); p.push(q.aangepast === 'ja' ? 1 : 0) }
  if (q.genre) { waar.push('EXISTS (SELECT 1 FROM json_each(t.d_genres) j WHERE j.value = ?)'); p.push(q.genre) }
  if (q.collectie === 'in') waar.push("EXISTS (SELECT 1 FROM exemplaren e WHERE e.titel_id = t.id AND e.status = 'in_collectie')")
  if (q.collectie === 'uit') waar.push("NOT EXISTS (SELECT 1 FROM exemplaren e WHERE e.titel_id = t.id AND e.status = 'in_collectie')")
  const where = waar.length ? `WHERE ${waar.join(' AND ')}` : ''
  const per = Math.min(Number(q.per) || 50, 200)
  const pagina = Math.max(1, Number(q.pagina) || 1)
  const sorteer = ({ titel: 't.d_titel', artiest: 't.d_artiesten IS NULL, t.d_artiesten', jaar: 't.d_jaar DESC', nieuw: 't.id DESC' } as any)[q.sort] ?? 't.d_artiesten IS NULL, t.d_artiesten COLLATE NOCASE, t.d_titel'
  const totaal = get<{ n: number }>(`SELECT COUNT(*) n FROM titels t ${where}`, ...p)!.n
  const titels = all<any>(`SELECT t.id, t.titelnummer, t.d_titel titel, t.d_artiesten artiesten, t.d_jaar jaar, t.d_drager drager, t.d_hoes hoes,
      t.zichtbaar, t.heeft_fonos, t.conflicten != '{}' AS conflict, t.soort,
      (SELECT COUNT(*) FROM exemplaren e WHERE e.titel_id = t.id AND e.status = 'in_collectie') AS exemplaren
    FROM titels t ${where} ORDER BY ${sorteer} LIMIT ? OFFSET ?`, ...p, per, (pagina - 1) * per)
  return c.json({ totaal, pagina, per, titels })
})

beheer.get('/genres', (c) => {
  // Alle bekende Muziekweb-genres in de collectie, met aantallen.
  const rows = all<any>(`SELECT j.value AS naam, COUNT(*) n FROM titels t, json_each(t.d_genres) j GROUP BY j.value ORDER BY j.value`)
  return c.json(rows)
})

// ------------------------------------------------------------------ titel bewerken (10.2)

function titelDetail(id: number) {
  const t = get<any>('SELECT * FROM titels WHERE id = ?', id)
  if (!t) return null
  const dumpRij = t.titelnummer ? get<any>('SELECT import_id FROM mw_dump WHERE titelnummer = ?', t.titelnummer) : null
  return {
    id: t.id, titelnummer: t.titelnummer, soort: t.soort, tip: !!t.tip,
    mw: json(t.mw_data, {}), fonos: json(t.fonos_data, {}), getoond: getoond(t), conflicten: json(t.conflicten, {}),
    zichtbaar: !!t.zichtbaar, uitgelicht: !!t.uitgelicht, fonos_verhaal: t.fonos_verhaal, ai_tekst: !!t.ai_tekst,
    in_dump: !!dumpRij, aangemaakt: t.aangemaakt, gewijzigd: t.gewijzigd,
    exemplaren: exemplarenVan(id).map((e) => ({ ...e, vindcode_getoond: vindcode(e) })),
    geschiedenis: all<any>("SELECT * FROM wijzigingslog WHERE record_type = 'titel' AND record_id = ? ORDER BY id DESC LIMIT 200", String(id)),
  }
}

beheer.get('/titel/:id', (c) => {
  const d = titelDetail(Number(c.req.param('id')))
  return d ? c.json(d) : fout(c, 'Titel niet gevonden', 404)
})

beheer.get('/titel/:id/voorbeeld', (c) => {
  const a = album(Number(c.req.param('id')), true)
  return a ? c.json(a) : fout(c, 'Titel niet gevonden', 404)
})

beheer.patch('/titel/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ velden?: Partial<TitelVelden>; eigen?: Record<string, unknown> }>()
  if (!get('SELECT id FROM titels WHERE id = ?', id)) return fout(c, 'Titel niet gevonden', 404)
  tx(() => {
    for (const [veld, waarde] of Object.entries(body.velden ?? {})) {
      if (!TWEELAAGS.some((v) => v.veld === veld)) throw new Error(`Onbekend veld ${veld}`)
      zetFonosWaarde(id, veld as keyof TitelVelden, waarde === null ? undefined : waarde, wie(c))
    }
    for (const [veld, waarde] of Object.entries(body.eigen ?? {})) {
      if (!FONOS_EIGEN.includes(veld as any)) throw new Error(`Onbekend veld ${veld}`)
      zetFonosEigen(id, veld as any, waarde, wie(c))
    }
  })
  catalogusGewijzigd([id])
  return c.json(titelDetail(id))
})

beheer.post('/titel/:id/terug', async (c) => {
  const id = Number(c.req.param('id'))
  const { veld } = await c.req.json<{ veld: keyof TitelVelden }>()
  zetFonosWaarde(id, veld, undefined, wie(c))
  catalogusGewijzigd([id])
  return c.json(titelDetail(id))
})

beheer.post('/titel/:id/conflict', async (c) => {
  const id = Number(c.req.param('id'))
  const { veld, keuze } = await c.req.json<{ veld: string; keuze: 'fonos' | 'muziekweb' }>()
  besluitConflict(id, veld, keuze, wie(c))
  catalogusGewijzigd([id])
  return c.json(titelDetail(id))
})

beheer.post('/titel/:id/koppel', async (c) => {
  const id = Number(c.req.param('id'))
  const { titelnummer } = await c.req.json<{ titelnummer: string }>()
  try { koppelTitelnummer(id, titelnummer.trim().toUpperCase(), wie(c)) } catch (e: any) { return fout(c, e.message) }
  catalogusGewijzigd([id])
  return c.json(titelDetail(id))
})

const AFBEELDING = /^image\/(jpeg|png|webp)$/
async function bewaarUpload(c: Context): Promise<string> {
  const body = await c.req.parseBody()
  const f = body.bestand as File | undefined
  if (!f || typeof f === 'string') throw new Error('Geen bestand ontvangen')
  if (!AFBEELDING.test(f.type)) throw new Error('Alleen jpg, png of webp')
  if (f.size > 10 * 1024 * 1024) throw new Error('Bestand is groter dan 10 MB')
  const naam = `${randomUUID()}${extname(f.name).toLowerCase() || '.jpg'}`
  writeFileSync(join(UPLOAD_DIR, naam), Buffer.from(await f.arrayBuffer()))
  return `/uploads/${naam}`
}

beheer.post('/titel/:id/hoes/:kant', async (c) => {
  const id = Number(c.req.param('id'))
  const kant = c.req.param('kant') === 'achter' ? 'hoes_achter' : 'hoes_voor'
  try {
    const url = await bewaarUpload(c)
    zetFonosWaarde(id, kant, url, wie(c))
  } catch (e: any) { return fout(c, e.message) }
  catalogusGewijzigd([id])
  return c.json(titelDetail(id))
})

beheer.post('/titels/bulk', async (c) => {
  const { ids, zichtbaar, uitgelicht } = await c.req.json<{ ids: number[]; zichtbaar?: boolean; uitgelicht?: boolean }>()
  tx(() => {
    for (const id of ids ?? []) {
      if (zichtbaar !== undefined) zetFonosEigen(Number(id), 'zichtbaar', zichtbaar, wie(c))
      if (uitgelicht !== undefined) zetFonosEigen(Number(id), 'uitgelicht', uitgelicht, wie(c))
    }
  })
  catalogusGewijzigd(ids)
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ toevoegen (10.4) en exemplaren (10.3, 10.5)

beheer.get('/dump/:titelnummer', (c) => {
  const tn = c.req.param('titelnummer').trim().toUpperCase()
  const d = get<any>('SELECT data FROM mw_dump WHERE titelnummer = ?', tn)
  const bestaand = get<any>('SELECT id FROM titels WHERE titelnummer = ?', tn)
  if (!d) return fout(c, 'Titelnummer niet gevonden in de laatste Muziekweb-import', 404)
  return c.json({ titelnummer: tn, ...JSON.parse(d.data), bestaande_titel: bestaand?.id ?? null })
})

const OBJECT_RE = /^\d{5,}$/

beheer.post('/titels', async (c) => {
  const b = await c.req.json<{ titelnummer?: string; objectnummer?: string; vindcode?: string; handmatig?: TitelVelden }>()
  const obj = b.objectnummer?.trim()
  if (obj && !OBJECT_RE.test(obj)) return fout(c, 'Een objectnummer bestaat uit cijfers')
  if (obj && get('SELECT id FROM exemplaren WHERE objectnummer = ?', obj)) return fout(c, `Objectnummer ${obj} bestaat al`, 409)
  let id: number
  try {
    id = tx(() => {
      let titelId: number
      if (b.titelnummer) {
        const tn = b.titelnummer.trim().toUpperCase()
        const bestaand = get<any>('SELECT id FROM titels WHERE titelnummer = ?', tn)
        if (bestaand) titelId = bestaand.id // alleen een exemplaar toevoegen
        else {
          const d = get<any>('SELECT data FROM mw_dump WHERE titelnummer = ?', tn)
          if (!d) throw new Error('Titelnummer niet gevonden in de laatste Muziekweb-import')
          const dump = JSON.parse(d.data)
          titelId = maakTitel({ titelnummer: tn, mw: dump.velden, soort: dump.soort, tip: dump.tip })
          log(wie(c), 'titel toegevoegd', { type: 'titel', id: titelId, label: dump.velden.titel, nieuw: tn })
        }
      } else if (b.handmatig) {
        if (!b.handmatig.titel?.trim()) throw new Error('Vul minstens een titel in')
        const velden = Object.fromEntries(Object.entries(b.handmatig).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length)))
        titelId = maakTitel({ fonos: velden as TitelVelden })
        log(wie(c), 'titel toegevoegd (handmatig)', { type: 'titel', id: titelId, label: b.handmatig.titel, nieuw: velden })
      } else throw new Error('Geef een titelnummer of vul de velden handmatig in')
      if (obj) {
        const tn = get<any>('SELECT titelnummer FROM titels WHERE id = ?', titelId)!.titelnummer
        const eid = run('INSERT INTO exemplaren (objectnummer, titel_id, titelnummer, vindcode, bron) VALUES (?, ?, ?, ?, ?)', obj, titelId, tn, b.vindcode?.trim() || null, 'beheer').lastInsertRowid
        log(wie(c), 'exemplaar toegevoegd', { type: 'exemplaar', id: Number(eid), label: obj, nieuw: { titel_id: titelId, vindcode: b.vindcode } })
      }
      return titelId
    })
  } catch (e: any) { return fout(c, e.message) }
  catalogusGewijzigd([id])
  return c.json(titelDetail(id))
})

beheer.post('/exemplaren', async (c) => {
  const b = await c.req.json<{ titel_id: number; objectnummer: string; vindcode?: string }>()
  const obj = b.objectnummer?.trim()
  if (!obj || !OBJECT_RE.test(obj)) return fout(c, 'Vul een geldig objectnummer in (cijfers)')
  if (get('SELECT id FROM exemplaren WHERE objectnummer = ?', obj)) return fout(c, `Objectnummer ${obj} bestaat al`, 409)
  const t = get<any>('SELECT id, titelnummer, d_titel FROM titels WHERE id = ?', b.titel_id)
  if (!t) return fout(c, 'Titel niet gevonden', 404)
  const eid = run('INSERT INTO exemplaren (objectnummer, titel_id, titelnummer, vindcode, bron) VALUES (?, ?, ?, ?, ?)', obj, t.id, t.titelnummer, b.vindcode?.trim() || null, 'beheer').lastInsertRowid
  log(wie(c), 'exemplaar toegevoegd', { type: 'exemplaar', id: Number(eid), label: obj, nieuw: { titel: t.d_titel, vindcode: b.vindcode } })
  catalogusGewijzigd([t.id])
  return c.json(titelDetail(t.id))
})

const inOpenAanvraag = (exemplaarId: number) => !!get(`SELECT 1 FROM (${OPEN_ITEMS_SQL}) x WHERE x.exemplaar_id = ?`, exemplaarId)

beheer.get('/exemplaar/:id', (c) => {
  const e = get<any>('SELECT e.*, t.d_titel AS titel, t.d_artiesten AS artiesten FROM exemplaren e LEFT JOIN titels t ON t.id = e.titel_id WHERE e.id = ?', Number(c.req.param('id')))
  return e ? c.json({ ...e, in_gebruik: inOpenAanvraag(e.id), geschiedenis: all("SELECT * FROM wijzigingslog WHERE record_type = 'exemplaar' AND record_id = ? ORDER BY id DESC", String(e.id)) }) : fout(c, 'Exemplaar niet gevonden', 404)
})

beheer.patch('/exemplaar/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const e = get<any>('SELECT * FROM exemplaren WHERE id = ?', id)
  if (!e) return fout(c, 'Exemplaar niet gevonden', 404)
  const b = await c.req.json<{ objectnummer?: string; vindcode?: string | null; titel_id?: number | null; titelnummer?: string | null }>()
  const wijz: [string, any][] = []
  if (b.objectnummer !== undefined && b.objectnummer.trim() !== e.objectnummer) {
    const o = b.objectnummer.trim()
    if (!OBJECT_RE.test(o)) return fout(c, 'Een objectnummer bestaat uit cijfers')
    if (get('SELECT id FROM exemplaren WHERE objectnummer = ? AND id <> ?', o, id)) return fout(c, `Objectnummer ${o} bestaat al`, 409)
    wijz.push(['objectnummer', o])
  }
  if (b.vindcode !== undefined && (b.vindcode?.trim() || null) !== e.vindcode) wijz.push(['vindcode', b.vindcode?.trim() || null])
  if (b.titelnummer !== undefined || b.titel_id !== undefined) {
    // Koppelen aan een andere titel (correctie), op titel-ID of titelnummer.
    let t: any = null
    if (b.titel_id) t = get('SELECT id, titelnummer FROM titels WHERE id = ?', b.titel_id)
    else if (b.titelnummer) {
      const tn = b.titelnummer.trim().toUpperCase()
      t = get('SELECT id, titelnummer FROM titels WHERE titelnummer = ?', tn)
      if (!t) {
        const d = get<any>('SELECT data FROM mw_dump WHERE titelnummer = ?', tn)
        if (!d) return fout(c, 'Titelnummer niet gevonden in de collectie of de laatste Muziekweb-import')
        const dump = JSON.parse(d.data)
        t = { id: maakTitel({ titelnummer: tn, mw: dump.velden, soort: dump.soort, tip: dump.tip }), titelnummer: tn }
      }
    }
    if (t && t.id !== e.titel_id) {
      if (inOpenAanvraag(id)) return fout(c, 'Dit exemplaar zit in een open aanvraag', 409)
      wijz.push(['titel_id', t.id], ['titelnummer', t.titelnummer])
    }
  }
  for (const [veld, waarde] of wijz) {
    run(`UPDATE exemplaren SET ${veld} = ?, gewijzigd = datetime('now') WHERE id = ?`, waarde, id)
    log(wie(c), 'veld gewijzigd', { type: 'exemplaar', id, label: e.objectnummer, veld, oud: e[veld], nieuw: waarde })
  }
  catalogusGewijzigd([e.titel_id])
  return c.json(get('SELECT * FROM exemplaren WHERE id = ?', id))
})

beheer.post('/exemplaar/:id/afvoeren', async (c) => {
  const id = Number(c.req.param('id'))
  const { reden, toelichting } = await c.req.json<{ reden: string; toelichting?: string }>()
  const e = get<any>('SELECT * FROM exemplaren WHERE id = ?', id)
  if (!e) return fout(c, 'Exemplaar niet gevonden', 404)
  if (!reden || !(reden in REDENEN_AFVOER)) return fout(c, 'Kies een reden')
  if (reden === 'overig' && !toelichting?.trim()) return fout(c, 'Geef een toelichting bij "overig"')
  if (inOpenAanvraag(id)) return fout(c, 'Dit exemplaar zit in een open aanvraag. Sluit die eerst af of haal het eruit.', 409)
  run("UPDATE exemplaren SET status = 'uit_collectie', reden_afvoer = ?, toelichting_afvoer = ?, gewijzigd = datetime('now') WHERE id = ?", reden, toelichting?.trim() || null, id)
  log(wie(c), 'exemplaar afgevoerd', { type: 'exemplaar', id, label: e.objectnummer, veld: 'status', oud: 'in collectie', nieuw: `uit collectie (${REDENEN_AFVOER[reden]}${toelichting ? ': ' + toelichting : ''})` })
  catalogusGewijzigd([e.titel_id])
  return c.json({ ok: true })
})

beheer.post('/exemplaar/:id/terugzetten', (c) => {
  const id = Number(c.req.param('id'))
  const e = get<any>('SELECT * FROM exemplaren WHERE id = ?', id)
  if (!e) return fout(c, 'Exemplaar niet gevonden', 404)
  run("UPDATE exemplaren SET status = 'in_collectie', reden_afvoer = NULL, toelichting_afvoer = NULL, gewijzigd = datetime('now') WHERE id = ?", id)
  log(wie(c), 'afvoeren teruggedraaid', { type: 'exemplaar', id, label: e.objectnummer, veld: 'status', oud: 'uit collectie', nieuw: 'in collectie' })
  catalogusGewijzigd([e.titel_id])
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
    return c.json(samenvatting(analyseer(regels, f.name, overgeslagen)))
  } catch (e: any) { return fout(c, `Bestand niet te lezen: ${e.message}`) }
})

beheer.post('/import/collectie/:token', async (c) => {
  const { categorieen } = await c.req.json<{ categorieen: Categorie[] }>()
  try {
    const r = voerDoor(c.req.param('token'), categorieen ?? [], wie(c))
    catalogusGewijzigd()
    return c.json(r)
  } catch (e: any) { return fout(c, e.message) }
})

beheer.get('/imports', (c) => c.json(all<any>('SELECT * FROM imports ORDER BY id DESC LIMIT 50').map((i) => ({ ...i, rapport: json(i.rapport, {}) }))))

// ------------------------------------------------------------------ Muziekweb-import (10.7), beheerder

let mwStatus: { bezig: boolean; verwerkt: number; rapport?: any; fout?: string; gestart?: string } = { bezig: false, verwerkt: 0 }
beheer.get('/import/muziekweb/status', alleenBeheerder, (c) => c.json(mwStatus))

beheer.post('/import/muziekweb', alleenBeheerder, async (c) => {
  if (mwStatus.bezig) return fout(c, 'Er loopt al een import', 409)
  const body = await c.req.parseBody()
  const f = body.bestand as File | undefined
  if (!f || typeof f === 'string') return fout(c, 'Geen bestand ontvangen')
  const map = mkdtempSync(join(tmpdir(), 'fonos-dump-'))
  let pad: string
  const buf = Buffer.from(await f.arrayBuffer())
  if (/\.zip$/i.test(f.name)) {
    // Zip met de exportmap (part-*/…jsonl.gz) of een jsonl-bestand.
    const zip = await JSZip.loadAsync(buf)
    for (const z of Object.values(zip.files)) {
      if (z.dir || z.name.includes('..')) continue
      const doel = join(map, z.name)
      await import('node:fs').then((fs) => fs.mkdirSync(join(doel, '..'), { recursive: true }))
      writeFileSync(doel, await z.async('nodebuffer'))
    }
    const jsonl = Object.keys(zip.files).find((n) => /\.jsonl(\.gz)?$/.test(n) && !n.includes('/'))
    pad = jsonl && !Object.keys(zip.files).some((n) => n.includes('album_pages')) ? join(map, jsonl) : map
  } else if (/\.(db|sqlite3?|jsonl|jsonl\.gz)$/i.test(f.name)) {
    pad = join(map, f.name.replace(/[^\w.-]/g, '_'))
    writeFileSync(pad, buf)
  } else return fout(c, 'Upload een zip (exportmap), muziekweb.db of .jsonl')
  startMwImport(pad, f.name, wie(c), () => rmSync(map, { recursive: true, force: true }))
  return c.json(mwStatus)
})

// Ophalen uit een map op de server (FONOS_DUMP_DIR), bv. waar een automatische levering binnenkomt (O-2).
beheer.post('/import/muziekweb/server', alleenBeheerder, (c) => {
  const pad = process.env.FONOS_DUMP_DIR
  if (!pad) return fout(c, 'FONOS_DUMP_DIR is niet ingesteld op de server')
  if (mwStatus.bezig) return fout(c, 'Er loopt al een import', 409)
  startMwImport(pad, pad, wie(c))
  return c.json(mwStatus)
})

function startMwImport(pad: string, bron: string, w: ReturnType<typeof wie>, klaar?: () => void) {
  mwStatus = { bezig: true, verwerkt: 0, gestart: new Date().toISOString() }
  verwerkMuziekwebImport(kiesLezer(pad), w, bron, (n) => { mwStatus.verwerkt = n })
    .then((r) => { mwStatus = { ...mwStatus, bezig: false, rapport: r }; catalogusGewijzigd() })
    .catch((e) => { mwStatus = { ...mwStatus, bezig: false, fout: String(e?.message ?? e) } })
    .finally(() => klaar?.())
}

// ------------------------------------------------------------------ datakwaliteit (10.7)

const TOELICHTING = `COALESCE(NULLIF(json_extract(t.fonos_data, '$.toelichting'), ''), NULLIF(json_extract(t.mw_data, '$.toelichting'), ''))`
const laatsteImport = () => get<{ id: number }>("SELECT MAX(id) id FROM imports WHERE soort = 'muziekweb'")?.id ?? 0

const DQ: Record<string, { naam: string; sql: () => string }> = {
  zonder_titelnummer: { naam: 'Exemplaren zonder titelnummer', sql: () => `SELECT e.id AS exemplaar_id, e.objectnummer, e.vindcode, e.bron FROM exemplaren e WHERE e.titelnummer IS NULL AND e.titel_id IS NULL AND e.status = 'in_collectie'` },
  dubbel: { naam: 'Dubbele objectnummers', sql: () => `SELECT i.id AS issue_id, i.objectnummer, i.titelnummer, i.vindcode, i.bron, (SELECT e.titel_id FROM exemplaren e WHERE e.objectnummer = i.objectnummer) AS titel_id FROM import_issues i WHERE i.soort = 'dubbel_objectnummer' AND i.afgehandeld = 0` },
  niet_in_dump: { naam: 'Titelnummers die niet in de dump voorkomen', sql: () => `
      SELECT NULL AS titel_id, e.id AS exemplaar_id, e.objectnummer, e.titelnummer FROM exemplaren e
        WHERE e.titel_id IS NULL AND e.titelnummer IS NOT NULL AND e.status = 'in_collectie'
      UNION ALL
      SELECT t.id, NULL, NULL, t.titelnummer FROM titels t LEFT JOIN mw_dump m ON m.titelnummer = t.titelnummer
        WHERE t.titelnummer IS NOT NULL AND (m.titelnummer IS NULL OR m.import_id < ${laatsteImport()})` },
  zonder_hoes: { naam: 'Titels zonder hoes', sql: () => `SELECT t.id AS titel_id, t.titelnummer, t.d_titel AS titel, t.d_artiesten AS artiesten FROM titels t WHERE t.d_hoes IS NULL` },
  zonder_toelichting: { naam: 'Titels zonder toelichting', sql: () => `SELECT t.id AS titel_id, t.titelnummer, t.d_titel AS titel, t.d_artiesten AS artiesten FROM titels t WHERE ${TOELICHTING} IS NULL` },
  ongekoppelde_genres: { naam: 'Muziekweb-genres zonder genreknop', sql: () => `SELECT j.value AS genre, COUNT(*) AS aantal FROM titels t, json_each(t.d_genres) j
      WHERE j.value NOT IN (SELECT mw_genre FROM genre_koppelingen) GROUP BY j.value ORDER BY aantal DESC` },
  conflicten: { naam: 'Conflicten tussen Fonos- en Muziekweb-waarde', sql: () => `SELECT t.id AS titel_id, t.titelnummer, t.d_titel AS titel, t.conflicten FROM titels t WHERE t.conflicten != '{}'` },
}

function dqTellingen() {
  return Object.fromEntries(Object.entries(DQ).map(([k, v]) => [k, get<{ n: number }>(`SELECT COUNT(*) n FROM (${v.sql()})`)!.n]))
}

beheer.get('/datakwaliteit', (c) => {
  const t = dqTellingen()
  return c.json(Object.entries(DQ).map(([sleutel, v]) => ({ sleutel, naam: v.naam, aantal: t[sleutel] })))
})

beheer.get('/datakwaliteit/:lijst', (c) => {
  const l = DQ[c.req.param('lijst')]
  if (!l) return fout(c, 'Onbekende lijst', 404)
  const pagina = Math.max(1, Number(c.req.query('pagina')) || 1)
  const rijen = all<any>(`SELECT * FROM (${l.sql()}) LIMIT 100 OFFSET ?`, (pagina - 1) * 100)
  return c.json({ naam: l.naam, totaal: get<{ n: number }>(`SELECT COUNT(*) n FROM (${l.sql()})`)!.n, pagina, rijen: rijen.map((r) => (r.conflicten ? { ...r, conflicten: Object.keys(json(r.conflicten, {})) } : r)) })
})

beheer.post('/issue/:id/afgehandeld', (c) => {
  const id = Number(c.req.param('id'))
  const i = get<any>('SELECT * FROM import_issues WHERE id = ?', id)
  if (!i) return fout(c, 'Niet gevonden', 404)
  run('UPDATE import_issues SET afgehandeld = 1 WHERE id = ?', id)
  log(wie(c), 'dubbel objectnummer afgehandeld', { type: 'import_issue', id, label: i.objectnummer })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ genreknoppen (10.8), beheerder

beheer.get('/genreknoppen', (c) => c.json({
  knoppen: all<any>('SELECT k.*, (SELECT COUNT(*) FROM genre_koppelingen g WHERE g.knop_id = k.id) AS koppelingen FROM genreknoppen k ORDER BY volgorde, id'),
  nl_weergave: instellingen().nl_weergave,
}))

beheer.get('/genreknop/:id', (c) => {
  const id = Number(c.req.param('id'))
  const k = get<any>('SELECT * FROM genreknoppen WHERE id = ?', id)
  if (!k) return fout(c, 'Niet gevonden', 404)
  const telling = new Map(all<any>('SELECT j.value g, COUNT(*) n FROM titels t, json_each(t.d_genres) j GROUP BY j.value').map((r) => [r.g, r.n]))
  const kop = all<any>('SELECT * FROM genre_koppelingen WHERE knop_id = ? ORDER BY weergavenaam, mw_genre', id).map((g) => ({ ...g, titels: telling.get(g.mw_genre) ?? 0 }))
  return c.json({ ...k, koppelingen: kop })
})

beheer.post('/genreknoppen', alleenBeheerder, async (c) => {
  const b = await c.req.json<any>()
  if (!b.naam?.trim()) return fout(c, 'Vul een naam in')
  const max = get<{ m: number }>('SELECT COALESCE(MAX(volgorde), 0) m FROM genreknoppen')!.m
  const id = Number(run('INSERT INTO genreknoppen (naam, volgorde, kleur, nederlands) VALUES (?, ?, ?, ?)', b.naam.trim(), max + 1, b.kleur || '#ff14b4', b.nederlands ? 1 : 0).lastInsertRowid)
  log(wie(c), 'genreknop toegevoegd', { type: 'genreknop', id, label: b.naam })
  wisConfigCache()
  return c.json({ id })
})

beheer.patch('/genreknop/:id', alleenBeheerder, async (c) => {
  const id = Number(c.req.param('id'))
  const k = get<any>('SELECT * FROM genreknoppen WHERE id = ?', id)
  if (!k) return fout(c, 'Niet gevonden', 404)
  const b = await c.req.json<any>()
  for (const veld of ['naam', 'volgorde', 'actief', 'kleur', 'nederlands', 'afbeelding'] as const) {
    if (b[veld] === undefined) continue
    const w = typeof b[veld] === 'boolean' ? (b[veld] ? 1 : 0) : b[veld]
    if (w === k[veld]) continue
    run(`UPDATE genreknoppen SET ${veld} = ? WHERE id = ?`, w, id)
    log(wie(c), 'veld gewijzigd', { type: 'genreknop', id, label: k.naam, veld, oud: k[veld], nieuw: w })
  }
  wisConfigCache()
  return c.json({ ok: true })
})

beheer.post('/genreknop/:id/afbeelding', alleenBeheerder, async (c) => {
  try {
    const url = await bewaarUpload(c)
    run('UPDATE genreknoppen SET afbeelding = ? WHERE id = ?', url, Number(c.req.param('id')))
    log(wie(c), 'afbeelding genreknop', { type: 'genreknop', id: c.req.param('id'), nieuw: url })
    wisConfigCache()
    return c.json({ afbeelding: url })
  } catch (e: any) { return fout(c, e.message) }
})

beheer.delete('/genreknop/:id', alleenBeheerder, (c) => {
  const id = Number(c.req.param('id'))
  const k = get<any>('SELECT * FROM genreknoppen WHERE id = ?', id)
  if (!k) return fout(c, 'Niet gevonden', 404)
  run('DELETE FROM genreknoppen WHERE id = ?', id)
  log(wie(c), 'genreknop verwijderd', { type: 'genreknop', id, label: k.naam })
  wisConfigCache()
  return c.json({ ok: true })
})

/** Vervangt alle koppelingen van een knop: [{mw_genre, weergavenaam}]. */
beheer.put('/genreknop/:id/koppelingen', alleenBeheerder, async (c) => {
  const id = Number(c.req.param('id'))
  const { koppelingen } = await c.req.json<{ koppelingen: { mw_genre: string; weergavenaam?: string | null }[] }>()
  const oud = all<any>('SELECT mw_genre, weergavenaam FROM genre_koppelingen WHERE knop_id = ? ORDER BY mw_genre', id)
  tx(() => {
    run('DELETE FROM genre_koppelingen WHERE knop_id = ?', id)
    for (const k of koppelingen) if (k.mw_genre?.trim()) run('INSERT OR IGNORE INTO genre_koppelingen (knop_id, mw_genre, weergavenaam) VALUES (?, ?, ?)', id, k.mw_genre.trim(), k.weergavenaam?.trim() || null)
  })
  log(wie(c), 'genrekoppelingen gewijzigd', { type: 'genreknop', id, veld: 'koppelingen', oud: oud.map((o) => o.mw_genre), nieuw: koppelingen.map((k) => k.mw_genre) })
  wisConfigCache()
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ selecties (10.9)

beheer.get('/selecties', (c) => c.json(all<any>(`SELECT s.*, (SELECT COUNT(*) FROM selectie_titels x WHERE x.selectie_id = s.id) AS handmatig FROM selecties s ORDER BY volgorde, id`)))

beheer.get('/selectie/:id', (c) => {
  const s = get<any>('SELECT * FROM selecties WHERE id = ?', Number(c.req.param('id')))
  if (!s) return fout(c, 'Niet gevonden', 404)
  const titels = all<any>(`SELECT t.id, t.d_titel titel, t.d_artiesten artiesten, t.d_jaar jaar, t.d_drager drager, t.d_hoes hoes
    FROM selectie_titels x JOIN titels t ON t.id = x.titel_id WHERE x.selectie_id = ? ORDER BY x.volgorde`, s.id)
  const docs = alleDocs()
  const automatisch = ['uitgelicht', 'nieuw', 'vaak'].includes(s.soort) || s.mw_genre
    ? selectieTitels(s, docs, inGebruik(), false).map((d) => ({ id: d.id, titel: d.titel, artiesten: d.artiesten, jaar: d.jaar, hoes: d.hoes })) : []
  return c.json({ ...s, titels, voorbeeld: automatisch })
})

beheer.post('/selecties', async (c) => {
  const b = await c.req.json<any>()
  if (!b.naam?.trim()) return fout(c, 'Vul een naam in')
  const soort = ['handmatig', 'seizoen'].includes(b.soort) ? b.soort : 'handmatig'
  const max = get<{ m: number }>('SELECT COALESCE(MAX(volgorde), 0) m FROM selecties')!.m
  const id = Number(run('INSERT INTO selecties (naam, soort, volgorde, begin, eind) VALUES (?, ?, ?, ?, ?)', b.naam.trim(), soort, max + 1, b.begin || null, b.eind || null).lastInsertRowid)
  log(wie(c), 'selectie toegevoegd', { type: 'selectie', id, label: b.naam })
  return c.json({ id })
})

beheer.patch('/selectie/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const s = get<any>('SELECT * FROM selecties WHERE id = ?', id)
  if (!s) return fout(c, 'Niet gevonden', 404)
  const b = await c.req.json<any>()
  for (const veld of ['naam', 'volgorde', 'actief', 'begin', 'eind', 'aantal', 'periode_dagen', 'mw_genre'] as const) {
    if (b[veld] === undefined) continue
    const w = typeof b[veld] === 'boolean' ? (b[veld] ? 1 : 0) : b[veld] === '' ? null : b[veld]
    if (w === s[veld]) continue
    run(`UPDATE selecties SET ${veld} = ? WHERE id = ?`, w, id)
    log(wie(c), 'veld gewijzigd', { type: 'selectie', id, label: s.naam, veld, oud: s[veld], nieuw: w })
  }
  return c.json({ ok: true })
})

beheer.delete('/selectie/:id', (c) => {
  const id = Number(c.req.param('id'))
  const s = get<any>('SELECT * FROM selecties WHERE id = ?', id)
  if (!s) return fout(c, 'Niet gevonden', 404)
  if (['uitgelicht', 'nieuw', 'vaak'].includes(s.soort)) return fout(c, 'Automatische selecties kun je uitzetten, niet verwijderen')
  run('DELETE FROM selecties WHERE id = ?', id)
  log(wie(c), 'selectie verwijderd', { type: 'selectie', id, label: s.naam })
  return c.json({ ok: true })
})

beheer.put('/selectie/:id/titels', async (c) => {
  const id = Number(c.req.param('id'))
  const { ids } = await c.req.json<{ ids: number[] }>()
  const oud = all<any>('SELECT titel_id FROM selectie_titels WHERE selectie_id = ? ORDER BY volgorde', id).map((r) => r.titel_id)
  tx(() => {
    run('DELETE FROM selectie_titels WHERE selectie_id = ?', id)
    ;[...new Set(ids)].forEach((t, i) => run('INSERT INTO selectie_titels (selectie_id, titel_id, volgorde) VALUES (?, ?, ?)', id, t, i))
  })
  log(wie(c), 'titels selectie gewijzigd', { type: 'selectie', id, veld: 'titels', oud, nieuw: ids })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ instellingen (10.10), beheerder

beheer.get('/instellingen', alleenBeheerder, (c) => c.json({ instellingen: instellingen(), platenspelers: all('SELECT * FROM platenspelers ORDER BY nummer') }))

beheer.put('/instellingen', alleenBeheerder, async (c) => {
  const b = await c.req.json<Record<string, unknown>>()
  const huidig = instellingen() as any
  for (const [k, v] of Object.entries(b)) {
    if (!(k in STANDAARD_INSTELLINGEN)) continue
    const std = (STANDAARD_INSTELLINGEN as any)[k]
    const waarde = typeof std === 'number' ? Number(v) : typeof std === 'boolean' ? !!v : v
    if (typeof std === 'number' && (!Number.isFinite(waarde) || (waarde as number) < 0)) return fout(c, `Ongeldige waarde voor ${k}`)
    if (JSON.stringify(huidig[k]) === JSON.stringify(waarde)) continue
    if (k === 'aantal_platenspelers') {
      const n = Number(waarde)
      if (n < 1 || n > 30) return fout(c, 'Aantal platenspelers tussen 1 en 30')
      if (get(`SELECT 1 FROM aanvragen WHERE platenspeler > ? AND status IN ('ingediend', 'uitgegeven')`, n)) return fout(c, 'Er lopen nog aanvragen op platenspelers boven dit aantal')
      syncPlatenspelers(n)
    }
    zetInstelling(k, waarde)
    log(wie(c), 'instelling gewijzigd', { type: 'instelling', id: k, label: k, veld: k, oud: huidig[k], nieuw: waarde })
  }
  wisConfigCache()
  beschikbaarheidGewijzigd()
  return c.json({ instellingen: instellingen() })
})

// ------------------------------------------------------------------ gebruikers (10.11), beheerder

beheer.get('/gebruikers', alleenBeheerder, (c) =>
  c.json(all<any>('SELECT id, email, naam, rollen, actief, aangemaakt FROM gebruikers ORDER BY naam').map((g) => ({ ...g, rollen: json(g.rollen, []), actief: !!g.actief }))))

async function stuurReset(c: Context, gebruikerId: number, email: string, welkom: boolean) {
  const token = maakResetToken(gebruikerId)
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
  if (get('SELECT id FROM gebruikers WHERE email = ?', b.email.trim())) return fout(c, 'Dit e-mailadres bestaat al', 409)
  const id = maakGebruiker({ email: b.email, naam: b.naam, rollen: rollen as any })
  log(wie(c), 'gebruiker aangemaakt', { type: 'gebruiker', id, label: b.naam, nieuw: { rollen } })
  await stuurReset(c, id, b.email.trim(), true).catch((e) => console.error(e))
  return c.json({ id })
})

beheer.patch('/gebruiker/:id', alleenBeheerder, async (c) => {
  const id = Number(c.req.param('id'))
  const g = get<any>('SELECT * FROM gebruikers WHERE id = ?', id)
  if (!g) return fout(c, 'Niet gevonden', 404)
  const b = await c.req.json<{ naam?: string; rollen?: string[]; actief?: boolean }>()
  const ik = wie(c)
  if (id === ik.id && (b.actief === false || (b.rollen && !b.rollen.includes('beheerder')))) return fout(c, 'Je kunt je eigen beheerdersrechten niet intrekken')
  if (b.naam !== undefined && b.naam.trim() !== g.naam) { run('UPDATE gebruikers SET naam = ? WHERE id = ?', b.naam.trim(), id); log(ik, 'veld gewijzigd', { type: 'gebruiker', id, label: g.naam, veld: 'naam', oud: g.naam, nieuw: b.naam }) }
  if (b.rollen) {
    const r = b.rollen.filter((x) => (ROLLEN as readonly string[]).includes(x))
    if (!r.length) return fout(c, 'Kies minstens één rol')
    run('UPDATE gebruikers SET rollen = ? WHERE id = ?', JSON.stringify(r), id)
    log(ik, 'veld gewijzigd', { type: 'gebruiker', id, label: g.naam, veld: 'rollen', oud: json(g.rollen, []), nieuw: r })
  }
  if (b.actief !== undefined && (b.actief ? 1 : 0) !== g.actief) {
    run('UPDATE gebruikers SET actief = ? WHERE id = ?', b.actief ? 1 : 0, id)
    if (!b.actief) run('DELETE FROM sessies WHERE gebruiker_id = ?', id)
    log(ik, b.actief ? 'gebruiker geactiveerd' : 'gebruiker gedeactiveerd', { type: 'gebruiker', id, label: g.naam })
  }
  return c.json({ ok: true })
})

beheer.post('/gebruiker/:id/reset', alleenBeheerder, async (c) => {
  const g = get<any>('SELECT * FROM gebruikers WHERE id = ?', Number(c.req.param('id')))
  if (!g) return fout(c, 'Niet gevonden', 404)
  await stuurReset(c, g.id, g.email, false)
  log(wie(c), 'wachtwoord-reset verstuurd', { type: 'gebruiker', id: g.id, label: g.naam })
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ wijzigingslog (10.12)

beheer.get('/log', (c) => {
  const q = c.req.query()
  const waar: string[] = []
  const p: any[] = []
  if (q.gebruiker) { waar.push('gebruiker = ?'); p.push(q.gebruiker) }
  if (q.van) { waar.push('tijd >= ?'); p.push(q.van) }
  if (q.tot) { waar.push('tijd < date(?, \'+1 day\')'); p.push(q.tot) }
  if (q.type) { waar.push('record_type = ?'); p.push(q.type) }
  if (q.record) { waar.push('record_id = ?'); p.push(q.record) }
  if (q.q) { waar.push('(record_label LIKE ? OR actie LIKE ? OR veld LIKE ? OR oud LIKE ? OR nieuw LIKE ?)'); const z = `%${q.q}%`; p.push(z, z, z, z, z) }
  const where = waar.length ? `WHERE ${waar.join(' AND ')}` : ''
  const pagina = Math.max(1, Number(q.pagina) || 1)
  return c.json({
    totaal: get<{ n: number }>(`SELECT COUNT(*) n FROM wijzigingslog ${where}`, ...p)!.n,
    pagina,
    regels: all(`SELECT * FROM wijzigingslog ${where} ORDER BY id DESC LIMIT 100 OFFSET ?`, ...p, (pagina - 1) * 100),
    gebruikers: all<any>('SELECT DISTINCT gebruiker FROM wijzigingslog ORDER BY gebruiker').map((r) => r.gebruiker),
  })
})

/** De oude waarde van een veld terugzetten (redacteur). */
beheer.post('/log/:id/terugzetten', async (c) => {
  const l = get<any>('SELECT * FROM wijzigingslog WHERE id = ?', Number(c.req.param('id')))
  if (!l || !l.veld || !['veld gewijzigd', 'terug naar Muziekweb'].includes(l.actie)) return fout(c, 'Deze regel kan niet worden teruggezet')
  const oud = l.oud == null ? null : (() => { try { return JSON.parse(l.oud) } catch { return l.oud } })()
  const id = Number(l.record_id)
  try {
    if (l.record_type === 'titel') {
      if (TWEELAAGS.some((v) => v.veld === l.veld)) {
        const t = get<any>('SELECT mw_data FROM titels WHERE id = ?', id)
        const mw = json<any>(t?.mw_data, {})
        // Was de oude waarde de Muziekweb-waarde, dan de Fonos-waarde wissen; anders als Fonos-waarde zetten.
        zetFonosWaarde(id, l.veld, JSON.stringify(mw[l.veld] ?? null) === JSON.stringify(oud) ? undefined : oud, wie(c))
      } else if (FONOS_EIGEN.includes(l.veld)) zetFonosEigen(id, l.veld, oud, wie(c))
      else return fout(c, 'Dit veld kan niet worden teruggezet')
      catalogusGewijzigd([id])
    } else if (l.record_type === 'exemplaar' && ['vindcode', 'objectnummer'].includes(l.veld)) {
      const e = get<any>('SELECT * FROM exemplaren WHERE id = ?', id)
      if (!e) return fout(c, 'Exemplaar bestaat niet meer')
      if (l.veld === 'objectnummer' && get('SELECT 1 FROM exemplaren WHERE objectnummer = ? AND id <> ?', oud, id)) return fout(c, 'Dat objectnummer is intussen in gebruik')
      run(`UPDATE exemplaren SET ${l.veld} = ? WHERE id = ?`, oud, id)
      log(wie(c), 'veld gewijzigd', { type: 'exemplaar', id, label: e.objectnummer, veld: l.veld, oud: e[l.veld], nieuw: oud })
    } else return fout(c, 'Dit veld kan niet worden teruggezet')
  } catch (e: any) { return fout(c, e.message) }
  return c.json({ ok: true })
})

// ------------------------------------------------------------------ back-ups (12), beheerder

beheer.get('/backups', alleenBeheerder, (c) => c.json({ backups: all('SELECT * FROM backups ORDER BY id DESC LIMIT 200'), map: BACKUP_DIR }))

beheer.post('/backups', alleenBeheerder, async (c) => {
  try { return c.json(await maakBackup('handmatig', wie(c))) } catch (e: any) { return fout(c, e.message) }
})

beheer.get('/backup/download', alleenBeheerder, async (c) => {
  // Handmatige download: JSON + Excel, met of zonder geüploade hoezen (12.2).
  const hoezen = c.req.query('hoezen') === '1'
  const map = mkdtempSync(join(tmpdir(), 'fonos-dl-'))
  const pad = join(map, 'backup.zip')
  await maakZip({ excel: true, hoezen }, pad)
  const buf = readFileSync(pad)
  rmSync(map, { recursive: true, force: true })
  log(wie(c), 'back-up gedownload', { type: 'backup', nieuw: { hoezen, omvang: buf.length } })
  const naam = `fonotheek-backup-${new Date().toISOString().slice(0, 10)}.zip`
  return new Response(buf, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${naam}"` } })
})

beheer.get('/backup/:id/download', alleenBeheerder, (c) => {
  const b = backupPad(Number(c.req.param('id')))
  if (!b) return fout(c, 'Back-up niet gevonden', 404)
  log(wie(c), 'back-up gedownload', { type: 'backup', id: c.req.param('id'), label: b.bestand })
  return new Response(readFileSync(b.pad), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${b.bestand}"` } })
})

beheer.post('/terugzetten/controle', alleenBeheerder, async (c) => {
  try {
    const ct = c.req.header('content-type') ?? ''
    if (ct.includes('multipart')) {
      const body = await c.req.parseBody()
      const f = body.bestand as File
      if (!f || typeof f === 'string') return fout(c, 'Geen bestand ontvangen')
      return c.json(vergelijk(await leesBackup(Buffer.from(await f.arrayBuffer()), f.name)))
    }
    const { id } = await c.req.json<{ id: number }>()
    const b = backupPad(Number(id))
    if (!b) return fout(c, 'Back-up niet gevonden', 404)
    return c.json(vergelijk(await leesBackup(readFileSync(b.pad), b.bestand)))
  } catch (e: any) { return fout(c, e.message) }
})

beheer.post('/terugzetten', alleenBeheerder, async (c) => {
  const { token, bevestiging } = await c.req.json<{ token: string; bevestiging: string }>()
  try { return c.json(await zetTerug(token, bevestiging, wie(c))) } catch (e: any) { return fout(c, e.message) }
})
